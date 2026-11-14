[Console]::OutputEncoding=[Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
$src = @'
using System;
using System.Runtime.InteropServices;
public class PWS {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
Add-Type -TypeDefinition $src
$exe = Join-Path $env:LOCALAPPDATA 'Programs\Infinity.Inc\Infinity Server\InfinityServer.exe'
if (-not (Test-Path $exe)) { Write-Output ('MISSING ' + $exe); exit 1 }
Get-Process -Name InfinityServer -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
$p = Start-Process -WindowStyle Hidden -FilePath $exe -PassThru
$h = [IntPtr]::Zero
for ($i = 0; $i -lt 45; $i++) {
  Start-Sleep -Seconds 1
  $p.Refresh()
  if ($p.HasExited) { Write-Output ('exited_after=' + $i + 's code=' + $p.ExitCode); break }
  if ($p.MainWindowHandle -ne [IntPtr]::Zero) { $h = $p.MainWindowHandle; Write-Output ('window_after=' + $i + 's'); break }
}
Write-Output ('title=' + $p.MainWindowTitle + ' hwnd=' + $h)
if ($h -eq [IntPtr]::Zero) { Write-Output 'NO_WINDOW'; exit 1 }
$r = New-Object PWS+RECT
[PWS]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top
Write-Output ('rect=' + $w + 'x' + $ht)
$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [PWS]::PrintWindow($h, $hdc, 2)
$g.ReleaseHdc($hdc)
$g.Dispose()
$out = Join-Path (Get-Location) 'work\server-window.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ('printwindow=' + $ok + ' png=' + (Get-Item $out).Length)
# the console is a local HTTP service: prove it answers while the window is up
try {
  $resp = Invoke-WebRequest -Uri 'http://127.0.0.1:7711/' -UseBasicParsing -TimeoutSec 5
  Write-Output ('http_status=' + $resp.StatusCode + ' bytes=' + $resp.RawContentLength)
  $txt = $resp.Content
  Write-Output ('has_title=' + [bool]($txt -match 'InfinityServer'))
} catch {
  Write-Output ('http_error=' + $_.Exception.Message)
}
Get-Process -Name InfinityServer -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Output 'SERVER-WINDOW-DONE'
