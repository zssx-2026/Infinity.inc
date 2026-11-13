$ErrorActionPreference = 'Continue'
Set-Location 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
$env:INC_SHELL = 'electron'
$env:INC_SHELL_ARCH = 'win32-x64'
$env:INC_RELEASE = 'v1.0pre8'
$env:INC_VERSION = '1.0.0-pre8'
Write-Output ('=== package ' + (Get-Date -Format o))
& node cpp/tools/package.mjs
Write-Output ('--- package exit=' + $LASTEXITCODE)
$dir = 'cpp\release\v1.0pre8'
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Thumbprint -eq '3C626CCE1DFA8833F844BA176DB1922B7B4069C2' } | Select-Object -First 1
if (-not $cert) { Write-Output 'NO CERT'; exit 1 }
foreach ($exe in Get-ChildItem (Join-Path $dir '*.exe')) {
  $ok = $false
  for ($i = 1; $i -le 4 -and -not $ok; $i++) {
    $sig = Set-AuthenticodeSignature -FilePath $exe.FullName -Certificate $cert -TimestampServer 'http://timestamp.digicert.com' -HashAlgorithm SHA256
    Write-Output ('sign ' + $exe.Name + ' attempt=' + $i + ' status=' + $sig.Status)
    if ($sig.Status -eq 'Valid') { $ok = $true }
    else { Start-Sleep -Seconds 3 }
  }
  if (-not $ok) { Write-Output ('SIGN-FAIL ' + $exe.Name) }
}
foreach ($f in Get-ChildItem (Join-Path $dir '*')) { Write-Output ($f.Name + ' ' + $f.Length) }
exit 0
