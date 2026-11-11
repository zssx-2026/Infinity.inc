$d='D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\cpp\release\v1.0pre6'
$files=@('InfinityCloud_1.0.0-pre6_win64_setup.exe','InfinityPackageManager_1.0.0-pre6_win64_setup.exe','InfinityToolbox_1.0.0-pre6_win64_setup.exe','name.txt','release-assets.json')
$lines = $files | ForEach-Object { $h=(Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $d $_)).Hash.ToLower(); "$h  $_" }
$lines -join "`r`n" | Set-Content -LiteralPath (Join-Path $d 'SHA256SUMS.txt') -Encoding ASCII
Get-Content -LiteralPath (Join-Path $d 'SHA256SUMS.txt')
Get-ChildItem -LiteralPath $d | ForEach-Object { $_.Name + ' ' + $_.Length }