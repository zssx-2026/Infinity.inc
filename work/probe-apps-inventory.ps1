$ErrorActionPreference='Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'shell\build\inc_gui-win32-x64\inc_gui.exe'
$cli = $exe -replace 'inc_gui\.exe$','inc_cli.exe'
if (-not (Test-Path -LiteralPath $cli)) { Copy-Item (Join-Path $root 'cpp\out\inc\inc_cli.exe') $cli -Force }
$out = Join-Path $PSScriptRoot 'shell-apps-inventory.json'
if (Test-Path $out) { Remove-Item $out -Force }
Remove-Item -Recurse -Force (Join-Path $env:APPDATA 'infinity-shell') -ErrorAction SilentlyContinue
$env:INFINITY_SHELL_PROBE='1'; $env:INFINITY_SHELL_PROBE_FILE=$out
$p = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
if (-not $p.WaitForExit(120000)) { $p.Kill(); throw 'timeout' }
$j = [System.IO.File]::ReadAllText($out,[System.Text.Encoding]::UTF8) | ConvertFrom-Json
$keys = ($j.apps.PSObject.Properties.Name -join ',')
Write-Output ('apps=' + $keys)
foreach ($k in $j.apps.PSObject.Properties.Name) { Write-Output ('  ' + $k + ' installed=' + $j.apps.$k.installed + ' url=' + $j.apps.$k.url) }
if (-not $keys) { Write-Output 'APPS-INVENTORY FAIL'; exit 1 }
Write-Output 'APPS-INVENTORY PASS'
