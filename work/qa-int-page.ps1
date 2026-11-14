[Console]::OutputEncoding=[Text.Encoding]::UTF8
Set-Location 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
$exe = Join-Path (Get-Location) 'cpp\out\int\int_cli.exe'
$p = Start-Process -WindowStyle Hidden -FilePath $exe -ArgumentList @('--serve-ui','--port=7704') -PassThru -RedirectStandardOutput work\int-ui2-out.log -RedirectStandardError work\int-ui2-err.log
Start-Sleep -Seconds 5
try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:7704/' -TimeoutSec 15; Write-Output ('bytes=' + $r.Content.Length); Write-Output $r.Content } catch { Write-Output ('fail: ' + $_.Exception.Message) }
try { $p.Kill() } catch { }
exit 0
