$ErrorActionPreference='Stop'
$payload = 'protocol=https' + [char]10 + 'host=github.com' + [char]10 + [char]10
$out = $payload | git credential fill 2>$null
$tok = (($out | Where-Object { $_ -like 'password=*' }).Substring(9))
$h = @{ Authorization = 'Bearer ' + $tok; 'User-Agent' = 'infinity-qa'; Accept = 'application/octet-stream' }
$tmp = Join-Path $PWD 'work\_qa-pre7'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$want = @(
  @{ name = 'InfinityCloud_1.0.0-pre7_win64_setup.exe';          repo = 'Infinity-Cloud';            sha = 'e9f6fdad9a390aba3e6e6cdd93a9a1cd9dd1cee337ac2f4c7af0931e30df80db'; size = 84211080 },
  @{ name = 'InfinityPackageManager_1.0.0-pre7_win64_setup.exe'; repo = 'InfinityPackageManager';    sha = '721f4dccf09a979a82f840da2d5abb08163415e9190dbd6d7ac564a6738f7b20'; size = 83935056 },
  @{ name = 'InfinityToolbox_1.0.0-pre7_win64_setup.exe';        repo = 'Infinity-Toolbox';          sha = 'b76a84446891838d169e8d2cf1b9aeb19835cee0338b07074fdd92a98ed1d971'; size = 83923176 }
)
$ok = 0
foreach ($w in $want) {
  $rel = Invoke-RestMethod -Uri ('https://api.github.com/repos/zssx-2026/' + $w.repo + '/releases/tags/v1.0.0-pre7') -Headers @{ Authorization = 'Bearer ' + $tok; 'User-Agent' = 'infinity-qa' }
  $asset = $rel.assets | Where-Object { $_.name -eq $w.name } | Select-Object -First 1
  if (-not $asset) { Write-Output ('QA-FAIL ' + $w.name + ' asset not listed'); continue }
  $f = Join-Path $tmp $w.name
  if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force }
  $done = $false
  for ($i = 1; $i -le 4; $i++) {
    try {
      Invoke-WebRequest -Uri $asset.url -Headers $h -OutFile $f -UseBasicParsing -TimeoutSec 1800
      if ((Test-Path -LiteralPath $f) -and (Get-Item -LiteralPath $f).Length -eq $w.size) { $done = $true; break }
    } catch { Write-Output ('   attempt ' + $i + ' ' + $_.Exception.Message) }
    Start-Sleep -Seconds 5
  }
  if (-not $done) { Write-Output ('QA-FAIL ' + $w.name + ' download incomplete'); continue }
  $got = (Get-FileHash -Algorithm SHA256 -LiteralPath $f).Hash.ToLower()
  if ($got -eq $w.sha) { $ok++; Write-Output ('QA-OK   ' + $w.name + ' ' + (Get-Item -LiteralPath $f).Length + 'B sha256=' + $got) }
  else { Write-Output ('QA-FAIL ' + $w.name + ' sha=' + $got) }
  Remove-Item -LiteralPath $f -Force
}
Write-Output ('QA-TOTAL ' + $ok + '/3')