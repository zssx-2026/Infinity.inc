$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$env:GIT_TERMINAL_PROMPT='0'
$payload = 'protocol=https' + [char]10 + 'host=github.com' + [char]10 + [char]10
$out = $payload | git credential fill 2>$null
$pw = ($out | Where-Object { $_ -like 'password=*' })
if (-not $pw) { Write-Output 'NO-CREDENTIAL'; exit 2 }
$tok = $pw.Substring(9)
$H = @{ Authorization = 'Bearer ' + $tok; 'User-Agent' = 'infinity-pages'; Accept = 'application/vnd.github+json' }
$repo = 'Infinity-Studio-craft/infinity-studio-craft.github.io'
$p = Invoke-RestMethod -Uri ('https://api.github.com/repos/' + $repo + '/pages') -Headers $H
Write-Output ('pages status=' + $p.status + ' build_type=' + $p.build_type + ' branch=' + $p.source.branch + ' path=' + $p.source.path + ' url=' + $p.html_url)
try {
  $b = Invoke-RestMethod -Uri ('https://api.github.com/repos/' + $repo + '/pages/builds/latest') -Headers $H
  Write-Output ('build status=' + $b.status + ' commit=' + $b.commit + ' created=' + $b.created_at + ' duration=' + $b.duration)
  if ($b.error) { Write-Output ('build error=' + $b.error.message) }
} catch { Write-Output ('build query failed: ' + $_.Exception.Message) }
try {
  $bs = Invoke-RestMethod -Uri ('https://api.github.com/repos/' + $repo + '/pages/builds?per_page=3') -Headers $H
  foreach ($x in $bs) { Write-Output ('  hist ' + $x.status + ' ' + $x.commit + ' ' + $x.created_at + ' ' + $x.error.message) }
} catch { Write-Output ('builds query failed: ' + $_.Exception.Message) }
