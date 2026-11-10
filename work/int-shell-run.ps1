$rel='D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\cpp\release\v1.0pre5-shell'
$setup=(Get-ChildItem $rel -Filter 'InfinityToolbox*_setup.exe' | Select-Object -First 1).FullName
Start-Process -FilePath $setup -ArgumentList '/S' -Wait
Start-Sleep -Milliseconds 1200
$root=Join-Path $env:LOCALAPPDATA 'Programs\Infinity.Inc\Infinity Toolbox'
$req='protocol=https'+[string][char]10+'host=github.com'+[string][char]10+[string][char]10
$cred=($req | git credential fill) -split [string][char]10
$tok=(($cred | Where-Object { $_ -like 'password=*' }) -replace '^password=','').Trim()
$env:EV_GH_TOKEN=$tok
Push-Location $root
& .\int_window.exe --app=int --port=7653 --title=Infinity+Toolbox --screenshot=D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\webview2\shell-int.png --probe=D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\webview2\shell-int.json --result=D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\webview2\shell-int.run.json --hold-ms=1200 --timeout-ms=45000 2>&1 | Select-String -Pattern 'ui server|navigating|NavigationCompleted|probe done|finished|exit' | Out-String
'HOST-EXIT=' + $LASTEXITCODE
Pop-Location
Start-Sleep -Milliseconds 600
'ORPHAN=' + (@(Get-Process int_gui -ErrorAction SilentlyContinue).Count)
Start-Process -FilePath (Join-Path $root 'Uninstall.exe') -ArgumentList '/S' -Wait
Start-Sleep -Milliseconds 1200
'GONE=' + (-not (Test-Path $root))
Remove-Item Env:EV_GH_TOKEN -ErrorAction SilentlyContinue