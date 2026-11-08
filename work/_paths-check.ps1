$paths = (Get-Content 'work\_dup-paths.json' -Raw | ConvertFrom-Json).differ
Write-Host ('[check] paths=' + $paths.Count)
& (Join-Path $PSScriptRoot 'restore-history.ps1') -Archive (Join-Path (Split-Path -Parent $PSScriptRoot) 'history\history.jsonl') -Manifest (Join-Path (Split-Path -Parent $PSScriptRoot) 'work\history-manifest.json') -OutDir (Join-Path (Split-Path -Parent $PSScriptRoot) 'work\_verify-dup') -Path $paths -MinSample 0 -RandomFill 0 -TopLargest 0 -SummaryJson (Join-Path (Split-Path -Parent $PSScriptRoot) 'work\_verify-dup.json')
exit $LASTEXITCODE
