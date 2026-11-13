[Console]::OutputEncoding=[Text.Encoding]::UTF8
$exe = Join-Path $env:LOCALAPPDATA 'Programs\Infinity.Inc\Infinity Studio\InfinityStudio.exe'
Get-Process -Name InfinityStudio -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
$pf = Join-Path (Get-Location) 'work\studio-probe.json'
$png = Join-Path (Get-Location) 'work\studio-probe.png'
Remove-Item $pf,$png -Force -ErrorAction SilentlyContinue
$env:INFINITY_SHELL_PROBE = '1'
$env:INFINITY_SHELL_PROBE_FILE = $pf
$env:INFINITY_SHELL_PROBE_PNG = $png
$p = Start-Process -FilePath $exe -PassThru
Write-Output ('pid=' + $p.Id)
for ($i=0; $i -lt 30; $i++) { Start-Sleep -Seconds 1; if (Test-Path $pf) { Write-Output ('probe_after=' + $i + 's'); break } }
Write-Output ('alive=' + [bool](Get-Process -Id $p.Id -ErrorAction SilentlyContinue))
if (Test-Path $pf) { Write-Output ('probe=' + [System.IO.File]::ReadAllText($pf,[System.Text.Encoding]::UTF8)) } else { Write-Output 'NO_PROBE_JSON' }
if (Test-Path $png) { Write-Output ('png=' + (Get-Item $png).Length) } else { Write-Output 'NO_PNG' }
Get-Process -Name InfinityStudio -ErrorAction SilentlyContinue | Stop-Process -Force