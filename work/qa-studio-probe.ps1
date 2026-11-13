[Console]::OutputEncoding=[Text.Encoding]::UTF8
$ErrorActionPreference='Continue'
$root = Join-Path $env:LOCALAPPDATA 'Programs\Infinity.Inc'
Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
$setup = Join-Path (Get-Location) 'cpp\release\v1.0pre8\InfinityStudio_1.0.0-pre8_win64_setup.exe'
$p = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden
Write-Output ('install_exit=' + $p.ExitCode)
$dir = Join-Path $root 'Infinity Studio'
$exe = Join-Path $dir 'InfinityStudio.exe'
Write-Output ('exe=' + $exe + ' exists=' + (Test-Path $exe))
$f = Get-ChildItem $dir -Recurse -File -ErrorAction SilentlyContinue
Write-Output ('files=' + $f.Count + ' bytes=' + (($f | Measure-Object Length -Sum).Sum))

Write-Output '--- run A: shipped server catalog ---'
$app = Start-Process -FilePath $exe -PassThru
for ($i=0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 500; if (Test-NetConnection -ComputerName 127.0.0.1 -Port 7721 -InformationLevel Quiet -WarningAction SilentlyContinue) { break } }
$body = curl.exe -s --max-time 20 http://127.0.0.1:7721/v1/remote
if ($body) { $j = $body | ConvertFrom-Json; Write-Output ('base=' + $j.base + ' error=' + $j.error); foreach ($pr in $j.catalog.products) { Write-Output ('  ' + $pr.asset + ' size=' + $pr.size + ' sha=' + $pr.sha256.Substring(0,12)) } } else { Write-Output 'NO_BODY' }
Start-Sleep -Seconds 1
Get-Process -Name InfinityStudio -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

Write-Output '--- run B: window probe ---'
$env:INFINITY_SHELL_PROBE = '1'
$env:INFINITY_SHELL_PROBE_FILE = (Join-Path (Get-Location) 'work\studio-probe.json')
$env:INFINITY_SHELL_PROBE_PNG = (Join-Path (Get-Location) 'work\studio-probe.png')
Remove-Item $env:INFINITY_SHELL_PROBE_FILE -ErrorAction SilentlyContinue
Remove-Item $env:INFINITY_SHELL_PROBE_PNG -ErrorAction SilentlyContinue
$app2 = Start-Process -FilePath $exe -PassThru
$app2.WaitForExit(60000) | Out-Null
Start-Sleep -Seconds 2
if (Test-Path $env:INFINITY_SHELL_PROBE_FILE) {
  $t = [System.IO.File]::ReadAllText($env:INFINITY_SHELL_PROBE_FILE, [System.Text.Encoding]::UTF8)
  Write-Output ('probe=' + $t)
} else { Write-Output 'NO_PROBE_JSON' }
if (Test-Path $env:INFINITY_SHELL_PROBE_PNG) { Write-Output ('png=' + (Get-Item $env:INFINITY_SHELL_PROBE_PNG).Length) } else { Write-Output 'NO_PNG' }
Get-Process -Name InfinityStudio -ErrorAction SilentlyContinue | Stop-Process -Force