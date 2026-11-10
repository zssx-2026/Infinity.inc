$ErrorActionPreference='Continue'
$setup='D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\cpp\release\v1.0pre5-shell\InfinityCloud_1.0.0-pre5_win64_setup.exe'
$root=Join-Path $env:LOCALAPPDATA 'Programs\Infinity.Inc\Infinity Cloud'
Start-Process -FilePath $setup -ArgumentList '/S' -Wait
Start-Sleep -Milliseconds 1200
'INSTALLED=' + (Test-Path $root)
if (Test-Path $root) { Get-ChildItem $root -Recurse -File | ForEach-Object { '  ' + $_.FullName.Substring($root.Length+1) + ' ' + $_.Length } }
$lnk=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Infinity.Inc\Infinity Cloud\Open.lnk'
if (Test-Path $lnk) { $w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut($lnk); 'LNK target=' + $s.TargetPath; 'LNK args=' + $s.Arguments; 'LNK icon=' + $s.IconLocation } else { 'NO-SHORTCUT' }
$req='protocol=https'+[string][char]10+'host=github.com'+[string][char]10+[string][char]10
$cred=($req | git credential fill) -split [string][char]10
$tok=(($cred | Where-Object { $_ -like 'password=*' }) -replace '^password=','').Trim()
$env:EV_GH_TOKEN=$tok
Push-Location $root
& .\inc_window.exe --app=inc --port=7621 --title=Infinity+Cloud --screenshot=D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\webview2\shell-probe.png --probe=D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\webview2\shell-probe.json --result=D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\webview2\shell-probe.run.json --hold-ms=1200 --timeout-ms=45000 2>&1 | Out-String
'HOST-EXIT=' + $LASTEXITCODE
Pop-Location
Start-Sleep -Milliseconds 600
'ORPHAN=' + (@(Get-Process inc_gui -ErrorAction SilentlyContinue).Count)
$u=Join-Path $root 'Uninstall.exe'
Start-Process -FilePath $u -ArgumentList '/S' -Wait
Start-Sleep -Milliseconds 1500
'AFTER-UNINSTALL-EXISTS=' + (Test-Path $root)
'SHORTCUT-GONE=' + (-not (Test-Path $lnk))
Remove-Item Env:EV_GH_TOKEN -ErrorAction SilentlyContinue