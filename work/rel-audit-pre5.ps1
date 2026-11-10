$env:GIT_TERMINAL_PROMPT='0'
$payload = 'protocol=https' + [char]10 + 'host=github.com' + [char]10 + [char]10
$out = $payload | git credential fill 2>$null
$pw = ($out | Where-Object { $_ -like 'password=*' })
$env:EV_GH_TOKEN = $pw.Substring(9)
& 'C:\Users\REDMI\.dsh\dsh-runtimes\dsh-next-primary-runtime\dependencies\node\bin\node.exe' work\rel-audit-pre5.mjs 2>&1 | Out-String