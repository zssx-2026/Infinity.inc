$exe = 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\cpp\out\ipm\ipm_cli.exe'
$proc = Start-Process -FilePath $exe -ArgumentList '--serve-ui --port=7697' -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 4
$page = Invoke-WebRequest -Uri 'http://127.0.0.1:7697/' -UseBasicParsing -TimeoutSec 15
'reload page=' + $page.Content.Length + ' setup=' + ($page.Content -match "id='t'") + ' title=' + ([regex]::Match($page.Content, '<title>(.*?)</title>').Groups[1].Value)
$st = Invoke-WebRequest -Uri 'http://127.0.0.1:7697/api/state' -UseBasicParsing -TimeoutSec 30
$j = $st.Content | ConvertFrom-Json
'reload login=' + $j.login + ' source=' + $j.tokenSource
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue