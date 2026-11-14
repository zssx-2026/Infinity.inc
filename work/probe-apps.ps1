# INFINITY_SHELL_PROBE_APPS: an app card must start the real product, not show a sample.
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
$out = Join-Path $PSScriptRoot 'shell-apps.json'
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
Remove-Item -Recurse -Force (Join-Path $env:APPDATA 'infinity-shell') -ErrorAction SilentlyContinue
$env:INFINITY_SHELL_PROBE = '1'
$env:INFINITY_SHELL_PROBE_APPS = '1'
$env:INFINITY_SHELL_PROBE_FILE = $out
$p = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
if (-not $p.WaitForExit(120000)) { $p.Kill(); throw 'probe timed out' }
Write-Output ('probe_exit=' + $p.ExitCode)
if (-not (Test-Path -LiteralPath $out)) { throw 'no probe json' }
$j = [System.IO.File]::ReadAllText($out, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$a = $j.apps
if (-not $a) { throw 'no apps section' }
if ($a.error) { throw ('probe error: ' + $a.error) }
Write-Output ('app=' + $a.app + ' url=' + $a.url + ' tabKind=' + $a.tabKind + ' webviews=' + $a.webviews + ' procAlive=' + $a.procAlive + ' error=' + $a.error)
$ok = ($a.url -like 'http://127.0.0.1:*') -and ($a.tabUrl -eq $a.url) -and ($a.tabKind -eq 'web') -and ($a.webviews -ge 1) -and ($a.procAlive)
if (-not $ok) { Write-Output 'APPS-LAUNCH FAIL'; exit 1 }
Write-Output 'APPS-LAUNCH PASS'
exit 0
