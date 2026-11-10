$env:GIT_TERMINAL_PROMPT='0'
$payload = 'protocol=https' + [char]10 + 'host=github.com' + [char]10 + [char]10
$out = $payload | git credential fill 2>$null
$pw = ($out | Where-Object { $_ -like 'password=*' })
$tok = $pw.Substring(9)
Start-Sleep -Seconds 30
$h = @{ Authorization = 'Bearer ' + $tok; 'User-Agent' = 'dsh'; Accept = 'application/vnd.github+json' }
$p = Invoke-RestMethod -Headers $h -Uri 'https://api.github.com/repos/Infinity-Studio-craft/infinity-studio-craft.github.io/pages'
Write-Output ('pages status=' + $p.status + ' url=' + $p.html_url)
$b = Invoke-RestMethod -Headers $h -Method POST -Uri 'https://api.github.com/repos/Infinity-Studio-craft/infinity-studio-craft.github.io/pages/builds' -Body '{}' -ContentType 'application/json'
Write-Output ('rebuild queued status=' + $b.status)
Start-Sleep -Seconds 25
$f = Invoke-WebRequest -UseBasicParsing -Uri 'https://infinity-studio-craft.github.io/?cb=' + (Get-Random) -TimeoutSec 60
Write-Output ('http=' + $f.StatusCode + ' bytes=' + $f.RawContentLength)
$hasPre5 = $f.Content -match 'releases/tag/v1.0.0-pre5'
$hasPre4 = $f.Content -match 'releases/tag/v1.0.0-pre4'
Write-Output ('hasPre5=' + $hasPre5 + ' hasPre4=' + $hasPre4)