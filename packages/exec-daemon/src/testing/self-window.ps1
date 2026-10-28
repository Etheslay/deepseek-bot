# Test-only visible window. The capture helper never launches this script.
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidatePattern('^dsb-screen-[0-9a-fA-F-]{36}$')]
  [string] $Title
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
# Console.In.ReadLineAsync can synchronously block on .NET Framework. Keep all
# input reads on a background thread so the owned window continues repainting.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Threading;
public static class DsbSelfWindowInput {
  static readonly ConcurrentQueue<string> Commands = new ConcurrentQueue<string>();
  public static void Start() {
    Thread reader = new Thread(delegate() {
      string line;
      while ((line = Console.In.ReadLine()) != null) Commands.Enqueue(line);
    });
    reader.IsBackground = true;
    reader.Start();
  }
  public static string Poll() {
    string line;
    return Commands.TryDequeue(out line) ? line : null;
  }
}
'@
[DsbSelfWindowInput]::Start()
$form = New-Object System.Windows.Forms.Form
$form.Text = $Title
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedSingle
$form.ClientSize = New-Object System.Drawing.Size(400, 240)
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.Location = New-Object System.Drawing.Point(40, 40)
$label = New-Object System.Windows.Forms.Label
$label.Text = "DSB"
$label.AutoSize = $true
$label.Location = New-Object System.Drawing.Point(24, 24)
$form.Controls.Add($label)
$form.Show()
[Console]::Out.WriteLine("ready")
[Console]::Out.Flush()
while ($form.Visible) {
  [System.Windows.Forms.Application]::DoEvents()
  # Read only test-owned stdin commands; no user windows are changed.
  $line = [DsbSelfWindowInput]::Poll()
  if ($line -eq "minimize") {
    $form.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
    [System.Windows.Forms.Application]::DoEvents()
    [Console]::Out.WriteLine("minimized")
    [Console]::Out.Flush()
  }
  Start-Sleep -Milliseconds 40
}
$form.Dispose()
