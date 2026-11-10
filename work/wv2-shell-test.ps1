$ErrorActionPreference = 'Continue'
$nl = [string][char]10
$req = 'protocol=https' + $nl + 'host=github.com' + $nl + $nl
$cred = ($req | git credential fill) -split $nl
$tok = ($cred | Where-Object { $_ -like 'password=*' }) -replace '^password=', ''
if (-not $tok) { 'NO-TOKEN'; exit 2 }
$env:EV_GH_TOKEN = $tok.Trim()
$env:gittoken_zssx_2026_1 = $tok.Trim()
$h = (Resolve-Path 'work\webview2\webview2-host.exe').Path
$exe = (Resolve-Path 'cpp\out\inc\inc_gui.exe').Path
& $h "--spawn=$exe" --port=7621 --screenshot=work\webview2\shell-inc.png --probe=work\webview2\shell-inc.probe.json --result=work\webview2\shell-inc.json --hold-ms=1800 --timeout-ms=45000
"EXIT=$LASTEXITCODE"
Start-Sleep -Milliseconds 1200
"ORPHAN-SERVER: " + (@(Get-Process inc_gui -ErrorAction SilentlyContinue).Count)
Remove-Item Env:EV_GH_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:gittoken_zssx_2026_1 -ErrorAction SilentlyContinue