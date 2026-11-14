$b='D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
$proc = Start-Process -FilePath (Join-Path $b 'cpp\out\inc\inc_cli.exe') -ArgumentList '--serve-ui --port=7699' -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
$r = Invoke-WebRequest -Uri 'http://127.0.0.1:7699/' -UseBasicParsing -TimeoutSec 5
'GET / status=' + $r.StatusCode + ' len=' + $r.Content.Length + ' hasInput=' + ($r.Content -match "id='t'") + ' hasContinue=' + ($r.Content -match '继续')
try { $bad = Invoke-WebRequest -Uri 'http://127.0.0.1:7699/api/token' -Method POST -Body '{"token":"ghp_not_a_real_token"}' -ContentType 'application/json' -UseBasicParsing -TimeoutSec 20; 'bad token status=' + $bad.StatusCode + ' body=' + $bad.Content } catch { 'bad token rejected: ' + $_.Exception.Response.StatusCode.value__ + ' ' + (New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() }
try { $st = Invoke-WebRequest -Uri 'http://127.0.0.1:7699/api/state' -UseBasicParsing -TimeoutSec 5; 'state status=' + $st.StatusCode } catch { 'state guarded: ' + $_.Exception.Response.StatusCode.value__ }
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue