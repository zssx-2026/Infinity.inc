# Infinity Installer Manager 性能报告（task-22）

- 写作用域：`cpp/apps/iim/`（报告：`work/perf-iim.md`）
- 被测对象：`cpp/apps/iim/main.cpp` + `ui.hpp` 编出的 `iim.exe`（发行名 iim_cli / iim_gui / iimx_cli / iimx_gui，四个名字是同一份 PE）
- 构建：`cmake --build cpp/build --target iim -j 2`（CMake Release ⇒ `-O3 -DNDEBUG`，`-static -static-libgcc -static-libstdc++ -s`）
- 环境：AMD Ryzen 7 7735H（8C/16T），物理内存 13.7 GB，Windows，MinGW-w64 GCC 16.1.0，Ninja；空闲物理内存一度只有 1.3 GB，一次 cc1plus 曾 OOM（已重试成功）
- 基线快照（保留在 `cpp/apps/iim/bench/baseline/`）：`main_before.cpp`（改动前）、`iim_before.exe`（改动前二进制）、`iim_after.exe`（改动后二进制）

## 1. 结论先行

1. **真瓶颈是启动期的串行网络 I/O 和同步目录扫描，不是 CPU。**
   - 目录加载 `loadItems` 对每个带 `name.txt` 的 release 发一次**串行** HTTP。线上 `zssx-2026/applications` 实测 10 个 release、**8 个带 name.txt** ⇒ 每次加载 8 次串行往返。在真实响应上回放，`itemsForRelease` 合计 **1441.8 ms**（其中绝大部分是这 8 次 RTT）。
   - 同期被加进 main() 首行的 `unblockSelfDirectory(2)`（Lead 的「文件自我解锁」特性）会**同步递归扫目录**：52 个候选文件的目录里实测中位 **4.484 ms**，把 `--version` 冷启动中位数从 30.310 ms 抬到 34.874 ms（**+15%**）。
2. **CPU 侧在真实规模下都不是瓶颈**：sha256 644–996 MB/s（IIM 安装包只有 302978 B ⇒ 0.3–0.5 ms）；真实目录 208 个 item 的筛选 0.136 ms、`/api/catalog` 序列化 2.701 ms、排序 0.395 ms。
3. **exe 体积 727040 B 中 .text 占 81%**（静态 CRT/libstdc++ + 六个产品共用的 inc_core），缩小它的唯一杠杆是 `cpp/CMakeLists.txt` 的编译/链接选项，**不在我的写作用域**（见 §6）。

## 2. 基线指标（before，全部为实测）

### 2.1 体积（文件属性，非运行）

```
iim.exe（改动前，bench/baseline/iim_before.exe）     724992 B  SHA256 E0E781478EA03BD709B7893BEB4EABD76D29C33283A7CB036751BD6C8A9DF546
iim.exe（Lead 加 unblock 之前，iim_pre_unblock.exe） 718848 B  SHA256 D8E63139EEDA737DEF3B0394544A5C654D119FC4D7E62895A73C368C34DF05EF
发行安装包 InfinityInstallerManager_1.0.0-pre4_win64_setup.exe  302978 B
    SHA256 08CE3A05D83E9D38B4FB696F156E580FCC04A9E30066A21C8A41F9061210D2F2
    ↑ 与 cpp/release/v1.0pre4/release-assets.json 记录的摘要逐字节一致，确认本地文件就是发布资产
```

exe 段表（`objdump -h cpp/build/iim.exe`，改动前 718848 B 版本）：

```
Idx Name      Size      File off
 0 .text     0008f230   00000400   (586288 B, 81%)
 2 .rdata    0000e9f0   00090000   (59888 B, 内联 HTML/CSS/JS 约 35 KB)
 4 .pdata    00004e3c   0009ec00   (20028 B)
 5 .xdata    00008a98   000a3c00   (35480 B)
 7 .idata    0000228c   000ac800   (8844 B)
```

安装包只装 4 份同一个 exe（`cpp/tools/package.mjs` 的 `APPS` 里 iim 的 faces 是 cli+gui），NSIS `SetCompressor /SOLID lzma` 把 4 份重复内容压得很紧：4×724992 B → 302978 B。

### 2.2 冷启动与驻留内存

工具：`cpp/apps/iim/bench/runner.exe`（控制台；`CreateProcess` + `CREATE_NO_WINDOW`，QPC 计时，`GetProcessTimes`/`GetProcessMemoryInfo` 采样，子进程 stdout/stderr 不继承）。命令：

```
cpp/apps/iim/bench/runner.exe 5 <布局目录>/iim_cli.exe --version
```

| 场景（目录布局） | wall 中位数 | 峰值工作集 | 原始输出（5 次，ms） |
|---|---|---|---|
| 改动前 exe 单独放（clean） | 32.993 ms | 8.58–9.40 MB | 138.381 / 32.993 / 33.264 / 31.558 / 32.249 |
| 改动前 + unblock，exe 单独（clean2） | 32.417 ms | 8.72 MB | 134.194 / 35.481 / 31.564 / 31.073 / 32.417 |
| 改动前 + unblock，仿真安装目录（5 个 exe） | 32.198 ms | 8.72 MB | 109.779 / 28.666 / 31.221 / 32.198 / 35.373 |
| 改动前 + unblock，脏目录（52 个候选文件） | **34.874 ms** | 8.74 MB | 114.358 / 35.254 / 34.874 / 34.627 / 33.139 |
| 无 unblock，同一脏目录 | **30.310 ms** | 8.60 MB | 124.912 / 29.996 / 30.959 / 29.720 / 30.310 |

结论：`--version` 的 ~30 ms 里绝大部分是 Windows 进程创建 + 静态 CRT 初始化，源码层没有余量；可动的只有那 2.1–4.6 ms 的目录扫描。首行 110–140 ms 是文件缓存冷启动，取 5 次中位数即被剔除。

> 说明：本产品在无令牌时 `guiMain`/`serveUi`/`cliMain` 都会立刻打印「not signed in」退出，因此**不存在可持续驻留的空闲进程**；「空闲驻留内存」以进程存活期的 **峰值私有工作集** 表示（上表 8.6–8.7 MB）。真正的空闲驻留需要有效令牌才能进入消息循环/HTTP 服务，本轮无令牌，未能测。

### 2.3 安装计划生成（CPU）

工具：`harness_before.exe`（把 `main.cpp` 连同匿名命名空间里的函数一起 `#include` 进基准翻译单元，测的就是出货代码本身）。合成规模：

```
plan,n=150    matching_empty=4.3us   matching_filtered=24.6us   best=7.6us    catalog_json=618.8us   sort=0.121ms
plan,n=600    matching_empty=8.9us   matching_filtered=68.3us   best=8.6us    catalog_json=1522.9us  sort=0.392ms
plan,n=2000   matching_empty=28.8us  matching_filtered=238.9us  best=13.1us   catalog_json=4751.0us  sort=1.230ms
plan,n=20000  matching_empty=252.4us matching_filtered=3168.2us best=114.7us  catalog_json=60904.2us sort=31.632ms
```

真实目录回放（`bench/tmp/releases.json`，即线上 `releases?per_page=100` 的原始响应 352764 B）：

```
real,releases=10,items=208,catalog_json_bytes=92187,parse_ms=10.044,build_items_ms=1441.811,
     sort_ms=0.395,catalog_json_ms=2.701,search3cats_ms=0.136,best_ms=0.004
```

**build_items_ms = 1441.811 ms 是全部 CPU 指标里唯一的异常值。**逐 release 打印后确认：带 name.txt 的 release 每次 ~93–512 ms、不带的只要 0.009–0.652 ms —— 即时间花在 `itemsForRelease` 内部对 `fetchNameTxt` 的**串行 HTTP**，不是字符串处理（单独的 `fallbackItem` 实测 0.381 us/次）。

### 2.4 sha256 校验吞吐

```
sha,size_mb=1   median_ms=1.004   mb_per_s=996.0  digest=1bc78ba35cac54fe318a6bd7e2acdf69a1eaf7c47c9597b0f6cc10e026aec5a1
sha,size_mb=8   median_ms=12.354  mb_per_s=647.6
sha,size_mb=64  median_ms=99.402  mb_per_s=643.9
sha,size_mb=256 median_ms=271.135 mb_per_s=944.2
```

64 KB 栈缓冲 + `FILE_FLAG_SEQUENTIAL_SCAN` + BCrypt；吞吐已接近 SHA-NI 上限。**IIM 安装包只有 302978 B ⇒ 单次校验 0.3–0.5 ms，不是瓶颈**（见 §7）。

### 2.5 目录扫描 / 每帧擦除 / unblock 扫描

```
scan,dirs=200,found=200,median_ms=29.361              (scanInstalled, 0.147 ms/项)
paint,reps=20000,total_ms=94.025,us_per_erase=4.701   (WM_ERASEBKGND，每次新建+删除画刷)
unblock_sweep,module_dir=...\bench,reps=50,median_ms=4.484,min_ms=3.144
```

### 2.6 启动期网络（真实 api.github.com）

```
(第一次实测，尚未被限流)
net,items=0,me_ms=99.6,verify_ms=99.9,load_ms=8539.5,serial_sum_ms=8739.1,parallel_ms=161.7
(随后)
net_rep,0,load_ok=0,items=0,ms=508.4,error=HTTP 403
curl https://api.github.com/rate_limit -> core: limit=60, remaining=0, used=60
```

- `GitHub::me` / `verifyIdentity` 各约 100 ms/次（一次完整 TLS 往返），二者互不依赖，现在是**串行**调用。
- `loadItems` 里 8 次 name.txt 拉取是串行的（见 2.3）。
- 匿名配额被用尽后 403，`loadItems` 直接返回空 —— 所以第二次的 `parallel_ms=161.7` 是限流后的假值，**不作为证据**。

## 3. 改动（一次一处，均已构建通过）

构建结果：`cmake --build cpp/build --target iim -j 2` 成功；改动后 `iim.exe` **727040 B**，SHA256 **CDF87B1298FE9DDDD6EBACC40E6EECFD255DD915C76D1CF542775EA5C4FE791F**（改动前 724992 B / E0E78147…）。
`main.cpp` 改动前 `AD03DC54D1C082FFBB907F95D6FAF89ACFF7A74E4F48E4837AB55BAE0538FB1E` → 改动后 `1B38153A687B2FD1E35F71B851E2079B5EA97FF9EB962550BF11C60E7826AF05`（`git diff --stat`：1 file changed, 92 insertions(+), 23 deletions(-)）。

### 改动 A：把每个页面的 name.txt 改成并发拉取（loadItems）

- 动机（数据）：真实目录 8/10 个 release 带 name.txt；`itemsForRelease` 串行往返实测合计 1441.8 ms，而它里面与网络无关的 CPU 部分（`fallbackItem` 0.381 us/项、sort 0.395 ms）可忽略。
- 做法：把 `itemsForRelease(GitHub&, Release&)` 拆成「取资产列表 assetsOf」+「找 name.txt manifestOf」+「纯 CPU 组装 itemsForRelease(Release&, manifestText)」；`loadItems` 先用 6 个 worker 把各页面 manifest 并发取回，再顺序组装。取不到的 manifest 仍退回页面资产，行为与原来一致。
- 影响面：只改 `cpp/apps/iim/main.cpp`；`http.cpp` 每次请求各自 `WinHttpOpen`，无全局状态，可安全并发。
- 预期（请求数，可直接核算）：10 个 release 里 8 个需要 manifest，worker=6 ⇒ 串行 8 波 → 并发 2 波；连同 release 列表，合计 9 次请求的墙钟从「1 次列表 + 8×RTT」降到「1 次列表 + 2×RTT」。
- **实测（after）待批准运行**（见 §8）。

### 改动 B：目录解锁扫描离开启动快路径

- 动机（数据）：`unblockSelfDirectory(2)` 同步扫目录，52 个候选文件的目录里 4.484 ms，占 `--version` 冷启动的 15%（30.310 → 34.874 ms）。
- 做法：`main()` 只保留 `unblockSelf()`（对自身一次 DeleteFileW(path + ":Zone.Identifier")）；目录巡检下沉到**真正要做事的三个入口**——`cliMain` 的 `--version/--paths/help` 快路径之后、`guiMain()` 开头、`serveUi()` 开头。功能不变（真正安装/下载/看窗口时仍会清整目录），只是脚本化快路径不再付这笔钱。
- 预期：`--version`/`--paths`/`--help` 回到无 unblock 的 30.310 ms 量级（脏目录省 4.6 ms，仿真安装目录省约 2 ms）。

### 改动 C：背景画刷复用（WM_ERASEBKGND）

- 动机（数据）：原本每次擦除都 `CreateSolidBrush` 再 `DeleteObject`，实测 4.701 us/次（20000 次 94.025 ms），即每次重绘一次 GDI 对象分配。
- 做法：一个 `backgroundBrush` 只建一次（单线程 wndproc，无需锁）。
- 预期：每次擦除只剩 `FillRect`。
- **实测（after）待批准**；本轮不允许创建任何窗口，无法直接跑 `WM_ERASEBKGND`。

## 4. 改动后的指标表

| 指标 | before | after | 状态 |
|---|---|---|---|
| exe 字节 | 724992 | **727040**（+2048 B） | 已测（文件属性） |
| 发行安装包字节 | 302978 | 未重打包 | 需 makensis（.exe，未获批准） |
| 冷启动 ms 中位数（脏目录 --version） | 34.874 | 预期 ~30.3 | 待批准运行 |
| 冷启动 ms 中位数（仿真安装目录） | 32.198 | 预期 ~30.3 | 待批准运行 |
| 峰值私有工作集 MB | 8.72–8.74 | 预期持平/略降 | 待批准运行 |
| 安装计划生成（真实目录，含网络） | 1441.8 ms | 预期 2 波 RTT（串行 → 6 路并发） | 待批准运行（且需等 GitHub 匿名配额 reset） |
| 目录加载端到端 loadItems | 未取到有效值（403） | 同上 | 待批准运行 |
| sha256 吞吐 | 644–996 MB/s | 未改动 | 不变（不是瓶颈） |
| 每次 WM_ERASEBKGND | 4.701 us（窗口版基准） | 待测（基准已改为无窗口 GDI 内存 DC，静态可审查、未编译） | 见 work/run-queue/prod-iim-task22.md |
| scanInstalled 200 项 | 29.361 ms | 未改动 | 不变（0.147 ms/项，非瓶颈） |

**诚实声明：after 的行为指标尚未取到 —— Lead 在 2026-10-04 20:2x 下达了「禁止启动任何 .exe」的全面停止令，我据此没有运行任何二进制。改动已编译通过，但「程序能启动/关键行为不变」的验证同样待批准。**

## 5. 证据方法与一个反例（方法学）

第一轮我用 PowerShell 统计 name.txt 数量，得到「0 个 release 带 name.txt」，据此差点把「N+1」当成伪瓶颈。实际是 (filtered).Count 在非数组结果上返回 $null 的坑。改用 `node -e` 直接解析同一份 JSON，得到 **8/10 带 name.txt**：

```
node -e "... rel.assets.filter(a=>a.name==='name.txt') ..."
assets=2   name.txt=1  id=609482775
assets=2   name.txt=1  id=609482595
assets=2   name.txt=1  id=609657104
assets=2   name.txt=1  id=609657035
assets=28  name.txt=1  id=595415295
assets=7   name.txt=1  id=609342091
assets=148 name.txt=0
assets=2   name.txt=0
assets=10  name.txt=1  id=574140056
assets=16  name.txt=1  id=574139511
releases_with_name_txt=8
```

随后逐 release 计时才把 1441.8 ms 归因到 8 次串行 HTTP（而不是字符串处理）。**结论：先量再改。**

## 6. 不在我写作用域、但对体积影响最大的项（交给 Lead）

- `cpp/CMakeLists.txt` 用 `-O3`（= Release）且没有 `-ffunction-sections/-fdata-sections`、没有 `-Wl,--gc-sections`、没有 `-fno-asynchronous-unwind-tables`。exe 里 .text 586 KB、.pdata+.xdata 55 KB。
- 若要压发行包，建议在 CMakeLists 层做：`-Os`（或对冷路径函数加 `__attribute__((cold))`）、`-ffunction-sections -fdata-sections -Wl,--gc-sections`、`-fno-asynchronous-unwind-tables`；再用 `cpp/tools/package.mjs` 重打包对比字节。
- 这些改动会同时影响 6 个产品，属于 Lead/rel-cpp-build 的写作用域，我没有动。

## 7. 被否定 / 未采纳的尝试（有数据）

1. **sha256 读缓冲 64 KB → 更大**：实测吞吐 644–996 MB/s 已近硬件上限；IIM 的资产是 302978 B，单次 0.3–0.5 ms。改缓冲的收益落在噪声里，**不做**。
2. **Catalog::matching 每键击缓存小写 haystack**：合成 n=150/600 时 24.6/68.3 us，真实目录（208 项）三分类搜索 0.136 ms。收益 <0.1 ms，**不做**（避免为噪声增加状态）。
3. **为 20000 项规模优化 catalog_json（60.9 ms）**：真实目录只有 208 项、`/api/catalog` 序列化 2.701 ms。按真实规模判断无收益，**不做**。
4. **把 unblock 目录巡检完全去掉**：它是 Lead 的特性（浏览器下载标记），去掉是功能回退；只做「移出快路径」，不做删除。
5. **signIn 的 me/verifyIdentity 并发**：各约 100 ms 且互不依赖，可再省一次 RTT；本轮未做（避免一次改动里塞两处网络语义变化），列为下一步。

## 8. 待运行清单（Lead 2026-10-04 20:45 批复：(1)(2)(3) 均不批，编译亦不批；已移交 work/run-queue/prod-iim-task22.md）

1. `bench/runner.exe 5 bench/run/install/iim_gui.exe --version` — 冷启动 + 峰值工作集（无窗口，CREATE_NO_WINDOW）
2. `bench/harness_after.exe real` / `plan`、`bench/harness_before.exe real` — 安装计划生成 CPU（无窗口、不联网）
3. `bench/harness_after.exe load 2` / `bench/harness_before.exe load 2` — 目录加载端到端（只读公开 API；需等匿名配额 reset）
4. 用无窗口 GDI 内存 DC 基准替代 `paint`（需重新编译一次 harness）

## 9. 风险与回滚

- 回滚：`cpp/apps/iim/bench/baseline/main_before.cpp` 是改动前的完整 `main.cpp`，复制回 `main.cpp` 后重新 `cmake --build cpp/build --target iim -j 2` 即可回到 before（含 Lead 的 unblock 改动）。
- 风险 A：并发 manifest 拉取对 GitHub 配额更集中（瞬时 6 并发）。已限制 worker=6，且失败仍走原回退路径。
- 风险 B：`itemsForRelease` 签名变化；它只被 `loadItems` 调用，已用同一份基准代码对前后两个版本分别编译验证通过。
- 风险 C：`unblockSelfDirectory` 下沉后，`iim --version` 这类调用不再清整目录（自身标记仍会清）。这是有意的取舍，已写注释。
- 未验证：程序实际启动与关键行为不变 —— 因停止令未运行。

## 10. 工件清单

- `cpp/apps/iim/bench/runner.cpp` — 进程计时/内存探针
- `cpp/apps/iim/bench/harness.cpp` — in-process 基准（sha/plan/scan/real/load/net/unblock；paint 用隐藏 WS_POPUP 窗口）
- `cpp/apps/iim/bench/build.ps1` — 一键编译三个工具（含从改动前代码生成 harness_before.exe）
- `cpp/apps/iim/bench/baseline/` — main_before.cpp、iim_pre_unblock.exe、iim_before.exe、iim_after.exe
- `cpp/apps/iim/bench/tmp/releases.json` — 线上 releases 原始响应（352764 B），供离线复现
- 全部命令与原始输出见 §2。

## 11. 批复记录与本案的当前边界

- 2026-10-04 20:45 Lead 批复：运行请求 (1)(2)(3) **一律不批**，**编译也不批**；要求把无窗口 GDI 内存 DC 微基准写成「静态可审查的代码」，数字留占位。
- 已照办：`benchPaint`（会建窗口）已从 `cpp/apps/iim/bench/harness.cpp` 删除，替换为无窗口的 `benchBrush`
  （`CreateCompatibleDC(null)` + 内存位图，分别测「每次新建/删除画刷」与「复用一把画刷」的中位数）；该文件**尚未编译**，处于静态可审查状态。
- 待运行队列（命令、PID 精确清理方法、匿名配额前提、占位数字表）：`work/run-queue/prod-iim-task22.md`。
- 因此本案 after 的**行为**数字全部空缺。已确认的 after 事实只有两条：改动可编译通过（727040 B / CDF87B12…），以及 §9 的逻辑复核结论。
- 未做（全部因禁令）：程序启动验证、关键行为不变验证、发行包重打包对比。

*报告时间：2026-10-04 20:5x +08:00；after 行为指标按 Lead 禁令转入待运行队列。*
