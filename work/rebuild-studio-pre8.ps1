[Console]::OutputEncoding=[Text.Encoding]::UTF8
$ErrorActionPreference='Continue'
node InfinityStudio/build.mjs
Write-Output ('build_exit=' + $LASTEXITCODE)
node tools/pack-electron.mjs studio --version 1.0.0-pre8 --release v1.0pre8
Write-Output ('pack_exit=' + $LASTEXITCODE)
Get-ChildItem cpp\release\v1.0pre8 -Filter 'InfinityStudio*' | ForEach-Object { Write-Output ('file ' + $_.Name + ' ' + $_.Length) }