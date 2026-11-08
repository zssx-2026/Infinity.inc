# build-sample.ps1 - rebuild work/itbt/FastBrowser.itbt from the real tool binary.
# The packer is the CMake host tool (cpp/build/itbt-pack.exe); a copy lives at
# work/itbt/itbt-pack.exe so the sample can be rebuilt without a full configure.
$ErrorActionPreference = 'Stop'
$source = 'D:/dev/DeepSeekHarnessWorkspace/fastbrowser/fastbrowser.exe'
$stage = 'work/itbt/sample/FastBrowser'
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item $source (Join-Path $stage 'fastbrowser.exe') -Force
& ./work/itbt/itbt-pack.exe --dir $stage --out work/itbt/FastBrowser.itbt
Write-Output "container sha256 $((Get-FileHash work/itbt/FastBrowser.itbt -Algorithm SHA256).Hash.ToLower())"
