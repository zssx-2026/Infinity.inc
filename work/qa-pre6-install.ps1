# qa-pre6-install.ps1 - silent-install each pre6 setup, prove the window renders
# the product at native scale, then uninstall. Run from the repository root.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$rel  = Join-Path $root 'cpp\release\v1.0pre6'
$apps = @(
  @{ prefix = 'inc'; product = 'Infinity Cloud';        pkg = 'InfinityCloud' },
  @{ prefix = 'ipm'; product = 'InfinityPackageManager'; pkg = 'InfinityPackageManager' },
  @{ prefix = 'int'; product = 'Infinity Toolbox';       pkg = 'InfinityToolbox' }
)
# A first run must ask for a token, so nothing may be stored beforehand.
Remove-Item -Force -Recurse (Join-Path $env:LOCALAPPDATA 'Infinity') -ErrorAction SilentlyContinue

$fail = 0
foreach ($a in $apps) {
  $setup = Join-Path $rel ($a.pkg + '_1.0.0-pre6_win64_setup.exe')
  "== $($a.product) =="
  if (-not (Test-Path $setup)) { "  FAIL no setup: $setup"; $fail++; continue }
  "  setup  " + (Get-Item $setup).Length + ' B'
  $p = Start-Process -WindowStyle Hidden -FilePath $setup -ArgumentList '/S' -PassThru -Wait
  "  install exit=" + $p.ExitCode
  $dir = Join-Path $env:LOCALAPPDATA ('Programs\Infinity.Inc\' + $a.product)
  $shell = Join-Path $dir ($a.prefix + '_shell')
  $win = Join-Path $shell ($a.prefix + '_window.exe')
  $cli = Join-Path $dir ($a.prefix + '_cli.exe')
  "  dir    " + (Test-Path $dir) + '  window=' + (Test-Path $win) + '  cli=' + (Test-Path $cli)
  if (-not (Test-Path $win) -or -not (Test-Path $cli)) { "  FAIL payload incomplete"; $fail++; continue }
  "  window " + (Get-Item $win).Length + ' B'
  "  shell files " + (Get-ChildItem $shell -Recurse -File | Measure-Object).Count + ' / ' + [math]::Round(((Get-ChildItem $shell -Recurse -File | Measure-Object Length -Sum).Sum/1MB),1) + ' MB'

  $json = Join-Path $root ('work\qa-' + $a.prefix + '.json')
  $png  = Join-Path $root ('work\qa-' + $a.prefix + '.png')
  Remove-Item -Force $json, $png -ErrorAction SilentlyContinue
  $env:INFINITY_SHELL_PROBE = '1'
  $env:INFINITY_SHELL_PROBE_FILE = $json
  $env:INFINITY_SHELL_PROBE_PNG = $png
  $w = Start-Process -WindowStyle Hidden -FilePath $win -PassThru
  $w.WaitForExit(90000) | Out-Null
  Remove-Item Env:INFINITY_SHELL_PROBE, Env:INFINITY_SHELL_PROBE_FILE, Env:INFINITY_SHELL_PROBE_PNG -ErrorAction SilentlyContinue
  if (Test-Path $json) {
    $info = Get-Content -Raw $json | ConvertFrom-Json
    "  probe  dpr=" + $info.dpr + ' scale=' + $info.scaleFactor + ' css=' + $info.cssW + 'x' + $info.cssH + ' title=' + $info.title
    if ([double]$info.dpr -lt 1.49) { "  FAIL devicePixelRatio below the desktop scale"; $fail++ }
    if ($info.title -ne $a.product) { "  FAIL title " + $info.title; $fail++ }
  } else { "  FAIL no probe json"; $fail++ }
  if (Test-Path $png) { "  shot   " + (Get-Item $png).Length + ' B' } else { "  FAIL no screenshot"; $fail++ }

  $un = Join-Path $dir 'Uninstall.exe'
  if (Test-Path $un) {
    $u = Start-Process -WindowStyle Hidden -FilePath $un -ArgumentList '/S' -PassThru -Wait
    "  uninstall exit=" + $u.ExitCode + '  gone=' + (-not (Test-Path $dir))
  } else { "  WARN no uninstaller" }
  ""
}
if ($fail -eq 0) { 'PRE6-INSTALL-QA PASS 3/3' } else { "PRE6-INSTALL-QA FAIL $fail" ; exit 1 }
