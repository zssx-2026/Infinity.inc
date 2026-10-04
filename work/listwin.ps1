param([string]$Filter = "")
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class E32 {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowTextLengthW(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static System.Collections.Generic.List<string> Lines = new System.Collections.Generic.List<string>();
  public static string F = "";
  public static bool Cb(IntPtr h, IntPtr l) {
    if (!IsWindowVisible(h)) return true;
    int len = GetWindowTextLengthW(h);
    if (len <= 0) return true;
    StringBuilder sb = new StringBuilder(len + 2);
    GetWindowTextW(h, sb, sb.Capacity);
    string t = sb.ToString();
    if (F != "" && t.IndexOf(F, StringComparison.OrdinalIgnoreCase) < 0) return true;
    RECT r; GetWindowRect(h, out r);
    Lines.Add("hwnd=" + h.ToInt64() + " [" + r.Left + "," + r.Top + " " + (r.Right-r.Left) + "x" + (r.Bottom-r.Top) + "] " + t);
    return true;
  }
}
"@
[void][E32]::SetProcessDPIAware()
[E32]::F = $Filter
$cb = [E32+EnumProc]{ param($h,$l) [E32]::Cb($h,$l) }
[void][E32]::EnumWindows($cb, [IntPtr]::Zero)
[E32]::Lines | ForEach-Object { Write-Output $_ }
