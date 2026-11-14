$root=Join-Path $env:LOCALAPPDATA 'Programs\Infinity.Inc\InfinityPackageManager'
Get-ChildItem $root -Recurse -File | ForEach-Object { '  ' + $_.FullName.Substring($root.Length+1) + ' ' + $_.Length }
$lnk=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Infinity.Inc\InfinityPackageManager\Open.lnk'
if(Test-Path $lnk){ $w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut($lnk); 'LNK target='+$s.TargetPath; 'LNK args='+$s.Arguments; 'LNK icon='+$s.IconLocation } else { 'NO-LNK'; Get-ChildItem (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Infinity.Inc') -Directory | ForEach-Object { 'SMDIR '+$_.Name } }
$u=Join-Path $root 'Uninstall.exe'
Start-Process -WindowStyle Hidden -FilePath $u -ArgumentList '/S' -Wait
Start-Sleep -Milliseconds 1200
'GONE=' + (-not (Test-Path $root))