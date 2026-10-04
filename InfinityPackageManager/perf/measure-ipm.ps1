# measure-ipm.ps1 - the end-to-end metrics for one ipm binary.
#
#   powershell -ExecutionPolicy Bypass -NoProfile -File InfinityPackageManager/perf/measure-ipm.ps1 -Exe cpp/build/ipm.exe
#
# Everything it prints is the raw value plus the command that produced it is
# recorded in work/perf-ipm.md. The GitHub token is taken from the user
# environment when it is not already in this process; it is never printed.
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
$hash = (Get-FileHash -Algorithm SHA256 $exePath).Hash
"tag               = $Tag"
"exe               = $exePath"
"exe_bytes         = " + $item.Length
"exe_sha256        = $hash"
"exe_built_utc     = " + $item.LastWriteTimeUtc.ToString('yyyy-MM-ddTHH:mm:ssZ')
"token_present     = " + [bool]$env:EV_GH_TOKEN

# ------------------------------------------------------------- cold start
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

# ------------------------------------------------------------- catalogue
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
$catalogMedian = $catalogSorted[[int][Math]::Floor($catalogSorted.Count / 2)]
"catalog_ms_runs   = " + ($catalog -join ',')
"catalog_ms_median = $catalogMedian"
"catalog_builds    = $buildCount"

# ------------------------------------------------------------- serve-ui
$stage = Join-Path $env:TEMP ("ipm-perf-" + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force -Path $stage | Out-Null
$runExe = Join-Path $stage 'ipm_cli.exe'
Copy-Item $exePath $runExe

$proc = Start-Process -FilePath $runExe -ArgumentList @('--serve-ui', "--port=$Port") -PassThru -WindowStyle Hidden
$base = "http://127.0.0.1:$Port"
$sw = [Diagnostics.Stopwatch]::StartNew()
$firstOk = -1
try {
  while ($sw.Elapsed.TotalSeconds -lt 90) {
    if ($proc.HasExited) { break }
    try {
      $r = Invoke-WebRequest -Uri "$base/" -UseBasicParsing -TimeoutSec 5
      if ($r.StatusCode -eq 200) { $firstOk = [int]$sw.Elapsed.TotalMilliseconds; break }
    } catch { Start-Sleep -Milliseconds 25 }
  }
} finally { }
"server_first_ok_ms = $firstOk"
"process_exited     = " + $proc.HasExited

if ($firstOk -ge 0) {
  $swState = [Diagnostics.Stopwatch]::StartNew()
  $state = Invoke-WebRequest -Uri "$base/api/state" -UseBasicParsing -TimeoutSec 60
  $swState.Stop()
  "state_ms           = " + [int]$swState.Elapsed.TotalMilliseconds
  "state_bytes        = " + $state.RawContentLength

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
if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
"done"
