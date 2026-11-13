[Console]::OutputEncoding=[Text.Encoding]::UTF8
$ErrorActionPreference='Stop'
$tok = [Environment]::GetEnvironmentVariable('cloudflare-zssx-main')
$acct = 'd727ace860ffba8f651f779a14778b1b'
$headers = @{ Authorization = 'Bearer ' + $tok; 'Content-Type' = 'application/json' }
$list = Invoke-RestMethod -Method Get -Uri ('https://api.cloudflare.com/client/v4/accounts/' + $acct + '/challenges/widgets') -Headers $headers
foreach ($w in $list.result) { $w.sitekey + ' ' + $w.name + ' [' + ($w.domains -join ',') + ']' }
$target = $list.result | Where-Object { $_.sitekey -eq '0x4AAAAAAF-CBPThfL7uy0hi' }
$domains = @($target.domains) + @('infinity-verify.pages.dev')
$domains = $domains | Select-Object -Unique
$body = @{ domains = $domains } | ConvertTo-Json -Depth 4
$p = Invoke-RestMethod -Method Patch -Uri ('https://api.cloudflare.com/client/v4/accounts/' + $acct + '/challenges/widgets/' + $target.sitekey) -Headers $headers -Body $body
'patch_success=' + $p.success + ' domains=' + ($p.result.domains -join ',')