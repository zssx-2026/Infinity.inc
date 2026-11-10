$env:GIT_TERMINAL_PROMPT='0'
$payload = 'protocol=https' + [char]10 + 'host=github.com' + [char]10 + [char]10
$out = $payload | git credential fill 2>$null
$pw = ($out | Where-Object { $_ -like 'password=*' })
$env:EV_GH_TOKEN = $pw.Substring(9)
& .\cpp\out\ipm\ipm_cli.exe search Infinity 2>&1 | Out-String
'--- info InfinityCloud ---'
& .\cpp\out\ipm\ipm_cli.exe info InfinityCloud 2>&1 | Out-String
'--- info InfinityToolbox ---'
& .\cpp\out\ipm\ipm_cli.exe info InfinityToolbox 2>&1 | Out-String