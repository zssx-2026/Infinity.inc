# work/perf-ing.md — Infinity Games（ING）性能报告

产品：Infinity Games（C++ / MinGW 静态构建，UI 端口 7664，Electron 外壳经 --serve-ui 取页面）
任务：task-24。写作用域：cpp/apps/ing/**、work/perf-ing.md。
状态：**代码改动已完成并通过静态验证；after 实测数字 PENDING（运行禁令，见 work/run-queue/prod-ing-task24.md）。**
基线（本次所有测量的对照二进制）：
- cpp/build/ing.exe，606,720 B，mtime 2026-10-04 19:16:19，sha256(前16) DE3189FFD3264D51
- 该二进制含第三方并发改动 inc::unblockSelf() + inc::unblockSelfDirectory(2)（19:10:42 写入 cpp/apps/ing/main.cpp，19:16:19 重建）。Lead 已确认以此作为基线。
- 基线副本（供受控窗口做交替 A/B）：cpp/apps/ing/perf/artifacts/ing-baseline-2026-10-04T1916.exe（606,720 B，sha256 DE3189FFD3264D51）
- 改动后源码：cpp/apps/ing/main.cpp，49,940 B，sha256(前16) 948A8B4852570045，mtime 2026-10-04 20:39:32

---

## 0. 结论摘要

| # | 瓶颈（有证据） | 量级 | 改动 |
| --- | --- | --- | --- |
| B1 | 每次 loadLibrary 重新解析 1.5 MB JSON；一页加载（/api/state + /api/games）解析同两份 | parse 62.2 ms/次 @10000 条；一页 2 次 | C2 库缓存（mtime+size 作为键） |
| B2 | 排序比较器每次比较分配两个小写副本 | sort 24.0 ms/次 @10000 条 | C1 无分配大小写折叠比较 |
| B3 | /api/games 先建 Json 树再 dump：每行被复制两次（含各自 map） | build+dump 113.7 ms/次 @10000 条；响应 2,323,299 B | C3 直接序列化 + 紧凑输出 |
| B4 | 启动时同步遍历 exe 目录 2 层清 Zone.Identifier | +53 ms/次启动（3,001 文件目录；空目录 0） | C4 延迟到 UI 就绪后、后台线程、24h 标记 |

三处内存/CPU 瓶颈都在“游戏列表扫描”路径上，扩展性为线性（无 O(n²)）。启动路径的真凶不是游戏目录扫描（ING 自身不做游戏目录 enumerate，见 §2.4），而是 19:10 引入的 unblock 目录清扫。

---

## 1. 测量方法与环境

### 1.1 指标定义

- **冷启动耗时**：每个样本都是一个全新进程（ProcessStartInfo，UseShellExecute=false，CreateNoWindow=true，stdout/stderr 重定向）。先跑 1 次丢弃作为预热（文件缓存），再取 5 次 **中位数**。
  - CLI 面：进程创建 → 进程退出（含 stdout 重定向读取）。
  - 窗口面：进程创建 → 127.0.0.1:port 首次返回 HTTP 响应（见 1.3 为什么不能用 stdout 启动行）。
- **空闲驻留内存**：Win32_PerfFormattedData_PerfProc_Process 的 WorkingSetPrivate（即 Private Working Set），在最后一次请求后静置 800 ms 采样，5 次取中位数。
- **UI 首帧**：进程创建 → 页面启动时需要的 5 个资源（/、/app.css、/app.js、/api/state、/api/games）全部返回的总时间；各路由时间为 curl 自己的 time_total。
- **exe 字节**：文件长度。**发行包字节**：cpp/release 下 v1.0pre4 安装包文件长度。

### 1.2 环境与噪声声明

- 本机同时有其它产品智能体在构建/测量（内存紧张），因此同一二进制的重复测量存在 ±10~20 ms 级抖动；所有结论都取中位数，并且只比较同一时间窗内测得的数字。
- 测量脚本全部在 cpp/apps/ing/perf/ 下，可复现：
  - `bench.ps1`：CLI 面与窗口面指标（--version / list / info / run / --serve-ui）
  - `dirwalk.ps1`：unblockSelfDirectory 目录清扫的启动成本
  - `unblock-evidence.ps1`：延迟清扫后“6/6 流消失 + 24h 标记”的证据脚本
  - `check-static.mjs`：不依赖编译器的结构/契约静态检查

### 1.3 三个测量陷阱（先说清，避免误读历史数字）

1. **同端口复用**：杀掉上一个监听者后 ~500 ms 内重新绑定同一端口，环回 connect 会被内核压住，把启动时间虚高成 515 ms。改用“每次新端口”后，真实 listen 中位数 42~50 ms。
2. **PowerShell 的 Invoke-WebRequest** 每次调用自带 20~350 ms 开销（首个请求最贵），会把小路由（/app.css 等）测成几十毫秒。改用 `curl.exe -w '%{time_total}'` 后，静态资源真实为 1.2~1.8 ms。
3. **stdout 缓冲**：`--serve-ui` 的启动行用 fwrite 写入，stdout 是管道时被 C 运行时缓冲到退出，读不到；因此窗口面启动以“端口首次响应”为准。

### 1.4 复现命令

`@powershell
# 生成 N 条游戏的合成库到隔离的 LOCALAPPDATA，然后测窗口面指标
powershell -NoProfile -File cpp/apps/ing/perf/bench.ps1 -Exe cpp/build/ing.exe -DataRoot "$env:TEMP\ing-bench-worker" -Scenario serve -Count 10000 -Reps 5
# CLI 面
powershell -NoProfile -File cpp/apps/ing/perf/bench.ps1 -Exe cpp/build/ing.exe -DataRoot "$env:TEMP\ing-bench-worker" -Scenario list -Count 10000 -Reps 5
# 启动目录清扫成本
powershell -NoProfile -File cpp/apps/ing/perf/dirwalk.ps1 -Exe cpp/build/ing.exe -Reps 5 -TopFiles 2000 -SubDirs 100 -FilesPerSub 10
`@

---

## 2. 基线数字与瓶颈证据

### 2.1 基线指标表（before）

窗口面（二进制 19:16 / 606,720 B；medians）：

| N（库内游戏数） | listen ms | UI 首帧 ms | /api/games ms | /api/state ms | /api/games 字节 | 空闲 PWS MB |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 41.85 | 224.41 | 1.68 | 1.98 | 17 | 0.914 |
| 500 | 49.62 | 283.09 | 16.53 | 11.39 | 115,964 | 1.809 |
| 2000 | 47.06 | 354.71 | 63.81 | 34.32 | 464,321 | 1.820 |
| 10000 | 41.92 | 717.43 | 342.16 | 176.45 | 2,323,299 | 2.113 |

静态资源（同一 harness，路由中位数）：/ = 1,694 B / 1.28 ms；/app.css = 2,961 B / 1.40 ms；/app.js = 5,675 B / 1.50 ms。静态资源与库规模无关 → 首帧增长全部来自两个 JSON 接口。

CLI 面（二进制 16:56 / 601,088 B，测于 19:02–19:15；unblock 目录清扫对 cpp/build 这种小目录影响 <1 ms，故与窗口面可比）：

| 命令 | N | 中位数 ms | 样本 ms |
| --- | --- | --- | --- |
| --version | – | 16.41 | 15.54, 16.41, 16.55, 14.99, 16.47 |
| list | 0 | 13.41 | 12.21, 14.64, 13.41, 14.34, 12.35 |
| list | 500 | 17.41 | 16.81, 17.41, 16.97, 17.52, 17.86 |
| list | 2000 | 34.41 | 34.41, 34.50, 34.42, 32.90, 33.82 |
| list | 10000 | 126.15 | 118.73, 131.97, 121.01, 126.15, 128.80 |
| info game-0001 | 2000 | 28.21 | 28.21, 28.56, 26.80, 27.17, 28.39 |
| run game-0007（文件已丢，exit 1） | 2000 | 26.89 | 26.89, 26.88, 25.86, 32.90, 27.24 |

产物字节：

| 产物 | 字节 | sha256(前16) |
| --- | --- | --- |
| cpp/build/ing.exe（基线，19:16） | 606,720 | DE3189FFD3264D51 |
| InfinityGames_1.0.0-pre4_win64_setup.exe | 262,882 | 96F0EB3E4E97044A |

原始输出（节选，bench.ps1 的 JSON 行）：

`@
{"scenario":"serve","libraryBytes":305916,"listenMedianMs":47.06,"firstFrameMedianMs":354.71,"privateWorkingSetIdleMedianMB":1.82,"routeMedianMs":{"/api/games":63.81,"/":1.1,"/api/state":34.32,"/app.js":1.26,"/app.css":1.17},"routeBytes":{"/":1694,"/app.js":5675,"/api/games":464321,"/api/state":264,"/app.css":2961}}
{"scenario":"serve","libraryBytes":1530378,"listenMedianMs":41.92,"firstFrameMedianMs":717.43,"privateWorkingSetIdleMedianMB":2.113,"routeMedianMs":{"/api/games":342.16,"/":1.21,"/api/state":176.45,"/app.js":1.24,"/app.css":1.54},"routeBytes":{"/":1694,"/app.js":5675,"/api/games":2323299,"/api/state":266,"/app.css":2961}}
{"scenario":"list","libraryBytes":1530378,"args":"list","samplesMs":[118.73,131.97,121.01,126.15,128.8],"medianMs":126.15,"minMs":118.73,"exitCode":0}
`@

### 2.2 相位自计时（找瓶颈，不猜）

方法：把 cpp/apps/ing/main.cpp 复制到 %TEMP%\ing-probe\main_instr.cpp，注入 QueryPerformanceCounter 计时（只测 read / parse / sort / present / gamesJson 构建+dump），用与 ninja 相同的编译参数与库构建，运行新增的 `--bench-phases`，不进仓库、不改产品构建。

`@powershell
& $gxx -Icpp/core/include -Icpp/common -O3 -DNDEBUG -std=c++17 -static -static-libgcc -static-libstdc++ -s "$tmp\main_instr.cpp" -o "$tmp\ing_instr.exe" cpp/build/libinc_core.a cpp/build/libinc_common.a -lwinhttp -lbcrypt -lshell32 -lcomctl32 -lws2_32
$env:LOCALAPPDATA="$env:TEMP\ing-bench-worker\LocalAppData"; $env:ING_BENCH_REPS='3'; "$tmp\ing_instr.exe" --bench-phases
`@

原始输出（N=10000，3 次调用，其中 loadLibrary 共被调用 9 次 = 3 显式 + gamesJson 3 + stateJson 3）：

`@
load[0] total=106.35 games=10000
load[1] total=122.93 games=10000
load[2] total=126.16 games=10000
gamesJson[0] total=295.12 bytes=2323299
gamesJson[1] total=303.71 bytes=2323299
gamesJson[2] total=263.21 bytes=2323299
stateJson[0] total=149.43 bytes=266
stateJson[1] total=166.58 bytes=266
stateJson[2] total=169.55 bytes=266
phase read=25.64 parse=560.10 sort=216.21 present=307.48 calls=48000 jsonbuild+dump=341.00
`@

N=2000 同一探针：`read=7.44 parse=116.19 sort=10.39 present=59.33 calls=9600 jsonbuild+dump=69.23`

归一到“一次调用 / 一页加载”：

| 相位 | @10000 每次 | @2000 每次 | 一页加载（/api/state + /api/games）@10000 |
| --- | --- | --- | --- |
| readTextFile | 2.85 ms | 0.83 ms | 5.7 ms |
| Json::parse | 62.23 ms | 12.91 ms | 124.5 ms（两次） |
| sort（含 lower 分配） | 24.02 ms | 1.15 ms | 48.0 ms（两次） |
| fileExists（present） | 6.41 µs/次 | 6.18 µs/次 | 103 ms（16,000 次） |
| gamesJson 构建 + dump(2) | 113.67 ms | 23.08 ms | 113.7 ms（一次） |

相位合计约 395 ms，占实测一页接口时间（342+176=518 ms）的 76%，其余为响应写出/环回传输/框架开销。

### 2.3 扩展性是线性的，不是 O(n²)

/api/games 从 0 → 500 → 2,000 → 10,000：1.68 → 16.53 → 63.81 → 342.16 ms，约 0.034 ms/条；/api/state 约 0.0175 ms/条。没有隐藏的二次项；瓶颈就是“每条游戏做一次解析/排序/存在性检查/序列化”。

### 2.4 启动瓶颈：unblockSelfDirectory(2)

背景：19:10 后所有程序的 main() 第一句调用 inc::unblockSelf() 与 inc::unblockSelfDirectory(2)。后者（cpp/common/unblock.cpp，只读参考）会 FindFirstFile 遍历 exe 所在目录**两层**，对 .exe/.dll/.pak/.dat/.json/.txt 逐个 DeleteFileW "<path>:Zone.Identifier"。

证据 1（dirwalk.ps1，同一二进制，--version 中位数 5 次）：

| 目录内容 | --version 中位数 ms | 样本 |
| --- | --- | --- |
| 仅 ing.exe（空目录） | 13.71 | 13.71, 13.12, 14.29, 13.16, 14.00 |
| 3,001 个文件（含 100 个子目录×10，全部在 2 层内）首次 | 101.91 | 101.91 |
| 同上，稳定态（流已清） | 89.30 | 92.56, 92.61, 88.90, 89.30, 77.38 |
| 回到空目录 | 14.61 | 13.57, 17.78, 14.61, 16.78, 14.11 |

证据 2（A/B 变体构建：full = unblockSelf+unblockSelfDirectory(2)；selfonly = 只 unblockSelf；none = 都不调用；--version，中位数 3 次，同一目录）：

| 变体 | 空目录 ms | 3,001 文件目录 ms |
| --- | --- | --- |
| full（现状/基线） | 29.24 | 89.08 |
| selfonly | 31.71 | 36.09 |
| none | 47.71 | 38.24 |

结论：3,001 文件目录里 **unblockSelfDirectory(2) 每次启动约 +53 ms**（89.08 − 36.09）；unblockSelf() 本身 <1 ms（selfonly ≈ none）。空目录三行有 ±18 ms 噪声，说明空目录下该调用无成本；成本只看目录规模。

补充：游戏库目录（%LOCALAPPDATA%\Infinity.Inc\games）**不是**被遍历的对象，unblock 只遍历 exe 自身所在目录；ING 代码里没有任何游戏目录 enumerate（全仓 grep FindFirstFile 命中 int/iim/core，未命中 apps/ing）。因此“游戏目录 enumerate 卡”在 ING 上的真实形态是：exe 所在目录（例如便携包解压目录，动辄数千文件）越大，启动越慢。

---

## 3. 改动（一次一处，全部在 cpp/apps/ing/main.cpp）

### C1 排序：不再为每次比较分配两个小写副本

- 位置：loadLibrary 的 std::sort 比较器。
- before：`return lower(a.name) < lower(b.name);`（每次比较 2 次 std::string 分配，@10000 约 2.2 万次比较）。
- after：新增 `foldAscii(char)` 与 `compareFolded(a,b)`，逐字节折叠比较，零分配；排序结果与旧实现逐字节等价（先折叠后按字节序，等长再比长度）。
- 证据：§2.2 sort 24.0 ms/次。

### C2 库缓存：按（路径, 大小, 最后写入时间）复用解析结果

- 位置：loadLibrary。新增 `struct LibraryCache` + `libraryCache()`（std::mutex 保护，服务器单线程也不依赖它）。
- 语义：仍然“以磁盘为准”——每次都先取 stamp（GetFileAttributesExW，微秒级）；stamp 变化（手改、别的进程执行 `ing add`）必然重读。只有完全没变的文件才复用。这样 /api/state 与 /api/games 在同一页加载里只解析一次，后续请求（刷新、Run 之后）也免解析。
- 代价：解析结果常驻（@10000 约 1.5 MB 级），PWS 预计上升，列入待测（run-queue 判定标准里写了上限）。
- 证据：§2.2 parse 62.2 ms + sort 24.0 ms + read 2.9 ms，一页省一次。

### C3 /api/games 直接序列化，字段与顺序不变

- 位置：删除 `gameRowJson`（Json 树），新增 `appendJsonString`，gamesJson 直接写入 std::string 并按 `games.size()*160+64` 预留。
- before：每行 Json 先 push 进 rows（拷贝），再把 rows 拷进 root（深拷贝，含每行自己的 map），最后 dump(2)。
- after：一次写入；字段顺序 name,kind,addedAt,lastPlayed,(host,ready,url|reason | path,ready) 与旧树一致，error 仍在最后且仅在非空时出现（check-static.mjs 断言了顺序：name,kind,addedAt,lastPlayed,host,ready,url,reason,path,ready,error）。
- 附带：输出由 2 空格缩进变为紧凑，@10000 响应 2,323,299 B → 预计约 1.5 MB（同一数据）；前端 fetch().json() 解析结果不变。
- 证据：§2.2 build+dump 113.7 ms/次。

### C4 unblock 目录清扫：延迟到 UI 就绪后、后台线程、24 小时一次（本地标记）

Lead 决定（20:45 批复）后实现，全部落在 cpp/apps/ing/main.cpp；cpp/common/** 只读调用，未改。

- `unblockSelf()` **保持同步**、仍在 main() 第一句：一次 DeleteFileW，成本 <1 ms，且它是“被标记的 exe 能启动”的关键。
- `unblockSelfDirectory(2)` 从 main() 移除，唯一调用点移入 `folderUnblockIfDue()`，在 serveUi() 里 `server.start()` 成功之后才起线程：
  - 主线程只做一次 `folderUnblockDue()`（一次 GetFileAttributesExW）判断，未到期就不创建线程。
  - 线程内先 `Sleep(1500)`（跨过首帧），再清扫，再写标记；线程可 join，serveUi 返回前 join，进程退出不会被半截清理撕裂。
- 标记：`<exe目录>\.infinity-unblocked`，内容为 UTC 时间戳（YYYY-MM-DDThh:mm:ssZ）。24 小时内同目录不再扫；标记写入在清扫**之后**，因此清扫失败（如权限）下次启动会重试，不会“跳过一整天”。
- 时钟回拨：标记时间在未来时视为到期，宁可多扫一次。
- 语义变化（必须明说）：CLI 面（ing list/info/run/add/remove）**不再**做目录清扫；只有窗口（--serve-ui / gui）会在当天第一次启动后清扫。对 ING 来说这是安全的：ING 是完全静态单文件程序，不从 exe 目录加载任何 .dll/.pak/.dat/.json/.txt，目录清扫对 ING 的功能价值仅剩“清兄弟文件”这一形式；真正影响能否启动的 unblockSelf() 保留。
- 线程安全：清扫线程只调用 unblockSelfDirectory（纯 Win32 文件 API），不触碰库缓存、不触碰 UI 状态；服务器 accept 循环仍是单线程。
- 证据：§2.4；24h 行为与“6/6 流消失”的实测见 run-queue 的 unblock-evidence.ps1。

diff 摘要（工作树 vs HEAD，含第三方 unblock hunk）：`cpp/apps/ing/main.cpp | 308 ++++++++++++++++++ 261 insertions(+), 47 deletions(-)`
我这次改动的 hunks：includes(+2)、fileExists 之后 helpers(+27)、loadLibrary 重写、gameRowJson/gamesJson 重写、serveUi(+8)、main() 前导(+4)；第三方 hunks：`#include "unblock.hpp"`、`inc::unblockSelf()/unblockSelfDirectory(2)`（后者已被 C4 移动）。

### 3.1 静态验证（无编译器，禁令下可做的最大验证）

`@powershell
node cpp/apps/ing/perf/check-static.mjs cpp/apps/ing/main.cpp
`@

结果：**24/24 通过**，其中包含用真实 C++ 词法分析（注释/字符串/字符/raw string 状态机）算出的花括号/圆括号/方括号平衡（final 0, min 0）。对照组：`git show HEAD:cpp/apps/ing/main.cpp` 同样平衡（0/0），说明检查器本身不产生假的“平衡”。

`@
  ok   braces balanced (final 0, min 0)
  ok   parens balanced (final 0, min 0)
  ok   brackets balanced (final 0, min 0)
  ok   include <mutex> / include <thread>
  ok   compareFolded / fileStamp / LibraryCache / appendJsonString
  ok   deferred unblock thread in serveUi; the deferred thread is joined
  ok   marker file name; 24 hour interval; unblockSelf stays synchronous
  ok   the startup directory walk is gone from main(); the Json row tree is gone
  ok   cache keyed on size and last-write time; rows reserved; response buffer reserved
  ok   exactly one unblockSelfDirectory(2) call site; the walk runs on the deferred path and only then writes the marker
  ok   gamesJson key order matches the tree it replaced (name,kind,addedAt,lastPlayed,host,ready,url,reason,path,ready,error)
all static checks passed (24)
`@

静态检查**不能**替代的东西：语法/链接的最终判定、行为回归、after 数字。这三项见 run-queue。

---

## 4. 预期收益（由 §2 相位数据推导，**未实测，标注 PENDING**）

计算依据（@10000）：一页 = 2×loadLibrary(2.85+62.23+24.02=89.1) + 16,000×6.41µs + gamesJson(113.67) ≈ 395 ms。
- C2 让第二次 loadLibrary 变成 stamp + 向量拷贝（预估 3~8 ms）→ 省约 82~86 ms
- C1 让 sort 24.0 → 预估 3~5 ms（只作用于剩下那一次解析）→ 再省约 19~21 ms
- C3 让 gamesJson 构建+dump 113.7 → 预估 40~55 ms（去掉两次深拷贝，仅一次线性写出）→ 省约 60~75 ms；响应字节预估 −35%（2.32 MB → ~1.5 MB）
- C4 让启动不再同步扫目录：3,001 文件目录 --version 89.3 → 预期 ~36 ms（selfonly 的实测值）；cpp/build 这种小目录 <1 ms

| 指标 @10000 | before（实测） | after（PENDING，预估区间） |
| --- | --- | --- |
| /api/games ms | 342.16 | 150~200 |
| /api/state ms | 176.45 | 85~115 |
| UI 首帧 ms | 717.43 | 430~520 |
| /api/games 字节 | 2,323,299 | ~1,500,000 |
| 空闲 PWS MB | 2.113 | 2.4~3.2（缓存常驻换延迟，需实测确认） |
| --version（3,001 文件目录）ms | 89.30 | ~36 |
| exe 字节 | 606,720 | 待构建（预期 +3~6 KB：多出的代码与字符串） |

发行包字节：cpp/tools/package.mjs 不在我的写作用域，未重打包；安装包内含 ing.exe，exe 的增量会直接反映到包体上（+3~6 KB 量级）。

---

## 5. 没有采纳 / 无收益的尝试（数字与理由）

| 尝试 | 结论 | 依据 |
| --- | --- | --- |
| 把 fileExists 并行化（4 线程扫 16,000 次） | **未采纳**，先不做 | 单一改动的收益上限约 103→30 ms，但会给“accept 循环单线程”的服务器引入线程池、异常/退出语义；当前 profile 已足够（C1~C3 覆盖更大头）。若 after 实测仍不达标，再作为候选，届时提供 before/after。 |
| 给 present 结果加 TTL 备忘缓存 | **未采纳** | 会把“文件是否存在”变成有界陈旧（哪怕 1 s），违反“关键行为不变”；收益（省一次扫描）与 C2 重叠。 |
| 只把 dump(2) 改 dump(0) | **并入 C3** | 单独改会保留 Json 树与两次深拷贝，只省缩进字节；C3 同时解决两者。 |
| 改变响应字段/去掉字段 | **不做** | 前端契约，字段与顺序保持不变（check-static 断言）。 |
| 把游戏库目录也纳入“可见性缓存” | **不做** | 语义：库文件 stamp 已保证一致性；游戏文件存在性必须每请求真查。 |

已修正的测量错误（记录以免重犯）：同端口复用导致的 515 ms 假启动时间；Invoke-WebRequest 的 20~350 ms 每请求开销；stdout 管道缓冲读不到启动行；Test-Port 对关闭端口 connect 约 2 s 才失败。这些都已在上文替换为 curl/新端口。

---

## 6. 风险与未完成

风险：
1. C3 改变了 /api/games 的**空白**（缩进），JSON 值不变。前端为程序内置页面，字段/顺序已静态断言；但若有外部消费者按缩进 diff，会看到差异 —— 需在受控窗口用真实 /api/games 响应做一次 JSON 解析回归（run-queue §5）。
2. C2 使解析结果常驻：PWS 会升；run-queue §5 给了上限判定（@10000 ≤ 3.5 MB，超过则视为不通过并回滚 C2）。
3. C4 后 CLI 面不再清扫目录（见 §3 C4 的语义说明）；如果 Lead 要求 CLI 也保持清扫，可在 CLI 出口加“一次性、超时上限”清扫，但这会把 +53 ms 带回启动路径，不建议。
4. 两个 ING 实例同时首启会有标记竞争（都扫一次），结果正确、只是重复一次 I/O。
5. 未编译：语法/链接的最终判定必须由受控窗口的构建完成（静态检查覆盖结构与契约，不覆盖编译）。

未完成（全部在 work/run-queue/prod-ing-task24.md，等受控窗口）：
- ninja 构建 ing（基线二进制已备份，便于交替 A/B）
- after 全量指标复测（CLI + 窗口面 + 内存）
- unblock 证据：6/6 流消失、标记内容、24h 内不重复扫、回拨 2 天后重扫
- 行为回归：/api/games JSON 解析、Run 路径、run 失败路径 exit 1
- 发行包字节（可选，需 package.mjs，不在作用域）

---

## 7. 文件清单

| 文件 | 作用 |
| --- | --- |
| cpp/apps/ing/main.cpp | 唯一产品改动（C1~C4），sha256(前16) 948A8B4852570045 |
| cpp/apps/ing/perf/bench.ps1 | 指标 harness |
| cpp/apps/ing/perf/dirwalk.ps1 | unblock 目录清扫启动成本 |
| cpp/apps/ing/perf/unblock-evidence.ps1 | 延迟清扫/24h 标记证据 |
| cpp/apps/ing/perf/check-static.mjs | 静态结构与契约检查 |
| cpp/apps/ing/perf/artifacts/ing-baseline-2026-10-04T1916.exe | 基线二进制备份（606,720 B） |
| work/run-queue/prod-ing-task24.md | 受控窗口执行单 |
