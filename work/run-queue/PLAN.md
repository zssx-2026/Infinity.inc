# 受控运行窗口计划（Lead，2026-10-05）

> 前置铁律：窗口执行期间**不需要**任何成员在场；由 Lead 单独执行，任何成员不得自行启动二进制。
> 每次执行必须：① 执行前进程快照 → ② 单批执行并逐条残留核对 → ③ 执行后进程快照 → ④ 可见窗口探针一旦为真立即整批中止并回滚。

## 0. 执行纪律（每次都做）
1. 快照：`Get-CimInstance Win32_Process | Select ProcessId,Name,CommandLine` 存 `work/run-queue/snap-<ts>-before.txt`。
2. 隐藏：`Start-Process -WindowStyle Hidden` + 子进程 `CREATE_NO_WINDOW`/`windowsHide:true`；有 UI 面的产品一律 `--serve-ui`（loopback，无 CreateWindow）而非 GUI 面。
3. 杀：`taskkill /T /F /PID <pid>`，PID 只来自“命令行含 `Infinity.inc\cpp\apps\<app>` / `Infinity Cloud\tools\perf` / `work\archive`”的精确匹配；**严禁**按进程名批量杀 msedge/chrome/explorer/SearchHost/fastbrowser。
4. 可见窗口探针：EnumWindows + GetWindowThreadProcessId，命中候选 PID 且 IsWindowVisible → 立即 `taskkill /T /F` 整批，标记该批次永久取消。

## 1. 批次 A（最优先，产出决定性证据，约 20 分钟）
| # | 任务 | 命令 | 期望产出 | 判定 |
| --- | --- | --- | --- | --- |
| A1 | task-23 | `ninja -C cpp/apps/int/_bench/build-perf -j 2 int` | int.exe | 构建成功 |
| A2 | task-23 | `node cpp/apps/int/_bench/ab.mjs` | ab.json | base 与 perf 输出逐字节一致 |
| A3 | task-22 | `cpp/apps/iim/bench/runner.exe 5 ... iim_gui.exe --version` | 冷启动中位 ms | 改动后 ≤ 改动前 |
| A4 | task-22 | `cpp/apps/iim/bench/harness_after.exe real` / `plan` | 基准 JSON | 计划生成不退化 |
| A5 | task-24 | `ninja -C cpp/build ing -j 2` + `ing.exe --version` | 冷启动 ms | 不退化 |
| A6 | task-24 | `cmd/apps/ing/perf/bench.ps1` / `dirwalk.ps1` | 目录遍历 ms | 24h 标记生效 |

## 2. 批次 B（流式预览，约 15 分钟）
| # | 任务 | 命令 | 期望 |
| --- | --- | --- | --- |
| B1 | task-32 | 构建 inc → `inc_after.exe --serve-ui --port=7622` → `curl -w %{time_starttransfer} %{size_download}` 打 /api/preview/meta 与 /api/preview/chunk（Range 0-262143），txt/png/zip 各 1 + ≥50 MB 文件 1 | 首内容 ≤800 ms；首块前字节 ≤256 KiB |
| B2 | task-33 | `node "Infinity File Manager/bench/preview-bench.mjs"`（已批准，无需窗口） | 首内容字节比/time-to-first-content |

## 3. 批次 C（内核与安装包，风险最高，最后做，约 40 分钟）
| # | 任务 | 命令 | 风险控制 |
| --- | --- | --- | --- |
| C1 | task-27 | WebView2 降级 A1/A2（缺运行时 exit 20 / 缺 loader exit 5） | 宿主自隐藏自退出，先行 |
| C2 | task-27 | CEF 5 次（**必须先应用 work/webview2/cef-hide.patch**） | 补丁后仍探到可见窗口 → 永久放弃 CEF 路径 |
| C3 | task-31 | `cmake -S cpp -B cpp/build-pre5 -G Ninja -DCMAKE_BUILD_TYPE=Release` → `ninja -j 2` → `makensis` 六应用 | 内存 <3.5 GB 时串行单应用构建 |
| C4 | task-25 | `node work/archive/make-bundle.mjs`（纯 node，已替代 tar.exe）+ `curl` POST 上传 | 从最小 11 包（≈400 MB）起验证管线 |

## 4. 批次 D（归档补全，约 25–29 小时，按字节升序分批）
rel-publish 的 `work/archive/archive-plan.json`：36 个待办包，合计 4,161,865,886 B。单窗口做不完，按 400 MB/批推进，每批写完 `work/archive/upload-log.jsonl`。

## 5. 明确不做（已被否决）
- 浏览器 headless 截图（proj-web task-30）：改为 node 单测 + 静态自检，截图 N/A。
- 任何 GUI 面启动（inc/ifm/ipm/iim/int/ing 的窗口模式）：一律用 `--serve-ui` 或 CLI 替代。
- 按进程名批量清理：永久禁止（2026-10-04 20:31 误杀用户浏览器事故）。

## 6. 内部阻塞（与运行无关，须先解）
- prod-ipm 报告的 gzip×Range 冲突：在 http.cpp 落地守卫前，**不得**在生产构建里启用 gzip 分片下载（task-31 依赖它）。
- electron 冷启动：未测，报告标 N/A。
- 7z.exe 本机缺失：安装器载荷解包（hist-verifier B）需外部工具，暂缓。
