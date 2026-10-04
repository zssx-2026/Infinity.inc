# .itbt 实现与验证报告（Infinity Toolbox）

日期：2026-10-04  ·  工作目录：D:\dev\DeepSeekHarnessWorkspace\Infinity.inc
契约：work/ITBT-FORMAT.md（本实现严格照做，未自创字段）

## 1. 改动清单

| 文件 | 动作 |
| --- | --- |
| cpp/tools/itbt/itbt-pack.cpp | 新增：C++17 打包器，自实现 SHA-256，无第三方库 |
| cpp/apps/int/main.cpp | 扩展：.itbt 解析/逐条校验/原子解包/首次使用解包；Plugin 结构扩展；scanPlugins 扫描容器并去重；int plugin list\|install\|verify |
| cpp/CMakeLists.txt | 新增 host tool 目标 itbt-pack |
| work/itbt/FastBrowser.itbt | 产物：真实样例容器 |
| work/itbt-report.md | 本报告 |

未触碰：cpp/release/（v1.0pre3、v1.0pre4 时间戳仍为 10-02/10-03）、history/、web/、work/chromium-trim/、work/edge-ui/。全程未联网。

## 2. 格式实现要点

固定头 20 字节 + name/version/exe 三个 u16 长度字符串，随后 entry 表，随后 payload，全部小端显式写出（putU16/putU32/putU64，无结构体对齐）：

```
offset 0  char[4] "ITBT"
offset 4  u16 version=1
offset 6  u16 flags            bit0=1 表示存在 deflate 条目
offset 8  u32 headerSize       文件头 -> entry 表结束
offset 12 u32 entryCount
offset 16 u32 totalSize        整个文件字节数
offset 20 u16 nameLen + name；u16 verLen + version；u16 exeLen + exePath
entry 表：u16 pathLen + path, u64 offset, u64 storedSize, u64 rawSize, u8 sha256[32], u8 compression
payload：按 entry 表顺序
```

- 路径规则（写入与读取两侧都查）：必须相对、以 / 分隔、无 . 或 .. 组件、不含盘符冒号；插件 name 还必须是单一路径组件（否则不能做目录名）。打包器拒绝 ../evil.exe 已实测。
- SHA-256：打包器自实现（对照 Windows Get-FileHash 一致），loader 用 Windows CNG（BCryptHashData 对内存缓冲）。每条 entry 的“原始内容”哈希写入容器。
- 解析严格：先读 headerSize，name/version/exe 与 entry 表都不得越过 headerSize；entry 表必须正好结束在 headerSize；totalSize 必须等于实际文件大小；offset/storedSize 用无溢出的边界检查（offset > size || storedSize > size - offset）；store 条目要求 storedSize == rawSize；重复路径、未知 flags、未知 compression、exe 不在 entry 表内均报错。
- 原子解包：先写 <root>\<name>.tmp，全部写完并逐条校验后 MoveFileExW 改名为 <root>\<name>；已存在且校验一致则复用（不重写），不一致且无 --overwrite 则拒绝。
- 去重：容器与其解包出的同名同目录插件在 list 中合并为一行（容器行携带来源与 sha256）。
- 兼容：旧式「目录 + item.json」插件逻辑不变，scanPlugins 仍先扫目录；容器在其后扫描并合并。

## 3. deflate 的处理（重要限制）

MinGW 工具链（WinLibs UCRT GCC 16.1.0）**没有 zlib**：zlib.h / libz.a / libz.dll.a 均不存在，WinGet 下也只有这一个工具链，系统其它常见路径（Git、msys64、StrawberryPerl、vcpkg）也没有。按任务约定：

- 打包器接受 --deflate，但会明确提示无 zlib 并改为 store（compression=0），不假装压缩；
- loader 对 compression=1（raw deflate）条目**明确拒绝**并给出条目名：“entry 'fastbrowser.exe' is deflate-compressed (raw deflate) and this build has no zlib to inflate it”；
- 格式的 flags bit0 与 compression 字段已按契约保留，将来接入 zlib 只需替换这两处。

实测：把 exe 条目的 compression 字节改成 1，verify 按上述原文拒绝（见 6.I）。

## 4. 构建路径（可重复）

主路径：写进 cpp/CMakeLists.txt 的 host tool 目标（CMake 改动很小、风险低，因此没有另写 work/build-itbt.mjs）：

```
cmake -S cpp -B cpp/build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build cpp/build --target int itbt-pack
```

CMake 片段：

```
if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/tools/itbt/itbt-pack.cpp)
  add_executable(itbt-pack ${CMAKE_CURRENT_SOURCE_DIR}/tools/itbt/itbt-pack.cpp)
endif()
```

迭代期也用过等价的直接编译（结果一致，仅作备用）：

```
g++ -std=c++17 -O2 -Wall -Wextra -static -static-libgcc -static-libstdc++ -s \
    -o work/itbt/itbt-pack.exe cpp/tools/itbt/itbt-pack.cpp
```

工具链：g++.exe (MinGW-W64 x86_64-ucrt-posix-seh, built by Brecht Sanders, r4) 16.1.0；cmake 4.4.1；ninja 1.13.2。两处编译均 0 warning、0 error。

清空 cpp/build 后做了一次从零全量构建：默认并行度下 cc1plus 对 core/src/http.cpp、core/src/uiserver.cpp 报 out of memory（并行编译内存峰值，与本次改动无关）；改用 `cmake --build cpp/build -j 2` 后全量构建通过，6 个应用（inc/ifm/ipm/iim/int/ing）与 itbt-pack 全部产出，仅 core/src/store.cpp 有一个既有的 unused-function 警告。日常增量构建（只改 main.cpp）不受影响。

## 5. 样例产物

打包命令：

```
cpp/build/itbt-pack.exe --dir work/itbt/build/FastBrowser --out work/itbt/FastBrowser.itbt \
    --name FastBrowser --version 1.0.0 --exe fastbrowser.exe
```

输出：

```
itbt-pack  FastBrowser  v1.0.0
  item.json                                        83 B  store  132d02f2ecf333ac13c2a21cc8fb437de32f9662f4ca371eaafe3db98afe0f97
  fastbrowser.exe                             1727345 B  store  720d7a232139be937e88c5d0407954514bed97f6f6659270727127854004b84e
wrote work/itbt/FastBrowser.itbt  1727627 B  2 entries  exe=fastbrowser.exe
itbt sha256 ae92a86a36f892a9615a3e895765118dc1669ecbf28e7b25c91ab32f48862e40
```

字节数：源 fastbrowser.exe = 1,727,345 B；容器 = 1,727,627 B。开销 282 B = headerSize 199 + item.json 83；headerSize 199，entry 偏移 item.json=199、fastbrowser.exe=282。
SHA-256：
- fastbrowser.exe 源 = 720d7a232139be937e88c5d0407954514bed97f6f6659270727127854004b84e
- item.json 内容 = 132d02f2ecf333ac13c2a21cc8fb437de32f9662f4ca371eaafe3db98afe0f97
- FastBrowser.itbt = ae92a86a36f892a9615a3e895765118dc1669ecbf28e7b25c91ab32f48862e40

源目录没有 item.json，打包器按参数生成并写进容器：

```
{
  "name": "FastBrowser",
  "version": "1.0.0",
  "filename": "fastbrowser.exe"
}
```

## 6. 验证（原始命令与输出）

int.exe：cpp/build/int.exe（CMake/Ninja Release）。插件根：C:\Users\REDMI\AppData\Local\Infinity.Inc\plugin（原本为空，未影响既有插件）。

### A. 往返：解包后逐文件 sha256 与源一致

```
PS> & cpp/build/int.exe plugin install work/itbt/FastBrowser.itbt
installed FastBrowser  1.0.0
  entries 2  raw 1.6 MB  container 1.6 MB
  exe     fastbrowser.exe
  path    C:\Users\REDMI\AppData\Local\Infinity.Inc\plugin\FastBrowser
  sha256  ae92a86a36f892a9615a3e895765118dc1669ecbf28e7b25c91ab32f48862e40

PS> (Get-FileHash -Algorithm SHA256 "$log\FastBrowser\fastbrowser.exe").Hash.ToLower()
720d7a232139be937e88c5d0407954514bed97f6f6659270727127854004b84e
PS> (Get-FileHash -Algorithm SHA256 "$log\FastBrowser\item.json").Hash.ToLower()
132d02f2ecf333ac13c2a21cc8fb437de32f9662f4ca371eaafe3db98afe0f97
```

与容器内记录的 720d...b84e / 132d...0f97 逐条一致。（源目录本无 item.json，其“源”即容器内生成的那份。）

### B. 改坏 1 字节：verify 必须失败并指出条目名

对 fastbrowser.exe payload 第 1000 字节取反（文件偏移 282+1000）：

```
PS> & cpp/build/int.exe plugin verify work/itbt/FastBrowser-corrupt-exe.itbt
container work/itbt/FastBrowser-corrupt-exe.itbt
  name    FastBrowser  1.0.0
  exe     fastbrowser.exe
  entries 2  1.6 MB
  ok    item.json                           83 B        132d02f2ecf333ac13c2a21cc8fb437de32f9662f4ca371eaafe3db98afe0f97
  FAIL  fastbrowser.exe                     1.6 MB      80ea1f9f4672fe7b5cf8ce8e6de571cd3d1e15cea78da18d320637a752ee96e4
        expected 720d7a232139be937e88c5d0407954514bed97f6f6659270727127854004b84e
verification failed
exit=1
```

再对一个位于 item.json 的字节做同样处理，失败条目正确地变成 item.json：

```
PS> & cpp/build/int.exe plugin verify work/itbt/FastBrowser-corrupt-json.itbt
container work/itbt/FastBrowser-corrupt-json.itbt
  name    FastBrowser  1.0.0
  exe     fastbrowser.exe
  entries 2  1.6 MB
  FAIL  item.json                           83 B        bbea049862c5989a22e0c194ade8759eb3cd127daef1779c6807a2114316235d
        expected 132d02f2ecf333ac13c2a21cc8fb437de32f9662f4ca371eaafe3db98afe0f97
  ok    fastbrowser.exe                     1.6 MB      720d7a232139be937e88c5d0407954514bed97f6f6659270727127854004b84e
verification failed
exit=1
```

### C. 容器插件的 list / verify

容器放入插件根后（安装后仍在，作为签名原件）：

```
PS> & cpp/build/int.exe plugin list
NAME              VERSION     FILE                      SOURCE                                        STATUS
FastBrowser       1.0.0       fastbrowser.exe           FastBrowser.itbt  sha256 ae92a86a             installed

PS> & cpp/build/int.exe plugin verify FastBrowser
container C:\Users\REDMI\AppData\Local\Infinity.Inc\plugin\FastBrowser.itbt
  name    FastBrowser  1.0.0
  exe     fastbrowser.exe
  entries 2  1.6 MB
  ok    item.json                           83 B        132d02f2ecf333ac13c2a21cc8fb437de32f9662f4ca371eaafe3db98afe0f97
  ok    fastbrowser.exe                     1.6 MB      720d7a232139be937e88c5d0407954514bed97f6f6659270727127854004b84e
verified 2 entries, sha256 ae92a86a36f892a9615a3e895765118dc1669ecbf28e7b25c91ab32f48862e40
exit=0
```

只打包未解包时（删掉 FastBrowser 目录），同一容器显示 packed；int list / info 也能看到它：

```
NAME              VERSION     FILE                      SOURCE                                        STATUS
FastBrowser       1.0.0       fastbrowser.exe           FastBrowser.itbt  sha256 ae92a86a             packed

PS> & cpp/build/int.exe list
NAME          KIND     READY  DESCRIPTION
steampp       builtin  yes    Steam/network accelerator (stub - reports, does not act)
fastgithub    builtin  yes    GitHub accelerator relay: reports state; start/stop are stubs
fdm           builtin  yes    Multi-part HTTP downloader with SHA-256 verification
FastBrowser   plugin   yes    plugin: fastbrowser.exe
```

### D. int --version 与既有功能未破坏

```
PS> & cpp/build/int.exe --version
Infinity Toolbox [v1.0.0-pre4]
exit=0
```

int list 的三个内置工具（steampp / fastgithub / fdm）与改动前一致，插件行只多出 FastBrowser。


### E. 重复安装、覆盖与目录插件

```
# 同 name、不同内容，未加 --overwrite：拒绝
int: plugin 'FastBrowser' is already installed with different contents; re-run with --overwrite to replace it   (exit=1)

# 加 --overwrite：替换并提示
installed FastBrowser  9.9.9
  ...
  replaced an existing install

# 目录插件（无容器）verify：打印各文件 sha256，说明没有存储的摘要
directory plugin _ProbeDir  C:\Users\REDMI\AppData\Local\Infinity.Inc\plugin\_ProbeDir
  --    item.json                           d33d587031526627260d6a6c55371af1cf4fc275292a257efa201360a72b913d
  --    tool.exe                            20a7ec84684f7fe124cb3727d049734ab0b7da2f52fcafbcef989ecfd91e870b
no stored digests: a directory plugin carries no manifest of hashes
```

### F. 独立交叉验证

工作区里另有一份独立实现的 Node 读容器脚本 work/itbt/itbt-verify.mjs（非本次交付物）。用它读同一份 FastBrowser.itbt，结果一致：

```
node work/itbt/itbt-verify.mjs work/itbt/FastBrowser.itbt
== header ==
magic=ITBT version=1 flags=0 headerSize=199 entryCount=2 totalSize=1727627
name="FastBrowser" version="1.0.0" exe="fastbrowser.exe"
== entries ==
OK   item.json  offset=199 stored=83 raw=83 comp=0 sha256=132d02f2...
OK   fastbrowser.exe  offset=282 stored=1727345 raw=1727345 comp=0 sha256=720d7a23...
== RESULT: PASS ==
```

同一脚本对改坏 1 字节的副本给出 BAD fastbrowser.exe + sha mismatch，与 C++ loader 判定一致。

## 7. 未完成项与风险

1. deflate 只写不压缩、只读 store：工具链无 zlib，属任务允许的降级。flag/compression 字段已按契约保留；接入 zlib 后需同时补 packer 压缩与 loader 解压（当前 loader 对 compression=1 一律按条目名拒绝）。
2. totalSize 是 u32，容器上限 4 GiB；单条目 rawSize 是 u64 但受同一上限约束。
3. Windows 专用：解包/改名/校验用 Win32（与套件其余部分一致），非 Windows 上不可编译。
4. 覆盖安装不是真正的一次性原子交换：Windows 不能原子替换非空目录，实现是 target -> target.old -> 新目录；进程若在两步之间崩溃，可能残留 .old 或暂时缺目录。下次安装会先清理 .tmp/.old。风险低但并非零。
5. 容器头部 name/version 与容器内 item.json 可能不一致：若源目录自带 item.json 且命令行传了不同的 --name/--version，头部与内嵌清单会各说各话（解包后目录扫描以 item.json 为准）。打包器不修改用户已有的 item.json。
6. 打包器的 item.json 解析是宽松的三字段提取，只用于取默认值，不做完整 JSON 校验；item.json 本身缺失时生成。
7. 容器只有整体文件 SHA-256 记在 list/info 里，格式本身没有为“整个容器签名”留字段（契约没有要求）；逐条完整性由 entry sha256 保证。
8. 构建内存：本机从零全量并行构建可能 cc1plus OOM，建议 -j 2；这是既有构建环境问题，不是 .itbt 改动引入的，但重建时必须知道。
9. work/itbt/ 下保留了 FastBrowser-corrupt-exe.itbt、FastBrowser-corrupt-json.itbt、FastBrowser-deflate.itbt、FastBrowser-9.9.9.itbt 作为上述故障注入的证据，以及 work/itbt/build/FastBrowser/（打包输入）与 work/itbt/_test/（打包器小样例）。work/itbt/itbt-verify.mjs 非本次产物。

## 8. 独立复核（itbt-cpp，只读）

复核者：teammate `itbt-cpp`，2026-10-04。本轮对 `cpp/apps/int/**`、`cpp/tools/itbt/**` **只读**，未写入、未修改任何已交付文件；写入仅限 work/itbt/ 下的复现脚本与证据。

### 8.1 命令与结论

```
# 1) 二进制是否与源码同步
$ cmake --build cpp/build --target itbt-pack int
[0/2] Re-checking globbed directories...
ninja: no work to do.          # 两个产物都不比源码旧
$ (Get-FileHash cpp/apps/int/main.cpp -Algorithm SHA256).Hash
ADF23CD02A1061B9E4A4AA5260745A1D24A5490E8D411D12F3E56DE78F4EB56A
                               # 复核期间两次取值相同：无并发写入

# 2) 独立解析（Node crypto，不复用 C++ 代码）
$ node work/itbt/itbt-verify.mjs work/itbt/FastBrowser.itbt
magic=ITBT version=1 flags=0 headerSize=199 entryCount=2 totalSize=1727627
name="FastBrowser" version="1.0.0" exe="fastbrowser.exe"
OK   item.json       offset=199 stored=83      raw=83      comp=0
OK   fastbrowser.exe offset=282 stored=1727345 raw=1727345 comp=0
== RESULT: PASS ==
$ node work/itbt/itbt-verify.mjs work/itbt/_test/Test.itbt      # 同样 PASS（2 条）
```

hexdump 前 64 字节（FastBrowser.itbt）：

```
00000000  49 54 42 54 01 00 00 00 c7 00 00 00 02 00 00 00  |ITBT............|
00000010  8b 5c 1a 00 0b 00 46 61 73 74 42 72 6f 77 73 65  |.\....FastBrowse|
00000020  72 05 00 31 2e 30 2e 30 0f 00 66 61 73 74 62 72  |r..1.0.0..fastbr|
00000030  6f 77 73 65 72 2e 65 78 65 09 00 69 74 65 6d 2e  |owser.exe..item.|
```

逐字段核对：0x00-03 `ITBT`；0x04-05 version=1；0x06-07 flags=0；0x08-0B headerSize=199(0xC7)；0x0C-0F entryCount=2；0x10-13 totalSize=1727627(0x001A5C8B)；0x14-15 nameLen=11 后接 `FastBrowser`；0x21 verLen=5 后接 `1.0.0`；0x28 exeLen=15 后接 `fastbrowser.exe`；0x39 起第一条 entry（item.json，offset=199，stored=83）。与契约 offset 表逐字段吻合。

### 8.2 三套独立 SHA-256 互相印证

| 实现 | 位置 | fastbrowser.exe | item.json |
| --- | --- | --- | --- |
| 打包器自实现 | itbt-pack.cpp:41-131 | 720d7a23…b84e | 132d02f2…0f97 |
| 复核脚本 Node crypto | work/itbt/itbt-verify.mjs | 720d7a23…b84e | 132d02f2…0f97 |
| loader Windows CNG | main.cpp:245-286 | 720d7a23…b84e | 132d02f2…0f97 |

另核对：plugin 根的 FastBrowser.itbt 与 work/itbt/FastBrowser.itbt 同为 ae92a86a…2e40；解包出的 fastbrowser.exe 与源文件 720d7a23…b84e 一致。

### 8.3 重复 / 半成品检查

- 只有一个 packer 实现：`glob **/itbt*` 只命中 cpp/tools/itbt/itbt-pack.cpp；`work/build-itbt.mjs` 不存在，不存在第二条构建路径。
- cpp/CMakeLists.txt:66-68 的 host tool 目标是唯一构建入口，产物与源码同步（8.1）。
- main.cpp 只有一处 .itbt 实现块（187-651），解析/校验/解包无重复副本；`git diff cpp/apps/int/main.cpp` 共 16 个 hunk，全部是收尾修正，无 TODO/FIXME/调试输出。
- work/itbt/ 下 FastBrowser-corrupt-exe/-corrupt-json/-deflate/-9.9.9、build/FastBrowser/、sample/、_test/ 均完整可复现，无孤儿半成品。

### 8.4 需要注意的一点（未改任何代码）

`git diff` 显示**正确实现只存在于未提交的工作树**，commit 3e3a58a 中的版本有转义缺陷：`L"\*"`、`L"\"`、`find_last_of("\/")` 这类写法里的 `\*`/`\"`/`\/` 是无效转义，运行期退化为 `*`、`"`、`/`（例如 collectFiles/removeTree 会去枚举父目录的 `…FastBrowser*`）。工作树已修正为 `L"\\*"` 等，且当前 int.exe 就是用工作树构建的（本轮实测行为正确）。因此**不要执行 `git checkout -- cpp/apps/int/main.cpp`**；复核结束时该文件仍为修改态（sha256 ADF23CD0…）。建议下一轮 sync 时连同工作树一起提交。

另更正 6.F 节一处描述：work/itbt/itbt-verify.mjs 不是"非本次交付物"，它是本任务窗口内为独立交叉验证新增的脚本，属 work/itbt/ 证据集。

### 8.5 复核结论

契约符合性 **PASS**；交付完整，无重复实现、无半成品；四项验收（往返、改坏 1 字节、list/verify、--version）与附加负例（`../` 与绝对路径、magic、totalSize/headerSize、deflate 拒绝、--overwrite 冲突、幂等重装）复核全部通过。
