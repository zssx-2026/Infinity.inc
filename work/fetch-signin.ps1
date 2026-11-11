$b='D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
foreach ($p in @(@{exe='inc'; port=7699}, @{exe='ipm'; port=7698})) {
  $proc = Start-Process -FilePath (Join-Path $b ('cpp\out\' + $p.exe + '\' + $p.exe + '_cli.exe')) -ArgumentList ('--serve-ui --port=' + $p.port) -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 2
  try { $r = Invoke-WebRequest -Uri ('http://127.0.0.1:' + $p.port + '/') -UseBasicParsing -TimeoutSec 5
    $t = $r.Content -replace '<[^>]+>',' ' -replace '\s+',' '
    $p.exe + ' status=' + $r.StatusCode + ' len=' + $r.Content.Length + ' | ' + $t.Substring(0,[Math]::Min(220,$t.Length)) }
  catch { $p.exe + ' ERR ' + $_.Exception.Message }
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
}