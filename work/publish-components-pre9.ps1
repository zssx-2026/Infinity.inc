[Console]::OutputEncoding=[Text.Encoding]::UTF8
$ErrorActionPreference='Continue'
Set-Location 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
$payload = 'protocol=https' + [char]10 + 'host=github.com' + [char]10 + [char]10
$out = $payload | git credential fill 2>$null
$tok = ''
foreach ($line in $out) { if ($line -like 'password=*') { $tok = $line.Substring(9).Trim() } }
if (-not $tok) { Write-Output 'NO TOKEN'; exit 1 }
$env:GH_TOKEN = $tok
Write-Output ('token-length=' + $tok.Length)
foreach ($p in @('inc','ipm','int')) {
  Write-Output ('=== publish ' + $p + ' ' + (Get-Date -Format o))
  & node tools/publish-electron.mjs $p --tag v1.0.0-pre8
  Write-Output ('exit=' + $LASTEXITCODE)
}
Write-Output '=== update components table'
& node work/components-update.mjs
Write-Output ('components-update exit=' + $LASTEXITCODE)
exit 0
