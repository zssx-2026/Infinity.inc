[Console]::OutputEncoding=[Text.Encoding]::UTF8
$ErrorActionPreference='Continue'
Set-Location 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
$root = Join-Path $env:LOCALAPPDATA 'Programs\Infinity.Inc'
$inc = Join-Path $root 'Infinity Cloud'
if (Test-Path $inc) { Remove-Item -Recurse -Force $inc -ErrorAction SilentlyContinue }
Remove-Item -Recurse -Force (Join-Path $env:USERPROFILE 'Downloads\InfinityViewer') -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $env:APPDATA 'infinity-shell') -ErrorAction SilentlyContinue

$setup = Resolve-Path 'cpp\release\v1.0pre8\InfinityCloud_1.0.0-pre8_win64_setup.exe'
$p = Start-Process -WindowStyle Hidden -FilePath $setup -ArgumentList '/S' -PassThru -Wait
Write-Output ('install_exit=' + $p.ExitCode)
if (-not (Test-Path $inc)) { Write-Output 'VIEWER-GUESTDL FAIL not installed'; exit 1 }
$files = (Get-ChildItem $inc -Recurse -File).Count
$bytes = (Get-ChildItem $inc -Recurse -File | Measure-Object -Property Length -Sum).Sum
$mainJs = Join-Path $inc 'inc_shell\resources\app\main.js'
$raw = if (Test-Path $mainJs) { [System.IO.File]::ReadAllText($mainJs, [Text.Encoding]::UTF8) } else { '' }
Write-Output ('cloud files=' + $files + ' bytes=' + $bytes)
Write-Output ('main.js bytes=' + $raw.Length + ' guestProbe=' + $raw.Contains('INFINITY_SHELL_PROBE_GUEST_DL') + ' webviewTag=' + $raw.Contains('webviewTag: true'))

$env:INFINITY_SHELL_PROBE='1'
$env:INFINITY_SHELL_PROBE_GUEST_DL='1'
$env:INFINITY_SHELL_PROBE_FILE=(Join-Path (Get-Location) 'work\viewer-guestdl-probe.json')
Remove-Item work\viewer-guestdl-probe.json -ErrorAction SilentlyContinue
$win = Join-Path $inc 'inc_shell\inc_window.exe'
$w = Start-Process -WindowStyle Hidden -FilePath $win -PassThru
$w.WaitForExit(120000) | Out-Null
Write-Output ('window_probe_exit=' + $w.ExitCode)
$good = $false
if (Test-Path work\viewer-guestdl-probe.json) {
  $rawJson = [System.IO.File]::ReadAllText((Join-Path (Get-Location) 'work\viewer-guestdl-probe.json'), [Text.Encoding]::UTF8)
  $j = $rawJson | ConvertFrom-Json
  $g = $j.guestDownload
  Write-Output ('probe items=' + $g.items + ' names=' + ($g.names -join ',') + ' bytes=' + ($g.bytes -join ',') + ' onDisk=' + $g.onDisk + ' clicked=' + $g.clicked)
  $good = ($g.items -eq 1) -and ($g.names[0] -eq 'guest.bin') -and ($g.bytes[0] -eq 2097152) -and ($g.onDisk -eq 2097152)
} else { Write-Output 'no probe json' }

$un = Join-Path $inc 'Uninstall.exe'
if (Test-Path $un) { $u = Start-Process -WindowStyle Hidden -FilePath $un -ArgumentList '/S' -PassThru -Wait; Write-Output ('uninstall_exit=' + $u.ExitCode) }
Start-Sleep -Seconds 3
$left = Test-Path $inc
Write-Output ('dir_left=' + $left)
if ($good -and -not $left) { Write-Output 'VIEWER-GUESTDL PASS'; exit 0 }
Write-Output 'VIEWER-GUESTDL FAIL'
exit 1
