# Infinity.Inc

[中文](#中文) · [English](#english) · [v1.0.0-pre4 发行说明](docs/RELEASE-v1.0pre4.md)

## 索引 / Index

```text
Infinity.Inc
├── 产品与下载 / Products and downloads ......... #产品与下载
├── v1.0.0-pre4 发行说明 / Release notes ........ docs/RELEASE-v1.0pre4.md
├── .itbt 工具容器 / .itbt container ............ work/ITBT-FORMAT.md
├── IPM 目录 / catalogue ....................... docs/RELEASE-v1.0pre4.md#5-ipm-目录与-nametxt
├── 历史归档还原 / history restore ............. work/restore-report.md
├── 构建与发布 / Building and releasing ........ #构建与发布
├── 目录结构 / Directory structure ............. #目录结构
└── 发布验证报告 / Publish verification ........ work/rel-publish-report.md
```

## 中文

Infinity.Inc 是六个 Windows 应用的套件。每个产品只构建**一个** C++ 可执行文件，
再按不同文件名复制出若干份；程序读取自身文件名决定以哪个「面孔」运行。可执行文件
只导入 Windows 自带的 DLL —— 不需要 Node、不需要 Electron、不需要 Visual C++
运行库，也没有任何需要安装的运行时。这一点由构建强制保证：
[cpp/tools/build.mjs](cpp/tools/build.mjs) 用 `objdump -p` 读取每个可执行文件的导入表，
一旦出现 Windows 之外的东西就让构建失败。

本仓库（`zssx-2026/Infinity.inc`）是整套套件的总仓库，包含 C++ 重写（[cpp/](cpp/)）、
承载 `gui` 面孔的 Electron 壳（[shell/](shell/)）、网站（[web/](web/)）、图标（[icons/](icons/)）、
InfinityPackageManager 分发（[dist/](dist/)）以及工作与历史数据。

### 产品与下载

| 产品 | 前缀（管理员孪生） | 仓库 | 下载 |
| --- | --- | --- | --- |
| Infinity Cloud | `inc`（`inx`） | [zssx-2026/Infinity-Cloud](https://github.com/zssx-2026/Infinity-Cloud) | [v1.0.0-pre4](https://github.com/zssx-2026/Infinity-Cloud/releases/tag/v1.0.0-pre4) |
| Infinity File Manager | `ifm`（`ifmx`） | [zssx-2026/Infinity-File-Manager](https://github.com/zssx-2026/Infinity-File-Manager) | [v1.0.0-pre4](https://github.com/zssx-2026/Infinity-File-Manager/releases/tag/v1.0.0-pre4) |
| InfinityPackageManager | `ipm`（`ipmx`） | [zssx-2026/InfinityPackageManager](https://github.com/zssx-2026/InfinityPackageManager) | [v1.0.0-pre4](https://github.com/zssx-2026/InfinityPackageManager/releases/tag/v1.0.0-pre4) |
| Infinity Installer Manager | `iim`（`iimx`） | [zssx-2026/Infinity-Installer-Manager](https://github.com/zssx-2026/Infinity-Installer-Manager) | [v1.0.0-pre4](https://github.com/zssx-2026/Infinity-Installer-Manager/releases/tag/v1.0.0-pre4) |
| Infinity Toolbox | `int`（`intx`） | [zssx-2026/Infinity-Toolbox](https://github.com/zssx-2026/Infinity-Toolbox) | [v1.0.0-pre4](https://github.com/zssx-2026/Infinity-Toolbox/releases/tag/v1.0.0-pre4) |
| Infinity Games | `ing`（`ingx`） | [zssx-2026/Infinity-Games](https://github.com/zssx-2026/Infinity-Games) | [v1.0.0-pre4](https://github.com/zssx-2026/Infinity-Games/releases/tag/v1.0.0-pre4) |

名字的规则是 `<前缀>_<面孔>.exe`：前缀选择产品，后缀选择面孔，管理员孪生在前缀后加
一个 `x`（`inx_cli.exe`、`ifmx_gui.exe` 等）。面孔有 `cli`、`gui`、`launcher`：
Infinity Cloud、Infinity File Manager、InfinityPackageManager 三个面孔都出（每应用 6 个名字），
Infinity Installer Manager、Infinity Toolbox、Infinity Games 只出 `cli` 与 `gui`（每应用 4 个名字，
没有 launcher）。合计 30 个可执行名，全部是同一份 C++ 产物的副本。每个应用允许的面孔
必须与 [cpp/core/include/inc/mode.hpp](cpp/core/include/inc/mode.hpp) 一致，不属于该应用的面孔会被拒绝。
历史上的 `tui` 面孔已从 `mode.hpp` 删除，因此当前没有 `*_tui.exe`。

v1.0.0-pre4 的 6 个安装包、字节数与 SHA-256 见
[docs/RELEASE-v1.0pre4.md](docs/RELEASE-v1.0pre4.md)。

### 构建与发布

前置条件：

- **build** — PATH 中有 MinGW-w64（UCRT）、CMake 与 Ninja。
- **package** — NSIS；`makensis` 默认在 `C:\Program Files (x86)\NSIS\makensis.exe`。
- **publish** — `curl`，以及 `EV_GH_TOKEN` 环境变量中的 GitHub 令牌。

在仓库根目录执行：

```sh
node cpp/tools/build.mjs      # 用 CMake + Ninja 编译，把产物按每个名字复制到 cpp/out/<app>/，并审计导入表
node cpp/tools/package.mjs    # 每个应用生成一个 NSIS 安装包，输出到 cpp/release/v1.0pre4/
node cpp/tools/publish.mjs    # 把每个安装包上传到该应用自己的仓库 Release
```

脚本也支持在 `cpp/` 下以 `node tools/<script>.mjs` 运行。`publish.mjs` 接受可选 tag 与
`--dry-run`（只发 GET：解析仓库与 Release、检查本地文件名并打印真实运行会做什么，
不创建、不删除、不上传）。

本开发机上调用 node 时需清空 `NODE_OPTIONS`（`$env:NODE_OPTIONS=''`），因为环境默认值
会被这个 Node 构建拒绝。

### 发布约定

- Git 标签：`v1.0.0-preN`。
- 发布目录：`cpp/release/v1.0preN`（来自 `INC_RELEASE`，默认 `v1.0pre4`）。
- 安装包文件名：`<package>_<version>_win64_setup.exe`，其中 `<version>` 为
  `1.0.0-preN`（来自 `INC_VERSION`，默认由 tag 推导），例如
  `InfinityCloud_1.0.0-pre4_win64_setup.exe`。
- 包名：`InfinityCloud`、`InfinityFileManager`、`InfinityPackageManager`、
  `InfinityInstallerManager`、`InfinityToolbox`、`InfinityGames`。

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
web/     静态网站。web/infinity/ 产品与下载页，web/infinity/cn/ 中文页。
icons/   应用图标（inc、ifm、ipm、iim、int、ing）及其 SVG 源文件。
dist/    InfinityPackageManager 分发：ipm.exe、目录与注册表 JSON、语言文件。
history/ history.jsonl。
```

### 更多资料

| 主题 | 文件 |
| --- | --- |
| v1.0.0-pre4 发行说明（六应用、下载、大小、sha256） | [docs/RELEASE-v1.0pre4.md](docs/RELEASE-v1.0pre4.md) |
| `.itbt` 工具容器格式 v1 | [work/ITBT-FORMAT.md](work/ITBT-FORMAT.md) |
| 历史归档独立还原验证 | [work/restore-report.md](work/restore-report.md)、[work/restore-history.ps1](work/restore-history.ps1) |
| 发布与一致性验证 | [work/rel-publish-report.md](work/rel-publish-report.md) |
| 构建与打包验收 | [work/rel-cpp-report.md](work/rel-cpp-report.md) |
| 源码仓库同步 | [work/ghsync.mjs](work/ghsync.mjs) |

网站：<https://zssx-2026.github.io/infinity/>（英文）、<https://zssx-2026.github.io/infinity/cn/>（中文）。

源码仓库：<https://github.com/zssx-2026/Infinity.inc>

## English


Infinity.Inc is a suite of six Windows applications. Each product is built once
as a single C++ executable and then copied under several names; the program
reads its own file name to decide which face to run. The executables import only
DLLs that ship with Windows — no Node, no Electron, no Visual C++ redistributable,
no runtime to install — and the build enforces that claim:
`cpp/tools/build.mjs` reads each executable's import table with `objdump -p`
and fails the build if anything outside Windows appears in it.

This repository (`zssx-2026/Infinity.inc`) is the umbrella repository for the
suite: the C++ rewrite (`cpp/`), the Electron shell that hosts the `gui` face
(`shell/`), the website (`web/`), the icons (`icons/`), the
InfinityPackageManager distribution (`dist/`), and the working/history data.

### Products

| Product | Prefix (admin twin) | Repository | Downloads |
| --- | --- | --- | --- |
| Infinity Cloud | `inc` (`inx`) | [zssx-2026/Infinity-Cloud](https://github.com/zssx-2026/Infinity-Cloud) | [v1.0.0-pre4](https://github.com/zssx-2026/Infinity-Cloud/releases/tag/v1.0.0-pre4) |
| Infinity File Manager | `ifm` (`ifmx`) | [zssx-2026/Infinity-File-Manager](https://github.com/zssx-2026/Infinity-File-Manager) | [v1.0.0-pre4](https://github.com/zssx-2026/Infinity-File-Manager/releases/tag/v1.0.0-pre4) |
| InfinityPackageManager | `ipm` (`ipmx`) | [zssx-2026/InfinityPackageManager](https://github.com/zssx-2026/InfinityPackageManager) | [v1.0.0-pre4](https://github.com/zssx-2026/InfinityPackageManager/releases/tag/v1.0.0-pre4) |
| Infinity Installer Manager | `iim` (`iimx`) | [zssx-2026/Infinity-Installer-Manager](https://github.com/zssx-2026/Infinity-Installer-Manager) | [v1.0.0-pre4](https://github.com/zssx-2026/Infinity-Installer-Manager/releases/tag/v1.0.0-pre4) |
| Infinity Toolbox | `int` (`intx`) | [zssx-2026/Infinity-Toolbox](https://github.com/zssx-2026/Infinity-Toolbox) | [v1.0.0-pre4](https://github.com/zssx-2026/Infinity-Toolbox/releases/tag/v1.0.0-pre4) |
| Infinity Games | `ing` (`ingx`) | [zssx-2026/Infinity-Games](https://github.com/zssx-2026/Infinity-Games) | [v1.0.0-pre4](https://github.com/zssx-2026/Infinity-Games/releases/tag/v1.0.0-pre4) |

A name is `<prefix>_<face>.exe`: the prefix selects the product and the suffix
selects the face, and the administrator twin adds an `x` to the prefix
(`inx_cli.exe`, `ifmx_gui.exe`, …). The faces are `cli`, `gui` and
`launcher`; Infinity Cloud, Infinity File Manager and InfinityPackageManager
ship all three, while Infinity Installer Manager, Infinity Toolbox and Infinity
Games ship `cli` and `gui` only (they have no launcher). The per-application
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
node cpp/tools/package.mjs    # build one NSIS installer per application into cpp/release/v1.0pre4/
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
  `v1.0pre4`).
- Installer file name: `<package>_<version>_win64_setup.exe`, with
  `<version>` = `1.0.0-preN` (from `INC_VERSION`, by default derived from
  the tag), e.g. `InfinityCloud_1.0.0-pre4_win64_setup.exe`.
- Package names: `InfinityCloud`, `InfinityFileManager`,
  `InfinityPackageManager`, `InfinityInstallerManager`, `InfinityToolbox`,
  `InfinityGames`.

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
         build.mjs, payload.mjs).
web/     The static website. web/infinity/ holds the product and download
         pages; web/infinity/cn/ holds the Chinese pages.
icons/   The application icons (inc, ifm, ipm, iim, int, ing) and their SVG
         sources.
dist/    The InfinityPackageManager distribution: ipm.exe, the catalogue and
         registry JSON, and the language files.
history/ history.jsonl.
```

Source repository: <https://github.com/zssx-2026/Infinity.inc>
