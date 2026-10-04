# Infinity.Inc v1.0.0-pre4 发行说明 / Release notes

- 版本：`1.0.0-pre4`
- Git 标签：`v1.0.0-pre4`
- Release 状态：`draft=false`、`prerelease=true`
- 线上公开时间（GitHub `published_at`）：`2026-10-04T07:08:55Z`（北京时间 2026-10-04 15:08）
- 发布账号：GitHub `zssx-2026`
- 平台：win64（单架构）
- 安装包数量：6，合计 **1,819,217 字节**
- 机器可读清单：[cpp/release/v1.0pre4/release-assets.json](../cpp/release/v1.0pre4/release-assets.json)（2,485 字节，sha256 `e29c82079ef94841f82abb289348e525be09dfed1a63c2e10e1e8e1323624c5e`）
- 目录行清单：[cpp/release/v1.0pre4/name.txt](../cpp/release/v1.0pre4/name.txt)（614 字节，sha256 `b2a95228e6c27618cb6c30caff531ce30565cca5ec1cbe659e3060d196baf75f`）

本说明中的字节数与 SHA-256 均取自线上 Release 资产，并与本地文件、GitHub API 的 `digest` 四方比对通过；核对过程见 [work/rel-publish-report.md](../work/rel-publish-report.md) 与 [work/qa-report.md](../work/qa-report.md)。

## 1. 下载

| 应用 | 安装包 | 字节数 | SHA-256 | 发布页 |
| --- | --- | ---: | --- | --- |
| Infinity Cloud | `InfinityCloud_1.0.0-pre4_win64_setup.exe` | 477,846 | `732f909f578864f1ead0c9539d40aa4e075c26a319d385fad5bacf671d85f7a5` | <https://github.com/zssx-2026/Infinity-Cloud/releases/tag/v1.0.0-pre4> |
| Infinity File Manager | `InfinityFileManager_1.0.0-pre4_win64_setup.exe` | 235,017 | `a6062187cb97e2c7f8732c17529932a2c8356fcc6c2b285a62f4de96caf3d5ae` | <https://github.com/zssx-2026/Infinity-File-Manager/releases/tag/v1.0.0-pre4> |
| InfinityPackageManager | `InfinityPackageManager_1.0.0-pre4_win64_setup.exe` | 278,021 | `56e8afb8bff30cee76c7cc2184fb37f43ef2ec203060261eec6e11cfac2c0ed7` | <https://github.com/zssx-2026/InfinityPackageManager/releases/tag/v1.0.0-pre4> |
| Infinity Installer Manager | `InfinityInstallerManager_1.0.0-pre4_win64_setup.exe` | 302,978 | `08ce3a05d83e9d38b4fb696f156e580fcc04a9e30066a21c8a41f9061210d2f2` | <https://github.com/zssx-2026/Infinity-Installer-Manager/releases/tag/v1.0.0-pre4> |
| Infinity Toolbox | `InfinityToolbox_1.0.0-pre4_win64_setup.exe` | 262,473 | `4827d87c0ab9eb8f319ee96d59062ffee350ff06e6c571d248d4a74f0fc789f2` | <https://github.com/zssx-2026/Infinity-Toolbox/releases/tag/v1.0.0-pre4> |
| Infinity Games | `InfinityGames_1.0.0-pre4_win64_setup.exe` | 262,882 | `96f0eb3e4e97044a8c02a4e06dba5a5f4b97de853a45ceba398ff07bfcfb9456` | <https://github.com/zssx-2026/Infinity-Games/releases/tag/v1.0.0-pre4> |

直接下载地址（每个仓库一个资产，`browser_download_url`）：

```text
https://github.com/zssx-2026/Infinity-Cloud/releases/download/v1.0.0-pre4/InfinityCloud_1.0.0-pre4_win64_setup.exe
https://github.com/zssx-2026/Infinity-File-Manager/releases/download/v1.0.0-pre4/InfinityFileManager_1.0.0-pre4_win64_setup.exe
https://github.com/zssx-2026/InfinityPackageManager/releases/download/v1.0.0-pre4/InfinityPackageManager_1.0.0-pre4_win64_setup.exe
https://github.com/zssx-2026/Infinity-Installer-Manager/releases/download/v1.0.0-pre4/InfinityInstallerManager_1.0.0-pre4_win64_setup.exe
https://github.com/zssx-2026/Infinity-Toolbox/releases/download/v1.0.0-pre4/InfinityToolbox_1.0.0-pre4_win64_setup.exe
https://github.com/zssx-2026/Infinity-Games/releases/download/v1.0.0-pre4/InfinityGames_1.0.0-pre4_win64_setup.exe
```

下载后校验（PowerShell）：

```powershell
(Get-FileHash -Algorithm SHA256 .\InfinityCloud_1.0.0-pre4_win64_setup.exe).Hash.ToLower()
```

GitHub 的 Release asset 对象同时给出 `digest: sha256:...`，其值与上表逐字符相同。

## 2. 六个应用

| 应用 | 前缀（管理员孪生） | 源码目录 | 定位 |
| --- | --- | --- | --- |
| Infinity Cloud | `inc`（`inx`） | `cpp/apps/inc` | GitHub 承载的云端：凭据、清单、上传/下载、回收站 |
| Infinity File Manager | `ifm`（`ifmx`） | `cpp/apps/ifm` | 本地文件操作：列目录、复制、移动、改名、回收站删除 |
| InfinityPackageManager | `ipm`（`ipmx`） | `cpp/apps/ipm` | 软件目录：浏览目录页、校验摘要并运行安装包 |
| Infinity Installer Manager | `iim`（`iimx`） | `cpp/apps/iim` | 整套套件的统一安装入口：产品、插件与资源包 |
| Infinity Toolbox | `int`（`intx`） | `cpp/apps/int` | 小工具注册表：内置工具可 `list`/`info`/`run`，并加载目录插件或 `.itbt` 容器插件 |
| Infinity Games | `ing`（`ingx`） | `cpp/apps/ing` | 游戏库：本地可执行条目（记住路径并启动）与在线 `https` 地址条目（仅存地址，作为外链打开） |

**命名规则**：`<前缀>_<面孔>.exe`；管理员孪生在前缀后加 `x`，是同一个可执行文件的副本，程序靠自身文件名判断面孔。

| 应用 | 面孔 | 每应用名字数 |
| --- | --- | ---: |
| Infinity Cloud / Infinity File Manager / InfinityPackageManager | `cli`、`gui`、`launcher` | 6 |
| Infinity Installer Manager / Infinity Toolbox / Infinity Games | `cli`、`gui` | 4 |

合计 **30 个可执行名**，全部来自同一份 C++ 产物（见 [work/rel-cpp-report.md](../work/rel-cpp-report.md)）。套件历史上的「八命名」是 4 个面孔（cli/tui/gui/launcher）× 用户/管理员孪生；`tui` 已从 `cpp/core/include/inc/mode.hpp` 删除，因此当前不存在 `*_tui.exe`。

## 3. 本版包含什么

- **六个应用都出安装包。** 相比 v1.0.0-pre3（4 个应用），本版新增 Infinity Toolbox 与 Infinity Games，共 6 个 NSIS 安装包。
- **无外部依赖。** 构建时用 `objdump -p` 逐个检查可执行文件的导入表，6 个安装包的解包载荷「外部依赖 = none」；导出依赖只有 Windows 自带 DLL 与 UCRT 前转器（`api-ms-win-crt-*`、`api-ms-win-core-*`）。构建脚本在发现其他 DLL 时会直接失败（[cpp/tools/build.mjs](../cpp/tools/build.mjs)）。
- **安装包载荷**：对应应用的全部可执行名 + `Uninstall.exe`；Infinity Cloud / File Manager / PackageManager 各 7 个文件，Installer Manager / Toolbox / Games 各 5 个文件。安装包体积 235,017–477,846 字节。
- **版本串一致**：每个包的 `<前缀>_cli.exe --version` 退出码 0，输出 `1.0.0-pre4`。
- **gui 面由 Electron 壳承载**：[shell/](../shell/) 是独立交付目录，C++ 侧通过 `--serve-ui` 在环回地址提供页面。**Electron 壳不在这 6 个安装包的载荷内。**
- **验收口径为解包级校验**：`7z l -slt` 确认 NSIS 结构、`7z x` 核对文件清单、`objdump -p` 核对导入表、逐文件 SHA-256 与 `cpp/out/<app>/` 比对。明细见 [work/rel-cpp-report.md](../work/rel-cpp-report.md)。

## 4. `.itbt` 工具容器（Infinity Toolbox 插件）

`.itbt` 是 Infinity Toolbox 插件的单文件形式：把一个「插件目录」打成一个文件，Toolbox 可以直接列出、校验、安装并运行，不必让插件目录散落在磁盘上。格式契约是 [work/ITBT-FORMAT.md](../work/ITBT-FORMAT.md)，C++ 实现位于 [cpp/apps/int/main.cpp](../cpp/apps/int/main.cpp)（魔数与版本检查、容器发现、`plugin list`/`plugin install`/`plugin verify`），打包器是 [cpp/tools/itbt/itbt-pack.cpp](../cpp/tools/itbt/itbt-pack.cpp)。

文件布局（小端）：

```text
offset 0    char[4]  "ITBT"          魔数
offset 4    u16      version = 1
offset 6    u16      flags            bit0=1 表示 payload 用 deflate
offset 8    u32      headerSize
offset 12   u32      entryCount
offset 16   u32      totalSize
offset 20   u16 nameLen + name(UTF-8)；u16 verLen + version(UTF-8)；u16 exeLen + exePath(UTF-8)
entry 表（entryCount 条）：u16 pathLen + path(UTF-8)；u64 offset；u64 storedSize；
                          u64 rawSize；u8 sha256[32]；u8 compression（0=store, 1=deflate）
payload：按 entry 表顺序排列的文件内容
```

规则（摘要，全文见格式契约）：

1. 路径必须相对，不得含 `..`，不得是绝对路径。
2. 打包时 `item.json` 必须存在；源目录没有时由打包器按命令行参数生成并写入容器。
3. 每条 entry 的原始内容 SHA-256 写入容器，加载后逐条校验，失败即拒绝该插件并说明原因。
4. 兼容旧式「目录 + item.json」插件；`.itbt` 首次使用时原子解包（先写 `.tmp` 再改名）到 `%LOCALAPPDATA%\Infinity.Inc\plugin\<name>\`，已存在且校验通过则复用。
5. 命令面：`int plugin list`、`int plugin install <file.itbt>`、`int plugin verify <name|file.itbt>`。
6. 打包器用法：`itbt-pack --dir <插件目录> --out <name.itbt> [--name N] [--version V] [--exe relative/path] [--deflate]`。

## 5. IPM 目录与 name.txt

InfinityPackageManager 的目录只有一个来源：GitHub 仓库 [zssx-2026/applications](https://github.com/zssx-2026/applications)。**该仓库里的每一个 Release 就是一个目录页**，页面用 `name.txt` 说明自己提供什么，每行六列：

```text
<asset name> <version> <package> <install kind> <company> <platform>
```

列语义：

| 列 | 含义 | 解析端 |
| --- | --- | --- |
| 1 `asset name` | 资产名，必须同时是该 Release 的资产，否则整行被跳过 | `cpp/apps/ipm/main.cpp`、`dist/bundle.js` |
| 2 `version` | 版本号，解析时去掉前导 `v` | 同上 |
| 3 `package` | 包标识（对应安装包的 `<package>` 部分） | 同上 |
| 4 `install kind` | 安装方式（`setup` 等） | 同上 |
| 5 `company` | 发行方；Node 侧缺省为 `null` | `dist/bundle.js` |
| 6 `platform` | 平台；列数不足 6 时按 `any` 处理 | `cpp/apps/ipm/main.cpp` |

排序规则（`cpp/apps/ipm/main.cpp`）：`package`（忽略大小写）→ `platform` → `version` 降序；`name.txt` 的行序不影响结果。列数少于 4 的行在 Node 侧被丢弃。

本版对应的目录页是 `applications` 仓库的 `application-inc` 标签（Release id `398198245`，<https://github.com/zssx-2026/applications/releases/tag/application-inc>）。该页当前共 **7 个资产**：6 个 v1.0.0-pre4 安装包 + `name.txt`（614 字节）。其 `name.txt` 内容就是本仓库 [cpp/release/v1.0pre4/name.txt](../cpp/release/v1.0pre4/name.txt)，六行如下：

```text
InfinityCloud_1.0.0-pre4_win64_setup.exe Infinity.Inc InfinityCloud setup Infinity.Inc win64
InfinityFileManager_1.0.0-pre4_win64_setup.exe Infinity.Inc InfinityFileManager setup Infinity.Inc win64
InfinityPackageManager_1.0.0-pre4_win64_setup.exe Infinity.Inc InfinityPackageManager setup Infinity.Inc win64
InfinityInstallerManager_1.0.0-pre4_win64_setup.exe Infinity.Inc InfinityInstallerManager setup Infinity.Inc win64
InfinityToolbox_1.0.0-pre4_win64_setup.exe Infinity.Inc InfinityToolbox setup Infinity.Inc win64
InfinityGames_1.0.0-pre4_win64_setup.exe Infinity.Inc InfinityGames setup Infinity.Inc win64
```

## 6. 历史归档与还原

工作历史保存在 [history/history.jsonl](../history/history.jsonl)：一个 JSONL 文件，首行是 header，之后是 chunk 行（`{"t":"c",...}`，内容为 base64(brotli)）与 entry 行（`{"t":"e","p":路径,"s":大小,"h":sha256,"g":[[chunk,offset,len],...]}`）。归档全程只读。

| 指标 | 值 |
| --- | ---: |
| 归档字节 | 276,969,754 |
| entry 条数 | 26,354 |
| chunk 行数 | 85 |
| 单 chunk 字节 | 16,777,216（16 MiB） |
| 原始体积 `origBytes` | 1,453,849,729 |
| codec | brotli |

还原工具是 [work/restore-history.ps1](../work/restore-history.ps1)（独立实现，未调用 [work/unpack-history.mjs](../work/unpack-history.mjs)；除用 Node 内建 `zlib.brotliDecompressSync` 做解码外，解析、拼接、SHA-256 全部由脚本自身实现）。

```powershell
# 全量还原到空目录，并写出逐条结果
powershell -NoProfile -ExecutionPolicy Bypass -File work\restore-history.ps1 `
  -Archive history\history.jsonl -Manifest work\history-manifest.json `
  -OutDir restore-full -All -SummaryJson work\restore-summary.json

# 抽样还原（默认 500 条，覆盖最大 20 条、全部 0 字节条目、中文名、跨 chunk 条目）
powershell -NoProfile -ExecutionPolicy Bypass -File work\restore-history.ps1 `
  -Archive history\history.jsonl -Manifest work\history-manifest.json -OutDir work\restore-sample

# 只还原指定条目
powershell -NoProfile -ExecutionPolicy Bypass -File work\restore-history.ps1 `
  -Archive history\history.jsonl -Manifest work\history-manifest.json -OutDir out `
  -Path "binaries/node/versions/22.22.2-3/node.exe"
```

参数：`-Archive`、`-Manifest`、`-OutDir`、`-All`、`-Path`（可传数组），另有 `-MinSample`（默认 300）、`-TopLargest`（默认 20）、`-ChineseSample`（默认 150）、`-CrossChunkSample`（默认 150）。退出码 0 = 全部一致，3 = 存在不一致。环境要求：Windows PowerShell 5.1+ 与 `PATH` 中的 `node`（只用内建 zlib）。

核对结果（详见 [work/restore-report.md](../work/restore-report.md)）：全量还原 **26,354/26,354** 逐字节一致，抽样 **500/500** 一致，不一致 0；全量还原总字节 1,453,849,729，与 header 的 `origBytes` 相等。逐条对照 `work/history-manifest.json`、归档 entry 的 `h` 字段与磁盘实际长度四项。

## 7. 已知限制

- **只发布 win64。** 这 6 个安装包均为单架构 win64；跨架构编译目标尚未加入。
- **未做真实「静默安装 + 卸载」跑测。** 本版验收口径是解包级校验（NSIS 结构、文件清单、导入表、`--version`、逐文件哈希）。真实安装会写入当前用户的 HKCU 环境变量与卸载键，属于对开发机注册表的持久改动，因此未在本机执行。
- **gui 面需要 `shell/`（Electron 壳）**，该壳不在安装包载荷内。
- **功能范围**：Infinity Cloud 覆盖凭据、清单与上传/下载；File Manager 覆盖本地文件操作；PackageManager 覆盖目录查询与摘要校验；Installer Manager 覆盖安装包管理；Toolbox 覆盖内置工具与插件加载；Games 覆盖本地条目与在线地址条目。云盘本体、WebDAV 服务端、插件市场等仍未完成。
- **`cpp/README.md` 的产品表仍写着「四个产品」与 pre3 的体积数据**，尚未与 v1.0pre4 同步（见 [work/rel-cpp-report.md](../work/rel-cpp-report.md) 第 6 节）。

## 8. 相关文件

- 发布验证：[work/rel-publish-report.md](../work/rel-publish-report.md)
- 独立 QA：[work/qa-report.md](../work/qa-report.md)
- 构建与打包：[work/rel-cpp-report.md](../work/rel-cpp-report.md)
- 目录刷新：[work/rel-catalog-report.md](../work/rel-catalog-report.md)
- `.itbt` 格式契约：[work/ITBT-FORMAT.md](../work/ITBT-FORMAT.md)
- 历史归档还原：[work/restore-report.md](../work/restore-report.md)
- 发布脚本：[cpp/tools/publish.mjs](../cpp/tools/publish.mjs)、[work/ghsync.mjs](../work/ghsync.mjs)

## English summary

- Version `1.0.0-pre4`, tag `v1.0.0-pre4`, published 2026-10-04T07:08:55Z, prerelease, win64 only.
- Six self-contained NSIS installers, 235,017–477,846 bytes each, one per application repository; the six assets total 1,819,217 bytes. Sizes and SHA-256 are listed in section 1 and match the live release assets and the GitHub API `digest`.
- Six products, 30 executable names in total: `inc`/`ifm`/`ipm` ship `cli`, `gui`, `launcher` (6 names each), `iim`/`int`/`ing` ship `cli` and `gui` (4 names each). Each name is a copy of one C++ binary that reads its own file name.
- No external dependencies: the build audits every import table with `objdump -p`, and the packaged executables import only Windows DLLs.
- The `gui` face is hosted by the Electron shell in [shell/](../shell/); the shell is not part of the installer payload.
- `.itbt` is the single-file form of an Infinity Toolbox plugin; the layout and rules are in [work/ITBT-FORMAT.md](../work/ITBT-FORMAT.md).
- Infrastructure Package Manager reads the `applications` repository: one Release per catalogue page, six columns per `name.txt` line (`asset name / version / package / install kind / company / platform`). The `application-inc` page holds the six pre4 installers plus a 614-byte `name.txt`.
- The history archive ([history/history.jsonl](../history/history.jsonl), 276,969,754 bytes, 26,354 entries, 85 brotli chunks) is restorable byte-for-byte with [work/restore-history.ps1](../work/restore-history.ps1): 26,354/26,354 full and 500/500 sampled entries verified.
