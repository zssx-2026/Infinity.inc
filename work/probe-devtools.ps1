# INFINITY_SHELL_PROBE_DEVTOOLS: F12 must reach the host's real inspector, not a fake panel.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'shell\build\inc_gui-win32-x64\inc_gui.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "missing shell: $exe" }
$cli = $exe -replace 'inc_gui\.exe$', 'inc_cli.exe'
if (-not (Test-Path -LiteralPath $cli)) {
  $src = Join-Path $root 'cpp\out\inc\inc_cli.exe'
  if (-not (Test-Path -LiteralPath $src)) { throw "missing cli: $src" }
  Copy-Item -LiteralPath $src -Destination $cli -Force
}
$out = Join-Path $PSScriptRoot 'shell-devtools.json'
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
Remove-Item -Recurse -Force (Join-Path $env:APPDATA 'infinity-shell') -ErrorAction SilentlyContinue
$env:INFINITY_SHELL_PROBE = '1'
$env:INFINITY_SHELL_PROBE_DEVTOOLS = '1'
$env:INFINITY_SHELL_PROBE_FILE = $out
$p = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
if (-not $p.WaitForExit(120000)) { $p.Kill(); throw 'probe timed out' }
Write-Output ('probe_exit=' + $p.ExitCode)
if (-not (Test-Path -LiteralPath $out)) { throw 'no probe json' }
$j = [System.IO.File]::ReadAllText($out, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$d = $j.devtools
if (-not $d) { throw 'no devtools section' }
if ($d.error) { throw ('probe error: ' + $d.error) }
Write-Output ('devtools open=' + $d.open + ' target=' + $d.target + ' error=' + $d.error)
$ok = ($d.open -eq $false) -and ($d.target -eq 'shell' -or $d.target -eq 'webview') -and (-not $d.error)
if (-not $ok) { Write-Output 'DEVTOOLS-BRIDGE FAIL'; exit 1 }
Write-Output 'DEVTOOLS-BRIDGE PASS'
exit 0
