[Console]::OutputEncoding=[Text.Encoding]::UTF8
$ErrorActionPreference='Continue'
Set-Location 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
$root = Join-Path $env:LOCALAPPDATA 'Programs\Infinity.Inc'
$inc = Join-Path $root 'Infinity Cloud'
if (Test-Path $inc) { Remove-Item -Recurse -Force $inc -ErrorAction SilentlyContinue }
Remove-Item -Recurse -Force (Join-Path $env:APPDATA 'infinity-shell') -ErrorAction SilentlyContinue

$setup = Resolve-Path 'cpp\release\v1.0pre8\InfinityCloud_1.0.0-pre8_win64_setup.exe'
$p = Start-Process -WindowStyle Hidden -FilePath $setup -ArgumentList '/S' -PassThru -Wait
Write-Output ('install_exit=' + $p.ExitCode)
if (-not (Test-Path $inc)) { Write-Output 'VIEWER-INTERNAL FAIL not installed'; exit 1 }
$files = (Get-ChildItem $inc -Recurse -File).Count
$bytes = (Get-ChildItem $inc -Recurse -File | Measure-Object -Property Length -Sum).Sum
$mainJs = Join-Path $inc 'inc_shell\resources\app\main.js'
$uiJs = Join-Path $inc 'inc_shell\resources\app\ui\assets\js\shell.js'
$main = if (Test-Path $mainJs) { [System.IO.File]::ReadAllText($mainJs, [Text.Encoding]::UTF8) } else { '' }
$ui = if (Test-Path $uiJs) { [System.IO.File]::ReadAllText($uiJs, [Text.Encoding]::UTF8) } else { '' }
Write-Output ('cloud files=' + $files + ' bytes=' + $bytes)
Write-Output ('main.js bytes=' + $main.Length + ' internalProbe=' + $main.Contains('INFINITY_SHELL_PROBE_INTERNAL'))
Write-Output ('ui shell.js bytes=' + $ui.Length + ' buildInternal=' + $ui.Contains('function buildInternal') + ' aboutHistory=' + $ui.Contains('about:history'))

$out = Join-Path (Get-Location) 'work\viewer-internal-probe.json'
Remove-Item $out -ErrorAction SilentlyContinue
$env:INFINITY_SHELL_PROBE='1'
$env:INFINITY_SHELL_PROBE_INTERNAL='1'
$env:INFINITY_SHELL_PROBE_FILE=$out
$win = Join-Path $inc 'inc_shell\inc_window.exe'
$w = Start-Process -WindowStyle Hidden -FilePath $win -PassThru
$w.WaitForExit(120000) | Out-Null
Write-Output ('window_probe_exit=' + $w.ExitCode)
$good = $false
if (Test-Path $out) {
  $j = [System.IO.File]::ReadAllText($out, [Text.Encoding]::UTF8) | ConvertFrom-Json
  $i = $j.internal
  if ($i -and -not $i.error) {
    Write-Output ('history=' + @($i.history).Count + ' fav=' + $i.favBefore + '->' + $i.favAfter + ' collections=' + $i.collections + ' colTabs=' + $i.colTabs)
    Write-Output ('pages history=' + $i.historyPage.rows + ' favorites=' + $i.favoritesPage.rows + ' collections=' + $i.collectionsPage.rows)
    $good = (@($i.history).Count -ge 2) -and ($i.favAfter -eq ($i.favBefore + 1)) -and ($i.collections -ge 1) -and ($i.colTabs -ge 1) -and ($i.historyPage.rows -ge 2) -and ($i.favoritesPage.rows -ge 1) -and ($i.collectionsPage.rows -ge 1)
  } else { Write-Output ('probe error: ' + $i.error) }
} else { Write-Output 'no probe json' }

$un = Join-Path $inc 'Uninstall.exe'
if (Test-Path $un) { $u = Start-Process -WindowStyle Hidden -FilePath $un -ArgumentList '/S' -PassThru -Wait; Write-Output ('uninstall_exit=' + $u.ExitCode) }
Start-Sleep -Seconds 3
$left = Test-Path $inc
Write-Output ('dir_left=' + $left)
if ($good -and -not $left) { Write-Output 'VIEWER-INTERNAL PASS'; exit 0 }
Write-Output 'VIEWER-INTERNAL FAIL'
exit 1
