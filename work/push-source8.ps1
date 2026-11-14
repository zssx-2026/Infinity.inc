$ErrorActionPreference='Stop'
Set-Location 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
$payload = 'protocol=https' + [char]10 + 'host=github.com' + [char]10 + [char]10
$out = $payload | git credential fill 2>$null
$tok = ''
foreach ($line in $out) { if ($line -like 'password=*') { $tok = $line.Substring(9).Trim() } }
if (-not $tok) { Write-Output 'NO TOKEN'; exit 1 }
$env:EV_GH_TOKEN = $tok
node work\ghsync-source.mjs --push 2>&1 | Select-Object -Last 10
exit $LASTEXITCODE
