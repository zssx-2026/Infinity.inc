$dir = 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\shell\build\ipm_gui-win32-x64'
Copy-Item -Force 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\shell\main.js' (Join-Path $dir 'resources\app\main.js')
Remove-Item -Force -Recurse (Join-Path $env:LOCALAPPDATA 'Infinity') -ErrorAction SilentlyContinue
$json = 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\qa-ipm.json'; $png = 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\qa-ipm.png'
Remove-Item -Force $json, $png -ErrorAction SilentlyContinue
$env:INFINITY_SHELL_PROBE='1'; $env:INFINITY_SHELL_PROBE_FILE=$json; $env:INFINITY_SHELL_PROBE_PNG=$png
$w = Start-Process -FilePath (Join-Path $dir 'ipm_gui.exe') -PassThru
$w.WaitForExit(120000) | Out-Null
'png=' + $(if (Test-Path $png) { (Get-Item $png).Length } else { 'none' })
Remove-Item Env:INFINITY_SHELL_PROBE, Env:INFINITY_SHELL_PROBE_FILE, Env:INFINITY_SHELL_PROBE_PNG -ErrorAction SilentlyContinue