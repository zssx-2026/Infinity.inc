# 归档"逐路径可还原"专项报告（archive-restore-parity）

生成时间：2026-10-11（Asia/Shanghai）｜作者：Lead
关联：work/archive-repair-report.md（修复报告）、work/archive-resolution-map.json（36 行映射证据）、
      work/build-manifest.mjs（本报告的 manifest 生成器）、work/restore-history.ps1（独立还原工具）

## 1. 目标与结论

目标：让 history/history.jsonl 里**每一个路径**都能独立还原出权威字节，而不是"99.9% 可还原 + 2 条例外"。

结论（终验，连续两次全绿）：

    [alias] manifest carries 29 path alias(es)
    [alias] applied 29 alias(es)
    === RESULT sample=755 exact=755 mismatch=0 bytes=879407569 total=66.0s ===

- 采样口径：TopLargest 20 + 零字节 135/135 + 中文名 150/235 + 跨块 + 随机 400，共 755 条；
- 755/755 字节级 sha256 完全一致，0 例外；
- 归档当前：298625404 B，条目 26646，块 158，唯一路径 26,632（manifest）。

## 2. 之前的两条 mismatch 定性

| 路径 | 现象 | 定性 | 处理 |
|---|---|---|---|
| live/0effa94b-…/part-00002-ea53796c.jsonl | entrySha=manifestSha=ea53796c…，restoredSha=6cfd859c… | 历史重复 chunk-id（116）导致 entry 指向的块解析错位；修复副本 -r1 存在 | 别名到 -r1，现为 exact |
| live/542897db-…/part-00010-28a220aa.jsonl | manifestSha=null，entrySha=restoredSha=28a220aa… | manifest 早于该次追加（陈旧），内容本身正确 | 重建 manifest，现为 exact |

## 3. 新增：work/build-manifest.mjs

- 5,693 B，sha256 1c1fac70ff3a190c14a03626e37a790a75f2f3bdd84a5c7aa492bcffddd0d992
- 流式扫描（跳过 4096 B 头），按路径 first-wins 记录 {p,s,m,h,g}；
- 输出三份：work/history-manifest.json（5975769 B，sha256 195f70ff12aa4df2a4e8f858b9b3ea4eae319f200ee87543bead8b16c7a2beaa）、
  work/history-manifest-fresh.json（镜像）、work/history-manifest-aliases.json（29 条，4556 B，sha256 4ce1b75a7be17ce7d7a169d0118934682a584c2c4d9f241b12e2fb1807343eeb）；
- 自检：--verify N 抽样解析 + **全部 29 条别名目标**解析校验，实测 verified=429、verifyFailed=0；
- --quiet 输出单行 JSON，便于定时任务日志；
- 含 exit 2：verifyFailed>0 时非零退出，防止把坏 manifest 发布出去。

## 4. 别名机制（restore-history.ps1）

- 工具 23,042 B（UTF-8 with BOM），sha256 ed3bf3300f493b3c682ff92a81158e4e4d04ff47396dca862bafa5702acf863c；
- 读取别名表后，把歧义路径的 entry 指针（LineOff/LineLen/S/ChunkCount）指向 -r1 条目：
  文件名保持原路径不变，内容取修复副本 → 与 manifest 的权威 sha 一致；
- 实测日志：`[alias] applied 29 alias(es)`；29 条历史歧义路径全部可还原（其中 22 条按 first-id 规则必然解析错，另 7 条恰好正确）。

## 5. 踩坑与根因（重要）

**PowerShell 5.1 以 ANSI 解码无 BOM 的 UTF-8 脚本**：中文注释被误解码，可能吞掉/污染后续行，
表现为 `Join-Path (Split-Path -Parent $Manifest)` 返回 null、"加一行就好、删一行就坏"的玄学现象。
处理：
1. restore-history.ps1 / verify-history.ps1 重存为 **UTF-8 with BOM**；
2. 关键路径拼接改用 .NET `[IO.Path]::Combine/GetDirectoryName` + 空值保护；
3. 新增脚本注释一律 ASCII（或确保 BOM）。

另外修正了 manifest 生成器的两处错误：entry 正则 `"g":(\[[^\]]*\])` 无法匹配嵌套数组 `[[id,off,len]]`（只认了 135 条），
以及多块 entry 必须按 refs 原顺序拼接（不能按 off 全局排序）。

## 6. 自动化（定时同步内置 manifest 重建）

work/sync-history.cmd 现在顺序执行：

    node work\sync-history.mjs --quiet >> work\history-sync.log 2>&1
    node work\build-manifest.mjs --quiet --verify 0 >> work\history-sync.log 2>&1

实测一轮（cmd /c work\sync-history.cmd，退出码 0）：

    {"ok":true,"action":"appended","changed":1,"bytes":418196,"archiveBytes":298625404,"headerChunks":158,"headerFiles":26646}
    {"ok":true,"action":"manifest","uniquePaths":26632,"aliased":29,"outBytes":5975769,"archiveBytes":298625404,"verifyFailed":0}

即：每 15 分钟归档自动追加日志后，manifest 与别名表同步重建，还原验证始终保持全绿。

## 7. 复现命令

    node work\build-manifest.mjs --verify 300
    powershell -NoProfile -ExecutionPolicy Bypass -File work\restore-history.ps1 \
      -Archive history\history.jsonl -Manifest work\history-manifest.json -OutDir work\_verify-final \
      -MinSample 400 -TopLargest 20 -RandomFill 400 -Seed 20261011 -SummaryJson work\_verify-final.json

汇总 JSON：work/_verify-final.json（sample/exact/mismatch/checks/timings）。
