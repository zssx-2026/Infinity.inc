<#
  restore-history.ps1 - Independent restore tool for the Infinity.Inc history archive.
  Author: hist-restorer. Independent implementation; does NOT call work/unpack-history.mjs.

  Container format (defined by work/pack-history.mjs, parsed independently here):
    [0 .. 4095]   4096-byte header: JSON padded with spaces, last byte 0x0A
    chunk line    {"t":"c","i":<chunkIndex>,"n":<rawLen>,"d":"<base64(brotli(raw))>"}
    entry line    {"t":"e","p":<relPath>,"s":<size>,"m":<mtime>,"h":<sha256>,"g":[[chunk,off,len],...]}
    Fixed order: header | all chunk lines | all entry lines

  Dependency note: Windows PowerShell 5.1 / .NET Framework has no Brotli decoder
  (System.IO.Compression.BrotliStream exists only on .NET Core 2.1+; no PS7 here,
  and the installed Python 3.12 has no brotli module and there is no network).
  Therefore ONLY the base64+brotli decode step is delegated to Node's built-in zlib.
  Container parsing, entry parsing, segment assembly, SHA-256 hashing, path
  reconstruction and comparison are all implemented here in .NET/PowerShell.
  This script is deliberately ASCII-only so Windows PowerShell 5.1 parses it
  correctly regardless of the active ANSI code page.
#>
[CmdletBinding()]
param(
    [string]$Archive,
    [string]$Manifest,
    [string]$OutDir,
    [switch]$All,
    [string[]]$Path,
    [int]$MinSample   = 300,
    [int]$TopLargest  = 20,
    [int]$ChineseSample = 150,
    [int]$CrossChunkSample = 150,
    [int]$RandomFill  = 150,
    [int]$Seed        = 20261003,
    [string]$NodeExe  = 'node',
    [string]$SummaryJson,
    [switch]$KeepTemp
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$script:sw = [System.Diagnostics.Stopwatch]::StartNew()

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $Archive)  { $Archive  = Join-Path $repoRoot 'history\history.jsonl' }
if (-not $Manifest) { $Manifest = Join-Path $repoRoot 'work\history-manifest.json' }
if (-not $OutDir)   { $OutDir   = Join-Path $repoRoot 'work\restore-sample' }
$Archive  = [IO.Path]::GetFullPath($Archive)
$Manifest = [IO.Path]::GetFullPath($Manifest)
$OutDir   = [IO.Path]::GetFullPath($OutDir)

function Write-Info([string]$msg) { Write-Host $msg }

function ConvertFrom-JsonEscaped([string]$s) {
    if ($s.IndexOf([char]92) -lt 0) { return $s }
    $sb = New-Object System.Text.StringBuilder ($s.Length + 8)
    $i = 0
    while ($i -lt $s.Length) {
        $c = $s[$i]
        if ($c -eq [char]92 -and ($i + 1) -lt $s.Length) {
            $n = $s[$i + 1]
            if     ($n -eq '"')  { [void]$sb.Append('"');           $i += 2; continue }
            elseif ($n -eq [char]92) { [void]$sb.Append([char]92);  $i += 2; continue }
            elseif ($n -eq '/')  { [void]$sb.Append('/');           $i += 2; continue }
            elseif ($n -eq 'b')  { [void]$sb.Append([char]8);       $i += 2; continue }
            elseif ($n -eq 'f')  { [void]$sb.Append([char]12);      $i += 2; continue }
            elseif ($n -eq 'n')  { [void]$sb.Append([char]10);      $i += 2; continue }
            elseif ($n -eq 'r')  { [void]$sb.Append([char]13);      $i += 2; continue }
            elseif ($n -eq 't')  { [void]$sb.Append([char]9);       $i += 2; continue }
            elseif ($n -eq 'u' -and ($i + 5) -lt $s.Length) {
                $hex = $s.Substring($i + 2, 4)
                [void]$sb.Append([char][Convert]::ToInt32($hex, 16))
                $i += 6; continue
            }
        }
        [void]$sb.Append($c); $i++
    }
    return $sb.ToString()
}

function Read-Full([IO.Stream]$stream, [byte[]]$b, [int]$off, [int]$count) {
    $total = 0
    while ($total -lt $count) {
        $r = $stream.Read($b, $off + $total, $count - $total)
        if ($r -le 0) { break }
        $total += $r
    }
    return $total
}

function Get-LongPath([string]$p) {
    if ($p.StartsWith('\\?\')) { return $p }
    if ($p.StartsWith('\\')) { return '\\?\UNC\' + $p.Substring(2) }
    return '\\?\' + $p
}

# ---------------------------------------------------------------- open archive
if (-not (Test-Path -LiteralPath $Archive)) { throw "archive not found: $Archive" }
$archiveInfo = Get-Item -LiteralPath $Archive
$fs = [IO.File]::Open($Archive, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
$HEADER_LEN = 4096
$hdrBuf = New-Object byte[] $HEADER_LEN
if ((Read-Full $fs $hdrBuf 0 $HEADER_LEN) -ne $HEADER_LEN) { throw 'archive shorter than 4096 bytes; header read failed' }
$headerJson = ([Text.Encoding]::UTF8.GetString($hdrBuf, 0, $HEADER_LEN)).TrimEnd()
$header = $headerJson | ConvertFrom-Json
Write-Info ("[header] files={0} blobs={1} chunks={2} chunkBytes={3} uniqueBytes={4} origBytes={5} archiveBytes={6} codec={7}" -f $header.files, $header.blobs, $header.chunks, $header.chunkBytes, $header.uniqueBytes, $header.origBytes, $header.archiveBytes, $header.codec)

# ---------------------------------------------------------------- load manifest
$manifestHash = @{}
if (Test-Path -LiteralPath $Manifest) {
    $raw = [IO.File]::ReadAllText($Manifest, [Text.Encoding]::UTF8)
    $rx = [regex]'"p":"((?:[^"\\]|\\.)*)","s":(\d+),"m":(\d+),"h":"([0-9a-f]{64})"'
    foreach ($m in $rx.Matches($raw)) {
        $p = ConvertFrom-JsonEscaped $m.Groups[1].Value
        $manifestHash[$p] = $m.Groups[4].Value
    }
    Write-Info ("[manifest] {0} sha256 entries (header.files={1})" -f $manifestHash.Count, $header.files)
    if ($manifestHash.Count -ne [int]$header.files) {
        Write-Info ("[warn] manifest entries {0} != header files {1}" -f $manifestHash.Count, $header.files)
    }
} else {
    throw "manifest not found: $Manifest"
}

# ---------------------------------------------------------------- Pass 1: scan
$scanSw = [System.Diagnostics.Stopwatch]::StartNew()
$BUFSZ = 64MB
$buf = New-Object byte[] $BUFSZ
$chunkMap = @{}
$entries  = New-Object 'System.Collections.Generic.List[object]'
$entryRx  = [regex]'^\{"t":"e","p":"((?:[^"\\]|\\.)*)","s":(\d+),"m":(\d+),"h":"([0-9a-f]{64})","g":(\[.*\])\}$'
$segRx    = [regex]'\[(\d+),(\d+),(\d+)\]'
$iRx      = [regex]'"i":(\d+)'
$nRx      = [regex]'"n":(\d+)'

$carry = 0
$baseOff = [int64]$HEADER_LEN
$entrySeen = 0
while ($true) {
    $space = $BUFSZ - $carry
    if ($space -le 0) { throw "line longer than buffer ($BUFSZ)" }
    $read = $fs.Read($buf, $carry, $space)
    if ($read -le 0) { break }
    $valid = $carry + $read
    $pos = 0
    while ($pos -lt $valid) {
        $nl = [Array]::IndexOf($buf, [byte]10, $pos, $valid - $pos)
        if ($nl -lt 0) { break }
        $lineOff = $baseOff + $pos
        $lineLen = $nl - $pos
        if ($lineLen -gt 0) {
            if ($buf[$pos + 6] -eq 99) {
                $plen = [Math]::Min(96, $lineLen)
                $prefix = [Text.Encoding]::UTF8.GetString($buf, $pos, $plen)
                $ci = [int]($iRx.Match($prefix).Groups[1].Value)
                $cn = [int64]($nRx.Match($prefix).Groups[1].Value)
                $chunkMap[$ci] = @{ Off = $lineOff; Len = $lineLen; N = $cn }
            } else {
                $line = [Text.Encoding]::UTF8.GetString($buf, $pos, $lineLen)
                $mm = $entryRx.Match($line)
                if ($mm.Success) {
                    $p = ConvertFrom-JsonEscaped $mm.Groups[1].Value
                    $s = [int64]$mm.Groups[2].Value
                    $g = $mm.Groups[5].Value
                    $ck = New-Object 'System.Collections.Generic.HashSet[int]'
                    foreach ($sm in $segRx.Matches($g)) { [void]$ck.Add([int]$sm.Groups[1].Value) }
                    $e = New-Object psobject -Property @{ P = $p; S = $s; ChunkCount = $ck.Count; LineOff = $lineOff; LineLen = $lineLen }
                } else {
                    $o = $line | ConvertFrom-Json
                    $ck = New-Object 'System.Collections.Generic.HashSet[int]'
                    foreach ($sg in @($o.g)) { [void]$ck.Add([int]$sg[0]) }
                    $e = New-Object psobject -Property @{ P = [string]$o.p; S = [int64]$o.s; ChunkCount = $ck.Count; LineOff = $lineOff; LineLen = $lineLen }
                }
                [void]$entries.Add($e)
                $entrySeen++
                if (($entrySeen % 5000) -eq 0) { Write-Info ("[scan] entries={0} elapsed={1:N1}s" -f $entrySeen, $scanSw.Elapsed.TotalSeconds) }
            }
        }
        $pos = $nl + 1
    }
    $left = $valid - $pos
    if ($left -gt 0) { [Array]::Copy($buf, $pos, $buf, 0, $left) }
    $baseOff += [int64]$pos
    $carry = $left
}
if ($carry -gt 0) { throw "trailing partial line at EOF (carry=$carry)" }
$fs.Close()
$scanSw.Stop()
Write-Info ("[scan] done entries={0} chunks={1} in {2:N1}s" -f $entries.Count, $chunkMap.Count, $scanSw.Elapsed.TotalSeconds)

# ---------------------------------------------------------------- sampling
$selSw = [System.Diagnostics.Stopwatch]::StartNew()
$picked = New-Object 'System.Collections.Generic.HashSet[string]'
$sel    = New-Object 'System.Collections.Generic.List[object]'

function Add-Pick($e) {
    if ($null -eq $e) { return }
    if ($picked.Add($e.P)) { [void]$sel.Add($e) }
}
function Pick-Evenly($list, [int]$k) {
    $n = $list.Count
    if ($n -eq 0 -or $k -le 0) { return }
    if ($k -ge $n) { foreach ($e in $list) { Add-Pick $e }; return }
    for ($i = 0; $i -lt $k; $i++) {
        $idx = [int][Math]::Floor(($i * $n) / $k)
        Add-Pick $list[$idx]
    }
}

$stats = @{ largest = 0; zeroTotal = 0; zeroPicked = 0; chineseTotal = 0; chinesePicked = 0; crossTotal = 0; crossPicked = 0; randomPicked = 0 }

if ($Path -and $Path.Count -gt 0) {
    $want = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($x in $Path) { [void]$want.Add($x.Replace('\', '/')) }
    foreach ($e in $entries) { if ($want.Contains($e.P)) { Add-Pick $e } }
    foreach ($x in $want) { if (-not $picked.Contains($x)) { Write-Info ("[warn] path not found in archive: {0}" -f $x) } }
} elseif ($All) {
    foreach ($e in $entries) { Add-Pick $e }
    $stats.largest = [Math]::Min($TopLargest, $entries.Count)
} else {
    $bySize = New-Object 'System.Collections.Generic.List[object]'
    foreach ($e in ($entries | Sort-Object -Property @{Expression={$_.S};Descending=$true}, @{Expression={$_.P};Descending=$false})) { [void]$bySize.Add($e) }
    $topN = [Math]::Min($TopLargest, $bySize.Count)
    for ($i = 0; $i -lt $topN; $i++) { Add-Pick $bySize[$i] }
    $stats.largest = $topN

    $zeros = New-Object 'System.Collections.Generic.List[object]'
    foreach ($e in $entries) { if ($e.S -eq 0) { [void]$zeros.Add($e) } }
    $stats.zeroTotal = $zeros.Count
    $before = $sel.Count
    foreach ($e in $zeros) { Add-Pick $e }
    $stats.zeroPicked = $sel.Count - $before

    $cn = New-Object 'System.Collections.Generic.List[object]'
    foreach ($e in $entries) { if ($e.P -match '[^\x00-\x7F]') { [void]$cn.Add($e) } }
    $stats.chineseTotal = $cn.Count
    $before = $sel.Count
    Pick-Evenly $cn $ChineseSample
    $stats.chinesePicked = $sel.Count - $before

    $cross = New-Object 'System.Collections.Generic.List[object]'
    foreach ($e in $entries) { if ($e.ChunkCount -ge 2) { [void]$cross.Add($e) } }
    $stats.crossTotal = $cross.Count
    $before = $sel.Count
    Pick-Evenly $cross $CrossChunkSample
    $stats.crossPicked = $sel.Count - $before

    $pool = New-Object 'System.Collections.Generic.List[object]'
    foreach ($e in $entries) { if (-not $picked.Contains($e.P)) { [void]$pool.Add($e) } }
    $rnd = New-Object System.Random($Seed)
    $target = [Math]::Max($MinSample, $sel.Count + $RandomFill)
    while ($sel.Count -lt $target -and $pool.Count -gt 0) {
        $k = $rnd.Next($pool.Count)
        Add-Pick $pool[$k]
        $pool.RemoveAt($k)
        $stats.randomPicked++
    }
}
$selSw.Stop()
Write-Info ("[select] sample={0} (largest={1} zeros={2}/{3} chinese={4}/{5} cross={6}/{7} random={8}) in {9:N1}s" -f $sel.Count, $stats.largest, $stats.zeroPicked, $stats.zeroTotal, $stats.chinesePicked, $stats.chineseTotal, $stats.crossPicked, $stats.crossTotal, $stats.randomPicked, $selSw.Elapsed.TotalSeconds)

# ---------------------------------------------------------------- needed chunks
$needSet = New-Object 'System.Collections.Generic.HashSet[int]'
foreach ($e in $sel) {
    if ($e.ChunkCount -eq 0) { continue }
    $lp = New-Object byte[] $e.LineLen
    $fsLine = [IO.File]::Open($Archive, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
        [void]$fsLine.Seek($e.LineOff, [IO.SeekOrigin]::Begin)
        if ((Read-Full $fsLine $lp 0 $e.LineLen) -ne $e.LineLen) { throw "short entry line read" }
    } finally { $fsLine.Close() }
    $line = [Text.Encoding]::UTF8.GetString($lp)
    $mm = $entryRx.Match($line)
    if (-not $mm.Success) { throw "entry line parse failed" }
    foreach ($sm in $segRx.Matches($mm.Groups[5].Value)) { [void]$needSet.Add([int]$sm.Groups[1].Value) }
}
$need = New-Object 'System.Collections.Generic.List[int]'
foreach ($ci in $needSet) { [void]$need.Add($ci) }
$need.Sort()
Write-Info ("[plan] chunks needed {0}/{1}" -f $need.Count, $chunkMap.Count)
foreach ($ci in $need) { if (-not $chunkMap.ContainsKey($ci)) { throw "entry references missing chunk $ci" } }

# ---------------------------------------------------------------- Pass 2: decompress chunks
$decSw = [System.Diagnostics.Stopwatch]::StartNew()
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('hist-restore-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($tempRoot)
$nodeScript = @'
const fs = require('fs');
const z = require('zlib');
const arc = process.argv[2];
const off = Number(process.argv[3]);
const len = Number(process.argv[4]);
const outF = process.argv[5];
const exp = Number(process.argv[6]);
const fd = fs.openSync(arc, 'r');
const buf = Buffer.allocUnsafe(len);
let got = 0;
while (got < len) {
  const r = fs.readSync(fd, buf, got, len - got, off + got);
  if (r <= 0) throw new Error('short read at ' + off + ' got ' + got + '/' + len);
  got += r;
}
fs.closeSync(fd);
const a = buf.indexOf('"d":"');
const b = buf.lastIndexOf('"}');
if (a < 0 || b < 0) throw new Error('chunk line format unexpected');
const raw = z.brotliDecompressSync(Buffer.from(buf.subarray(a + 5, b).toString('ascii'), 'base64'));
if (exp && raw.length !== exp) { console.error('LEN_MISMATCH got=' + raw.length + ' want=' + exp); process.exit(2); }
fs.writeFileSync(outF, raw);
'@
$jsPath = Join-Path $tempRoot 'brotli_extract.js'
[IO.File]::WriteAllText($jsPath, $nodeScript, (New-Object Text.UTF8Encoding($false)))

$chunkFiles = @{}
$decoded = 0
foreach ($ci in $need) {
    $info = $chunkMap[$ci]
    $outChunk = Join-Path $tempRoot ("chunk_$ci.bin")
    & $NodeExe $jsPath $Archive $info.Off $info.Len $outChunk $info.N
    if ($LASTEXITCODE -ne 0) { throw "chunk $ci brotli decode failed exit=$LASTEXITCODE" }
    $chunkFiles[$ci] = $outChunk
    $decoded++
    if (($decoded % 20) -eq 0) { Write-Info ("[decompress] {0}/{1} chunks, {2:N1}s" -f $decoded, $need.Count, $decSw.Elapsed.TotalSeconds) }
}
$decSw.Stop()
Write-Info ("[decompress] {0} chunks done in {1:N1}s" -f $decoded, $decSw.Elapsed.TotalSeconds)

# ---------------------------------------------------------------- Pass 3: restore
$resSw = [System.Diagnostics.Stopwatch]::StartNew()
[void][IO.Directory]::CreateDirectory((Get-LongPath $OutDir))
$chunkStreams = @{}
$buffer = New-Object byte[] (1MB)
$checks = New-Object 'System.Collections.Generic.List[object]'
$mismatches = New-Object 'System.Collections.Generic.List[object]'
$exact = 0
$restoredBytes = [int64]0
$idx = 0
foreach ($e in $sel) {
    $idx++
    $lp = New-Object byte[] $e.LineLen
    $fsLine = [IO.File]::Open($Archive, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
        [void]$fsLine.Seek($e.LineOff, [IO.SeekOrigin]::Begin)
        if ((Read-Full $fsLine $lp 0 $e.LineLen) -ne $e.LineLen) { throw "short entry line read" }
    } finally { $fsLine.Close() }
    $line = [Text.Encoding]::UTF8.GetString($lp)
    $mm = $entryRx.Match($line)
    if (-not $mm.Success) { throw "entry line parse failed" }
    $segs = @()
    foreach ($sm in $segRx.Matches($mm.Groups[5].Value)) { $segs += ,@([int]$sm.Groups[1].Value, [int64]$sm.Groups[2].Value, [int]$sm.Groups[3].Value) }
    $entryHash = $mm.Groups[4].Value
    $entrySize = [int64]$mm.Groups[2].Value

    $rel = $e.P.Replace('/', '\')
    $dest = [IO.Path]::GetFullPath([IO.Path]::Combine($OutDir, $rel))
    $prefix = $OutDir.TrimEnd('\') + '\'
    if (-not $dest.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "path escapes output dir: $($e.P)" }
    $dir = [IO.Path]::GetDirectoryName($dest)
    if ($dir -and -not [IO.Directory]::Exists((Get-LongPath $dir))) { [void][IO.Directory]::CreateDirectory((Get-LongPath $dir)) }

    $sha = [Security.Cryptography.SHA256]::Create()
    $os = [IO.File]::Open((Get-LongPath $dest), [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        foreach ($seg in $segs) {
            $ci = $seg[0]; $soff = $seg[1]; $slen = $seg[2]
            if (-not $chunkStreams.ContainsKey($ci)) { $chunkStreams[$ci] = [IO.File]::OpenRead($chunkFiles[$ci]) }
            $cs = $chunkStreams[$ci]
            [void]$cs.Seek($soff, [IO.SeekOrigin]::Begin)
            $remaining = $slen
            while ($remaining -gt 0) {
                $take = [Math]::Min($buffer.Length, $remaining)
                $r = $cs.Read($buffer, 0, $take)
                if ($r -le 0) { throw "chunk $ci short read (offset=$soff remain=$remaining)" }
                $os.Write($buffer, 0, $r)
                [void]$sha.TransformBlock($buffer, 0, $r, $null, 0)
                $remaining -= $r
            }
        }
        [void]$sha.TransformFinalBlock((New-Object byte[] 0), 0, 0)
    } finally { $os.Close() }
    $hex = [BitConverter]::ToString($sha.Hash).Replace('-', '').ToLowerInvariant()
    $sha.Dispose()

    $fileLen = (New-Object IO.FileInfo((Get-LongPath $dest))).Length
    $restoredBytes += $fileLen
    $mh = $null
    if ($manifestHash.ContainsKey($e.P)) { $mh = $manifestHash[$e.P] }
    $ok = ($hex -eq $mh) -and ($hex -eq $entryHash) -and ($fileLen -eq $entrySize) -and ($fileLen -eq $e.S)
    if ($ok) { $exact++ } else {
        [void]$mismatches.Add((New-Object psobject -Property @{ path = $e.P; restoredSha = $hex; manifestSha = $mh; entrySha = $entryHash; restoredSize = $fileLen; entrySize = $entrySize; scanSize = $e.S }))
    }
    [void]$checks.Add((New-Object psobject -Property @{ p = $e.P; s = $fileLen; sha256 = $hex; ok = $ok; inManifest = $manifestHash.ContainsKey($e.P) }))
    if (($idx % 100) -eq 0) { Write-Info ("[restore] {0}/{1}, {2:N1}s" -f $idx, $sel.Count, $resSw.Elapsed.TotalSeconds) }
}
foreach ($k in @($chunkStreams.Keys)) { $chunkStreams[$k].Close() }
$resSw.Stop()
$sw.Stop()

Write-Info ("[restore] sample={0} exact={1} mismatch={2} bytes={3} in {4:N1}s" -f $sel.Count, $exact, $mismatches.Count, $restoredBytes, $resSw.Elapsed.TotalSeconds)

# ---------------------------------------------------------------- summary
$summary = [ordered]@{
    archive        = $Archive
    archiveBytes   = $archiveInfo.Length
    manifest       = $Manifest
    manifestEntries = $manifestHash.Count
    header         = @{ files = $header.files; blobs = $header.blobs; chunks = $header.chunks; chunkBytes = $header.chunkBytes; uniqueBytes = $header.uniqueBytes; origBytes = $header.origBytes; codec = $header.codec }
    outDir         = $OutDir
    mode           = $(if ($Path -and $Path.Count -gt 0) { 'path' } elseif ($All) { 'all' } else { 'sample' })
    sampleCount    = $sel.Count
    exactCount     = $exact
    mismatchCount  = $mismatches.Count
    mismatches     = $mismatches.ToArray()
    restoredBytes  = $restoredBytes
    categories     = $stats
    chunksTotal    = $chunkMap.Count
    chunksNeeded   = $need.Count
    timings        = @{ scanSeconds = [Math]::Round($scanSw.Elapsed.TotalSeconds, 3); selectSeconds = [Math]::Round($selSw.Elapsed.TotalSeconds, 3); decompressSeconds = [Math]::Round($decSw.Elapsed.TotalSeconds, 3); restoreSeconds = [Math]::Round($resSw.Elapsed.TotalSeconds, 3); totalSeconds = [Math]::Round($sw.Elapsed.TotalSeconds, 3) }
    checks         = $checks.ToArray()
    nodeExe        = $NodeExe
    tempDir        = $tempRoot
}
if ($SummaryJson) {
    $enc = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($SummaryJson), ($summary | ConvertTo-Json -Depth 8 -Compress), $enc)
    Write-Info ("[summary] wrote {0}" -f [IO.Path]::GetFullPath($SummaryJson))
}

if (-not $KeepTemp) {
    try { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue } catch { }
}
Write-Info ("=== RESULT sample={0} exact={1} mismatch={2} total={3:N1}s ===" -f $sel.Count, $exact, $mismatches.Count, $sw.Elapsed.TotalSeconds)
if ($mismatches.Count -gt 0) { exit 3 } else { exit 0 }
