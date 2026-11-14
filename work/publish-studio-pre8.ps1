[Console]::OutputEncoding=[Text.Encoding]::UTF8
$ErrorActionPreference='Continue'
$env:INC_VERSION='1.0.0-pre8'
node InfinityStudio/build.mjs 2>&1 | Select-Object -Last 3
Write-Output ('build_exit=' + $LASTEXITCODE)
node tools/pack-electron.mjs studio --version 1.0.0-pre8 --release v1.0pre8 2>&1 | Select-Object -Last 5
Write-Output ('pack_exit=' + $LASTEXITCODE)
powershell.exe -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File work\sign-studio-pre8.ps1
Write-Output ('sign_exit=' + $LASTEXITCODE)

$payload = 'protocol=https' + [char]10 + 'host=github.com' + [char]10 + [char]10
$out = $payload | git credential fill 2>$null
$tok = ($out | Where-Object { $_ -like 'password=*' } | Select-Object -First 1).Substring(9)
$env:GH_TOKEN = $tok
Write-Output ('token-length=' + $tok.Length)
node tools/publish-electron.mjs studio --tag v1.0.0-pre8
Write-Output ('publish_exit=' + $LASTEXITCODE)

$f = 'cpp\release\v1.0pre8\InfinityStudio_1.0.0-pre8_win64_setup.exe'
$size = (Get-Item $f).Length
$sha = (Get-FileHash $f -Algorithm SHA256).Hash.ToLower()
Write-Output ('local size=' + $size + ' sha=' + $sha)
node work/catalog-studio-update.mjs $size $sha
$env:CLOUDFLARE_API_TOKEN = [Environment]::GetEnvironmentVariable('cloudflare-zssx-main')
$env:CLOUDFLARE_ACCOUNT_ID = 'd727ace860ffba8f651f779a14778b1b'
Push-Location work\pages-gate
npx --no-install wrangler pages deploy . --project-name infinity-downloads --branch main --commit-dirty=true 2>&1 | Select-Object -Last 5
Write-Output ('deploy_exit=' + $LASTEXITCODE)
Pop-Location
