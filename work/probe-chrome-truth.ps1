$ErrorActionPreference='Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'shell\build\inc_gui-win32-x64\inc_gui.exe'
$out = Join-Path $PSScriptRoot 'shell-chrome-truth.json'
if (Test-Path $out) { Remove-Item $out -Force }
$env:INFINITY_SHELL_PROBE='1'; $env:INFINITY_SHELL_PROBE_FILE=$out; $env:INFINITY_SHELL_PROBE_NTP='1'; $env:INFINITY_SHELL_PROBE_KEYS='1'
Remove-Item Env:\INFINITY_SHELL_PROBE_QUERY -ErrorAction SilentlyContinue
$p = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
if (-not $p.WaitForExit(180000)) { $p.Kill(); throw 'timeout' }
$j = [System.IO.File]::ReadAllText($out,[System.Text.Encoding]::UTF8) | ConvertFrom-Json
$fail = 0
function Chk($n,$ok,$v){ if($ok){Write-Output ('PASS ' + $n + ' ' + $v)}else{Write-Output ('FAIL ' + $n + ' ' + $v); $script:fail++} }
Chk 'menuVersion' ($j.menuVersion -eq 'v1.0.0') $j.menuVersion
Chk 'hostPill-not-raw-key' (-not ($j.hostPill -like 'status.*')) $j.hostPill
Chk 'ntp-present' ([int]$j.ntpNodes -ge 1) ('ntpNodes=' + $j.ntpNodes)
Chk 'ntp-footer-text' ($j.ntpFooter -like '*Infinity.Inc*') $j.ntpFooter
Chk 'ntp-footer-not-demo' (-not ($j.ntpFooter -like '*演示*' -or $j.ntpFooter -like '*demo*')) $j.ntpFooter
Chk 'shortcut-ctrl-j-opens' ($j.keyProbe.ctrlJOpens -eq $true) ('ctrlJOpens=' + $j.keyProbe.ctrlJOpens)
Chk 'shortcut-ctrl-j-closes' ($j.keyProbe.ctrlJCloses -eq $true) ('ctrlJCloses=' + $j.keyProbe.ctrlJCloses)
Chk 'shortcut-ctrl-h-history' ($j.keyProbe.ctrlHHistory -eq $true) ('ctrlHHistory=' + $j.keyProbe.ctrlHHistory)
if ($fail -eq 0) { Write-Output 'CHROME-TRUTH PASS' ; exit 0 } else { Write-Output ('CHROME-TRUTH FAIL ' + $fail); exit 1 }
