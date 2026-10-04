param(
  [Parameter(Mandatory=$true)][string]$TitleLike,
  [Parameter(Mandatory=$true)][string]$Out,
  [int]$WaitMs = 0,
  [switch]$Exact
)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class W32 {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowTextLengthW(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static IntPtr Found = IntPtr.Zero;
  public static string Want = "";
  public static bool ExactMode = false;
  public static bool Cb(IntPtr h, IntPtr l) {
    int len = GetWindowTextLengthW(h);
    if (len <= 0) return true;
    StringBuilder sb = new StringBuilder(len + 2);
    GetWindowTextW(h, sb, sb.Capacity);
    string t = sb.ToString().Trim();
    bool hit = ExactMode ? string.Equals(t, Want, StringComparison.OrdinalIgnoreCase)
                         : (t.IndexOf(Want, StringComparison.OrdinalIgnoreCase) >= 0);
    if (hit && IsWindowVisible(h)) {
      Found = h; return false;
    }
    return true;
  }
}
"@

[void][W32]::SetProcessDPIAware()
$sw = [W32]::GetSystemMetrics(0); $sh = [W32]::GetSystemMetrics(1)
Write-Output "screen=${sw}x${sh}"

[W32]::Want = $TitleLike
[W32]::ExactMode = [bool]$Exact
[W32]::Found = [IntPtr]::Zero
$cb = [W32+EnumProc]{ param($h,$l) [W32]::Cb($h,$l) }
[void][W32]::EnumWindows($cb, [IntPtr]::Zero)
$h = [W32]::Found
if ($h -eq [IntPtr]::Zero) { Write-Output "NOTFOUND: $TitleLike"; exit 2 }

$len = [W32]::GetWindowTextLengthW($h)
$sb = New-Object System.Text.StringBuilder ($len + 2)
[void][W32]::GetWindowTextW($h, $sb, $sb.Capacity)
$title = $sb.ToString()

if ($WaitMs -gt 0) { Start-Sleep -Milliseconds $WaitMs }
[void][W32]::ShowWindow($h, 9)   # SW_RESTORE
[void][W32]::BringWindowToTop($h)
[void][W32]::SetForegroundWindow($h)
# Force topmost so nothing can cover the window while we read it.
[void][W32]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, 0x0003)  # HWND_TOPMOST, NOMOVE|NOSIZE
Start-Sleep -Milliseconds 1000

$r = New-Object W32+RECT
[void][W32]::GetWindowRect($h, [ref]$r)
$w = $r.Right - $r.Left
$hgt = $r.Bottom - $r.Top
if ($w -le 0 -or $hgt -le 0) { Write-Output "BADRECT: $($r.Left),$($r.Top),$($r.Right),$($r.Bottom)"; exit 3 }

$bmp = New-Object System.Drawing.Bitmap($w, $hgt)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size($w, $hgt)))
$dir = Split-Path -Parent $Out
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
# Drop the topmost flag again so the desktop returns to normal.
[void][W32]::SetWindowPos($h, [IntPtr](-2), 0, 0, 0, 0, 0x0003)  # HWND_NOTOPMOST
Write-Output "OK: title='$title' rect=$($r.Left),$($r.Top) size=${w}x${hgt} -> $Out"
