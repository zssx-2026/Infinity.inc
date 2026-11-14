[Console]::OutputEncoding=[Text.Encoding]::UTF8
Set-Location 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
node work\check-hidden-windows.mjs
node work\test-studio-clean.mjs 2>&1 | Select-Object -Last 1
node work\test-remote-download.mjs 2>&1 | Select-Object -Last 1
node work\test-remote-uninstall.mjs 2>&1 | Select-Object -Last 1
node work\test-server-page.mjs 2>&1 | Select-Object -Last 1
node cpp\apps\int\int-offline.test.mjs 2>&1 | Select-Object -Last 1
Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Programs\Infinity.Inc') -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
Write-Output 'batch done'
