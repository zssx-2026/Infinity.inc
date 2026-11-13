# Infinity.Inc

[中文](#中文) · [English](#english) · [v1.0.0-pre8 发行说明](docs/RELEASE-v1.0pre8.md)

## 索引 / Index

```text
Infinity.Inc
├── 产品与下载 / Products and downloads ......... #产品与下载
├── v1.0.0-pre8 发行说明 / Release notes ........ docs/RELEASE-v1.0pre8.md
├── 语言与界面原则 / Language and UI rules ...... docs/ENGINEERING-RULES.md
├── .itbt 工具容器 / .itbt container ............ work/ITBT-FORMAT.md
├── IPM 目录 / catalogue ....................... docs/RELEASE-v1.0pre8.md#七ipm-目录与-nametxt
├── 历史归档还原 / history restore ............. work/restore-report.md
├── 构建与发布 / Building and releasing ........ #构建与发布
├── 通用 Infinity.Inc 许可 / General license ... LICENCE
├── 目录结构 / Directory structure ............. #目录结构
└── 发布验证报告 / Publish verification ........ work/rel-publish-report.md
```

## 中文

Infinity.Inc 是 Windows 应用套件：本仓库当前构建并发布三个应用（Infinity Cloud、
InfinityPackageManager、Infinity Toolbox），另外三个产品（InfinityFileManager、
InfinityInstallerManager、InfinityGames）停在 v1.0.0-pre4，没有对应源码可重建。
每个产品只构建**一个** C++ 可执行文件，
再按不同文件名复制出若干份；程序读取自身文件名决定以哪个「面孔」运行。可执行文件
只导入 Windows 自带的 DLL —— C++ 侧不需要 Node、不需要 Visual C++ 运行库，也没有任何
需要安装的运行时；窗口由**随包的 Electron 外壳**承载（v1.0.0-pre7 起随安装包落盘，不依赖系统里的浏览器内核；
v1.0.0-pre7 起外壳自带标签页条、地址栏、应用侧栏与游玩区，产品页面在框内渲染）。零外部依赖这一点由构建强制保证：
[cpp/tools/build.mjs](cpp/tools/build.mjs) 用 `objdump -p` 读取每个可执行文件的导入表，
一旦出现 Windows 之外的东西就让构建失败。

本仓库（`zssx-2026/Infinity.inc`）是整套套件的总仓库，包含 C++ 重写（[cpp/](cpp/)）、
承载 `gui` 面孔的 Electron 壳（[shell/](shell/)）、网站（[web/](web/)）、图标（[icons/](icons/)）、
InfinityPackageManager 分发（[dist/](dist/)）以及工作与历史数据。

### 产品与下载

| 产品 | 前缀（管理员孪生） | 仓库 | 下载 |
| --- | --- | --- | --- |
| Infinity Cloud | `inc`（`inx`） | [zssx-2026/Infinity-Cloud](https://github.com/zssx-2026/Infinity-Cloud) | [v1.0.0-pre8](https://github.com/zssx-2026/Infinity-Cloud/releases/tag/v1.0.0-pre8) |
| InfinityPackageManager | `ipm`（`ipmx`） | [zssx-2026/InfinityPackageManager](https://github.com/zssx-2026/InfinityPackageManager) | [v1.0.0-pre8](https://github.com/zssx-2026/InfinityPackageManager/releases/tag/v1.0.0-pre8) |
| Infinity Toolbox | `int`（`intx`） | [zssx-2026/Infinity-Toolbox](https://github.com/zssx-2026/Infinity-Toolbox) | [v1.0.0-pre8](https://github.com/zssx-2026/Infinity-Toolbox/releases/tag/v1.0.0-pre8) |

InfinityFileManager（`ifm`）、InfinityInstallerManager（`iim`）、InfinityGames（`ing`）
仍停在 v1.0.0-pre4，其目录条目保留在 IPM 的 `name.txt` 里。

名字的规则是 `<前缀>_<面孔>.exe`：前缀选择产品，后缀选择面孔，管理员孪生在前缀后加
一个 `x`（`inx_cli.exe`、`ipmx_gui.exe` 等）。面孔有 `cli`、`gui`、`launcher`：
Infinity Cloud 与 InfinityPackageManager 三个面孔都出（每应用 6 个名字），
合计 12 个可执行名，全部是同一份 C++ 产物的副本。每个应用允许的面孔
必须与 [cpp/core/include/inc/mode.hpp](cpp/core/include/inc/mode.hpp) 一致，不属于该应用的面孔会被拒绝。
历史上的 `tui` 面孔已从 `mode.hpp` 删除，因此当前没有 `*_tui.exe`。

v1.0.0-pre8 的 3 个安装包（合计 252,164,464 字节）、字节数与 SHA-256 见
[docs/RELEASE-v1.0pre8.md](docs/RELEASE-v1.0pre8.md)。

### 构建与发布

前置条件：

- **build** — PATH 中有 MinGW-w64（UCRT）、CMake 与 Ninja。
- **package** — NSIS；`makensis` 默认在 `C:\Program Files (x86)\NSIS\makensis.exe`。
- **publish** — `curl`，以及 `EV_GH_TOKEN` 环境变量中的 GitHub 令牌。

在仓库根目录执行：

```sh
node cpp/tools/build.mjs      # 用 CMake + Ninja 编译，把产物按每个名字复制到 cpp/out/<app>/，并审计导入表
node cpp/tools/package.mjs    # 每个应用生成一个 NSIS 安装包，输出到 cpp/release/v1.0preN/
node cpp/tools/publish.mjs    # 把每个安装包上传到该应用自己的仓库 Release
```

脚本也支持在 `cpp/` 下以 `node tools/<script>.mjs` 运行。`publish.mjs` 接受可选 tag 与
`--dry-run`（只发 GET：解析仓库与 Release、检查本地文件名并打印真实运行会做什么，
不创建、不删除、不上传）。

本开发机上调用 node 时需清空 `NODE_OPTIONS`（`$env:NODE_OPTIONS=''`），因为环境默认值
会被这个 Node 构建拒绝。

### 发布约定

- Git 标签：`v1.0.0-preN`。
- 发布目录：`cpp/release/v1.0preN`（来自 `INC_RELEASE`，默认 `v1.0pre8`）。
- 安装包文件名：`<package>_<version>_win64_setup.exe`，其中 `<version>` 为
  `1.0.0-preN`（来自 `INC_VERSION`，默认由 tag 推导），例如
  `InfinityCloud_1.0.0-pre8_win64_setup.exe`。
- 包名：`InfinityCloud`、`InfinityPackageManager`、`InfinityToolbox`。
- 外壳：`INC_SHELL=electron` 走随包 Electron 分支（`INC_SHELL_ARCH` 默认 `win32-x64`）；
  `INC_SHELL=webview2` 是已退役的自建宿主路径。

每个应用一个独立仓库，它唯一的安装包挂在该仓库的 Release 上，用户只需下载一个文件。
`publish.mjs` 只操作 tag 指定的那个 Release；在其中只替换与待传文件**同名**的资产，
绝不删除其他名字的资产。不存在的仓库只报告并跳过，绝不自动创建。上传后脚本会重新读取
该资产，比对字节数，并在 GitHub 提供 `sha256` digest 时一并比对。

`cpp/release/v1.0preN/` 还放着两个描述文件：`name.txt`（目录行）与
`release-assets.json`（每个资产的 name、size、`sha256`、`fnv1a`、仓库与下载 URL，
以及 tag 与 version）。

### 目录结构

```text
cpp/     C++ 套件。apps/ 各应用源码，core/ 共享静态库，tools/ 构建/打包/发布/清单脚本，
         tests/ C++ 测试。out/ 各名字的可执行文件，release/ 安装包与 name.txt、
         release-assets.json，build/ CMake/NSIS 工作文件（不发布）。
shell/   承载 gui 面孔的 Electron 壳（main.js、preload.js、build.mjs、payload.mjs）。
         按自身文件名判定产品，起同目录的 <prefix>_cli.exe --serve-ui --port=<port>，
         只允许 127.0.0.1 导航；build/ 下是 <prefix>_gui-<arch>/ 六个套壳目录。
web/     静态网站。web/infinity/ 产品与下载页，web/infinity/cn/ 中文页。
icons/   应用图标（inc、ipm、int）及其 SVG 源文件。
dist/    InfinityPackageManager 分发：ipm.exe、目录与注册表 JSON、语言文件。
history/ history.jsonl。
```

### 实现选择

按性能需求选语言，不按偏好选：

| 场景 | 语言 |
| --- | --- |
| 默认实现（应用本体、核心库、宿主外壳） | **C++** 或 **Rust** |
| 极限热点（已被探针证明的瓶颈内层循环、SIMD 路径） | **汇编**（必须保留等价可移植实现与对照基准） |
| 简单且不需要速度的部分（一次性转换、数据整理） | **Python** |
| 构建、打包、发布、同步脚本 | **Node.js（ESM）**，属基础设施，不是产品载荷 |

界面原则是「**页面不是回答**」：窗口里只放产品本身，不放提示词、功能清单、版本亮点或架构
自述；首次运行页、错误页、空状态页一律最小化。第一次启动由程序自己弹令牌输入界面，凭据用
Windows DPAPI 加密存本机（`%LOCALAPPDATA%\Infinity\<app>\token.bin`），环境变量只是回退。
完整规则（含验收标准与「重建即改字节」的发布纪律）见
[docs/ENGINEERING-RULES.md](docs/ENGINEERING-RULES.md)。

### 更多资料

| 主题 | 文件 |
| --- | --- |
| v1.0.0-pre8 发行说明（三应用、下载、大小、sha256） | [docs/RELEASE-v1.0pre8.md](docs/RELEASE-v1.0pre8.md) |
| 语言选择、界面原则、验收与发布纪律 | [docs/ENGINEERING-RULES.md](docs/ENGINEERING-RULES.md) |
| `.itbt` 工具容器格式 v1 | [work/ITBT-FORMAT.md](work/ITBT-FORMAT.md) |
| 历史归档独立还原验证 | [work/restore-report.md](work/restore-report.md)、[work/restore-history.ps1](work/restore-history.ps1) |
| 发布与一致性验证 | [work/rel-publish-report.md](work/rel-publish-report.md) |
| 构建与打包验收 | [work/rel-cpp-report.md](work/rel-cpp-report.md) |
| 源码仓库同步 | [work/ghsync.mjs](work/ghsync.mjs) |

网站：<https://zssx-2026.github.io/infinity/>（英文）、<https://zssx-2026.github.io/infinity/cn/>（中文）。

源码仓库：<https://github.com/zssx-2026/Infinity.inc>

## English


Infinity.Inc is a suite of Windows applications: this repository currently builds
and publishes three of them (Infinity Cloud, InfinityPackageManager, Infinity
Toolbox); the other three (InfinityFileManager, InfinityInstallerManager,
InfinityGames) stay at v1.0.0-pre4 with no source left to rebuild them.
Each product is built once as a single C++ executable and then copied under
several names; the program reads its own file name to decide which face to run.
The executables import only DLLs that ship with Windows — the C++ side needs no
Node and no Visual C++ redistributable, and there is no runtime to install; the
window is hosted by the **bundled Electron shell** (since v1.0.0-pre8, shipped
inside the installer, not taken from the system). The build enforces the
zero-external-dependency claim:
`cpp/tools/build.mjs` reads each executable's import table with `objdump -p`
and fails the build if anything outside Windows appears in it.

This repository (`zssx-2026/Infinity.inc`) is the umbrella repository for the
suite: the C++ rewrite (`cpp/`), the Electron shell that hosts the `gui` face
(`shell/`), the website (`web/`), the icons (`icons/`), the
InfinityPackageManager distribution (`dist/`), and the working/history data.

### Products

| Product | Prefix (admin twin) | Repository | Downloads |
| --- | --- | --- | --- |
| Infinity Cloud | `inc` (`inx`) | [zssx-2026/Infinity-Cloud](https://github.com/zssx-2026/Infinity-Cloud) | [v1.0.0-pre8](https://github.com/zssx-2026/Infinity-Cloud/releases/tag/v1.0.0-pre8) |
| InfinityPackageManager | `ipm` (`ipmx`) | [zssx-2026/InfinityPackageManager](https://github.com/zssx-2026/InfinityPackageManager) | [v1.0.0-pre8](https://github.com/zssx-2026/InfinityPackageManager/releases/tag/v1.0.0-pre8) |
| Infinity Toolbox | `int` (`intx`) | [zssx-2026/Infinity-Toolbox](https://github.com/zssx-2026/Infinity-Toolbox) | [v1.0.0-pre8](https://github.com/zssx-2026/Infinity-Toolbox/releases/tag/v1.0.0-pre8) |

InfinityFileManager (`ifm`), InfinityInstallerManager (`iim`) and InfinityGames
(`ing`) remain at v1.0.0-pre4; their entries stay in the IPM `name.txt`.
The three v1.0.0-pre8 installers (252,164,464 bytes in total), their sizes and
SHA-256 digests are listed in [docs/RELEASE-v1.0pre8.md](docs/RELEASE-v1.0pre8.md).

A name is `<prefix>_<face>.exe`: the prefix selects the product and the suffix
selects the face, and the administrator twin adds an `x` to the prefix
(`inx_cli.exe`, `ipmx_gui.exe`, …). The faces are `cli`, `gui` and
`launcher`; Infinity Cloud and InfinityPackageManager
ship all three (6 names per application). The per-application
face list in the build has to match `cpp/core/include/inc/mode.hpp`, which
rejects a face an application does not have.

Website: <https://zssx-2026.github.io/infinity/> (English),
<https://zssx-2026.github.io/infinity/cn/> (Chinese).

### Building and releasing

Prerequisites:

- **build** — MinGW-w64 (UCRT), CMake and Ninja on `PATH`.
- **package** — NSIS; `makensis` is expected at
  `C:\Program Files (x86)\NSIS\makensis.exe`.
- **publish** — `curl` and a GitHub token in the `EV_GH_TOKEN` environment
  variable.

From the repository root:

```sh
node cpp/tools/build.mjs      # compile with CMake + Ninja, copy the executable to cpp/out/<app>/ under every name, audit the imports
node cpp/tools/package.mjs    # build one NSIS installer per application into cpp/release/v1.0preN/
node cpp/tools/publish.mjs    # upload each installer to that application's own repository release
```

The scripts also accept being run from `cpp/` as `node tools/<script>.mjs`.
`publish.mjs` takes an optional tag and `--dry-run` (GET only: it resolves
the repositories and releases, checks the local file names and prints what a
real run would do, without creating, deleting or uploading anything).

On this development machine, node is invoked with `NODE_OPTIONS` cleared
(`$env:NODE_OPTIONS=''`), because the environment default is rejected by this
Node build.

#### Release conventions

- Git tag: `v1.0.0-preN`.
- Release directory: `cpp/release/v1.0preN` (from `INC_RELEASE`, default
  `v1.0pre8`).
- Installer file name: `<package>_<version>_win64_setup.exe`, with
  `<version>` = `1.0.0-preN` (from `INC_VERSION`, by default derived from
  the tag), e.g. `InfinityCloud_1.0.0-pre8_win64_setup.exe`.
- Package names: `InfinityCloud`, `InfinityPackageManager`, `InfinityToolbox`.
- Shell: `INC_SHELL=electron` selects the bundled-Electron branch
  (`INC_SHELL_ARCH` defaults to `win32-x64`); `INC_SHELL=webview2` is the retired
  self-built host.

Each application has its own repository, and its single installer is attached to
the release in that repository, so a user downloads exactly one file.
`publish.mjs` only touches the release named by the tag; within it, it only
replaces an asset carrying exactly the name it is about to upload and never
removes an asset with any other name. A repository that does not exist is
reported and skipped, never created. After uploading, the script re-reads the
asset and compares its size, and its `sha256` digest when GitHub exposes one.

`cpp/release/v1.0preN/` also holds two description files: `name.txt` (the
catalogue lines) and `release-assets.json` (per asset: name, size, `sha256`,
`fnv1a`, repository and download URL, plus the tag and version).

### Directory structure

```
cpp/     The C++ suite. apps/ holds the per-application sources, core/ the
         shared static library, tools/ the build/package/publish/manifest
         scripts, tests/ the C++ tests. out/ holds the named executables,
         release/ the installers plus name.txt and release-assets.json, and
         build/ the CMake/NSIS working files (not published).
shell/   The Electron shell that hosts the gui face (main.js, preload.js,
         build.mjs, payload.mjs). It picks the product from its own file name,
         spawns <prefix>_cli.exe --serve-ui --port=<port> from the same folder
         and only allows 127.0.0.1 navigation; build/ holds the six staged
         <prefix>_gui-<arch>/ directories.
web/     The static website. web/infinity/ holds the product and download
         pages; web/infinity/cn/ holds the Chinese pages.
icons/   The application icons (inc, ipm, int) and their SVG
         sources.
dist/    The InfinityPackageManager distribution: ipm.exe, the catalogue and
         registry JSON, and the language files.
history/ history.jsonl.
```

### Implementation choices

Languages are chosen by performance need, not by preference: **C++ or Rust** for
the default implementation (applications, core library, window host), **assembly**
only for a hot spot already proven by a probe (with an equivalent portable
implementation and a comparison benchmark kept alongside), **Python** for simple
parts that need no speed, and **Node.js (ESM)** for build, package, publish and
sync scripts (infrastructure, not product payload).

The UI rule is "**the page is not the answer**": the window shows the product
only — never prompts, feature lists, release highlights or architecture prose —
and first-run, error and empty states stay minimal. The app asks for its own
token on first launch and stores it encrypted with Windows DPAPI
(`%LOCALAPPDATA%\Infinity\<app>\token.bin`); environment variables are only a
fallback. The full rules, including acceptance criteria and the "rebuilding
changes bytes" release discipline, are in
[docs/ENGINEERING-RULES.md](docs/ENGINEERING-RULES.md).

Source repository: <https://github.com/zssx-2026/Infinity.inc>
