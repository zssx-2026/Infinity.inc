$ErrorActionPreference='Stop'
$payload = 'protocol=https' + [char]10 + 'host=github.com' + [char]10 + [char]10
$out = $payload | git credential fill 2>$null
$tok = (($out | Where-Object { $_ -like 'password=*' }).Substring(9))
$h = @{ Authorization = 'Bearer ' + $tok; 'User-Agent' = 'infinity-pages'; Accept = 'application/vnd.github+json' }
$b = Invoke-RestMethod -Uri 'https://api.github.com/repos/Infinity-Studio-craft/infinity-studio-craft.github.io/pages/builds?per_page=5' -Headers $h
foreach ($x in $b) { $x.status + ' ' + $x.commit + ' err=' + $x.error.message + ' created=' + $x.created_at + ' updated=' + $x.updated_at }
$p = Invoke-RestMethod -Uri 'https://api.github.com/repos/Infinity-Studio-craft/infinity-studio-craft.github.io/pages' -Headers $h
'site: status=' + $p.status + ' url=' + $p.html_url + ' branch=' + $p.source.branch + ' path=' + $p.source.path
