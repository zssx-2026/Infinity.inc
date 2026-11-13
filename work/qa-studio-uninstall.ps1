[Console]::OutputEncoding=[Text.Encoding]::UTF8
$root = Join-Path $env:LOCALAPPDATA 'Programs\Infinity.Inc'
Get-Process -Name InfinityStudio,InfinityServer -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1
if (Test-Path $root) {
  Get-ChildItem $root -Directory | ForEach-Object {
    $u = Join-Path $_.FullName 'Uninstall.exe'
    if (Test-Path $u) {
      $q = Start-Process -FilePath $u -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden
      Write-Output ('uninstall ' + $_.Name + ' exit=' + $q.ExitCode)
    } else { Write-Output ('no uninstaller in ' + $_.Name) }
  }
}
Start-Sleep -Seconds 3
if (Test-Path $root) { Get-ChildItem $root -Directory | ForEach-Object { Write-Output ('leftover ' + $_.Name) } } else { Write-Output 'install_root_gone' }
Remove-Item -Recurse -Force (Join-Path $env:LOCALAPPDATA 'Infinity\Studio\downloads') -ErrorAction SilentlyContinue
Write-Output ('downloads_cleaned=' + (-not (Test-Path (Join-Path $env:LOCALAPPDATA 'Infinity\Studio\downloads'))))