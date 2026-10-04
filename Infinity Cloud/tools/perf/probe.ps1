
# probe.ps1 - repeatable measurement harness for the native Infinity Cloud window.
#
# Every number in work/perf-cloud.md comes from this file. It is deliberately
# outside the product sources: the product is what is measured, this is the ruler.
#
#   .\probe.ps1 -Task window   -Runs 5            # ms from CreateProcess to a visible, responsive window
#   .\probe.ps1 -Task notoken  -Runs 5            # same, with no token in the child environment
#   .\probe.ps1 -Task cli      -Runs 5            # inc --version / get / listf wall clock
#   .\probe.ps1 -Task mem                        # private working set after the window settles
#   .\probe.ps1 -Task sizes                      # exe and release package bytes
#
# The token is read from HKCU\Environment into this process's environment and is
# never printed: only its presence is reported.

param(
  [string]$Task = "all",
  [string]$Exe = "",
  [string]$ChildArgs = "gui",
  [int]$Runs = 5,
  [int]$TimeoutMs = 90000,
  [int]$SettleMs = 3000,
  [switch]$NoToken,
  [string]$Label = "",
  [string]$Json = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)))
if ([string]::IsNullOrEmpty($Exe)) { $Exe = Join-Path $root "cpp\build\inc.exe" }
$Exe = (Resolve-Path $Exe).Path

$tokenNames = @("gittoken_zssx-2026_1","EV_GH_TOKEN","INC_TOKEN","IFM_TOKEN","IPM_TOKEN","GITHUB_TOKEN","GH_TOKEN")
foreach ($n in $tokenNames) { Remove-Item -Path ("Env:" + $n) -ErrorAction SilentlyContinue }

$tokenState = "absent"
$tokenPresent = $false
if (-not $NoToken) {
  $v = (Get-ItemProperty 'HKCU:\Environment' -Name 'EV_GH_TOKEN' -ErrorAction SilentlyContinue).'EV_GH_TOKEN'
  if ([string]::IsNullOrEmpty($v)) { throw "no EV_GH_TOKEN in HKCU\Environment" }
  Set-Item -Path "Env:EV_GH_TOKEN" -Value $v
  $tokenState = "present(len=" + $v.Length + ")"
  $tokenPresent = $true
}

if (-not ("IncProbe" -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public class IncProbe {
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern IntPtr FindWindowW(string cls, string win);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeoutW(IntPtr h, uint msg, IntPtr wp, IntPtr lp, uint flags, uint timeout, out IntPtr res);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowExW(IntPtr parent, IntPtr after, string cls, string win);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageW(IntPtr h, uint msg, IntPtr wp, IntPtr lp);
  [DllImport("psapi.dll", SetLastError=true)] public static extern bool GetProcessMemoryInfo(IntPtr h, ref PMC p, int cb);
  [DllImport("user32.dll")] public static extern uint GetGuiResources(IntPtr h, uint flag);

  [StructLayout(LayoutKind.Sequential)]
  public struct PMC {
    public int cb;
    public int PageFaultCount;
    public IntPtr PeakWorkingSetSize;
    public IntPtr WorkingSetSize;
    public IntPtr QuotaPeakPagedPoolUsage;
    public IntPtr QuotaPagedPoolUsage;
    public IntPtr QuotaPeakNonPagedPoolUsage;
    public IntPtr QuotaNonPagedPoolUsage;
    public IntPtr PagefileUsage;
    public IntPtr PeakPagefileUsage;
    public IntPtr PrivateUsage;
  }

  public long WindowMs = -1;
  public long VisibleMs = -1;
  public long ResponsiveMs = -1;
  public long ExitMs = -1;
  public int ExitCode = -999;
  public bool ExitedEarly = false;
  public double WorkingSetMB = -1;
  public double PeakWorkingSetMB = -1;
  public double PrivateMB = -1;
  public uint Gdi = 0;
  public uint UserObjects = 0;
  public long ListRows = -1;     // LVM_GETITEMCOUNT, read from the child list view
  public bool AliveAfterSettle = false;

  public static IncProbe Run(string exe, string args, int timeoutMs, int settleMs, string winClass) {
    IncProbe r = new IncProbe();
    ProcessStartInfo psi = new ProcessStartInfo(exe, args);
    psi.UseShellExecute = false;
    Stopwatch sw = Stopwatch.StartNew();
    Process p = Process.Start(psi);
    IntPtr h = IntPtr.Zero;
    while (sw.ElapsedMilliseconds < timeoutMs) {
      p.Refresh();
      if (p.HasExited) {
        r.ExitedEarly = true;
        r.ExitMs = sw.ElapsedMilliseconds;
        r.ExitCode = p.ExitCode;
        return r;
      }
      if (h == IntPtr.Zero) {
        h = FindWindowW(winClass, null);
        if (h != IntPtr.Zero) r.WindowMs = sw.ElapsedMilliseconds;
      }
      if (h != IntPtr.Zero && IsWindowVisible(h)) {
        if (r.VisibleMs < 0) r.VisibleMs = sw.ElapsedMilliseconds;
        IntPtr res;
        if (SendMessageTimeoutW(h, 0, IntPtr.Zero, IntPtr.Zero, 2, 1500, out res) != IntPtr.Zero) {
          r.ResponsiveMs = sw.ElapsedMilliseconds;
          break;
        }
      }
      System.Threading.Thread.Sleep(1);
    }
    if (r.ResponsiveMs < 0) return r;
    System.Threading.Thread.Sleep(settleMs);
    p.Refresh();
    r.AliveAfterSettle = !p.HasExited;
    IntPtr list = FindWindowExW(h, IntPtr.Zero, "SysListView32", null);
    if (list != IntPtr.Zero) r.ListRows = SendMessageW(list, 0x1004, IntPtr.Zero, IntPtr.Zero).ToInt64();
    PMC m = new PMC();
    m.cb = Marshal.SizeOf(typeof(PMC));
    if (GetProcessMemoryInfo(p.Handle, ref m, m.cb)) {
      r.WorkingSetMB = (double)m.WorkingSetSize.ToInt64() / 1048576.0;
      r.PeakWorkingSetMB = (double)m.PeakWorkingSetSize.ToInt64() / 1048576.0;
      r.PrivateMB = (double)m.PrivateUsage.ToInt64() / 1048576.0;
    }
    r.Gdi = GetGuiResources(p.Handle, 0);
    r.UserObjects = GetGuiResources(p.Handle, 1);
    try { p.Kill(); p.WaitForExit(5000); } catch { }
    return r;
  }
}
'@
}

function Get-Median([double[]]$values) {
  if ($values.Count -eq 0) { return -1 }
  $s = $values | Sort-Object
  $n = $s.Count
  if ($n % 2 -eq 1) { return [double]$s[[int](($n - 1) / 2)] }
  return [double](($s[$n / 2 - 1] + $s[$n / 2]) / 2)
}

function Invoke-WindowRuns {
  $rows = @()
  for ($i = 1; $i -le $Runs; $i++) {
    $r = [IncProbe]::Run($Exe, $ChildArgs, $TimeoutMs, $SettleMs, "InfinityCloudWindow")
    $rows += [pscustomobject]@{
      run = $i
      windowMs = $r.WindowMs
      visibleMs = $r.VisibleMs
      responsiveMs = $r.ResponsiveMs
      exitedEarly = $r.ExitedEarly
      exitMs = $r.ExitMs
      exitCode = $r.ExitCode
      wsMB = [math]::Round($r.WorkingSetMB, 2)
      peakWsMB = [math]::Round($r.PeakWorkingSetMB, 2)
      privateMB = [math]::Round($r.PrivateMB, 2)
      gdi = $r.Gdi
      user = $r.UserObjects
      listRows = $r.ListRows
      alive = $r.AliveAfterSettle
    }
  }
  return $rows
}

function Invoke-CliRuns {
  param([string[]]$ArgList)
  $rows = @()
  for ($i = 1; $i -le $Runs; $i++) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $out = & $Exe @ArgList 2>&1 | Out-String
    $sw.Stop()
    $rows += [pscustomobject]@{ run = $i; ms = $sw.ElapsedMilliseconds; exit = $LASTEXITCODE; chars = $out.Length }
  }
  return $rows
}

function Show-Rows($rows, [string]$title) {
  Write-Output ("==== " + $title + " ====")
  $rows | Format-Table -AutoSize | Out-String -Width 200 | Write-Output
}

$result = [ordered]@{}
$result["exe"] = $Exe
$result["label"] = $Label
$result["token"] = $tokenState
$result["childArgs"] = $ChildArgs

if ($Task -eq "notoken" -or $Task -eq "all") {
  # No token in this process's environment; children inherit the absence.
  Remove-Item -Path "Env:EV_GH_TOKEN" -ErrorAction SilentlyContinue
  $rows = Invoke-WindowRuns
  $rows | ForEach-Object { Write-Output ("no-token run " + $_.run + ": exitedEarly=" + $_.exitedEarly + " exitCode=" + $_.exitCode + " exitMs=" + $_.exitMs + " windowMs=" + $_.windowMs) }
  $result["notoken"] = $rows
  $msg = & $Exe "gui" 2>&1 | Out-String
  $result["notoken_message"] = $msg.Trim()
  $result["notoken_message_exit"] = $LASTEXITCODE
}

if ($Task -eq "window" -or $Task -eq "all") {
  if (-not $tokenPresent) { throw "window task needs a token (use -NoToken with -Task notoken)" }
  $v = (Get-ItemProperty 'HKCU:\Environment' -Name 'EV_GH_TOKEN').'EV_GH_TOKEN'
  Set-Item -Path "Env:EV_GH_TOKEN" -Value $v
  $rows = Invoke-WindowRuns
  $rows | ForEach-Object { Write-Output ("window run " + $_.run + ": windowMs=" + $_.windowMs + " visibleMs=" + $_.visibleMs + " responsiveMs=" + $_.responsiveMs + " wsMB=" + $_.wsMB + " peakWsMB=" + $_.peakWsMB + " privateMB=" + $_.privateMB + " gdi=" + $_.gdi + " user=" + $_.user + " listRows=" + $_.listRows + " alive=" + $_.alive) }
  if ($rows.Count -gt 0) {
    Write-Output ("window medianMs=" + (Get-Median ([double[]]($rows.windowMs))) + " visibleMedianMs=" + (Get-Median ([double[]]($rows.visibleMs))) + " responsiveMedianMs=" + (Get-Median ([double[]]($rows.responsiveMs))) + " wsMedianMB=" + (Get-Median ([double[]]($rows.wsMB))) + " privateMedianMB=" + (Get-Median ([double[]]($rows.privateMB))))
  }
  $result["window"] = $rows
}

if ($Task -eq "phases") {
  # Runs the window with INC_PERF_LOG set and prints the in-process phase marks
  # next to the externally observed window time, so the two can be compared.
  $dir = Join-Path $root "Infinity Cloud\tools\perf\_phases"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  for ($i = 1; $i -le $Runs; $i++) {
    $log = Join-Path $dir ("phase-run" + $i + ".log")
    Remove-Item $log -ErrorAction SilentlyContinue
    Set-Item -Path "Env:INC_PERF_LOG" -Value $log
    $r = [IncProbe]::Run($Exe, $ChildArgs, $TimeoutMs, $SettleMs, "InfinityCloudWindow")
    Remove-Item -Path "Env:INC_PERF_LOG" -ErrorAction SilentlyContinue
    Write-Output ("---- phases run " + $i + ": windowMs=" + $r.WindowMs + " visibleMs=" + $r.VisibleMs + " responsiveMs=" + $r.ResponsiveMs + " exitEarly=" + $r.ExitedEarly + " ----")
    if (Test-Path $log) { Get-Content $log | ForEach-Object { Write-Output $_ } } else { Write-Output "no phase log" }
  }
}

if ($Task -eq "cli" -or $Task -eq "all") {
  if ($tokenPresent) { Set-Item -Path "Env:EV_GH_TOKEN" -Value ((Get-ItemProperty 'HKCU:\Environment' -Name 'EV_GH_TOKEN').'EV_GH_TOKEN') }
  $v = Invoke-CliRuns @("--version")
  Show-Rows $v "inc --version"
  $g = Invoke-CliRuns @("get")
  Show-Rows $g "inc get (sign-in + manifest)"
  $l = Invoke-CliRuns @("listf")
  Show-Rows $l "inc listf (sign-in + manifest + list)"
  Write-Output ("cli median: version=" + (Get-Median ([double[]]($v.ms))) + "ms  get=" + (Get-Median ([double[]]($g.ms))) + "ms  listf=" + (Get-Median ([double[]]($l.ms))) + "ms")
  $result["cli_version"] = $v
  $result["cli_get"] = $g
  $result["cli_listf"] = $l
}

if ($Task -eq "mem" -or $Task -eq "all") {
  if (-not $tokenPresent) { throw "mem task needs a token" }
  $v = (Get-ItemProperty 'HKCU:\Environment' -Name 'EV_GH_TOKEN').'EV_GH_TOKEN'
  Set-Item -Path "Env:EV_GH_TOKEN" -Value $v
  $procName = [IO.Path]::GetFileNameWithoutExtension($Exe)
  $p = Start-Process -FilePath $Exe -ArgumentList $ChildArgs -PassThru
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.ElapsedMilliseconds -lt $TimeoutMs) {
    $p.Refresh()
    if ($p.HasExited) { break }
    if ($p.MainWindowHandle -ne 0) { break }
    Start-Sleep -Milliseconds 5
  }
  Start-Sleep -Seconds 3
  $inst = (Get-Counter "\Process($procName)\Working Set - Private" -ErrorAction SilentlyContinue).CounterSamples |
          Where-Object { $_.InstanceName -eq $procName } | Select-Object -First 1
  $instAll = (Get-Counter "\Process($procName*)\Working Set - Private" -ErrorAction SilentlyContinue).CounterSamples
  if (-not $inst -and $instAll) { $inst = $instAll | Select-Object -First 1 }
  $p.Refresh()
  Write-Output ("mem: pid=" + $p.Id + " privateWorkingSetMB=" + [math]::Round(($inst.CookedValue / 1MB), 2) + " privateBytes64MB=" + [math]::Round(($p.PrivateMemorySize64 / 1MB), 2) + " workingSet64MB=" + [math]::Round(($p.WorkingSet64 / 1MB), 2) + " aliveAfterSettle=" + (-not $p.HasExited) + " mainWindow=" + $p.MainWindowHandle)
  $result["mem_privateWorkingSetMB"] = [math]::Round(($inst.CookedValue / 1MB), 2)
  $result["mem_privateBytes64MB"] = [math]::Round(($p.PrivateMemorySize64 / 1MB), 2)
  $result["mem_workingSet64MB"] = [math]::Round(($p.WorkingSet64 / 1MB), 2)
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
}

if ($Task -eq "sizes" -or $Task -eq "all") {
  $files = @(
    (Join-Path $root "cpp\build\inc.exe"),
    (Join-Path $root "cpp\out\inc\inc_gui.exe"),
    (Join-Path $root "cpp\release\v1.0pre4\InfinityCloud_1.0.0-pre4_win64_setup.exe"),
    (Join-Path $root "Infinity Cloud\release\InfinityCloud.exe")
  )
  foreach ($f in $files) {
    if (Test-Path $f) {
      $fi = Get-Item $f
      $h = (Get-FileHash $f -Algorithm SHA256).Hash
      Write-Output ("size " + $fi.Length + "  " + $h + "  " + $fi.FullName)
      $result[("size:" + $fi.Name)] = [ordered]@{ bytes = $fi.Length; sha256 = $h }
    }
  }
}

if (-not [string]::IsNullOrEmpty($Json)) {
  ($result | ConvertTo-Json -Depth 6) | Set-Content -Path $Json -Encoding UTF8
  Write-Output ("json written: " + $Json)
}
