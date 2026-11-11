$ErrorActionPreference = 'Continue'
Set-Location 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
$env:INC_VERSION = '1.0.0-pre7'
foreach ($app in @('inc', 'ipm', 'int')) {
  Write-Output ('=== build ' + $app + ' ' + (Get-Date -Format o))
  & node cpp/tools/build.mjs $app
  Write-Output ('--- build ' + $app + ' exit=' + $LASTEXITCODE)
  if ($LASTEXITCODE -ne 0) { Write-Output 'ABORT'; exit 1 }
}
Write-Output ('=== shell build ' + (Get-Date -Format o))
$env:INC_SHELL_ARCHES = 'x64'
& node shell/build.mjs
Write-Output ('--- shell build exit=' + $LASTEXITCODE)
Get-ChildItem cpp/build/*.exe | ForEach-Object { Write-Output ($_.Name + ' ' + $_.Length) }
exit 0
