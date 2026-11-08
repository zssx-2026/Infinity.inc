# InfinityPackageManager 性能优化报告（task-21）

- 产品：IPM（InfinityPackageManager，C++ 版，cpp/apps/ipm/main.cpp），UI 端口 7632
- 写作用域：InfinityPackageManager/、IPM Applications/、cpp/apps/ipm/、work/perf-ipm.md；经 Lead 单独授权新增 cpp/core/src/http.cpp（仅 gzip 一处）
- 时间：2026-10-04 18:43 – 20:45（Asia/Shanghai）
- 约束遵守：构建单 TU、未并发重构建；未启动任何可见窗口；--serve-ui 为无窗口隐藏启动并在 finally 内 Kill（leftover=0）；未改 web/、dist/、history/、别人的报告；未打印令牌

---

## 0. 结论（同口径 before/after）

| 指标 | 基线 B0 | 改动后 | 变化 |
|---|---|---|---|
| exe 字节数 | 648,704 | 658,944 | +10,240（+1.58%） |
| exe SHA-256 | BC33BA99800AF92FBD7F3C760E55C866EEC32E70C0509F6DEF500F07FD0D8DC1 | DAD2C9732D924C3F59010140DCAB13F35D81F070EDAC0A172F9DF268829EC6D1 | — |
| exe 构建时间 (UTC) | 2026-10-04T11:16:18Z | 2026-10-04T12:15:42Z | — |
| 冷启动 --version 中位（5 次） | 57 ms | 25 ms | 该路径未被改动，差异按机器状态噪声看待（见 §5） |
| catalog 目录加载中位（3 次） | 12,412 ms | 3,374 ms | 3.68× 更快 |
| --serve-ui 首次 HTTP 200 | 18,582 ms | 3,189 ms | 5.83× 更快（省 15.4 s） |
| /api/state 字节 | 91,420 | 90,614 | -0.9% |
| /api/search?q=windows-x64 | 20 ms / 668 B | 31 ms / 668 B | 波动，未优化此项 |
| 空闲 WS | 18.28 MB | 20.29 MB | +2.01 MB |
| 空闲 Private WS | 5.00 MB | 6.95 MB | +1.95 MB |
| 空闲 Private | 6.66 MB | 9.50 MB | +2.84 MB |
| 发行包（v1.0pre4 setup exe） | 278,021 B | 278,021 B（未重建，见 §7.2） | 0 |

目录加载 12.4 s 的分解（先分解后动手）：

| 阶段 | 基线（串行，无 gzip） | 仅并行（8 线程，无 gzip） | 仅 gzip（串行） | 并行 + gzip |
|---|---|---|---|---|
| listReleases（1 请求） | 5,465 / 6,395 ms | 5,699 / 8,309 ms | 864 / 1,245 ms | 1,535 / 1,036 ms |
| name.txt（8 请求） | 6,269 / 5,196 ms | 1,802 / 1,024 ms | 9,000 / 6,788 ms | 1,319 / 688 ms |
| 解析 assets+manifest（纯 CPU） | 1.0 / 1.1 ms | 1.6 / 1.0 ms | 0.8 / 1.2 ms | 0.7 / 0.5 ms |
| loadBuilds 合计 | 11,735 / 11,593 ms | 7,502 / 9,334 ms | 9,865 / 8,034 ms | 2,854 / 1,725 ms |
| catalog 进程墙钟 | 13,809 / 12,556 ms | 8,509 / 10,219 ms | 11,269 / 8,941 ms | 3,363 / 2,238 ms |

网络 ≈ 11.6 s（占 99.99%），磁盘 = 0（无本地缓存，每次启动全量重抓），CPU 解析 ≈ 1 ms（0.01%）。
这不是判断，是 --profile 实测；各列单独只改变一个变量（同一二进制 + IPM_CATALOG_WORKERS），因此可以归因。

---

## 1. 被测对象

| 项 | 值 |
|---|---|
| 源码 | cpp/apps/ipm/main.cpp、cpp/apps/ipm/ui.hpp（内嵌 HTML/CSS/JS） |
| 构建 | CMake + Ninja + MinGW-w64 UCRT（-O3 -DNDEBUG，-static -static-libgcc -static-libstdc++ -s） |
| 产物 | cpp/build/ipm.exe（648,704 → 658,944 B）；cpp/out/ipm/ipm_{cli,tui,gui,launcher}.exe 为同文件副本 |
| 发行包 | cpp/release/v1.0pre4/InfinityPackageManager_1.0.0-pre4_win64_setup.exe = 278,021 B（NSIS） |
| 目录数据 | 运行时来自 GitHub zssx-2026/applications 的 releases（10 个 release、219 个 asset、8 个 name.txt、208 个 build）。仓库内 dist/applist.json 属旧 Node 形态，未改 |
| 安装路径 | 下载 → SHA-256 校验（BCrypt）→ ShellExecuteW 打开安装包 |
| 回滚/解压 | 本产品没有解压代码、也没有回滚代码（grep 无 unzip/inflate/rollback；.zip 只出现在扩展名白名单）。回滚等价路径是校验失败时 DeleteFileW 删除临时/目标文件 |

IPM Applications/ 只有预编译产物（once_power Flutter 发行目录 + Piik/piik-app.exe 46,368,256 B），91 个文件 / 185,422,964 B，无任何源码或构建脚本（唯一的 js 是 flutter_avif_web 的预编译资源）——无法做代码级优化，本次未改动，只记录字节。

---

## 2. 基线与复测命令（原始输出）

测量脚本：InfinityPackageManager/perf/measure-ipm.ps1（隐藏启动、finally 内 Kill、报告 leftover 数）。
令牌：$env:EV_GH_TOKEN = [Environment]::GetEnvironmentVariable('EV_GH_TOKEN','User')（长度 93，全程未打印）。

    powershell -ExecutionPolicy Bypass -NoProfile -File InfinityPackageManager/perf/measure-ipm.ps1 -Exe cpp/build/ipm.exe -Tag "B0-pre-perf"

基线 B0 原始输出（二进制 648,704 B / BC33BA99… / 2026-10-04T11:16:18Z，含 rel-cpp-build 的 unblockSelf 改动）：

    tag               = B0-pre-unblock
    exe_bytes         = 648704
    exe_sha256        = BC33BA99800AF92FBD7F3C760E55C866EEC32E70C0509F6DEF500F07FD0D8DC1
    exe_built_utc     = 2026-10-04T11:16:18Z
    token_present     = True
    startup_ms_runs   = 222,61,54,57,55
    startup_ms_median = 57
    catalog_ms_runs   = 7506,12412,21099
    catalog_ms_median = 12412
    catalog_builds    = 208
    server_first_ok_ms = 18582
    process_exited     = False
    state_ms           = 110
    state_bytes        = 91420
    search_ms          = 20
    search_bytes       = 668
    idle_ws_mb         = 18.28
    idle_private_mb    = 6.66
    idle_private_ws_mb = 5
    done

改动后复测（二进制 658,944 B / DAD2C973… / 2026-10-04T12:15:42Z）：

    tag               = after-gzip+parallel
    exe_bytes         = 658944
    exe_sha256        = DAD2C9732D924C3F59010140DCAB13F35D81F070EDAC0A172F9DF268829EC6D1
    exe_built_utc     = 2026-10-04T12:15:42Z
    token_present     = True
    startup_ms_runs   = 43,26,19,25,25
    startup_ms_median = 25
    catalog_ms_runs   = 3374,4308,3067
    catalog_ms_median = 3374
    catalog_builds    = 208
    server_first_ok_ms = 3189
    process_exited     = False
    state_ms           = 201
    state_bytes        = 90614
    state_builds       = 206
    state_installable  = 30
    state_packages     = 206
    state_first_digest = sha256:19ab21d5a73f8691c63e44c5cc1f8435a8f0f46d7df2cdeff564f2c9a286275b
    search_ms          = 31
    search_bytes       = 668
    idle_ws_mb         = 20.29
    idle_private_mb    = 9.5
    idle_private_ws_mb = 6.95
    leftover_processes = 0
    done

目录加载分解命令与原始输出（同一二进制，仅 IPM_CATALOG_WORKERS 不同）：

    $env:EV_GH_TOKEN = [Environment]::GetEnvironmentVariable('EV_GH_TOKEN','User')
    $exe = (Resolve-Path 'cpp/build/ipm.exe').Path
    foreach ($w in @(1,8)) {
      $env:IPM_CATALOG_WORKERS = "$w"
      & $exe --profile catalog 2> "$env:TEMP\ipm-prof-$w.txt" | Out-Null
      Get-Content "$env:TEMP\ipm-prof-$w.txt"
    }

基线（未加 gzip，未并行）workers=1：

    ipm-profile  listReleases (1 request)              5465.1 ms   (run2: 6395.5)
    ipm-profile  name.txt (8 requests)                 6268.8 ms   (run2: 5196.2)
    ipm-profile  parse assets+manifest                    1.0 ms   (run2:    1.1)
    ipm-profile  loadBuilds total                     11734.9 ms   (run2: 11592.8)
    ipm-profile  http requests                              9
    ipm-profile  releases / manifests                      10
    ipm-profile  builds                                   208

并行后（未加 gzip）workers=8：

    ipm-profile  listReleases (1 request)              5698.7 ms   (run2: 8308.6)
    ipm-profile  name.txt (8 requests)                 1801.7 ms   (run2: 1024.3)
    ipm-profile  parse assets+manifest                    1.6 ms   (run2:    1.0)
    ipm-profile  loadBuilds total                      7502.0 ms   (run2: 9333.9)

gzip 后 workers=1（串行，用于隔离 gzip 效果）：

    ipm-profile  listReleases (1 request)               863.7 ms   (run2: 1245.3)
    ipm-profile  name.txt (8 requests)                 9000.2 ms   (run2: 6787.6)
    ipm-profile  parse assets+manifest                    0.8 ms   (run2:    1.2)
    ipm-profile  loadBuilds total                      9864.8 ms   (run2: 8034.1)

gzip 后 workers=8（最终形态）：

    ipm-profile  listReleases (1 request)              1534.5 ms   (run2: 1036.4)
    ipm-profile  name.txt (8 requests)                 1319.1 ms   (run2:  688.3)
    ipm-profile  parse assets+manifest                    0.7 ms   (run2:    0.5)
    ipm-profile  loadBuilds total                      2854.2 ms   (run2: 1725.1)
    ipm-profile  http requests                              9
    ipm-profile  releases / manifests                      10
    ipm-profile  builds                                   208

curl 对照（同机、同 URL、同 token，--ssl-no-revoke）：

    .../releases?per_page=100  http=200 size=352769 time=7.392 ttfb=0.928 speed=47720
    .../releases?per_page=100  http=200 size=352769 time=7.049 ttfb=0.700 speed=50045
    .../releases?per_page=10   http=200 size=352769 time=6.806 ttfb=0.516 speed=51835
    gzip                       http=200 size=29346  time=1.381 ttfb=1.379

即：TTFB 只有 0.5–0.93 s，慢的是下行体（352,769 B @ ~50 KB/s）；gzip 后 29,346 B / 1.38 s。响应构成：assets JSON ≈ 333,218 B、release body 合计 1,217 B、其余 ≈ 18 KB —— 慢的是 219 个 asset 的元数据，不是 changelog。

---

## 3. 改动清单（每处：位置、哈希、diff 摘要、隔离复测）

### 3.1 cpp/apps/ipm/main.cpp（SHA-256 28C48885E61F1262B1FC7887B442A01422B859FA71FDA1AC6D7F304F08EC09EA，+188 / -16）

(a) 目录抓取并行化 —— buildsForRelease 拆成 releaseAssets → ReleaseUnit → buildsFromUnit（纯解析，无网络）；loadBuilds 先收集 10 个 unit / 8 个 manifest，再用 parallelFor(kCatalogWorkers=8) 并发抓取，最后按原 release 顺序解析合并。parallelFor 用 CreateThread + InterlockedIncrement 工作队列（不引入 std::thread / pthread 依赖，保持 -static 链接口径），线程数不多于任务数。并发数可用 IPM_CATALOG_WORKERS 覆盖（用于复现旧顺序做对比，默认 8）。

隔离复测（同一二进制、仅 workers 1→8）：name.txt 8 个请求 6,269/5,196 ms → 1,802/1,024 ms（无 gzip 时）；gzip 下 9,000/6,788 ms → 1,319/688 ms。catalog 墙钟 13.8/12.6 s → 8.5/10.2 s（无 gzip 阶段）。

(b) Session::signIn 两请求并行 —— gh.me() 与 gh.verifyIdentity() 互不依赖，改为 parallelFor(2,2,...) 并发；错误顺序保持 me → verifyIdentity，未登录仍返回 1。CLI/GUI/serve-ui 三条路径共同受益。

(c) serveUi 启动顺序 —— 登录与目录加载并行（parallelFor(2,2,...)），服务器在两者都完成后 start()。语义不变：令牌缺失或登录失败仍打印原文并以 1 退出；目录失败仍由页面 summary.error 呈现。首字节从 18,582 ms 降到 3,189 ms。

(d) guiMain 窗口先于目录 —— catalog.refresh() 从"建窗口之前"移到 ShowWindow/UpdateWindow 之后，窗口先画出来（状态栏显示 loading the catalogue…），列表在加载完成后 refreshGui 填充。
证据等级说明：遵守"禁止可见窗口"规则，未对真窗口计时。该改动的机制是可测分量的算术：窗口可见时刻 = signIn 起算（旧：signIn + catalog = 约 12–19 s；新：signIn ≈ 0.5–0.8 s），两个分量都有 --profile 实测值。

(e) --profile 诊断 —— nowMs / profileMark / profileCount（QPC 计时，仅 stderr），在 loadBuilds 打 4 个阶段 + 3 个计数；--profile 从参数里剥离，不影响命令解析；help() 增一行。

### 3.2 cpp/core/src/http.cpp（gzip 主体：SHA-256 8ADDC9EB4ED725F08C045FB79A5F4619D91D9BB0585BD9A2C24C4D30272B4562 / 14,050 B，+18 / -0）

> 2026-10-05 追加两处守卫（Range 排除、WinHttpSetOption 返回值前提）后，本文件为 15,541 B / SHA-256 881EC2B3589FC86E7217D86B7757AF9A6F57F9E16F2B932F25984F7AD2F2F627，见 §7.2.1。

httpRequest 内，在 WinHttpOpenRequest 之后：

    DWORD decompression = WINHTTP_DECOMPRESSION_FLAG_ALL;
    WinHttpSetOption(req.h, WINHTTP_OPTION_DECOMPRESSION, &decompression, sizeof(decompression));
    ...
    if (!encodingRequested) headers += L"Accept-Encoding: gzip\r\n";

encodingRequested 会先扫描调用方自带的头避免重复；未改 httpDownloadFile（资产流式下载）与 httpUploadFile。

隔离复测（同二进制 workers=1，加 gzip 前/后）：listReleases 5,465/6,395 ms → 864/1,245 ms（约 5.4×）；loadBuilds 11.7/11.6 s → 9.9/8.0 s。批量 catalog 端到端：12,412 ms → 3,374 ms 中位。

### 3.3 新增（非产品代码）

| 文件 | SHA-256 | 作用 |
|---|---|---|
| cpp/apps/ipm/perf_probe.cpp | 7F35BB6629BD4A93D0F48079B20BFCF1BE12A7A32F432A73A5BAEA982A31E34D | 自计时探针：#define main ipm_product_main 后 #include "main.cpp"，可调用文件私有函数；手工 g++ 编译，不是 CMake 目标（CMakeLists 只收 apps/ipm/main.cpp） |
| InfinityPackageManager/perf/run-probe.ps1 | 377BC22B1A56362F6420BEA70F1EEE0ACE1A1CE0EFE912135F32C4422E700465 | 编译并运行探针 |
| InfinityPackageManager/perf/measure-ipm.ps1 | 90007EED13BBE3D650A51EECF478B3E88F022F480C39112DEAA56DBD3A7056BA | 端到端指标（隐藏启动、finally Kill、leftover 核对） |
| cpp/apps/ipm/ui.hpp | 42919491DC5D8341CDE8BAD04FEA6AE7BB94972997E0945E250184097C517511 | 未改动（列出以示未动） |

构建命令（单 TU，-j 2 口径）：

    ninja -C cpp/build -j 2 ipm

实际执行的两次构建各只编译 1 个 TU 再链接（[1/3] Building ... main.cpp.obj / [1/4] Building ... http.cpp.obj），无并发重构建。

---

## 4. 行为不变性验证（已实测）

| 检查 | 结果 |
|---|---|
| catalog 输出条数 | 208（与基线一致），首行内容一致（2BrightSparks.SyncBackFree_12.1.6.0 / application-001 / any / 41.0 MB / GitHub URL） |
| /api/state 摘要 | builds=206、installable=30、packages=206、首条 digest 为 sha256:19ab21d5…（非空，说明 gzip 解压与 digest 解析正常） |
| 安装/下载路径端到端 | ipm download 34u.MultiBaseCSBirdBase_5.4.7 any %TEMP%\ipm-test.zip → downloaded and verified 34u.MultiBaseCSBirdBase_5.4.7.zip；本地 SHA-256 032bcefb4302ec999f9dc08a49630231ab8c84b8353632217bdd702e695ff92e，与 API digest 校验通过（35,960 B 资产） |
| 登录失败语义 | 代码路径未改（me→verifyIdentity 错误顺序、返回 1、原错误串） |
| 进程残留 | leftover_processes = 0；复核 Get-Process ipm* = 0 |

说明：/api/state 有一次报 206 个 build 而 CLI 报 208，见 §7.2 风险项；30 个 installable 与 digest 解析正常，说明 gzip 改造本身没有破坏数据。

---

## 5. 冷启动数字的说明

--version 路径在改动前后完全一致（main 里只多了一次 unblock 扫描，两者相同），所以 57 → 25 ms 不是本次收益：基线的 5 次里第一次是 222 ms（冷缓存），随后 61/54/57/55；改动后是 43/26/19/25/25。两者都是 5 次中位，且测量时机不同（期间有其他成员的构建/网络活动）。不把这 32 ms 记为优化收益；冷启动的实测中位取 25 ms（改动后）。

真实启动收益在 --serve-ui（产品被 Electron 外壳启动的方式）：18,582 → 3,189 ms。

---

## 6. 换了但没有收益的尝试（已量化，全部未落地）

探针 perf_probe.cpp（g++ -O3，208 builds = 真实目录规模；参考实现与产品函数同进程同数据对比）。

探针第一版参考计时窗口写错（reference 计到空区间），修正后重测；下表只用修正后的数字。

| 尝试 | 探针实测（208 builds） | 判定 |
|---|---|---|
| sortBuilds 预计算小写键 + 索引排序 | 产品 0.343 ms，参考 0.216 ms（含索引排序与重建）→ 省 0.13 ms/次刷新 | 收益 <1 ms，不落地 |
| Catalog::matching 预计算小写 haystack | 产品 0.0385 ms/次，参考 0.0061 ms/次 → 省 0.032 ms/次搜索/按键 | 两次按键省 0.03 ms；/api/search 实测 20–31 ms（JSON 序列化 + HTTP 占绝大部分）→ 不落地 |
| sha256File 缓冲 64 KB → 256 KB / 1 MB（171 MB 文件） | 产品 64 KB：129.6 / 130.2 ms；参考 64 KB 126.0、256 KB 130.0、1 MB 130.5 ms | 无收益（已在 ~1.3 GB/s 磁盘/内存带宽上限）→ 不落地 |
| 用 GraphQL 替代 REST 列表 | releaseAssets 存在（assets 字段在 Release 上不存在）、无 databaseId；连同 url（含签名长串）一起取回时响应 216,655 B / 3.22 s，且有 1 个 release 的 hasNextPage=true 需分页 | 体积只降 39%、耗时降 57%，不如 gzip（29,346 B / 1.38 s），且需处理分页与 node-id → 不采用 |

2000 builds 的放大场景里 matching 是 0.41 ms/次、sortBuilds 4.25 ms——只有当目录规模扩大约 10 倍时才值得再动，本次按"无收益不留在代码里"处理。

---

## 7. 影响面与风险

### 7.1 gzip 改动的影响面（Lead 要求单列）

- 共用路径：cpp/core/src/http.cpp 的 httpRequest() 被 httpGetJson、httpPostJson 以及所有自建 GET 的调用点使用，因此 inc / ifm / iim / ipm / int / ing 六款产品的 GitHub 抓取全部走同一条路径（Cloud / FileManager 的 Node 形态不在此列）。
- 未改动：httpDownloadFile（安装包/资产流式下载）、httpUploadFile（上传）。理由：它们传输的是二进制资产不是文档；本次实测的下载+校验路径行为不变（见 §4）。
- 服务器不支持或忽略 Accept-Encoding: gzip 时：响应不带 Content-Encoding，WinHTTP 原样返回 → 行为与改动前完全一致（只多一个请求头）。
- 调用方已自带 Accept-Encoding 时不重复添加（先扫描 opts.headers）。
- 已知边界（必须跟进）：WINHTTP_OPTION_DECOMPRESSION 自 Windows 8.1 起可用。若某个更旧的系统上 WinHttpSetOption 返回 FALSE，当前代码仍会发送 Accept-Encoding: gzip，服务器可能返回 gzip 体而 WinHTTP 不解压 → JSON 解析失败（目录为空）。本机（Win11）实测解压正常，风险只存在于 8.1 以下系统。建议补丁（已于 2026-10-05 静态落地为“返回值前提”，见 §7.2.1；未编译验证）：

    const BOOL decompressionOk =
        WinHttpSetOption(req.h, WINHTTP_OPTION_DECOMPRESSION, &decompression, sizeof(decompression));
    ...
    if (!encodingRequested && decompressionOk) headers += L"Accept-Encoding: gzip\r\n";

### 7.1.1 静态审查：共用路径上的调用点（本次改动的影响面复核）

对 cpp/ 全量 grep 了 Content-Length / Content-Encoding / header() 的使用，并逐个判断 gzip 是否安全：

| 调用点 | 用法 | gzip 后的结论 |
|---|---|---|
| cpp/core/src/http.cpp readBody() | while + WinHttpQueryDataAvailable + WinHttpReadData，读到 0 字节为止（不依赖 Content-Length 分帧） | 安全：WinHTTP 在传输层透明解压，body 仍是原文；readBody 与分帧无关 |
| httpGetJson / httpPostJson（六款产品共用） | body 交给 Json::parse | 安全；IPM 端到端已验证（208 builds、digest 非空、下载校验通过） |
| cpp/apps/ipm fetchNameTxt | Accept: application/octet-stream，读 name.txt 文本 | 安全；文本更小，实测 8 个并行请求 1.3/0.7 s |
| cpp/apps/inc/preview.hpp:183-190 | 只按名字读响应头 | 与 body 分帧无关，安全 |
| cpp/core/src/uiserver.cpp:398 的 Content-Length | 是本地 HTTP **响应**头，与 httpRequest 无关 | 不受影响 |
| **cpp/apps/int/main.cpp:1209-1224（重要）** | 用同一 httpRequest 发 **Range: bytes=0-0** 探测，再按 Content-Range 分片并行下载 | **有交互风险**：若某个服务器对带 Range 的请求也返回 Content-Encoding: gzip，WinHTTP 解压后字节数与 Content-Range 的偏移语义不再对应，分片拼接会损坏文件。实践中 CDN 通常对 Range 请求忽略 Accept-Encoding（GitHub 资产走 release-assets CDN），但这条路径必须显式排除 |

因此的守卫（已于 2026-10-05 静态落地为“Range 排除”，见 §7.2.1；未编译验证）：

    bool encodingRequested = false;
    bool rangeRequested = false;
    for (const std::string& h : opts.headers) {
      const std::string l = lower(h);
      if (l.compare(0, 15, "accept-encoding") == 0) encodingRequested = true;
      if (l.compare(0, 6, "range:") == 0) rangeRequested = true;
    }
    if (!encodingRequested && !rangeRequested && decompressionOk) headers += L"Accept-Encoding: gzip\r\n";

影响面结论：本次 gzip 只应作用于"整份文档"的 GET/POST（JSON API 与 name.txt），不应作用于 Range 请求与二进制资产流。当前实现已排除二进制资产（httpDownloadFile/httpUploadFile 未改），并已于 2026-10-05 静态排除 Range 请求（§7.2.1）；剩下的未闭环项只是“未编译/未运行验证”，解冻后需优先回归 cpp/apps/int 的分片下载。

### 7.2 其他风险 / 回归

1. 一次观察到 208 → 206 个 build（/api/state 报 builds=206 / packages=206，同期 CLI 全部报 208；state_bytes 91,420 → 90,614，差 ≈ 2 条 × ~403 B）。最可能的解释：8 路并发抓 name.txt 时有一个请求瞬时失败，fetchNameTxt 返回空串触发既有的 fallback 推断，导致该 release 少 2 条且 installKind 为空（不可安装）。影响：目录条数与 installable 数会随网络瞬时失败波动。建议（未落地：二进制运行已冻结，无法验证）：失败的 manifest 顺序重取一次，或把并发降到 4。这是当前最需要跟进的一项。
2. 内存 +约 2 MB（Private WS 5.00 → 6.95 MB，WS 18.28 → 20.29 MB，n=1）：并行期线程栈与堆保留所致；换取 15.4 s 启动等待，可接受但需记账。
3. exe +10,240 B（+1.58%）：其中约 2–3 KB 来自 --profile 诊断代码；若只要最小体积，可裁掉 §3.1(e)。
4. 发行包字节未复测：NSIS 打包脚本（InfinityPackageManager/tools/make-setup.mjs、cpp/tools/package.mjs）与 cpp/release 不在写作用域，未重建；现有 v1.0pre4 setup 仍为 278,021 B。按 exe +1.58% 与 LZMA 压缩率推算，重打包后约 +3–5 KB。
5. 空闲内存、startup 的中位数为单次会话采样（网络/机器状态有波动）；catalog 取 3 次中位、profile 取 2 次。

---

### 7.2.1 两处守卫已静态落地（2026-10-05，未编译、未运行）

执行 Lead 令：把 §7.1 / §7.1.1 的两处守卫真正写进 cpp/core/src/http.cpp（本次唯一被改动的文件）。

| 项 | 值 |
|---|---|
| 文件 | cpp/core/src/http.cpp |
| 改动前 | 14,050 B，SHA-256 8ADDC9EB4ED725F08C045FB79A5F4619D91D9BB0585BD9A2C24C4D30272B4562（只含 gzip 主体） |
| 改动后 | 15,541 B，SHA-256 881EC2B3589FC86E7217D86B7757AF9A6F57F9E16F2B932F25984F7AD2F2F627 |
| 净增 | +1,491 B（其中约 1.1 KB 是说明性注释，代码净增约 15 行） |
| 验证级别 | 仅静态审查；未编译、未启动任何进程（运行与编译禁令生效中） |

diff 摘要（git diff --no-index，before → after）：

    -  DWORD decompression = WINHTTP_DECOMPRESSION_FLAG_ALL;
    -  WinHttpSetOption(req.h, WINHTTP_OPTION_DECOMPRESSION, &decompression, sizeof(decompression));
    +  bool encodingRequested = false;
    +  bool rangeRequested = false;
    +  for (const std::string& h : opts.headers) {
    +    const std::string lowered = lower(h);
    +    if (lowered.compare(0, 15, "accept-encoding") == 0) encodingRequested = true;
    +    if (lowered.compare(0, 6, "range:") == 0) rangeRequested = true;
    +  }
    +
    +  bool decompressionReady = false;
    +  if (!encodingRequested && !rangeRequested) {
    +    DWORD decompression = WINHTTP_DECOMPRESSION_FLAG_ALL;
    +    decompressionReady = WinHttpSetOption(req.h, WINHTTP_OPTION_DECOMPRESSION, &decompression,
    +                                          sizeof(decompression)) != FALSE;
    +  }
     ...
    -  if (!encodingRequested) headers += L"Accept-Encoding: gzip\r\n";
    +  if (decompressionReady) headers += L"Accept-Encoding: gzip\r\n";

要点：

1. Range 排除：调用方任一请求头以（不区分大小写）range: 开头时，既不调用 WinHttpSetOption，也不发 Accept-Encoding: gzip —— 两半一起放弃，避免出现“发了头但没解压”的状态。
2. 返回值前提：WinHttpSetOption 返回 FALSE（Windows 8.1 以下没有该选项）时不发头、不解压，回落到改动前的 identity 行为，不会出现“服务器回 gzip、本进程不解压”的解析失败。
3. “调用方自带 Accept-Encoding 时不重复添加”的原有语义保留（encodingRequested）。
4. 匹配从位置 0 开始的前缀比较，不会误命中自定义头（例如 X-Range: 不会触发）。

cpp/apps/int/main.cpp:1209 起的分片下载为何因此安全（推理）：

- int 的探测请求（main.cpp:1211，probe.headers.push_back("Range: bytes=0-0")）和每个分片请求（main.cpp:1250，options.headers.push_back("Range: bytes=" + offset + "-" + chunkEnd)）都把 Range 放进 RequestOptions::headers。RequestOptions 只有 method / headers / body / contentType / token / followRedirects / timeoutMs / insecure，headers 是 httpRequest 接受自定义头的唯一通道（已静态确认），所以这两类请求的 rangeRequested 必然为 true。
- 于是一个 gzip 头都不会发出，服务器只能以 identity 表示回 206；main.cpp:1224 用 Content-Range 解析出的 total 与实际写入文件的字节一一对应，分片偏移不会错位，拼接结果是原文件。
- 服务器忽略 Range 而直接回 200 的分支（main.cpp:1216-1220）同样不带 gzip 头，拿到的就是原始整份内容，writeWholeFile 写出的仍是原文件。
- 代价为零：这条路径在改动前也没有 gzip，int 的分片下载回到与改动前完全一致的线上行为；压缩只保留在 JSON/文本目录路径（httpGetJson / httpPostJson / name.txt）。
- 同一守卫顺带覆盖 cpp/apps/inc/preview.hpp:248 构造的 Range 预览请求。
- 残余限制（已记录在案）：守卫靠请求头前缀识别，若将来有调用方绕过 opts.headers 传 Range 就不会被识别；当前静态检查确认不存在该通道。cpp/apps/int/_bench/ 下的 main.cpp / main.cpp.before / main.perf.cpp 若被编译，走的也是同一个 httpRequest，同样受保护。

未闭环（解冻后必须做）：(a) 编译 cpp/core 与六款产品；(b) 复跑 IPM catalog / --serve-ui 指标，确认 gzip 仍生效且数字不退化；(c) 实跑一次 int 的分片下载，确认 206 + Content-Range 拼接正确（本次只做了静态推理，没有运行证据）。

## 8. 未完成 / 后续建议

1. 目录本地缓存 + ETag/If-None-Match：现在每次启动都全量重抓（磁盘缓存 = 0 ms 是因为根本没有缓存）。加一层 %LOCALAPPDATA% 缓存可把 3.4 s 降到毫秒级，但引入"陈旧目录"语义，需要产品决策（是否允许离线/陈旧展示、缓存有效期）。
2. 连接复用 / HTTP2：当前每个请求一次 WinHttpOpen + Connect + TLS 握手，9 个请求 9 次握手；name.txt 单请求并行后仍需 0.7–1.3 s，握手占相当比例。WinHTTP 可用 WinHttpSetOption(WINHTTP_OPTION_ENABLE_HTTP_PROTOCOL, ...) + 会话复用。属"更大范围重构"，按 Lead 要求只写建议。
3. §7.2.1 的 manifest 重取（并发稳健性）。
4. §7.1 的 decompressionOk 守卫与 §7.1.1 的 Range 守卫：已静态落地（§7.2.1），待解冻后编译+回归验证。
5. 若目录规模增长到数千条，再做 §6 的 matching/sort 预计算（现在无收益）。

---

## 9. 附：探针原始输出（保留供复核）

修正计时后（208 builds / 200 轮 / 171 MB 文件）：

    sortBuilds                   product_ms=    0.343  reference_ms=    0.216  speedup= 1.59x  rows=208
      (reference includes the index sort AND rebuilding 208 builds)
    Catalog::matching (warm x rounds) product_ms=    7.693  reference_ms=    1.222  speedup= 6.30x  rows=48
      per call: product=0.0385 ms  reference=0.0061 ms  over 208 builds (200 rounds)
    sha256File (product) r0       ms=  613.649  digest=62bb219139f79481  error=
    sha256File (product) r1       ms=  129.577  digest=62bb219139f79481  error=
    sha256File (product) r2       ms=  130.242  digest=62bb219139f79481  error=
    sha256File reference buf=  65536 ms=  125.986  digest=62bb219139f79481
    sha256File reference buf= 262144 ms=  130.038  digest=62bb219139f79481
    sha256File reference buf=1048576 ms=  130.480  digest=62bb219139f79481

2000 builds 放大场景（第一版探针，参考计时有 bug，仅产品侧数字可用）：

    sortBuilds                   product_ms=    4.252  rows=2000
    Catalog::matching (warm x rounds) product_ms=   82.461  rows=464   → 0.41 ms/call

---

## 10. 交付物哈希清单

    cpp/apps/ipm/main.cpp              28C48885E61F1262B1FC7887B442A01422B859FA71FDA1AC6D7F304F08EC09EA
    cpp/apps/ipm/perf_probe.cpp        7F35BB6629BD4A93D0F48079B20BFCF1BE12A7A32F432A73A5BAEA982A31E34D
    cpp/apps/ipm/ui.hpp                42919491DC5D8341CDE8BAD04FEA6AE7BB94972997E0945E250184097C517511   (未改)
    cpp/core/src/http.cpp             881EC2B3589FC86E7217D86B7757AF9A6F57F9E16F2B932F25984F7AD2F2F627   15,541 B  (含 §7.2.1 守卫)
    cpp/core/src/http.cpp (gzip 主体)   8ADDC9EB4ED725F08C045FB79A5F4619D91D9BB0585BD9A2C24C4D30272B4562   14,050 B  (历史)
    InfinityPackageManager/perf/measure-ipm.ps1  90007EED13BBE3D650A51EECF478B3E88F022F480C39112DEAA56DBD3A7056BA
    InfinityPackageManager/perf/run-probe.ps1    377BC22B1A56362F6420BEA70F1EEE0ACE1A1CE0EFE912135F32C4422E700465
    cpp/build/ipm.exe (交付二进制)     DAD2C9732D924C3F59010140DCAB13F35D81F070EDAC0A172F9DF268829EC6D1   658,944 B  2026-10-04T12:15:42Z
    cpp/build/ipm.exe (基线二进制)     BC33BA99800AF92FBD7F3C760E55C866EEC32E70C0509F6DEF500F07FD0D8DC1   648,704 B  2026-10-04T11:16:18Z
