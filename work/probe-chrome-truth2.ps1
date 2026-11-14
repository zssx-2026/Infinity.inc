$ErrorActionPreference='Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'shell\build\inc_gui-win32-x64\inc_gui.exe'
$out = Join-Path $PSScriptRoot 'shell-chrome-truth2.json'
if (Test-Path $out) { Remove-Item $out -Force }
$env:INFINITY_SHELL_PROBE='1'; $env:INFINITY_SHELL_PROBE_FILE=$out
$env:INFINITY_SHELL_PROBE_QUERY='url=about:home'
$p = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
if (-not $p.WaitForExit(180000)) { $p.Kill(); throw 'timeout' }
$j = [System.IO.File]::ReadAllText($out,[System.Text.Encoding]::UTF8) | ConvertFrom-Json
Write-Output ('menuVersion=' + $j.menuVersion + ' hostPill=' + $j.hostPill)
Write-Output ('ntpNodes=' + $j.ntpNodes + ' ntpFootNodes=' + $j.ntpFootNodes)
Write-Output ('ntpFooter=' + $j.ntpFooter)
Write-Output ('body=' + $j.bodyText)
