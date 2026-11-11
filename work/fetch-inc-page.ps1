$b='D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
$p = Start-Process -FilePath (Join-Path $b 'cpp\out\inc\inc_cli.exe') -ArgumentList '--serve-ui','--port=7699' -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 3
try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:7699/' -UseBasicParsing -TimeoutSec 5; 'status=' + $r.StatusCode + ' len=' + $r.Content.Length; $r.Content.Substring(0, [Math]::Min(1200, $r.Content.Length)) } catch { 'ERR ' + $_.Exception.Message }
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue