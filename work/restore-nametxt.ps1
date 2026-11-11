$env:NODE_OPTIONS=''
$payload = 'protocol=https' + [char]10 + 'host=github.com' + [char]10 + [char]10
$out = $payload | git credential fill
$line = ($out -split "`n" | Where-Object { $_ -like 'password=*' })
$env:EV_GH_TOKEN = $line.Substring(9)
Write-Output ("token-length=" + $env:EV_GH_TOKEN.Length)
cd 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
node work/restore-nametxt.mjs
Write-Output ("exit=" + $LASTEXITCODE)
