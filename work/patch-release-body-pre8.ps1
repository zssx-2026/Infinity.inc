$ErrorActionPreference='Stop'
$payload = 'protocol=https' + [char]10 + 'host=github.com' + [char]10 + [char]10
$out = $payload | git credential fill 2>$null
$tok = (($out | Where-Object { $_ -like 'password=*' }).Substring(9))
$env:EV_GH_TOKEN = $tok
$NODE='C:\Users\REDMI\.dsh\dsh-runtimes\dsh-next-primary-runtime\dependencies\node\bin\node.exe'
& $NODE work\patch-release-body-pre8.mjs 2>&1 | Out-String
