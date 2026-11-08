# 工作区清理报告（task-7 / janitor）

- 生成时间：2026-10-06（Asia/Shanghai）
- 工作区：`D:\dev\DeepSeekHarnessWorkspace\Infinity.inc`
- 环境：Windows / Windows PowerShell 5.1 / node v24（D:\program\nodejs\node.exe）
- 工具限制：仅内置工具（run_code + read/write/edit/grep/glob/pwsh），未下载或安装任何东西
- 本次范围：`work/` 下的还原样本与 QA 副本、`%TEMP%\dsh-*` 陈旧临时目录

## 0. 摘要

| 项目 | 值 |
|---|---|
| 删除目标数 | **34**（work 3 项 + %TEMP% 陈旧 dsh-* 31 项），失败 0 |
| 回收总字节 | **3,228,647,339 B（3.01 GiB）** |
| C: 可用（清理前 → 后） | 32,907,886,592 → 34,970,759,168 B（+2,062,872,576 B） |
| D: 可用（清理前 → 后） | 130,876,264,448 → 131,270,721,536 B（+394,457,088 B） |
| 保护性核验 | 34/34 目标已删除；history/ 与全部交付物 sha256 抽检 OK（见 §6） |
| 报告文件 | work/cleanup-report.md（含删除前清单、回收量、C/D 空间与保护性核验） |

> 磁盘可用空间在清理期间会因其他并行任务（task-4/5/6 正在重建产物）波动，故以“目标清单实测字节合计”作为回收量主口径，磁盘差值作为辅口径。

## 1. 候选判定

| 候选 | 实测大小 | 判定 | 依据 |
|---|---:|---|---|
| work/restore-sample | 841,718,934 B / 501 文件 | **删除** | 由 work/restore-history.ps1 可完整再生（命令见 §2.1）；work/restore-report.md、work/_restorecheck-summary.json（6,106,447 B）已保留；删除前另存 work/restore-sample-summary.json（sha256 36C782EA…） |
| work/_qacheck | 2,952,706 B / 10 文件 | **删除** | 10 个安装器副本与 cpp/release/v1.0pre3、v1.0pre4 下正式产物逐字节同哈希，属冗余副本 |
| work/_live-restore | 不存在 | 跳过 | 目录不存在（仅有 work/_live-restore-summary.json / summary2.json 保留在 work 根） |
| work/restore-append-sample | 32,788 B / 1 文件 | **删除** | 仅剩 `.skill-list-cache.json` 残留；追加段摘要 work/restore-append-summary.json（117,481 B）与 work/history-append-report.md 已保留 |
| %TEMP%\dsh-*（2026-10-06 00:00 之前） | 2,383,942,911 B / 31 项 / 8,288 文件 | **删除** | 陈旧的工作区变更快照/溢出/子进程临时目录；今天（10-06）仍在写入的条目一律保留，避免干扰运行中的会话 |
| %TEMP%\dsh-*（2026-10-06 当天） | 约 0.48 GB | 保留（待确认） | mtime ≥ 2026-10-06 00:00，可能被当前运行中的 task-4/5/6 会话使用 |

## 2. 删除前清单（含 sha256）

### 2.1 work/restore-sample

- 路径：`D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\restore-sample`
- 文件数：**501**，总字节：**841,718,934**（802.72 MiB）
- 目录清单聚合哈希（按“相对路径|字节”排序后 SHA256）：`255BFB1435207D307C4588BC5E5225963D51DE896CC913C1A231F7129E19293C`
- 关键文件 sha256：
  - `_summary.json`（116,403 B）：`36C782EA847B169BAA9C87C5CE9811CF489A35733CF94B433BB3F503298A27B2` → **已另存** work/restore-sample-summary.json（同哈希）
  - `session.v4.jsonl`（72,608,984 B）：`66095A7E283268BF88FBDE8E514AB7DA48D773E05A27ECFA999BC400200FB78B`
  - `history.jsonl.old`（18,522,617 B）：`BFD03FF744788DE527209D7FEA0B449CA283CC41904AAD432D63811E76CF6538`
  - `.skill-list-cache.json`（32,788 B）：`58F7987CD6977C45B8895B0CA4E694474E4E56D42D4305B1D93B518CE64C27FB`
- 再生命令（依据 work/restore-report.md:71、work/restore-history.ps1:45）：
  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File work\restore-history.ps1 `
    -Archive history\history.jsonl -Manifest work\history-manifest.json `
    -OutDir work\restore-sample -SummaryJson work\restore-sample\_summary.json
  ```
- 输入存在性核验：history\history.jsonl（289,403,005 B）、work\history-manifest.json（5,710,342 B）、work\restore-history.ps1（20,932 B）均存在。

### 2.2 work/_qacheck

- 路径：`D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_qacheck`
- 文件数：**10**，总字节：**2,952,706**

| 文件 | 字节 | sha256 | 同源（cpp/release）| 
|---|---:|---|---|
| _qacheck/InfinityCloud_1.0.0-pre4_win64_setup.exe | 477846 | 732F909F578864F1EAD0C9539D40AA4E075C26A319D385FAD5BACF671D85F7A5 | cpp/release/v1.0pre4 同名同哈希 |
| _qacheck/InfinityFileManager_1.0.0-pre4_win64_setup.exe | 235017 | A6062187CB97E2C7F8732C17529932A2C8356FCC6C2B285A62F4DE96CAF3D5AE | cpp/release/v1.0pre4 同名同哈希 |
| _qacheck/InfinityGames_1.0.0-pre4_win64_setup.exe | 262882 | 96F0EB3E4E97044A8C02A4E06DBA5A5F4B97DE853A45CEBA398FF07BFCFB9456 | cpp/release/v1.0pre4 同名同哈希 |
| _qacheck/InfinityInstallerManager_1.0.0-pre4_win64_setup.exe | 302978 | 08CE3A05D83E9D38B4FB696F156E580FCC04A9E30066A21C8A41F9061210D2F2 | cpp/release/v1.0pre4 同名同哈希 |
| _qacheck/InfinityPackageManager_1.0.0-pre4_win64_setup.exe | 278021 | 56E8AFB8BFF30CEE76C7CC2184FB37F43EF2EC203060261EEC6E11CFAC2C0ED7 | cpp/release/v1.0pre4 同名同哈希 |
| _qacheck/InfinityToolbox_1.0.0-pre4_win64_setup.exe | 262473 | 4827D87C0AB9EB8F319EE96D59062FFEE350FF06E6C571D248D4A74F0FC789F2 | cpp/release/v1.0pre4 同名同哈希 |
| _qacheck/pre3/InfinityCloud_1.0.0-pre3_win64_setup.exe | 441856 | 8837D69F9A7CAF858A3F075872D3D81D7AD484EC56462B1D5805EFB96C8E7A55 | cpp/release/v1.0pre3 同名同哈希 |
| _qacheck/pre3/InfinityFileManager_1.0.0-pre3_win64_setup.exe | 187658 | 390FCD1B0849F674B86DAD90A8F6E29C7D4CE5FE5CFBBA2D4D14C14F89CDB5D5 | cpp/release/v1.0pre3 同名同哈希 |
| _qacheck/pre3/InfinityInstallerManager_1.0.0-pre3_win64_setup.exe | 262570 | C3DDB2BE0DA69ED40B0592F7C6345CD278FC0D30571FA4BAB364E83D8DA57D57 | cpp/release/v1.0pre3 同名同哈希 |
| _qacheck/pre3/InfinityPackageManager_1.0.0-pre3_win64_setup.exe | 241405 | E92D805E6119350E94F15A3AECB38FFE6542D1B52B97E79CD570E18A88376046 | cpp/release/v1.0pre3 同名同哈希 |

合计 10 个文件、2,952,706 字节（10 个全部与 cpp/release 下的正式产物逐字节同哈希，删除后仍可由 cpp/release 或重新打包脚本再生）。

### 2.3 work/restore-append-sample

- 路径：`D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\restore-append-sample`
- 文件数：**1**，总字节：**32,788**
- 清单：
  - `.skill-list-cache.json`（32,788 B）：`58F7987CD6977C45B8895B0CA4E694474E4E56D42D4305B1D93B518CE64C27FB`
- 已保留的对应摘要：work/restore-append-summary.json（117,481 B）、work/history-append-report.md（7,391 B）。

### 2.4 work/_live-restore

- 不存在。跳过并记录。

### 2.5 %TEMP%\dsh-* 陈旧条目（31 项，合计 2,383,942,911 B / 8,288 文件）

| 条目 | 类型 | 文件数 | 字节 | 最后写入 |
|---|---|---:|---:|---|
| %TEMP%/dsh-workspace-changes-AH2Xfe | DIR | 2540 | 726,572,660 | 2026-10-05 20:08 |
| %TEMP%/dsh-workspace-changes-2xO03V | DIR | 1715 | 717,212,080 | 2026-10-05 12:52 |
| %TEMP%/dsh-workspace-changes-phb1c1 | DIR | 3049 | 545,540,468 | 2026-10-04 20:57 |
| %TEMP%/dsh-workspace-changes-bgaGs5 | DIR | 208 | 206,086,477 | 2026-10-03 20:04 |
| %TEMP%/dsh-workspace-changes-wRXlmx | DIR | 423 | 108,843,430 | 2026-10-05 15:22 |
| %TEMP%/dsh-subprocess-m3O1ym | DIR | 8 | 55,053,328 | 2026-10-04 20:13 |
| %TEMP%/dsh-spill-vgyI1r | DIR | 5 | 20,608,024 | 2026-10-05 17:47 |
| %TEMP%/dsh-workspace-changes-eHqVtZ | DIR | 36 | 1,036,182 | 2026-10-05 15:26 |
| %TEMP%/dsh-workspace-changes-sBEKbl | DIR | 45 | 611,857 | 2026-10-04 15:22 |
| %TEMP%/dsh-workspace-changes-Ywb1C2 | DIR | 18 | 466,029 | 2026-10-05 11:45 |
| %TEMP%/dsh-workspace-changes-ZDzw5m | DIR | 178 | 463,829 | 2026-10-03 18:31 |
| %TEMP%/dsh-workspace-changes-bIieDL | DIR | 28 | 360,690 | 2026-10-05 18:13 |
| %TEMP%/dsh-subprocess-WOFqSL | DIR | 1 | 354,536 | 2026-10-05 17:47 |
| %TEMP%/dsh-workspace-changes-LcZzo6 | DIR | 15 | 238,851 | 2026-10-04 15:01 |
| %TEMP%/dsh-spill-wfQreX | DIR | 2 | 110,260 | 2026-10-04 20:39 |
| %TEMP%/dsh-workspace-changes-ej4Irg | DIR | 4 | 97,680 | 2026-10-04 15:01 |
| %TEMP%/dsh-workspace-changes-fPvtMp | DIR | 2 | 56,699 | 2026-10-05 15:24 |
| %TEMP%/dsh-acl-skill-0OLmWO | DIR | 2 | 52,442 | 2026-10-05 15:21 |
| %TEMP%/dsh-acl-skill-6k8QbN | DIR | 2 | 52,442 | 2026-10-05 10:16 |
| %TEMP%/dsh-acl-skill-TeJj75 | DIR | 2 | 52,442 | 2026-10-04 14:55 |
| %TEMP%/dsh-workspace-changes-7xMvkD | DIR | 2 | 38,164 | 2026-10-05 13:01 |
| %TEMP%/dsh-native-command-2CsqiI | DIR | 1 | 11,451 | 2026-10-05 15:24 |
| %TEMP%/dsh-native-command-pYMKiP | DIR | 1 | 11,451 | 2026-10-05 15:24 |
| %TEMP%/dsh-native-command-R5JaAU | DIR | 1 | 11,439 | 2026-10-05 15:24 |
| %TEMP%/dsh-acl-skill-E3p9RM | DIR | 0 | 0 | 2026-10-05 14:12 |
| %TEMP%/dsh-acl-skill-t7jtlM | DIR | 0 | 0 | 2026-10-05 14:12 |
| %TEMP%/dsh-subprocess-BVDHFS | DIR | 0 | 0 | 2026-10-05 14:12 |
| %TEMP%/dsh-workspace-changes-BHRbhA | DIR | 0 | 0 | 2026-10-03 19:15 |
| %TEMP%/dsh-workspace-changes-KDcbt4 | DIR | 0 | 0 | 2026-10-03 20:30 |
| %TEMP%/dsh-workspace-changes-QaChIV | DIR | 0 | 0 | 2026-10-03 20:47 |
| %TEMP%/dsh-workspace-changes-rcJ6MS | DIR | 0 | 0 | 2026-10-03 19:17 |

## 3. 待确认（保留，不删）

| 路径 | 类型 | 文件数 | 字节 | 保留原因 |
|---|---|---:|---:|---|
| temp/（工作区根） | DIR | 35,326 | 17,756,564,230 | 体积最大，但位于工作区根且非本次授权范围；无法逐一确认可再生，保留待确认 |
| temp/ifm-bench | DIR | 5,706 | 90,838,902 | 基准测试产物，task-5 可能引用 |
| temp/ifm-buildtest | DIR | 27 | 81,130,930 | 构建测试产物，task-5 可能引用 |
| work/_append-segment | DIR | 30 | 97,630,251 | 历史追加段中间产物；虽在 work/history-append-report.md 有记录，但未确认可脚本再生，保留待确认 |
| Infinity Cloud/tools/perf/_build | DIR | 28 | 3,623,917 | CMake 构建树，可能由 Infinity Cloud 相关任务复用，保留待确认 |
| work/_pubcheck | DIR | 6 | 1,819,217 | 发布校验副本，非本次授权 |
| work/_dl-shots | DIR | 22 | 876,039 | 截图/下载校验样本，非本次授权 |
| work/_verify-shots | DIR | 14 | 114,994 | 校验截图，非本次授权 |
| work/_gitee | DIR | 5 | 10,170 | 镜像状态样本，非本次授权 |
| work/_live-releases.json | FILE | 1 | 69,792 | 发布快照，保留 |
| work/_janitor-inventory.json | FILE | 1 | - | 本次清理的机器可读清单，保留 |
| %TEMP%\dsh-*（10-06 当天） | DIR | - | 约 4.8e8 | 当前会话仍可能在使用 |

## 4. 硬约束遵守声明

- 未删除、未修改：`history/`、`work/*.mjs`、`*.ps1`、`*.md`（含各任务报告）、任何源码、任何正式产物（`cpp/release/**`、`Infinity Cloud/**`、`Infinity File Manager/**`、installers/packaging 等）。
- 未触碰：`ING` / `Infinity Games` / `history/` / `work/sync-history.mjs`。
- 所有删除目标均先记录路径、文件数、总字节、关键 sha256，再执行删除。

## 5. 删除执行记录

- 执行时间：2026-10-06 09:1x（Asia/Shanghai）
- 实际命令（Windows PowerShell 5.1，仅内置；先范围校验 + reparse point 跳过，再逐项测量并删除）：

```powershell
$root='D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
$tmpRoot=([System.IO.Path]::GetFullPath($env:TEMP)).TrimEnd('\')
$targets = @(
  "$root\work\restore-sample","$root\work\_qacheck","$root\work\restore-append-sample",
  'C:\Users\REDMI\AppData\Local\Temp\dsh-...'   # 共 31 个 10-06 之前的陈旧 dsh-* 条目
)
foreach ($t in $targets) {
  $full=[System.IO.Path]::GetFullPath($t); $parent=Split-Path -Parent $full; $leaf=Split-Path -Leaf $full
  $ok = ($parent -eq (Join-Path $root 'work') -and $leaf -in @('restore-sample','_qacheck','restore-append-sample')) -or
        ($parent -eq $tmpRoot -and $leaf -like 'dsh-*')
  if (-not $ok) { continue }
  $item = Get-Item -LiteralPath $full -Force
  if ($item.Attributes.ToString() -match 'ReparsePoint') { continue }   # 不穿透 junction/symlink
  $sz = if ($item.PSIsContainer) { (Get-ChildItem -LiteralPath $full -Recurse -File -Force | Measure-Object Length -Sum).Sum } else { $item.Length }
  Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction Stop      # 每项独立 try/catch
}
```

- 退出码：0（`$ErrorActionPreference='Continue'`，逐项 try/catch；FAIL_COUNT=0，34/34 删除成功）

| 组 | 目标数 | 实测回收字节 | 折合 |
|---|---:|---:|---:|
| work/restore-sample | 1 | 841,718,934 | 802.72 MiB |
| work/_qacheck | 1 | 2,952,706 | 2.82 MiB |
| work/restore-append-sample | 1 | 32,788 | 32.02 KiB |
| %TEMP%\dsh-*（陈旧 31 项，8,288 文件） | 31 | 2,383,942,911 | 2.22 GiB |
| **合计** | **34** | **3,228,647,339** | **3.01 GiB** |

- 磁盘可用空间实测（并发任务 task-4/5/6 同时在 D: 构建，故差值小于回收量属正常）：

| 盘 | 清理前 | 清理后 | 观测差值 |
|---|---:|---:|---:|
| C: | 32,907,886,592 B（30.65 GiB） | 34,970,759,168 B（32.57 GiB） | +2,062,872,576 B |
| D: | 130,876,264,448 B（121.89 GiB） | 131,270,721,536 B（122.25 GiB） | +394,457,088 B |

- 收尾复测：C: 34,929,782,784 B / D: 131,266,658,304 B（同分钟其他任务仍在写入，属正常波动）。
- 回收量主口径取“允许清单实测字节合计”= **3,228,647,339 B**；磁盘差值仅作辅证。

> 保留未删：10-06 当天仍在写入的 `%TEMP%\dsh-*`（含 dsh-workspace-changes-4fa1zo 475,129,682 B、dsh-spill-GqUcAa 390,263 B、dsh-subprocess-ifHCzP、dsh-acl-skill-XkeRUo 等），避免干扰正在运行的 task-4/5/6 会话。

## 6. 保护性核验

- 删除目标复测：**34/34 全部不存在**（TARGETS_GONE=34/34，0 个残留）。
- 保护对象抽检（sha256 核验，全部 OK）：

| 路径 | 字节 | sha256 |
|---|---:|---|
| history/history.jsonl | 289,403,005 | D7C463D739CD31EF5392165910166EE0F47EC33245955022D56F74ED9BF5E9D9 |
| history/session.v4.jsonl | 15,349,952 | 2CFAF0ADD8FEEAAB316B74857A0038D381F837B0D28C189BCA02AAB78BA5889E |
| work/sync-history.mjs | 16,671 | 71137D01ECD29B0E83005FF1124D1B6B99E9654FD6C455A757DA9E1C9DE34FFB |
| work/ghsync.mjs | 35,816 | 769A6F1D6DE59CEE6B591769FC1C0B21CD7AF59F16B6866201F22D32CF94C277 |
| work/TASKS.md | 9,906 | 7D69E50198F55B6754C42E63F5DFB6A91CA5F1AD85FE63E7E746A13479B2027E |
| work/restore-report.md | 7,567 | FAED6A8EBF74E0F5203885FC9E4A659B7C866BB322B966FCA6339B86580C1A01 |
| work/_restorecheck-summary.json | 6,106,447 | 2C513CD1A52125FF102FF052878E1945B3D727F0DADBC2B7D2015F5CAC17DBD3 |
| work/restore-append-summary.json | 117,481 | 1545E19037D6A23CC47D76C90FD4773696CC99E4D941E5B55DDB8671AE703C54 |
| work/restore-sample-summary.json（本次另存） | 116,403 | 36C782EA847B169BAA9C87C5CE9811CF489A35733CF94B433BB3F503298A27B2 |
| work/restore-history.ps1（再生命令） | 20,932 | C3CFAB23672ADFEE15B5E6E6AFA9858A732DEA40019AF92440FF1B28B7AB872F |

- 正式产物完好：`cpp/release/v1.0pre3` 6 文件/1,135,275 B；`cpp/release/v1.0pre4` 8 文件/1,822,316 B（_qacheck 的 10 个副本与它们逐字节同哈希）。
- work/ 保护类型计数：`*.mjs`=28、`*.ps1`=5、`*.md`=39，均未减少。
- 说明：`work/ifm-sea-report.md`、`work/ghsync-report.md` 尚不存在——它们是 task-5 / task-6 的待交付报告，与本次清理无关（本次未触碰这两个任务的文件）。
- 可再生性复核：`history/history.jsonl`、`work/history-manifest.json`、`work/restore-history.ps1` 均在，`work/restore-sample` 可按 §2.1 命令一键再生。

## 7. 复核结论

- 验收通过：报告含**回收总量 3,228,647,339 字节（3.01 GiB）**与 **C:/D: 清理前后可用空间**。
- 未破坏任何交付物：history/、work/*.mjs、*.ps1、*.md（含全部任务报告）、源码、正式产物均完好；不确定项列入 §3「待确认」并原样保留。
