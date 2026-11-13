[Console]::OutputEncoding=[Text.Encoding]::UTF8
$ErrorActionPreference='Stop'
$setup = Join-Path (Get-Location) 'cpp\release\v1.0pre8\InfinityStudio_1.0.0-pre8_win64_setup.exe'
$root = Join-Path $env:LOCALAPPDATA 'Programs\Infinity.Inc'
Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $env:APPDATA 'infinity-shell') -ErrorAction SilentlyContinue
Write-Output ('setup=' + $setup + ' bytes=' + (Get-Item $setup).Length)
$p = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden
Write-Output ('install_exit=' + $p.ExitCode)
if (Test-Path $root) {
  foreach ($d in Get-ChildItem $root -Directory) {
    $files = Get-ChildItem $d.FullName -Recurse -File -ErrorAction SilentlyContinue
    $bytes = ($files | Measure-Object Length -Sum).Sum
    Write-Output ('product=' + $d.Name + ' files=' + $files.Count + ' bytes=' + $bytes)
    Get-ChildItem $d.FullName -File -Filter *.exe | ForEach-Object { Write-Output ('  exe ' + $_.Name + ' ' + $_.Length) }
    Get-ChildItem $d.FullName -Directory | ForEach-Object { Write-Output ('  dir ' + $_.Name) }
  }
} else { Write-Output 'NO_INSTALL_DIR' }