$ErrorActionPreference='Stop'
$tmp = Join-Path $PWD 'work\_qa-pre6'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$assets = @(
  @{ n='InfinityCloud_1.0.0-pre6_win64_setup.exe'; h='e9f6fdad9a390aba3e6e6cdd93a9a1cd9dd1cee337ac2f4c7af0931e30df80db'; u='https://github.com/zssx-2026/Infinity-Cloud/releases/download/v1.0.0-pre6/InfinityCloud_1.0.0-pre6_win64_setup.exe' },
  @{ n='InfinityPackageManager_1.0.0-pre6_win64_setup.exe'; h='721f4dccf09a979a82f840da2d5abb08163415e9190dbd6d7ac564a6738f7b20'; u='https://github.com/zssx-2026/InfinityPackageManager/releases/download/v1.0.0-pre6/InfinityPackageManager_1.0.0-pre6_win64_setup.exe' },
  @{ n='InfinityToolbox_1.0.0-pre6_win64_setup.exe'; h='b76a84446891838d169e8d2cf1b9aeb19835cee0338b07074fdd92a98ed1d971'; u='https://github.com/zssx-2026/Infinity-Toolbox/releases/download/v1.0.0-pre6/InfinityToolbox_1.0.0-pre6_win64_setup.exe' }
)
$ok = 0
foreach ($a in $assets) {
  $f = Join-Path $tmp $a.n
  curl.exe -sSL --ssl-no-revoke --max-time 1800 -o $f $a.u
  $got = (Get-FileHash -Algorithm SHA256 -LiteralPath $f).Hash.ToLower()
  $size = (Get-Item -LiteralPath $f).Length
  if ($got -eq $a.h) { $ok++; Write-Output ("QA-OK   " + $a.n + " " + $size + "B") } else { Write-Output ("QA-FAIL " + $a.n + " got=" + $got + " size=" + $size) }
  Remove-Item -LiteralPath $f -Force
}
Write-Output ("QA-TOTAL " + $ok + "/3")
