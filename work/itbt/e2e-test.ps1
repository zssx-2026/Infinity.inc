$ErrorActionPreference = 'Continue'
$int = './cpp/build/int.exe'
$container = 'work/itbt/FastBrowser.itbt'
$source = 'D:/dev/DeepSeekHarnessWorkspace/fastbrowser/fastbrowser.exe'
$sandbox = Join-Path $PWD 'work/itbt/_sandbox'
Remove-Item -Recurse -Force $sandbox -ErrorAction SilentlyContinue
$lad = Join-Path $sandbox 'localappdata'
$root = Join-Path (Join-Path $lad 'Infinity.Inc') 'plugin'
New-Item -ItemType Directory -Force $root | Out-Null
$env:LOCALAPPDATA = $lad

Write-Output '=== A. int plugin install work/itbt/FastBrowser.itbt ==='
& $int plugin install $container 2>&1 | Out-String
Write-Output "EXIT=$LASTEXITCODE"

Write-Output '=== B. install again (should be a no-op) ==='
& $int plugin install $container 2>&1 | Out-String
Write-Output "EXIT=$LASTEXITCODE"

Write-Output '=== C. container dropped into the plugin root, then int plugin list ==='
Copy-Item $container (Join-Path $root 'FastBrowser.itbt') -Force
& $int plugin list 2>&1 | Out-String
Write-Output "EXIT=$LASTEXITCODE"

Write-Output '=== D. int plugin verify FastBrowser ==='
& $int plugin verify FastBrowser 2>&1 | Out-String
Write-Output "EXIT=$LASTEXITCODE"

Write-Output '=== D2. int plugin verify work/itbt/FastBrowser.itbt (explicit file) ==='
& $int plugin verify $container 2>&1 | Out-String
Write-Output "EXIT=$LASTEXITCODE"

Write-Output '=== E. round trip: extracted files vs the packed sources ==='
$a = (Get-FileHash (Join-Path (Join-Path $root 'FastBrowser') 'fastbrowser.exe') -Algorithm SHA256).Hash.ToLower()
$b = (Get-FileHash $source -Algorithm SHA256).Hash.ToLower()
Write-Output "extracted fastbrowser.exe $a"
Write-Output "source    fastbrowser.exe $b"
Write-Output "match=$($a -eq $b)"
$c = (Get-FileHash (Join-Path (Join-Path $root 'FastBrowser') 'item.json') -Algorithm SHA256).Hash.ToLower()
$d = (Get-FileHash 'work/itbt/sample/FastBrowser/item.json' -Algorithm SHA256).Hash.ToLower()
Write-Output "extracted item.json      $c"
Write-Output "source    item.json      $d"
Write-Output "match=$($c -eq $d)"

Write-Output '=== F. legacy directory plugin still listed ==='
$legacy = Join-Path $root 'LegacyDir'
New-Item -ItemType Directory -Force $legacy | Out-Null
Copy-Item 'work/itbt/sample/LegacyDir/item.json' $legacy -Force
Copy-Item 'work/itbt/_test/src/hello.exe' $legacy -Force
& $int plugin list 2>&1 | Out-String
Write-Output "EXIT=$LASTEXITCODE"

Write-Output '=== G. one byte flipped inside the fastbrowser.exe payload (offset 1282) ==='
$bad = Join-Path $sandbox 'FastBrowser-bad.itbt'
Copy-Item $container $bad -Force
$bytes = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $bad))
$at = 1282
Write-Output "before 0x$($bytes[$at].ToString('x2'))  after 0x$((($bytes[$at] + 1) % 256).ToString('x2'))"
$bytes[$at] = [byte](($bytes[$at] + 1) % 256)
[System.IO.File]::WriteAllBytes((Resolve-Path -LiteralPath $bad), $bytes)
Write-Output '--- int plugin verify <bad.itbt>'
& $int plugin verify $bad 2>&1 | Out-String
Write-Output "EXIT=$LASTEXITCODE"
Write-Output '--- int plugin install <bad.itbt>'
& $int plugin install $bad 2>&1 | Out-String
Write-Output "EXIT=$LASTEXITCODE"

Write-Output '=== H. magic byte flipped (0x49 -> 0x58) ==='
$bad2 = Join-Path $sandbox 'FastBrowser-badmagic.itbt'
Copy-Item $container $bad2 -Force
$b2 = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $bad2))
$b2[0] = [byte]0x58
[System.IO.File]::WriteAllBytes((Resolve-Path -LiteralPath $bad2), $b2)
& $int plugin verify $bad2 2>&1 | Out-String
Write-Output "EXIT=$LASTEXITCODE"

Write-Output '=== I. int --version ==='
& $int --version 2>&1 | Out-String
Write-Output "EXIT=$LASTEXITCODE"
