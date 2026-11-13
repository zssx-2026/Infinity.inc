[Console]::OutputEncoding=[Text.Encoding]::UTF8
$tok = [Environment]::GetEnvironmentVariable('cloudflare-zssx-main')
$acct = 'd727ace860ffba8f651f779a14778b1b'
$headers = @{ Authorization = 'Bearer ' + $tok; 'Content-Type' = 'application/json' }
$list = Invoke-RestMethod -Method Get -Uri ('https://api.cloudflare.com/client/v4/accounts/' + $acct + '/challenges/widgets') -Headers $headers
$t = $list.result | Where-Object { $_.sitekey -eq '0x4AAAAAAF-CBPThfL7uy0hi' }
if ($t) { 'sitekey=' + $t.sitekey + ' domains=' + ($t.domains -join ',') } else { 'not found' }