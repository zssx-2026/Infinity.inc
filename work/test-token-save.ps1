$b='D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
$payload = 'protocol=https' + [char]10 + 'host=github.com' + [char]10 + [char]10
$out = $payload | git credential fill 2>$null
$tok = ($out | Where-Object { $_ -like 'password=*' } | Select-Object -First 1).Substring(9)
'token-length=' + $tok.Length
$proc = Start-Process -FilePath (Join-Path $b 'cpp\out\inc\inc_cli.exe') -ArgumentList '--serve-ui --port=7699' -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
$body = '{"token":"' + $tok + '"}'
try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:7699/api/token' -Method POST -Body $body -ContentType 'application/json' -UseBasicParsing -TimeoutSec 40; 'save status=' + $r.StatusCode } catch { 'save failed: ' + $_.Exception.Response.StatusCode.value__ }
$page = Invoke-WebRequest -Uri 'http://127.0.0.1:7699/' -UseBasicParsing -TimeoutSec 10
'after save: page len=' + $page.Content.Length + ' setupStill=' + ($page.Content -match 'autocomplete=.off.')
try { $st = Invoke-WebRequest -Uri 'http://127.0.0.1:7699/api/state' -UseBasicParsing -TimeoutSec 15; $j = $st.Content | ConvertFrom-Json; 'state status=' + $st.StatusCode + ' login=' + $j.login + ' source=' + $j.tokenSource } catch { 'state failed' }
$path = Join-Path $env:LOCALAPPDATA 'Infinity\inc\token.bin'
'stored file=' + (Test-Path $path) + ' size=' + (Get-Item $path).Length
$bytes = [System.IO.File]::ReadAllBytes($path)
$txt = [System.Text.Encoding]::ASCII.GetString($bytes)
'plaintext token in file=' + ($txt.Contains($tok))
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Remove-Item $path -Force -ErrorAction SilentlyContinue
'cleanup=' + (-not (Test-Path $path))