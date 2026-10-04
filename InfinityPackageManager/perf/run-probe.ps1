# run-probe.ps1 - build and run the ipm self-timing probe.
#
#   powershell -ExecutionPolicy Bypass -File InfinityPackageManager/perf/run-probe.ps1
#
# Compiles cpp/apps/ipm/perf_probe.cpp by hand (it is deliberately not a CMake
# target) against the already-built static core, then runs it. Nothing here
# touches the product build.
param(
  [int]$Builds = 2000,
  [int]$Rounds = 200,
  [string]$HashFile = "InfinityPackageManager/InfinityPackageManager_win_v1.0.zip",
  [string]$OutDir = "$env:TEMP\ipm-probe"
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path '.').Path
$core = Join-Path $root 'cpp/build/libinc_core.a'
$common = Join-Path $root 'cpp/build/libinc_common.a'
if (!(Test-Path $core)) { throw "missing $core - build cpp first (ninja -C cpp/build ipm)" }
if (!(Test-Path $common)) { $common = $null }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$exe = Join-Path $OutDir 'ipm_probe.exe'

$flags = @(
  '-O3','-DNDEBUG','-std=c++17','-Wall','-Wextra','-Wno-unused-parameter',
  '-I', (Join-Path $root 'cpp/core/include'),
  '-I', (Join-Path $root 'cpp/common'),
  '-I', (Join-Path $root 'cpp/apps/ipm'),
  '-static','-static-libgcc','-static-libstdc++','-s'
)
$libs = @($core) + $(if ($common) { @($common) } else { @() }) + @('-lwinhttp','-lbcrypt','-lshell32','-lcomctl32','-lws2_32',
          '-lkernel32','-luser32','-lgdi32','-lwinspool','-lole32','-loleaut32',
          '-luuid','-lcomdlg32','-ladvapi32')

$src = Join-Path $root 'cpp/apps/ipm/perf_probe.cpp'
Write-Host "g++ $src -> $exe"
& g++ @flags -o $exe $src @libs
if ($LASTEXITCODE -ne 0) { throw "probe compile failed" }

$hash = (Resolve-Path $HashFile).Path
"probe exe bytes = " + (Get-Item $exe).Length
"builds=$Builds rounds=$Rounds hash=$hash"
& $exe $Builds $Rounds $hash
