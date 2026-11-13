[Console]::OutputEncoding=[Text.Encoding]::UTF8
$tok = [Environment]::GetEnvironmentVariable('cloudflare-zssx-main')
$acct = 'd727ace860ffba8f651f779a14778b1b'
$headers = @{ Authorization = 'Bearer ' + $tok; 'Content-Type' = 'application/json' }
$sk = '0x4AAAAAAF-CBPThfL7uy0hi'
$uri = 'https://api.cloudflare.com/client/v4/accounts/' + $acct + '/challenges/widgets/' + $sk
$cur = Invoke-RestMethod -Method Get -Uri $uri -Headers $headers
$domains = @($cur.result.domains) + @('infinity-verify.pages.dev')
$body = @{ name = $cur.result.name; domains = ($domains | Select-Object -Unique); mode = $cur.result.mode; region = $cur.result.region; bot_fight_mode = $cur.result.bot_fight_mode } | ConvertTo-Json -Depth 5
foreach ($m in @('Put','Patch')) {
  try {
    $p = Invoke-RestMethod -Method $m -Uri $uri -Headers $headers -Body $body
    $m + '_success=' + $p.success
    $m + '_domains=' + ($p.result.domains -join ',')
    break
  } catch {
    $m + '_ERR ' + $_.Exception.Message
    if ($_.ErrorDetails) { $m + '_BODY ' + $_.ErrorDetails.Message }
  }
}