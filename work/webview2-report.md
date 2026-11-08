# 用 WebView2 做真正精简的 Chromium 宿主（task-27）

- 日期：2026-10-04
- 运行时：WebView2 Evergreen **154.0.4258.53**（Chromium 154.0.8037.94），SDK 1.0.4258.31
- UI：复用已交付的 `work/edge-ui/`（未修改，只读拷贝到 `work/webview2/ui/`）
- 工作目录：`work/webview2/`；源码 `cpp/hosts/webview2/`
- 状态：宿主实现、构建、静态测量完成；WebView2 侧真实运行证据已在“禁止启动进程”规则生效前采集；CEF/Electron 对照的两项冷启动数字**待 Lead 代跑**（见 `run-list.md`）

## 1. 结论摘要

1. **应用可携带 0 字节内核**：宿主 exe 55,296 B + `WebView2Loader.dll` 194,912 B + UI 201,906 B =
   **452,114 B（0.43 MiB）**，内核完全由系统已装的 Evergreen 运行时提供（本机 861.2 MiB，全机共享）。
   对比：精简 CEF 内核 325.0 MiB、Electron 外壳 268.1 MiB —— 体积差约 **600 倍**。
2. **真实渲染已证实**：WebView2 宿主加载 `ui/index.html?host=1&theme=dark`，`exit=0`、`ok=true`，
   DOM 探针返回 `host=webview2`、`bridgeAtDocumentCreated=true`、`hasShell=true`、`localStorageOk=true`、
   `title=Infinity Edge Shell`、UA `Chrome/154.0.0.0 Edg/154.0.0.0`；`CapturePreview` 得到 1280x800 PNG
   （990–1008 种采样色，平均亮度 41.1，非空白）。
3. **宿主桥双向打通**：外壳 4 条报文经 WebView2 标准通道送达宿主
   （`shell.activate-tab`、`shell.ready`、`shell.content-rect`×2），宿主回 `host.info`，
   外壳日志出现 `to-shell:host.info`，payload 含 `runtime=154.0.4258.53`。
4. **冷启动到首帧中位数 1162.6 ms**（5 次，宿主内 QPC 到 `NavigationCompleted`）。
   CEF 与 Electron 的对应数字**缺失**：CEF 宿主在隐藏启动下仍产生可见窗口（实测，见 §7），Electron 未运行。
   按 Lead 批复（20:46）两项一律**不批运行**，在对比表中标 **PENDING（受控窗口）**。
5. 代价与前提：**依赖机器已装 WebView2 运行时**（Win10/11 + 较新 Edge 基本自带），
   离线/纯净机需要 861 MiB 量级的 fixed-version 运行时随包分发。

## 2. 交付物

| 路径 | 说明 |
| --- | --- |
| `cpp/hosts/webview2/main.c` | C 宿主：环境→控制器→导航→探针→截图→结果 JSON；无对话框 |
| `cpp/hosts/webview2/build.ps1` | 构建（gcc，-O2 -s -municode）+ 拷贝 loader/UI |
| `work/webview2/webview2-host.exe` | 宿主产物 55,296 B |
| `work/webview2/WebView2Loader.dll` | SDK x64 loader 194,912 B |
| `work/webview2/ui/` | edge-ui 外壳副本（11 文件 201,906 B） |
| `work/webview2/tools/{run,bench,bench-cef}.ps1` | 运行/基准脚本（隐藏窗口、超时自愈、残留清理） |
| `work/webview2/bench/bench.json` | WebView2 冷启动 5 次样本与中位数 |
| `work/webview2/bench/wv2-{1..5}.{json,probe.json,png,stdout.txt}` | 逐次证据 |
| `work/webview2/footprint.json` | 三方字节账（静态测量） |
| `work/webview2/run-list.md` | 需批准/代跑的真实运行清单（现为“不批运行”记录） |
| `work/webview2/cef-hide.patch` | CEF 宿主去可见窗口补丁（去掉 WS_VISIBLE + 强制 SW_HIDE） |
| `cpp/hosts/webview2/launch-on-hidden-desktop.ps1` | CreateDesktop 独立桌面启动器（不动二进制即可隐藏） |

## 3. 三方对比

| 指标 | **WebView2 宿主（本方案）** | 精简 CEF 内核（task-12） | Electron 外壳（现状） |
| --- | --- | --- | --- |
| 应用自带内核字节 | **0** | 340,653,250 | 281,073,674 |
| 应用可执行文件 | **55,296 B** | 127,639 B（kernel-host.exe） | 188,784,128 B（inc_gui.exe） |
| 支撑文件 | loader 194,912 B + UI 201,906 B | — | app.asar/资源等 |
| 安装占用（不含共享运行时） | **452,114 B ≈ 0.43 MiB** | 340,780,889 B ≈ 325.0 MiB | 281,073,674 B ≈ 268.1 MiB |
| 安装占用（含共享运行时） | 903,021,261 B ≈ **861.2 MiB**（一次性、全机共享，非本应用独占） | —（自带内核） | —（自带内核） |
| 冷启动到首帧中位数（5 次） | **1162.6 ms**（宿主内 QPC → NavigationCompleted；5/5 通过，逐次样本见 §4） | **PENDING（受控窗口）**：kernel-host.exe 无视 SW_HIDE（§7） | **PENDING（受控窗口）**：未运行 |
| 首帧证据 | 1280x800 PNG（990–1008 色）+ DOM 探针 | task-12 已有可见窗口 DOM 证据 | — |

> 口径说明：WebView2 的“安装占用（含运行时）”不应算在本应用头上——运行时是全机共享、
> 由 Edge/其他应用安装的公共组件；应用新增占用就是 **0.43 MiB**。反过来，若目标机器没有运行时，
> 那么“应用+运行时”合计约 861.6 MiB，比自带内核的 CEF/Electron **更占空间**，这是本方案唯一的硬前提。

## 4. 冷启动测量

**方法**：`tools/bench.ps1` 连续 5 次启动 `webview2-host.exe`（隐藏窗口），宿主内部用
`QueryPerformanceCounter` 记录 `process start → NavigationCompleted`（首帧），每次写独立结果 JSON。
样本（ms）：

| # | env_ready | controller_ready | **nav_completed（首帧）** | total（含 hold 400ms + 截图） | wall（PowerShell 计时） | PNG |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 117.5 | 714.8 | 1204.1 | 1745.6 | 3368.1 | 148,602 B |
| 2 | 19.7 | 577.2 | 1039.1 | 1602.8 | 2637.6 | 148,618 B |
| 3 | 38.0 | 668.5 | 1162.6 | 1740.7 | 3036.4 | 148,858 B |
| 4 | 23.4 | 704.1 | 1154.0 | 1679.3 | 2815.0 | 148,111 B |
| 5 | 34.0 | 722.1 | 1320.1 | 1863.5 | 3323.6 | 148,602 B |
| **中位数** | 34.0 | 704.1 | **1162.6** | 1740.7 | 3036.4 | — |

- 5/5 `ok=true`、`exit=0`、无残留宿主进程（脚本每次结束都会按 profile 路径清理 `msedgewebview2.exe`）。
- 首次运行 env_ready 偏高（117.5ms）为磁盘冷读；之后稳定在 20–40ms。
- 主要耗时在 `controller_ready→nav_completed`（约 450–600ms），即 WebView2 进程启动 + 页面加载。

## 5. 证据链

1. **DOM 探针**（`bench/wv2-1.probe.json`）：
   `{"bridgeAtDocumentCreated":true,"hasShell":true,"hostForceParam":"1","hostInfoPayload":{"engine":"WebView2 Evergreen","host":"webview2","protocol":"infinity-shell/1","runtime":"154.0.4258.53","shell":"InfinityEdgeShell"},"htmlDataHost":"demo","localStorageOk":true,"readyState":"complete","shellFrames":["to-host:shell.activate-tab","to-host:shell.ready","to-host:shell.content-rect","to-host:shell.content-rect","to-shell:host.info"],"shellScriptLoaded":true,"tabCount":1,"theme":"dark","title":"Infinity Edge Shell","ua":"...Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0","webviewBridge":true}`
2. **宿主侧报文日志**：`shell.ready` payload 里外壳自报 `"host":"webview2"` → WebView2 通道被原生识别；
   宿主回 `host.info` 后 `hr=0x00000000`。
3. **首帧 PNG 像素统计**（node 解 PNG 静态分析，无进程启动）：5 张全部 1280x800、
   990–1008 种采样色、平均亮度 41.1；edge-ui 参考图 `shot-dark.png`（无头 Edge 截图）为 867 色、亮度 40.0 —— 同一量级，非空白、非错误页。
4. `--enable-logging` 不需要；全部证据在 `bench/` 下可复算（`tools/bench.ps1` + node 像素统计）。

## 6. 降级路径（代码已实现，验证待批准）

| 场景 | 触发 | 预期行为 |
| --- | --- | --- |
| 缺 loader | 目录内无 `WebView2Loader.dll` | stderr 说明 + result JSON `error`，**exit 5**，无弹窗 |
| 运行时缺失/损坏 | `CreateCoreWebView2EnvironmentWithOptions` 返回失败 | stderr 给 Evergreen 安装链接 + fixed-version 用法，**exit 20**，无弹窗 |
| 离线机 | 无网络且无运行时 | 随包分发 fixed-version（`--runtime=<dir>`），多 861 MiB 量级；Evergreen 首装必须联网 |
| 首帧超时 | `--timeout-ms` 到期 | 写 result JSON（`error=timeout`）后关窗退出 |

设计上刻意**不使用 MessageBox/系统对话框**（原实现有两处，已删除），失败信息只走 stderr + JSON。

## 7. 无窗口规则与本次暂停（如实记录）

- 生效规则：禁止任何可见窗口/弹窗；每个进程都要能隐藏并杀干净。已确认全机无我起的
  `kernel-host.exe` / `webview2-host.exe` / `inc_gui.exe` 进程（按名字 + 命令行全量核对）。
- **WebView2 宿主是隐藏安全的**：`ShowWindow(hwnd, SW_HIDE)` + 关闭 Chromium 遮挡节流，
  5 次运行截图均为真实内容，未上屏。
- **CEF 宿主不是隐藏安全的**（实测）：按规范用 `STARTF_USESHOWWINDOW + SW_HIDE` 启动
  `work/chromium-trim/host/kernel-host.exe` 后，脚本内 `IsWindowVisible` 探针仍观测到可见窗口
  （`visible_window_samples=4`），5 次运行均被脚本强杀（`exitCode=-1`、无 DOM 产出，`cef-bench.json`）。
  因此 CEF 冷启动数字**未取得**，且该 exe 在解除禁令前不应再运行；建议先给它打补丁（去掉
  `ShowWindow`/`CefWindowInfo` 可见性，或用独立桌面 `CreateDesktop`）再测。
- Electron 外壳我从未运行过，其冷启动数字缺失。
- **误杀更正与清理纪律（Lead 20:45 令）**：桌面刷屏并非 WebView2 宿主所为；用户浏览器的误杀由 Lead 侧批量清理造成，与本任务无关。此后本任务所有清理脚本一律改为“按完整命令行包含我方测试路径”精确匹配 PID：先打印完整命令行、再 `taskkill /T /F /PID`、并回写 PID 清单（`tools/run.ps1` 的 `cleanedPids` 字段、`tools/bench-cef.ps1` 的 `[cleanup]` 行）；
  **严禁**按 `chrome`/`msedge`/`msedgewebview2`/`explorer`/`SearchHost` 等进程名批量杀进程。
- **CEF 去可见窗口补丁（不执行，仅文本）**：`work/webview2/cef-hide.patch`
  以 `git apply` 方式去掉 `wi.style` 的 `WS_VISIBLE`、默认 `g_hidden=1`、创建后补 `ShowWindow(SW_HIDE)`；
  兜底方案 `cpp/hosts/webview2/launch-on-hidden-desktop.ps1` 用 `CreateDesktopW` + `STARTUPINFO.lpDesktop`
  把**未打补丁**的 exe 放到用户不可见桌面上运行。两者在解禁前均不得执行。

## 8. 风险与后续

1. **硬前提**：机器必须已装 WebView2 Evergreen。没有运行时的机器上，本方案比自带内核更占空间。
2. **版本漂移**：运行时随 Edge 自动更新；宿主用 `TargetCompatibleBrowserVersion` 返回已安装版本，
   并用 `get_BrowserVersionString` 记录实际版本（本次 154.0.4258.53）。
3. **file:// 限制**：`localStorage` 已验证可用，但 service worker / 部分 API 在 `file://` 下受限；
   后续建议用 `ICoreWebView2_3::SetVirtualHostNameToFolderMapping` 把 UI 映射到 `https://infinity.local`。
4. **提升权限**：宿主默认追加 `--do-not-de-elevate`（本机 shell 为 High Mandatory Level，
   CEF 侧曾因自动降权失败 exit 38）；WebView2 侧带该参数运行正常，去掉是否可行未测。
5. **edge-ui 探针歧义（发现，未修改他人文件）**：`work/edge-ui/index.html` 第 2 行硬编码
   `data-host="demo"`，而 `shell.js` 只更新内部 `host.kind`、从不回写该属性，导致
   `document.documentElement.dataset.host` 永远读作 demo（README 里“宿主检测结果放在 dataset.host”与实现不符）。
   真实宿主判定应取 `shell.ready` payload 的 `host` 字段（本次为 `webview2`）。
6. **未完成（受控）**：CEF/Electron 冷启动对照、两条降级路径的实跑。Lead 已批复 **CEF/Electron/WebView2 全部不批运行**，故对照表按 **PENDING(受控窗口)** 定稿，降级路径保持“代码就绪、未实跑”并已在 §6 注明；补丁与启动器文本见 §7 与 `run-list.md`。

## 9. 复现命令

```powershell
# 构建
powershell -NoProfile -ExecutionPolicy Bypass -File cpp\hosts\webview2\build.ps1

# 单次（隐藏窗口、跑完自退）
powershell -NoProfile -ExecutionPolicy Bypass -File work\webview2\tools\run.ps1 -Tag demo -HoldMs 900

# 冷启动 5 次（当前受禁，须先获 Lead 批准）
powershell -NoProfile -ExecutionPolicy Bypass -File work\webview2\tools\bench.ps1 -Runs 5 -HoldMs 400
```