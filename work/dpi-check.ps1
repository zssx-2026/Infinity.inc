Add-Type @'
using System;
using System.Runtime.InteropServices;
public class D {
  [DllImport("user32.dll")] public static extern uint GetDpiForSystem();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
}
'@
'system_dpi=' + [D]::GetDpiForSystem()
'screen=' + [D]::GetSystemMetrics(0) + 'x' + [D]::GetSystemMetrics(1)
Add-Type -AssemblyName System.Windows.Forms
'forms_scale=' + [System.Windows.Forms.SystemInformation]::PrimaryMonitorSize
Get-CimInstance Win32_VideoController | Select-Object -First 1 Name,CurrentHorizontalResolution,CurrentVerticalResolution | Format-List | Out-String