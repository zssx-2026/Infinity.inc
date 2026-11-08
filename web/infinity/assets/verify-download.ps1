<#
  verify-download.ps1 - check a downloaded Infinity.Inc file and clear the mark
  Windows puts on it.

  Windows marks every file that arrives from the internet. That mark, not the
  file, is what makes the "this file is not safe" prompt appear. Verifying the
  published digest proves the bytes are the ones that were released, and
  Unblock-File removes the mark once that is known.

  Usage:
    powershell -ExecutionPolicy Bypass -File verify-download.ps1 -Path .\InfinityCloud_1.0.0-pre5_win64_setup.exe -Sha256 78dd21b814f86352f639747f7f348ab9af0d6efe1aa2630ddcd32cb844d7c909

    That digest is InfinityCloud_1.0.0-pre5_win64_setup.exe, from
    installers/packaging/v1.0pre5/SHA256SUMS.txt (same value as
    cpp/release/v1.0pre5/release-assets.json).

  -Example prints the usage line and then self-checks it against the copy of
  releases.json shipped next to this script: if the printed digest no longer
  equals Infinity-Cloud's v1.0.0-pre5 sha256 in that snapshot, the script exits
  non-zero instead of telling a reader a stale value. It touches no file.
#>
param(
  [Parameter(Mandatory = $false)][string]$Path,
  [string]$Sha256,
  [switch]$Example
)
$ErrorActionPreference = 'Stop'

# The one example this script prints, kept where the snapshot can check it.
$ExampleName = 'InfinityCloud_1.0.0-pre5_win64_setup.exe'
$ExampleSha256 = '78dd21b814f86352f639747f7f348ab9af0d6efe1aa2630ddcd32cb844d7c909'

if ($Example) {
  Write-Host ('    powershell -ExecutionPolicy Bypass -File verify-download.ps1 -Path .\' + $ExampleName + ' -Sha256 ' + $ExampleSha256)

  # Self-check: what is printed above must equal what the site's own snapshot says.
  $snapshot = Join-Path $PSScriptRoot 'releases.json'
  if (-not (Test-Path -LiteralPath $snapshot)) {
    Write-Host ('SELF-CHECK FAIL: ' + $snapshot + ' is missing; cannot confirm the example digest.') -ForegroundColor Red
    exit 1
  }
  $data = Get-Content -LiteralPath $snapshot -Raw -Encoding UTF8 | ConvertFrom-Json
  $release = @($data.repos.'Infinity-Cloud') | Where-Object { $_.tag_name -eq 'v1.0.0-pre5' } | Select-Object -First 1
  $asset = @($release.assets) | Where-Object { $_.name -eq $ExampleName } | Select-Object -First 1
  $want = ''
  if ($asset -and $asset.digest) { $want = (([string]$asset.digest) -replace '^sha256:', '').ToLower() }
  if ($want -ne $ExampleSha256.ToLower()) {
    $found = '(no digest for ' + $ExampleName + ')'
    if ($want) { $found = $want }
    Write-Host ('SELF-CHECK FAIL: releases.json says ' + $found + ' but the example prints ' + $ExampleSha256) -ForegroundColor Red
    exit 1
  }
  Write-Host ('SELF-CHECK PASS: example digest equals releases.json (' + $ExampleName + ', ' + $asset.size + ' bytes).') -ForegroundColor Green
  exit 0
}

if (-not $Path) { throw 'Path is required. Use -Example to print the usage line.' }
$file = Get-Item -LiteralPath $Path
$hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLower()
Write-Host ("file    : " + $file.FullName)
Write-Host ("size    : " + $file.Length + " bytes")
Write-Host ("sha256  : " + $hash)
if ($Sha256) {
  $want = $Sha256.ToLower().Replace('sha256:', '').Trim()
  if ($hash -ne $want) {
    Write-Host "MISMATCH: the file is not the published one. Do not run it." -ForegroundColor Red
    exit 1
  }
  Write-Host "MATCH: this is the published file." -ForegroundColor Green
} else {
  Write-Host "No digest given; compare the line above with the one on the download page."
}
Unblock-File -LiteralPath $file.FullName
Write-Host "Unblocked: Windows will no longer warn about this file."
