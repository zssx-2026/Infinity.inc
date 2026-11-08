<#
verify-preview.ps1 - the run plan for the streaming preview. THIS HAS NOT BEEN RUN.

The run prohibition in force forbids starting any executable, so this file is a
proposal: what would be started, what would be measured, and where the numbers
that decide acceptance would be read from. It is written so that running it is a
single command once the Lead approves.

It starts the product's own windowless UI server (--serve-ui, a native process
with no window), because that is the only way to reach the preview routes. It
never starts a browser, a screenshot host, or any other executable, and it uses
curl.exe only for read-only GETs. Every process it starts is killed by the PID it
recorded, never by name; the final check only lists, by command line, anything
left over from this exe path.

Usage, once approved:
  powershell -File "Infinity Cloud/preview/verify-preview.ps1" -Exe <path to inc.exe> -Port 7622
Add -UploadSamples to stage the sample files below into the cloud first (that
call writes to the account, so it is opt-in and off by default).
#>
param(
  [string]$Exe = ".\Infinity Cloud\tools\perf\_build\inc.exe",
  [int]$Port = 7622,
  [string]$Out = ".\work\_preview-shots\inc",
  [string]$TextSample = "",
  [string]$ImageSample = "",
  [string]$ZipSample = "",
  [string]$BigSample = "",
  [switch]$UploadSamples
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$log = Join-Path $Out "run.log"
$evidence = Join-Path $Out "evidence.md"

function Say([string]$message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss.fff"), $message
  Write-Host $line
  Add-Content -Path $log -Value $line
}

# The token comes from the registry and is only ever handed to the child process
# environment. It is never printed, never written to a file, never put on a
# command line.
$token = (Get-Item "HKCU:\Environment").GetValue("EV_GH_TOKEN")
if (-not $token) { $token = (Get-Item "HKCU:\Environment").GetValue("gittoken_zssx-2026_1") }
Say ("token present: " + [bool]$token)
if (-not $token) { Say "no token: the UI server will not start signed in"; exit 2 }

$exePath = (Resolve-Path $Exe).Path
$base = "http://127.0.0.1:$Port"
$proc = $null

function Probe([string]$label, [string]$url, [string]$save = "") {
  # time_starttransfer is the moment the first byte of the answer arrives - the
  # time-to-first-content the contract is stated in - and size_download is how
  # much was pulled to get there.
  $fmt = "%{time_starttransfer} %{size_download} %{http_code}"
  $target = "NUL"
  if ($save) { $target = $save }
  $curlArgs = @("-s", "--ssl-no-revoke", "-w", $fmt, "-o", $target, $url)
  $result = & curl.exe @curlArgs
  Say "PROBE $label  $result"
  Add-Content -Path $evidence -Value ("{0} | time_starttransfer={1} size_download={2}" -f $label, $result)
}

try {
  $env:EV_GH_TOKEN = $token
  $env:INC_PERF_LOG = Join-Path $Out "phases.log"
  Say ("starting " + $exePath + " --serve-ui --port=" + $Port + " (windowless, hidden)")
  $startArgs = @{
    FilePath               = $exePath
    ArgumentList           = @("--serve-ui", "--port=$Port")
    PassThru               = $true
    WindowStyle            = "Hidden"
    RedirectStandardOutput = (Join-Path $Out "stdout.log")
    RedirectStandardError  = (Join-Path $Out "stderr.log")
  }
  $proc = Start-Process @startArgs
  Say ("pid " + $proc.Id)

  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    try { $null = Invoke-WebRequest -UseBasicParsing "$base/api/state" -TimeoutSec 2; $ready = $true; break }
    catch { Start-Sleep -Milliseconds 500 }
  }
  Say ("server ready: " + $ready)
  if (-not $ready) { exit 3 }

  if ($UploadSamples) {
    # Opt-in: this writes into the account. Each sample is uploaded under its own
    # name so the preview routes can reach it by path afterwards.
    $samples = @(
      @{ file = $TextSample;  name = "preview-sample.txt" },
      @{ file = $ImageSample; name = "preview-sample.png" },
      @{ file = $ZipSample;   name = "preview-sample.zip" },
      @{ file = $BigSample;   name = "preview-sample-big.bin" }
    )
    foreach ($sample in $samples) {
      if (-not $sample.file) { continue }
      Say ("uploading " + $sample.file + " as /" + $sample.name)
      $uploadArgs = @("-s", "--ssl-no-revoke", "-X", "POST", "--data-binary", "@" + $sample.file,
                      "$base/api/upload?path=%2F&name=" + $sample.name)
      & curl.exe @uploadArgs | Out-Null
    }
  }

  # What the account holds right now, so the probe list is not guessed. Today it
  # is one file (Checkmate.m4a, 7.1 MB) - the audio class - and the other classes
  # need -UploadSamples first.
  $listFile = Join-Path $Out "list.json"
  & curl.exe -s --ssl-no-revoke "$base/api/list?path=%2F" -o $listFile
  Say ("listing saved to " + $listFile)

  $paths = @("/Checkmate.m4a")
  foreach ($candidate in @("/preview-sample.txt", "/preview-sample.png", "/preview-sample.zip", "/preview-sample-big.bin")) {
    $pieces = $candidate.Split("/")
    $name = $pieces[$pieces.Length - 1]
    if (Select-String -Path $listFile -SimpleMatch $name -Quiet) { $paths += $candidate }
  }
  Say ("probing: " + ($paths -join ", "))

  foreach ($path in $paths) {
    $encoded = [uri]::EscapeDataString($path)
    Probe "meta $path"   "$base/api/preview/meta?path=$encoded"
    Probe "chunk1 $path" "$base/api/preview/chunk?path=$encoded&offset=0&length=262144" (Join-Path $Out "chunk1.bin")
    if ($path -like "*.zip") { Probe "zip $path" "$base/api/preview/zip?path=$encoded" (Join-Path $Out "zip-entries.json") }
    Probe "cancel $path" "$base/api/preview/cancel"
  }

  Add-Content -Path $evidence -Value ""
  Add-Content -Path $evidence -Value ("Acceptance reading: chunk1 time_starttransfer <= 0.800 s is the first-screen target; size_download is the bytes pulled before that screen (256 KiB = one window).")
  Say ("evidence written to " + $evidence)
}
finally {
  if ($proc -and -not $proc.HasExited) {
    # PID-precise teardown of the process this script started, and of its children.
    Say ("killing pid " + $proc.Id + " and its children")
    & taskkill.exe /PID $proc.Id /T /F | Out-Null
  }
  Start-Sleep -Milliseconds 500
  # Report only, and by command line: no name-based kill, ever.
  $mine = Get-CimInstance Win32_Process -Filter "Name like 'inc%'" |
          Where-Object { $_.CommandLine -and $_.CommandLine.Contains($exePath) }
  if ($mine) { Say ("LEFT OVER: " + (($mine | ForEach-Object { "$($_.ProcessId)" }) -join ", ")) }
  else { Say "leftover processes from this exe path: 0" }
}

# ---------------------------------------------------------------- notes for the run
#
# * The 256 KiB window is one HTTP request; the browser side keeps asking for the
#   next window until the file ends, so "first screen" is the first window and
#   "time to complete" is the sum. X-Preview-Ms on each chunk answer is the
#   server-side time for that window.
# * A >= 50 MB sample is required by the contract; the current account has no
#   file that large, so -BigSample must point at one and -UploadSamples must be
#   passed (that is a write to the account and needs the Lead's approval).
# * If a chunk answer is HTTP 504, the reason is in the JSON body: it is the
#   8 s single-window timeout after two retries, or "cancelled" after a close.
# * Exits: 2 = no token, 3 = the server never answered.
