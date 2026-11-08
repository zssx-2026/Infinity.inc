<#
run-tests.ps1 - the whole preview check, in one command.

It builds the patched Infinity Cloud application (proving the patch compiles as
the product, not as a fragment), builds the harness, starts the Range server
from tests/range-server.mjs on a loopback port, runs the harness against it,
verifies the pulled zip entries, checks the request log and the page module, and
then kills the server by the PID it started.

  powershell -File "Infinity Cloud\preview\tests\run-tests.ps1"            # fast path
  powershell -File "Infinity Cloud\preview\tests\run-tests.ps1" -With8s    # + the real 8 s timeout

Everything it writes goes to tests/_out/ (and generated/, via apply-preview).
Nothing outside "Infinity Cloud/" is touched, no window is shown, and the only
network traffic is the harness talking to 127.0.0.1.
#>
param(
  [switch]$With8s,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$here = $PSScriptRoot
$preview = Split-Path -Parent $here
$inc = Split-Path -Parent $preview
$root = Split-Path -Parent $inc
$node = "D:\program\nodejs\node.exe"
$out = Join-Path $here "_out"
New-Item -ItemType Directory -Force -Path $out | Out-Null

$log = Join-Path $out "run.log"
Remove-Item $log -ErrorAction SilentlyContinue
Remove-Item (Join-Path $out "requests.jsonl") -ErrorAction SilentlyContinue

function Say([string]$message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss.fff"), $message
  Write-Host $line
  Add-Content -Path $log -Value $line
}

function Quote([string]$s) { if ($s -match '\s') { return '"' + $s + '"' } return $s }

$result = @{}

# ------------------------------------------------------------ generate + fixtures
Say "apply-preview.mjs (generates generated/ and preview.patch)"
& $node (Join-Path $preview "apply-preview.mjs") 2>&1 | ForEach-Object { Say ("  " + $_) }
$result.apply = $LASTEXITCODE

Say "make-fixtures.mjs"
& $node (Join-Path $here "make-fixtures.mjs") 2>&1 | ForEach-Object { Say ("  " + $_) }
$result.fixtures = $LASTEXITCODE

# ------------------------------------------------------------ compile the app
$coreSrc = (Get-ChildItem (Join-Path $root "cpp\core\src\*.cpp") | ForEach-Object { $_.FullName })
$libs = @("-static", "-static-libgcc", "-static-libstdc++", "-lwinhttp", "-lbcrypt", "-lshell32",
          "-lcomctl32", "-lws2_32", "-lgdi32", "-lcomdlg32", "-lole32", "-luser32", "-loleaut32", "-luuid")

if (-not $SkipBuild) {
  Say "g++ the patched Infinity Cloud application"
  $appArgs = @("-std=c++17", "-O2", "-Wall", "-Wextra", "-Wno-unused-parameter", "-DWIN32_LEAN_AND_MEAN",
               "-I", (Join-Path $preview "generated"),
               "-I", (Join-Path $root "cpp\apps\inc"),
               "-I", (Join-Path $root "cpp\core\include"),
               "-I", (Join-Path $root "cpp\common"),
               (Join-Path $preview "generated\main.cpp")) + $coreSrc + @((Join-Path $root "cpp\common\unblock.cpp")) +
              @("-o", (Join-Path $preview "build\inc-preview.exe")) + $libs
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $appOut = & g++ @appArgs 2>&1
  $sw.Stop()
  $appOut | Set-Content -Path (Join-Path $out "app-compile.log") -Encoding UTF8
  $warnings = @($appOut | Select-String "warning:").Count
  Say ("  exit=" + $LASTEXITCODE + " warnings=" + $warnings + " ms=" + $sw.ElapsedMilliseconds)
  $result.appCompile = $LASTEXITCODE

  Say "g++ the harness"
  $hArgs = @("-std=c++17", "-O2", "-Wall", "-Wextra", "-Wno-unused-parameter", "-DWIN32_LEAN_AND_MEAN",
             "-I", (Join-Path $preview "generated"),
             "-I", (Join-Path $root "cpp\core\include"),
             "-I", (Join-Path $root "cpp\common"),
             (Join-Path $here "preview_harness.cpp")) + $coreSrc + @((Join-Path $root "cpp\common\unblock.cpp")) +
            @("-o", (Join-Path $out "preview_harness.exe")) + $libs
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $hOut = & g++ @hArgs 2>&1
  $sw.Stop()
  $hOut | Set-Content -Path (Join-Path $out "harness-compile.log") -Encoding UTF8
  Say ("  exit=" + $LASTEXITCODE + " warnings=" + @($hOut | Select-String "warning:").Count + " ms=" + $sw.ElapsedMilliseconds)
  $result.harnessCompile = $LASTEXITCODE
}

# ------------------------------------------------------------ the Range server
$serverOut = Join-Path $out "server.out"
Remove-Item $serverOut -ErrorAction SilentlyContinue
$serverArgs = @((Join-Path $here "range-server.mjs"),
  "--root", (Join-Path $here "_fixtures"),
  "--log", (Join-Path $out "requests.jsonl"),
  "--max-span", "262144",
  "--fail-first", "retry.bin=2",
  "--delay", "slow.bin=2000",
  "--delay", "slow8.bin=9000",
  "--delay", "cancel2.bin=2000",
  "--delay", "cancelpart2.bin=2000")
$argLine = (($serverArgs | ForEach-Object { Quote $_ }) -join " ")
# Start-Process copies the process environment through a case-insensitive dictionary, which
# throws when the environment holds both NO_PROXY and no_proxy. When that happens, launch
# through cmd.exe with the output redirected to the same files, so the test still runs.
function Start-RangeServer {
  param([string]$File, [string]$Arguments, [string]$StdOut, [string]$StdErr)
  try {
    return Start-Process -FilePath $File -ArgumentList $Arguments -PassThru -WindowStyle Hidden `
      -RedirectStandardOutput $StdOut -RedirectStandardError $StdErr
  } catch {
    Say ("Start-Process failed (" + $_.Exception.Message + "); using cmd.exe instead")
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $env:ComSpec
    $psi.Arguments = '/c ""' + $File + '" ' + $Arguments + ' > "' + $StdOut + '" 2> "' + $StdErr + '""'
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    return [System.Diagnostics.Process]::Start($psi)
  }
}
$proc = Start-RangeServer -File $node -Arguments $argLine -StdOut $serverOut -StdErr (Join-Path $out "server.err")
Say ("range server pid " + $proc.Id)

$port = $null
for ($i = 0; $i -lt 100; $i++) {
  Start-Sleep -Milliseconds 200
  if (Test-Path $serverOut) {
    $text = Get-Content $serverOut -Raw -ErrorAction SilentlyContinue
    if ($text -match "LISTENING (\d+)") { $port = $Matches[1]; break }
  }
}
if (-not $port) { Say "server never printed LISTENING"; if ($proc -and -not $proc.HasExited) { & taskkill.exe /PID $proc.Id /T /F | Out-Null }; exit 3 }
Say ("range server ready on 127.0.0.1:" + $port)

try {
  # ---------------------------------------------------------- the harness
  $hRun = @("--base", ("http://127.0.0.1:" + $port), "--dir", (Join-Path $here "_fixtures"), "--out", $out)
  if ($With8s) { $hRun += "--with-8s" }
  Say "preview_harness.exe"
  $hLines = & (Join-Path $out "preview_harness.exe") @hRun 2>&1
  $result.harness = $LASTEXITCODE
  $hLines | Set-Content -Path (Join-Path $out "harness.jsonl") -Encoding UTF8
  $hLines | ForEach-Object { Say ("  " + $_) }

  # ---------------------------------------------------------- entries
  # Every entry the harness pulled is put through the same crc/length check
  # against the archive it came from. The data-descriptor and zip64 entries get
  # the same treatment, so "the parser understood it" is not taken on faith.
  $zipJson = Join-Path $here "_fixtures\sample.zip.json"
  $verifyCases = @(
    @{ json = "sample.zip.json";     entries = @("hello.txt", "stored.txt", "data.bin") },
    @{ json = "descriptor.zip.json"; entries = @("desc-stored.bin") },
    @{ json = "zip64.zip.json";      entries = @("z64-hello.txt", "z64-big.bin") }
  )
  foreach ($case in $verifyCases) {
    $caseJson = Join-Path $here ("_fixtures\" + $case.json)
    foreach ($name in $case.entries) {
      Say ("verify-entry " + $name)
      $vLines = & $node (Join-Path $here "verify-entry.mjs") "--expected" $caseJson "--entry" $name `
        "--bytes" (Join-Path $out ("entry-" + $name + ".bin")) "--out" (Join-Path $out ("verify-" + $name + ".json")) 2>&1
      $result["verify-" + $name] = $LASTEXITCODE
      $vLines | ForEach-Object { Say ("  " + $_) }
    }
  }

  # The delayed answers finish logging after the client has given up; give them
  # a moment so the wire check sees every attempt.
  Start-Sleep -Seconds 6

  Say "check-requests.mjs"
  $cLines = & $node (Join-Path $here "check-requests.mjs") "--log" (Join-Path $out "requests.jsonl") `
    "--expected" $zipJson "--out" (Join-Path $out "check-requests.json") 2>&1
  $result.wire = $LASTEXITCODE
  $cLines | ForEach-Object { Say ("  " + $_) }

  Say "ui-preview.test.mjs"
  $uLines = & $node (Join-Path $here "ui-preview.test.mjs") "--out" (Join-Path $out "ui-preview.json") 2>&1
  $result.ui = $LASTEXITCODE
  $uLines | ForEach-Object { Say ("  " + $_) }
}
finally {
  if ($proc -and -not $proc.HasExited) {
    Say ("killing pid " + $proc.Id + " and its children")
    & taskkill.exe /PID $proc.Id /T /F | Out-Null
  }
}

# ------------------------------------------------------------ hashes
$hashed = @(
  (Join-Path $preview "preview.hpp"),
  (Join-Path $preview "apply-preview.mjs"),
  (Join-Path $preview "preview.patch"),
  (Join-Path $preview "assets\preview-routes.inc"),
  (Join-Path $preview "assets\preview-ui.html"),
  (Join-Path $preview "assets\preview-ui.css"),
  (Join-Path $preview "assets\preview-ui.js"),
  (Join-Path $preview "assets\preview-math.js"),
  (Join-Path $preview "generated\main.cpp"),
  (Join-Path $preview "generated\ui.hpp"),
  (Join-Path $preview "generated\preview.hpp"),
  (Join-Path $here "preview_harness.cpp"),
  (Join-Path $here "range-server.mjs"),
  (Join-Path $here "make-fixtures.mjs"),
  (Join-Path $here "verify-entry.mjs"),
  (Join-Path $here "check-requests.mjs"),
  (Join-Path $here "ui-preview.test.mjs"),
  (Join-Path $here "run-tests.ps1"),
  (Join-Path $here "_fixtures\descriptor.zip"),
  (Join-Path $here "_fixtures\zip64.zip"),
  (Join-Path $here "_fixtures\zip64bad.zip"),
  (Join-Path $preview "build\inc-preview.exe"),
  (Join-Path $out "preview_harness.exe")
)
$hashLines = foreach ($f in $hashed) {
  if (Test-Path $f) {
    $h = (Get-FileHash -Algorithm SHA256 -Path $f).Hash.ToLower()
    ("{0}  {1}  {2}" -f $h, (Get-Item $f).Length, (Resolve-Path -Relative $f))
  }
}
$hashLines | Set-Content -Path (Join-Path $out "sha256.txt") -Encoding UTF8
Say "sha256 of changed files written to _out/sha256.txt"
$hashLines | ForEach-Object { Say ("  " + $_) }

$failed = @($result.Values | Where-Object { $_ -ne 0 }).Count
Say ("RESULT failures=" + $failed + " " + (($result.GetEnumerator() | ForEach-Object { $_.Key + "=" + $_.Value }) -join " "))
exit ([int]($failed -gt 0))
