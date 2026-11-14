$ErrorActionPreference='Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'shell\build\inc_gui-win32-x64\inc_gui.exe'
$out = Join-Path $PSScriptRoot 'shell-chrome-truth.json'
if (Test-Path $out) { Remove-Item $out -Force }
$env:INFINITY_SHELL_PROBE='1'; $env:INFINITY_SHELL_PROBE_FILE=$out; $env:INFINITY_SHELL_PROBE_NTP='1'; $env:INFINITY_SHELL_PROBE_KEYS='1'; $env:INFINITY_SHELL_PROBE_HISTORY='1'; $env:INFINITY_SHELL_PROBE_ABOUT='1'; $env:INFINITY_SHELL_PROBE_EXIT='1'
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
Chk 'about-opens' ($j.aboutProbe.visible -eq $true) ('visible=' + $j.aboutProbe.visible)
Chk 'about-version' ($j.aboutProbe.version -eq 'v1.0.0') ('version=' + $j.aboutProbe.version)
Chk 'about-host-not-bridge' (([string]$j.aboutProbe.host) -notmatch 'postMessage') ('host=' + $j.aboutProbe.host)
Chk 'about-shell-names-runtime' (([string]$j.aboutProbe.shell) -match 'Electron') ('shell=' + $j.aboutProbe.shell)
Chk 'about-apps-installed' (([string]$j.aboutProbe.apps) -match 'INC') ('apps=' + $j.aboutProbe.apps)
Chk 'exit-dialog-opens' ($j.exitProbe.visible -eq $true) ('visible=' + $j.exitProbe.visible)
Chk 'exit-honest-when-restore-off' (([string]$j.exitProbe.body) -match '不会自动恢复') ('body=' + $j.exitProbe.body)
Chk 'sidebar-marks-uninstalled' ([int]$j.exitProbe.sidebarOff -ge 1) ('off=' + $j.exitProbe.sidebarOff)
Chk 'exit-body-english' (([string]$j.exitProbe.bodyEn) -match 'Restore session') ('bodyEn=' + $j.exitProbe.bodyEn)
Chk 'exit-body-not-raw-key' (-not (([string]$j.exitProbe.bodyEn) -like 'exit.*')) ('localeEn=' + $j.exitProbe.localeEn)
Chk 'history-records-visit' ([int]$j.histProbe.rows -ge 1) ('rows=' + $j.histProbe.rows + ' count=' + $j.histProbe.count)
Chk 'history-not-empty-page' ($j.histProbe.empty -eq $false) ('empty=' + $j.histProbe.empty)
Chk 'shortcut-ctrl-h-history' ($j.keyProbe.ctrlHHistory -eq $true) ('ctrlHHistory=' + $j.keyProbe.ctrlHHistory)
if ($fail -eq 0) { Write-Output 'CHROME-TRUTH PASS' ; exit 0 } else { Write-Output ('CHROME-TRUTH FAIL ' + $fail); exit 1 }
