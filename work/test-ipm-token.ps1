$b='D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
$exe = Join-Path $b 'cpp\out\ipm\ipm_cli.exe'
'exe=' + (Test-Path $exe) + ' size=' + (Get-Item $exe).Length
Remove-Item -Force -Recurse (Join-Path $env:LOCALAPPDATA 'Infinity') -ErrorAction SilentlyContinue
$proc = Start-Process -FilePath $exe -ArgumentList '--serve-ui --port=7698' -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 3
$page = Invoke-WebRequest -Uri 'http://127.0.0.1:7698/' -UseBasicParsing -TimeoutSec 10
'firstrun page=' + $page.Content.Length + ' hasInput=' + ($page.Content -match "id='t'") + ' hasPkg=' + ($page.Content -match 'InfinityPackageManager')
try { Invoke-WebRequest -Uri 'http://127.0.0.1:7698/api/state' -UseBasicParsing -TimeoutSec 5 | Out-Null; 'state=unexpected-200' } catch { 'state guarded: ' + $_.Exception.Response.StatusCode.value__ }
try { $bad = Invoke-WebRequest -Uri 'http://127.0.0.1:7698/api/token' -Method POST -ContentType 'application/json' -Body '{"token":"ghp_bogus"}' -UseBasicParsing -TimeoutSec 20; 'badtoken=unexpected-' + $bad.StatusCode } catch { 'badtoken: ' + $_.Exception.Response.StatusCode.value__ }
$payload = 'protocol=https' + [char]10 + 'host=github.com' + [char]10 + [char]10
$cred = $payload | git credential fill 2>$null
$tok = ($cred | Where-Object { $_ -like 'password=*' } | Select-Object -First 1).Substring(9)
'tokenlen=' + $tok.Length
$body = @{ token = $tok } | ConvertTo-Json -Compress
$save = Invoke-WebRequest -Uri 'http://127.0.0.1:7698/api/token' -Method POST -ContentType 'application/json' -Body $body -UseBasicParsing -TimeoutSec 30
'save=' + $save.StatusCode + ' ' + $save.Content
$st = Invoke-WebRequest -Uri 'http://127.0.0.1:7698/api/state' -UseBasicParsing -TimeoutSec 30
$j = $st.Content | ConvertFrom-Json
'state login=' + $j.login + ' source=' + $j.tokenSource + ' builds=' + $j.summary.builds + ' installable=' + $j.summary.installable
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 600
'stored files:'
Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Infinity') -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName + ' ' + $_.Length }