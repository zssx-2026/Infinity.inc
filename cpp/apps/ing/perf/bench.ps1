# bench.ps1 - the measurement harness for Infinity Games (ING).
#
# Part of cpp/apps/ing/perf/. It builds a synthetic library under an isolated
# LOCALAPPDATA and measures the metrics the task asks for, so every number in
# work/perf-ing.md can be reproduced with the same command.
#
#   powershell -NoProfile -File cpp/apps/ing/perf/bench.ps1 -Exe cpp/build/ing.exe -DataRoot C:\tmp\ing-bench -Scenario list -Count 500
#
# Notes that matter for reading the numbers:
#   * every scenario runs as a fresh process; the first launch is discarded as
#     a warm-up, then 5 measured reps are reported with their median.
#   * the serve scenario gives every rep its own port. Rebinding the same port
#     within ~500 ms of killing the previous listener makes loopback connects
#     stall for about half a second, which is an OS artifact and not startup
#     time of this program.
#   * readiness is "curl got a response", and route times are curl's own
#     time_total, not the time it took to spawn curl.
#   * "first frame" is process start -> the last of the five resources the
#     page loads on start ('/', app.css, app.js, api/state, api/games).
param(
  [Parameter(Mandatory=$true)][string]$Exe,
  [Parameter(Mandatory=$true)][string]$DataRoot,
  [ValidateSet('version','list','info','run-missing','serve','gen')][string]$Scenario = 'list',
  [int]$Count = 0,
  [int]$Reps = 5,
  [int]$Port = 17664,
  [string]$GameName = 'game-0007',
  [int]$IdleMs = 800
)

$ErrorActionPreference = 'Stop'
$Exe = (Resolve-Path $Exe).Path
$DataRoot = [System.IO.Path]::GetFullPath($DataRoot)
$env:LOCALAPPDATA = Join-Path $DataRoot 'LocalAppData'

function Median([double[]]$v) {
  $s = $v | Sort-Object
  $n = $s.Count
  if ($n -eq 0) { return 0 }
  if ($n % 2 -eq 1) { return [double]$s[[int](($n - 1) / 2)] }
  return [double](($s[$n / 2 - 1] + $s[$n / 2]) / 2)
}

function New-Library([int]$n, [string]$root) {
  $dir = Join-Path $root 'LocalAppData\Infinity.Inc\games'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $present = $Exe
  $missing = Join-Path $root 'gone\nope.exe'
  $games = New-Object System.Collections.Generic.List[string]
  for ($i = 1; $i -le $n; $i++) {
    $name = 'game-{0:d4}' -f $i
    if ($i % 5 -eq 0) {
      $url = 'https://example' + $i + '.example.com/play'
      $games.Add('{"name":"' + $name + '","kind":"online","url":"' + $url + '","addedAt":"2026-01-01 00:00","lastPlayed":""}')
    } elseif ($i % 7 -eq 0) {
      $games.Add('{"name":"' + $name + '","kind":"local","path":"' + $missing.Replace('\','\\') + '","addedAt":"2026-01-01 00:00","lastPlayed":""}')
    } else {
      $games.Add('{"name":"' + $name + '","kind":"local","path":"' + $present.Replace('\','\\') + '","addedAt":"2026-01-01 00:00","lastPlayed":""}')
    }
  }
  $body = '{"version":1,"games":[' + ($games -join ',') + ']}'
  $path = Join-Path $dir 'library.json'
  [System.IO.File]::WriteAllText($path, $body, (New-Object System.Text.UTF8Encoding($false)))
  return @{ path = $path; bytes = (Get-Item $path).Length }
}

function Get-PrivateWorkingSet([int]$processId) {
  try {
    $row = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter "IDProcess=$processId" -ErrorAction Stop
    if ($row -and $row.WorkingSetPrivate -gt 0) { return [double]$row.WorkingSetPrivate }
  } catch { }
  return [double](Get-Process -Id $processId).PrivateMemorySize64
}

function Invoke-Cli([string]$argLine, [double[]]$samples) {
  for ($r = -1; $r -lt $Reps; $r++) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Exe
    $psi.Arguments = $argLine
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true          # headless: no console window may appear
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $p = [System.Diagnostics.Process]::Start($psi)
    $outText = $p.StandardOutput.ReadToEnd()
    $p.WaitForExit()
    $sw.Stop()
    if ($r -ge 0) { $samples[$r] = $sw.Elapsed.TotalMilliseconds }
    if ($r -le 0) { $script:lastOut = $outText; $script:lastCode = $p.ExitCode }
  }
}

$result = [ordered]@{}
$result.scenario = $Scenario
$result.exe = $Exe

if ($Scenario -eq 'gen') {
  $libInfo = New-Library -n $Count -root $DataRoot
  $result.libraryBytes = $libInfo.bytes
  $result.libraryPath = $libInfo.path
  $result | ConvertTo-Json -Depth 5 -Compress
  exit 0
}

if ($Scenario -eq 'serve') {
  $libInfo = New-Library -n $Count -root $DataRoot
  $result.libraryBytes = $libInfo.bytes
  $routes = @('/','/app.css','/app.js','/api/state','/api/games')
  $listen = @(); $firstFrame = @(); $memIdle = @()
  $routeMs = @{}; $routeBytes = @{}; $routeSamples = @{}
  & curl.exe --version 2>$null | Out-Null   # warm curl's own process start
  for ($r = -1; $r -lt $Reps; $r++) {
    $p = $null
    $repPort = $Port + 1 + $r
    try {
      $psi = New-Object System.Diagnostics.ProcessStartInfo
      $psi.FileName = $Exe
      $psi.Arguments = "--serve-ui --port=$repPort"
      $psi.UseShellExecute = $false
      $psi.CreateNoWindow = $true        # headless: --serve-ui is a server, not a window
      $psi.RedirectStandardOutput = $true
      $psi.RedirectStandardError = $true
      $sw = [System.Diagnostics.Stopwatch]::StartNew()
      $p = [System.Diagnostics.Process]::Start($psi)
      $errTask = $p.StandardError.ReadToEndAsync()
      # wait until the server answers; the first response is the readiness moment
      $tListen = $null
      while ($sw.Elapsed.TotalMilliseconds -lt 20000) {
        $out = & curl.exe -s -o NUL -w '%{time_total}' --connect-timeout 0.05 --max-time 3 "http://127.0.0.1:$repPort/" 2>$null
        if ($LASTEXITCODE -eq 0) { $tListen = [double]$out; break }
        if ($p.HasExited) { break }
      }
      $readyMs = $sw.Elapsed.TotalMilliseconds
      if ($null -eq $tListen) {
        $code = if ($p.HasExited) { $p.ExitCode } else { 'running' }
        throw "server never answered on port $repPort (exit=$code, err=[$($errTask.Result)])"
      }
      if ($r -lt 0) { continue }
      $listen += $readyMs
      $lastMs = $readyMs
      foreach ($route in $routes) {
        $w = & curl.exe -s -o NUL -w '%{http_code} %{time_total} %{size_download}' --max-time 10 "http://127.0.0.1:$repPort$route" 2>$null
        $parts = $w -split ' '
        $elapsedRoute = $sw.Elapsed.TotalMilliseconds
        $lastMs = $elapsedRoute
        $routeMs[$route] = [math]::Round(([double]$parts[1]) * 1000.0, 2)
        $routeBytes[$route] = [int]$parts[2]
        if (-not $routeSamples.ContainsKey($route)) { $routeSamples[$route] = @() }
        $routeSamples[$route] += [math]::Round(([double]$parts[1]) * 1000.0, 2)
      }
      $firstFrame += $lastMs
      Start-Sleep -Milliseconds $IdleMs
      $memIdle += Get-PrivateWorkingSet -processId $p.Id
    } finally {
      if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force; $p.WaitForExit() }
      Start-Sleep -Milliseconds 250
    }
  }
  $result.listenMs = @($listen | ForEach-Object { [math]::Round($_, 2) })
  $result.listenMedianMs = [math]::Round((Median $listen), 2)
  $result.firstFrameMs = @($firstFrame | ForEach-Object { [math]::Round($_, 2) })
  $result.firstFrameMedianMs = [math]::Round((Median $firstFrame), 2)
  $result.privateWorkingSetIdleMB = @($memIdle | ForEach-Object { [math]::Round($_ / 1MB, 3) })
  $result.privateWorkingSetIdleMedianMB = [math]::Round((Median $memIdle) / 1MB, 3)
  $routeMedian = @{}
  foreach ($k in $routeSamples.Keys) { $routeMedian[$k] = [math]::Round((Median $routeSamples[$k]), 2) }
  $result.routeMedianMs = $routeMedian
  $result.routeMsLastRep = $routeMs
  $result.routeBytes = $routeBytes
} else {
  if ($Scenario -ne 'version') { $libInfo = New-Library -n $Count -root $DataRoot; $result.libraryBytes = $libInfo.bytes }
  switch ($Scenario) {
    'version'     { $argLine = '--version' }
    'list'        { $argLine = 'list' }
    'info'        { $argLine = "info $GameName" }
    'run-missing' { $argLine = "run $GameName" }
  }
  $result.args = $argLine
  $samples = New-Object 'double[]' $Reps
  Invoke-Cli -argLine $argLine -samples $samples
  $result.samplesMs = @($samples | ForEach-Object { [math]::Round($_, 2) })
  $result.medianMs = [math]::Round((Median $samples), 2)
  $result.minMs = [math]::Round(($samples | Measure-Object -Minimum).Minimum, 2)
  $result.exitCode = $script:lastCode
  $result.stdout = (($script:lastOut -split "\r?\n") | Select-Object -First 6) -join ' | '
}

$result | ConvertTo-Json -Depth 5 -Compress
