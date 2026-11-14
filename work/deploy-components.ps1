[Console]::OutputEncoding=[Text.Encoding]::UTF8
Set-Location 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
$env:CLOUDFLARE_API_TOKEN=[Environment]::GetEnvironmentVariable('cloudflare-zssx-main')
$env:CLOUDFLARE_ACCOUNT_ID='d727ace860ffba8f651f779a14778b1b'
Push-Location work\pages-gate
npx --no-install wrangler pages deploy . --project-name infinity-downloads --branch main --commit-dirty=true 2>&1 | Select-Object -Last 6
Write-Output ('deploy_exit=' + $LASTEXITCODE)
Pop-Location
node -e "const u='https://infinity-downloads.pages.dev/api/components';fetch(u).then(r=>r.json()).then(j=>{for(const p of j.products)console.log(p.asset,p.size,p.sha256.slice(0,12),p.mirrors.length)})"
