# Install Cloud, then prove the installed window renders the real product inventory.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$rel = Join-Path $root 'cpp\release\v1.0pre8'
$prog = Join-Path $env:LOCALAPPDATA 'Programs\Infinity.Inc'
$d = Join-Path $prog 'Infinity Cloud'
if (Test-Path -LiteralPath $d) { Remove-Item -Recurse -Force $d }
Remove-Item -Recurse -Force (Join-Path $env:APPDATA 'infinity-shell') -ErrorAction SilentlyContinue
$out = Join-Path $PSScriptRoot 'qa-apps.json'
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }

$setup = Join-Path $rel 'InfinityCloud_1.0.0-pre8_win64_setup.exe'
$pr = Start-Process -FilePath $setup -ArgumentList '/S' -PassThru -Wait -WindowStyle Hidden
Write-Output ('install exit=' + $pr.ExitCode)
$exe = Join-Path $d 'inc_shell\inc_window.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "missing installed window: $exe" }
$env:INFINITY_SHELL_PROBE = '1'
$env:INFINITY_SHELL_PROBE_FILE = $out
$p = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
if (-not $p.WaitForExit(120000)) { $p.Kill(); throw 'probe timed out' }
if (-not (Test-Path -LiteralPath $out)) { throw 'no probe json' }
$j = [System.IO.File]::ReadAllText($out, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$keys = @($j.apps.PSObject.Properties.Name)
Write-Output ('apps=' + ($keys -join ','))
foreach ($k in $keys) { Write-Output ('  ' + $k + ' installed=' + $j.apps.$k.installed) }
$ok = ($keys.Count -ge 3) -and ($j.apps.inc.installed -eq $true) -and ($j.apps.ifm.installed -eq $false)
if (-not $ok) { Write-Output 'VIEWER-APPS FAIL'; exit 1 }

$u = Join-Path $d 'Uninstall.exe'
if (Test-Path -LiteralPath $u) {
  $pr = Start-Process -FilePath $u -ArgumentList '/S' -PassThru -Wait -WindowStyle Hidden
  Write-Output ('uninstall exit=' + $pr.ExitCode)
}
Start-Sleep -Seconds 2
if (Test-Path -LiteralPath $d) { Write-Output 'VIEWER-APPS FAIL (dir left)'; exit 1 }
Write-Output 'VIEWER-APPS PASS'
exit 0
