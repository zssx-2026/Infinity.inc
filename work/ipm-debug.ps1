$rel='D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\cpp\release\v1.0pre5-shell'
$setup=(Get-ChildItem $rel -Filter 'InfinityPackageManager*_setup.exe' | Select-Object -First 1).FullName
'SETUP='+$setup
$p=Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
'EXIT='+$p.ExitCode
Start-Sleep -Milliseconds 1500
$base=Join-Path $env:LOCALAPPDATA 'Programs\Infinity.Inc'
Get-ChildItem $base -Directory | ForEach-Object { 'DIR ' + $_.Name }
$root=Join-Path $base 'Infinity Package Manager'
if(Test-Path $root){ Get-ChildItem $root -Recurse -File | ForEach-Object { '  ' + $_.FullName.Substring($root.Length+1) + ' ' + $_.Length } } else { 'NO-DIR' }