# build.ps1 - build the WebView2 host and stage the app payload (no kernel shipped).
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path (Join-Path $here '..\..\..')).Path
$out  = Join-Path $root 'work\webview2'
$sdk  = Join-Path $out '_sdk\extracted\build\native'
$inc  = Join-Path $sdk 'include'
New-Item -ItemType Directory -Force $out | Out-Null

$gcc = (Get-Command gcc -ErrorAction SilentlyContinue).Source
if (-not $gcc) {
  $cand = Get-ChildItem 'C:\Users\*\AppData\Local\Microsoft\WinGet\Packages\*\mingw64\bin\gcc.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($cand) { $gcc = $cand.FullName }
}
if (-not $gcc) { throw 'gcc not found (need MinGW-w64 / WinLibs in PATH)' }
Write-Host ('gcc: ' + $gcc)

$exe = Join-Path $out 'webview2-host.exe'
$gccArgs = @('-m64','-O2','-w','-s','-municode','-static','-static-libgcc','-static-libstdc++','-std=c99',
  ('-I' + $inc), ('-I' + $here), (Join-Path $here 'main.c'), '-o', $exe,
  '-lole32','-loleaut32','-luuid','-lshell32','-ladvapi32','-luser32','-lkernel32')
& $gcc @gccArgs
if ($LASTEXITCODE -ne 0) { throw ('compile failed ' + $LASTEXITCODE) }

# app payload: the loader DLL ships with the app (the runtime itself does not)
Copy-Item (Join-Path $sdk 'x64\WebView2Loader.dll') (Join-Path $out 'WebView2Loader.dll') -Force

# UI: copy the delivered Edge shell (read-only source) into the app payload
$ui = Join-Path $out 'ui'
if (Test-Path $ui) { Remove-Item -Recurse -Force $ui }
New-Item -ItemType Directory -Force $ui | Out-Null
$edgeUi = Join-Path $root 'work\edge-ui'
foreach ($item in 'index.html','newtab.html','assets','apps') {
  Copy-Item -Recurse -Force (Join-Path $edgeUi $item) (Join-Path $ui $item)
}

$exeLen = (Get-Item $exe).Length
$dllLen = (Get-Item (Join-Path $out 'WebView2Loader.dll')).Length
$uiStat = Get-ChildItem -Recurse -Force $ui -File | Measure-Object Length -Sum
Write-Host ('host exe   : ' + $exeLen + ' bytes')
Write-Host ('loader dll : ' + $dllLen + ' bytes')
Write-Host ('ui assets  : ' + $uiStat.Sum + ' bytes / ' + $uiStat.Count + ' files')
Write-Host 'build ok'