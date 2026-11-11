$ErrorActionPreference='Stop'
$payload = 'protocol=https' + [char]10 + 'host=github.com' + [char]10 + [char]10
$out = $payload | git credential fill 2>$null
$tok = (($out | Where-Object { $_ -like 'password=*' }).Substring(9))
$env:EV_GH_TOKEN = $tok
$exe = 'cpp\out\ipm\ipm_cli.exe'
'--- search Infinity'
& $exe search Infinity 2>&1 | Out-String
'--- info InfinityCloud'
& $exe info InfinityCloud 2>&1 | Out-String
'--- info InfinityToolbox'
& $exe info InfinityToolbox 2>&1 | Out-String
