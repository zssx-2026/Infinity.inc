# 归档重复路径：还原与索引的"首次出现为准"契约修复

时间：2026-10-11（Asia/Shanghai）｜作者：Lead

## 1. 现象（新回归测试当场抓到）

新增的隔离端到端测试 `work/sync-e2e-test.mjs` 在合成归档上（同一路径追加两次）报告：

    manifest uniquePaths=2 verifyFailed=0
    restore  sample=2 exact=1 mismatch=1     <- 还原结果与 manifest 哈希不符

## 2. 根因

`history.jsonl` 是**追加式**归档，同一路径可以有多条条目。两边规则曾经不一致：

- `work/build-manifest.mjs`：**首次出现优先**（`first` 表，只在路径未见时写入）；
- `work/restore-history.ps1`：`$byPath` 表确实是首次优先，但**挑选用例时直接遍历了全部条目**（`foreach ($e in $entries)`），
  于是同一路径的后续条目也被还原，后写的覆盖先写的 → 与 manifest 比对时哈希不符。

**为什么此前 4 次"全绿"没暴露？** 随机补样是固定种子（`-Seed 20261011`），恰好从未命中那 7 条真正有差异的重复路径 —— 属于验证盲区。

## 3. 归档现状审计（真实数据）

用 node 流式扫描 298 MB 归档（5.0 s）：

| 指标 | 值 |
|---|---:|
| 唯一条目 | 26,650 |
| 唯一路径 | 26,636 |
| 重复路径 | **9**（额外条目 14） |
| 首末内容不同的路径 | **7** |
| 重复出现的 chunk id | **[116, 127]** |

7 条差异路径（首次 vs 末次）：

    session.v4.jsonl                                                72,608,984B/66095a7e  vs  15,349,952B/2cfaf0ad
    live/session-5eef8819-…/parts/part-00024.jsonl                        26,918B/da5df28a  vs    374,480B/e4be32f5
    live/0effa94b-…/parts/part-00000.jsonl                                77,616B/a93910d7  vs    483,735B/00d729d1
    live/39a501a5-…/parts/part-00000.jsonl                                76,713B/e3f0c892  vs    447,306B/fd46ebec
    live/5bdbe8d6-…/parts/part-00000.jsonl                               116,995B/e20090a4  vs    720,445B/9432d319
    live/b12d5d33-…/parts/part-00000.jsonl                                80,705B/b4f659af  vs    468,223B/86ca6acf
    live/ead89f0c-…/parts/part-00000.jsonl                                64,343B/7943ed40  vs    360,268B/3002d315

（后者是"同一逻辑文件在后续快照里的新内容"，例如会话主日志被轮转后变小；归档身份取首次捕获版本。）

## 4. 修复

`work/restore-history.ps1`（23,959 B，UTF-8 **带 BOM**）：

1. 扫描完成后统一按"首次出现"建表并生成唯一列表：

       $byPath = @{}; $unique = ...
       foreach ($e in $entries) { if ($byPath.ContainsKey($e.P)) { $dupeExtra++ … } else { $byPath[$e.P] = $e; [void]$unique.Add($e) } }

2. 采样/统计（`-Path` 定点、`-All`、最大文件、零字节、中文路径、跨块、随机池）全部改用 `$unique`；
3. 条目对象新增 `H`/`M` 字段，用于诊断重复路径的版本差异；
4. 新增审计行：`[dedupe] 14 extra entry(ies) for repeated path(s); kept the first occurrence (8 differ from a later version)`；
5. 注意：编辑工具会剥掉 BOM，已重新写回 `ef bb bf`，PowerShell 解析 0 错误（这是之前踩过的 PS 5.1 陷阱）。

`work/build-manifest.mjs`（同时强化）：

6. 记录同一路径的后续条目（`extras`）并纳入 `--verify` 自检：`--verify 80` 输出

       duplicateEntries 14, shadowedChunkIds [116,127],
       verifyExtras 1, verifyExtrasAmbiguous 13, verifyExtrasFailed 0,
       verified 109, verifyFailed 0, expectedWrong 22, ok true

   其中 13 条无法自证的条目正是引用了重复 chunk id（条目只记 id，不记它指哪条 chunk 行），显式计为"歧义"而不是伪装成通过。

## 5. 新增回归测试

`work/sync-e2e-test.mjs`（完全隔离，不动真实归档）：seed 头部 → 首次追加 2 文件 → 增量追加 1 文件 → 无变化幂等 → manifest 重建 → 独立还原，
并断言"还原内容 == 首次出现版本"：

    run1 appended changed=2 files=2 ; run2 appended changed=1 files=3 ; run3 up-to-date
    manifest uniquePaths=2 verifyFailed=0
    restore  sample=2 exact=2 mismatch=0
    restored session.v4.jsonl 3380 B sha efdf9b7a (first version, manifest says efdf9b7a)
    real archive 298786868 B untouched
    SYNC-E2E-PASS

## 6. 真实归档复验（修复后）

- 定点验证 7 条差异路径：`[restore] sample=7 exact=7 mismatch=0 bytes=73052274` → `=== RESULT sample=7 exact=7 mismatch=0 ===`（修复前这 7 条必然失败）；
- 全量随机验证：`=== RESULT sample=756 exact=756 mismatch=0 total=103.5s ===`；
- 终验套件加入 `sync-e2e` 后共 19 项。

## 7. 契约结论

`build-manifest.mjs` 与 `restore-history.ps1` 现在**严格一致：同一路径取首次出现的条目**；
重复路径、版本差异、chunk id 歧义都在报告里显式计数。

## 8. 全量还原（`-All`）：26,637 条唯一路径逐条比对

修复后对**整个归档**做了一次穷尽式还原（不再是抽样）：

    powershell -NoProfile -ExecutionPolicy Bypass -File work\restore-history.ps1 `
      -Archive history\history.jsonl -Manifest work\history-manifest.json `
      -OutDir work\_verify-all -All -MinSample 0 -TopLargest 0 -SummaryJson work\_verify-all.json

结果：

    [scan] done entries=26651 chunks=155 in 17.9s
    [dedupe] 14 extra entry(ies) for repeated path(s); kept the first occurrence (8 differ from a later version)
    [alias] applied 29 alias(es)
    === RESULT sample=26637 exact=26637 mismatch=0 total=185.5s ===

- 比对内容 **1,621,455,631 字节（1.51 GiB）**，与 manifest 的哈希 **全部一致（0 mismatch）**；
- 解压 chunk 153/155（`chunksTotal=155`，其中 2 条为历史重复 id 的冗余行）；
- 这同时验证了第 7 节"首次出现为准"的契约在**全量**范围内成立（含 9 条重复路径、7 条首末不同）。
