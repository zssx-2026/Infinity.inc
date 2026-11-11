Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
$exe = Join-Path $PSScriptRoot '..\shell\build\inc_gui-win32-x64\inc_gui.exe'
$p = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 8
$p.Refresh()
"alive=$(-not $p.HasExited) title=$($p.MainWindowTitle)"
$h = $p.MainWindowHandle
if ($h -ne [IntPtr]::Zero) {
  [W]::SetForegroundWindow($h) | Out-Null
  Start-Sleep -Milliseconds 700
  $r = New-Object W+RECT
  [W]::GetWindowRect($h, [ref]$r) | Out-Null
  $wd = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top
  "rect=$($r.Left),$($r.Top) size=$($wd)x$($ht)"
  $bmp = New-Object System.Drawing.Bitmap $wd, $ht
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
  $out = Join-Path $PSScriptRoot 'electron-shell-inc.png'
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  "saved $out"
}
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
Get-Process inc_cli -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
'done'