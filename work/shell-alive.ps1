$b='D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
$exe = Join-Path $b 'shell\build\inc_gui-win32-x64\inc_gui.exe'
$p = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 9
$p.Refresh()
'alive=' + (-not $p.HasExited) + ' title=' + $p.MainWindowTitle
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
Get-Process inc_cli -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue