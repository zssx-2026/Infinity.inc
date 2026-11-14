$ErrorActionPreference='Stop'
Set-Location 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
$gcc = 'C:\Users\REDMI\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin\gcc.exe'
$inc = 'work\webview2\_sdk\extracted\build\native\include'
$out = 'work\webview2-host-check.exe'
& $gcc -m64 -O2 -w -s -municode -static -static-libgcc -std=c99 -I $inc -I 'cpp\hosts\webview2' 'cpp\hosts\webview2\main.c' -o $out -lole32 -loleaut32 -luuid -lshell32 -ladvapi32 -luser32 -lkernel32 -lws2_32
Write-Output ('compile exit=' + $LASTEXITCODE)
if (Test-Path $out) { Write-Output ('exe bytes=' + (Get-Item $out).Length) }
