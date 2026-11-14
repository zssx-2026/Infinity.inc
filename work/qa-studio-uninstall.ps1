[Console]::OutputEncoding=[Text.Encoding]::UTF8
$ErrorActionPreference='Continue'
Set-Location 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
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
if (-not (Test-Path $cli)) { Write-Output 'STUDIO-UNINSTALL FAIL no cli.js'; exit 1 }
$node = (Get-Command node).Source
$proc = Start-Process -WindowStyle Hidden -FilePath $node -ArgumentList @(('"' + $cli + '"'), '7801') -PassThru -RedirectStandardOutput work\studio-un-out.log -RedirectStandardError work\studio-un-err.log
Start-Sleep -Seconds 6
Write-Output ('cli_alive=' + (-not $proc.HasExited))
node work\qa-studio-uninstall.mjs 7801 InfinityCloud-setup
$qa = $LASTEXITCODE
Write-Output ('qa_exit=' + $qa)
try { $proc.Kill() } catch { }
Start-Sleep -Seconds 1
$un = Join-Path $studio 'Uninstall.exe'
if (Test-Path $un) { $u = Start-Process -WindowStyle Hidden -FilePath $un -ArgumentList '/S' -PassThru -Wait; Write-Output ('studio_uninstall_exit=' + $u.ExitCode) }
Start-Sleep -Seconds 3
$left = (Test-Path (Join-Path $root 'Infinity Studio')) -or (Test-Path (Join-Path $root 'Infinity Cloud'))
Write-Output ('dirs_left=' + $left)
if (($qa -eq 0) -and (-not $left)) { Write-Output 'STUDIO-UNINSTALL-CHANNEL PASS'; exit 0 }
Write-Output 'STUDIO-UNINSTALL-CHANNEL FAIL'
exit 1
