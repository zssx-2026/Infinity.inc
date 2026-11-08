# 会话日志压缩追加报告（history/history.jsonl）

时间：2026-10-05（Asia/Shanghai）
执行：Lead 主智能体（工具 work/sync-history.mjs）

## 1. 结论

- 本次把 `history/` 下 **24 个会话日志**（主会话 `session.v4.jsonl` + 23 个子智能体 `subagents/*/session.v4.jsonl`）
  压缩为新的归档段并**追加**到 `history/history.jsonl` 末尾。
- 原始 **87,916,054 字节（83.84 MiB）** → 归档新增 **9,696,759 字节（9.25 MiB）**，压缩后仅占原始 **11.03%**（压缩掉 88.97%）。
- 归档整体：276,969,754 → **286,666,513 字节**；条目 26,354 → **26,378**；块 85 → **91**（索引 0..90 连续）。
- 追加前后旧数据**一个字节都没有移动**：新数据写在 EOF，只有固定 4096 字节头部被原地改写。
- 独立还原验证：追加段 **24/24 完全一致**；全归档抽样 **505/505 完全一致**，0 处不匹配。

## 2. 数据与头部

| 项目 | 追加前 | 追加后 |
| --- | --- | --- |
| archiveBytes | 276,969,754 | 286,666,513 |
| files（条目数） | 26,354 | 26,378 |
| chunks | 85 | 91 |
| origBytes | 1,453,849,729 | 1,541,765,783 |
| snapshots | — | 1 |

- 追加前归档 sha256 = `b136ec6f90bb355528bd32e1a8a31d71c93dcf9cb6854c9521ec2376fb7ce4cf`（与 work/TASKS.md 记录一致，预检通过）。
- 追加后归档 sha256 = `b3f64785ddf8c1e7ded906d05c9c15be41a1f45d57efe40687d88759728b96d2`（286666513 字节）。
- 头部新增 `snapshots` 与 `appended[]`（每段记录 at/files/bytes/chunks/firstChunk/archiveBytes），
  `layout` 更新为 `header|segment(chunk-lines then entry-lines), repeated; appended segments start at EOF`。

## 3. 追加机制（append-only）

`work/sync-history.mjs`：

1. 扫描 `history/session.v4.jsonl`、`history/*.jsonl`、`history/subagents/*/*.jsonl`（排除 history.jsonl 自身）。
2. 与状态文件 `work/history-sync-state.json` 比对（先比 size+mtime，再比 sha256）；无变化则直接返回 `up-to-date`（幂等）。
3. 新增内容按 sha256 去重后顺序填满 16 MiB 块，用与头部一致的 brotli（quality 10 / lgwin 24）压缩。
4. 以 `fs.open(archive,'a')` 在 EOF 写：先写 chunk 行（索引从 `header.chunks` 续号），再写 entry 行；
   随后以 `r+` 只改写 [0,4096) 的头部（files/origBytes/chunks/archiveBytes/snapshots/appended/updated）。
5. 全程持 `history.jsonl.lock` 排他锁（30 分钟自动过期），避免定时任务与会话内同步并发写坏归档。

读取兼容性：现有两个独立工具都按行前缀识别，不依赖“块在前、条目在后”的单段假设，
因此追加段无需改动解析代码（`work/restore-history.ps1` 第 150 行判 `{"t":"c"` 前缀，逐行分流）。

## 4. 独立验证证据

1. 结构扫描（Node 逐行、顺序无关）：块 91 个、索引 0..90 无缺号；条目 26,378；段越界 0；长度不符 0。
2. **段提取独立还原**：把追加段单独导出为 `work/_append-segment/history-append.jsonl`（9,700,820 字节，块索引重定为 0..5），
   用 `work/restore-history.ps1`（hist-restorer 的独立实现：.NET 解析 + SHA-256，仅 brotli 交给 Node）还原：
   `sample=24 exact=24 mismatch=0 bytes=87916054`，耗时 2.6 s。
3. **全归档抽样独立还原**：`work/restore-history.ps1 -Manifest work/history-manifest-append.json -OutDir work/restore-append-sample`：
   `sample=505 exact=505 mismatch=0 bytes=857704457`，耗时 64.3 s；
   覆盖最大 20 个、零字节 135/135、中文路径 150/235、跨块 51/68、随机 150。
   摘要：`work/restore-append-sample/_summary.json`、`work/restore-append-summary.json`。
4. 清单：`work/history-manifest-append.json` = 原 26,354 条 + 23 个新路径（共 26,377 个唯一路径；
   与 26,378 条目的差 1 是因为 `session.v4.jsonl` 保留了旧快照与新快照两条，属于预期）。

## 5. 以后持续同步

- 工具：`node work/sync-history.mjs`（`--dry-run` 预览、`--force` 强制重打包、`--quiet` 静默）。
- 状态：`work/history-sync-state.json`（记录每个日志的 sha256/size/mtime/最后追加时间/快照次数）。
- 自动：已注册 Windows 计划任务 **InfinityInc-SyncHistory**，每 15 分钟执行
  `work\sync-history.cmd`（内部调用 sync-history.mjs，日志追加到 `work/history-sync.log`）。
  无变化时秒级返回，只有日志真正增长才追加新段。
- 手动：任何一次 “继续” 之后也可直接跑一次上面的命令，幂等。

## 6. 已知取舍

- 会话日志是“增长型”文件，每次同步会为新版本再追加一个快照（保留历史版本，不覆盖）；
  归档按 brotli 去重+压缩，单个 15 MB 日志约新增 0.6～1.3 MB。
- 追加不会回收旧快照；若将来需要回收，可用 `work/restore-history.ps1` 全量还原到新目录后重新用
  `work/pack-history.mjs` 重打包（会重写头部的 created/mergedFrom 字段）。

---

## 7. v2：真实会话日志的增量同步（2026-10-05 晚）

定位到 DSH 的真实会话库（此前 `history/` 只是上一次会话导出/解压后的副本）：

- 实时路径：`C:\Users\REDMI\.dsh\sessions\--D-dev-DeepSeekHarnessWorkspace-Infinity.inc--\<sessionId>\session.v4.jsonl.zstd`
- 当前会话 id：`session-5eef8819-22e0-4858-90e3-f05298822866`（环境变量 `DSH_SESSION_ID`；旧会话为 `session-4cfea7b7-…`）。

关键实现点：

1. **多帧 zstd**：DSH 每次 flush 追加一个独立 zstd 帧，Node 的 `zstdDecompressSync` 只解首帧（587,811 B 只解出 297 B）。
   工具内实现了 `decodeZstdAll()`：遍历 zstd 帧头（magic/FHD/窗口/字典/FCS）与块头（last/type/size），逐帧解码后拼接。
   交叉验证：`live/session-4cfea7b7-…/parts/part-00000.jsonl` 还原后与 `history/session.v4.jsonl` 的 sha256 **完全相同**（15,349,952 B）。
2. **增量分片**：解密后的日志按前缀校验（`sha256(prefix)==prev.sha256`）判断是否纯追加；只把新增字节写成
   `live/<dir>/parts/part-NNNNN.jsonl`。状态 `state.live[rel] = {size, sha256, parts:[{p,s,off,h}], zstdSize, zstdMtime, frames}`，
   按顺序拼接分片即得到整条日志（可逐字节还原）。
3. **去重**：已在 `history/subagents/<id>` 归档过的旧子智能体不再重复入档；实时库中新增的会话/队友目录才入档。

本轮两次同步实测：

| 轮次 | 内容 | 原始 | 归档新增 | 归档总量 | 条目 | 块 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 第 1 次（全量） | 5 个实时源（含 4cfea7b7 15.35 MB、5eef8819 2.74 MB、两个队友 2.78/1.29 MB） | 21.13 MiB | 2.27 MiB（chunk 91–92） | 289,049,590 B | 26,383 | 93 |
| 第 2 次（增量） | 仅 session-5eef8819 新增字节 | 39,872 B | 7,681 B（chunk 93） | 289,057,271 B | 26,384 | 94 |

独立验证（`work/restore-history.ps1`，与打包器实现无关）：

- 5 个实时分片：`sample=5 exact=5 mismatch=0 bytes=22155292`；
- 2 个增量分片：`sample=2 exact=2 mismatch=0 bytes=2775969`；
- 拼接 `part-00000 + part-00001` = 2,775,969 B，sha256 与状态记录完全一致。

自动化不变：Windows 计划任务 **InfinityInc-SyncHistory** 每 15 分钟执行 `work\sync-history.cmd`，
现在同时覆盖 `history/` 快照与 `.dsh` 实时日志；无变化时秒级返回。
