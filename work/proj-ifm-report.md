# task-4 报告：Infinity File Manager 与 Electron 外壳收尾

- 日期：2026-10-04
- 范围：`Infinity File Manager/**`、`shell/**`（写入范围与共享任务一致）
- 约束遵守：未修改/删除 `history/`，未运行 pack-history.mjs，无网络上传/发布，未 `npm install`，未跑大型构建；验证只有 `node --check` 与只读自检脚本。

## 一、改动清单

### 1. `Infinity File Manager/sourcecode/tools/release.mjs`
- 删掉 7 个平台里写死的旧可执行名 `InfinityFileManager(.exe)`，改为从 `build-all.mjs` 的 `exeNames()` 派生（release.mjs:31 导入、:101 拷贝）。
- 便携包现在按构建的每个名字逐个放入：`ifm_cli` / `ifm_launcher` / `ifmx_cli` / `ifmx_launcher`（Windows 带 `.exe`），不再只放一个文件。
- 两个启动脚本（`ifm.cmd` / `ifm`）指向 `ifm_launcher`（release.mjs:78）。
- Windows 目标复用 `shell/payload.mjs` 的 `hasGui`/`stageGui`，把 Electron 窗口一并放进便携包（release.mjs:110），与 IFM 的 make-setup 走同一套 helper。
- 发行资产文件名（`InfinityFileManager_<id>.zip` / `_setup.exe` / `_setup.msi`）保持不变：它们在 publish-all.mjs 和 GitHub 资产里已经是这个名字，本次只修「包里的可执行文件名」。

### 2. `shell/main.js`（本次最重要的修复）
- 背景：工作区里 10/3 17:14 的版本把外壳改成了 stdin/stdout 的 `--ipc` 设计，但 C++ 引擎只实现 `--serve-ui`（`cpp/core/include/inc/uiserver.hpp` 是冻结契约；`cpp/apps/*/main.cpp` 里没有任何 ipc 字样），并且它加载的 `shell/app/index.html` 不存在、`build.mjs` 也不打包 `preload.js`。按该版本启动只会得到空白窗口。
- 已恢复为 `--serve-ui`/HTTP 版本：直接取 10/3 8:13 构建产物里的 `resources/app/main.js`（30 份副本同一 SHA-256 EBA07DEC…，正是当时 `build.mjs` 复制的 `shell/main.js`），它符合 uiserver 契约与 cpp 默认端口。
- 修掉管理员命名的分派错误：原正则 `/^(inc|ifm|ipm|iim|int)x?_gui$/` 遇到 `ifmx_gui` 等名字会把「管理员前缀」当应用名返回（`ifmx`），`APPS` 查不到就回退到 `inc` ——`ifmx_gui.exe` 会拿到 Infinity Cloud 的标题、并去找 `ifmx_cli.exe`。现在显式列出十个窗口名并用 `ADMIN_TO_BASE` 翻译回应用（shell/main.js:43 表、:61 使用）。这个错误在被恢复的 8:13 版本里就存在。
- 注意：17:14 的 `--ipc` 版本未提交、无备份，已被覆盖（其唯一残留是 `shell/preload.js`）；如需保留该设计方向，请告知。

### 3. `shell/payload.mjs`
- `electronArch` 对 linux/darwin 返回 `null`（:29）；`hasGui` 对非 Windows 目标一律 `false`（:43）；`stageGui` 对非 Windows 目标明确报错（:54-56）。原实现默认回退 `x64`，会在 win-x64 构建存在时，把 Windows Electron 目录错装进 Linux/darwin 安装包。
- 新增同名保护：目标目录里若已存在 `<p>_gui.exe`（现在是 C++ 构建的产物）就拒绝覆盖（:62-65），避免两个同名但不同的程序互相覆盖。

### 4. `shell/verify-contract.mjs`（新增，只读）
- 把本次全部断言固化为可重跑脚本（`node shell/verify-contract.mjs`）。它只读源码与已有产物，不启动窗口/服务/编译器，失败时退出码非 0。

## 二、验证摘要

### 2.1 `node --check`（三个改动文件）
```
OK    node --check shell/main.js
OK    node --check shell/payload.mjs
OK    node --check Infinity File Manager/sourcecode/tools/release.mjs
```
另外 `shell/build.mjs`、`shell/preload.js`、`shell/verify-contract.mjs`、IFM `build-all.mjs` 也都 `node --check` 通过。

### 2.2 `node shell/verify-contract.mjs`
```
SELFTEST PASS  pass=43 fail=0      (exit=0)
```
关键断言（节选，完整 43 条见脚本输出）：
- `exeNames()` 对 7 个平台分别产出 `ifm_cli` / `ifm_launcher` / `ifmx_cli` / `ifmx_launcher`（win 带 `.exe`）；
- release.mjs 里既没有 `exe: 'InfinityFileManager…'`，也没有裸 `p.exe` 引用；
- shell/main.js 走 `--serve-ui`、无 `--ipc`、不加载本地 `app/`、不依赖 `preload`；
- 5 个应用端口与 cpp 默认端口逐一相等；
- 10 个窗口名全部翻译成正确的应用；
- `electronArch`/`hasGui`/`stageGui` 对非 Windows 目标行为正确，并拒绝覆盖已有的 C++ gui 面。

## 三、端口分配证据（shell/main.js ↔ cpp 默认值）

| 应用 | shell/main.js | cpp 默认端口 |
| --- | --- | --- |
| inc | `shell/main.js:32` `port: 7621` | `cpp/apps/inc/main.cpp:809` `int uiPort = 7621;` |
| ifm | `shell/main.js:33` `port: 7623` | `cpp/apps/ifm/main.cpp:617` `int uiPort = 7623;` |
| ipm | `shell/main.js:34` `port: 7632` | `cpp/apps/ipm/main.cpp:1277` `int uiPort = 7632;` |
| iim | `shell/main.js:35` `port: 7643` | `cpp/apps/iim/main.cpp:1765` `int uiPort = 7643;` |
| int | `shell/main.js:36` `port: 7653` | `cpp/apps/int/main.cpp:54` `kDefaultUiPort = 7653` |
| ing | 外壳未覆盖（见遗留 2） | `cpp/apps/ing/main.cpp:59` `kDefaultUiPort = 7664` |

启动方式：`shell/main.js:205` `spawn(server, ['--serve-ui', '--port=' + port], …)`，服务端可执行文件由 `findServer()`（:69）在自身目录及 `payload/` 下按 `<prefix>_cli` 查找；cpp 侧 `--serve-ui`/`--port=` 的解析见 `cpp/apps/ifm/main.cpp:616-632`（其余应用同形）。

## 四、第 3 项核查结论：`cpp/out/<app>/<p>_gui.exe` 与 `shell/payload.mjs` 不一致

结论：**同名不同物，两条路径并不一致**；v1.0pre4 安装包的 gui 面走的是 cpp，与 `shell/payload.mjs` 的 Electron 路径无关。

证据：
- cpp 侧：`cpp/tools/build.mjs:41-47` 给每个应用的 `modes` 含 `'gui'`；`cpp/tools/package.mjs:34-39` 的 `faces` 同样含 `'gui'`，安装暂存从 `cpp/out/<app>/` 取文件。实测 `cpp/out/ifm/ifm_gui.exe` 与 `cpp/out/ifm/ifmx_gui.exe` 都是 **514,560 B 的 C++ 单文件**；`cpp/build/installer-stage/ifm` 恰好 6 个 exe，无任何 Electron 目录。
- shell 侧：`shell/payload.mjs:36` 的 `guiDir` 指向 `shell/build/<p>_gui-win32-<arch>/`，其中 `shell/build/ifm_gui-win32-x64/ifm_gui.exe` 是 **188,784,128 B 的 Electron 目录**（10/3 8:13 构建）。
- 两者最终都叫 `<p>_gui.exe` / `<px>_gui.exe`。旧行为是「谁后写谁赢」，安装包里会静默留下错的那个；已在 `stageGui` 加拒绝覆盖保护（payload.mjs:62-65），但根因是命名约定重叠。
- 附带发现（跨范围，未改）：`cpp/tools/build.mjs:33` 注释说 `gui` 是「Electron 绘制的 loopback UI 服务」，但 `cpp/apps/ifm/main.cpp:641` 把 `gui` 分派到 `guiMain()`，即原生 Win32 窗口（:520-530）；`--serve-ui` 才走 `serveUi`（:632）。外壳用 `<p>_cli --serve-ui` 起服务是可行的，但它用的是 `_cli` 而不是 `_gui`。

## 五、遗留与建议（均未擅自处理，供 Lead 决策）

1. **Electron 交付物命名**：若 Electron 外壳仍要作为「窗口」交付，需要与 C++ 的 `<p>_gui.exe` 区分（例如 `<p>_window.exe` / `<p>_window-win32-<arch>`），或明确它不再进安装包。这属于 cpp/shell 之间的契约决定。
2. **外壳应用集合**：shell 覆盖 5 个应用（inc/ifm/ipm/iim/int，`shell/build.mjs` TARGETS 与 `shell/main.js` APPS 一致），cpp 已有 6 个（多 `ing`，端口 7664）。若要覆盖 ing，需在 `main.js` APPS 与 `build.mjs` TARGETS 各加一项；本次未加（无构建可验证）。
3. **未重建**：`shell/build/` 里的 Electron 产物仍是 10/3 8:13 的；`shell/main.js` 已改但按约束没有重跑 `shell/build.mjs`/`make-setup`，因此本次结论均基于源码与静态检查。
4. **遗留文件**：`shell/preload.js` 与空目录 `shell/app/` 是 `--ipc` 草稿的残留，当前 HTTP 设计不使用；未删除。
5. **两条流水线并存**：IFM 的 Node/SEA 流水线（`sourcecode/tools/*.mjs`）与当前 C++ 流水线（`cpp/tools/*.mjs`）同时存在；本次只按要求修了 `release.mjs` 的旧名，未做合并。
