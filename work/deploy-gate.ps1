[Console]::OutputEncoding=[Text.Encoding]::UTF8
$ErrorActionPreference='Continue'
Set-Location 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
$env:CLOUDFLARE_API_TOKEN = [Environment]::GetEnvironmentVariable('cloudflare-zssx-main')
$env:CLOUDFLARE_ACCOUNT_ID = 'd727ace860ffba8f651f779a14778b1b'
Push-Location work\pages-gate
& npx --no-install wrangler pages deploy . --project-name infinity-downloads --branch main --commit-dirty=true
Write-Output ('deploy_exit=' + $LASTEXITCODE)
Pop-Location
exit 0
