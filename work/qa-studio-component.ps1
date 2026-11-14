[Console]::OutputEncoding=[Text.Encoding]::UTF8
$ErrorActionPreference='Continue'
$setup = 'cpp\release\v1.0pre8\InfinityStudio_1.0.0-pre8_win64_setup.exe'
$root = Join-Path $env:LOCALAPPDATA 'Programs\Infinity.Inc'
foreach ($name in @('Infinity Studio','Infinity Cloud','Infinity Server')) {
  $dir = Join-Path $root $name
  if (Test-Path $dir) { Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue }
}
$cache = Join-Path $env:LOCALAPPDATA 'Infinity\Studio'
if (Test-Path $cache) { Remove-Item -Recurse -Force $cache -ErrorAction SilentlyContinue }

$p = Start-Process -WindowStyle Hidden -FilePath (Resolve-Path $setup) -ArgumentList '/S' -PassThru -Wait
Write-Output ('install_exit=' + $p.ExitCode)
$studio = Join-Path $root 'Infinity Studio'
$cli = Join-Path $studio 'resources\app\src\cli.js'
if (-not (Test-Path $cli)) { Write-Output 'STUDIO-COMPONENT FAIL no cli.js in install'; exit 1 }

$node = (Get-Command node).Source
$proc = Start-Process -WindowStyle Hidden -FilePath $node -ArgumentList @(('"' + $cli + '"'), '7799') -PassThru -RedirectStandardOutput work\studio-cli-out.log -RedirectStandardError work\studio-cli-err.log
Start-Sleep -Seconds 6
Write-Output ('cli_alive=' + (-not $proc.HasExited))
node work\qa-studio-headless.mjs 7799 InfinityCloud-setup
Write-Output ('qa_exit=' + $LASTEXITCODE)
try { $proc.Kill() } catch { }
Start-Sleep -Seconds 1

$inc = Join-Path $root 'Infinity Cloud'
if (-not (Test-Path $inc)) { Write-Output 'STUDIO-COMPONENT FAIL component not installed'; exit 1 }
$files = (Get-ChildItem $inc -Recurse -File).Count
$bytes = (Get-ChildItem $inc -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Output ('component files=' + $files + ' bytes=' + $bytes)
$cliExe = Join-Path $inc 'inc_cli.exe'
$winExe = Join-Path $inc 'inc_shell\inc_window.exe'
$shellMain = Join-Path $inc 'inc_shell\resources\app\main.js'
$shellDl = Join-Path $inc 'inc_shell\resources\app\downloads.js'
Write-Output ('has cli=' + (Test-Path $cliExe) + ' window=' + (Test-Path $winExe) + ' main.js=' + (Test-Path $shellMain) + ' downloads.js=' + (Test-Path $shellDl))
$viewer = $false
if (Test-Path $shellMain) {
  $raw = Get-Content $shellMain -Raw
  $viewer = $raw.Contains('InfinityViewer')
  Write-Output ('shell bytes=' + $raw.Length + ' InfinityViewer=' + $viewer)
}
$pass = (Test-Path $shellMain) -and $viewer -and (Test-Path $shellDl) -and (Test-Path $cliExe)
$un = Join-Path $inc 'Uninstall.exe'
if (Test-Path $un) { $u = Start-Process -WindowStyle Hidden -FilePath $un -ArgumentList '/S' -PassThru -Wait; Write-Output ('component_uninstall_exit=' + $u.ExitCode) }
$un2 = Join-Path $studio 'Uninstall.exe'
if (Test-Path $un2) { $u2 = Start-Process -WindowStyle Hidden -FilePath $un2 -ArgumentList '/S' -PassThru -Wait; Write-Output ('studio_uninstall_exit=' + $u2.ExitCode) }
$clean = -not (Test-Path $inc) -and -not (Test-Path $studio)
Write-Output ('studio_dir_left=' + (Test-Path $studio) + ' component_dir_left=' + (Test-Path $inc))
$pass = $pass -and $clean
Write-Output ('STUDIO-COMPONENT ' + $(if ($pass) { 'PASS' } else { 'FAIL' }))
exit $(if ($pass) { 0 } else { 1 })
