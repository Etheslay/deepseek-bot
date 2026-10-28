# Acceptance-only visible synthetic window. Never launches capture code.
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^dsb-screen-[0-9a-fA-F-]{36}$')]
  [string] $Title
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object System.Windows.Forms.Form
$form.Text = $Title
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedSingle
$form.MaximizeBox = $false
$form.ClientSize = New-Object System.Drawing.Size(760, 300)
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.Location = New-Object System.Drawing.Point(40, 40)
$form.BackColor = [System.Drawing.Color]::White
$label = New-Object System.Windows.Forms.Label
$label.Text = "HELLO LOCAL OCR 12345`r`nPUBLIC SYNTHETIC TEST WINDOW"
$label.Font = New-Object System.Drawing.Font('Arial', 26, [System.Drawing.FontStyle]::Bold)
$label.ForeColor = [System.Drawing.Color]::Black
$label.AutoSize = $true
$label.Location = New-Object System.Drawing.Point(20, 60)
$form.Controls.Add($label)
try {
  $form.Show()
  $form.Activate()
  [System.Windows.Forms.Application]::DoEvents()
  $identity = @{
    title = $Title
    hwnd = $form.Handle.ToInt64().ToString([System.Globalization.CultureInfo]::InvariantCulture)
    pid = $PID
    processStartTime = [System.Diagnostics.Process]::GetCurrentProcess().StartTime.ToUniversalTime().ToFileTimeUtc().ToString([System.Globalization.CultureInfo]::InvariantCulture)
  }
  [Console]::Out.WriteLine(($identity | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  while ($form.Visible) {
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 40
  }
} finally {
  $form.Dispose()
}
