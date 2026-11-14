[Console]::OutputEncoding=[Text.Encoding]::UTF8
$ErrorActionPreference='Continue'
Set-Location 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
if (Test-Path (Join-Path $env:LOCALAPPDATA 'Infinity')) { Remove-Item -Recurse -Force (Join-Path $env:LOCALAPPDATA 'Infinity') -ErrorAction SilentlyContinue }
$targets = @(@('inc', 7701), @('ipm', 7702), @('int', 7703))
foreach ($t in $targets) {
  $name = $t[0]; $port = $t[1]
  $exe = Join-Path (Get-Location) ("cpp\out\" + $name + "\" + $name + "_cli.exe")
  if (-not (Test-Path $exe)) { Write-Output ($name + ' MISSING ' + $exe); continue }
  $p = Start-Process -WindowStyle Hidden -FilePath $exe -ArgumentList @('--serve-ui', ('--port=' + $port)) -PassThru -RedirectStandardOutput ("work\" + $name + "-ui-out.log") -RedirectStandardError ("work\" + $name + "-ui-err.log")
  Start-Sleep -Seconds 5
  $alive = -not $p.HasExited
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:" + $port + "/") -TimeoutSec 15
    $body = $r.Content
    $hasToken = $body.Contains("id='t'")
    $len = $body.Length
    Write-Output ($name + ' alive=' + $alive + ' http=' + $r.StatusCode + ' bytes=' + $len + ' tokenPage=' + $hasToken)
    if ($name -eq 'int') { Write-Output ('  int page has InfinityToolbox=' + $body.Contains('InfinityToolbox')) }
  } catch {
    Write-Output ($name + ' alive=' + $alive + ' request failed: ' + $_.Exception.Message)
  }
  try { $p.Kill() } catch { }
  Start-Sleep -Seconds 1
}
exit 0
