[Console]::OutputEncoding=[Text.Encoding]::UTF8
$ErrorActionPreference='Continue'
Set-Location 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
$root = Join-Path $env:LOCALAPPDATA 'Programs\Infinity.Inc'
foreach ($n in @('Infinity Studio','Infinity Cloud','Infinity Server')) {
  $d = Join-Path $root $n
  if (Test-Path $d) { Remove-Item -Recurse -Force $d -ErrorAction SilentlyContinue }
}
$cache = Join-Path $env:LOCALAPPDATA 'Infinity\Studio'
if (Test-Path $cache) { Remove-Item -Recurse -Force $cache -ErrorAction SilentlyContinue }

$p = Start-Process -WindowStyle Hidden -FilePath (Resolve-Path 'cpp\release\v1.0pre8\InfinityStudio_1.0.0-pre8_win64_setup.exe') -ArgumentList '/S' -PassThru -Wait
Write-Output ('studio_install_exit=' + $p.ExitCode)
$studio = Join-Path $root 'Infinity Studio'
$cli = Join-Path $studio 'resources\app\src\cli.js'
$node = (Get-Command node).Source
$proc = Start-Process -WindowStyle Hidden -FilePath $node -ArgumentList @(('"' + $cli + '"'), '7811') -PassThru -RedirectStandardOutput work\viewer-web-out.log -RedirectStandardError work\viewer-web-err.log
Start-Sleep -Seconds 6
$body = '{"ids":["InfinityCloud-setup"]}'
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:7811/v1/remote/install' -ContentType 'application/json' -Body $body | Out-Null
$phase=''
for ($i=0; $i -lt 420; $i++) {
  Start-Sleep -Seconds 1
  $st = Invoke-RestMethod -Uri 'http://127.0.0.1:7811/v1/remote/state'
  $s = if ($st.state) { $st.state } else { $st }
  $phase = $s.phase
  if ($phase -eq 'done' -or $phase -eq 'failed') { break }
}
Write-Output ('install_phase=' + $phase)
try { $proc.Kill() } catch { }
Start-Sleep -Seconds 1

$inc = Join-Path $root 'Infinity Cloud'
if (-not (Test-Path $inc)) { Write-Output 'VIEWER-WEB FAIL cloud not installed'; exit 1 }
$files = (Get-ChildItem $inc -Recurse -File).Count
$bytes = (Get-ChildItem $inc -Recurse -File | Measure-Object -Property Length -Sum).Sum
$mainJs = Join-Path $inc 'inc_shell\resources\app\main.js'
$uiJs = Join-Path $inc 'inc_shell\resources\app\ui\assets\js\shell.js'
$raw = if (Test-Path $mainJs) { Get-Content $mainJs -Raw } else { '' }
$ui = if (Test-Path $uiJs) { Get-Content $uiJs -Raw } else { '' }
Write-Output ('cloud files=' + $files + ' bytes=' + $bytes)
Write-Output ('main.js bytes=' + $raw.Length + ' webviewTag=' + $raw.Contains('webviewTag: true') + ' probeWeb=' + $raw.Contains('INFINITY_SHELL_PROBE_WEB'))
Write-Output ('shell.js bytes=' + $ui.Length + ' buildWebview=' + $ui.Contains('function buildWebview') + ' bing=' + $ui.Contains('www.bing.com/search'))

$env:INFINITY_SHELL_PROBE='1'
$env:INFINITY_SHELL_PROBE_WEB='1'
$env:INFINITY_SHELL_PROBE_FILE=(Join-Path (Get-Location) 'work\viewer-web-probe.json')
Remove-Item work\viewer-web-probe.json -ErrorAction SilentlyContinue
$win = Join-Path $inc 'inc_shell\inc_window.exe'
$w = Start-Process -WindowStyle Hidden -FilePath $win -PassThru
$w.WaitForExit(90000) | Out-Null
Write-Output ('window_probe_exit=' + $w.ExitCode)
if (Test-Path work\viewer-web-probe.json) {
  $rawJson = [System.IO.File]::ReadAllText((Join-Path (Get-Location) 'work\viewer-web-probe.json'), [Text.Encoding]::UTF8)
  $j = $rawJson | ConvertFrom-Json
  Write-Output ('probe webviews=' + $j.web.webviews + ' title=' + $j.web.title + ' kind=' + $j.web.kind)
  Write-Output ('probe search=' + $j.web.search.url)
  $good = ($j.web.webviews -eq 1) -and ($j.web.kind -eq 'web') -and ($j.web.search.url -like 'https://www.bing.com/search?q=*')
} else { $good = $false; Write-Output 'no probe json' }

$un = Join-Path $inc 'Uninstall.exe'
if (Test-Path $un) { $u = Start-Process -WindowStyle Hidden -FilePath $un -ArgumentList '/S' -PassThru -Wait; Write-Output ('cloud_uninstall_exit=' + $u.ExitCode) }
$un2 = Join-Path $studio 'Uninstall.exe'
if (Test-Path $un2) { $u2 = Start-Process -WindowStyle Hidden -FilePath $un2 -ArgumentList '/S' -PassThru -Wait; Write-Output ('studio_uninstall_exit=' + $u2.ExitCode) }
Start-Sleep -Seconds 3
$left = (Test-Path $inc) -or (Test-Path $studio)
Write-Output ('dirs_left=' + $left)
if ($good -and -not $left) { Write-Output 'VIEWER-WEB PASS'; exit 0 }
Write-Output 'VIEWER-WEB FAIL'
exit 1
