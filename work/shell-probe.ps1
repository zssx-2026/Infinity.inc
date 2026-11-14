param([string]$Prefix = 'inc', [string]$Tag = 'shell', [switch]$Actions)
$ErrorActionPreference = 'Stop'
$root = 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
$dir = Join-Path $root ('shell\build\' + $Prefix + '_gui-win32-x64')
$app = Join-Path $dir 'resources\app'
if (-not (Test-Path $dir)) { throw ('no shell dir: ' + $dir) }
# A development probe runs the sources on disk, not the copy a build staged.
Copy-Item -Force (Join-Path $root 'shell\main.js') (Join-Path $app 'main.js')
Copy-Item -Force (Join-Path $root 'shell\preload.js') (Join-Path $app 'preload.js')
$cli = Join-Path $root ('cpp\out\' + $Prefix + '\' + $Prefix + '_cli.exe')
if (Test-Path $cli) { Copy-Item -Force $cli (Join-Path $dir ($Prefix + '_cli.exe')) }
$json = Join-Path $root ('work\' + $Tag + '-' + $Prefix + '.json')
$png = Join-Path $root ('work\' + $Tag + '-' + $Prefix + '.png')
Remove-Item -Force $json, $png -ErrorAction SilentlyContinue
$env:INFINITY_SHELL_PROBE = '1'
$env:INFINITY_SHELL_PROBE_FILE = $json
$env:INFINITY_SHELL_PROBE_PNG = $png
if ($Actions) { $env:INFINITY_SHELL_PROBE_ACTIONS = '1' }
$exe = Join-Path $dir ($Prefix + '_gui.exe')
$w = Start-Process -WindowStyle Hidden -FilePath $exe -PassThru
$w.WaitForExit(180000) | Out-Null
Remove-Item Env:INFINITY_SHELL_PROBE, Env:INFINITY_SHELL_PROBE_FILE, Env:INFINITY_SHELL_PROBE_PNG, Env:INFINITY_SHELL_PROBE_ACTIONS -ErrorAction SilentlyContinue
'png=' + $(if (Test-Path $png) { (Get-Item $png).Length } else { 'none' })
if (Test-Path $json) { Get-Content -Raw -Encoding UTF8 $json } else { 'no probe json' }
