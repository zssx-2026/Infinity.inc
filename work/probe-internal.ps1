# INFINITY_SHELL_PROBE_INTERNAL: history / favorites / collections pages must carry real rows.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'shell\build\inc_gui-win32-x64\inc_gui.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "missing shell: $exe" }
# The shell needs <prefix>_cli.exe beside it; rebuilding shell/build wipes that copy.
$cli = $exe -replace 'inc_gui\.exe$', 'inc_cli.exe'
Write-Output ('cli=' + $cli)
if (-not (Test-Path -LiteralPath $cli)) {
  $src = Join-Path $root 'cpp\out\inc\inc_cli.exe'
  if (-not (Test-Path -LiteralPath $src)) { throw "missing cli: $src" }
  Copy-Item -LiteralPath $src -Destination $cli -Force
}
$out = Join-Path $PSScriptRoot 'shell-internal.json'
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
Remove-Item -Recurse -Force (Join-Path $env:APPDATA 'infinity-shell') -ErrorAction SilentlyContinue
$env:INFINITY_SHELL_PROBE = '1'
$env:INFINITY_SHELL_PROBE_INTERNAL = '1'
$env:INFINITY_SHELL_PROBE_FILE = $out
$p = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
if (-not $p.WaitForExit(90000)) { $p.Kill(); throw 'probe timed out' }
Write-Output ('probe_exit=' + $p.ExitCode)
if (-not (Test-Path -LiteralPath $out)) { throw 'no probe json' }
$j = [System.IO.File]::ReadAllText($out, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$i = $j.internal
if (-not $i) { throw 'no internal section' }
if ($i.error) { throw ('probe error: ' + $i.error) }
Write-Output ('history_entries=' + @($i.history).Count)
Write-Output ('history_urls=' + (@($i.history) -join ','))
Write-Output ('fav=' + $i.favBefore + '->' + $i.favAfter + ' collections=' + $i.collections + ' colTabs=' + $i.colTabs)
Write-Output ('history_page rows=' + $i.historyPage.rows + ' title=' + $i.historyPage.title + ' count=' + $i.historyPage.count)
Write-Output ('favorites_page rows=' + $i.favoritesPage.rows + ' collections_page rows=' + $i.collectionsPage.rows)
# One collection tab is the honest number here: the probe navigates the same tab twice,
# so a saved collection of the window holds exactly one entry.
$ok = (@($i.history).Count -ge 2) -and ($i.favAfter -eq ($i.favBefore + 1)) -and ($i.collections -ge 1) -and ($i.colTabs -ge 1) -and ($i.historyPage.page) -and ($i.historyPage.rows -ge 2) -and ($i.favoritesPage.rows -ge 1) -and ($i.collectionsPage.rows -ge 1)
if (-not $ok) { Write-Output 'INTERNAL-PAGES FAIL'; exit 1 }
Write-Output 'INTERNAL-PAGES PASS'
exit 0
