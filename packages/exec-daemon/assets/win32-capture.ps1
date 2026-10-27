# Fixed selected-window helper. Arguments are data. This process never runs a user command.
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet("list", "capture")]
  [string] $Mode,
  [Parameter(Position = 1)]
  [string] $Hwnd,
  [Parameter(Position = 2)]
  [string] $ProcessId,
  [Parameter(Position = 3)]
  [string] $ProcessStartTime,
  [Parameter(Position = 4)]
  [string] $OutputDirectory
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$WarningPreference = "SilentlyContinue"
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

function Write-Result([string] $Json, [int] $Code) {
  [Console]::Out.Write($Json)
  exit $Code
}

$source = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

namespace DsbScreen {
  public sealed class ScreenReject : Exception {
    public string Code;
    public ScreenReject(string code, string message) : base(message) {
      Code = code;
    }
  }

  public sealed class WindowRow {
    public string hwnd;
    public long pid;
    public string processStartTime;
    public string title;
    public bool minimized;
    public int width;
    public int height;
    public bool isProtected;
  }

  public static class Api {
    const int MaxWindows = 200;
    const int MaxEdge = 8192;
    const int MaxTitle = 512;
    const long MaxPixels = 16000000L;
    const long MaxPng = 8388608L;
    const uint ProcessQueryLimited = 0x1000;
    const uint PrintFull = 0x2;

    delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
    static EnumProc enumProc;

    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hwnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] static extern bool GetWindowDisplayAffinity(IntPtr hwnd, out uint affinity);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    [StructLayout(LayoutKind.Sequential)]
    struct Rect { public int Left; public int Top; public int Right; public int Bottom; }

    static readonly JavaScriptSerializer Json = CreateJson();

    static JavaScriptSerializer CreateJson() {
      JavaScriptSerializer serializer = new JavaScriptSerializer();
      serializer.MaxJsonLength = 1048576;
      return serializer;
    }

    public static string Fail(string code, string message) {
      Dictionary<string, object> body = new Dictionary<string, object>();
      body["ok"] = false;
      body["code"] = code;
      body["message"] = message;
      return Json.Serialize(body);
    }

    public static string ListJson() {
      List<WindowRow> rows = new List<WindowRow>();
      enumProc = delegate(IntPtr hwnd, IntPtr lParam) {
        if (rows.Count >= MaxWindows) return false;
        WindowRow row = TryRow(hwnd);
        if (row != null) rows.Add(row);
        return rows.Count < MaxWindows;
      };
      EnumWindows(enumProc, IntPtr.Zero);
      Dictionary<string, object> body = new Dictionary<string, object>();
      body["ok"] = true;
      body["windows"] = rows;
      return Json.Serialize(body);
    }

    public static string CaptureJson(string hwndText, string pidText, string startText, string outputDirectory) {
      IntPtr hwnd = ParseHwnd(hwndText);
      uint pid = ParsePid(pidText);
      string expectedStart = ParseStart(startText);
      if (!IsWindow(hwnd)) throw new ScreenReject("CLOSED", "window is closed");
      uint actualPid;
      GetWindowThreadProcessId(hwnd, out actualPid);
      if (actualPid != pid) throw new ScreenReject("REUSED", "window handle was reused");
      string actualStart = ReadStart(pid);
      if (actualStart == null) throw new ScreenReject("UNCONFIRMED", "process identity could not be confirmed");
      if (actualStart != expectedStart) throw new ScreenReject("REUSED", "window handle was reused");
      if (IsIconic(hwnd)) throw new ScreenReject("MINIMIZED", "window is minimized");
      if (IsCloaked(hwnd) || IsProtected(hwnd)) throw new ScreenReject("PROTECTED", "window capture is blocked");
      Rect rect;
      if (!GetWindowRect(hwnd, out rect)) throw new ScreenReject("SIZE", "window size is outside the capture limit");
      int width = rect.Right - rect.Left;
      int height = rect.Bottom - rect.Top;
      if (width < 1 || height < 1 || width > MaxEdge || height > MaxEdge || (long)width * (long)height > MaxPixels) {
        throw new ScreenReject("SIZE", "window size is outside the capture limit");
      }
      if (outputDirectory == null || !Path.IsPathRooted(outputDirectory) || !Directory.Exists(outputDirectory)) {
        throw new ScreenReject("INPUT", "output directory is invalid");
      }
      string file = Path.Combine(Path.GetFullPath(outputDirectory), "capture.png");
      if (HasReparsePoint(file)) throw new ScreenReject("INPUT", "capture output is a link");
      SavePng(hwnd, width, height, file);
      FileInfo info = new FileInfo(file);
      if (!info.Exists || info.Length < 1 || info.Length > MaxPng) {
        if (info.Exists) info.Delete();
        throw new ScreenReject("SIZE", "png exceeds 8 MiB");
      }
      Dictionary<string, object> body = new Dictionary<string, object>();
      body["ok"] = true;
      body["width"] = width;
      body["height"] = height;
      return Json.Serialize(body);
    }

    static WindowRow TryRow(IntPtr hwnd) {
      if (!IsWindowVisible(hwnd) || IsCloaked(hwnd)) return null;
      string title = ReadTitle(hwnd);
      if (title.Length == 0) return null;
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      if (pid == 0) return null;
      string started = ReadStart(pid);
      if (started == null) return null;
      int width = 0;
      int height = 0;
      Rect rect;
      if (GetWindowRect(hwnd, out rect)) {
        width = rect.Right - rect.Left;
        height = rect.Bottom - rect.Top;
        if (width < 0) width = 0;
        if (height < 0) height = 0;
        if (width > MaxEdge) width = MaxEdge;
        if (height > MaxEdge) height = MaxEdge;
      }
      WindowRow row = new WindowRow();
      row.hwnd = FormatHwnd(hwnd);
      row.pid = pid;
      row.processStartTime = started;
      row.title = title;
      row.minimized = IsIconic(hwnd);
      row.width = width;
      row.height = height;
      row.isProtected = IsProtected(hwnd);
      return row;
    }

    static void SavePng(IntPtr hwnd, int width, int height, string file) {
      using (Bitmap bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb))
      using (Graphics graphics = Graphics.FromImage(bitmap)) {
        IntPtr hdc = graphics.GetHdc();
        bool ok = false;
        try {
          ok = PrintWindow(hwnd, hdc, PrintFull);
        } finally {
          graphics.ReleaseHdc(hdc);
        }
        if (!ok) throw new ScreenReject("RUNTIME", "capture helper failed");
        bitmap.Save(file, ImageFormat.Png);
      }
    }

    static bool HasReparsePoint(string file) {
      if (!File.Exists(file)) return false;
      FileAttributes attributes = File.GetAttributes(file);
      return (attributes & FileAttributes.ReparsePoint) != 0;
    }

    static bool IsCloaked(IntPtr hwnd) {
      int cloaked;
      int hr = DwmGetWindowAttribute(hwnd, 14, out cloaked, sizeof(int));
      return hr == 0 && cloaked != 0;
    }

    static bool IsProtected(IntPtr hwnd) {
      uint affinity;
      return GetWindowDisplayAffinity(hwnd, out affinity) && affinity != 0;
    }

    static string ReadStart(uint pid) {
      IntPtr handle = OpenProcess(ProcessQueryLimited, false, pid);
      if (handle == IntPtr.Zero) return null;
      try {
        long creation;
        long exit;
        long kernel;
        long user;
        if (!GetProcessTimes(handle, out creation, out exit, out kernel, out user)) return null;
        ulong ticks = (ulong)creation;
        if (ticks == 0) return null;
        return ticks.ToString(CultureInfo.InvariantCulture);
      } finally {
        CloseHandle(handle);
      }
    }

    static string ReadTitle(IntPtr hwnd) {
      int length = GetWindowTextLength(hwnd);
      if (length < 1) return "";
      int capacity = length + 1;
      if (capacity > MaxTitle + 1) capacity = MaxTitle + 1;
      StringBuilder builder = new StringBuilder(capacity);
      GetWindowText(hwnd, builder, builder.Capacity);
      string text = builder.ToString().Replace("\0", "").Replace("\r", " ").Replace("\n", " ").Trim();
      if (text.Length > MaxTitle) text = text.Substring(0, MaxTitle);
      return text;
    }

    static string FormatHwnd(IntPtr hwnd) {
      ulong value = (ulong)hwnd.ToInt64();
      return value.ToString(CultureInfo.InvariantCulture);
    }

    static IntPtr ParseHwnd(string text) {
      ulong value;
      if (text == null || !UInt64.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out value) || value == 0) {
        throw new ScreenReject("INPUT", "window identity is invalid");
      }
      return new IntPtr(unchecked((long)value));
    }

    static uint ParsePid(string text) {
      uint value;
      if (text == null || !UInt32.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out value) || value == 0) {
        throw new ScreenReject("INPUT", "window identity is invalid");
      }
      return value;
    }

    static string ParseStart(string text) {
      ulong value;
      if (text == null || !UInt64.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out value) || value == 0) {
        throw new ScreenReject("INPUT", "window identity is invalid");
      }
      return value.ToString(CultureInfo.InvariantCulture);
    }
  }
}
'@

try {
  Add-Type -AssemblyName System.Drawing
  Add-Type -AssemblyName System.Web.Extensions
  Add-Type -TypeDefinition $source -ReferencedAssemblies System.Drawing, System.Web.Extensions
} catch {
  Write-Result '{"ok":false,"code":"RUNTIME","message":"capture helper failed"}' 1
}

try {
  if ($Mode -eq "list") {
    Write-Result ([DsbScreen.Api]::ListJson()) 0
  }
  if ([string]::IsNullOrEmpty($Hwnd) -or [string]::IsNullOrEmpty($ProcessId) -or [string]::IsNullOrEmpty($ProcessStartTime) -or [string]::IsNullOrEmpty($OutputDirectory)) {
    Write-Result ([DsbScreen.Api]::Fail("INPUT", "capture request is invalid")) 1
  }
  Write-Result ([DsbScreen.Api]::CaptureJson($Hwnd, $ProcessId, $ProcessStartTime, $OutputDirectory)) 0
} catch {
  $reject = $_.Exception
  while ($null -ne $reject.InnerException) { $reject = $reject.InnerException }
  if ($reject -is [DsbScreen.ScreenReject]) {
    Write-Result ([DsbScreen.Api]::Fail($reject.Code, "capture helper rejected the window")) 1
  }
  Write-Result ([DsbScreen.Api]::Fail("RUNTIME", "capture helper failed")) 1
}
