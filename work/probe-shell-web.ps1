[Console]::OutputEncoding=[Text.Encoding]::UTF8
Set-Location 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
$dir = 'shell\build\inc_gui-win32-x64'
Copy-Item 'cpp\out\inc\inc_cli.exe' -Destination $dir -Force
$env:INFINITY_SHELL_PROBE='1'
$env:INFINITY_SHELL_PROBE_WEB='1'
$env:INFINITY_SHELL_PROBE_FILE=(Join-Path (Get-Location) 'work\shell-web-probe.json')
$env:INFINITY_SHELL_PROBE_PNG=(Join-Path (Get-Location) 'work\shell-web.png')
Remove-Item work\shell-web-probe.json -ErrorAction SilentlyContinue
$p = Start-Process -WindowStyle Hidden -FilePath (Join-Path $dir 'inc_gui.exe') -PassThru
$p.WaitForExit(90000) | Out-Null
Write-Output ('probe_exit=' + $p.ExitCode)
if (Test-Path work\shell-web-probe.json) { Get-Content work\shell-web-probe.json -Raw } else { 'no probe file' }
