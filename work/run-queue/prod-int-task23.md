# prod-int / task-23 运行队列（受控窗口执行单）

状态：等待 Lead 在“受控窗口”统一执行。本文件由 prod-int 编写；执行者按顺序跑，回填 §8 的数字。
每条命令都附【期望产出 + 判定】，判定不通过即视为交付无效、回滚。

## 0. 前置条件

- 源码已冻结：`cpp/apps/int/main.cpp`（冻结基线 sha256 `88af579d677b6d1e3ccee24ad318ad74ffa4b16f05a3b9d9eeb8e78b783e4b70`）。
- 已有候选构建 `cpp/apps/int/_bench/build-perf/int.exe` **早于最后一次“哈希缓冲复用”改动，必须按 §2 重建**。
- 探针（均在 `cpp/apps/int/_bench/`）：`bench.mjs`、`ab.mjs`、`compare.ps1`、`e2e-base.ps1`、`e2e-perf.ps1`、`static-model.mjs`。
- 夹具：`_bench/{root,root-empty,root-dir,root-container,root-syn,root-bad}`。
- 约束：`-j 2`；不并发重构建；不启动浏览器/Electron/WebView2；清理只按命令行含我方测试路径的精确 PID。

## 1. 冻结校验（只读，可先跑）

```powershell
$env:NODE_OPTIONS=''
(Get-FileHash 'cpp/apps/int/main.cpp' -Algorithm SHA256).Hash
(Get-FileHash 'cpp/apps/int/_bench/base-src/main.cpp' -Algorithm SHA256).Hash
```
【期望】第二个 = `88af579d677b6d1e3ccee24ad318ad74ffa4b16f05a3b9d9eeb8e78b783e4b70`（74,302 B，mtime 2026-10-04 19:10:42）。
第一个 = 本次候选源码哈希：`c62358abf42498b89a60afeb01ce0f040fe8bb9def69395588666a5d9427d514`（80,859 B）。
【判定】两者都与上面一致 → 继续；否则停止并回报（源码已被他人改动，需重做基线）。

## 2. 构建（cmake/ninja/g++ 都是控制台程序，无窗口）

```powershell
$env:NODE_OPTIONS=''
cmake -G Ninja -DCMAKE_BUILD_TYPE=Release -S cpp -B cpp/apps/int/_bench/build-perf
ninja -C cpp/apps/int/_bench/build-perf -j 2 int
Copy-Item 'cpp/apps/int/_bench/build-perf/int.exe' 'cpp/apps/int/_bench/perf/int_cli.exe' -Force
(Get-Item 'cpp/apps/int/_bench/perf/int_cli.exe').Length
(Get-FileHash 'cpp/apps/int/_bench/perf/int_cli.exe' -Algorithm SHA256).Hash
```
【期望】`ninja` 最后一行 `Linking CXX executable int.exe`；输出 exe 字节数与 sha256。
（core 的 `mergeObject defined but not used` 是既有警告，非本次引入。）
【判定】exit code 0 且两个值都打印出来 → 继续；编译失败 → 停止、回报编译错误。

## 3. 行为等价回归（控制台，无窗口，逐字节对比）

```powershell
& 'cpp/apps/int/_bench/compare.ps1'
& 'cpp/apps/int/_bench/e2e-base.ps1'
& 'cpp/apps/int/_bench/e2e-perf.ps1'
```
【期望】`compare.ps1` 输出 `compared 86 command-runs, N differ`，N 只来自 `--paths` 的 exe 目录差异（应为 6）；
两个 e2e 输出除路径外逐字节相同（各约 4,487 B）。
【判定】compare 的差异若出现 `--paths` 之外的任何一条 → 交付无效、回滚；e2e 不一致 → 回滚。

## 4. 计时（交替 A/B，控制台，无窗口）— `ab.mjs` 的四条子命令

```powershell
$env:NODE_OPTIONS=''
node cpp/apps/int/_bench/ab.mjs --base=cpp/apps/int/_bench/base/int_cli.exe --cand=cpp/apps/int/_bench/perf/int_cli.exe --rounds=15
```

`ab.mjs` 在同一夹具上交替（偶数轮基线先、奇数轮候选先）跑以下四条子命令，每边 15 轮取中位数：

| # | 子命令 | 主要测什么 | 期望（方向） | 判定 |
| --- | --- | --- | --- | --- |
| 1 | `--version` | 进程创建/加载底噪（不扫插件） | base≈cand | 两者差在噪声内 → 说明没有引入启动回退 |
| 2 | `list` | 插件枚举（`Scan::Names`） | 真实容器至少不慢于基线；2002 条目夹具应显著更快（静态模型削减 93.8% 读字节、100% 哈希） | `candMs<=baseMs` |
| 3 | `plugin list` | 完整校验（`Scan::Verified`，仍逐条目 SHA-256） | 真实容器基本持平；2002 条目夹具应更快（provider 2003→1、拷贝归零） | `candMs<=baseMs` |
| 4 | plugin verify（文件或名字） | 单容器校验路径（provider 复用、无 substr 拷贝） | 读数与基线一致，不慢 | 退出码与基线相同 + candMs<=baseMs |

【期望产出】每个夹具 × 命令一行 JSON：`baseMs`/`candMs`/`deltaMs`/`ratio`。
【判定】任一条 `candMs>baseMs` 且差值超出噪声带（建议以 `--version` 的波动幅度为噪声带）→ 该项优化无收益/有害，写清数据并回滚该项。

## 5. UI 指标（`--serve-ui` 只起 127.0.0.1 环回 HTTP，不调用 CreateWindow，无窗口）

```powershell
$env:NODE_OPTIONS=''
node cpp/apps/int/_bench/bench.mjs cpp/apps/int/_bench/base/int_cli.exe --root=cpp/apps/int/_bench/root --runs=11 --ui-port=7653 --label=baseline
node cpp/apps/int/_bench/bench.mjs cpp/apps/int/_bench/perf/int_cli.exe  --root=cpp/apps/int/_bench/root --runs=11 --ui-port=7653 --label=candidate
```
【期望产出】`readyMs`/`firstStateMs`/`firstToolsMs`/`repeatToolsMs`/`idleToolsMs`、
`memory.privateMB/workingSetMB/peakWorkingSetMB`（每行 JSON）。
【期望数据】`/api/state`、`/api/tools` 两个响应体对同一 root 应逐字节相同
（静态模型：一次页面加载读字节 3,455,254→1,727,826，哈希 6,910,110→1,727,627，provider 打开 6→1）。
【判定】HTTP body 不同 → 回滚；`privateMB` 若比基线高 >10% 需在报告中写明。

## 6. 杀法与残留核对（每步之后都跑）

```powershell
# 只匹配“命令行里出现我方测试路径”的进程，且可执行名属于本产品测试集合；
# 不按进程名匹配任何浏览器/用户程序，也不会命中正在执行清理脚本的 shell 自身。
$needle = 'cpp\apps\int\_bench'
$testNames = @('int.exe', 'int_cli.exe', 'node.exe')
$mine = Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne $PID -and $_.CommandLine -and
  ($_.CommandLine -like "*$needle*") -and ($testNames -contains $_.Name)
}
$mine | ForEach-Object { Write-Output ($_.ProcessId.ToString() + ' | ' + $_.Name + ' | ' + $_.CommandLine) }
# 先打印完整命令行并人工确认属于我方测试路径，再逐个精确杀：
$mine | ForEach-Object { & taskkill /T /F /PID $_.ProcessId }
```
【要求】先打印每个 PID 的完整命令行；**只杀“可执行名为 int.exe/int_cli.exe/node.exe 且命令行含 `cpp\apps\int\_bench`”的 PID**；
严禁按进程名（chrome/msedge/msedgewebview2/explorer/fastbrowser/*_gui）批量杀。
【判定】`($left | Measure-Object).Count` = 0 且 `Get-NetTCPConnection -LocalPort 7653` 无监听；
若残留非 0，逐个核对命令行后再杀，并回报 PID 清单。

## 7. 可选：发行包字节（task-31 统一发布口径）

要得到“同源码口径”的 INT 安装包 before/after，需在同一源码下各打一次包（makensis 是 .exe，同样需批准），
输出写到我方临时目录，不动 `cpp/release/`：以 `build-base2/int.exe`（基线）与重建后的 exe（候选）
各复制成 `int_cli/int_gui/intx_cli/intx_gui` 到临时 stage，用与 `cpp/tools/package.mjs` 相同的
`SetCompressor /SOLID lzma` 参数打包。建议由 task-31 统一做；否则该项保持“旧产物 262,473 B / 待集中重建”。

## 8. 回填清单

- [ ] §1 冻结哈希（两个都对）
- [ ] §2 新 exe 尺寸 + sha256 + 构建时间
- [ ] §3 compare.ps1 与两个 e2e 的结果行
- [ ] §4 ab.mjs 四条子命令的 JSON 表（含判定）
- [ ] §5 UI/内存数字 + HTTP 响应体逐字节对比结论
- [ ] §6 残留核对 = 0，无 7653 监听
- [ ] 把 `work/perf-int.md` 中所有 `PENDING(受控窗口)` 占位替换为实测值
