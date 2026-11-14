# Install Cloud + Toolbox, then prove Cloud's app card starts the installed Toolbox.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$rel = Join-Path $root 'cpp\release\v1.0pre8'
$prog = Join-Path $env:LOCALAPPDATA 'Programs\Infinity.Inc'
foreach ($d in @('Infinity Cloud','Infinity Toolbox')) {
  $p = Join-Path $prog $d
  if (Test-Path -LiteralPath $p) { Remove-Item -Recurse -Force $p }
}
Remove-Item -Recurse -Force (Join-Path $env:APPDATA 'infinity-shell') -ErrorAction SilentlyContinue
$out = Join-Path $PSScriptRoot 'qa-apps.json'
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }

$setupCloud = Join-Path $rel 'InfinityCloud_1.0.0-pre8_win64_setup.exe'
$setupToolbox = Join-Path $rel 'InfinityToolbox_1.0.0-pre8_win64_setup.exe'
foreach ($s in @($setupCloud, $setupToolbox)) {
  $pr = Start-Process -FilePath $s -ArgumentList '/S' -PassThru -Wait -WindowStyle Hidden
  Write-Output ('install ' + (Split-Path -Leaf $s) + ' exit=' + $pr.ExitCode)
}

$exe = Join-Path $prog 'Infinity Cloud\inc_shell\inc_window.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "missing installed window: $exe" }
$env:INFINITY_SHELL_PROBE = '1'
$env:INFINITY_SHELL_PROBE_APPS = '1'
$env:INFINITY_SHELL_PROBE_FILE = $out
$p = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
if (-not $p.WaitForExit(150000)) { $p.Kill(); throw 'probe timed out' }
Write-Output ('probe_exit=' + $p.ExitCode)
if (-not (Test-Path -LiteralPath $out)) { throw 'no probe json' }
$j = [System.IO.File]::ReadAllText($out, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$a = $j.apps
if (-not $a) { throw 'no apps section' }
if ($a.error) { throw ('probe error: ' + $a.error) }
Write-Output ('app=' + $a.app + ' url=' + $a.url + ' tabKind=' + $a.tabKind + ' webviews=' + $a.webviews + ' procAlive=' + $a.procAlive + ' error=' + $a.error)
$ok = ($a.url -like 'http://127.0.0.1:*') -and ($a.tabUrl -eq $a.url) -and ($a.tabKind -eq 'web') -and ($a.webviews -ge 1) -and ($a.procAlive)
if (-not $ok) { Write-Output 'VIEWER-APPS FAIL'; exit 1 }

foreach ($d in @('Infinity Cloud','Infinity Toolbox')) {
  $u = Join-Path $prog ($d + '\Uninstall.exe')
  if (Test-Path -LiteralPath $u) {
    $pr = Start-Process -FilePath $u -ArgumentList '/S' -PassThru -Wait -WindowStyle Hidden
    Write-Output ('uninstall ' + $d + ' exit=' + $pr.ExitCode)
  }
}
Start-Sleep -Seconds 2
$left = @()
foreach ($d in @('Infinity Cloud','Infinity Toolbox')) { if (Test-Path -LiteralPath (Join-Path $prog $d)) { $left += $d } }
Write-Output ('left=' + ($left -join ','))
if ($left.Count -gt 0) { Write-Output 'VIEWER-APPS FAIL'; exit 1 }
Write-Output 'VIEWER-APPS PASS'
exit 0
