[Console]::OutputEncoding=[Text.Encoding]::UTF8
$ErrorActionPreference='Stop'
$tok = [Environment]::GetEnvironmentVariable('cloudflare-zssx-main')
$acct = 'd727ace860ffba8f651f779a14778b1b'
$headers = @{ Authorization = 'Bearer ' + $tok; 'Content-Type' = 'application/json' }
$body = @{
  name = 'infinity-downloads-pages'
  domains = @('infinity-studio-craft.github.io','zssx-2026.github.io','infinity-downloads.pages.dev')
  mode = 'managed'
  region = 'world'
  bot_fight_mode = $false
} | ConvertTo-Json -Depth 5
$w = Invoke-RestMethod -Method Post -Uri ('https://api.cloudflare.com/client/v4/accounts/' + $acct + '/challenges/widgets') -Headers $headers -Body $body
if (-not $w.success) { 'WIDGET_FAIL ' + ($w.errors | ConvertTo-Json -Compress); exit 1 }
$sitekey = $w.result.sitekey
$secret = $w.result.secret
'sitekey=' + $sitekey
'secret_len=' + $secret.Length
Set-Content -Path work/pages-sitekey.txt -Value $sitekey -Encoding UTF8 -NoNewline

$patch = @{
  deployment_configs = @{
    production = @{
      env_vars = @{
        TURNSTILE_SECRET = @{ type = 'secret_text'; value = $secret }
        TURNSTILE_SITEKEY = @{ type = 'plain_text'; value = $sitekey }
        CATALOG_VERSION = @{ type = 'plain_text'; value = '1.0.0-pre8' }
      }
    }
  }
} | ConvertTo-Json -Depth 8
$p = Invoke-RestMethod -Method Patch -Uri ('https://api.cloudflare.com/client/v4/accounts/' + $acct + '/pages/projects/infinity-downloads') -Headers $headers -Body $patch
'patch_success=' + $p.success
if ($p.success) {
  $prod = $p.result.deployment_configs.production.env_vars
  'env_keys=' + (($prod.PSObject.Properties.Name) -join ',')
}