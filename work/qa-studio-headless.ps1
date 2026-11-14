[Console]::OutputEncoding=[Text.Encoding]::UTF8
$ErrorActionPreference='Continue'
$setup = 'cpp\release\v1.0pre8\InfinityStudio_1.0.0-pre8_win64_setup.exe'
$root = Join-Path $env:LOCALAPPDATA 'Programs\Infinity.Inc'
foreach ($name in @('Infinity Studio','Infinity Server')) {
  $dir = Join-Path $root $name
  if (Test-Path $dir) { Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue }
}
$cache = Join-Path $env:LOCALAPPDATA 'Infinity\Studio'
if (Test-Path $cache) { Remove-Item -Recurse -Force $cache -ErrorAction SilentlyContinue }

$p = Start-Process -WindowStyle Hidden -FilePath (Resolve-Path $setup) -ArgumentList '/S' -PassThru -Wait
Write-Output ('install_exit=' + $p.ExitCode)
$studio = Join-Path $root 'Infinity Studio'
$cli = Join-Path $studio 'resources\app\src\cli.js'
if (-not (Test-Path $cli)) { Write-Output 'STUDIO-HEADLESS FAIL no cli.js in install'; exit 1 }
$files = (Get-ChildItem $studio -Recurse -File).Count
$bytes = (Get-ChildItem $studio -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Output ('installed files=' + $files + ' bytes=' + $bytes)
$remoteSrc = Join-Path $studio 'resources\app\src\remote.js'
if (Test-Path $remoteSrc) {
  $raw = Get-Content $remoteSrc -Raw
  $stall = ([regex]::Matches($raw, 'STALL_MS')).Count
  $mirror = ([regex]::Matches($raw, 'mirror')).Count
  $par = ([regex]::Matches($raw, 'PARALLEL_CONNECTIONS')).Count
  Write-Output ('staged remote.js bytes=' + $raw.Length + ' stall=' + $stall + ' mirror=' + $mirror + ' parallel=' + $par)
  if ($stall -lt 2 -or $mirror -lt 1) { Write-Output 'STUDIO-HEADLESS FAIL staged code is not the final build'; exit 1 }
} else {
  Write-Output 'STUDIO-HEADLESS FAIL no remote.js in install'; exit 1
}

$node = (Get-Command node).Source
$proc = Start-Process -WindowStyle Hidden -FilePath $node -ArgumentList @(('"' + $cli + '"'), '7799') -PassThru -RedirectStandardOutput work\studio-cli-out.log -RedirectStandardError work\studio-cli-err.log
Start-Sleep -Seconds 6
Write-Output ('cli_alive=' + (-not $proc.HasExited))
node work\qa-studio-headless.mjs 7799 InfinityServer-setup
Write-Output ('qa_exit=' + $LASTEXITCODE)
Write-Output '--- cli out ---'
Get-Content work\studio-cli-out.log -ErrorAction SilentlyContinue | Select-Object -Last 5
Write-Output '--- cli err ---'
Get-Content work\studio-cli-err.log -ErrorAction SilentlyContinue | Select-Object -Last 10
try { $proc.Kill() } catch { }
Start-Sleep -Seconds 1

$server = Join-Path $root 'Infinity Server'
if (Test-Path $server) {
  $sFiles = (Get-ChildItem $server -Recurse -File).Count
  $sBytes = (Get-ChildItem $server -Recurse -File | Measure-Object -Property Length -Sum).Sum
  Write-Output ('server files=' + $sFiles + ' bytes=' + $sBytes)
  $un = Join-Path $server 'Uninstall.exe'
  if (Test-Path $un) { $u = Start-Process -WindowStyle Hidden -FilePath $un -ArgumentList '/S' -PassThru -Wait; Write-Output ('server_uninstall_exit=' + $u.ExitCode) }
} else {
  Write-Output 'server NOT installed'
}
$un2 = Join-Path $studio 'Uninstall.exe'
if (Test-Path $un2) { $u2 = Start-Process -WindowStyle Hidden -FilePath $un2 -ArgumentList '/S' -PassThru -Wait; Write-Output ('studio_uninstall_exit=' + $u2.ExitCode) }
Write-Output ('studio_dir_left=' + (Test-Path $studio) + ' server_dir_left=' + (Test-Path $server))
