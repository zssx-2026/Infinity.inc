Remove-Item -Force -Recurse (Join-Path $env:LOCALAPPDATA 'Infinity') -ErrorAction SilentlyContinue
$dir = 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\shell\build\inc_gui-win32-x64'
Copy-Item -Force 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\shell\main.js' (Join-Path $dir 'resources\app\main.js')
Copy-Item -Force 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\cpp\out\inc\inc_cli.exe' (Join-Path $dir 'inc_cli.exe')
'staged main.js probe=' + (Select-String -Path (Join-Path $dir 'resources\app\main.js') -Pattern 'INFINITY_SHELL_PROBE' -SimpleMatch -Quiet)
$out = 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\shell-probe.json'
Remove-Item -Force $out -ErrorAction SilentlyContinue
$env:INFINITY_SHELL_PROBE='1'
$env:INFINITY_SHELL_PROBE_FILE=$out
$p = Start-Process -WindowStyle Hidden -FilePath (Join-Path $dir 'inc_gui.exe') -PassThru
'pid=' + $p.Id
$p.WaitForExit(60000) | Out-Null
'exited=' + $p.HasExited
if (Test-Path $out) { Get-Content -Raw $out } else { 'NO PROBE FILE' }