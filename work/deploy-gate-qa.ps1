[Console]::OutputEncoding=[Text.Encoding]::UTF8
$env:CLOUDFLARE_API_TOKEN=[Environment]::GetEnvironmentVariable('cloudflare-zssx-main')
$env:CLOUDFLARE_ACCOUNT_ID='d727ace860ffba8f651f779a14778b1b'
Push-Location 'work/pages-gate'
npx --no-install wrangler pages project create infinity-downloads-qa --production-branch main 2>&1 | Select-Object -Last 4
npx --no-install wrangler pages deploy . --project-name infinity-downloads-qa --branch main --commit-dirty=true 2>&1 | Select-Object -Last 8
Pop-Location