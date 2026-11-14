$ErrorActionPreference='Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'shell\build\inc_gui-win32-x64\inc_gui.exe'
$out = Join-Path $PSScriptRoot 'shell-chrome-nohook.json'
if (Test-Path $out) { Remove-Item $out -Force }
$env:INFINITY_SHELL_PROBE='1'; $env:INFINITY_SHELL_PROBE_FILE=$out; $env:INFINITY_SHELL_PROBE_NTP='0'
$p = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
if (-not $p.WaitForExit(120000)) { $p.Kill(); Write-Output 'HANG'; exit 2 }
if (-not (Test-Path $out)) { Write-Output 'NO-JSON'; exit 3 }
$j = [System.IO.File]::ReadAllText($out,[System.Text.Encoding]::UTF8) | ConvertFrom-Json
Write-Output ('menuVersion=' + $j.menuVersion + ' ntpNodes=' + $j.ntpNodes + ' tabCount=' + $j.tabCount)
Write-Output ('body=' + $j.bodyText)
