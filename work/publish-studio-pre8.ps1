[Console]::OutputEncoding=[Text.Encoding]::UTF8
$ErrorActionPreference='Stop'
$payload = 'protocol=https' + [char]10 + 'host=github.com' + [char]10 + [char]10
$out = $payload | git credential fill 2>$null
$tok = ($out | Where-Object { $_ -like 'password=*' } | Select-Object -First 1).Substring(9)
Write-Output ('token-length=' + $tok.Length)
$env:GH_TOKEN = $tok
node tools/publish-electron.mjs studio --tag v1.0.0-pre8
Write-Output ('upload_exit=' + $LASTEXITCODE)