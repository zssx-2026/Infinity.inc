$dir = 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\shell\build\inc_gui-win32-x64'
$p = Start-Process -WindowStyle Hidden -FilePath (Join-Path $dir 'inc_gui.exe') -PassThru
Start-Sleep -Seconds 7
$p.Refresh()
'alive=' + (-not $p.HasExited)
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public struct RECT { public int Left, Top, Right, Bottom; }
public class W { [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }
'@
$h = $p.MainWindowHandle
'hwnd=' + $h + ' title=' + $p.MainWindowTitle
[W]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 700
$r = New-Object RECT
[W]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top
'rect=' + $r.Left + ',' + $r.Top + ' ' + $w + 'x' + $ht
$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size $w, $ht))
$file = 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\shell-setup.png'
$bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
'shot=' + (Get-Item $file).Length + ' B'
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue