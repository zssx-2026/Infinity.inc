$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$root='D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
$base=Join-Path $root 'work\_installer-e2e'
$backupPath=Join-Path $root 'work\_installer-e2e-backup.json'
$resultPath=Join-Path $base 'result.json'
$logPath=Join-Path $base 'e2e.log'
New-Item -ItemType Directory -Force -Path $base | Out-Null
Set-Content -LiteralPath $logPath -Value '' -Encoding UTF8

function Log([string]$m){
  $line=((Get-Date).ToString('yyyy-MM-dd HH:mm:ss.fff'))+'  '+$m
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
  Write-Output $line
}

$uninstallRoot='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
$smParent=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Infinity.Inc'
$defaultPrograms=Join-Path $env:LOCALAPPDATA 'Programs\Infinity.Inc'
$releaseDir=Join-Path $root 'cpp\release\v1.0pre5'

function EnvNameOf([string]$exe){ return (($exe -replace '\.exe$','') -replace '_','') }

$apps=@(
 [ordered]@{ app='inc'; setup='InfinityCloud_1.0.0-pre5_win64_setup.exe'; product='Infinity Cloud'; unkey='Infinity.Inc.InfinityCloud'; exes=@('inc_cli.exe','inc_gui.exe','inc_launcher.exe','inx_cli.exe','inx_gui.exe','inx_launcher.exe'); icon='inc.ico'; openTarget='inc_launcher.exe' },
 [ordered]@{ app='ifm'; setup='InfinityFileManager_1.0.0-pre5_win64_setup.exe'; product='Infinity File Manager'; unkey='Infinity.Inc.InfinityFileManager'; exes=@('ifm_cli.exe','ifm_gui.exe','ifm_launcher.exe','ifmx_cli.exe','ifmx_gui.exe','ifmx_launcher.exe'); icon='ifm.ico'; openTarget='ifm_launcher.exe' },
 [ordered]@{ app='ipm'; setup='InfinityPackageManager_1.0.0-pre5_win64_setup.exe'; product='InfinityPackageManager'; unkey='Infinity.Inc.InfinityPackageManager'; exes=@('ipm_cli.exe','ipm_gui.exe','ipm_launcher.exe','ipmx_cli.exe','ipmx_gui.exe','ipmx_launcher.exe'); icon='ipm.ico'; openTarget='ipm_launcher.exe' },
 [ordered]@{ app='iim'; setup='InfinityInstallerManager_1.0.0-pre5_win64_setup.exe'; product='Infinity Installer Manager'; unkey='Infinity.Inc.InfinityInstallerManager'; exes=@('iim_cli.exe','iim_gui.exe','iimx_cli.exe','iimx_gui.exe'); icon='iim.ico'; openTarget='iim_gui.exe' },
 [ordered]@{ app='int'; setup='InfinityToolbox_1.0.0-pre5_win64_setup.exe'; product='Infinity Toolbox'; unkey='Infinity.Inc.InfinityToolbox'; exes=@('int_cli.exe','int_gui.exe','intx_cli.exe','intx_gui.exe'); icon='int.ico'; openTarget='int_gui.exe' },
 [ordered]@{ app='ing'; setup='InfinityGames_1.0.0-pre5_win64_setup.exe'; product='Infinity Games'; unkey='Infinity.Inc.InfinityGames'; exes=@('ing_cli.exe','ing_gui.exe','ingx_cli.exe','ingx_gui.exe'); icon='ing.ico'; openTarget='ing_gui.exe' }
)

$envNames=New-Object System.Collections.Generic.List[string]
[void]$envNames.Add('def_fm'); [void]$envNames.Add('proxy_ip')
foreach($a in $apps){ foreach($e in $a.exes){ [void]$envNames.Add((EnvNameOf $e)) } }

function Get-Snapshot {
  $envKey=Get-Item 'HKCU:\Environment'
  $allNames=$envKey.GetValueNames()
  $envMap=[ordered]@{}
  foreach($n in $envNames){
    if($allNames -contains $n){ $envMap[$n]=[ordered]@{present=$true;kind=$envKey.GetValueKind($n).ToString();value=[string]$envKey.GetValue($n)} }
    else { $envMap[$n]=[ordered]@{present=$false;kind=$null;value=$null} }
  }
  $unMap=[ordered]@{}
  foreach($a in $apps){
    $p=Join-Path $uninstallRoot $a.unkey
    if(Test-Path -LiteralPath $p){
      $k=Get-Item -LiteralPath $p
      $vals=[ordered]@{}
      foreach($vn in $k.GetValueNames()){ $vals[$vn]=[ordered]@{kind=$k.GetValueKind($vn).ToString();value=[string]$k.GetValue($vn)} }
      $unMap[$a.unkey]=[ordered]@{present=$true;values=$vals}
    } else { $unMap[$a.unkey]=[ordered]@{present=$false;values=[ordered]@{}} }
  }
  $sm=[ordered]@{parentExists=(Test-Path -LiteralPath $smParent);defaultProgramsExists=(Test-Path -LiteralPath $defaultPrograms);productDirs=[ordered]@{}}
  foreach($a in $apps){
    $d=Join-Path $smParent $a.product
    $ex=$false; $files=@()
    if(Test-Path -LiteralPath $d){ $ex=$true; $files=@(Get-ChildItem -LiteralPath $d -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }) }
    $sm.productDirs[$a.app]=[ordered]@{path=$d;product=$a.product;exists=$ex;files=$files}
  }
  return [ordered]@{environment=$envMap;uninstallKeys=$unMap;startMenu=$sm}
}

function Force-Cleanup($a,$inst){
  $u=Join-Path $inst 'Uninstall.exe'
  if(Test-Path -LiteralPath $u){ cmd /c start "" /wait "$u" /S | Out-Null; Start-Sleep -Seconds 2 }
  if(Test-Path -LiteralPath $inst){ Remove-Item -LiteralPath $inst -Recurse -Force -ErrorAction SilentlyContinue }
  $kp=Join-Path $uninstallRoot $a.unkey
  if(Test-Path -LiteralPath $kp){ Remove-Item -LiteralPath $kp -Recurse -Force -ErrorAction SilentlyContinue }
  $d=Join-Path $smParent $a.product
  if(Test-Path -LiteralPath $d){ Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue }
  $k=Get-Item 'HKCU:\Environment'
  $names=$k.GetValueNames()
  foreach($e in $a.exes){ $n=EnvNameOf $e; if($names -contains $n){ Remove-ItemProperty -LiteralPath 'HKCU:\Environment' -Name $n -Force -ErrorAction SilentlyContinue } }
}

function Restore-Snapshot($snap){
  $k=Get-Item 'HKCU:\Environment'
  foreach($n in $snap.environment.Keys){
    $i=$snap.environment[$n]
    if($i.present){
      $kind=$i.kind
      if($kind -eq 'DWord'){ Set-ItemProperty -LiteralPath 'HKCU:\Environment' -Name $n -Value ([int]$i.value) -Type DWord }
      elseif($kind -eq 'ExpandString'){ Set-ItemProperty -LiteralPath 'HKCU:\Environment' -Name $n -Value $i.value -Type ExpandString }
      elseif($kind -eq 'QWord'){ Set-ItemProperty -LiteralPath 'HKCU:\Environment' -Name $n -Value ([long]$i.value) -Type QWord }
      else { Set-ItemProperty -LiteralPath 'HKCU:\Environment' -Name $n -Value $i.value -Type String }
    } else {
      $k2=Get-Item 'HKCU:\Environment'
      if(($k2.GetValueNames()) -contains $n){ Remove-ItemProperty -LiteralPath 'HKCU:\Environment' -Name $n -Force }
    }
  }
  foreach($sk in $snap.uninstallKeys.Keys){
    $i=$snap.uninstallKeys[$sk]
    $p=Join-Path $uninstallRoot $sk
    if($i.present){
      if(-not (Test-Path -LiteralPath $p)){ New-Item -Path $p -Force | Out-Null }
      foreach($vn in $i.values.Keys){
        $vi=$i.values[$vn]
        if($vi.kind -eq 'DWord'){ Set-ItemProperty -LiteralPath $p -Name $vn -Value ([int]$vi.value) -Type DWord }
        elseif($vi.kind -eq 'QWord'){ Set-ItemProperty -LiteralPath $p -Name $vn -Value ([long]$vi.value) -Type QWord }
        elseif($vi.kind -eq 'ExpandString'){ Set-ItemProperty -LiteralPath $p -Name $vn -Value $vi.value -Type ExpandString }
        else { Set-ItemProperty -LiteralPath $p -Name $vn -Value $vi.value -Type String }
      }
    } else {
      if(Test-Path -LiteralPath $p){ Remove-Item -LiteralPath $p -Recurse -Force }
    }
  }
  foreach($app in $snap.startMenu.productDirs.Keys){
    $i=$snap.startMenu.productDirs[$app]
    if(-not $i.exists -and (Test-Path -LiteralPath $i.path)){ Remove-Item -LiteralPath $i.path -Recurse -Force }
    if($i.exists -and (-not (Test-Path -LiteralPath $i.path))){ New-Item -ItemType Directory -Force -Path $i.path | Out-Null }
  }
  if((-not $snap.startMenu.parentExists) -and (Test-Path -LiteralPath $smParent)){ Remove-Item -LiteralPath $smParent -Recurse -Force }
  if((-not $snap.startMenu.defaultProgramsExists) -and (Test-Path -LiteralPath $defaultPrograms)){ Remove-Item -LiteralPath $defaultPrograms -Recurse -Force -ErrorAction SilentlyContinue }
}

Log '=== E2E START ==='
$before=Get-Snapshot
($before | ConvertTo-Json -Depth 10) | Set-Content -LiteralPath $backupPath -Encoding UTF8
Log ('snapshot(before) saved: '+$backupPath)

$cppOutBefore=@(Get-ChildItem -LiteralPath (Join-Path $root 'cpp\out') -Recurse -File | Sort-Object FullName | ForEach-Object { [ordered]@{path=$_.FullName.Substring($root.Length+1);bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash} })
($cppOutBefore | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath (Join-Path $base 'cpp-out-before.json') -Encoding UTF8

$results=New-Object System.Collections.Generic.List[object]
$anyFail=$false

foreach($a in $apps){
  Log ('--- '+$a.app+' START ---')
  $inst=Join-Path $base $a.app
  $setupPath=Join-Path $releaseDir $a.setup
  $r=[ordered]@{
    app=$a.app; product=$a.product; setup=$a.setup; setupPath=$setupPath; installDir=$inst
    setupBytes=$null; setupSha256=$null
    installExitCode=$null; installElapsedSec=$null; installDirUsed=$null; usedDefaultDir=$false
    fileCount=$null; installedFiles=@(); exeCompare=@(); iconCompare=$null; missingFiles=@(); extraFiles=@()
    envAfterInstall=[ordered]@{}; envExpected=[ordered]@{}; envMatch=$null
    uninstallKeyAfterInstall=[ordered]@{}; uninstallKeyExpected=[ordered]@{}; uninstallKeyMatch=$null
    uninstallKeyRaw=@(); shortcutsAfterInstall=[ordered]@{}; shortcutsMatch=$null
    registryDuring=$null
    uninstallExitCode=$null; uninstallElapsedSec=$null; dirGone=$null; keyGone=$null; shortcutsGone=$null; envGone=$null
    cleanupComplete=$null; fallbackCleanup=$false; errors=@()
  }
  try {
    $fi=Get-Item -LiteralPath $setupPath
    $r.setupBytes=$fi.Length
    $r.setupSha256=(Get-FileHash -LiteralPath $setupPath -Algorithm SHA256).Hash
    if(Test-Path -LiteralPath $inst){ Remove-Item -LiteralPath $inst -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $inst | Out-Null

    $t0=Get-Date
    cmd /c start "" /wait "$setupPath" /S /D=$inst
    $r.installExitCode=$LASTEXITCODE
    $r.installElapsedSec=[math]::Round(((Get-Date)-$t0).TotalSeconds,3)
    Log ($a.app+' install exit='+$r.installExitCode+' elapsed='+$r.installElapsedSec+'s')

    $instUsed=$inst
    if(-not (Test-Path -LiteralPath $inst)){ throw 'install dir was not created' }
    $topFiles=@(Get-ChildItem -LiteralPath $inst -Force -ErrorAction SilentlyContinue | Where-Object { -not $_.PSIsContainer })
    if($topFiles.Count -eq 0){
      $def=Join-Path $defaultPrograms $a.product
      if(Test-Path -LiteralPath $def){
        $instUsed=$def; $r.usedDefaultDir=$true
        Log ($a.app+' WARN: /D not honored, files found in default dir '+$def)
      } else { throw 'install dir empty and default dir absent' }
    }
    $r.installDirUsed=$instUsed
    $topFiles=@(Get-ChildItem -LiteralPath $instUsed -Force -ErrorAction SilentlyContinue | Where-Object { -not $_.PSIsContainer })
    $r.fileCount=$topFiles.Count
    $r.installedFiles=@($topFiles | Sort-Object Name | ForEach-Object { [ordered]@{name=$_.Name;bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash} })

    $expected=@($a.exes)+@($a.icon)+@('Uninstall.exe')
    $r.missingFiles=@($expected | Where-Object { -not (Test-Path -LiteralPath (Join-Path $instUsed $_)) })
    $r.extraFiles=@(($topFiles | ForEach-Object { $_.Name }) | Where-Object { $expected -notcontains $_ })

    $exeCmp=@()
    foreach($e in $a.exes){
      $ip=Join-Path $instUsed $e
      $op=Join-Path $root ('cpp\out\'+$a.app+'\'+$e)
      $sp=Join-Path $root ('cpp\build\installer-stage\'+$a.app+'\'+$e)
      $ih=$null; $oh=$null; $sh=$null
      if(Test-Path -LiteralPath $ip){ $ih=(Get-FileHash -LiteralPath $ip -Algorithm SHA256).Hash }
      if(Test-Path -LiteralPath $op){ $oh=(Get-FileHash -LiteralPath $op -Algorithm SHA256).Hash }
      if(Test-Path -LiteralPath $sp){ $sh=(Get-FileHash -LiteralPath $sp -Algorithm SHA256).Hash }
      $ib=$null; $ob=$null
      if(Test-Path -LiteralPath $ip){ $ib=(Get-Item -LiteralPath $ip).Length }
      if(Test-Path -LiteralPath $op){ $ob=(Get-Item -LiteralPath $op).Length }
      $exeCmp+=[ordered]@{name=$e;installedBytes=$ib;outBytes=$ob;installedSha256=$ih;outSha256=$oh;stageSha256=$sh;matchOut=($null -ne $ih -and $ih -eq $oh);matchStage=($null -ne $ih -and $ih -eq $sh)}
    }
    $r.exeCompare=$exeCmp

    $icp=Join-Path $instUsed $a.icon
    $icsrc=Join-Path $root ('cpp\build\installer-stage\'+$a.app+'\'+$a.icon)
    $ich=$null; $icoh=$null; $icsz=$null; $icosz=$null
    if(Test-Path -LiteralPath $icp){ $ich=(Get-FileHash -LiteralPath $icp -Algorithm SHA256).Hash; $icsz=(Get-Item -LiteralPath $icp).Length }
    if(Test-Path -LiteralPath $icsrc){ $icoh=(Get-FileHash -LiteralPath $icsrc -Algorithm SHA256).Hash; $icosz=(Get-Item -LiteralPath $icsrc).Length }
    $r.iconCompare=[ordered]@{name=$a.icon;installedBytes=$icsz;stageBytes=$icosz;installedSha256=$ich;stageSha256=$icoh;match=($null -ne $ich -and $ich -eq $icoh)}

    $envKey=Get-Item 'HKCU:\Environment'
    $names=$envKey.GetValueNames()
    $envOk=$true
    foreach($e in $a.exes){
      $n=EnvNameOf $e
      $exp=Join-Path $instUsed $e
      $present=($names -contains $n)
      $val=''
      if($present){ $val=[string]$envKey.GetValue($n) }
      $m=($present -and $val -eq $exp)
      if(-not $m){ $envOk=$false }
      $r.envExpected[$n]=$exp
      $r.envAfterInstall[$n]=[ordered]@{present=$present;kind=$(if($present){$envKey.GetValueKind($n).ToString()}else{$null});value=$val;expected=$exp;match=$m}
    }
    $r.envMatch=$envOk

    $kp=Join-Path $uninstallRoot $a.unkey
    $keyOk=$false
    $kexp=[ordered]@{DisplayName=$a.product;DisplayVersion='1.0.0-pre5';DisplayIcon=(Join-Path $instUsed $a.icon);InstallLocation=$instUsed;UninstallString=(Join-Path $instUsed 'Uninstall.exe');NoModify='1';NoRepair='1'}
    $r.uninstallKeyExpected=$kexp
    if(Test-Path -LiteralPath $kp){
      $kk=Get-Item -LiteralPath $kp
      $raw=@()
      foreach($vn in $kk.GetValueNames()){ $raw+=[ordered]@{name=$vn;kind=$kk.GetValueKind($vn).ToString();value=[string]$kk.GetValue($vn)} }
      $r.uninstallKeyRaw=$raw
      $keyOk=$true
      foreach($vn in $kexp.Keys){
        $got=$null
        if(($kk.GetValueNames()) -contains $vn){ $got=[string]$kk.GetValue($vn) }
        $r.uninstallKeyAfterInstall[$vn]=[ordered]@{present=(($kk.GetValueNames()) -contains $vn);kind=$(if(($kk.GetValueNames()) -contains $vn){$kk.GetValueKind($vn).ToString()}else{$null});value=$got;expected=[string]$kexp[$vn];match=($got -eq [string]$kexp[$vn])}
        if($got -ne [string]$kexp[$vn]){ $keyOk=$false }
      }
    } else {
      foreach($vn in $kexp.Keys){ $r.uninstallKeyAfterInstall[$vn]=[ordered]@{present=$false;kind=$null;value=$null;expected=[string]$kexp[$vn];match=$false} }
      $keyOk=$false
    }
    $r.uninstallKeyMatch=$keyOk

    $smDir=Join-Path $smParent $a.product
    $openLnk=Join-Path $smDir 'Open.lnk'
    $unLnk=Join-Path $smDir 'Uninstall.lnk'
    $openTarget=$null; $unTarget=$null; $lnkErr=$null
    try {
      $ws=New-Object -ComObject WScript.Shell
      if(Test-Path -LiteralPath $openLnk){ $sc=$ws.CreateShortcut($openLnk); $openTarget=$sc.TargetPath }
      if(Test-Path -LiteralPath $unLnk){ $sc2=$ws.CreateShortcut($unLnk); $unTarget=$sc2.TargetPath }
    } catch { $lnkErr=$_.Exception.Message }
    $expOpen=Join-Path $instUsed $a.openTarget
    $expUn=Join-Path $instUsed 'Uninstall.exe'
    $smOk=((Test-Path -LiteralPath $openLnk) -and (Test-Path -LiteralPath $unLnk) -and ($openTarget -eq $expOpen) -and ($unTarget -eq $expUn))
    $r.shortcutsAfterInstall=[ordered]@{dir=$smDir;dirExists=(Test-Path -LiteralPath $smDir);openExists=(Test-Path -LiteralPath $openLnk);uninstallExists=(Test-Path -LiteralPath $unLnk);openTarget=$openTarget;expectedOpenTarget=$expOpen;uninstallTarget=$unTarget;expectedUninstallTarget=$expUn;lnkReadError=$lnkErr;match=$smOk}
    $r.shortcutsMatch=$smOk

    $r.registryDuring=Get-Snapshot
    Log ($a.app+' verify: files='+$r.fileCount+' exeMatch='+(@($exeCmp | Where-Object { $_.matchOut }).Count)+'/'+$exeCmp.Count+' iconMatch='+$r.iconCompare.match+' envMatch='+$r.envMatch+' unkeyMatch='+$r.uninstallKeyMatch+' shortcutsMatch='+$r.shortcutsMatch)

    $smDirUsed=Join-Path $smParent $a.product
    $t1=Get-Date
    $u=Join-Path $instUsed 'Uninstall.exe'
    cmd /c start "" /wait "$u" /S
    $r.uninstallExitCode=$LASTEXITCODE
    $deadline=(Get-Date).AddSeconds(60)
    while((Test-Path -LiteralPath $instUsed) -and ((Get-Date) -lt $deadline)){ Start-Sleep -Milliseconds 400 }
    $r.uninstallElapsedSec=[math]::Round(((Get-Date)-$t1).TotalSeconds,3)
    $r.dirGone=(-not (Test-Path -LiteralPath $instUsed))
    $r.keyGone=(-not (Test-Path -LiteralPath $kp))
    $r.shortcutsGone=(-not (Test-Path -LiteralPath $smDirUsed))
    $envKey2=Get-Item 'HKCU:\Environment'
    $names2=$envKey2.GetValueNames()
    $envGoneOk=$true
    foreach($e in $a.exes){ if($names2 -contains (EnvNameOf $e)){ $envGoneOk=$false } }
    $r.envGone=$envGoneOk
    if(-not ($r.dirGone -and $r.keyGone -and $r.shortcutsGone -and $r.envGone)){
      $r.fallbackCleanup=$true
      Log ($a.app+' cleanup incomplete -> fallback cleanup')
      Force-Cleanup $a $instUsed
      Start-Sleep -Milliseconds 500
      $r.dirGone=(-not (Test-Path -LiteralPath $instUsed))
      $r.keyGone=(-not (Test-Path -LiteralPath $kp))
      $r.shortcutsGone=(-not (Test-Path -LiteralPath $smDirUsed))
      $envKey3=Get-Item 'HKCU:\Environment'
      $names3=$envKey3.GetValueNames()
      $envGoneOk=$true
      foreach($e in $a.exes){ if($names3 -contains (EnvNameOf $e)){ $envGoneOk=$false } }
      $r.envGone=$envGoneOk
    }
    $r.cleanupComplete=($r.dirGone -and $r.keyGone -and $r.shortcutsGone -and $r.envGone)
    Log ($a.app+' uninstall exit='+$r.uninstallExitCode+' elapsed='+$r.uninstallElapsedSec+'s dirGone='+$r.dirGone+' keyGone='+$r.keyGone+' shortcutsGone='+$r.shortcutsGone+' envGone='+$r.envGone+' cleanupComplete='+$r.cleanupComplete)
    if(-not $r.cleanupComplete){ $anyFail=$true }
    $allGood=($exeCmp.Count -eq $a.exes.Count) -and (@($exeCmp | Where-Object { -not $_.matchOut }).Count -eq 0) -and $r.iconCompare.match -and ($r.missingFiles.Count -eq 0) -and $r.envMatch -and $r.uninstallKeyMatch -and $r.shortcutsMatch -and $r.cleanupComplete -and ($r.installExitCode -eq 0) -and ($r.uninstallExitCode -eq 0)
    if(-not $allGood){ $anyFail=$true }
  } catch {
    $msg=$_.Exception.Message
    $r.errors+=$msg
    Log ($a.app+' ERROR: '+$msg)
    $anyFail=$true
    try { Force-Cleanup $a $inst } catch { Log ($a.app+' fallback cleanup error: '+$_.Exception.Message) }
    Start-Sleep -Milliseconds 500
    $r.dirGone=(-not (Test-Path -LiteralPath $inst))
    $r.keyGone=(-not (Test-Path -LiteralPath (Join-Path $uninstallRoot $a.unkey)))
    $r.shortcutsGone=(-not (Test-Path -LiteralPath (Join-Path $smParent $a.product)))
    $envKey4=Get-Item 'HKCU:\Environment'
    $names4=$envKey4.GetValueNames()
    $envGoneOk=$true
    foreach($e in $a.exes){ if($names4 -contains (EnvNameOf $e)){ $envGoneOk=$false } }
    $r.envGone=$envGoneOk
    $r.cleanupComplete=($r.dirGone -and $r.keyGone -and $r.shortcutsGone -and $r.envGone)
    if(-not $r.cleanupComplete){ $r.fallbackCleanup=$true }
    Log ($a.app+' after-error cleanup: dirGone='+$r.dirGone+' keyGone='+$r.keyGone+' shortcutsGone='+$r.shortcutsGone+' envGone='+$r.envGone)
  }
  $results.Add($r)
}

Log '=== RESTORE ==='
Restore-Snapshot $before
Start-Sleep -Milliseconds 500
$after=Get-Snapshot
($after | ConvertTo-Json -Depth 10) | Set-Content -LiteralPath (Join-Path $base 'snapshot-after.json') -Encoding UTF8
$beforeJson=($before | ConvertTo-Json -Depth 10 -Compress)
$afterJson=($after | ConvertTo-Json -Depth 10 -Compress)
$restoreEqual=($beforeJson -eq $afterJson)
Log ('restore compare (before==after): '+$restoreEqual)

$cppOutAfter=@(Get-ChildItem -LiteralPath (Join-Path $root 'cpp\out') -Recurse -File | Sort-Object FullName | ForEach-Object { [ordered]@{path=$_.FullName.Substring($root.Length+1);bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash} })
($cppOutAfter | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath (Join-Path $base 'cpp-out-after.json') -Encoding UTF8
$cppOutChanged=(-not (($cppOutBefore | ConvertTo-Json -Depth 5 -Compress) -eq ($cppOutAfter | ConvertTo-Json -Depth 5 -Compress)))
Log ('cpp/out changed during test: '+$cppOutChanged)

$baseLeftovers=@(Get-ChildItem -LiteralPath $base -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName.Substring($base.Length+1) })
$smLeftovers=@(Get-ChildItem -LiteralPath $smParent -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
$envLeftover=$false
$ek=Get-Item 'HKCU:\Environment'
foreach($n in $envNames){ if(($ek.GetValueNames()) -contains $n){ if($n -ne 'def_fm' -and $n -ne 'proxy_ip'){ $envLeftover=$true } } }

$summary=[ordered]@{
  startedAt=(Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  root=$root
  backupPath=$backupPath
  restoreEqual=$restoreEqual
  cppOutChanged=$cppOutChanged
  anyFail=$anyFail
  baseLeftoverPaths=$baseLeftovers
  startMenuLeftovers=$smLeftovers
  unexpectedEnvLeftover=$envLeftover
  results=$results
}
($summary | ConvertTo-Json -Depth 12) | Set-Content -LiteralPath $resultPath -Encoding UTF8

Log '=== SUMMARY ==='
Log ('anyFail='+$anyFail+' restoreEqual='+$restoreEqual+' cppOutChanged='+$cppOutChanged)
foreach($x in $results){
  $mOut=@($x.exeCompare | Where-Object { $_.matchOut }).Count
  $em=@($x.exeCompare | Where-Object { -not $_.matchOut })
  Log ($x.app+' | installExit='+$x.installExitCode+' | files='+$x.fileCount+' | exeHashMatch='+$mOut+'/'+$x.exeCompare.Count+' | icon='+$x.iconCompare.match+' | env='+$x.envMatch+' | unkey='+$x.uninstallKeyMatch+' | lnk='+$x.shortcutsMatch+' | uninstExit='+$x.uninstallExitCode+' | dirGone='+$x.dirGone+' keyGone='+$x.keyGone+' lnkGone='+$x.shortcutsGone+' envGone='+$x.envGone+' | cleanup='+$x.cleanupComplete)
  if($em.Count -gt 0){ foreach($d in $em){ Log ('   MISMATCH '+$d.name+' installed='+$d.installedSha256+' out='+$d.outSha256) } }
}
Log '=== E2E DONE ==='
