[Console]::OutputEncoding=[Text.Encoding]::UTF8
$tok = [Environment]::GetEnvironmentVariable('cloudflare-zssx-main')
$acct = 'd727ace860ffba8f651f779a14778b1b'
$headers = @{ Authorization = 'Bearer ' + $tok; 'Content-Type' = 'application/json' }
$sk = '0x4AAAAAAF-CBPThfL7uy0hi'
$uri = 'https://api.cloudflare.com/client/v4/accounts/' + $acct + '/challenges/widgets/' + $sk
$cur = Invoke-RestMethod -Method Get -Uri $uri -Headers $headers
'current domains=' + ($cur.result.domains -join ',')
$domains = @($cur.result.domains) + @('infinity-verify.pages.dev')
$body = @{ name = $cur.result.name; domains = ($domains | Select-Object -Unique); mode = $cur.result.mode; region = $cur.result.region; bot_fight_mode = $cur.result.bot_fight_mode } | ConvertTo-Json -Depth 5
try {
  $p = Invoke-RestMethod -Method Patch -Uri $uri -Headers $headers -Body $body
  'patch_success=' + $p.success
  'domains=' + ($p.result.domains -join ',')
} catch {
  'PATCH_ERR ' + $_.Exception.Message
  if ($_.ErrorDetails) { $_.ErrorDetails.Message }
}