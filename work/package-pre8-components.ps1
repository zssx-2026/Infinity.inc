$ErrorActionPreference = 'Continue'
Set-Location 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
$env:INC_SHELL = 'electron'
$env:INC_SHELL_ARCH = 'win32-x64'
$env:INC_RELEASE = 'v1.0pre8'
$env:INC_VERSION = '1.0.0-pre8'
Write-Output ('=== package components ' + (Get-Date -Format o))
& node cpp/tools/package.mjs
Write-Output ('--- package exit=' + $LASTEXITCODE)
$dir = 'cpp\release\v1.0pre8'
$names = @('InfinityCloud_1.0.0-pre8_win64_setup.exe','InfinityPackageManager_1.0.0-pre8_win64_setup.exe','InfinityToolbox_1.0.0-pre8_win64_setup.exe')
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Thumbprint -eq '3C626CCE1DFA8833F844BA176DB1922B7B4069C2' } | Select-Object -First 1
if (-not $cert) { Write-Output 'NO CERT'; exit 1 }
foreach ($n in $names) {
  $p = Join-Path $dir $n
  if (-not (Test-Path $p)) { Write-Output ('MISSING ' + $n); continue }
  $ok = $false
  for ($i = 1; $i -le 4 -and -not $ok; $i++) {
    $sig = Set-AuthenticodeSignature -FilePath $p -Certificate $cert -TimestampServer 'http://timestamp.digicert.com' -HashAlgorithm SHA256
    Write-Output ('sign ' + $n + ' attempt=' + $i + ' status=' + $sig.Status)
    if ($sig.Status -eq 'Valid') { $ok = $true } else { Start-Sleep -Seconds 3 }
  }
  if (-not $ok) { Write-Output ('SIGN-FAIL ' + $n) }
  $f = Get-Item $p
  $h = (Get-FileHash $p -Algorithm SHA256).Hash.ToLower()
  Write-Output ('final ' + $n + ' ' + $f.Length + ' ' + $h)
}
exit 0
