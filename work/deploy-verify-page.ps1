[Console]::OutputEncoding=[Text.Encoding]::UTF8
$env:CLOUDFLARE_API_TOKEN=[Environment]::GetEnvironmentVariable('cloudflare-zssx-main')
$env:CLOUDFLARE_ACCOUNT_ID='d727ace860ffba8f651f779a14778b1b'
Push-Location 'work/verify-gate'
npx --no-install wrangler pages project create infinity-verify --production-branch main 2>&1 | Select-Object -Last 6
npx --no-install wrangler pages deploy . --project-name infinity-verify --branch main --commit-dirty=true 2>&1 | Select-Object -Last 12
Pop-Location