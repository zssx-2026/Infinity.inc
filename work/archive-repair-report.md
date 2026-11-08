# 归档完整性修复报告（history/history.jsonl）

日期：2026-10-06　执行：Lead（task-23 原派 archive-fix，因 70 分钟零产物由 Lead 接管）
范围：只**追加**写 history/history.jsonl（除固定 4096 字节头部）；不改其它 history/ 文件；不改 work/sync-history.mjs 以外的同步逻辑（该文件由 Lead 独占）。

## 1. 损坏现象与根因

归档里出现了**同一 chunk id 被多个不同分块复用**：

| id | 条数 | 各候选原始字节数 |
|---|---:|---|
| 116 | 9 | 26918×5、586887、2854457、3667716、3808066 |
| 127 | 2 | 1762200、1741671 |

entry 用 `g:[[chunkId, off, len]]` 定位字节，id 重复 ⇒ 读取方只能取其中一个候选，另一些 entry 永远取不到自己的字节。引用这两个 id 的 entry 共 42 条（29 个不同路径）。

根因链（均已复现）：
1. 早期每次同步用 `chunkOffset = header.chunks` 分配新 id，而 header 回写早已开始失败（`ERROR: header too long: 4121/4122/4123`，因为 `header.appended` 数组无上限增长，把 4096 字节头部撑爆）→ 分块照写、头部不更新 → id 永远从 116 起分配。
2. Lead 第一轮修复把 `appended` 截断到 7 条、引入 `header.chunkSeq` 作为"下一个空闲 id"，但 **`newHeader` 回写时漏了 `chunkSeq` 递增**，于是 127 又被用了两次（本轮同步复现）。
3. 另有 `live/**/part-NNNNN.jsonl` 路径遮蔽问题（同名 6 份、内容不同，首个条目胜出会读到旧版），已改为 `part-NNNNN-<hash8>.jsonl`。

## 2. 修复动作（append-only，绝不改既有字节）

1. **同步脚本加固**（work/sync-history.mjs，Lead 独占）：
   - 追加前先构造"预期头部"并校验 `<= 4096`，装不下就**在任何写入前**抛错（`refusing to append`），杜绝"段已写、头部写不进"的再次发生；
   - `chunkSeq` 与 `chunks` 一起前进（`chunkSeq = chunkOffset + rawChunks.length`）；
   - `appended` 只保留最近 7 条；分块命名 hash 限定。
2. **受影响条目的内容恢复**：42 条 entry 全部用"候选分块 × 偏移组合 + 条目自带 sha256 命中"反查，**42/42 命中，0 条不可恢复**。
3. **追加恢复副本**：把恢复出的内容按 `<原名去 .jsonl>-r1.jsonl`（同路径多版本再加 `-r1-<sha8>`）写成 36 条新 entry，装进**一个新分块 id=132**：
   - 载荷 13,259,140 B（brotli q10/lgwin24 → 段 910,142 B）
   - 归档 294,993,468 B → 295,903,610 B；头部回写 chunks=133、chunkSeq=133、files=26,568、archiveBytes=文件实际大小
   - 排他锁 `history/history.jsonl.lock`（wx + 30 分钟陈旧接管）全程持有，与 15 分钟计划任务互斥
4. **消费者指引**：新增 `work/archive-resolution-map.json`（原路径 → 恢复副本路径 / sha256 / 字节 / 原因），任何读者可据此取到正确版本。

## 3. 验证（两条独立证据）

| 验证 | 方法 | 结果 |
|---|---|---|
| 恢复副本逐路径字节比对 | 从 `work/_verify-repair-out` 取回 36 个文件，按**完整相对路径**算 sha256 与 map 比对 | **36/36 精确一致（diff=0）** |
| 全归档自洽校验 | 新写 `work/verify-archive.mjs`：单遍流式，按"首个同 id 分块"约定还原每条 entry 并重算 sha256 | 26,574 entry，**okUnique=26,532 / badUnique=0** → `ARCHIVE-SELFCHECK-PASS` |
| 重复 id 健康度 | 统计 chunk 行 id | 只剩历史 116×9、127×2，**修复后新增 id（129/130/131/132/133/134/135）全部唯一** |
| 计划任务 | work/history-sync.log 最近记录 | 最近多次 `{"ok":true,"action":"appended"...}`，无 `header too long` |

结论：
- 引用**唯一 id** 的 26,532 条 entry 全部与自带 sha256 一致，归档无新增损坏；
- 引用历史重复 id 的 31 条 entry 因 append-only 无法原地修复（首个条目胜出），但其中 42 条受影响内容已 100% 恢复并以 `-r1` 副本形式可读（36 份，含 7 份同路径不同版本的遮蔽内容，一字节未丢）。

## 4. 工具侧重要发现（不影响归档结论）

- `work/restore-history.ps1` 本轮对**已知良好路径**也报 `mismatch`（`sample=1 exact=0`；早前同一路径曾 `exact=84/84`）。即其"期望哈希来源"与"还原字节来源"在路径条目数 >1 时取舍不一致，属**工具假阴性**，故不再作为归档终验依据；终验改用 `work/verify-archive.mjs`（自洽校验，不依赖路径选取）与逐路径 sha256 直接比对。该脚本的取舍 bug 列为后续修复项。
- `work/archive-repair-plan.json`（archive-fix 产出）与 Lead 的 `work/_lead-archive-plan.json` 结论一致：42/42 命中。

## 5. 产物

| 文件 | 说明 |
|---|---|
| history/history.jsonl | 追加 36 条恢复 entry + 新分块 id=132；头部回写 |
| work/archive-resolution-map.json | 原路径 → -r1 路径映射（36 条） |
| work/verify-archive.mjs | 全归档自洽校验器（退出码 0/1） |
| work/_archive-selfcheck.log | 自洽校验原始输出 |
| work/_verify-repair-out/ | 恢复副本落地（36 文件，用于逐路径比对） |
| work/sync-history.mjs | 头部容量硬闸 + chunkSeq 递增 + appended 截断 |

## 6. 遗留

1. `work/restore-history.ps1` 的多条目路径取舍 bug（假阴性）待修；
2. 31 条历史坏 entry 永久留在归档中（append-only 的代价），读取方必须优先看 `work/archive-resolution-map.json`；
3. `work/_verify-live-out/`、`work/_verify-repair-out/`、`work/_verify-repair-out2/`、`work/_archive-fix-broad-baseline/` 等临时还原目录待清理。


## 7. 追加：restore-history.ps1 假阴性根因与终验（Lead，2026-10-06 16:30）

**根因（两处叠加）**
1. 工具默认读 `work/history-manifest.json`（旧快照，26,377 条），与当前归档 26,563 个路径不匹配——用旧哈希比对必然 mismatch；
2. 工具自身装载 manifest 时是 **last-wins**（`$manifestHash[$p] = ...` 直接覆盖），而挑选还原对象时是 **first-wins**（`Add-Pick` 用 HashSet.Add）——同一路径多条目时期望哈希取自最后一条、还原字节取自第一条，必然不符。

**修复**：`work/restore-history.ps1` 第 107-115 行改为 first-wins（`if (-not $manifestHash.ContainsKey($p))`），与 Add-Pick 语义一致；并重建 `work/history-manifest-fresh.json`（first-wins，26,563 路径，5,933,564 B）。

**终验（用修复后工具 + 新鲜 manifest）**

| 命令 | 结果 |
|---|---|
| `-Manifest work\history-manifest-fresh.json -Path <36 条 -r1 路径>` | **sample=36 exact=36 mismatch=0 bytes=13,259,140** |
| `-Path <已知良好路径 + 一条 -r1>` | sample=2 exact=2 mismatch=0 |
| `work/verify-archive.mjs` 全归档自洽 | 26,574 entry，okUnique=26,532，**badUnique=0** → ARCHIVE-SELFCHECK-PASS |

**说明**：全归档随机抽检若抽中那 31 条引用历史重复 id(116/127) 的原条目，仍会 mismatch——这是 append-only 的既成事实，其内容已 100% 由 `-r1` 副本取代（见 `work/archive-resolution-map.json`）；除这 31 条外，任何条目都必须命中。


## 8. 全归档随机抽检终验（1674 条，Seed 20261003）

`-Manifest work\history-manifest-fresh.json -MinSample 1500 -TopLargest 40 -RandomFill 1500 -Seed 20261003`
→ **sample=1674 exact=1670 mismatch=4 bytes=900,619,793**（旧 manifest 口径下同一次运行是 exact=1673/mismatch=1，因为旧 manifest 本身错位）。

4 条 mismatch **全部**是引用历史重复 id 的原条目，且全部在 `work/archive-resolution-map.json` 覆盖范围内：

| 原路径 | 是否有 -r1 恢复副本 |
|---|---|
| live/session-5eef8819-…/parts/part-00024.jsonl | 是 |
| live/5bdbe8d6-…/parts/part-00000.jsonl | 是 |
| live/b12d5d33-…/parts/part-00002-d61f5fa1.jsonl | 是 |
| live/39a501a5-…/parts/part-00000.jsonl | 是 |

结论：**除 31 条历史歧义原条目外，抽检 0 条异常**；这 31 条的内容已由 36 份 `-r1` 副本 100% 承接并逐条哈希验证（36/36）。

## 9. 收尾

- 临时还原目录已清理：`work/_verify-live-out`(877.7MB)、`_verify-broad-final`(858.9MB)、`_archive-fix-broad-baseline`(936.5MB)、`_verify-repair-out`(12.6MB)、`_verify-repair-final`(12.6MB)、`_verify-known-out`(3.2MB)、`_verify-repair-out2`(0.7MB)，共 **2,702.3 MB**；证据保留在各 summary JSON 与本报告中。
- 默认 `work/history-manifest.json` 已重建为**first-wins 现行版本**（26,572 路径 / 5,935,279 B），与 `work/history-manifest-fresh.json` 内容一致，避免再出现旧 manifest 造成的假阴性。
- 清理后复跑全归档自洽校验：仍 `ARCHIVE-SELFCHECK-PASS`（badUnique=0）。
