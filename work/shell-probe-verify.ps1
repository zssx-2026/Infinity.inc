$ErrorActionPreference='Continue'
$rel='D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\cpp\release\v1.0pre5-shell'
$apps=@(@{d='inc';p='Infinity Cloud';port=7621},@{d='ipm';p='Infinity Package Manager';port=7632},@{d='int';p='Infinity Toolbox';port=7653})
foreach($a in $apps){
  $setup=Get-ChildItem $rel -Filter ('*_1.0.0-pre5_win64_setup.exe') | Where-Object { $_.Name -like (($a.p -replace ' ','')+'*') } | Select-Object -First 1
  if(-not $setup){ 'MISSING-SETUP ' + $a.d; continue }
  $root=Join-Path $env:LOCALAPPDATA ('Programs\Infinity.Inc\'+$a.p)
  Start-Process -FilePath $setup.FullName -ArgumentList '/S' -Wait
  Start-Sleep -Milliseconds 1000
  $win=Join-Path $root ($a.d+'_window.exe')
  $ui=Join-Path $root 'ui'
  $loader=Join-Path $root 'WebView2Loader.dll'
  $uicount=@(Get-ChildItem $ui -Recurse -File -ErrorAction SilentlyContinue).Count
  $size=(Get-Item $setup.FullName).Length
  $lnk=Join-Path $env:APPDATA ('Microsoft\Windows\Start Menu\Programs\Infinity.Inc\'+$a.p+'\Open.lnk')
  $w=New-Object -ComObject WScript.Shell
  $t=''; $ar=''
  if(Test-Path $lnk){ $s=$w.CreateShortcut($lnk); $t=$s.TargetPath; $ar=$s.Arguments }
  ('RESULT '+$a.d+' setup='+$size+' window='+(Test-Path $win)+' loader='+(Test-Path $loader)+' ui='+$uicount+' target='+($t -split '\\')[-1]+' args='+$ar)
  $u=Join-Path $root 'Uninstall.exe'
  Start-Process -FilePath $u -ArgumentList '/S' -Wait
  Start-Sleep -Milliseconds 1200
  ('CLEAN '+$a.d+' gone=' + (-not (Test-Path $root)) + ' lnk=' + (-not (Test-Path $lnk)))
}