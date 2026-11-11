$ErrorActionPreference='Stop'
$tmp = Join-Path $PWD 'work\_qa-pre6'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$assets = @(
  @{ n='InfinityPackageManager_1.0.0-pre6_win64_setup.exe'; h='721f4dccf09a979a82f840da2d5abb08163415e9190dbd6d7ac564a6738f7b20'; u='https://github.com/zssx-2026/InfinityPackageManager/releases/download/v1.0.0-pre6/InfinityPackageManager_1.0.0-pre6_win64_setup.exe' },
  @{ n='InfinityToolbox_1.0.0-pre6_win64_setup.exe'; h='b76a84446891838d169e8d2cf1b9aeb19835cee0338b07074fdd92a98ed1d971'; u='https://github.com/zssx-2026/Infinity-Toolbox/releases/download/v1.0.0-pre6/InfinityToolbox_1.0.0-pre6_win64_setup.exe' }
)
$ok = 0
foreach ($a in $assets) {
  $f = Join-Path $tmp $a.n
  for ($i = 1; $i -le 4; $i++) {
    if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force }
    curl.exe -sSL --ssl-no-revoke --max-time 1800 --retry 3 --retry-delay 5 --retry-all-errors -o $f $a.u
    if ((Test-Path -LiteralPath $f) -and ((Get-Item -LiteralPath $f).Length -eq 83935056 -or (Get-Item -LiteralPath $f).Length -eq 83923176)) { break }
    Write-Output ('   retry ' + $i + ' ' + $a.n)
    Start-Sleep -Seconds 5
  }
  if (-not (Test-Path -LiteralPath $f)) { Write-Output ('QA-FAIL ' + $a.n + ' not downloaded'); continue }
  $got = (Get-FileHash -Algorithm SHA256 -LiteralPath $f).Hash.ToLower()
  $size = (Get-Item -LiteralPath $f).Length
  if ($got -eq $a.h) { $ok++; Write-Output ("QA-OK   " + $a.n + " " + $size + "B") } else { Write-Output ("QA-FAIL " + $a.n + " got=" + $got + " size=" + $size) }
  Remove-Item -LiteralPath $f -Force
}
Write-Output ("QA-TOTAL " + $ok + "/2")
