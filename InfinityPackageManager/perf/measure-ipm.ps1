# measure-ipm.ps1 - the end-to-end metrics for one ipm binary.
#
#   powershell -ExecutionPolicy Bypass -NoProfile -File InfinityPackageManager/perf/measure-ipm.ps1 -Exe cpp/build/ipm.exe -Tag after
#
# No window is ever shown: the program under test is started with
# STARTUPINFO.wShowWindow = SW_HIDE (-WindowStyle Hidden), it is a console
# program serving loopback HTTP, and it is killed in a finally block. The
# script reports the number of leftover processes so a silent survivor is
# visible rather than assumed away. The GitHub token is read from the user
# environment when the process does not already have one, and is never printed.
param(
  [string]$Exe = "cpp/build/ipm.exe",
  [int]$Port = 17632,
  [int]$StartupRuns = 5,
  [int]$CatalogRuns = 3,
  [string]$Tag = "binary"
)

$ErrorActionPreference = 'Stop'
if (-not $env:EV_GH_TOKEN) { $env:EV_GH_TOKEN = [Environment]::GetEnvironmentVariable('EV_GH_TOKEN','User') }

$exePath = (Resolve-Path $Exe).Path
$item = Get-Item $exePath
"tag               = $Tag"
"exe               = $exePath"
"exe_bytes         = " + $item.Length
"exe_sha256        = " + (Get-FileHash -Algorithm SHA256 $exePath).Hash
"exe_built_utc     = " + $item.LastWriteTimeUtc.ToString('yyyy-MM-ddTHH:mm:ssZ')
"token_present     = " + [bool]$env:EV_GH_TOKEN

$starts = @()
for ($i = 0; $i -lt $StartupRuns; $i++) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  & $exePath --version | Out-Null
  $sw.Stop()
  $starts += [int]$sw.Elapsed.TotalMilliseconds
}
$sorted = $starts | Sort-Object
$median = $sorted[[int][Math]::Floor($sorted.Count / 2)]
"startup_ms_runs   = " + ($starts -join ',')
"startup_ms_median = $median"

$catalog = @()
$buildCount = 0
for ($i = 0; $i -lt $CatalogRuns; $i++) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $text = (& $exePath catalog 2>&1 | Out-String)
  $sw.Stop()
  $catalog += [int]$sw.Elapsed.TotalMilliseconds
  $buildCount = (($text -split "\`n") | Where-Object { $_.Trim() -ne '' }).Count
}
$catalogSorted = $catalog | Sort-Object
"catalog_ms_runs   = " + ($catalog -join ',')
"catalog_ms_median = " + $catalogSorted[[int][Math]::Floor($catalogSorted.Count / 2)]
"catalog_builds    = $buildCount"

$stage = Join-Path $env:TEMP ("ipm-perf-" + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force -Path $stage | Out-Null
$runExe = Join-Path $stage 'ipm_cli.exe'
Copy-Item $exePath $runExe

$proc = $null
try {
  $proc = Start-Process -FilePath $runExe -ArgumentList @('--serve-ui', "--port=$Port") -PassThru -WindowStyle Hidden
  $base = "http://127.0.0.1:$Port"
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $firstOk = -1
  while ($sw.Elapsed.TotalSeconds -lt 90) {
    if ($proc.HasExited) { break }
    try {
      $r = Invoke-WebRequest -Uri "$base/" -UseBasicParsing -TimeoutSec 5
      if ($r.StatusCode -eq 200) { $firstOk = [int]$sw.Elapsed.TotalMilliseconds; break }
    } catch { Start-Sleep -Milliseconds 25 }
  }
  "server_first_ok_ms = $firstOk"
  "process_exited     = " + $proc.HasExited

  if ($firstOk -ge 0) {
    $swState = [Diagnostics.Stopwatch]::StartNew()
    $state = Invoke-WebRequest -Uri "$base/api/state" -UseBasicParsing -TimeoutSec 60
    $swState.Stop()
    $parsed = $state.Content | ConvertFrom-Json
    "state_ms           = " + [int]$swState.Elapsed.TotalMilliseconds
    "state_bytes        = " + $state.RawContentLength
    "state_builds       = " + $parsed.summary.builds
    "state_installable  = " + $parsed.summary.installable
    "state_packages     = " + ($parsed.packages.Count)
    "state_first_digest = " + $parsed.packages[0].digest

    $swSearch = [Diagnostics.Stopwatch]::StartNew()
    $search = Invoke-WebRequest -Uri "$base/api/search?q=windows-x64" -UseBasicParsing -TimeoutSec 60
    $swSearch.Stop()
    "search_ms          = " + [int]$swSearch.Elapsed.TotalMilliseconds
    "search_bytes       = " + $search.RawContentLength

    Start-Sleep -Seconds 2
    $proc.Refresh()
    "idle_ws_mb         = " + [Math]::Round($proc.WorkingSet64 / 1MB, 2)
    "idle_private_mb    = " + [Math]::Round($proc.PrivateMemorySize64 / 1MB, 2)
    try {
      $counter = (Get-Counter "\Process(ipm_cli)\Working Set - Private" -ErrorAction Stop).CounterSamples[0].CookedValue
      "idle_private_ws_mb = " + [Math]::Round($counter / 1MB, 2)
    } catch { "idle_private_ws_mb = (counter unavailable)" }
  }
} finally {
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 300
  $left = @(Get-Process -Name 'ipm_cli','ipm','ipm_gui','ipm_tui' -ErrorAction SilentlyContinue)
  "leftover_processes = " + $left.Count
  if ($left.Count -gt 0) { $left | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } }
  Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
}
"done"
