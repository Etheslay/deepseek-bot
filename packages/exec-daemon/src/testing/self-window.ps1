# Test-only visible window. The capture helper never launches this script.
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidatePattern('^dsb-screen-[0-9a-fA-F-]{36}$')]
  [string] $Title
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
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
  Start-Sleep -Milliseconds 40
}
