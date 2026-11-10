
$ErrorActionPreference='Stop'
$tmp = Join-Path $PWD 'work\_qa-pre5'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$assets = @(
  @{ n='InfinityCloud_1.0.0-pre5_win64_setup.exe'; h='502edbae695d656c1d5ada40571c79420b9c6e3bf6a0174db1cb09f5226e407f'; u='https://github.com/zssx-2026/Infinity-Cloud/releases/download/v1.0.0-pre5/InfinityCloud_1.0.0-pre5_win64_setup.exe' },
  @{ n='InfinityPackageManager_1.0.0-pre5_win64_setup.exe'; h='ab37f574d415ee44a9c2bc0c4bab05016362629f88035930ea5e7d14091cacfc'; u='https://github.com/zssx-2026/InfinityPackageManager/releases/download/v1.0.0-pre5/InfinityPackageManager_1.0.0-pre5_win64_setup.exe' },
  @{ n='InfinityToolbox_1.0.0-pre5_win64_setup.exe'; h='efd3466d10871109f94934fb4799085fcbb473bb4519dad0b90d14a5adbd8d24'; u='https://github.com/zssx-2026/Infinity-Toolbox/releases/download/v1.0.0-pre5/InfinityToolbox_1.0.0-pre5_win64_setup.exe' }
)
$ok = 0
foreach ($a in $assets) {
  $f = Join-Path $tmp $a.n
  curl.exe -sSL --ssl-no-revoke --max-time 300 -o $f $a.u
  $got = (Get-FileHash -Algorithm SHA256 -LiteralPath $f).Hash.ToLower()
  $size = (Get-Item -LiteralPath $f).Length
  if ($got -eq $a.h) { $ok++; Write-Output ("QA-OK   " + $a.n + " " + $size + "B") } else { Write-Output ("QA-FAIL " + $a.n + " got=" + $got) }
}
Write-Output ("QA-TOTAL " + $ok + "/3")
