[Console]::OutputEncoding=[Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'
$p = Start-Process -FilePath 'node' -ArgumentList 'InfinityStudio/src/cli.js','7799' -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 3
Write-Output ('server_pid=' + $p.Id)
node work/qa-studio-remote.mjs
Write-Output ('qa_exit=' + $LASTEXITCODE)
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
$root = Join-Path $env:LOCALAPPDATA 'Programs\Infinity.Inc'
Get-ChildItem $root -Directory | ForEach-Object {
  $f = Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue
  Write-Output ('product=' + $_.Name + ' files=' + $f.Count + ' bytes=' + (($f | Measure-Object Length -Sum).Sum))
}