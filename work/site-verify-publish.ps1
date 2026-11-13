$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$env:GIT_TERMINAL_PROMPT='0'
$payload = 'protocol=https' + [char]10 + 'host=github.com' + [char]10 + [char]10
$out = $payload | git credential fill 2>$null
$pw = ($out | Where-Object { $_ -like 'password=*' })
if (-not $pw) { Write-Output 'NO-CREDENTIAL'; exit 2 }
$env:GH_TOKEN = $pw.Substring(9)
Write-Output ('token-length=' + $env:GH_TOKEN.Length)
$NODE='C:\Users\REDMI\.dsh\dsh-runtimes\dsh-next-primary-runtime\dependencies\node\bin\node.exe'
$log = 'work\site-verify-publish.log'
$text = & $NODE work\_org-pages\publish.mjs 2>&1 | Out-String
$code = $LASTEXITCODE
$text | Out-File -FilePath $log -Encoding utf8
Write-Output $text
Write-Output ('PUBLISH-EXIT=' + $code)
exit $code
