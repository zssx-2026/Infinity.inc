# dirwalk.ps1 - what does unblockSelfDirectory(2) cost at startup?
#
# The suite's programs now call inc::unblockSelfDirectory(2) in main(), before
# anything else. That walks the executable's own directory two levels down and
# deletes the Zone.Identifier stream from every .exe/.dll/.pak/.dat/.json/.txt
# it finds. This script measures what that costs when the folder is empty and
# when it looks like an extracted portable folder.
param(
  [Parameter(Mandatory=$true)][string]$Exe,
  [string]$Root = "$env:TEMP\ing-dirwalk",
  [int]$Reps = 5,
  [int]$TopFiles = 2000,
  [int]$SubDirs = 100,
  [int]$FilesPerSub = 10
)
$ErrorActionPreference = 'Stop'
$Exe = (Resolve-Path $Exe).Path
$Root = [System.IO.Path]::GetFullPath($Root)

function Median([double[]]$v) { $s = $v | Sort-Object; $n = $s.Count
  if ($n % 2 -eq 1) { return [double]$s[[int](($n - 1) / 2)] }
  return [double](($s[$n / 2 - 1] + $s[$n / 2]) / 2) }

function Measure-Version([string]$dir, [int]$reps) {
  $exe = Join-Path $dir 'ing.exe'
  $s = New-Object 'double[]' $reps
  for ($r = -1; $r -lt $reps; $r++) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $exe; $psi.Arguments = '--version'
    $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $p = [System.Diagnostics.Process]::Start($psi)
    [void]$p.StandardOutput.ReadToEnd(); $p.WaitForExit(); $sw.Stop()
    if ($r -ge 0) { $s[$r] = $sw.Elapsed.TotalMilliseconds }
  }
  return @{ samples = @($s | ForEach-Object { [math]::Round($_, 2) }); median = [math]::Round((Median $s), 2) }
}

$bare = Join-Path $Root 'bare'
$many = Join-Path $Root 'many'
Remove-Item -Recurse -Force $Root -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $bare, $many | Out-Null
Copy-Item $Exe (Join-Path $bare 'ing.exe') -Force
Copy-Item $Exe (Join-Path $many 'ing.exe') -Force

# a portable folder's worth of files, all inside two levels of the exe
1..$TopFiles | ForEach-Object { [System.IO.File]::WriteAllText((Join-Path $many ('f{0:d5}.dat' -f $_)), 'x') }
1..$SubDirs | ForEach-Object {
  $d = Join-Path $many ('sub{0:d3}' -f $_)
  New-Item -ItemType Directory -Force -Path $d | Out-Null
  1..$FilesPerSub | ForEach-Object { [System.IO.File]::WriteAllText((Join-Path $d ('g{0:d3}.dat' -f $_)), 'x') }
}
$fileCount = (Get-ChildItem -Recurse -File $many | Measure-Object).Count

# mark half the top-level files as downloaded, so the first run has real work
1..($TopFiles / 2) | ForEach-Object {
  Set-Content -Path (Join-Path $many ('f{0:d5}.dat' -f $_)) -Stream Zone.Identifier -Value '[ZoneTransfer]' -ErrorAction SilentlyContinue
}

$r = [ordered]@{}
$r.exe = $Exe
$r.filesUnderMany = $fileCount
$r.bare = Measure-Version $bare $Reps
$r.manyFirstRun = Measure-Version $many 1
$r.manySteady = Measure-Version $many $Reps
$r.bareAgain = Measure-Version $bare $Reps
$r | ConvertTo-Json -Depth 5 -Compress
