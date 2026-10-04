# Infinity.Inc 历史归档 独立还原验证报告

- 报告日期：2026-10-04
- 执行者：hist-restorer（独立还原实现者）
- 归档：history/history.jsonl（只读，全程未修改或删除 history/ 下任何内容）
- 清单：work/history-manifest.json
- 还原工具：work/restore-history.ps1（独立实现）

## 结论

对定稿归档 history/history.jsonl（276,969,754 字节 / 26,354 条 entry / 85 个 chunk）分别完成全量还原与抽样还原，逐文件 SHA-256 与 work/history-manifest.json 及归档 entry 的 h 字段双重比对：**全量 26,354/26,354 一致、抽样 500/500 一致，不一致数为 0**。归档可完整、逐字节还原。

## 一、归档与清单核对

| 项目 | 值 |
| --- | --- |
| 归档 | history/history.jsonl |
| 归档大小 | 276,969,754 字节（约 264.1 MiB） |
| entry 数 | 26,354 |
| chunk 行数 | 85 |
| chunkBytes | 16,777,216（16 MiB） |
| 原始体积 origBytes | 1,453,849,729 字节（约 1,386.5 MiB） |
| 归档/原始 | 19.05% |
| codec | brotli |
| 清单 | 26,354 条 sha256，与 header.files 完全一致 |
| 头部字段 | 合并流程重写过：含 files/chunks/chunkBytes/origBytes/archiveBytes/codec/mergedFrom/note，不含 blobs/uniqueBytes（还原不依赖这两个字段） |

## 二、还原工具与独立性说明

- 工具：work/restore-history.ps1（Windows PowerShell 5.1，纯 ASCII 源码，避免 PS 5.1 按 ANSI 代码页误读中文）
- 独立性：未调用、未参考 work/unpack-history.mjs；容器格式直接依据 work/pack-history.mjs 的写出逻辑独立推导并解析。
- 唯一外部依赖：Node 内建 zlib.brotliDecompressSync，仅用于 base64 + brotli 解码。
  - 原因：本机 PowerShell 5.1 / .NET Framework 无 BrotliStream（仅 .NET Core 2.1+ 提供，本机无 PowerShell 7），Python 3.12 无 brotli/brotlicffi 模块且无网络可安装，系统也没有 brotli 可执行文件。
  - 除该编解码步骤外，头部读取、行扫描、chunk 定位、entry 解析（含 JSON 反转义）、g 分片拼接、SHA-256 流式计算、路径重建、清单比对全部由本脚本用 .NET/PowerShell 实现。
- 还原算法（两遍扫描）：
  1. 读取 4096 字节头部 JSON；
  2. 单遍字节级扫描归档，记录 85 个 chunk 行的文件偏移/行长度/原始长度，并解析 26,354 条 entry（路径、大小、sha256、分片表 g、行偏移）；
  3. 按本次所需 chunk 集合，逐个定位 chunk 行、解出 base64、用 brotli 解压到临时文件（校验解压长度等于 n）；
  4. 对每条 entry，按 g 的 [chunk, offset, len] 从解压后的 chunk 顺序拼接写入目标文件，同时流式计算 SHA-256；
  5. 与清单 sha256、entry h、entry s、磁盘实际文件长度四项比对。
- 支持超长路径（\\?\ 前缀）与含中文/空格的条目名。

## 三、全量还原（-All）

实际执行命令：

    powershell -NoProfile -ExecutionPolicy Bypass -File work\restore-history.ps1 -Archive history\history.jsonl -Manifest work\history-manifest.json -OutDir work\_restorecheck -All -SummaryJson work\_restorecheck-summary.json

| 指标 | 值 |
| --- | --- |
| 条目数 | 26,354 |
| 逐条一致 | 26,354 |
| 不一致数 | 0 |
| 还原总字节 | 1,453,849,729（与 header.origBytes 完全相等） |
| 磁盘复核 | 输出目录下实际 26,354 个文件、合计 1,453,849,729 字节，与归档一致 |
| 耗时 | 合计 198.99 s（扫描 13.33 s + 解压 85 个 chunk 19.99 s + 还原 152.35 s），墙钟约 204 s |
| 临时目录 | work/_restorecheck 验证后已删除；逐条结果留存 work/_restorecheck-summary.json |

独立复核（不依赖还原脚本的自述结论，直接流式重算哈希）：

| 文件 | 字节 | 与清单 SHA-256 一致 |
| --- | --- | --- |
| DSH/session.v4.jsonl（Lead 指定） | 72,618,242 | 是 |
| 全部 PNG（43 个） | — | 43/43 是 |
| 最大 entry：binaries/node/versions/22.22.2-3/node.exe | 87,074,816 | 是（在 26,354 条一致集内） |

## 四、抽样还原（≥300）

实际执行命令：

    powershell -NoProfile -ExecutionPolicy Bypass -File work\restore-history.ps1 -Archive history\history.jsonl -Manifest work\history-manifest.json -OutDir work\restore-sample -SummaryJson work\restore-sample\_summary.json

| 指标 | 值 |
| --- | --- |
| 抽样数 | 500（要求 ≥300） |
| 逐字节一致 | 500 |
| 不一致数 | 0 |
| 还原总字节 | 841,602,531 |
| 磁盘复核 | work/restore-sample 下 500 个还原文件、841,602,531 字节 |
| 耗时 | 合计 50.99 s（扫描 14.25 + 选择 1.13 + 解压 21.39 + 还原 11.09），墙钟约 54 s |

类别覆盖（脚本选择 + 对清单/归档的独立复核）：

| 类别 | 抽样数 | 独立复核 |
| --- | --- | --- |
| 最大的 20 个 entry | 20 | 20/20 均在样本中（含 node.exe 87,074,816 B、DSH/session.v4.jsonl 72,618,242 B、session.v4.jsonl 72,608,984 B） |
| 0 字节 entry | 135（清单中共 135 个） | 135/135 均在样本中，SHA-256 均为 e3b0c442...b7852b855 |
| 含中文/非 ASCII 名 | 150 | 样本中非 ASCII 路径共 152 条 |
| 跨 chunk entry | 45（新增选择） | 独立 Node 解析器复核：样本 500 条中有 63 条 g 引用 ≥2 个不同 chunk，与脚本统计 crossTotal=63 一致 |
| 随机补齐 | 150 | 随机种子 20261003，可复现 |

独立解析器复核：另行逐行解析 history.jsonl，得到 chunk 行 85、entry 行 26,354，样本 500 条路径全部命中归档。

## 五、不一致清单

无。全量 0 条，抽样 0 条。

## 六、任意条目还原

单条：

    powershell -NoProfile -ExecutionPolicy Bypass -File work\restore-history.ps1 -Archive history\history.jsonl -Manifest work\history-manifest.json -OutDir 目标目录 -Path "binaries/node/versions/22.22.2-3/node.exe"

多条（在 PowerShell 内以数组传参）：

    & .\work\restore-history.ps1 -Archive history\history.jsonl -Manifest work\history-manifest.json -OutDir 目标目录 -Path "a/b.txt","工作历史压缩报告.md"

实测：还原 node.exe 与 工作历史压缩报告.md 两条到临时目录，2/2 逐字节一致（合计 87,139,586 字节），耗时 24.9 s（其中扫描 15.6 s）。

## 七、如何做全量还原

1. 执行第三节命令（-All），输出到空目录，例如 restore-full。
2. 磁盘需求：临时解压 chunk 缓存约等于去重后的唯一数据量（约 1.3 GB，位于系统 TEMP，脚本结束自动删除）+ 输出约 1.39 GB，建议预留 3 GB 以上。
3. 耗时参考（本机）：扫描约 13 s、解压约 20 s、还原约 152 s，合计约 3.3 分钟。
4. 脚本对每条 entry 自动比对清单 sha256 + 归档 entry h + 尺寸；退出码 0 表示全部一致，3 表示存在不一致。加 -SummaryJson 可输出机器可读的逐条结果。
5. 只需校验一致性而不保留文件时，可将 -OutDir 指向临时目录，验证后删除。
6. 环境要求：PowerShell 5.1+ 与 PATH 中的 node（仅用内建 zlib，无需第三方包）。

## 八、说明与限制

- 全程只读 history/；未运行 work/pack-history.mjs；未做任何网络上传或发布。
- 归档头部缺少 blobs/uniqueBytes 字段，是合并流程重写头部所致；还原只依赖 files/chunks/chunkBytes 并实际解析行内容，不受影响。
- 归档中存在合并遗留的重复/改名条目（session.v4.jsonl 与 DSH/session.v4.jsonl、history.jsonl.old 等），均按 entry 路径正常还原。
- 本次验证未修改 work/history-manifest.json 及 history/ 下任何文件。
