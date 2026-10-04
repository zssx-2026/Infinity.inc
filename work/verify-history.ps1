#requires -Version 7.0
<#
  verify-history.ps1 - Infinity.inc 历史归档独立验证器
  作者: hist-verifier (teammate)
  独立性: 独立实现，不调用 work/unpack-history.mjs，不依赖打包器中间状态。

  格式:
    line 1   header JSON (尾部以空格填充到 4096 字节)
    之后     chunk 行 {"t":"c","i":序号,"n":原始字节数,"d":base64(brotli)}
    最后     entry 行 {"t":"e","p":相对路径,"s":大小,"m":mtime_ms,"h":原始内容sha256,"g":[[chunk,offset,len],...]}

  校验:
    * 每个 chunk 用 .NET BrotliStream 解压, 校验长度 == n, 序号连续
    * 解压数据连续写入临时文件; entry 按 g 顺序随机读取片段, IncrementalHash(SHA256) 与 h 比对
    * 累计片段长度与 s 比对; 段越界检查
    * 与 work/history-manifest.json 交叉核对 路径/大小/哈希/条目数/字节数/根目录

  用法:
    pwsh -File work/verify-history.ps1
    pwsh -File work/verify-history.ps1 -Sample 500
    pwsh -File work/verify-history.ps1 -Archive work/_packtest/history.jsonl.pack -Manifest work/_packtest-manifest.json -Report ''
#>
[CmdletBinding()]
param(
  [string]$Archive = 'history/history.jsonl',
  [string]$Manifest = 'work/history-manifest.json',
  [string]$Report = 'work/verify-report.md',
  [int]$Sample = 0,
  [string]$TempDir = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Resolve-InPath([string]$p) {
  if ([string]::IsNullOrWhiteSpace($p)) { return $p }
  if ([System.IO.Path]::IsPathRooted($p)) { return [System.IO.Path]::GetFullPath($p) }
  return [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $p))
}

function Get-Sha256Hex([string]$path) {
  $sha = [System.Security.Cryptography.IncrementalHash]::CreateHash([System.Security.Cryptography.HashAlgorithmName]::SHA256)
  $fs  = [System.IO.FileStream]::new($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read, 4194304)
  $buf = [byte[]]::new(4194304)
  try {
    while (($n = $fs.Read($buf, 0, $buf.Length)) -gt 0) { $sha.AppendData($buf, 0, $n) }
  } finally { $fs.Dispose() }
  $hex = [Convert]::ToHexString($sha.GetHashAndReset()).ToLowerInvariant()
  $sha.Dispose()
  return $hex
}

function Write-Zeros([System.IO.FileStream]$fs, [long]$count) {
  if ($count -le 0) { return }
  $zero = [byte[]]::new(1048576)
  while ($count -gt 0) {
    $k = [int][Math]::Min($count, [long]$zero.Length)
    $fs.Write($zero, 0, $k)
    $count -= $k
  }
}

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$archivePath  = Resolve-InPath $Archive
$manifestPath = Resolve-InPath $Manifest
$reportPath   = if ([string]::IsNullOrWhiteSpace($Report)) { $null } else { Resolve-InPath $Report }

if (-not (Test-Path -LiteralPath $archivePath  -PathType Leaf)) { throw "归档文件不存在: $archivePath" }
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "清单文件不存在: $manifestPath" }
if ([string]::IsNullOrWhiteSpace($TempDir)) {
  $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("verify-history-$PID")
}
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
$tmpData = Join-Path $TempDir 'chunks.bin'

$archiveInfo  = Get-Item -LiteralPath $archivePath
$manifestInfo = Get-Item -LiteralPath $manifestPath
Write-Host ('[verify] archive = {0} ({1:N0} bytes)' -f $archivePath, $archiveInfo.Length)
Write-Host ('[verify] manifest= {0} ({1:N0} bytes)' -f $manifestPath, $manifestInfo.Length)
Write-Host ('[verify] temp    = {0}' -f $tmpData)

$errors         = [System.Collections.Generic.List[string]]::new()
$chunkErrors    = [System.Collections.Generic.List[string]]::new()
$hashExamples   = [System.Collections.Generic.List[string]]::new()
$sizeExamples   = [System.Collections.Generic.List[string]]::new()
$segExamples    = [System.Collections.Generic.List[string]]::new()
$manifestIssues = [System.Collections.Generic.List[string]]::new()
$headerIssues   = [System.Collections.Generic.List[string]]::new()

$header  = $null
$ePath   = [System.Collections.Generic.List[string]]::new()
$eSize   = [System.Collections.Generic.List[long]]::new()
$eMtime  = [System.Collections.Generic.List[long]]::new()
$eHash   = [System.Collections.Generic.List[string]]::new()
$eG      = [System.Collections.Generic.List[object]]::new()
$eGsz    = [System.Collections.Generic.List[long]]::new()
$eLineNo = [System.Collections.Generic.List[int]]::new()

$chunkStart = [System.Collections.Generic.List[long]]::new()
$chunkN     = [System.Collections.Generic.List[long]]::new()
$chunkFail  = 0L

$buf = [byte[]]::new(4194304)
$lineNo = 0
$globalRaw = 0L
$sumEntryBytes = 0L

# ---------------- Pass 1: 全量解压 chunk + 收集 entry ----------------
$reader = [System.IO.StreamReader]::new($archivePath, [System.Text.UTF8Encoding]::new($false), $true, 4194304)
$outFs  = [System.IO.FileStream]::new($tmpData, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None, 4194304)
try {
  while ($null -ne ($line = $reader.ReadLine())) {
    $lineNo++
    if ($lineNo -eq 1) {
      try { $header = $line.Trim() | ConvertFrom-Json }
      catch { $errors.Add('header JSON 解析失败: ' + $_.Exception.Message) }
      continue
    }
    $head = if ($line.Length -ge 10) { $line.Substring(0, 10) } else { $line }
    if ($head.StartsWith('{"t":"c"')) {
      $obj = $null
      try { $obj = $line | ConvertFrom-Json }
      catch { $chunkErrors.Add('line ' + $lineNo + ': chunk JSON 解析失败: ' + $_.Exception.Message); $chunkFail++; continue }
      $i     = [int]$obj.i
      $nDecl = [long]$obj.n
      $start = $globalRaw
      $total = 0L
      $failed = $false
      try {
        $comp = [Convert]::FromBase64String([string]$obj.d)
        $ms = [System.IO.MemoryStream]::new($comp, $false)
        $br = [System.IO.Compression.BrotliStream]::new($ms, [System.IO.Compression.CompressionMode]::Decompress, $false)
        try {
          while (($read = $br.Read($buf, 0, $buf.Length)) -gt 0) { $outFs.Write($buf, 0, $read); $total += $read }
        } finally { $br.Dispose(); $ms.Dispose() }
      } catch {
        $failed = $true
        $chunkErrors.Add('line ' + $lineNo + ' chunk ' + $i + ': brotli/base64 异常: ' + $_.Exception.Message)
      }
      if ($failed) {
        Write-Zeros $outFs ($nDecl - $total)
        $total = $nDecl
        $chunkFail++
      }
      if ($total -ne $nDecl) { $chunkErrors.Add('chunk ' + $i + ': 声明 n=' + $nDecl + ' 实际解压=' + $total) }
      if ($i -ne $chunkStart.Count) { $chunkErrors.Add('chunk 序号不连续: 期望 ' + $chunkStart.Count + ', 实际 ' + $i + ' (line ' + $lineNo + ')') }
      $chunkStart.Add($start)
      $chunkN.Add($total)
      $globalRaw += $total
    }
    elseif ($head.StartsWith('{"t":"e"')) {
      $obj = $null
      try { $obj = $line | ConvertFrom-Json }
      catch { $errors.Add('line ' + $lineNo + ': entry JSON 解析失败: ' + $_.Exception.Message); continue }
      $gs  = [System.Collections.Generic.List[long[]]]::new()
      $gsz = 0L
      if ($null -ne $obj.g) {
        foreach ($seg in $obj.g) {
          $c = [int]$seg[0]; $o = [long]$seg[1]; $l = [long]$seg[2]
          $gs.Add([long[]]@($c, $o, $l)); $gsz += $l
        }
      }
      $ePath.Add([string]$obj.p)
      $eSize.Add([long]$obj.s)
      $eMtime.Add([long]$obj.m)
      $eHash.Add(([string]$obj.h).ToLowerInvariant())
      $eG.Add($gs.ToArray())
      $eGsz.Add($gsz)
      $eLineNo.Add($lineNo)
      $sumEntryBytes += [long]$obj.s
    }
    else {
      $preview = $line.Substring(0, [Math]::Min(40, $line.Length))
      $errors.Add('line ' + $lineNo + ': 无法识别的行类型 (前 40 字符: ' + $preview + ')')
    }
  }
} finally { $reader.Dispose(); $outFs.Dispose() }

$chunkCount = $chunkStart.Count
$entryCount = $ePath.Count
Write-Host ('[verify] pass1: {0} chunks, {1} entries, {2:N0} raw bytes, {3:N0} entry bytes ({4:N1}s)' -f $chunkCount, $entryCount, $globalRaw, $sumEntryBytes, $sw.Elapsed.TotalSeconds)

# ---------------- Pass 2: entry 拼段 + SHA-256 ----------------
$mode = 'FULL'
$verifyIdx = [System.Collections.Generic.List[int]]::new()
if ($Sample -gt 0 -and $Sample -lt $entryCount) {
  $mode = 'SAMPLE'
  $target = $Sample
  $set = [System.Collections.Generic.HashSet[int]]::new()
  [void]$set.Add(0)
  [void]$set.Add($entryCount - 1)
  for ($i = 0; $i -lt $entryCount; $i++) { if ($eSize[$i] -eq 0) { [void]$set.Add($i) } }
  $step = [Math]::Max(1, [int][Math]::Floor($entryCount / [double]$target))
  for ($i = 0; $i -lt $entryCount -and $set.Count -lt $target; $i += $step) { [void]$set.Add($i) }
  $i = 0
  while ($set.Count -lt $target -and $i -lt $entryCount) { [void]$set.Add($i); $i++ }
  $arr = [int[]]::new($set.Count); $set.CopyTo($arr); [Array]::Sort($arr)
  foreach ($x in $arr) { $verifyIdx.Add([int]$x) }
} else {
  for ($i = 0; $i -lt $entryCount; $i++) { $verifyIdx.Add($i) }
}

$hashBad = 0L; $sizeBad = 0L; $segBad = 0L; $hashOk = 0L
$assembledTotal = 0L
$fs = [System.IO.FileStream]::new($tmpData, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read, 4194304)
try {
  foreach ($idx in $verifyIdx) {
    $gsz = $eGsz[$idx]
    if ($gsz -ne $eSize[$idx]) {
      $sizeBad++
      if ($sizeExamples.Count -lt 20) { $sizeExamples.Add($ePath[$idx] + ': s=' + $eSize[$idx] + ' 段长合计=' + $gsz) }
    }
    $inc = [System.Security.Cryptography.IncrementalHash]::CreateHash([System.Security.Cryptography.HashAlgorithmName]::SHA256)
    $acc = 0L
    $bad = $false
    foreach ($seg in $eG[$idx]) {
      $c = [int]$seg[0]; $o = [long]$seg[1]; $l = [long]$seg[2]
      if ($c -lt 0 -or $c -ge $chunkCount -or $o -lt 0 -or $l -lt 0 -or ($o + $l) -gt $chunkN[$c]) {
        $bad = $true; $segBad++
        if ($segExamples.Count -lt 20) { $segExamples.Add($ePath[$idx] + ': 非法段 [' + $c + ',' + $o + ',' + $l + '] chunk数=' + $chunkCount) }
        break
      }
      $fs.Position = $chunkStart[$c] + $o
      $rem = $l
      while ($rem -gt 0) {
        $want = [int][Math]::Min($rem, [long]$buf.Length)
        $got = $fs.Read($buf, 0, $want)
        if ($got -le 0) {
          $bad = $true; $segBad++
          if ($segExamples.Count -lt 20) { $segExamples.Add($ePath[$idx] + ': 读取提前结束') }
          break
        }
        $inc.AppendData($buf, 0, $got)
        $rem -= $got; $acc += $got
      }
      if ($bad) { break }
    }
    if ($bad) { $inc.Dispose(); continue }
    $hex = [Convert]::ToHexString($inc.GetHashAndReset()).ToLowerInvariant()
    $inc.Dispose()
    $assembledTotal += $acc
    if ($hex -ne $eHash[$idx]) {
      $hashBad++
      if ($hashExamples.Count -lt 20) { $hashExamples.Add($ePath[$idx] + ': 期望 ' + $eHash[$idx] + ' 实际 ' + $hex) }
    } else { $hashOk++ }
  }
} finally { $fs.Dispose() }
Write-Host ('[verify] pass2: hashed {0}/{1}, hashBad={2}, sizeBad={3}, segBad={4} ({5:N1}s)' -f $verifyIdx.Count, $entryCount, $hashBad, $sizeBad, $segBad, $sw.Elapsed.TotalSeconds)

$aSet = [System.Collections.Generic.HashSet[string]]::new()
$dupPaths = 0L
for ($i = 0; $i -lt $entryCount; $i++) { if (-not $aSet.Add($ePath[$i])) { $dupPaths++ } }

# 按内容哈希去重统计 (header.uniqueBytes/blobs 与 manifest 的正确口径)
$hGroup = @{}
$sameHashDiffSize = 0L
for ($i = 0; $i -lt $entryCount; $i++) {
  $hkey = $eHash[$i]
  if ($hGroup.ContainsKey($hkey)) { if ([long]$hGroup[$hkey] -ne $eSize[$i]) { $sameHashDiffSize++ } }
  else { $hGroup[$hkey] = $eSize[$i] }
}
$uniqueBlobCount = $hGroup.Count
$uniqueByHash = 0L
foreach ($v in $hGroup.Values) { $uniqueByHash += [long]$v }
if ($sameHashDiffSize -gt 0) { $errors.Add('同一内容哈希出现不同大小: ' + $sameHashDiffSize + ' 条') }

# ---------------- Manifest 交叉核对 ----------------
$mfObj = $null
try { $mfObj = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json }
catch { $errors.Add('manifest JSON 解析失败: ' + $_.Exception.Message) }

$mFiles = -1L; $mBytes = -1L; $mBlobs = -1L; $mUnique = -1L; $mRoot = ''
$mFound = 0L; $mMissing = 0L; $mExtra = 0L; $mSizeBad = 0L; $mHashBad = 0L; $mDup = 0L
if ($null -ne $mfObj) {
  $mFiles  = [long]$mfObj.files
  $mBytes  = [long]$mfObj.bytes
  $mBlobs  = [long]$mfObj.blobs
  $mUnique = [long]$mfObj.uniqueBytes
  $mRoot   = [string]$mfObj.root
  $mMap = @{}
  foreach ($me in $mfObj.entries) {
    $mp = [string]$me.p
    if ($mMap.ContainsKey($mp)) { $mDup++ } else { $mMap[$mp] = $me }
  }
  if ($mFiles -ne $entryCount) { $manifestIssues.Add('条目数不一致: manifest.files=' + $mFiles + ' archive=' + $entryCount) }
  if ($mBytes -ne $sumEntryBytes) { $manifestIssues.Add('总字节不一致: manifest.bytes=' + $mBytes + ' archive=' + $sumEntryBytes) }
  if ($mUnique -ne $uniqueByHash) { $manifestIssues.Add('uniqueBytes 不一致: manifest=' + $mUnique + ' 按内容去重=' + $uniqueByHash) }
  if ($mBlobs -ne $uniqueBlobCount) { $manifestIssues.Add('blobs 不一致: manifest.blobs=' + $mBlobs + ' 按内容去重=' + $uniqueBlobCount) }
  for ($i = 0; $i -lt $entryCount; $i++) {
    $p = $ePath[$i]
    if (-not $mMap.ContainsKey($p)) {
      $mMissing++
      if ($manifestIssues.Count -lt 40) { $manifestIssues.Add('manifest 缺少路径: ' + $p) }
      continue
    }
    $me = $mMap[$p]
    $mFound++
    if ([long]$me.s -ne $eSize[$i]) {
      $mSizeBad++
      if ($manifestIssues.Count -lt 40) { $manifestIssues.Add('大小不一致: ' + $p + ' manifest=' + $me.s + ' archive=' + $eSize[$i]) }
    }
    if (([string]$me.h).ToLowerInvariant() -ne $eHash[$i]) {
      $mHashBad++
      if ($manifestIssues.Count -lt 40) { $manifestIssues.Add('哈希不一致: ' + $p) }
    }
    [void]$mMap.Remove($p)
  }
  $mExtra = $mMap.Count
  if ($mExtra -gt 0) { $manifestIssues.Add('manifest 多余路径数: ' + $mExtra) }
  if ($mDup -gt 0) { $manifestIssues.Add('manifest 内部重复路径数: ' + $mDup) }
}

# ---------------- header 一致性 ----------------
$hdrFiles = -1L; $hdrOrig = -1L; $hdrUnique = -1L; $hdrBlobs = -1L; $hdrChunks = -1L
$hdrRoot = ''; $hdrCodec = ''; $hdrChunkBytes = -1L
if ($null -eq $header) {
  $headerIssues.Add('header 缺失或解析失败')
} else {
  $hdrFiles = [long]$header.files; $hdrOrig = [long]$header.origBytes; $hdrUnique = [long]$header.uniqueBytes
  $hdrBlobs = [long]$header.blobs; $hdrChunks = [long]$header.chunks
  $hdrRoot = [string]$header.root; $hdrCodec = [string]$header.codec; $hdrChunkBytes = [long]$header.chunkBytes
  $reqFields = @('f','v','root','layout','codec','chunkBytes','files','origBytes','uniqueBytes','blobs','chunks')
  $haveFields = @($header.PSObject.Properties.Name)
  foreach ($k in $reqFields) { if ($haveFields -notcontains $k) { $headerIssues.Add('header 缺少字段: ' + $k) } }
  if ($hdrCodec -ne 'brotli') { $headerIssues.Add('codec 非 brotli: ' + $hdrCodec) }
  if ($hdrFiles -ne $entryCount) { $headerIssues.Add('header.files=' + $hdrFiles + ' 实际条目=' + $entryCount) }
  if ($hdrOrig -ne $sumEntryBytes) { $headerIssues.Add('header.origBytes=' + $hdrOrig + ' 实际=' + $sumEntryBytes) }
  if ($hdrUnique -ne $uniqueByHash) { $headerIssues.Add('header.uniqueBytes=' + $hdrUnique + ' 按内容去重=' + $uniqueByHash) }
  if ($hdrChunks -ne $chunkCount) { $headerIssues.Add('header.chunks=' + $hdrChunks + ' 实际=' + $chunkCount) }
  if ($hdrBlobs -ne $uniqueBlobCount) { $headerIssues.Add('header.blobs=' + $hdrBlobs + ' 按内容去重=' + $uniqueBlobCount) }
  if ($null -ne $mfObj -and $hdrBlobs -ne $mBlobs) { $headerIssues.Add('header.blobs=' + $hdrBlobs + ' manifest.blobs=' + $mBlobs) }
  if ($null -ne $mfObj -and $hdrRoot -ne $mRoot) { $headerIssues.Add('header.root 与 manifest.root 不一致') }
}

$chunkSizeAdvisory = 'N/A'
$chunkShortIdx = ''
if ($hdrChunkBytes -gt 0 -and $chunkCount -gt 0) {
  $nonLast = 0L; $badIdx = [System.Collections.Generic.List[string]]::new()
  for ($i = 0; $i -lt $chunkCount - 1; $i++) { $nonLast++; if ($chunkN[$i] -ne $hdrChunkBytes) { $badIdx.Add('#' + $i + '=' + $chunkN[$i]) } }
  if ($badIdx.Count -eq 0) { $chunkSizeAdvisory = 'PASS (前 ' + $nonLast + ' 个非末尾 chunk 均等于 chunkBytes ' + $hdrChunkBytes + ')' }
  else { $chunkSizeAdvisory = 'WARN 非失败 (' + $badIdx.Count + '/' + $nonLast + ' 个非末尾 chunk 不等于 chunkBytes: ' + ($badIdx -join ', ') + ')' }
  $chunkShortIdx = ($badIdx -join ', ')
}

$archiveSha = Get-Sha256Hex $archivePath

$problems = $errors.Count + $chunkErrors.Count + $headerIssues.Count + $manifestIssues.Count + $hashBad + $sizeBad + $segBad
$verdict = if ($problems -eq 0) { 'PASS' } else { 'FAIL' }
$fullCoverage = ($mode -eq 'FULL')

Write-Host ('[verify] archive sha256 = {0}' -f $archiveSha)
Write-Host ('[verify] RESULT: {0} entries={1} bytes={2} hashBad={3} sizeBad={4} segBad={5} manifestIssues={6} headerIssues={7} chunkErrors={8}' -f $verdict, $entryCount, $sumEntryBytes, $hashBad, $sizeBad, $segBad, $manifestIssues.Count, $headerIssues.Count, $chunkErrors.Count)

# ---------------- 预计算报告文本 ----------------
$created = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
$archiveLenStr  = '{0:N0}' -f $archiveInfo.Length
$manifestLenStr = '{0:N0}' -f $manifestInfo.Length
$globalRawStr   = '{0:N0}' -f $globalRaw
$uniqueByHashStr = '{0:N0}' -f $uniqueByHash
$sumEntryStr    = '{0:N0}' -f $sumEntryBytes
$assembledStr   = '{0:N0}' -f $assembledTotal
$coverageText   = if ($fullCoverage) { 'FULL - 全部 entry 逐条哈希校验' } else { 'SAMPLE - 抽样 ' + $verifyIdx.Count + '/' + $entryCount + ' 条 entry 哈希校验; chunk 与 manifest 仍全量校验' }
$continuityText = if ($chunkErrors.Count -eq 0 -and $chunkCount -gt 0) { 'PASS (0..' + ($chunkCount - 1) + ' 连续)' } else { '见失败明细' }
$filesResult    = if ($mFiles -eq $entryCount) { 'PASS' } else { 'FAIL' }
$bytesResult    = if ($mBytes -eq $sumEntryBytes) { 'PASS' } else { 'FAIL' }
$uniqueResult   = if ($mUnique -eq $uniqueByHash) { 'PASS' } else { 'FAIL' }
$blobsResult    = if ($mBlobs -eq $uniqueBlobCount) { 'PASS' } else { 'FAIL' }
$rootResult     = if ($hdrRoot -eq $mRoot) { 'PASS' } else { 'FAIL' }
$coverageNote   = if ($fullCoverage) {
  '全量: ' + $chunkCount + ' 个 chunk 全部解压校验; ' + $entryCount + ' 条 entry 全部逐条重建并计算 SHA-256; manifest 全部条目交叉核对。'
} else {
  '抽样: entry 为均匀抽样 ' + $verifyIdx.Count + '/' + $entryCount + ' 条 (含首条/末条/全部空文件); chunk 长度与 manifest 交叉核对为全量。'
}

$sb = [System.Text.StringBuilder]::new()
[void]$sb.AppendLine('# 历史归档独立验证报告')
[void]$sb.AppendLine()
[void]$sb.AppendLine('- 生成时间: ' + $created)
[void]$sb.AppendLine('- 验证者: hist-verifier (独立实现 work/verify-history.ps1; 未调用 work/unpack-history.mjs)')
[void]$sb.AppendLine('- 结论: **' + $verdict + '**')
[void]$sb.AppendLine('- 归档文件: ' + $archivePath + ' (' + $archiveLenStr + ' 字节)')
[void]$sb.AppendLine('- 归档 SHA-256: ' + $archiveSha)
[void]$sb.AppendLine('- 清单文件: ' + $manifestPath + ' (' + $manifestLenStr + ' 字节)')
[void]$sb.AppendLine('- 覆盖模式: ' + $coverageText)
[void]$sb.AppendLine()
[void]$sb.AppendLine('## 1. chunk 层校验 (全量)')
[void]$sb.AppendLine()
[void]$sb.AppendLine('| 项目 | 值 |')
[void]$sb.AppendLine('|---|---|')
[void]$sb.AppendLine('| chunk 数 (实际 / header) | ' + $chunkCount + ' / ' + $hdrChunks + ' |')
[void]$sb.AppendLine('| chunk 解压合计 (含跨包重复) | ' + $globalRawStr + ' |')
[void]$sb.AppendLine('| 按内容哈希去重唯一字节 | ' + $uniqueByHashStr + ' |')
[void]$sb.AppendLine('| 唯一 blob 数 (按内容哈希) | ' + $uniqueBlobCount + ' |')
[void]$sb.AppendLine('| n 与实际长度不一致 | ' + $chunkErrors.Count + ' |')
[void]$sb.AppendLine('| 解压异常 chunk | ' + $chunkFail + ' |')
[void]$sb.AppendLine('| 非末尾 chunk == chunkBytes | ' + $chunkSizeAdvisory + ' |')
[void]$sb.AppendLine('| 序号连续性 | ' + $continuityText + ' |')
[void]$sb.AppendLine()
[void]$sb.AppendLine('## 2. entry 层校验')
[void]$sb.AppendLine()
[void]$sb.AppendLine('| 项目 | 值 |')
[void]$sb.AppendLine('|---|---|')
[void]$sb.AppendLine('| entry 条目数 | ' + $entryCount + ' |')
[void]$sb.AppendLine('| 条目声明总字节 sum(s) | ' + $sumEntryStr + ' |')
[void]$sb.AppendLine('| 已哈希校验条目 | ' + $verifyIdx.Count + ' / ' + $entryCount + ' |')
[void]$sb.AppendLine('| SHA-256 不一致 (mismatch) | ' + $hashBad + ' |')
[void]$sb.AppendLine('| 段长合计与 s 不一致 | ' + $sizeBad + ' |')
[void]$sb.AppendLine('| 非法/越界段 | ' + $segBad + ' |')
[void]$sb.AppendLine('| 路径重复条目 | ' + $dupPaths + ' |')
[void]$sb.AppendLine('| 哈希校验通过条目 | ' + $hashOk + ' |')
[void]$sb.AppendLine('| 拼装总字节 (已校验范围) | ' + $assembledStr + ' |')
[void]$sb.AppendLine()
[void]$sb.AppendLine('## 3. history-manifest.json 交叉核对 (全量)')
[void]$sb.AppendLine()
[void]$sb.AppendLine('| 项目 | manifest | 归档实际 | 结果 |')
[void]$sb.AppendLine('|---|---|---|---|')
[void]$sb.AppendLine('| 条目数 | ' + $mFiles + ' | ' + $entryCount + ' | ' + $filesResult + ' |')
[void]$sb.AppendLine('| 总字节 | ' + $mBytes + ' | ' + $sumEntryBytes + ' | ' + $bytesResult + ' |')
[void]$sb.AppendLine('| uniqueBytes | ' + $mUnique + ' | ' + $uniqueByHash + ' | ' + $uniqueResult + ' |')
[void]$sb.AppendLine('| blobs | ' + $mBlobs + ' | ' + $uniqueBlobCount + ' | ' + $blobsResult + ' |')
[void]$sb.AppendLine()
[void]$sb.AppendLine('- 路径匹配: ' + $mFound + ' / ' + $entryCount + '; manifest 缺失: ' + $mMissing + '; manifest 多余: ' + $mExtra)
[void]$sb.AppendLine('- 大小不一致: ' + $mSizeBad + '; 哈希不一致: ' + $mHashBad + '; manifest 内部重复路径: ' + $mDup)
[void]$sb.AppendLine('- 根目录: header ' + $hdrRoot + ' / manifest ' + $mRoot + ' -> ' + $rootResult)
[void]$sb.AppendLine()
[void]$sb.AppendLine('## 4. header 一致性')
[void]$sb.AppendLine()
[void]$sb.AppendLine('- files=' + $hdrFiles + ' origBytes=' + $hdrOrig + ' uniqueBytes=' + $hdrUnique + ' blobs=' + $hdrBlobs + ' chunks=' + $hdrChunks + ' codec=' + $hdrCodec)
[void]$sb.AppendLine('- header 问题数: ' + $headerIssues.Count)
[void]$sb.AppendLine()
[void]$sb.AppendLine('## 5. 覆盖范围说明')
[void]$sb.AppendLine()
[void]$sb.AppendLine('- ' + $coverageNote)
[void]$sb.AppendLine('- 未验证项: 不校验 entry 的 mtime 与磁盘原始文件 (约束要求不读取/不修改 history/ 原始数据), 不校验压缩率。')
[void]$sb.AppendLine('- uniqueBytes/blobs 口径: 与按内容 SHA-256 去重后的条目合计/数目比对; chunk 解压合计单独列出, 合并归档可因跨包重复而大于唯一字节。')
[void]$sb.AppendLine()
[void]$sb.AppendLine('## 6. 失败明细')
[void]$sb.AppendLine()
$haveDetail = $false
if ($errors.Count -gt 0)         { $haveDetail = $true; [void]$sb.AppendLine('### 解析/结构错误 (共 ' + $errors.Count + ')'); [void]$sb.AppendLine(); foreach ($x in $errors) { [void]$sb.AppendLine('- ' + $x) }; [void]$sb.AppendLine() }
if ($chunkErrors.Count -gt 0)    { $haveDetail = $true; [void]$sb.AppendLine('### chunk 错误 (共 ' + $chunkErrors.Count + ')'); [void]$sb.AppendLine(); foreach ($x in $chunkErrors) { [void]$sb.AppendLine('- ' + $x) }; [void]$sb.AppendLine() }
if ($headerIssues.Count -gt 0)   { $haveDetail = $true; [void]$sb.AppendLine('### header 问题 (共 ' + $headerIssues.Count + ')'); [void]$sb.AppendLine(); foreach ($x in $headerIssues) { [void]$sb.AppendLine('- ' + $x) }; [void]$sb.AppendLine() }
if ($manifestIssues.Count -gt 0) { $haveDetail = $true; [void]$sb.AppendLine('### manifest 问题 (共 ' + $manifestIssues.Count + ')'); [void]$sb.AppendLine(); foreach ($x in $manifestIssues) { [void]$sb.AppendLine('- ' + $x) }; [void]$sb.AppendLine() }
if ($hashBad -gt 0)              { $haveDetail = $true; [void]$sb.AppendLine('### SHA-256 不一致示例 (共 ' + $hashBad + ')'); [void]$sb.AppendLine(); foreach ($x in $hashExamples) { [void]$sb.AppendLine('- ' + $x) }; [void]$sb.AppendLine() }
if ($sizeBad -gt 0)              { $haveDetail = $true; [void]$sb.AppendLine('### 大小不一致示例 (共 ' + $sizeBad + ')'); [void]$sb.AppendLine(); foreach ($x in $sizeExamples) { [void]$sb.AppendLine('- ' + $x) }; [void]$sb.AppendLine() }
if ($segBad -gt 0)               { $haveDetail = $true; [void]$sb.AppendLine('### 非法段示例 (共 ' + $segBad + ')'); [void]$sb.AppendLine(); foreach ($x in $segExamples) { [void]$sb.AppendLine('- ' + $x) }; [void]$sb.AppendLine() }
if (-not $haveDetail) { [void]$sb.AppendLine('无。全部检查通过。'); [void]$sb.AppendLine() }
[void]$sb.AppendLine('## 7. 复现命令')
[void]$sb.AppendLine()
[void]$sb.AppendLine('    pwsh -File work/verify-history.ps1 -Archive history/history.jsonl -Manifest work/history-manifest.json -Report work/verify-report.md')
[void]$sb.AppendLine()
[void]$sb.AppendLine('## 8. 执行环境')
[void]$sb.AppendLine()
[void]$sb.AppendLine('- PowerShell: ' + $PSVersionTable.PSVersion.ToString() + ' (' + [System.Environment]::Version.ToString() + ', ' + $PSVersionTable.PSEdition + ')')
[void]$sb.AppendLine('- Brotli 实现: ' + [System.IO.Compression.BrotliStream].FullName)
$psHostExe = ''
try { $psHostExe = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName } catch { }
[void]$sb.AppendLine('- 宿主: ' + $psHostExe)
[void]$sb.AppendLine('- 说明: 本机未安装系统级 pwsh 7, 验证通过便携版 PowerShell 7.4.6 (dotnet exec pwsh.dll) 执行; 脚本本身要求 PowerShell 7+ 与 .NET 5+。')

$md = $sb.ToString()
if ($null -ne $reportPath) {
  $reportDir = Split-Path -Parent $reportPath
  if ($reportDir -and -not (Test-Path -LiteralPath $reportDir)) { New-Item -ItemType Directory -Force -Path $reportDir | Out-Null }
  [System.IO.File]::WriteAllText($reportPath, $md, [System.Text.UTF8Encoding]::new($false))
  Write-Host ('[verify] report written: {0}' -f $reportPath)
}

try { Remove-Item -LiteralPath $tmpData -Force -ErrorAction SilentlyContinue } catch { }
try {
  $left = @(Get-ChildItem -LiteralPath $TempDir -Force -ErrorAction SilentlyContinue)
  if ($left.Count -eq 0) { Remove-Item -LiteralPath $TempDir -Force -ErrorAction SilentlyContinue }
} catch { }

Write-Host ('[verify] elapsed {0:N1}s' -f $sw.Elapsed.TotalSeconds)
if ($verdict -eq 'PASS') { exit 0 } else { exit 1 }
