# 流式预览（Infinity Cloud / INC）— task-1 实测交付报告

**状态：实现完成，本地端到端实测通过（19 项 C++、14 项 wire、15 项页面侧、3 条目 CRC 校验全部 pass）。**
本文件替换同路径下的旧版静态交付报告（task-32，全部数字为 PENDING）；旧版列出的偏差①②③在本版已实现或被实测覆盖，见 §7。

- 仓库根：`D:\dev\DeepSeekHarnessWorkspace\Infinity.inc`（Windows）
- 本次会话所有写操作都在 `Infinity Cloud/` 内，外加本报告 `work/preview-inc-report.md`。未改 `cpp/`、未改 ING / Infinity Games、未改 `history/` 与 `work/sync-history.mjs`、`work/ghsync.mjs`。
- 未联网、未安装任何依赖；只用本机 node v24（D:\program\nodejs\node.exe）、MinGW g++ 16.1.0、Windows PowerShell 5.1。
- 未执行 `apply-preview.mjs --write`，因此 `cpp/apps/inc/{main.cpp,ui.hpp,preview.hpp}` 保持原样（见 §6 遗留 1）。

---

## 1. 改前现状（读文件得到的事实）

| 文件 | 改前字节 | 事实 |
|---|---|---|
| [cpp/apps/inc/preview.hpp](../../cpp/apps/inc/preview.hpp) | 19178 | 已有 256 KiB 读取器雏形：previewRead/assetWindow/rangeRequest、8 s/2 次重试、zip 尾部中央目录解析、类型分派；**没有任何调用方** |
| [Infinity Cloud/preview/preview.hpp](preview.hpp) | 19178 | 与上者逐字节相同（副本） |
| [Infinity Cloud/preview/apply-preview.mjs](apply-preview.mjs) | 21878 | 补丁器：5 处插入（main.cpp 的 include+路由、ui.hpp 的标记/样式/脚本），锚点唯一才写；资产以模板字符串内联 |
| [Infinity Cloud/preview/generated/main.cpp](generated/main.cpp) | 46262 | 已生成但从未编译 |
| [Infinity Cloud/preview/generated/ui.hpp](generated/ui.hpp) | 29180 | 同上 |
| [Infinity Cloud/preview/preview.patch](preview.patch) | 15061 | 5 hunk / 2 文件 |
| [Infinity Cloud/preview/verify-preview.ps1](verify-preview.ps1) | 7399 | 运行计划，指向真实账号与 >=50 MB 样片，**未执行**；本次未改动它 |

`cpp/CMakeLists.txt` 里 `apps/inc` 目标存在，说明补丁能随产品树编译（§5.1 已实测）。

## 2. 缺口（读代码 + 实测发现，共 8 条）

1. **256 KiB 分块只是默认值**：`/api/preview/chunk` 允许单次 length 最大 1 MiB，`previewRead` 对一次请求只发一个 Range，可能一次拉 1 MiB。
2. **8 s 超时实际不生效**：`httpRequest` 用 `WinHttpSetTimeouts`，但服务器压住响应头时 WinHTTP 不触发 receive 超时。实测探针（build/timeout_probe.cpp）：服务器延迟 3000 ms、timeoutMs=500，仍 `status=200 ms=3052`。
3. **取消不能作用于在途请求**：cancel 只在发下一块之前检查，首屏块一旦发出最坏要等服务器应答。
4. **取消标志是全局的且只在 meta 里复位**：任何一次关闭后，下一次预览的 chunk 会以 499 结束。
5. **zip 只列目录，不能按需取条目**：没有任何取条目的路由。
6. **zip EOCD 反向搜索不校验注释长度**：注释里出现 EOCD 签名时会命中假记录（夹具专门构造了这种注释，改前实测报错 `the central directory runs past the tail`）。
7. **文本 2 万行不是虚拟化**：旧实现超过 2 万行从头部 removeChild 丢掉，DOM 仍随行数线性增长。
8. **补丁器不携带 preview.hpp**：`--write` 不会把 `preview/preview.hpp` 复制到 `cpp/apps/inc/`，只 apply patch 的树缺头文件无法编译。

## 3. 改动（全部在 `Infinity Cloud/preview/`）

| 文件 | 新字节 | sha256 | 干了什么 |
|---|---|---|---|
| [preview.hpp](preview.hpp) | 26554 | b93fe348492be855a287363e7ac7852962e79f1b935e953395cf45f33c0606cd | 缺口 1/2/3/6：previewRead 强制按 256 KiB 拆 Range；新增 previewHttpGet（工作线程 + 硬 deadline + 取消轮询）替换 range 路径的 httpRequest；EOCD 校验 i+22+commentLen==size；cancelCheck；zipLocalHeader/previewZipTail |
| [assets/preview-routes.inc](assets/preview-routes.inc) | 9420 | 1617b01bb7adcd10926946278987eb0a86ab2054b6c244234188d542de2c2d22 | 缺口 4/5：epoch 取消；/api/preview/zip/entry 读 30 字节本地头→dataOffset→按 256 KiB 拉压缩字节（<=64 MiB） |
| [assets/preview-math.js](assets/preview-math.js) | 3132 | d33e0b684a12c03998932cb62c9e13ea2eb9c3089dbbd65fe73f21cec0e6edce | 缺口 7：pvWindow、pvChunk、pvRetain、pvDataOffset；可在 node 里直接测 |
| [assets/preview-ui.js](assets/preview-ui.js) | 13153 | 5c81e32f5493f7c7653b8792752a59a6a544f77854e890a9e164fd22ed1c77d0 | 缺口 3/5/7：绝对定位虚拟列表（20000 行只挂 ~51 个行节点）、zip 列目录后点条目按需取、DecompressionStream('deflate-raw') 页面侧解压、AbortController+epoch cancel、64 MiB 停止 |
| [assets/preview-ui.html](assets/preview-ui.html) | 389 | c9a96d316cb8931ddf20b176a2ba6220698f28685ffb9e5a48ca5ab072f93d9d | 预览覆盖层标记 |
| [assets/preview-ui.css](assets/preview-ui.css) | 1196 | cb51c7482b3c6daadfec003226ca916dcea14adabfaf51c7b1a24385b30326a9 | 预览覆盖层样式（.pv-line 固定 18px 行高） |
| [apply-preview.mjs](apply-preview.mjs) | 7061 | b764a2b1a992ab02d7456fd4c71f7f509adb3f3af3a382eb92c03c66ad13c728 | 改为读取 assets/（同一 JS 既进页面又可被 node 测试）；--write 时同时复制 preview.hpp（缺口 8）；总是写 generated/preview.hpp |
| [generated/main.cpp](generated/main.cpp) | 50781 | 943df724dc74392e02a2bf6a2ca5594d764aec145f723b90bd11b7ebe68a14ea | 生成物：178 行路由 |
| [generated/ui.hpp](generated/ui.hpp) | 38082 | 47b696d8077e56e934afaa2cacb1e674cdaee48e8a16606d32f9c17538cd9115 | 生成物：标记 10 + 样式 15 + 模块 391 行 |
| [generated/preview.hpp](generated/preview.hpp) | 26554 | b93fe348...（同 preview.hpp） | 生成物：头文件副本，供不动产品树的外挂编译 |
| [preview.patch](preview.patch) | 28768 | fc2eb16d41913e1c33e8438309aa3f5b3c98f2a3fb853b61cd76065e5e686367 | 635 行 unified diff（5 hunk） |
| [tests/preview_harness.cpp](tests/preview_harness.cpp) | 14407 | 8ef83567d395fdc37bec2be585698caaf18991309a8e03b6571a59b79c11cd7e | 19 项检查的 C++ harness |
| [tests/range-server.mjs](tests/range-server.mjs) | 5828 | befc26f6520b424cda0566abd9d10d30388fbf67765b47bfad8f95a793dec667 | 本地 Range 服务器（206/416/503、延迟、请求日志 JSONL） |
| [tests/make-fixtures.mjs](tests/make-fixtures.mjs) | 7584 | da3f3f5d747b8e95e0de752457cea57bc536780b0105ab5d16c22e4c2802a399 | 自写 ZIP 写入器+crc32；注释里埋 EOCD 签名 |
| [tests/verify-entry.mjs](tests/verify-entry.mjs) | 2386 | e1a9ce34271dd06b8464f14ea8e69fb80fba79ee282b2e70c6baf3204df152e0 | 条目 inflate + CRC/长度校验 |
| [tests/check-requests.mjs](tests/check-requests.mjs) | 6020 | 5039ed11fd36f46ba0693aecdfe3fe0c984498769dad69d77a1d902db44f133a | wire 级断言（窗口宽度/次数/尾读偏移） |
| [tests/ui-preview.test.mjs](tests/ui-preview.test.mjs) | 6608 | 9390bada56e25506aa740d3bb27d6d7e57051c76a3d7a9d9ee4f9ee355003fba | 页面侧纯函数 + DecompressionStream 单测 |
| [tests/run-tests.ps1](tests/run-tests.ps1) | 8835 | 79640670cd816783b506a3068f312bed7bfb5f4353e95fa1189c3ff8b63b94d1 | 一键：生成→编译整包+harness→起服务器→跑全部→按 PID 收尾→sha256 |

产物二进制（仅本机验证用）：
- `Infinity Cloud/preview/build/inc-preview.exe` 3413282 B sha256 `af3c0f2e82a02cd7dacc83743d8ff02e2c1af0edc4ed05f32edc1cfddd0ef6a0`
- `Infinity Cloud/preview/tests/_out/preview_harness.exe` 3238366 B sha256 `f2f86971a11cd59232fbfc6cc7d826da14b7e063b8b696c300b3422e199ce547`

## 4. 复现命令

```powershell
# 一键全量（约 80 s 编译 + 40 s 测试；-With8s 会真跑 8 s 超时 3 次，多约 25 s）
& 'Infinity Cloud\preview\tests\run-tests.ps1' -With8s

# 只生成 generated/ + preview.patch
& 'D:\program\nodejs\node.exe' 'Infinity Cloud\preview\apply-preview.mjs'

# 夹具
& 'D:\program\nodejs\node.exe' 'Infinity Cloud\preview\tests\make-fixtures.mjs'

# 整包编译（一条命令；run-tests.ps1 内部同样参数）
g++ -std=c++17 -O2 -I 'Infinity Cloud\preview\generated' -I 'cpp\core\include' -I 'cpp\common' 'Infinity Cloud\preview\generated\main.cpp' cpp\core\src\*.cpp cpp\common\unblock.cpp -o 'Infinity Cloud\preview\build\inc-preview.exe' -static -static-libgcc -static-libstdc++ -lwinhttp -lbcrypt -lshell32 -lcomctl32 -lws2_32 -lgdi32 -lcomdlg32 -lole32 -luser32 -loleaut32 -luuid
```

日志与完整 stdout：`Infinity Cloud/preview/tests/_out/final-run.txt`、`requests.jsonl`、`sha256.txt`、`app-compile.log`、`harness.jsonl`。

## 5. 实测证据

### 5.1 编译

| 目标 | 结果 | 耗时 | 警告 |
|---|---|---|---|
| 整包 INC（generated/main.cpp + core + common） | exit=0，3413282 B | 38771 ms | 1（cpp/core/src/store.cpp:174 mergeObject defined but not used，与本补丁无关） |
| harness | exit=0 | 34659 ms | 1（同上） |

补丁确实进了产物二进制（对 exe 做 ASCII 计数）：`/api/preview/meta`=2、`/api/preview/chunk`=3、`/api/preview/zip`=4、`/api/preview/zip/entry`=2、`/api/preview/cancel`=2、`X-Zip-Method`=2、`deflate-raw`=1、`pv-line`=4。

### 5.2 C++ harness（19 项，fail=0）

| 检查 | 实测 |
|---|---|
| defaults | chunkBytes=262144 timeoutMs=8000 retries=2 zipTailBytes=65536 |
| chunk1（首窗） | **262144 B / 40 ms** |
| oversize-request-split | 请求 786432 B → 恰好 3 个 262144 窗口 |
| full-big | 5242880 B / **311 ms** / 20 窗口 |
| retry-after-two-failures | 前两次 503，第 3 次成功，512 ms |
| timeout-with-two-retries | timeoutMs=800 → 失败 timeout after 800 ms，2893 ms（=3 次尝试） |
| **timeout-8s-default** | 真实默认 8000 ms → 失败 timeout after 8000 ms，**24479 ms**（3 次 x 8 s） |
| cancel-flag / cancel-epoch | 均 cancelled，服务器 0 请求 |
| cancel-in-flight | 延迟路径在途 483 ms 返回 cancelled（不是等服务器 2 s） |
| zip-tail-64k | 4 条目（含注释里埋的假 EOCD 被拒），**16 ms** |
| zip-entries | hello.txt(8,142,off 0)、stored.txt(0,1050,off 181)、data.bin(8,717020,off 1271)、empty.txt(0,0,off 718329) |
| zip-entry-hello.txt | dataOffset=39（期望 39），142 B |
| zip-entry-stored.txt | dataOffset=221（期望 221），1050 B |
| zip-entry-data.bin | dataOffset=1309（期望 1309），717020 B（3 个 <=256 KiB 窗口） |

### 5.3 wire 校验（14 项，fail=0，46 个请求）

- 没有任何 Range 跨度 > 262144（violations=0；44 个 206 全部单窗）。
- `big.bin` 恰好 20 个请求、字节和 5242880 = 文件大小。
- `retry.bin` 状态序列 503,503,206；slow.bin/slow8.bin 各 3 次尝试（1+2 重试）。
- `cancel.bin` 0 请求；`cancel2.bin` 恰好 1 请求（在途被取消，未重试）。
- `sample.zip` 第一个请求 start=653268 span=65536（= size-64 KiB），除条目区间外无其他读取（strays=0）。
- data.bin 条目：header 30 B + 717020 B / 3 窗口；hello/stored 各 1 窗口。

### 5.4 条目解压校验（inflate + CRC，3/3 pass）

| 条目 | compressed | inflated | CRC 期望=实得 |
|---|---|---|---|
| hello.txt (deflate) | 142 | 830 | 1076188391 = 1076188391 |
| stored.txt (stored) | 1050 | 1050 | 811678784 = 811678784 |
| data.bin (deflate) | 717020 | 716800 | 3714276340 = 3714276340 |

### 5.5 页面侧（node 单测 15 项，fail=0）

- `pvWindow(20000, 0, 600, 18, 8)` → 只挂 **51 行** DOM（20000 行滚动窗口化）；顶部/中部/底部/空表边界均正确。
- 5 MiB 按 pvChunk 循环 = 20 窗、和 = 5242880；末窗 100 B、越界 0。
- `pvDataOffset` 与 ZIP 中央目录记录逐条一致（hello=39、stored=221、data=1309、empty）。
- `DecompressionStream('deflate-raw')` 往返通过；用 harness 拉下的 142 B 压缩字节页面侧解压后 sha256 = 56aca3b9...c11b，与夹具明文一致。
- generated/main.cpp 含全部 5 条路由；generated/ui.hpp 含 pvWindow( / AbortController( / DecompressionStream / PV_MAX_LINES / pv-line。

## 6. 遗留问题（未做/未验证）

1. **没有改产品树**：硬约束只允许动 `Infinity Cloud/`，所以没有执行 `apply-preview.mjs --write`。要落盘，Lead 批准后运行 `node "Infinity Cloud/preview/apply-preview.mjs" --write`（会写 cpp/apps/inc/main.cpp、ui.hpp、preview.hpp；锚点唯一性已由无参运行验证）。
2. **未连真实 GitHub**：assetDownloadUrl（Accept: application/octet-stream、302 签名直链、403/404 过期重解析）只在代码路径上成立，未在真实账号/资产上跑；本次全部用本地 Range 服务器。真实 >=50 MB 样片、>=3 类真实文件演示仍未做。
3. **64 MiB 内存上限没有进程级实测**：客户端常量 PV_MAX_BYTES=64 MiB、服务端单条目 64 MiB 上限均有代码与停止逻辑，但未测 RSS。
4. **WinHTTP 底层请求不能真正中止**：previewHttpGet 用 detach 工作线程 + 共享状态保证不悬垂、调用方按时返回（8 s/取消），但被放弃的底层请求仍会跑到服务器应答结束（实测延迟 9 s 时 3 次尝试共 24.5 s，线程在这期间存活）。要彻底可中止需改成 WinHTTP 异步回调/OVERLAPPED。
5. **zip 覆盖范围**：Zip64（0xFFFFFFFF 字段）与 data descriptor（flag bit 3，压缩尺寸写在数据后）未做夹具覆盖。
6. **无浏览器端到端**：未启动 Electron/Chromium，虚拟滚动的视觉效果、页面内 DecompressionStream、真实 Blob 媒体解码只做了等价的 node 单测；也没有截图。
7. 旧报告偏差 4（预览与主窗口共用同一队列/进度）未涉及：预览是覆盖层，进度条在预览内，主列表状态未联动。
8. 未改 verify-preview.ps1（旧运行计划保留）；本次新增的 run-tests.ps1 是离网可复现的替代。

## 7. 与旧静态报告（task-32）的差异

- 偏差 1（文本虚拟化只是封顶 2 万行）→ 改为真正的窗口化渲染（DOM ~51 节点，行保留上限仍 20000）。
- 偏差 2（在途请求无法取消）→ 取消现在在途生效（实测 483 ms 返回）；但底层同步 WinHTTP 仍不能被打断（遗留 4）。
- 偏差 3（64 MiB 上限）→ 客户端与服务端上限常量落地，实测仍缺（遗留 3）。
- 契约项"分块 256 KiB"与"8 s 超时"从静态实现变为**有 wire 证据**：所有 Range <=262144；8 s 默认超时实测 24479 ms 后失败并报错（旧实现实测不超时）。
- 新增：zip 条目按需拉取（路由 + 页面解压 + CRC 校验）；EOCD 注释伪造签名校验。

---

## 8. task-18 补章：zip64 / data-descriptor / 取消语义 / 8 s 超时覆盖补强（2026-10-06）

**状态：全绿。`run-tests.ps1 -With8s` → failures=0，exit 0。** 本章记录上一版验收之后补的测试与实现，以及上一版 §6 遗留 4/5 的处理结果。硬约束遵守：只改 `Infinity Cloud/preview/**`、`cpp/apps/inc/preview.hpp` 与本报告；未碰 ING / Infinity Games、`history/`、`work/sync-history.mjs`。

### 8.1 命令与退出码

```powershell
& '.\Infinity Cloud\preview\tests\run-tests.ps1' -With8s
# RESULT failures=0 ... 脚本 exit 0
```

| 步骤 | 退出码 |
|---|---|
| apply-preview.mjs（生成 generated/、preview.patch） | 0 |
| make-fixtures.mjs（含新增 3 个 zip 夹具） | 0 |
| g++ 整包 INC（generated/main.cpp + core + common） | 0（warnings=1，仍是 store.cpp:174 mergeObject 未用） |
| g++ harness | 0（warnings=1，同上） |
| preview_harness.exe | 0（summary fail=0） |
| verify-entry.mjs ×6 | 0/0/0/0/0/0 |
| check-requests.mjs | 0（wire-summary fail=0） |
| ui-preview.test.mjs | 0（ui-summary fail=0） |
| 汇总 RESULT | **failures=0** |

编译耗时：app 37717 ms、harness 27436 ms（本机，-O2）。完整 stdout：`tests/_out/final-run.txt`、`tests/_out/run.log`。

### 8.2 覆盖率变化（同口径：JSON 结果行）

| 套件 | 本次复跑前实测 | 改后 | 增量 |
|---|---|---|---|
| C++ harness 结果行 | 15 | **23** | +8（新增 descriptor-zip-tail、zip64-zip-tail、zip64-placeholder-rejected、zip64-locator-missing、cancel-no-partial-output；原 3 个条目拉取改为统一 pullEntry 断言） |
| wire（check-requests） | 14 | **25** | +11（取消两段各 1 项、descriptor.zip 3 项、zip64.zip 4 项、夹具特征 2 项） |
| 页面侧（node） | 15 | **17** | +2（zip-data-offset-descriptor.zip、zip-data-offset-zip64.zip） |
| 条目 CRC/长度校验 | 3 | **6** | +3（desc-stored.bin、z64-hello.txt、z64-big.bin） |
| 服务器请求数 | 46 | **63** | +17 |

（上一版 §5.2 写的“19 项 C++”是另一种口径；这里统一数 JSON 结果行，便于逐条对比。）

### 8.3 缺口 (a)：data-descriptor 覆盖

- 夹具 `tests/_fixtures/descriptor.zip`（307630 B）：两条目，本地头 flag bit 3=0x0008，本地 crc/size 写 0，数据后跟 16 B 描述符（签名 0x08074b50 + crc + 2×4 B 尺寸）。
- 实现：`preview.hpp` 新增 `ZipLocalHeader::dataDescriptor`（读 bit 3）。读取路径本来就用中央目录的 CRC/尺寸，描述符不参与读取。
- 断言：
  - `descriptor-zip-tail`：2/2 条目 name/method/compressed/uncompressed/headerOffset 与夹具逐条一致。
  - `zip-entry-desc-stored.bin`：dataOffset=247=期望，descriptor=true，307200 B（2 窗口）。
  - wire：`descriptor.zip-tail-first-64k`（start=242094 span=65536）、条目窗口 2 个、`descriptor.zip-touches-nothing-else` strays=0，即两条目之间的 16 B 描述符从未被读。
  - `verify-entry desc-stored.bin`：inflate + 长度 + CRC 全通过。

### 8.4 缺口 (b)：zip64 覆盖（能支持则支持，不能支持必须可区分报错）

- 夹具 `tests/_fixtures/zip64.zip`（717522 B）：普通 EOCD 写 0xFFFF/0xFFFFFFFF，真实目录 size/offset 在 zip64 EOCD 记录（0x06064b50）+ 定位器（0x07064b50）；其中 `z64-big.bin` 条目级也是 zip64（中央目录 3 个字段 0xFFFFFFFF，真实值在 extra 0x0001）。
- **实现从“直接报 Broken”改为真正支持**：`zipEntriesFromTail` 先解出 zip64 EOCD 记录的目录 size（+40）与 offset（+48），再走原中央目录解析；尾窗不够时返回 NeedsMore，让 `previewZipTail` 继续按 4 倍扩窗。
- 断言：
  - `zip64-zip-tail`：2/2 条目一致，`z64-big.bin` 的 `zip64=true`。
  - `zip-entry-z64-big.bin`：headerOffset=185、dataOffset=246=期望、compressed=717020（3 窗口）；`z64-hello.txt` dataOffset=43。
  - wire：`zip64.zip-tail-first-64k`（start=651986 span=65536）、条目窗口 1+3、strays=0。
  - `verify-entry z64-hello.txt / z64-big.bin` CRC 全通过 → 拉到的就是正确数据，不是占位值。
- **负例（可区分错误，绝不静默错数据）**：
  - `zip64-placeholder-rejected`：`zip64bad.zip`（178 B）在中央目录声明 zip64 但不写 extra 字段 → `previewZipTail` 失败，error = `entry "bad-declared.bin" carries a 32-bit zip64 placeholder that no extra field fills`；新代码同时拦截“extra 字段太短”的情况。
  - `zip64-locator-missing`：手工构造 22 B EOCD（0xFFFFFFFF、无定位器）直接调用 `zipEntriesFromTail` → `Broken`，error = `the archive declares zip64 but carries no zip64 end of central directory locator`。
  - 路由层沿用既有 `uiFailure(why, 502/504)`，错误文本原样到 API，调用方能区分“坏 zip64”与“不是 zip”。

### 8.5 缺口 (c)：取消语义（无法中止底层传输，就必须不返回成功、不写出）

- 事实不变：`previewHttpGet` 仍是工作线程 + detach；底层同步 WinHTTP 请求无法真正 abort（上一版遗留 4）。本次把契约落到两条可测不变量：
  1. 取消后 `previewRead` 必须返回 false 且 error==`cancelled`，绝不返回成功；
  2. 取消后不得把已拼好的部分数据交给调用方（`*out` 只在全部读完后一次性赋值）。
- 新测试 `cancel-no-partial-output`：两段式 manifest（第 1 段 `cancelpart.bin` 立即返回，第 2 段 `cancelpart2.bin` 服务器延迟 2000 ms），300 ms 时置取消位；实测 `ok=false ms=462 out=8 error=cancelled`——调用方传入的 8 B 哨兵原样保留，部分数据未写出、未返回成功。
- wire：`cancel-partial-first-one-request`=1、`cancel-partial-second-one-request`=1 → 在途请求被取消后没有重试、没有更多请求。
- 既有 `cancel-in-flight`（ms=482）与 `cancel-flag` / `cancel-epoch` 仍通过。
- 路由：`/api/preview/chunk|zip|zip/entry` 在 `closedByUser()` 为真时提前返回 499，`previewRead` 取消时也映射 499；页面侧 AbortController + epoch 逻辑未变。

### 8.6 8 s 默认超时：把 24479 ms 变成有上界的断言

- 契约是“每块 8 s、两次重试”，因此默认超时整次失败 = (1+2)×8000 ms + 两次退避（150/300 ms）。
- 实测 `timeout-8s-default`：**ms=24496，bound=25500**，error=`timeout after 8000 ms`；`timeout-with-two-retries` 同样加 bound=3900（实测 2881）。测试断言 `ms<=bound`，即“有界失败”而非任意挂起。
- wire 侧 `timeout-8s-three-attempts` 仍为 3 次尝试。结论：24479 ms 不是超时失效，是 3 次 × 8 s 的契约成本；真正的行为回归（无界挂起）现在会被 bound 断言挡住。

### 8.7 文件与哈希（本次运行后实测）

| 文件 | 字节 | sha256 |
|---|---|---|
| `Infinity Cloud/preview/preview.hpp` | 29658 | b5004e1e93dc4965c99ed94f0c1290eb721b0df93a2865f7b48a538d3cb0817a |
| `cpp/apps/inc/preview.hpp` | 29658 | b5004e1e...（与上者逐字节相同，已同步进源码树） |
| `Infinity Cloud/preview/generated/preview.hpp` | 29658 | b5004e1e... |
| `Infinity Cloud/preview/tests/make-fixtures.mjs` | 15320 | ab63c99f856c392e6bef2f7177bcb950709de9d25215c3b80e6b464138bf214c |
| `Infinity Cloud/preview/tests/preview_harness.cpp` | 22767 | 3649b3b942db9c6f8076b8eb1434096e5e9517c82dacb48052508a22ec9525a2 |
| `Infinity Cloud/preview/tests/check-requests.mjs` | 9253 | 427f8286905dae7371c56a1ec804ee795b67a8b07cf984d7269c6bcef46342a1 |
| `Infinity Cloud/preview/tests/ui-preview.test.mjs` | 7113 | 1ec2f8e12795e61ccb74589c3de72feef59ada08393b5e62429f88040f47b64e |
| `Infinity Cloud/preview/tests/run-tests.ps1` | 10501 | 255a18bc567a50b4c2160db090a51aa424ef10379edc398eeb4f32501bb791cf |
| `Infinity Cloud/preview/tests/_fixtures/descriptor.zip` | 307630 | cc376f79a9feb66d09fe54803d3318df32df31fd27720a325007e6c3ba82fa3e |
| `Infinity Cloud/preview/tests/_fixtures/zip64.zip` | 717522 | 135ee24fafed27ffd275775787099a5dae310a5fb2dc7fef78bd2e0a42bf5ace |
| `Infinity Cloud/preview/tests/_fixtures/zip64bad.zip` | 178 | 355e598eb1b69f4a6932d2f7e5ab276a9dcb44bca708f30496d53be16e9d71ec |
| `Infinity Cloud/preview/build/inc-preview.exe` | 3414598 | 9ec209e594721ff19094d6b83d964a468d2504cb5077426eb5fe4a0bc9cf4123 |
| `Infinity Cloud/preview/tests/_out/preview_harness.exe` | 3253341 | bcffede127be5f1d9b563571181a5c0195cf60082736815663aafe7fda1c76d9 |

未改动：`assets/preview-routes.inc`、`apply-preview.mjs`、`preview.patch`、`generated/main.cpp`、`generated/ui.hpp`、`range-server.mjs`、`verify-entry.mjs`。`sample.zip` 逐字节不变（sha256 8f0f92d7...551ca），因此原有 wire 断言语义未变。

### 8.8 遗留（本章新增/收敛）

1. **底层传输仍不可中止**：取消现在保证“不返回成功、不写出部分结果、不再发请求”，但被 detach 的 WinHTTP 工作线程仍会跑到服务器应答结束才回收（延迟 2 s 的用例里线程多活约 1.5 s）。彻底中止需改 WinHTTP 异步/OVERLAPPED，本次未做。
2. **zip64 目录窗口未做一次定位优化**：zip64 EOCD 记录在尾窗内解析；若中央目录本身极大，仍按 4 倍扩窗直至整文件。
3. **zip64 版 data descriptor 未单独测**：解析不读描述符，测试只覆盖 32 位描述的 descriptor 与 zip64 尺寸两种特征各自独立的用例；风险低但非零。
4. **8 s 默认仍是 3×8 s**：与契约一致，未改成总时限；若产品希望“8 s 内必须失败”，需要新增总 deadline 选项（会改变契约数字）。
5. 沿用上一版遗留：未连真实 GitHub、未做 64 MiB RSS 进程级实测、无浏览器端到端/截图（仅 node 等价单测）。

