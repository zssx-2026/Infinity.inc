$ErrorActionPreference='Stop'
$payload = 'protocol=https' + [char]10 + 'host=github.com' + [char]10 + [char]10
$out = $payload | git credential fill 2>$null
$tok = (($out | Where-Object { $_ -like 'password=*' }).Substring(9))
$h = @{ Authorization = 'Bearer ' + $tok; 'User-Agent' = 'infinity-qa'; Accept = 'application/octet-stream' }
$tmp = Join-Path $PWD 'work\_qa-pre6'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$want = @{
  'InfinityPackageManager_1.0.0-pre6_win64_setup.exe' = @('721f4dccf09a979a82f840da2d5abb08163415e9190dbd6d7ac564a6738f7b20', 83935056);
  'InfinityToolbox_1.0.0-pre6_win64_setup.exe' = @('b76a84446891838d169e8d2cf1b9aeb19835cee0338b07074fdd92a98ed1d971', 83923176)
}
$repos = @{ 'InfinityPackageManager_1.0.0-pre6_win64_setup.exe' = 'InfinityPackageManager'; 'InfinityToolbox_1.0.0-pre6_win64_setup.exe' = 'Infinity-Toolbox' }
$ok = 0
foreach ($name in $want.Keys) {
  $repo = $repos[$name]
  $rel = Invoke-RestMethod -Uri ('https://api.github.com/repos/zssx-2026/' + $repo + '/releases/tags/v1.0.0-pre6') -Headers @{ Authorization = 'Bearer ' + $tok; 'User-Agent' = 'infinity-qa' }
  $asset = $rel.assets | Where-Object { $_.name -eq $name } | Select-Object -First 1
  if (-not $asset) { Write-Output ('QA-FAIL ' + $name + ' asset not listed'); continue }
  $f = Join-Path $tmp $name
  if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force }
  $done = $false
  for ($i = 1; $i -le 3; $i++) {
    try {
      Invoke-WebRequest -Uri $asset.url -Headers $h -OutFile $f -UseBasicParsing -TimeoutSec 1800
      if ((Test-Path -LiteralPath $f) -and (Get-Item -LiteralPath $f).Length -eq $want[$name][1]) { $done = $true; break }
    } catch { Write-Output ('   attempt ' + $i + ' ' + $_.Exception.Message) }
    Start-Sleep -Seconds 5
  }
  if (-not $done) { Write-Output ('QA-FAIL ' + $name + ' download incomplete'); continue }
  $got = (Get-FileHash -Algorithm SHA256 -LiteralPath $f).Hash.ToLower()
  if ($got -eq $want[$name][0]) { $ok++; Write-Output ('QA-OK   ' + $name + ' ' + (Get-Item -LiteralPath $f).Length + 'B') } else { Write-Output ('QA-FAIL ' + $name + ' sha=' + $got) }
  Remove-Item -LiteralPath $f -Force
}
Write-Output ('QA-TOTAL ' + $ok + '/2')
