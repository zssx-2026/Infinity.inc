$b='D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
$path = Join-Path $env:LOCALAPPDATA 'Infinity\Infinity Cloud\token.bin'
'stored=' + (Test-Path $path) + ' size=' + (Get-Item $path).Length
$proc = Start-Process -FilePath (Join-Path $b 'cpp\out\inc\inc_cli.exe') -ArgumentList '--serve-ui --port=7699' -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 3
$page = Invoke-WebRequest -Uri 'http://127.0.0.1:7699/' -UseBasicParsing -TimeoutSec 10
'page len=' + $page.Content.Length
$page.Content.Substring(0, [Math]::Min(180, $page.Content.Length))
try { $st = Invoke-WebRequest -Uri 'http://127.0.0.1:7699/api/state' -UseBasicParsing -TimeoutSec 20; $j = $st.Content | ConvertFrom-Json; 'state login=' + $j.login + ' source=' + $j.tokenSource + ' bytes=' + $j.totalBytes } catch { 'state failed: ' + $_.Exception.Message }
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue