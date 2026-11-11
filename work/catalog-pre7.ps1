$ErrorActionPreference='Stop'
$env:GIT_TERMINAL_PROMPT='0'
$payload = 'protocol=https' + [char]10 + 'host=github.com' + [char]10 + [char]10
$out = $payload | git credential fill 2>$null
$pw = ($out | Where-Object { $_ -like 'password=*' })
if (-not $pw) { Write-Output 'NO-CREDENTIAL'; exit 2 }
$tok = $pw.Substring(9)
Write-Output ('token-length=' + $tok.Length)
$env:EV_GH_TOKEN = $tok
$NODE='C:\Users\REDMI\.dsh\dsh-runtimes\dsh-next-primary-runtime\dependencies\node\bin\node.exe'
& $NODE work\catalog-pre7.mjs 2>&1 | Out-String
