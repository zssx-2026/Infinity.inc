# launch-on-hidden-desktop.ps1 -- run an exe on a dedicated invisible desktop.
#
# Static helper for the "no visible window" rule. It is NOT run automatically by
# anything and must not be run until the Lead lifts the no-process freeze.
#
# Why: kernel-host.exe creates its window with WS_VISIBLE (see cef-hide.patch), so
# STARTF_USESHOWWINDOW/SW_HIDE does not stop it reaching the interactive desktop.
# Running it on a separate desktop created with CreateDesktopW means the window is
# mapped on a desktop the user cannot see, switch to, or capture.
#
# Usage (after approval):
#   powershell -NoProfile -ExecutionPolicy Bypass -File work\webview2\launch-on-hidden-desktop.ps1 `
#     -Exe work\webview2\bench\cef\kernel-host.exe `
#     -ExeArgs '--url=file:///.../smoke.html --dom-out=... --render-ms=0 --timeout-ms=25000 --disable-gpu' `
#     -TimeoutMs 40000
#
# Cleanup: the script kills only the PID it created (taskkill /T /F /PID <pid>),
# prints the full command line it used, and reports the PID. It never kills by name.
param(
  [Parameter(Mandatory=$true)][string]$Exe,
  [string]$ExeArgs = '',
  [string]$DesktopName = 'InfinityCefHidden',
  [int]$TimeoutMs = 60000
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class HiddenDesktop {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct STARTUPINFO { public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX; public int dwY; public int dwXSize; public int dwYSize; public int dwXCountChars; public int dwYCountChars;
    public int dwFillAttribute; public int dwFlags; public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2;
    public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError; }
  [StructLayout(LayoutKind.Sequential)]
  public struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr CreateDesktop(string name, IntPtr dev, IntPtr dm, int flags, uint access, IntPtr sa);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool CloseDesktop(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CreateProcess(string app, string cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool CloseHandle(IntPtr h);
}
"@

$exeFull = (Resolve-Path $Exe).Path
$workDir = Split-Path -Parent $exeFull
$cmdLine = '"' + $exeFull + '"' + (if ($ExeArgs) { ' ' + $ExeArgs } else { '' })
Write-Host ('desktop   : ' + $DesktopName)
Write-Host ('command   : ' + $cmdLine)

# GENERIC_ALL = 0x10000000
$hDesk = [HiddenDesktop]::CreateDesktop($DesktopName, [IntPtr]::Zero, [IntPtr]::Zero, 0, 0x10000000, [IntPtr]::Zero)
if ($hDesk -eq [IntPtr]::Zero) { throw ('CreateDesktop failed: ' + [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error()).Message) }
try {
  $si = New-Object HiddenDesktop+STARTUPINFO
  $si.cb = [Runtime.InteropServices.Marshal]::SizeOf($si)
  $si.lpDesktop = $DesktopName
  $pi = New-Object HiddenDesktop+PROCESS_INFORMATION
  if (-not [HiddenDesktop]::CreateProcess($exeFull, $cmdLine, [IntPtr]::Zero, [IntPtr]::Zero, $false, 0, [IntPtr]::Zero, $workDir, [ref]$si, [ref]$pi)) {
    throw ('CreateProcess failed: ' + [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error()).Message)
  }
  Write-Host ('pid       : ' + $pi.dwProcessId)
  try {
    if ([HiddenDesktop]::WaitForSingleObject($pi.hProcess, $TimeoutMs) -eq 0x102) { Write-Host 'timeout -> killing the pid we created'; & taskkill.exe /T /F /PID $pi.dwProcessId | Out-Null }
  } finally {
    # compliant cleanup: only the PID created above, never by process name
    Get-CimInstance Win32_Process -Filter ("ProcessId=" + $pi.dwProcessId) -ErrorAction SilentlyContinue | ForEach-Object { Write-Host ('still alive, killing pid ' + $_.ProcessId + ' :: ' + $_.CommandLine); & taskkill.exe /T /F /PID $_.ProcessId | Out-Null }
    [void][HiddenDesktop]::CloseHandle($pi.hThread); [void][HiddenDesktop]::CloseHandle($pi.hProcess)
  }
} finally { [void][HiddenDesktop]::CloseDesktop($hDesk) }
Write-Host 'done'
