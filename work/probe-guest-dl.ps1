[Console]::OutputEncoding=[Text.Encoding]::UTF8
Set-Location 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
$dir = 'shell\build\inc_gui-win32-x64'
if (-not (Test-Path (Join-Path $dir 'inc_cli.exe'))) { Copy-Item 'cpp\out\inc\inc_cli.exe' -Destination $dir -Force }
$env:INFINITY_SHELL_PROBE='1'
$env:INFINITY_SHELL_PROBE_GUEST_DL='1'
$env:INFINITY_SHELL_PROBE_FILE=(Join-Path (Get-Location) 'work\shell-guest-dl.json')
$env:INFINITY_SHELL_PROBE_PNG=(Join-Path (Get-Location) 'work\shell-guest-dl.png')
Remove-Item work\shell-guest-dl.json -ErrorAction SilentlyContinue
$p = Start-Process -WindowStyle Hidden -FilePath (Join-Path $dir 'inc_gui.exe') -PassThru
$p.WaitForExit(120000) | Out-Null
Write-Output ('probe_exit=' + $p.ExitCode)
if (Test-Path work\shell-guest-dl.json) {
  $raw = [System.IO.File]::ReadAllText((Join-Path (Get-Location) 'work\shell-guest-dl.json'), [Text.Encoding]::UTF8)
  $j = $raw | ConvertFrom-Json
  Write-Output ('guestDownload items=' + $j.guestDownload.items + ' names=' + ($j.guestDownload.names -join ',') + ' bytes=' + ($j.guestDownload.bytes -join ','))
  Write-Output ('text=' + $j.guestDownload.text)
} else { 'no probe json' }
