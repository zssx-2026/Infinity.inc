$dir = 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\shell\build\inc_gui-win32-x64'
Copy-Item -Force 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\shell\main.js' (Join-Path $dir 'resources\app\main.js')
Remove-Item -Force -Recurse (Join-Path $env:LOCALAPPDATA 'Infinity') -ErrorAction SilentlyContinue
$out = 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\shell-probe.json'; $png = 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\shell-setup.png'
Remove-Item -Force $out, $png -ErrorAction SilentlyContinue
$env:INFINITY_SHELL_PROBE='1'; $env:INFINITY_SHELL_PROBE_FILE=$out; $env:INFINITY_SHELL_PROBE_PNG=$png
$p = Start-Process -FilePath (Join-Path $dir 'inc_gui.exe') -PassThru
$p.WaitForExit(60000) | Out-Null
'exited=' + $p.HasExited
if (Test-Path $png) { 'png=' + (Get-Item $png).Length + ' B' } else { 'NO PNG' }