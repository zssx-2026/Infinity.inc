# Infinity File Manager 性能报告（task-20）

作者：prod-ifm（性能智能体）· 写作用域：`Infinity File Manager/`、`cpp/apps/ifm/`、`work/perf-ifm.md`
仓库：`zssx-2026/Infinity-File-Manager`（只读参考）· 日期：2026-10-04

## 0. 一句话结论

5400 项目录的**首屏可交互列表**从 364 ms（安静机）/ 612 ms（忙机）降到 13–20 ms / 28–55 ms，**降 90–95%**；首屏字节从 1,248,119 B 降到 637,978 B（**-48.9%**）。
**完整元数据（大小/修改时间）的总耗时没有变**——逐文件 stat 的工作量没变，只是从首屏关键路径上挪走了。
剩下最大的杠杆不在代码里：产品 ship 的 **node v22.11.0 每次 stat 约 58 µs，是 node v24.19.0（6.1 µs）的 9.6 倍**，而系统 API 本身只要约 8 µs。

## 1. 环境与方法

| 项 | 值 |
|---|---|
| 机器 | Windows，14,021 MB RAM（测量期间空闲仅约 1.27 GB，其他产品在并行构建） |
| 产品 runtime | node **v22.11.0**（`D:/temp/tools/runtimes/win-x64/node-v22.11.0-win-x64/node.exe`，SHA256 7447C4EC…230D，与 SEA 注入用的一致） |
| 对照 runtime | node **v24.19.0**（系统 `D:\program\nodejs\node.exe`） |
| 测试目录 A | `D:/temp/ifm-bench/big` = 5,400 条目（5,200 文件 + 200 目录），实测 `readdir` 返回 5400 |
| 测试目录 B | `C:/temp/ifm-bench/cbig` = 5,200 文件（无子目录，另一卷） |
| 对照目录 C | `C:/Windows/System32` = 4,915 条目（真实系统目录） |
| 无窗口规则 | 全部测量走 `--serve-ui` 回环 HTTP，`spawn(..., {windowsHide:true})` / `Start-Process -WindowStyle Hidden`，从不 `openBrowser`，每个进程在 finally / Stop-Process 结束 |

测量口径：

* **冷启动**：进程从启动到退出，`--version`，丢弃 1 次预热后 5 次取中位数；对照用 **A/B 交替**（A、B、A、B…各 9 次）取中位数，抵消负载漂移。
* **驻留内存**：`Win32_PerfFormattedData_PerfProc_Process` 的 `WorkingSetPrivate`（Private Working Set）、`PrivateBytes`、`WorkingSet`，进程起来 3 s 后取 3 次平均。
* **列目录**：从本机回环 HTTP `GET` 计时（TTFB 与 total），另用同进程直调 `listDir()` 分离「处理」与「传输」。
* **首帧**：本机无浏览器（硬性无窗口），以**「lite 列表响应完成」**作为「页面可以画出全部行」的代理指标；没有真 paint 数字，见 §7。
* 忙机/安静机差异很大（同一 A/B 的 OLD 从 364 ms 漂到 656 ms），所以所有 before/after 都用**交替中位数**，不用单次值。

## 2. 基线（before）

### 2.1 交付物体积

| 指标 | 字节 | 说明 |
|---|---|---|
| win-x64 SEA 可执行文件（当前源码重建） | **80,752,128** | `build/bench-out/ifm_plain.exe`，SHA256 `CF6A9808A598B8CC11EF6B55112E10938B5126419AC67365D0F72A06374C687A` |
| 仓库内既有 exe | 80,773,120 | `build/out/win-x64/ifm_cli.exe`，其 bundle 为 10/02 构建（129,237 B，含当前 `main.js` 已不再 import 的 `ui/ifm.js`） |
| bundle.cjs | 106,717 字符 / 约 107 KB | 11 个模块（当前源码） |
| 安装包 win64 | 104,784,768 | `build/setup/win64.exe`（NSIS，已 `SetCompressor /SOLID lzma`） |
| 安装包 win-arm64 / winx86 | 96,038,535 / 98,290,414 | 同上 |
| 便携包 | 未测 | 本地无便携包产物；GitHub release 资产未取到，见 §7 |

### 2.2 冷启动（`--version`，ms）

| 对象 | 运行 | 中位数 | 条件 |
|---|---|---|---|
| 仓库既有 exe | 93.18 / 68.28 / 67.07 / 66.37 / 70.18 | **68.28** | 18:47，安静 |
| 当前源码重建 exe（A/B 交替，A 侧） | 67.55 59.57 57.97 56.25 57.35 56.63 58.28 54.92 55.61 | **57.35** | 19:31，较安静 |
| 同一 exe（A/B 交替，忙机） | 121.38 177.37 152.76 183.91 144.48 140.76 115.42 139.45 118.29 | **140.76** | 20:05，其他产品并行构建 |
| 裸 node v22 `--version` | — | **24.55** | 引擎早退，不含 JS 启动 |
| node v22 跑 hello.cjs | 56.60 50.67 52.43 50.46 58.22 | **52.43** | JS 引擎启动下限 |
| node v22 跑 bundle.cjs --version | 63.91 63.49 62.41 64.24 61.59 | **63.49** | 应用侧净成本 ≈ **11 ms** |

结论：SEA 外壳 + 引擎启动约 52 ms 是地板；`main.js` 的 import/初始化只占约 11 ms，冷启动可压缩空间很小。

### 2.3 驻留内存（`--serve-ui` 空闲，MB）

| 指标 | OLD 实测 |
|---|---|
| Working Set Private | **10.6 – 12.5**（同一 exe 在 10.6 与 12.5 两个桶之间跳，见 §5.3） |
| Private Bytes | 15.4 – 17.3 |
| Working Set | 31.2 – 34.3 |

### 2.4 列目录（关键指标）

5400 条目 `D:/temp/ifm-bench/big`，`GET /api/list`（旧契约，单次返回全部字段）：

| 条件 | 运行（ms） | 中位数 | 响应字节 |
|---|---|---|---|
| 安静（19:48） | 373.20 / 358.70 / 364.12 | **364.12** | 1,248,119 |
| 忙（19:59） | 607.06 / 611.75 / 656.26 | **611.75** | 1,248,119 |
| C: 5200 文件（忙） | 181.03 / 200.76 / 223.43 | **200.76** | 1,209,706 |

同进程直调 `listDir()`（node v24 对照，安静机，7 次中位数）：

| 阶段 | ms |
|---|---|
| `listLocal`（readdir + 5400 次 lstatSync） | **51.29** |
| `sortEntries` | 0.89 |
| 整体 shape + map | 53.01 |
| `JSON.stringify` 1.25 MB | 6.16 |
| `drives()`（26 次 accessSync） | 0.42 |
| `crumbsOf` | 0.04 |

传输几乎不要钱：同进程回环 `handler 61.76 ms` vs `loopback TTFB 62.68 ms`。

### 2.5 UI 侧

| 指标 | ms / 字节 |
|---|---|
| 端口可连接（`ready_ms`） | 106.64 – 201.75 |
| `/` 页面 TTFB | 0.55 – 0.99（7,542 B） |
| `/api/info` TTFB | 0.97 – 1.45（138 B） |

## 3. 瓶颈定位（只用证据）

### 3.1 目录列表拆相位：readdir 便宜，逐文件 stat 是全部成本

`probe-fs.mjs` 对 5,400 条目：

| 操作 | node v22 中位数 (ms) | node v24 中位数 (ms) |
|---|---|---|
| `readdirSync(dir)` | 2.37 | 2.21 |
| `readdirSync(dir,{withFileTypes:true})` | 2.40 | 2.12 |
| 5400 × `lstatSync` | **343.72** | 42.95 |
| 5400 × `statSync` | **381.57** | 41.26 |
| 5400 × `existsSync` | 470.00 | 57.09 |
| 5400 × `accessSync` | 46.67 | 33.60 |

即：**列目录 99% 的时间是 5400 次逐文件 stat**，而 readdir 本身只要 2.4 ms。

### 3.2 runtime A/B：这是最大的单项

| runtime | 5200×lstat D: big | 每次 | 5200×lstat C: cbig | 每次 | 4915×lstat System32 |
|---|---|---|---|---|---|
| node **v22.11.0** | 302.25 ms | **58.1 µs** | 133.29 ms | 25.6 µs | 127.63 ms |
| node **v24.19.0** | 31.56 ms | **6.1 µs** | 39.85 ms | 7.7 µs | 45.94 ms |
| 系统 API 对照（.NET `File.GetLastWriteTimeUtc`，5200 次） | 37.8 – 45.9 ms | **约 8 µs** | — | — | — |

对照与排除：

* **顺序偏差排除**：先 node24 后 node22，仍得 node24 31.05 ms / node22 311.94 ms（10 倍）。
* **量级不是固定倍数**：同一份文件树放 C: 只有 3.3 倍（133 vs 40 ms），说明 node22 的额外开销与卷/目录的元数据访问代价相关，不是纯粹的固定算术。
* **不是线程池排队**：`UV_THREADPOOL_SIZE` 4/8/16 配同宽 async 池，node22 反而更慢（286.7 / 298.3 / 316.3 ms），见 §6.2。
* **不是磁盘/杀软单方面**：同一时刻 node24 在同一批路径上只要 6–8 µs，与 .NET 量级一致。

结论：**node v22.11.0 的 stat/lstat 路径每次多花约 50 µs 的运行时开销**（约为系统 API 的 7 倍）；node v24 与系统 API 持平。这一项无法在产品代码里消除（Node 没有一次拿到 size/mtime 的目录枚举 API：`uv_fs_scandir` 只回 name+type）。

### 3.3 启动分解

| 项 | ms | 差 |
|---|---|---|
| 裸 node v22 `--version` | 24.55 | 引擎未启 JS |
| node v22 + `hello.cjs` | 52.43 | +27.9 = 完整 JS 启动 |
| node v22 + `bundle.cjs --version` | 63.49 | +11.1 = 应用 import + main |
| SEA exe `--version` | 57.35 – 68.28 | SEA blob 反序列化基本被引擎启动吸收 |

`ensureDirs()`（3 次 mkdirSync，目录已存在）实测 1.08 ms；`--version` 这条路上真正可省的是约 11 ms 的应用 import，且其中一部分（Bundler 的 `__require` 惰性表）已在同一进程内按需触发。

### 3.4 内存

空闲 10.6–12.5 MB WS Private、31–34 MB Working Set，对一个 SEA + http 服务来说很小，没有明显可回收项。GUI 进程确实 import 了它用不到的 `store/github/installer/launcher`（约 50 KB JS），但 V8 代码对象对 RSS 的影响在 1 MB 量级以下，优先级低。

## 4. 改动（一次一处）

### 改动 1：列目录改为两段式（lite 列表 + meta 补齐）

文件：`Infinity File Manager/sourcecode/src/core/localfs.js`、`src/gui/server.js`

```
 git diff --numstat -- "Infinity File Manager/sourcecode/src"
 60  0   Infinity File Manager/sourcecode/src/core/localfs.js
 64  12  Infinity File Manager/sourcecode/src/gui/server.js

 localfs.js  HEAD 47D72B165968BEAB7B582868075DE41DE8C56F2EF0576B63793A090DCF2D9367
             now  AFBDCFD43E602534B5F7B4F2179AEA30B7A183E88BEA577B8551395530FC4BCB
 server.js   HEAD 5C7565F9A6300F79FA5A2B2BF1957FC9408D097490968A46B21E1EE6C6987F6B
             now  00847363EE5FE2B28F153D1D00400C5A184CB2F1C1D765750D8155E83E96E155
```

内容：

1. `localfs.js` 新增 `listLocalFast(dir, opts)`：**一次** `readdirSync(dir,{withFileTypes:true})` 拿到全部 name+type，**不做任何逐条 stat**；只有符号链接才 stat 一次（很少）。
2. `localfs.js` 新增 `fillMeta(entries)`：对已经排好序的条目做逐条 lstat（symlink 再 stat），就是原来 `listLocal` 里那段，抽出来单独调用。
3. `gui/server.js`：`/api/list` 增加 `lite=1`——只回 `name/path/type/hidden/icon`（行渲染 + 点击行为所需的全部字段），并带 `lite:true`。**不带 `lite` 时行为与旧版逐字节一致**（`size/sizeText/dateText/mtime/ctime` 全在），其他调用方零影响。
4. `gui/server.js`：新增 `GET /api/meta?path=`，回 `{ok,path,meta:{名字:[大小文本,时间文本]}}`，按名字对齐（与顺序无关）；用同一套 `fmtSize/fmtDate`，格式化逻辑仍只有一处。
5. 页面 JS：`load()` 先取 lite 列表并**立刻**渲染全部行（大小/时间先占位 `…`），再取 `/api/meta` 就地写回对应单元格。

为什么这是「真优化」而不是搬运：首屏关键路径从「readdir + 5400 次 stat + 1.25 MB JSON」变成「readdir + 0.64 MB JSON」，**约 350 ms 的同步磁盘 I/O 从用户能看到第一行之前移除了**；同时首屏字节减半。

## 5. 复测（after）

`build/bench-out/ifm_new.exe`，SHA256 `505097AA3D0711EFE1B75AE98767F24D6BFFB3EFAF9ABA1DEECAE8D583A012B3`，由 `tools/bundle.mjs` + `--experimental-sea-config` + postject 同一条流水线产出。

### 5.1 列目录 / 首帧（A/B 交替，每轮各 4 次取中位数）

D: big（5,400 条）：

| 轮次 | OLD `/api/list` 全部 | NEW `/api/list?lite=1` 首屏 | NEW `/api/meta` | NEW 完整（lite+meta） |
|---|---|---|---|---|
| r1 | 607.06 ms / 1,248,119 B | **55.08 ms / 637,978 B** | 682.14 ms | 709.64 ms |
| r2 | 611.75 ms | **53.40 ms** | 516.89 ms | 570.29 ms |
| r3 | 656.26 ms | **28.42 ms** | 542.56 ms | 571.41 ms |
| 中位数 | **611.75** | **53.40（-91%）** | 542.56 | 571.41 |

C: cbig（5,200 文件）：

| 轮次 | OLD | NEW 首屏 | NEW meta | NEW 完整 |
|---|---|---|---|---|
| r1 | 181.03 ms | **21.44 ms** | 189.39 ms | 217.06 ms |
| r2 | 200.76 ms | **19.21 ms** | 179.13 ms | 201.08 ms |
| r3 | 223.43 ms | **13.87 ms** | 149.32 ms | 162.57 ms |
| 中位数 | **200.76** | **19.21（-90%）** | 179.13 | 201.08 |

安静机（19:48，同一 A/B 脚本）：OLD 364.12 ms → NEW lite **13.1 / 20.6 / 16.0 ms**，meta 263–290 ms。

汇总：

| 指标 | before | after | 变化 |
|---|---|---|---|
| 首屏可交互（安静机，D: 5400） | 364.12 ms | 13.1–20.6 ms | **-95%** |
| 首屏可交互（忙机，D: 5400） | 611.75 ms | 28.4–55.1 ms | **-91%** |
| 首屏可交互（C: 5200） | 200.76 ms | 13.9–21.4 ms | **-90%** |
| 首屏字节 | 1,248,119 B | 637,978 B | **-48.9%** |
| 完整元数据 | 364.12 / 611.75 ms | 283–310 / 570–710 ms | -19% ~ 持平 |

### 5.2 冷启动 / 体积 / 内存（未退化）

| 指标 | before | after | 结论 |
|---|---|---|---|
| exe 字节 | 80,752,128 | 80,756,736 | +4,608 B（+0.006%），bundle 从 106,717 增到 111,408 字符 |
| 冷启动 A/B 交替 9 轮 | 140.76 ms | 142.49 ms | +1.73 ms（+1.2%），在忙机噪声内 |
| 空闲 WS Private | 10.6–12.5 MB | 10.6–12.5 MB | 无变化 |
| 端口可连接 | 106–201 ms | 102.89–120.49 ms | 无退化 |
| 页面 TTFB | 0.55–0.99 ms | 0.50–1.02 ms | 无退化 |

### 5.3 行为等价性验证（`bench/verify-meta.mjs`，退出码 0）

```
 {"dir":"D:/temp/ifm-bench/big","lite_bytes":637978,"full_bytes":1248132,"meta_bytes":244754,
  "meta_mismatches":0,"failures":[],"PASS":true}
```

逐条断言（全部通过）：

* lite 与 full 的**条目数、顺序、type 完全一致**；
* `meta[name]` 与旧契约的 `[sizeText, dateText]` **逐条相等，0 处不一致**（5400 条全比）；
* lite 条目**不泄漏** `size/sizeText/dateText`；
* 目录不存在仍回 `{ok:false,error:"no such folder"}`，传文件仍回 `{ok:false,error:"not a folder"}`；
* 空目录 meta 回 `{}`；
* 页面内嵌脚本用 `new vm.Script()` 解析通过；
* 不带 `lite` 的 `/api/list` 契约逐字段保留。

功能面复核：`--serve-ui` 真实进程返回 200 且 `/`、`/api/info`、`/api/list?lite=1`、`/api/meta`、`/api/list` 均应答正常（§5.1、§5.3 都是真进程实测）。

## 6. 被否决 / 已回滚的尝试（有数据，代码里没留）

### 6.1 SEA `useCodeCache: true` — 无收益，未采用

同一条流水线出两个 exe，A/B 交替 9 轮 `--version`：

```
 {"A":"ifm_plain.exe","B":"ifm_codecache.exe","rounds":9,
  "A_median":57.35,"B_median":56.75,"delta_ms":-0.6,"delta_pct":-1}
```

单跑 5 次时曾看到 89.81 → 70.30 ms（-21.7%），交替复测后只剩 -1%，判定为负载噪声。**未启用**（`tools/build-all.mjs` 保持 `useCodeCache:false`）。

### 6.2 逐条 stat 走 libuv 线程池并行 — 不稳定，已回滚

同一份代码两种执行方式，交替测量：

| 条件 | 串行 lstat 循环 | 4 路 async 池 | 变化 |
|---|---|---|---|
| 安静机（19:20，5400 条，`probe-async.mjs`） | 343.72 ms | **247.52 ms** | **-28%** |
| 忙机（19:56，5400 条，`probe-meta.mjs` 交替 5 轮） | 805.77 ms | 1021.37 ms | **+26.8%** |

`UV_THREADPOOL_SIZE` 4/8/16 配同宽池也不改善（286.7 / 298.3 / 316.3 ms，串行 339.7–377 ms）。「有时快 28%、有时慢 27%」不是优化，**已从 `localfs.js` 删除**，相关行数与结论保留在本报告；`fillMeta` 现在就是普通循环。

### 6.3 SEA `useSnapshot: true` — 未完成（环境内存不足）

构建在 postject 阶段被 V8 `Fatal process out of memory: Zone` / 长时间挂起打断，当时系统空闲内存仅约 1.27 GB / 14 GB（其他产品并行构建）。**结论待定**，未纳入任何数字。

## 7. 风险、未完成与需要别人决策的事

1. **最大杠杆是换 runtime（未做，建议决策）**：node v22.11.0 → v24.19.0 让 5200 次 stat 从 302 ms 降到 31.6 ms（D:）/ 133 → 40 ms（C:）。代价：单 exe +12.3 MB（80.5 → 92.8 MB）、裸启动 +2.2 ms（24.55 → 26.74 ms）、7 个平台都要换 runtime 并重新验证 postject 兼容性与安装包体积。这属于发行链改动，我没有擅自动 `D:/temp/tools/runtimes`（那也是其他队友构建用的共享缓存）。
2. **`/api/meta` 仍是同步阻塞的**：5400 条会占住事件循环约 0.3–0.7 s（首屏已经不受影响，但这段期间其他请求要排队）。要彻底解决需要分块/流式 meta 协议，本轮没做。
3. **真 paint 未验证**：硬性无窗口规则下没有浏览器测量；「首帧」是「lite 响应完成」的代理指标。若要真数字，需要在获批的无头环境里跑一次（我可以提供脚本）。
4. **发行包字节数**：本地安装包 104,784,768 B（NSIS 已是 solid lzma，无压缩空间可捡）；便携包本地没有产物，GitHub API 因匿名限流未取到（我这个子代理环境里没有 `EV_GH_TOKEN`）。
5. **未做**：目录元数据缓存（会让刷新秒开，但外部改动的过期风险不可接受，没有做）；把 `store/github/installer` 改成惰性 import（最多省约 11 ms 应用启动的一部分，且需要改 bundler 支持动态 import，风险收益比不划算，未做）。
6. **测量噪声**：其他产品并行构建期间，同一 OLD 二进制的 `/api/list` 从 364 ms 漂到 656 ms（±80%）。本报告所有 before/after 结论都基于**交替中位数**，而非单次绝对值。

## 8. 复现命令（全部在 `D:/dev/DeepSeekHarnessWorkspace/Infinity.inc` 下，产物在 `Infinity File Manager/bench/`）

```
 # 造 5400 条目测试目录
 node "Infinity File Manager/bench/mkdata.mjs" "D:/temp/ifm-bench/big" 5200 200

 # 基线：冷启动 5 次中位数 / A/B 交替
 & ./"Infinity File Manager/bench/bench-start.ps1" -Exe "D:/temp/tools/node.exe" --version
 & ./"Infinity File Manager/bench/bench-ab.ps1" <exeA> <exeB> 9 --version

 # 基线：空闲内存（WS Private）
 & ./"Infinity File Manager/bench/bench-mem.ps1" -Exe <exe> -Port 17671 -WaitMs 3000

 # 瓶颈：syscall 拆相位（两个 runtime 各跑一遍）
 node "Infinity File Manager/bench/probe-fs.mjs" "D:/temp/ifm-bench/big"
 & "D:/temp/tools/node.exe" "Infinity File Manager/bench/probe-fs.mjs" "D:/temp/ifm-bench/big"

 # 首帧 / 列目录 before-after（A/B 交替）
 node "Infinity File Manager/bench/bench-paint.mjs" <exe> "D:/temp/ifm-bench/big" 17661 4

 # 等价性验证（退出码 0 = 通过）
 node "Infinity File Manager/bench/verify-meta.mjs" "D:/temp/ifm-bench/big" 17641

 # 单目标 SEA 构建（同 tools/build-all.mjs 的流水线）
 node "Infinity File Manager/bench/build-one.mjs" win-x64 plain new
```

## 9. 交付物

| 路径 | 说明 |
|---|---|
| `Infinity File Manager/sourcecode/src/core/localfs.js` | 新增 `listLocalFast` / `fillMeta`（+60 行，改动 1） |
| `Infinity File Manager/sourcecode/src/gui/server.js` | `lite` 列表 + `/api/meta` + 页面两段式渲染（+64/-12 行，改动 1） |
| `Infinity File Manager/bench/` | 全部测量与验证脚本（可复现，非产品构建输入） |
| `work/perf-ifm.md` | 本报告 |

## 10. 构建状态（重要）

* 单目标 SEA 构建流水线（`bundle.mjs` → `--experimental-sea-config` → postject）**成功 3 次**（plain / codecache / new），产出的 exe 均能启动并正常服务。
* 仓库自带的 `tools/build-all.mjs`（7 平台一次构建）在**干净副本**上尝试 2 次，均在第一个 postject 处失败：`Fatal process out of memory: Zone`；当时系统空闲内存约 1.27 GB / 14 GB（其他产品并行构建）。**这是环境内存问题，不是本次源码改动导致**（同一改动用单目标流水线构建成功）。
* 按 Lead 的全面停止令，目前不再运行任何二进制；7 平台完整构建与安装包重打**待批准后在无人值守时统一执行**。
