# qa-pre8-install.ps1 - silent-install each pre8 setup, prove the chrome window
# renders the product at native scale, then uninstall. Run from the repo root.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
$rel  = Join-Path $root 'cpp\release\v1.0pre8'
$apps = @(
  @{ prefix = 'inc'; product = 'Infinity Cloud';         pkg = 'InfinityCloud' },
  @{ prefix = 'ipm'; product = 'InfinityPackageManager'; pkg = 'InfinityPackageManager' },
  @{ prefix = 'int'; product = 'Infinity Toolbox';        pkg = 'InfinityToolbox' }
)
# A first run must ask for a token, so nothing may be stored beforehand.
Remove-Item -Force -Recurse (Join-Path $env:LOCALAPPDATA 'Infinity') -ErrorAction SilentlyContinue
# A previous aborted run may have left programs behind; start from nothing.
foreach ($a in $apps) { Remove-Item -Force -Recurse (Join-Path $env:LOCALAPPDATA ('Programs\Infinity.Inc\' + $a.product)) -ErrorAction SilentlyContinue }

$fail = 0
foreach ($a in $apps) {
  $setup = Join-Path $rel ($a.pkg + '_1.0.0-pre8_win64_setup.exe')
  "== $($a.product) =="
  if (-not (Test-Path $setup)) { "  FAIL no setup: $setup"; $fail++; continue }
  "  setup  " + (Get-Item $setup).Length + ' B'
  # -WindowStyle Hidden: the installer must never flash a console window.
  $p = Start-Process -FilePath $setup -ArgumentList '/S' -PassThru -Wait -WindowStyle Hidden
  "  install exit=" + $p.ExitCode
  $dir = Join-Path $env:LOCALAPPDATA ('Programs\Infinity.Inc\' + $a.product)
  $shell = Join-Path $dir ($a.prefix + '_shell')
  $win = Join-Path $shell ($a.prefix + '_window.exe')
  $cli = Join-Path $dir ($a.prefix + '_cli.exe')
  $ui  = Join-Path $shell 'resources\app\ui\index.html'
  "  dir    " + (Test-Path $dir) + '  window=' + (Test-Path $win) + '  cli=' + (Test-Path $cli) + '  chrome=' + (Test-Path $ui)
  if (-not (Test-Path $win) -or -not (Test-Path $cli) -or -not (Test-Path $ui)) { "  FAIL payload incomplete"; $fail++; continue }
  "  window " + (Get-Item $win).Length + ' B'
  "  shell files " + (Get-ChildItem $shell -Recurse -File | Measure-Object).Count + ' / ' + [math]::Round(((Get-ChildItem $shell -Recurse -File | Measure-Object Length -Sum).Sum/1MB),1) + ' MB'

  $json = Join-Path $root ('work\qa8-' + $a.prefix + '.json')
  $png  = Join-Path $root ('work\qa8-' + $a.prefix + '.png')
  Remove-Item -Force $json, $png -ErrorAction SilentlyContinue
  $env:INFINITY_SHELL_PROBE = '1'
  $env:INFINITY_SHELL_PROBE_FILE = $json
  $env:INFINITY_SHELL_PROBE_PNG = $png
  $w = Start-Process -WindowStyle Hidden -FilePath $win -PassThru
  $w.WaitForExit(120000) | Out-Null
  Remove-Item Env:INFINITY_SHELL_PROBE, Env:INFINITY_SHELL_PROBE_FILE, Env:INFINITY_SHELL_PROBE_PNG -ErrorAction SilentlyContinue
  if (Test-Path $json) {
    $info = [System.IO.File]::ReadAllText($json, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    "  probe  dpr=" + $info.dpr + ' scale=' + $info.scaleFactor + ' css=' + $info.cssW + 'x' + $info.cssH + ' origin=' + $info.origin + ' tabs=' + $info.tabCount + ' audio=' + $info.audioElements + ' frame=' + $info.frameSrc
    "  title  " + $info.title
    if ([double]$info.dpr -lt 1.49) { "  FAIL devicePixelRatio below the desktop scale"; $fail++ }
    if ($info.title -ne 'Infinity Edge Shell') { "  FAIL title " + $info.title; $fail++ }
    if ($info.origin -ne 'infinity-shell://ui') { "  FAIL origin " + $info.origin; $fail++ }
    if ([int]$info.tabCount -lt 1) { "  FAIL no tab rendered"; $fail++ }
    if (([string]$info.frameSrc).IndexOf('http://127.0.0.1:') -ne 0) { "  FAIL frame src " + $info.frameSrc; $fail++ }
    # Quiet rule: the shipped chrome may not carry an audio element at all.
    if ([int]$info.audioElements -ne 0) { "  FAIL audio elements in page: " + $info.audioElements; $fail++ }
    $uiAudio = (Select-String -Path $ui -Pattern '<audio' -SimpleMatch | Measure-Object).Count
    if ($uiAudio -ne 0) { "  FAIL shipped chrome has <audio>"; $fail++ }
  } else { "  FAIL no probe json"; $fail++ }
  if (Test-Path $png) { "  shot   " + (Get-Item $png).Length + ' B' } else { "  FAIL no screenshot"; $fail++ }

  $un = Join-Path $dir 'Uninstall.exe'
  if (Test-Path $un) {
    $u = Start-Process -FilePath $un -ArgumentList '/S' -PassThru -Wait -WindowStyle Hidden
    "  uninstall exit=" + $u.ExitCode + '  gone=' + (-not (Test-Path $dir))
  } else { "  WARN no uninstaller" }
  ""
}
if ($fail -eq 0) { 'PRE8-INSTALL-QA PASS 3/3' } else { "PRE8-INSTALL-QA FAIL $fail" ; exit 1 }
