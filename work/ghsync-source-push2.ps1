[Console]::OutputEncoding=[Text.Encoding]::UTF8
$ErrorActionPreference='Continue'
$payload = 'protocol=https' + [char]10 + 'host=github.com' + [char]10 + [char]10
$out = $payload | git credential fill 2>$null
$tok = ($out | Where-Object { $_ -like 'password=*' } | Select-Object -First 1).Substring(9)
$env:EV_GH_TOKEN = $tok
Write-Output ('token-length=' + $tok.Length)
node work/ghsync-source.mjs --push
Write-Output ('ghsync_exit=' + $LASTEXITCODE)