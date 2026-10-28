# Fixed pointer and key helper. Arguments are data. This process never runs a user command.
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet("pointer", "key")]
  [string] $Mode,
  [Parameter(Mandatory = $true, Position = 1)]
  [string] $A,
  [Parameter(Mandatory = $true, Position = 2)]
  [string] $B,
  [Parameter(Mandatory = $true, Position = 3)]
  [string] $C,
  [Parameter(Mandatory = $true, Position = 4)]
  [string] $D
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

function Fail([string] $Code) {
  if ($Code -ne "INPUT" -and $Code -ne "UNCONFIRMED") { $Code = "INPUT" }
  Write-Result ('{"ok":false,"code":"' + $Code + '"}') 1
}

# Primary virtual keys only. Shift=16, ctrl=17, and alt=18 are flags, not this list.
$AllowedVks = @(8,9,13,27,32,33,34,35,36,37,38,39,40,46,48,49,50,51,52,53,54,55,56,57,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,112,113,114,115,116,117,118,119,120,121,122,123)

function Read-BoundedInt([string] $Text, [int] $Max) {
  if ($Text -notmatch '^(0|[1-9][0-9]{0,4})$') { return $null }
  $value = 0
  if (-not [int]::TryParse($Text, [ref] $value)) { return $null }
  if ($value -lt 0 -or $value -gt $Max) { return $null }
  return $value
}

$source = @'
using System;
using System.Runtime.InteropServices;

namespace DsbInput {
  public static class Api {
    const uint LeftDown = 0x0002;
    const uint LeftUp = 0x0004;
    const uint RightDown = 0x0008;
    const uint RightUp = 0x0010;
    const uint MiddleDown = 0x0020;
    const uint MiddleUp = 0x0040;
    const uint KeyUp = 0x0002;

    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT {
      public int dx;
      public int dy;
      public uint mouseData;
      public uint dwFlags;
      public uint time;
      public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT {
      public ushort wVk;
      public ushort wScan;
      public uint dwFlags;
      public uint time;
      public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    struct InputUnion {
      [FieldOffset(0)] public MOUSEINPUT mi;
      [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct INPUT {
      public uint type;
      public InputUnion u;
    }

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] inputs, int cbSize);

    static INPUT Mouse(uint flags) {
      INPUT input = new INPUT();
      input.type = 0;
      input.u.mi.dwFlags = flags;
      return input;
    }

    static INPUT Key(ushort vk, bool up) {
      INPUT input = new INPUT();
      input.type = 1;
      input.u.ki.wVk = vk;
      if (up) input.u.ki.dwFlags = KeyUp;
      return input;
    }

    public static string Pointer(string gesture, string button, int x, int y) {
      if (x < 0 || y < 0 || x > 8192 || y > 8192) return "INPUT";
      if (!SetCursorPos(x, y)) return "UNCONFIRMED";
      if (gesture == "move") return "OK";
      uint down;
      uint up;
      if (button == "left") { down = LeftDown; up = LeftUp; }
      else if (button == "right") { down = RightDown; up = RightUp; }
      else if (button == "middle") { down = MiddleDown; up = MiddleUp; }
      else return "INPUT";
      if (gesture != "click") return "INPUT";
      INPUT[] inputs = new INPUT[2];
      inputs[0] = Mouse(down);
      inputs[1] = Mouse(up);
      uint sent = SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
      return sent == 2 ? "OK" : "UNCONFIRMED";
    }

    public static string KeyTap(int vk, int shift, int ctrl, int alt) {
      if (vk < 1 || vk > 255) return "INPUT";
      if ((shift != 0 && shift != 1) || (ctrl != 0 && ctrl != 1) || (alt != 0 && alt != 1)) return "INPUT";
      int count = 2;
      if (shift == 1) count += 2;
      if (ctrl == 1) count += 2;
      if (alt == 1) count += 2;
      INPUT[] inputs = new INPUT[count];
      int index = 0;
      if (shift == 1) inputs[index++] = Key(0x10, false);
      if (ctrl == 1) inputs[index++] = Key(0x11, false);
      if (alt == 1) inputs[index++] = Key(0x12, false);
      inputs[index++] = Key((ushort)vk, false);
      inputs[index++] = Key((ushort)vk, true);
      if (alt == 1) inputs[index++] = Key(0x12, true);
      if (ctrl == 1) inputs[index++] = Key(0x11, true);
      if (shift == 1) inputs[index++] = Key(0x10, true);
      uint sent = SendInput((uint)count, inputs, Marshal.SizeOf(typeof(INPUT)));
      return sent == (uint)count ? "OK" : "UNCONFIRMED";
    }
  }
}
'@

try {
  Add-Type -TypeDefinition $source -Language CSharp -ErrorAction Stop | Out-Null
} catch {
  Fail "UNCONFIRMED"
}

if ($Mode -eq "pointer") {
  if ($A -ne "move" -and $A -ne "click") { Fail "INPUT" }
  if ($B -ne "left" -and $B -ne "right" -and $B -ne "middle") { Fail "INPUT" }
  $x = Read-BoundedInt $C 8192
  $y = Read-BoundedInt $D 8192
  if ($null -eq $x -or $null -eq $y) { Fail "INPUT" }
  $result = [DsbInput.Api]::Pointer($A, $B, $x, $y)
  if ($result -eq "OK") { Write-Result '{"ok":true}' 0 }
  Fail $result
}

$vk = Read-BoundedInt $A 255
if ($null -eq $vk -or ($AllowedVks -notcontains $vk)) { Fail "INPUT" }
if ($B -ne "0" -and $B -ne "1") { Fail "INPUT" }
if ($C -ne "0" -and $C -ne "1") { Fail "INPUT" }
if ($D -ne "0" -and $D -ne "1") { Fail "INPUT" }
$result = [DsbInput.Api]::KeyTap($vk, [int]$B, [int]$C, [int]$D)
if ($result -eq "OK") { Write-Result '{"ok":true}' 0 }
Fail $result
