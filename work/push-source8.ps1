$ErrorActionPreference='Stop'
Set-Location 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
$payload = 'protocol=https' + [char]10 + 'host=github.com' + [char]10 + [char]10
$out = $payload | git credential fill 2>$null
$tok = ''
foreach ($line in $out) { if ($line -like 'password=*') { $tok = $line.Substring(9).Trim() } }
if (-not $tok) { Write-Output 'NO TOKEN'; exit 1 }
$env:EV_GH_TOKEN = $tok
# Redirect to a file instead of piping through Select-Object: truncating a
# pipeline kills the child early and reports Select-Object's exit code, not node's.
node work\ghsync-source.mjs --push *> work\push-source-last.log
$code = $LASTEXITCODE
Get-Content work\push-source-last.log -Tail 14
exit $code
