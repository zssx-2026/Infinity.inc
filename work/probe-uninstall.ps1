[Console]::OutputEncoding=[Text.Encoding]::UTF8
Set-Location 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
$node = (Get-Command node).Source
$p = Start-Process -WindowStyle Hidden -FilePath $node -ArgumentList @('InfinityStudio\src\cli.js','7803') -PassThru -RedirectStandardOutput work\probe-un-out.log -RedirectStandardError work\probe-un-err.log
Start-Sleep -Seconds 5
node work\probe-uninstall.mjs
Write-Output ('probe_exit=' + $LASTEXITCODE)
try { $p.Kill() } catch { }
exit 0
