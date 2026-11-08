> **2026-10-25 产品线收敛注记**：Infinity Toolbox（`int`/`intx`）已退役删除，本文为历史发布记录，文中应用数量与 Toolbox 相关内容以当时版本为准，不代表当前产品线。

# Infinity.Inc v1.0.0-pre5 发行说明（草稿）

- 版本：`1.0.0-pre5`（版本目录 `cpp/release/v1.0pre5/`）
- Git 标签：`v1.0.0-pre5`
- Release 状态：预发布（`draft=true` → 发布时置 `false`、`prerelease=true`）
- 平台：win64（单架构）
- 发布账号：GitHub `zssx-2026`
- **状态：已构建、已打包、哈希已三次冻结（2026-10-06，task-29）**——`node cpp\tools\build.mjs`、`node cpp\tools\package.mjs`、`node cpp\tools\manifest.mjs v1.0pre5 1.0.0-pre5` 均 exit 0；六个 exe 导入表为 `Windows only`，PE 资源段含 `RT_GROUP_ICON`/`RT_ICON` 与 `VERSIONINFO 1.0.0-pre5`，六个载荷 `--version` 均为 `1.0.0-pre5`。本轮因 `cpp/apps/inc/preview.hpp` 在上一冻结后被修改而重建，INC 管理员孪生统一为权威名 `inx_*`（旧名 `incx_*` 已不存在），其余五个安装包字节不变。下表的字节数与 SHA-256 由 `tools/manifest.mjs` 从磁盘读出，并逐项复算 14/14 全等（task-26）；task-29 再冻结：6 个安装器补 NSIS 版本资源（安装器自身 PE 属性页现显示 `Infinity.Inc` / `1.0.0-pre5`），`release-assets.json` 的 `generated` 固定为发布常量后复跑不再漂移；证据见 `work/release-refreeze2-report.md`。
- 机器可读清单（已产出）：`cpp/release/v1.0pre5/release-assets.json`、`cpp/release/v1.0pre5/name.txt`、`installers/packaging/v1.0pre5/SHA256SUMS.txt`
- 证据报告：`work/release-v1.0pre5-report.md`、`work/ifm-sea-report.md`、`work/ghsync-report.md`、`work/inc-merge-report.md`、`work/icon-rc-report.md`、`work/release-refreeze-report.md`、`work/release-refreeze2-report.md`

## 1. 五个应用

| 应用 | 前缀（管理员孪生） | 源码目录 | 环回 UI 端口 | 目录页 |
| --- | --- | --- | ---: | --- |
| Infinity Cloud | `inc`（`inx`） | `cpp/apps/inc` | 7621 | <https://github.com/zssx-2026/Infinity-Cloud> |
| Infinity File Manager | `ifm`（`ifmx`） | `cpp/apps/ifm` | 7623 | <https://github.com/zssx-2026/Infinity-File-Manager> |
| InfinityPackageManager | `ipm`（`ipmx`） | `cpp/apps/ipm` | 7632 | <https://github.com/zssx-2026/InfinityPackageManager> |
| Infinity Toolbox | `int`（`intx`） | `cpp/apps/int` | 7653 | <https://github.com/zssx-2026/Infinity-Toolbox> |
| Infinity Games | `ing`（`ingx`） | `cpp/apps/ing` | 7664 | <https://github.com/zssx-2026/Infinity-Games> |

命名规则：`<前缀>_<面孔>.exe`；管理员孪生在前缀后加 `x`，是同一可执行文件的副本，程序按自身文件名判断面孔。
Infinity Cloud / File Manager / PackageManager 各 6 个名字（cli/gui/launcher），Toolbox / Games 各 4 个（cli/gui），合计 26 个名字。

## 2. 资产表（待产出）

同一份资产按用途分五类；每类的命名与状态如下。**本表不含任何未产出的字节数或摘要。**

| 应用 | 类别 | 文件名 | 平台 | 版本 | 字节数 | SHA-256 | 状态 |
| --- | --- | --- | --- | --- | ---: | --- | --- |
| Infinity Cloud | exe 安装包 | `InfinityCloud_1.0.0-pre5_win64_setup.exe` | win64 | 1.0.0-pre5 | 待填 | 待填 | 待产出（编译/打包未批准） |
| Infinity Cloud | Windows msi | `InfinityCloud_1.0.0-pre5_win64.msi` | win64 | 1.0.0-pre5 | 待填 | 待填 | 规划中（当前工具不产出） |
| Infinity Cloud | 便携版 zip | `InfinityCloud_1.0.0-pre5_win64_portable.zip` | win64 | 1.0.0-pre5 | 待填 | 待填 | 规划中（当前工具不产出） |
| Infinity Cloud | 源代码 zip | `Infinity-Cloud-v1.0.0-pre5-src.zip` | win64 | 1.0.0-pre5 | 待填 | 待填 | 规划中（命名待定） |
| Infinity Cloud | 源代码 zst | `Infinity-Cloud-v1.0.0-pre5-src.tar.zst` | win64 | 1.0.0-pre5 | 待填 | 待填 | 规划中（命名待定） |
| Infinity File Manager | exe 安装包 | `InfinityFileManager_1.0.0-pre5_win64_setup.exe` | win64 | 1.0.0-pre5 | 待填 | 待填 | 待产出（编译/打包未批准） |
| Infinity File Manager | Windows msi | `InfinityFileManager_1.0.0-pre5_win64.msi` | win64 | 1.0.0-pre5 | 待填 | 待填 | 规划中（当前工具不产出） |
| Infinity File Manager | 便携版 zip | `InfinityFileManager_1.0.0-pre5_win64_portable.zip` | win64 | 1.0.0-pre5 | 待填 | 待填 | 规划中（当前工具不产出） |
| Infinity File Manager | 源代码 zip | `Infinity-File-Manager-v1.0.0-pre5-src.zip` | win64 | 1.0.0-pre5 | 待填 | 待填 | 规划中（命名待定） |
| Infinity File Manager | 源代码 zst | `Infinity-File-Manager-v1.0.0-pre5-src.tar.zst` | win64 | 1.0.0-pre5 | 待填 | 待填 | 规划中（命名待定） |
| InfinityPackageManager | exe 安装包 | `InfinityPackageManager_1.0.0-pre5_win64_setup.exe` | win64 | 1.0.0-pre5 | 待填 | 待填 | 待产出（编译/打包未批准） |
| InfinityPackageManager | Windows msi | `InfinityPackageManager_1.0.0-pre5_win64.msi` | win64 | 1.0.0-pre5 | 待填 | 待填 | 规划中（当前工具不产出） |
| InfinityPackageManager | 便携版 zip | `InfinityPackageManager_1.0.0-pre5_win64_portable.zip` | win64 | 1.0.0-pre5 | 待填 | 待填 | 规划中（当前工具不产出） |
| InfinityPackageManager | 源代码 zip | `InfinityPackageManager-v1.0.0-pre5-src.zip` | win64 | 1.0.0-pre5 | 待填 | 待填 | 规划中（命名待定） |
| InfinityPackageManager | 源代码 zst | `InfinityPackageManager-v1.0.0-pre5-src.tar.zst` | win64 | 1.0.0-pre5 | 待填 | 待填 | 规划中（命名待定） |
| Infinity Toolbox | exe 安装包 | `InfinityToolbox_1.0.0-pre5_win64_setup.exe` | win64 | 1.0.0-pre5 | 待填 | 待填 | 待产出（编译/打包未批准） |
| Infinity Toolbox | Windows msi | `InfinityToolbox_1.0.0-pre5_win64.msi` | win64 | 1.0.0-pre5 | 待填 | 待填 | 规划中（当前工具不产出） |
| Infinity Toolbox | 便携版 zip | `InfinityToolbox_1.0.0-pre5_win64_portable.zip` | win64 | 1.0.0-pre5 | 待填 | 待填 | 规划中（当前工具不产出） |
| Infinity Toolbox | 源代码 zip | `Infinity-Toolbox-v1.0.0-pre5-src.zip` | win64 | 1.0.0-pre5 | 待填 | 待填 | 规划中（命名待定） |
| Infinity Toolbox | 源代码 zst | `Infinity-Toolbox-v1.0.0-pre5-src.tar.zst` | win64 | 1.0.0-pre5 | 待填 | 待填 | 规划中（命名待定） |
| Infinity Games | exe 安装包 | `InfinityGames_1.0.0-pre5_win64_setup.exe` | win64 | 1.0.0-pre5 | 待填 | 待填 | 待产出（编译/打包未批准） |
| Infinity Games | Windows msi | `InfinityGames_1.0.0-pre5_win64.msi` | win64 | 1.0.0-pre5 | 待填 | 待填 | 规划中（当前工具不产出） |
| Infinity Games | 便携版 zip | `InfinityGames_1.0.0-pre5_win64_portable.zip` | win64 | 1.0.0-pre5 | 待填 | 待填 | 规划中（当前工具不产出） |
| Infinity Games | 源代码 zip | `Infinity-Games-v1.0.0-pre5-src.zip` | win64 | 1.0.0-pre5 | 待填 | 待填 | 规划中（命名待定） |
| Infinity Games | 源代码 zst | `Infinity-Games-v1.0.0-pre5-src.tar.zst` | win64 | 1.0.0-pre5 | 待填 | 待填 | 规划中（命名待定） |

说明：exe 安装包由 `cpp/tools/package.mjs` 生成（每包 = 该应用全部名字 + `Uninstall.exe`，NSIS，单文件、无外部依赖）；
msi / 便携版 zip / 源代码 zip / 源代码 zst 目前**没有**对应工具，属于本版规划的产出形态，命名待定。

## 3. 下载校验（占位，待资产产出后填）

> 本区块有意留空：校验值必须从实际文件读出，不预先写入。

```text
（待填：第 2 节每个资产的 Get-FileHash -Algorithm SHA256 命令与输出）
```

## 4. 逐应用差异要点（相对 v1.0.0-pre4）

### Infinity Cloud（`inc` / `inx`）

- **图标接入**：`icons/inc.ico` → 安装器 `MUI_ICON`/`MUI_UNICON` 与开始菜单快捷方式图标；可执行文件资源段已接入：`cpp/tools/build.mjs` 生成 `<app>.rc`（产品 `ICON` + `VERSIONINFO 1.0.0-pre5`），CMake 交给 `windres` 编译并链接进 exe（task-11，PE 证据见 `work/icon-rc-report.md`）。
- **性能优化**：task-19（并行目录加载 / 匹配缓存 / SHA-256 大缓冲等）；具体 before/after 数字待该任务报告，汇总进 `work/release-v1.0pre5-report.md`。
- **自解锁**：启动最早期执行 `inc::unblockSelf()` + `inc::unblockSelfDirectory(2)`（共用实现 `cpp/common/unblock.*`），删除自身与自身目录（深度 ≤2，仅 .exe/.dll/.pak/.dat/.json/.txt）的 `Zone.Identifier`；安装包对落地文件与 `$EXEPATH` 用 `System::Call 'kernel32::DeleteFileW(...)'` 清除。

### Infinity File Manager（`ifm` / `ifmx`）

- **图标接入**：`icons/ifm.ico` → 安装器 `MUI_ICON`/`MUI_UNICON` 与开始菜单快捷方式图标；可执行文件资源段已接入：`cpp/tools/build.mjs` 生成 `<app>.rc`（产品 `ICON` + `VERSIONINFO 1.0.0-pre5`），CMake 交给 `windres` 编译并链接进 exe（task-11，PE 证据见 `work/icon-rc-report.md`）。
- **性能优化**：task-20（并行目录加载 / 匹配缓存 / SHA-256 大缓冲等）；具体 before/after 数字待该任务报告，汇总进 `work/release-v1.0pre5-report.md`。
- **自解锁**：启动最早期执行 `inc::unblockSelf()` + `inc::unblockSelfDirectory(2)`（共用实现 `cpp/common/unblock.*`），删除自身与自身目录（深度 ≤2，仅 .exe/.dll/.pak/.dat/.json/.txt）的 `Zone.Identifier`；安装包对落地文件与 `$EXEPATH` 用 `System::Call 'kernel32::DeleteFileW(...)'` 清除。

### InfinityPackageManager（`ipm` / `ipmx`）

- **图标接入**：`icons/ipm.ico` → 安装器 `MUI_ICON`/`MUI_UNICON` 与开始菜单快捷方式图标；可执行文件资源段已接入：`cpp/tools/build.mjs` 生成 `<app>.rc`（产品 `ICON` + `VERSIONINFO 1.0.0-pre5`），CMake 交给 `windres` 编译并链接进 exe（task-11，PE 证据见 `work/icon-rc-report.md`）。
- **性能优化**：task-21（并行目录加载 / 匹配缓存 / SHA-256 大缓冲等）；具体 before/after 数字待该任务报告，汇总进 `work/release-v1.0pre5-report.md`。
- **自解锁**：启动最早期执行 `inc::unblockSelf()` + `inc::unblockSelfDirectory(2)`（共用实现 `cpp/common/unblock.*`），删除自身与自身目录（深度 ≤2，仅 .exe/.dll/.pak/.dat/.json/.txt）的 `Zone.Identifier`；安装包对落地文件与 `$EXEPATH` 用 `System::Call 'kernel32::DeleteFileW(...)'` 清除。

### Infinity Toolbox（`int` / `intx`）

- **图标接入**：`icons/int.ico` → 安装器 `MUI_ICON`/`MUI_UNICON` 与开始菜单快捷方式图标；可执行文件资源段已接入：`cpp/tools/build.mjs` 生成 `<app>.rc`（产品 `ICON` + `VERSIONINFO 1.0.0-pre5`），CMake 交给 `windres` 编译并链接进 exe（task-11，PE 证据见 `work/icon-rc-report.md`）。
- **性能优化**：task-23（并行目录加载 / 匹配缓存 / SHA-256 大缓冲等）；具体 before/after 数字待该任务报告，汇总进 `work/release-v1.0pre5-report.md`。
- **自解锁**：启动最早期执行 `inc::unblockSelf()` + `inc::unblockSelfDirectory(2)`（共用实现 `cpp/common/unblock.*`），删除自身与自身目录（深度 ≤2，仅 .exe/.dll/.pak/.dat/.json/.txt）的 `Zone.Identifier`；安装包对落地文件与 `$EXEPATH` 用 `System::Call 'kernel32::DeleteFileW(...)'` 清除。

### Infinity Games（`ing` / `ingx`）

- **图标接入**：`icons/ing.ico` → 安装器 `MUI_ICON`/`MUI_UNICON` 与开始菜单快捷方式图标；可执行文件资源段已接入：`cpp/tools/build.mjs` 生成 `<app>.rc`（产品 `ICON` + `VERSIONINFO 1.0.0-pre5`），CMake 交给 `windres` 编译并链接进 exe（task-11，PE 证据见 `work/icon-rc-report.md`）。
- **性能优化**：task-24（并行目录加载 / 匹配缓存 / SHA-256 大缓冲等）；具体 before/after 数字待该任务报告，汇总进 `work/release-v1.0pre5-report.md`。
- **自解锁**：启动最早期执行 `inc::unblockSelf()` + `inc::unblockSelfDirectory(2)`（共用实现 `cpp/common/unblock.*`），删除自身与自身目录（深度 ≤2，仅 .exe/.dll/.pak/.dat/.json/.txt）的 `Zone.Identifier`；安装包对落地文件与 `$EXEPATH` 用 `System::Call 'kernel32::DeleteFileW(...)'` 清除。

## 5. 构建与发布（待批准后执行）

```powershell
$env:NODE_OPTIONS=''
node tools/build.mjs      # ninja -j 2，六应用，导入表白名单审计
node tools/package.mjs    # 5 个 NSIS 安装包 → cpp/release/v1.0pre5/
node tools/manifest.mjs   # 写 name.txt 与 release-assets.json（size/sha256/fnv1a）
node tools/publish.mjs --dry-run   # GET-only 预演，不创建、不删除、不上传
```

发布到 GitHub 前需 Lead 书面批准，且任何输出都不得包含 `EV_GH_TOKEN`。

## 6. 已产出并校验的资产（2026-10-06）

| 文件 | 字节 | sha256 |
| --- | ---: | --- |
| `InfinityCloud_1.0.0-pre5_win64_setup.exe` | 516504 | `78dd21b814f86352f639747f7f348ab9af0d6efe1aa2630ddcd32cb844d7c909` |
| `InfinityFileManager_1.0.0-pre5_win64_setup.exe` | 239234 | `3f3f060a9a09dd6dbd13d1fe2d85afed4e6f47899502edf299b25acfbbaaf60a` |
| `InfinityGames_1.0.0-pre5_win64_setup.exe` | 269294 | `40b21389a3c5a487f6928ca2356a6f15f821f409ae58748876ef3c33fe03d39d` |
| `InfinityPackageManager_1.0.0-pre5_win64_setup.exe` | 289595 | `c475055ca4803482c0b067bd31506323ce949104ab6463be877845190a1875ca` |
| `InfinityToolbox_1.0.0-pre5_win64_setup.exe` | 297534 | `af90acb311306acf603bb1a5f3f1e5fade44d419fe3aaec1726404d2c49fb8c9` |
| `name.txt` | 499 | `3fb66c7695ad30b0903710d49914830509fc959f00303b3e667cdc2dfc4e598c` |
| `release-assets.json` | 2063 | `faa04bdef6211772e0af4d25f2f4daefed43c289becbb479904d33bfe4a1626a` |
| `icons/ifm.ico` | 8112 | `255409a5ae4789ee74ddeb900df468e7b2a45b12f563bcdc0cfb2ec4baf6f8a6` |
| `icons/inc.ico` | 8425 | `d0e3bd6a34dac65e3ac3a8ad46866db30027a43762612ba95250d524be969adb` |
| `icons/ing.ico` | 8242 | `f774518c62b31cc6e52780473bb7f6d1d294d335a974109206b9e86115f74fa3` |
| `icons/int.ico` | 8241 | `b84cf22e2a3d419db9f0fc4f12c26a113a60742599fa18afd4632209f0536b4e` |
| `icons/ipm.ico` | 9467 | `a19cf69e74bb946f6488f70dfcfe6e4b768707bac38e250a21ee3979acad09c4` |

校验链（互不依赖的三条独立路径）：

1. `work/restore-history.ps1` 与打包器无关，用于归档还原；本版不用它。
2. **载荷一致性**：`cpp/build/installer-stage/<app>/*.exe` 与 `cpp/out/<app>/*.exe` 逐字节同 sha256（5 应用 25 个可执行文件，0 失配）——安装包里装的确实是本版编译产物。
3. **清单一致性**：`work/ghsync.mjs --dry-run`（本地模式，零网络）对 `v1.0pre5` 报 `entries: 5, total bytes: 1612161, errors: 0`，每条 size/sha256 均标注 `(matches manifest)`；`installers/packaging/v1.0pre5/SHA256SUMS.txt` 的 12 条摘要与磁盘逐条复算一致（12/12）。

安装器行为：`setup.nsi` 以 `RequestExecutionLevel user` 安装到 `$LOCALAPPDATA\Programs\Infinity.Inc\<产品>`，写 HKCU 环境变量与卸载键、开始菜单快捷方式，并清除 `Zone.Identifier`；6/6 安装包内嵌对应 ICO 的全部 7 个尺寸。

## 7. 仍未做 / 已完成对照

- GitHub 发布（缺 `EV_GH_TOKEN`，需 Lead 书面批准）：`publish.mjs --dry-run` 为只读预演，尚未对远端执行。
- **已完成（2026-10-06，task-11）**：可执行文件资源段图标（windres `.rc`）**已接入**——每个应用由 `cpp/tools/build.mjs` 生成 `<app>.rc`（产品图标 + `VERSIONINFO Infinity.Inc / 产品 / 1.0.0-pre5`），CMake 交给 `windres` 编译并链接；六个 exe 资源段均含 `RT_GROUP_ICON`/`RT_ICON`，旧稿中「未接入」的表述作废。PE 证据与回退方法见 `work/icon-rc-report.md`。
- JS 线版本号与 `dist`/`web` 发布快照刷新由 task-9 处理。
