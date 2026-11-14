# Install Cloud, then prove its F12 reaches the host's real inspector (closed, never opened).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$rel = Join-Path $root 'cpp\release\v1.0pre8'
$prog = Join-Path $env:LOCALAPPDATA 'Programs\Infinity.Inc'
$d = Join-Path $prog 'Infinity Cloud'
if (Test-Path -LiteralPath $d) { Remove-Item -Recurse -Force $d }
Remove-Item -Recurse -Force (Join-Path $env:APPDATA 'infinity-shell') -ErrorAction SilentlyContinue
$out = Join-Path $PSScriptRoot 'qa-devtools.json'
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }

$setup = Join-Path $rel 'InfinityCloud_1.0.0-pre8_win64_setup.exe'
$pr = Start-Process -FilePath $setup -ArgumentList '/S' -PassThru -Wait -WindowStyle Hidden
Write-Output ('install exit=' + $pr.ExitCode)
$exe = Join-Path $d 'inc_shell\inc_window.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "missing installed window: $exe" }
$env:INFINITY_SHELL_PROBE = '1'
$env:INFINITY_SHELL_PROBE_DEVTOOLS = '1'
$env:INFINITY_SHELL_PROBE_FILE = $out
$p = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
if (-not $p.WaitForExit(120000)) { $p.Kill(); throw 'probe timed out' }
Write-Output ('probe_exit=' + $p.ExitCode)
if (-not (Test-Path -LiteralPath $out)) { throw 'no probe json' }
$j = [System.IO.File]::ReadAllText($out, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$t = $j.devtools
if (-not $t) { throw 'no devtools section' }
if ($t.error) { throw ('probe error: ' + $t.error) }
Write-Output ('devtools open=' + $t.open + ' target=' + $t.target + ' error=' + $t.error)
$ok = ($t.open -eq $false) -and ($t.target -eq 'shell' -or $t.target -eq 'webview')
if (-not $ok) { Write-Output 'VIEWER-DEVTOOLS FAIL'; exit 1 }

$u = Join-Path $d 'Uninstall.exe'
if (Test-Path -LiteralPath $u) {
  $pr = Start-Process -FilePath $u -ArgumentList '/S' -PassThru -Wait -WindowStyle Hidden
  Write-Output ('uninstall exit=' + $pr.ExitCode)
}
Start-Sleep -Seconds 2
if (Test-Path -LiteralPath $d) { Write-Output 'VIEWER-DEVTOOLS FAIL (dir left)'; exit 1 }
Write-Output 'VIEWER-DEVTOOLS PASS'
exit 0
