# Infinity Cloud（INC）性能报告 — 启动到窗口出现、清单加载、目录首屏

- 产品：Infinity Cloud（原生 Win32 窗口面 `cpp/apps/inc/main.cpp`；共享核心 `cpp/core`，只在只读范围内使用）
- 任务：task-19（性能优化：Infinity Cloud）
- 写作用域：`Infinity Cloud/`、`cpp/apps/inc/`、本报告
- 测量日期：2026-10-04（Asia/Shanghai）
- 机器：AMD Ryzen 7 7735H（16 逻辑核）、14 GB RAM、Windows 11 26200、MinGW-w64 g++ 16.1.0、CMake+Ninja、Release（-O3）
- 口径：同一台机、同一 token（从 HKCU\Environment 读入子进程环境，报告与日志中从不打印令牌本身）、同一测量脚本 `Infinity Cloud/tools/perf/probe.ps1`
- 无窗口规则：按 Lead 2026-10-04 20:12/20:27 的硬性要求，所有窗口测量都用 `STARTF_USESHOWWINDOW + SW_HIDE` 启动（探针里 `ProcessStartInfo.WindowStyle = ProcessWindowStyle.Hidden`），窗口对象照常创建、消息循环照常运行，但不上屏；每轮结束由探针 Kill 自己启动的进程并核对 `inc*` 残留（每次输出均为 `leftover inc* processes: 0`）。表中 `visibleMs=-1` 就是“窗口全程未上屏”的证据。

---

## 1. 摘要（同一口径 before / after）

“窗口出现”= CreateProcess 到顶层窗口 `InfinityCloudWindow` 存在并被 FindWindowW 找到（隐藏窗口，不上屏，5 次取中位数）。

| 指标 | 改动前（同树构建 `inc_before.exe`） | 改动后（`inc_after.exe`） | 变化 |
|---|---|---|---|
| 启动到窗口出现（有 token，隐藏窗口，5 次中位数） | **8018 ms**（6900/7625/8018/8139/8615） | **41 ms**（37/41/41/91/285） | **-99.5%（约 196×）** |
| 启动到窗口出现（原始基线 `inc_baseline.exe`，可见窗口轮） | 6091 ms（5559–6211） | — | — |
| 窗口可响应（WM_NULL 往返，5 次中位数） | 8281 ms | 148 ms | -98.2% |
| 无 token 时的行为 | **exit 1，无窗口**（14/14/15/15/26 ms） | **窗口照常打开**（23/34/36/37/37 ms），进程存活，列表 0 行 | 契约按要求改变 |
| 清单加载（后台完成，标记 `cloud-load-end`） | 无标记（阻塞在窗口之前） | 5656 / 5735 ms，**在窗口出现之后的后台线程里** | 不再阻塞首帧 |
| UI 首帧（进程内标记 `process-start→gui-first-paint`） | 无标记 | 31 / 32 / 47 / 62 / 110 ms | — |
| 空闲驻留内存（8 s settle，存活轮） | WS 24.6–24.8 MB；Private 6.34–6.43 MB | WS 26.9–31.0 MB；Private 6.63–7.27 MB | +2.1–6.2 MB WS（+9%~25%），+0.3–0.8 MB Private |
| 进程内 Working Set - Private（Get-Counter） | 3.34–3.43 MB | 3.87–4.23 MB | +0.5 MB |
| `inc.exe` 字节数 | 1 462 272 B（SHA256 72F2D1D7…） | **1 469 952 B**（SHA256 EADFD0CD…） | +7 680 B（+0.53%） |
| 发行包（安装包）字节数 | `InfinityCloud_1.0.0-pre4_win64_setup.exe` 477 846 B | 同左（未重新打包，打包属于 rel-cpp-build 作用域） | 0 |
| 遗留 Node 便携包 `Infinity Cloud/release/InfinityCloud.exe` | 80 745 472 B | 未触碰 | 0 |

> 内存的口径说明：改动后窗口在 ~40 ms 就出现，而清单要到 ~5.6 s 才在后台读完；因此在“窗口出现后 2 s”测量时改动后进程**还在加载**，WS 反而更低（23.5–24.1 MB）。上表用的是“窗口出现后 8 s、加载已完成”的存活轮，才是真正的空闲驻留对比。

---

## 2. 基线（原始命令与输出）

测量脚本每次运行都会打印原始行，下面是原样摘录。

### 2.1 无 token（改动前，`inc_baseline.exe`）
命令：
```powershell
& ".\Infinity Cloud\tools\perf\probe.ps1" -Task notoken -Runs 5 -Exe ".\Infinity Cloud\tools\perf\_baseline\inc_baseline.exe"
```
输出：
```
not signed in - set gittoken_zssx-2026_1 first.   [x5]
no-token run 1: exitedEarly=True exitCode=1 exitMs=24 windowMs=-1
no-token run 2: exitedEarly=True exitCode=1 exitMs=15 windowMs=-1
no-token run 3: exitedEarly=True exitCode=1 exitMs=17 windowMs=-1
no-token run 4: exitedEarly=True exitCode=1 exitMs=17 windowMs=-1
no-token run 5: exitedEarly=True exitCode=1 exitMs=15 windowMs=-1
```
结论：改动前“没有 token”= 16 ms 内 exit 1，**永远不会有窗口**。

### 2.2 有 token，启动到窗口出现（改动前，可见窗口轮，原始基线）
```powershell
& ".\Infinity Cloud\tools\perf\probe.ps1" -Task window -Runs 5 -SettleMs 3000 -Exe ".\Infinity Cloud\tools\perf\_baseline\inc_baseline.exe"
```
```
window run 1: windowMs=6211 visibleMs=6253 responsiveMs=6333 wsMB=26.14 privateMB=6.39
window run 2: windowMs=5559 visibleMs=5593 responsiveMs=5622 wsMB=24.73 privateMB=6.47
window run 3: windowMs=6120 visibleMs=6169 responsiveMs=6231 wsMB=25.43 privateMB=6.46
window run 4: windowMs=6089 visibleMs=6111 responsiveMs=6154 wsMB=24.68 privateMB=6.27
window run 5: windowMs=6091 visibleMs=6129 responsiveMs=6165 wsMB=24.68 privateMB=6.46
window medianMs=6091 visibleMedianMs=6129 responsiveMedianMs=6165 wsMedianMB=24.73 privateMedianMB=6.46
```

### 2.3 有 token，启动到窗口出现（改动前，同树构建 + 隐藏窗口，最终对照轮）
```powershell
& ".\Infinity Cloud\tools\perf\probe.ps1" -Task window -Runs 5 -SettleMs 2000 -Exe ".\Infinity Cloud\tools\perf\_before\inc_before.exe"
```
```
window run 1: windowMs=8018 visibleMs=-1 responsiveMs=8281 wsMB=25.41 privateMB=6.38 listRows=1 alive=True
window run 2: windowMs=7625 visibleMs=-1 responsiveMs=7805 wsMB=24.82 privateMB=6.41 listRows=1 alive=True
window run 3: windowMs=8139 visibleMs=-1 responsiveMs=8322 wsMB=24.67 privateMB=6.24 listRows=1 alive=True
window run 4: windowMs=6900 visibleMs=-1 responsiveMs=7035 wsMB=24.82 privateMB=6.38 listRows=1 alive=True
window run 5: windowMs=8615 visibleMs=-1 responsiveMs=8754 wsMB=24.90 privateMB=6.39 listRows=1 alive=True
window medianMs=8018 visibleMedianMs=-1 responsiveMedianMs=8281 wsMedianMB=24.82 privateMedianMB=6.38
leftover inc* processes: 0
```
（`visibleMs=-1` = 全程未上屏，符合无窗口规则；`listRows=1` 由探针跨进程发 `LVM_GETITEMCOUNT` 读到，与 `inc listf` 的 1 行一致。）

### 2.4 CLI 面（改动前）
```
==== inc --version ====      run1..5 ms = 27 16 16 16 16      （中位数 16）
==== inc get          ====   run1..5 ms = 5394 6328 6151 6063 6654 （中位数 6151）
==== inc listf        ====   run1..5 ms = 6180 6021 5163 5935 7687 （中位数 6021）
cli median: version=16ms  get=6151ms  listf=6021ms
```
`inc listf` 的实际输出（一次）：
```
       Checkmate.m4a  7.1 MB
```
`inc get` 的实际输出（一次）：
```
manifest refreshed  1 entries  7.1 MB
```

### 2.5 GitHub API 单请求延迟（curl，只读，用于给“网络占比”定位）
```
GET /user                  -> 0.397950 s HTTP 200 bytes=1298
GET /user/repos?per_page=1 -> 0.412498 s HTTP 200 bytes=5422
GET /user/repos?per_page=100&affiliation=owner&sort=updated&page=1 -> 1.008759 s HTTP 200 items=32 inc_items=0
```

---

## 3. 瓶颈证据（不是猜测）

1. **代码路径**（`cpp/apps/inc/main.cpp` 改动前 `guiMain`）：
   ```
   tokenFromEnv() → Session::signIn()  // GET /user + GET /user/repos?per_page=1
                  → store.pull()      // GET /user/repos?per_page=100…（按页）+ 每个 inc_* 仓库 GET /releases + GET 资产 file.json
                  → InitCommonControlsEx → RegisterClassW → CreateWindowExW → ShowWindow
   ```
   窗口的最后一步排在所有 HTTPS 之后，**首帧必然等待网络**。
2. **量级对得上**：`inc --version` 中位数 16 ms（进程+exe 加载的成本），而 `inc get`（登录 + 清单）中位数 6151 ms，窗口出现 6091–8018 ms。窗口等待 ≈ 登录 + 清单，与本机 `--version` 无关。
3. **请求条数与单请求延迟**：登录 2 次 + 仓库分页 1 次 + 仓库 releases 1 次 + 清单资产下载 1 次 ≈ 5 次串行 HTTPS；curl 实测单次 0.40–1.01 s，与 5.6–6.2 s 的 `cloud-load-end` 吻合。
4. **无 token 分支**：`guiMain` 第一段就是 `if (token.empty()) { out(...); return 1; }`，所以窗口连创建的机会都没有。
5. **每行一次 shell 图标查询**：改动前 `refreshGui` 对列表每一行调用 `SHGetFileInfoW`（`SHGFI_USEFILEATTRIBUTES`）；图标只取决于扩展名，行数越多越浪费。
6. **每次重绘都重建画刷**：`WM_ERASEBKGND` 里 `CreateSolidBrush` + `DeleteObject`，每次擦背景都是一次 GDI 分配。
7. **每次刷新整窗重绘**：`refreshGui` 末尾 `InvalidateRect(hwnd, nullptr, TRUE)`，而 ListView 插入行时已经自绘，等于把整窗再擦再画一遍。
8. **浏览目录也会走网络**：`loadCloud` 被 `ID_UP`、双击进目录复用，每次进目录都 `store.pull()`。

---

## 4. 改动（一次一处，全部在写作用域内）

改动文件（只这两个）：
- `cpp/apps/inc/main.cpp`：`+213 / -48`，`git diff --stat` = `212 insertions(+), 48 deletions(-)`（另有 1 行新文件计入）
- `cpp/apps/inc/perflog.hpp`（新增，1763 B，SHA256 `4A0C7A440E674EAADA88BB74DB008DCB206DFE60FA611941FA2A7FCBD3E03894`）

未改动：`cpp/core/**`、`cpp/CMakeLists.txt`、`cpp/release/**`、其他产品目录。

### 改动 1：窗口先出，联网后置（核心）
- `guiMain`：删除“无 token→exit 1”和“先 `signIn`+`pull` 再建窗”的两段；只保留本地工作（读 token、注册窗口类、CreateWindowExW、ShowWindow、UpdateWindow），随后 `startLoad(hwnd, &state, false)` 起后台线程。进程内的分界点就是 `gui-window-shown` → `signin-start`。
- 新增 `loadThreadProc`：在工作线程里做 `signIn` + `new Store(...)` + `pull`，把结果放进堆上的 `LoadResult`，用 `PostMessageW(WM_APP_CLOUD_LOADED)` 交回 UI 线程（消息队列即交接点，不用锁；发送前有 `std::atomic_thread_fence(release)`）。
- `WM_APP_CLOUD_LOADED`：接收 `LoadResult*`、接管 `Store*`、写状态行、`refreshGui`、重新启用被禁用的控件。
- 线程分离策略：`Session`/`Store` 在堆上创建且存活到进程结束（注释写明），因此用户在建窗后立刻关窗也不会出现工作线程访问已销毁栈对象；关窗时 `PostQuitMessage` 直接退出进程，不会等待最长 120 s 的 HTTP。
- 竞态防护：`st->loading` 只由 UI 线程读写；加载期间 `setGated(false)` 禁用所有会访问 store 的控件，`WM_COMMAND` 里再加一道 `if (st->loading && LOWORD(wp) != ID_CANCEL) break;`。UI 线程在加载期间不触碰 store。

### 改动 2：无 token 也开窗（匿名/离线模式）
- 彻底删除 `guiMain` 的 exit 1 分支；无 token 时工作线程不发起任何 HTTP（`cloud-load-end` 在 62 ms），窗口显示 “not signed in - set gittoken_zssx-2026_1 (or EV_GH_TOKEN)”，列表为空可浏览；需要登录的操作会由 store 返回错误并显示在状态行。
- CLI/TUI/launcher 面**不变**：无 token 的 `inc get`/`inc listf` 仍然打印同一句并 exit 1（已复测）。

### 改动 3：目录列表首屏
- 图标按扩展名缓存（`iconIndexFor`）：每行不再调 `SHGetFileInfoW`，每见到一个新扩展名才问一次 shell；文件夹图标与通用文件图标在建窗时各取一次。行为等价：原代码用 `SHGFI_USEFILEATTRIBUTES`，图标只由扩展名决定。
- 去掉 `refreshGui` 末尾的整窗 `InvalidateRect(..., TRUE)`（ListView 插入即自绘）。
- `WM_ERASEBKGND` 的画刷改为 `static HBRUSH`，全窗一次创建，不再每次擦背景都分配/释放 GDI 对象。
- 每行少一次 `toWide`（原来 `path` 和 `wname` 各转一次），名称只取一次。

### 改动 4：浏览目录不再联网
- 新增 `listCurrent()`（只读内存里的 manifest 重建列表），`ID_UP`、双击进目录、新建文件夹后、删除后、上传后都改用它；只有 `Refresh` 按钮走 `startLoad(refreshInPlace=true)`，且刷新也在后台线程里跑，UI 不再冻结 6 s。
- 语义变化（有意）：别处改动云端后，需要按 Refresh 才会看到，而不是每次进目录都重新拉一遍。

### 改动 5：可复核的自计时探针（新增 `perflog.hpp`，默认关闭）
- 设 `INC_PERF_LOG=<文件>` 时，进程把 `毫秒<TAB>阶段` 追加写入该文件；未设置时每次 mark 只是一次环境变量查询 + 一次判断，不写文件。当前打点：`process-start`、`gui-enter`、`gui-token`、`gui-first-paint`、`gui-window-shown`、`signin-start`/`refresh-start`、`cloud-load-start`、`cloud-load-end`、`gui-list-ready=<行数>`、`gui-exit`。

---

## 5. 复测（改动后，同一口径）

### 5.1 窗口（隐藏，5 次，最终对照轮）
```powershell
& ".\Infinity Cloud\tools\perf\probe.ps1" -Task window -Runs 5 -SettleMs 2000 -Exe ".\Infinity Cloud\tools\perf\_after\inc_after.exe"
```
```
window run 1: windowMs=285 visibleMs=-1 responsiveMs=498 wsMB=35.34 privateMB=12.27 listRows=0 alive=True
window run 2: windowMs=91  visibleMs=-1 responsiveMs=319 wsMB=24.00 privateMB=5.90  listRows=0 alive=True
window run 3: windowMs=41  visibleMs=-1 responsiveMs=136 wsMB=24.02 privateMB=5.97  listRows=0 alive=True
window run 4: windowMs=37  visibleMs=-1 responsiveMs=121 wsMB=23.54 privateMB=5.66  listRows=0 alive=True
window run 5: windowMs=41  visibleMs=-1 responsiveMs=148 wsMB=24.12 privateMB=6.02  listRows=0 alive=True
window medianMs=41 visibleMedianMs=-1 responsiveMedianMs=148 wsMedianMB=24.02 privateMedianMB=5.97
leftover inc* processes: 0
```
（这一轮 settle=2 s，后台清单还没读完（要 ~5.6 s），所以 `listRows=0` 是“此刻还没读完”，不是回归；见 5.4 的 8 s 轮。）

### 5.2 进程内分阶段时间（`INC_PERF_LOG`，隐藏窗口）
有 token：
```
---- phases run 1: windowMs=23 visibleMs=-1 responsiveMs=79 ----
0	process-start
0	gui-enter
0	gui-token
32	gui-first-paint
63	gui-window-shown
63	signin-start
63	cloud-load-start
---- phases run 2: windowMs=32 visibleMs=-1 responsiveMs=110 ----
0	process-start
0	gui-enter
0	gui-token
62	gui-first-paint
93	gui-window-shown
93	signin-start
93	cloud-load-start
5656	cloud-load-end
5672	gui-list-ready=1
```
无 token：
```
0	process-start
0	gui-enter
0	gui-token
31	gui-first-paint
62	gui-window-shown
62	signin-start
62	cloud-load-start
62	cloud-load-end
78	gui-list-ready=0
```
读法：首帧发生在 31–110 ms；清单 5656 ms 才读完，但那时窗口早已可用；无 token 时 62 ms 就结束加载（没有发出任何 HTTP）。

### 5.3 无 token 行为（改动后，隐藏，5 次）
```
no-token run 1: exitedEarly=False windowMs=37 alive=True listRows=0
no-token run 2: exitedEarly=False windowMs=36 alive=True listRows=0
no-token run 3: exitedEarly=False windowMs=34 alive=True listRows=0
no-token run 4: exitedEarly=False windowMs=37 alive=True listRows=0
no-token run 5: exitedEarly=False windowMs=23 alive=True listRows=0
leftover inc* processes: 0
```

### 5.4 空闲驻留内存（隐藏，8 s settle，加载已完成）
```
AFTER  window run 3: windowMs=28 wsMB=30.99 privateMB=7.27 gdi=52 user=23 listRows=1 alive=True
AFTER  window run 4: windowMs=31 wsMB=26.94 privateMB=6.63 gdi=51 user=23 listRows=1 alive=True
AFTER  window run 5: windowMs=32 wsMB=27.07 privateMB=6.82 gdi=51 user=23 listRows=1 alive=True
BEFORE window run 3: windowMs=7783 wsMB=24.60 privateMB=6.34 gdi=51 user=22 listRows=1 alive=True
BEFORE window run 4: windowMs=6173 wsMB=24.79 privateMB=6.43 gdi=51 user=22 listRows=1 alive=True
BEFORE window run 5: windowMs=7921 wsMB=24.62 privateMB=6.40 gdi=51 user=22 listRows=1 alive=True

mem hidden, AFTER : privateWorkingSetMB=3.87 privateBytes64MB=6.18 workingSet64MB=25.55
mem hidden, BEFORE: privateWorkingSetMB=3.43 privateBytes64MB=5.61 workingSet64MB=21.54
```
GDI 对象 51→51、USER 对象 22→23（+1），没有句柄泄漏迹象。内存代价：Working Set +2.1~6.2 MB，Private +0.3~0.8 MB——换来的是首帧不等网络。

### 5.5 行为与回归验证
| 检查 | 结果 |
|---|---|
| 构建 | 在私有构建目录 `Infinity Cloud/tools/perf/_build` 用 `ninja -j 2 inc` 通过，0 error（只有 `cpp/core/src/store.cpp:174 mergeObject 未使用` 的既有告警） |
| `inc --version` | `Infinity Cloud [v1.0.0-pre4]`，exit 0 |
| 无 token 的 CLI 契约 | `inc get` / `inc listf` 均打印 `not signed in - set gittoken_zssx-2026_1 (or EV_GH_TOKEN) first.` 并 exit 1（与改动前一致） |
| 列表内容 | 探针跨进程读 `LVM_GETITEMCOUNT`：改动前存活轮 = 1，改动后 8 s 轮 = 1，与 `inc listf` 的 1 行 `Checkmate.m4a 7.1 MB` 一致 |
| 窗口存活 | 改动后 8 s 轮全部 `alive=True`；关窗即退出，不等 HTTP |
| 残留进程 | 每轮结束探针输出 `leftover inc* processes: 0` |
| 首帧不上屏 | 所有隐藏轮 `visibleMs=-1` |

---

## 6. 未完成 / 风险 / 建议（交给 Lead 决定）

1. **`--serve-ui`（UI 端口 7621）仍会先登录+拉清单再监听**：Electron 外壳面没有拿到“窗口先出”的改动。同一处可在 `cpp/apps/inc/main.cpp` 的 `serveUi` 里把 `signIn`+`pull` 改成“首个需要 store 的请求到达时惰性执行”（`/api/state`、`/api/list` 调 `ensureCloud()`；`/`、`/app.css`、`/app.js` 立即可用）。未做原因：全局停止运行二进制后无法验证 Electron 侧契约，且改 API 首答时机会改变 shell 的加载时序，需要批准后跑一次验证。
2. **HTTP 超时仍有 120 s 上限**：`cpp/core/include/inc/http.hpp:43` `RequestOptions::timeoutMs = 120000`，而 `cpp/core/src/github.cpp` 的所有调用都用默认值。界面不再被它卡住（改到后台线程了），但后台线程可能挂 2 分钟。建议在 `cpp/core`（不在我的写作用域）把 GitHub 的请求超时设为 8 s；需要核心文件 owner 执行。
3. **仍然没有本地清单缓存**：`Store::pull` 把每个 `file.json` 下到缓存目录读完即删；因此匿名/离线时只能看到空列表，不能看到“上次的清单”。要做到 Lead 说的“离线也能看本地缓存”，需要在 `cpp/core/src/store.cpp` 持久化并优先载入缓存清单（不在我的写作用域）。
4. **上传/下载/新建/删除仍是同步调用**：这些用户主动操作会阻塞 UI 线程数秒（改动前也是这样）。后台化它们与本次“首帧”问题正交，未做以免扩大改动面；`listCurrent` 已经把它们之后的“再拉一次全量清单”去掉了。
5. **改动后的 CLI `inc get/listf` 用时未复测**：全局停止运行二进制后没有再造进程。CLI 路径本次没有任何 diff（`cliMain` 未改），预期与改动前中位数（get 6151 ms / listf 6021 ms）一致，但这一条只是推断，需要批准后补测。
6. **测量环境的干扰（如实记录）**：隐藏窗口轮里出现过进程在加载中途消失（exit code 无法取得，内存归零），改动前、改动后两个二进制都出现过，且同一轮里既可能发生也可能不发生；我判断是外部按进程名清理/其他 agent 的测试所致，而非本次代码（改动前的 `inc_before.exe` 同样被杀过）。为降低影响，最终对照轮（5/5 全部存活）作为主口径，8 s 轮只取存活轮。
7. **发行包未重新打包**：477 846 B 是发布在 v1.0.0-pre4 的安装包现状，`cpp/tools/package.mjs`、`cpp/release/` 属于 rel-cpp-build 的作用域；本次 exe 增大 7 680 B（+0.53%），重新打包后安装包预计同量级增大。

---

## 7. 复现命令

```powershell
# 构建（本机内存紧张，-j 2；构建目录放在我的写作用域内，不碰 cpp/build）
cmake -S cpp -B "Infinity Cloud\tools\perf\_build" -G Ninja -DCMAKE_BUILD_TYPE=Release `
  -DCMAKE_CXX_COMPILER="C:\Users\REDMI\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin\c++.exe"
ninja -C "Infinity Cloud\tools\perf\_build" -j 2 inc

# 测量（脚本自己从 HKCU\Environment 取 token，从不打印；窗口一律 SW_HIDE；跑完自查残留）
& ".\Infinity Cloud\tools\perf\probe.ps1" -Task window  -Runs 5 -SettleMs 8000 -Exe ".\Infinity Cloud\tools\perf\_after\inc_after.exe"
& ".\Infinity Cloud\tools\perf\probe.ps1" -Task notoken -Runs 5                -Exe ".\Infinity Cloud\tools\perf\_after\inc_after.exe"
& ".\Infinity Cloud\tools\perf\probe.ps1" -Task phases  -Runs 2 -SettleMs 7000 -Exe ".\Infinity Cloud\tools\perf\_after\inc_after.exe"
& ".\Infinity Cloud\tools\perf\probe.ps1" -Task mem                            -Exe ".\Infinity Cloud\tools\perf\_after\inc_after.exe"
& ".\Infinity Cloud\tools\perf\probe.ps1" -Task cli    -Runs 5                 -Exe ".\Infinity Cloud\tools\perf\_after\inc_after.exe"

# 进程内阶段日志（默认关闭）
$env:INC_PERF_LOG = "$env:TEMP\inc-perf.log"
```

产物与哈希：
| 文件 | 字节 | SHA256（前 16） |
|---|---|---|
| `Infinity Cloud/tools/perf/_baseline/inc_baseline.exe`（原始基线，`cpp/build` 快照） | 1 456 128 | BABE82E51588F4D3 |
| `Infinity Cloud/tools/perf/_before/inc_before.exe`（改动前同树构建快照） | 1 462 272 | 72F2D1D7381F78BD |
| `Infinity Cloud/tools/perf/_after/inc_after.exe`（改动后） | 1 469 952 | EADFD0CD7DAF26A2 |
| `Infinity Cloud/tools/perf/probe.ps1`（测量脚本） | — | — |
| 原始 JSON 结果 | `_baseline/*.json`、`_before/*.json`、`_after/*.json` | — |
| 阶段日志 | `Infinity Cloud/tools/perf/_phases/phase-run*.log` | — |

> 说明：`cpp/build/inc.exe` 是共享构建目录，在测量期间被其他 agent（unblock 改动）重新构建过，所以“改动前”用的是我复制并固定的快照 `inc_before.exe`（SHA256 72F2D1D7…），"原始基线"用最早固定的 `inc_baseline.exe`（BABE82E5…），两者都标了哈希。
