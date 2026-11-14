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
# The installed chrome must honour the accelerators its menu prints, so the
# probe presses them in the packaged build rather than only in the dev tree.
$env:INFINITY_SHELL_PROBE_KEYS = '1'
# The packaged About box and exit dialog must also stop describing a shell that
# is not there: read them from the installed window, not just the dev tree.
$env:INFINITY_SHELL_PROBE_ABOUT = '1'
$env:INFINITY_SHELL_PROBE_EXIT = '1'
$p = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
if (-not $p.WaitForExit(120000)) { $p.Kill(); throw 'probe timed out' }
if (-not (Test-Path -LiteralPath $out)) { throw 'no probe json' }
$j = [System.IO.File]::ReadAllText($out, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$keys = @($j.apps.PSObject.Properties.Name)
Write-Output ('apps=' + ($keys -join ','))
foreach ($k in $keys) { Write-Output ('  ' + $k + ' installed=' + $j.apps.$k.installed) }
Write-Output ('keys ctrlJOpens=' + $j.keyProbe.ctrlJOpens + ' ctrlJCloses=' + $j.keyProbe.ctrlJCloses + ' ctrlHKind=' + $j.keyProbe.ctrlHKind)
Write-Output ('about version=' + $j.aboutProbe.version + ' host=' + $j.aboutProbe.host + ' apps=' + $j.aboutProbe.apps + ' shell=' + $j.aboutProbe.shell + ' visible=' + $j.aboutProbe.visible)
Write-Output ('about hostTitle=' + $j.aboutProbe.hostTitle)
Write-Output ('exit visible=' + $j.exitProbe.visible + ' sidebarOff=' + $j.exitProbe.sidebarOff + ' body=' + $j.exitProbe.body)
$ok = ($j.aboutProbe.version -eq 'v1.0.0') -and ($j.aboutProbe.host -notmatch 'postMessage') -and ($j.aboutProbe.hostTitle -match 'postMessage') -and ($j.aboutProbe.apps -eq 'INC') -and ($j.aboutProbe.visible -eq $true) -and ($j.aboutProbe.shell -match 'Electron') -and ($j.exitProbe.visible -eq $true) -and ($j.exitProbe.sidebarOff -ge 1) -and ($j.exitProbe.body -match '\u4e0d\u4f1a\u81ea\u52a8\u6062\u590d') -and ($j.exitProbe.bodyEn -match 'Restore session') -and ($keys.Count -ge 3) -and ($j.apps.inc.installed -eq $true) -and ($j.apps.ifm.installed -eq $false) -and ($j.keyProbe.ctrlJOpens -eq $true) -and ($j.keyProbe.ctrlJCloses -eq $true) -and ($j.keyProbe.ctrlHHistory -eq $true)
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