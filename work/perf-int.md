# Infinity Toolbox + ITB Tools 性能报告（task-23 · prod-int）

状态：**改动完成、行为等价已验证、静态工作量已量化；“改动后”计时数字 = PENDING(受控窗口)**
（受 Lead 运行禁令约束：编译与 `ab.mjs` 未获批准，运行单已交 `work/run-queue/prod-int-task23.md`。）

- 源码改动（唯一）：`cpp/apps/int/main.cpp`
  候选源码 sha256 = `c62358abf42498b89a60afeb01ce0f040fe8bb9def69395588666a5d9427d514`（80,859 B，2026-10-04 20:53）
  冻结基线源码 sha256 = `88af579d677b6d1e3ccee24ad318ad74ffa4b16f05a3b9d9eeb8e78b783e4b70`（74,302 B）
- 探针与夹具：`cpp/apps/int/_bench/`（bench.mjs / ab.mjs / compare.ps1 / static-model.mjs / e2e-*.ps1 / 6 个 LOCALAPPDATA 夹具）
- 运行单：`work/run-queue/prod-int-task23.md`

---

## 0. 指标表（before = 实测；after = PENDING(受控窗口)）

| 指标（中位数） | 基线（实测） | 改动后 | Δ |
| --- | --- | --- | --- |
| 冷启动 `--version` (ms) | 9.40 | PENDING(受控窗口) | — |
| `int list` · 真实容器 (ms) | 13.76 | PENDING(受控窗口) | — |
| `plugin list` · 真实容器 (ms) | 14.38 | PENDING(受控窗口) | — |
| `plugin verify <file>` · 真实容器 (ms) | 13.81 | PENDING(受控窗口) | — |
| `int list` · 2000 条目容器 (ms) | 28.13 | PENDING(受控窗口) | — |
| `plugin list` · 2000 条目容器 (ms) | 29.58 | PENDING(受控窗口) | — |
| `/api/state` 首答 (ms) | 9.95 | PENDING(受控窗口) | — |
| `/api/tools` 首答 (ms) | 10.41 | PENDING(受控窗口) | — |
| `/api/tools` · 2000 条目容器 (ms) | 26.77 | PENDING(受控窗口) | — |
| 空闲 Private Working Set (MB) | 1.24 | PENDING(受控窗口) | — |
| exe 字节 | 677,888 | PENDING(受控窗口)（中间构建 684,032 早于最后一次缓冲复用改动） | — |
| 发行包字节 | 262,473（10-03 旧源码产物，见 §7） | task-31 集中重建 | — |

> 无用营销话术；上表空缺项只等 §6 的运行窗口回填。**静态工作量模型（§5）已证明被删除的工作量。**

---

## 1. 基线与可复现性

- 仓库：`D:\dev\DeepSeekHarnessWorkspace\Infinity.inc`
- git HEAD：`3e3a58a34cfad14376964b0dffcedd2d8f7166f7`
- 文件冻结：`cpp/apps/int/main.cpp` 在 19:10:42 由 rel-cpp-build 加入 task-26 的 `inc::unblockSelf()` 两行后冻结
  （sha256 `88af579d...b70`，Lead 与 rel-cpp-build 均书面确认不再改动）。本报告全部改动叠加在这份冻结源码上。
- 基线构建（与仓库正式构建同一 CMake 配置：Release / `-O3 -DNDEBUG` / 链接
  `-static -static-libgcc -static-libstdc++ -s`，`-j 2`）：

```powershell
cmake -G Ninja -DCMAKE_BUILD_TYPE=Release -S cpp -B cpp/apps/int/_bench/build-base2
ninja -C cpp/apps/int/_bench/build-base2 -j 2 int
```

- 基线 exe：`cpp/apps/int/_bench/build-base2/int.exe` = **677,888 B**，
  sha256 `ac910cb68c2b0f1e77b6686a448c7d5947169faa417e4f9ce5f29ec626a45467`
  （`cpp/build/int.exe` 同尺寸、19:16 构建；`cpp/out/int/int_cli.exe` 596,480 B 是 10-03 旧产物，见 §7）。

### 测量方法

- 冷启动计时：`bench.mjs` — `spawnSync` + `process.hrtime.bigint()`，每命令 1 次预热 + N 次取样，报中位数。
- 抗噪：本机同时有多个 teammate 在构建（CPU/内存争用明显，`--version` 底噪一度从 9 ms 漂到 23 ms），
  因此最终对比用 `ab.mjs`：同一命令**交替**先跑基线/候选（偶数轮基线先、奇数轮候选先），各 N 轮取中位数，抵消漂移。
- `LOCALAPPDATA` 覆写到夹具目录，**绝不触碰开发机真实插件目录**。夹具：

| 夹具 | 内容 | 大小 |
| --- | --- | --- |
| `root` | FastBrowser.itbt + 已解包目录（模拟真机） | 1,727,627 B 容器 / 2 条目 |
| `root-container` | 只有容器 | 同上 |
| `root-dir` | 只有解包目录 | 1,727,428 B |
| `root-syn` | 合成 SynMany.itbt（`itbt-pack` 生成，2002 条目） | 2,184,498 B |
| `root-empty` | 空 | — |
| `root-bad` | payload 损坏 / item.json 损坏 / deflate / 魔数损坏 | 各 1,727,627 B |

---

## 2. 基线原始数据与归因

`root`（真实容器，runs=11，中位数）：

```
{"name":"version","median":9.4}
{"name":"list","median":13.76}
{"name":"plugin-list","median":14.38}
{"name":"info-fdm","median":8.89}
{"name":"plugin-verify-file","median":13.81}
{"name":"plugin-verify-name","median":17.89}
{"name":"ui-first-frame","readyMs":29.16,"firstStateMs":9.95,"firstToolsMs":10.41,
 "repeatToolsMs":5.27,"idleToolsMs":7.75,
 "memory":{"privateMB":1.24,"workingSetMB":5.9,"peakWorkingSetMB":10.11,"threads":5,"handles":87}}
```

`root-syn`（2002 条目，runs=11，中位数）：

```
{"name":"list","median":28.13}
{"name":"plugin-list","median":29.58}
{"name":"ui-first-frame","readyMs":48.23,"firstStateMs":27.02,"firstToolsMs":26.77,
 "repeatToolsMs":19.93,"idleToolsMs":19.37,
 "memory":{"privateMB":1.61,"workingSetMB":6.19,"peakWorkingSetMB":10.96,"threads":5,"handles":87}}
```

完整原始行：`cpp/apps/int/_bench/out/baseline-root.txt`、`baseline-syn.txt`。
（另有 671,232 B 的更早期构建数据：`root-empty/root-dir/root-container` 三夹具，命令与输出见
`_bench/out/` 与本节下方归因表。）

### 归因（同一批取样内做差，抵消进程创建固定开销）

| 观测 | 中位数 | 结论 |
| --- | --- | --- |
| `--version`（不扫插件） | 9.4 | 进程创建/加载底噪 |
| `info fdm`（内置，不扫插件） | 8.89 | 同上（噪声内） |
| `list` 空根 / 只有目录插件 | 10.40 / 9.56 | 目录插件枚举 < 1 ms |
| `list` 只有 .itbt 容器 | 14.37 | **容器枚举 +4.5 ms**：读整文件 + 整文件 SHA-256 + 逐条目 SHA-256 |
| `list` 2002 条目容器 | 28.13 | 条目数放大同一路径 |
| `plugin list` 2002 条目 | 29.58 | 同上（含逐条目校验） |
| `/api/tools` 2002 条目 | 26.77 | 每次请求整套重做 |
| UI 页面加载 | `/api/state` + `/api/tools` 各扫一次 | 同一份插件被完整枚举/哈希**两次** |

定位到的瓶颈（都可指到行；见 §3）：`scanPlugins()` 为枚举名称/版本/是否解包而读整容器并做整文件哈希 +
逐条目哈希；页面加载扫两遍；`verifyItbt()` 每条目 `substr` 拷贝、每条目重开 CNG provider；
`parseItbt()` 重复路径检查 O(n²)；`readWholeFile()` 不做 reserve。

---

## 3. 改动（全部在 `cpp/apps/int/main.cpp`）

```
git diff --no-index cpp/apps/int/_bench/base-src/main.cpp cpp/apps/int/main.cpp --stat
 1 file changed, 228 insertions(+), 93 deletions(-)
```
（`_bench/base-src/main.cpp` 是冻结源码的逐字节副本，所以这个 diff 就是本次全部改动。）

1. **容器枚举只读头部**：新增 `readItbtHead()`（20 字节前缀定 headerSize，只读 headerSize 字节）；
   `parseItbt()` 拆为 `parseItbtBuffer(bytes, fileSize, ...)` + `parseItbt()` / `parseItbtHead()` 两个入口。
   条目越界与 `totalSize` 仍按**磁盘真实大小**校验，格式语义不变。
   受益命令：`int list`、`run`、`/api/state`。
2. **按用途分级扫描**：新增 `enum class Scan { Names, Digests, Verified }`。
   `Names` = 只读头部；`Digests` = 再读整个文件做一次整文件 SHA-256（保留 `/api/tools` 的 `sha256` 字段）；
   `Verified` = 再逐条目校验（只有 `plugin list` / `info` / `verify` 需要）。
   调用点全部显式：listTools、stateJson、runTool、verifyPlugin → `Names`；toolsJson → `Digests`；
   listPlugins、infoTool → `Verified`。**`plugin list` 仍逐条目校验并显示 invalid。**
3. **失败回退保兼容**：头部解析被拒绝时回退到原来的“读整文件 + `parseItbt`”，
   坏容器的报错文本与 sha256 列与基线逐字节一致（这条是 §4 对比中发现并修的：第一版在坏容器行丢了 sha256）。
4. **哈希路径**：新增 `class Sha256`——复用同一个 CNG provider，scratch object 与 digest 缓冲为成员
   （不再每条目两次堆分配）；`range()` 直接在容器缓冲上按偏移哈希（去掉每条目一次 `substr` 拷贝）；
   `verifyItbt()` 增加可选 provider 参数（默认自建，其它调用点不改）。
5. **O(n²) → O(n log n)**：重复 entry 路径检查改为排序 + 相邻比较。
6. **`readWholeFile()`**：先 `GetFileSizeEx` + `reserve`；读缓冲 64 KB → 256 KB。

---

## 4. 行为等价验证（已完成，可复核）

> **验证对象说明（重要）**：§4.1/§4.2 跑的是候选**中间构建** 684,032 B，它包含改动 1–6 中的
> 全部内容**除了**改动 4 的最后一步“CNG scratch/digest 缓冲改为 `Sha256` 成员复用”——该小步在
> 那次构建之后才落到源码里。因此**最终源码尚未跑过 §4 回归**；运行队列 §3 在 §2 重建后**先跑
> compare.ps1 + 两个 e2e、再跑 §4/§5 计时**，判定不通过即回滚。这一步是重建后的第一道闸门。
> （缓冲区复用本身是 BCrypt 的常规用法：每个 hash handle 用同一块 scratch，handle 销毁后可复用。）

### 4.1 86 条命令逐字节对比 — `cpp/apps/int/_bench/compare.ps1`

6 夹具 × 14 命令（`--version` / `--paths` / help / list / info / `plugin list` / `plugin verify`（名字与文件）/
`run` 等，含 4 种损坏容器），比较 stdout + stderr + 退出码：

```
compared 86 command-runs, 6 differ
```

6 处差异全是 `--paths` 打印的 **exe 所在目录**不同（`_bench/base` vs `_bench/perf`），非行为差异；
其余 80 条（含 payload 损坏 / item.json 损坏 / deflate / 魔数损坏容器的报错与 sha256 列）逐字节相同。

### 4.2 .itbt 端到端契约 — `work/itbt/e2e-test.ps1` 的等价副本

只把 `$int`、`$sandbox` 指向我方作用域，脚本判定逻辑原样：

```
E2E OUTPUT IDENTICAL   （两份输出各 4,487 B）
```

覆盖：安装 1.7 MB 容器并解包、重复安装命中“已安装且一致”、容器与目录合并为一行、按名字/按文件 verify、
解包产物 SHA-256 与源一致、legacy 目录插件仍可见、坏字节与坏魔数被拒。

---

## 5. 静态工作量模型（无需运行二进制即可复核）

`cpp/apps/int/_bench/static-model.mjs` 只读容器字节、按 `.itbt` 布局解析，算出每条命令**必须**读/哈希/拷贝的量。
（脚本不 spawn 任何外部程序，符合当前运行禁令；命令：`node cpp/apps/int/_bench/static-model.mjs`。）

**FastBrowser.itbt**：fileSize 1,727,627 · headerSize **199** · 2 条目 · payload 1,727,428

| 每条命令的工作 | 基线 | 候选 | 削减 |
| --- | --- | --- | --- |
| `int list` / `run` / `/api/state`：读字节 | 1,727,627 | 199 | 100% |
| 　同上：SHA-256 字节 | 3,455,055 | 0 | 100% |
| 　同上：CNG provider 打开次数 | 3 | 0 | 100% |
| 　同上：条目字节拷贝（substr） | 1,727,428 | 0 | 100% |
| `/api/tools`：读字节 | 1,727,627 | 1,727,627 | 0% |
| 　同上：SHA-256 字节 | 3,455,055 | 1,727,627 | 50% |
| 　同上：provider 打开 | 3 | 1 | 66.7% |
| `plugin list`：SHA-256 字节 | 3,455,055 | 3,455,055 | 0% |
| 　同上：provider 打开 / 条目拷贝 | 3 / 1,727,428 | 1 / 0 | 66.7% / 100% |
| **一次页面加载**（state+tools）：读字节 | 3,455,254 | 1,727,826 | 50% |
| 　同上：SHA-256 字节 | 6,910,110 | 1,727,627 | 75% |
| 　同上：provider 打开 / 条目拷贝 | 6 / 3,454,856 | 1 / 0 | 83.3% / 100% |

**SynMany.itbt**（合成 2002 条目）：fileSize 2,184,498 · headerSize 136,183 · payload 2,048,315

| 每条命令的工作 | 基线 | 候选 | 削减 |
| --- | --- | --- | --- |
| `int list` / `run` / `/api/state`：读字节 | 2,184,498 | 136,183 | 93.8% |
| 　同上：SHA-256 字节 | 4,232,813 | 0 | 100% |
| 　同上：provider 打开次数 | 2,003 | 0 | 100% |
| `/api/tools`：SHA-256 字节 | 4,232,813 | 2,184,498 | 48.4% |
| 　同上：provider 打开 | 2,003 | 1 | 100% |
| `plugin list`：SHA-256 字节 | 4,232,813 | 4,232,813 | 0% |
| 　同上：provider 打开 / 条目拷贝 | 2,003 / 2,048,315 | 1 / 0 | 100% / 100% |
| **一次页面加载**：读字节 | 4,368,996 | 2,320,681 | 46.9% |
| 　同上：SHA-256 字节 | 8,465,626 | 2,184,498 | 74.2% |
| 　同上：provider 打开 / 条目拷贝 | 4,006 / 4,096,630 | 1 / 0 | 100% / 100% |

这正是 §2 里 “`list` 只比 `--version` 多 4.5 ms”“2002 条目 `plugin list` 29.6 ms” 的来源：
被删掉的是整文件读+哈希、每条目 provider 打开与每条目拷贝；必须做的工作（真实容器的整文件哈希）
保留在 `/api/tools` 与 `plugin list` 上，没有为了数字而牺牲校验。

---

## 6. 复测（PENDING(受控窗口)）

运行单：`work/run-queue/prod-int-task23.md`（冻结校验 → 构建 → compare/e2e 回归 → `ab.mjs` 交替计时 →
UI/内存 → 残留核对 → 回填本报告所有 PENDING 占位）。
`ab.mjs` 只 spawnSync 两个 `int_cli.exe`，命令为 `--version`/`list`/`plugin list`/`plugin verify`，
无 `--serve-ui`、无浏览器；UI 指标可选（`--serve-ui` 仅 127.0.0.1 环回、无窗口，2.5 s 内 Kill）。
另外在 UI 步骤会**逐字节比较两个二进制的 `/api/state` 与 `/api/tools` 响应体**，补上 CLI 对比未覆盖的 API 面。

---

## 7. 风险、交接与未完成

- **exe 字节**：候选中间构建 684,032 B vs 基线 677,888 B（+6,144 B，+0.91%）；
  最终值待 §6 重建。增量来自新增的 `readItbtHead` / `parseItbtBuffer` 包装 / `Sha256` 类。
  NSIS 用 `SetCompressor /SOLID lzma`，发行包增量预计远小于源码增量（待 task-31 验证）。
  继续压体积需要在 `cpp/CMakeLists.txt` 加 `-ffunction-sections -fdata-sections -Wl,--gc-sections`；
  该文件被 6 个应用共用、**不在本任务写作用域**，未改，作为交接项。
- **发行包口径**：`cpp/out/int/*.exe`（596,480 B）与 `cpp/release/v1.0pre4/InfinityToolbox_1.0.0-pre4_win64_setup.exe`（262,473 B）
  都是 2026-10-03 21:07 的产物，早于 10-04 16:31 的 `sync` 提交（.itbt 功能入库），与当前源码构建 677,888 B 不一致。
  Lead 已登记 task-31 统一重建发布；“同源码口径”的 before/after 包字节只能在 task-31 里产生。
- `/api/tools` 仍计算整文件 SHA-256（为不改 JSON 载荷、保留 `sha256` 字段）。
  若确认无人消费该字段，可再省一次整文件读 + 哈希（候选可到“只读 header”）。
- 2002 条目夹具是合成的极端值（真实插件 1–2 条目）；真实收益主要是“枚举不再读整个容器”。
- `Names` 模式下，头部合法但 payload 损坏的容器在 `int list`/`/api/tools` 里不带“invalid”标记——
  这与基线行为**一致**（这两处本来就不显示校验结论）；`plugin list`/`info` 仍做完整校验。
- 运行禁令解除后若要回填 §0/§6，按运行单执行并把结果发回 prod-int（或由执行者直接改本报告对应占位）。
