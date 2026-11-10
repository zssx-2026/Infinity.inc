$ErrorActionPreference = 'Continue'
$nl = [string][char]10
$req = 'protocol=https' + $nl + 'host=github.com' + $nl + $nl
$cred = ($req | git credential fill) -split $nl
$tok = (($cred | Where-Object { $_ -like 'password=*' }) -replace '^password=', '').Trim()
if (-not $tok) { 'NO-TOKEN'; exit 2 }
$env:EV_GH_TOKEN = $tok
Copy-Item work\webview2\webview2-host.exe cpp\out\inc\inc_window.exe -Force
Copy-Item work\webview2\WebView2Loader.dll cpp\out\inc\WebView2Loader.dll -Force
Push-Location cpp\out\inc
& .\inc_window.exe --app=inc --port=7621 --screenshot=D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\webview2\app-inc.png --probe=D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\webview2\app-inc.probe.json --result=D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\webview2\app-inc.json --hold-ms=1500 --timeout-ms=45000
"EXIT=$LASTEXITCODE"
Pop-Location
Start-Sleep -Milliseconds 800
"ORPHAN: " + (@(Get-Process inc_gui -ErrorAction SilentlyContinue).Count)
Remove-Item cpp\out\inc\inc_window.exe, cpp\out\inc\WebView2Loader.dll -Force -ErrorAction SilentlyContinue
Remove-Item Env:EV_GH_TOKEN -ErrorAction SilentlyContinue