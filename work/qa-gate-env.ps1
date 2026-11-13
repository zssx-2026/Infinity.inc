[Console]::OutputEncoding=[Text.Encoding]::UTF8
$tok = [Environment]::GetEnvironmentVariable('cloudflare-zssx-main')
$acct = 'd727ace860ffba8f651f779a14778b1b'
$headers = @{ Authorization = 'Bearer ' + $tok; 'Content-Type' = 'application/json' }
$body = @{ deployment_configs = @{
  production = @{ env_vars = @{
    TURNSTILE_SITEKEY = @{ type = 'plain_text'; value = '1x00000000000000000000AA' }
    TURNSTILE_SECRET  = @{ type = 'secret_text'; value = '1x0000000000000000000000000000000AA' }
    CATALOG_VERSION   = @{ type = 'plain_text'; value = '1.0.0-pre8' }
  } }
  preview = @{ env_vars = @{
    TURNSTILE_SITEKEY = @{ type = 'plain_text'; value = '1x00000000000000000000AA' }
    TURNSTILE_SECRET  = @{ type = 'secret_text'; value = '1x0000000000000000000000000000000AA' }
  } }
} } | ConvertTo-Json -Depth 10
$u = 'https://api.cloudflare.com/client/v4/accounts/' + $acct + '/pages/projects/infinity-downloads-qa'
try {
  $p = Invoke-RestMethod -Method Patch -Uri $u -Headers $headers -Body $body
  'qa_env_success=' + $p.success
} catch { 'ERR ' + $_.Exception.Message; if ($_.ErrorDetails) { $_.ErrorDetails.Message } }