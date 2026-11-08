> **2026-10-25 产品线收敛注记**：Infinity Toolbox（`int`/`intx`）已退役删除，本文为历史发布记录，文中应用数量与 Toolbox 相关内容以当时版本为准，不代表当前产品线。

# Infinity.Inc v1.0.0-pre5 发行说明 / Release notes

> **预发布（prerelease）** ｜ Git 标签 `v1.0.0-pre5` ｜ 版本目录 `cpp/release/v1.0pre5/` ｜ 平台 **win64（单架构）** ｜ 发布账号 GitHub `zssx-2026`
>
> 六个纯 C++ 应用，六个 NSIS 安装包，合计 **1,920,380 字节**（1920380 B）。本页所有字节数与 SHA-256 均取自本地发行产物并逐项复算一致（14/14，见 `work/release-refreeze2-report.md`）。

## 简介

Infinity.Inc v1.0.0-pre5 是套件的第五个预发布版，一次交付五个应用：

- **Infinity Cloud**（`inc`/`inx`）—— GitHub 承载的云端：凭据、清单、上传/下载、回收站
- **Infinity File Manager**（`ifm`/`ifmx`）—— 本地文件操作：列目录、复制、移动、改名、回收站删除
- **InfinityPackageManager**（`ipm`/`ipmx`）—— 软件目录：浏览目录页、校验摘要并运行安装包
- **Infinity Toolbox**（`int`/`intx`）—— 小工具注册表，支持内置工具与 `.itbt` 容器插件
- **Infinity Games**（`ing`/`ingx`）—— 游戏库：本地可执行条目与在线 https 地址条目

本版要点：

- **零外部依赖**：六个可执行文件只导入 Windows 自带 DLL 与 UCRT 前转器（`api-ms-win-crt-*`、`api-ms-win-core-*`）。不需要 Node、Electron、.NET 或 VC++ 运行库；构建脚本用 `objdump -p` 审计导入表，发现其他 DLL 即失败。
- **体积小**：安装包 239,234 – 516,504 字节（此前 Node + Electron 版本约 20 MB 起）。
- **按文件名分派面孔**：每个应用由同一份可执行文件的副本提供 `cli` / `gui` / `launcher` 等名字；管理员孪生在前缀后加 `x`（同一文件的副本，程序按自身文件名判断面孔）。Cloud / File Manager / PackageManager 各 6 个名字，Installer Manager / Toolbox / Games 各 4 个，合计 30 个。
- **自解锁**：程序启动最早期清除自身与自身目录（深度 ≤2，仅 `.exe/.dll/.pak/.dat/.json/.txt`）的 `Zone.Identifier`；安装包同样清除落地文件的该标记。
- **本版变化**：安装器自身、开始菜单快捷方式与卸载项接入产品图标（`MUI_ICON`/`MUI_UNICON`、载荷 `.ico`、`DisplayIcon`）；五个可执行文件的 PE 资源段也已植入同一枚产品图标与 `VERSIONINFO`（公司 `Infinity.Inc`、版本 `1.0.0-pre5`，task-11，见 `work/icon-rc-report.md`）；并包含各产品的性能优化；6 个安装器自带 PE 版本资源（Company `Infinity.Inc`、版本 `1.0.0-pre5`、FileDescription `<产品> Setup`），资源管理器属性页不再空白（task-29）。明细见 `work/release-v1.0pre5-report.md`。

## 一、下载：六应用安装包（字节数 + SHA-256）

六个应用在各自的 GitHub 仓库发布，**一个仓库一个安装包**，标签统一为 `v1.0.0-pre5`。

| 应用 | 安装包 | 字节数 | SHA-256 | 发布页 |
| --- | --- | ---: | --- | --- |
| Infinity Cloud | `InfinityCloud_1.0.0-pre5_win64_setup.exe` | 516,504 | `78dd21b814f86352f639747f7f348ab9af0d6efe1aa2630ddcd32cb844d7c909` | <https://github.com/zssx-2026/Infinity-Cloud/releases/tag/v1.0.0-pre5> |
| Infinity File Manager | `InfinityFileManager_1.0.0-pre5_win64_setup.exe` | 239,234 | `3f3f060a9a09dd6dbd13d1fe2d85afed4e6f47899502edf299b25acfbbaaf60a` | <https://github.com/zssx-2026/Infinity-File-Manager/releases/tag/v1.0.0-pre5> |
| InfinityPackageManager | `InfinityPackageManager_1.0.0-pre5_win64_setup.exe` | 289,595 | `c475055ca4803482c0b067bd31506323ce949104ab6463be877845190a1875ca` | <https://github.com/zssx-2026/InfinityPackageManager/releases/tag/v1.0.0-pre5> |
| Infinity Toolbox | `InfinityToolbox_1.0.0-pre5_win64_setup.exe` | 297,534 | `af90acb311306acf603bb1a5f3f1e5fade44d419fe3aaec1726404d2c49fb8c9` | <https://github.com/zssx-2026/Infinity-Toolbox/releases/tag/v1.0.0-pre5> |
| Infinity Games | `InfinityGames_1.0.0-pre5_win64_setup.exe` | 269,294 | `40b21389a3c5a487f6928ca2356a6f15f821f409ae58748876ef3c33fe03d39d` | <https://github.com/zssx-2026/Infinity-Games/releases/tag/v1.0.0-pre5> |

直接下载地址（`browser_download_url`，来自 `release-assets.json`）：

```text
https://github.com/zssx-2026/Infinity-Cloud/releases/download/v1.0.0-pre5/InfinityCloud_1.0.0-pre5_win64_setup.exe
https://github.com/zssx-2026/Infinity-File-Manager/releases/download/v1.0.0-pre5/InfinityFileManager_1.0.0-pre5_win64_setup.exe
https://github.com/zssx-2026/InfinityPackageManager/releases/download/v1.0.0-pre5/InfinityPackageManager_1.0.0-pre5_win64_setup.exe
https://github.com/zssx-2026/Infinity-Toolbox/releases/download/v1.0.0-pre5/InfinityToolbox_1.0.0-pre5_win64_setup.exe
https://github.com/zssx-2026/Infinity-Games/releases/download/v1.0.0-pre5/InfinityGames_1.0.0-pre5_win64_setup.exe
```

## 二、随附文件与图标校验值（其余 8 项）

下表为发行目录 `installers/packaging/v1.0pre5/` 内随附的清单文件与图标；路径相对该目录。

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `name.txt` | 499 | `3fb66c7695ad30b0903710d49914830509fc959f00303b3e667cdc2dfc4e598c` |
| `release-assets.json` | 2063 | `faa04bdef6211772e0af4d25f2f4daefed43c289becbb479904d33bfe4a1626a` |
| `icons/inc.ico`（Infinity Cloud） | 8,425 | `d0e3bd6a34dac65e3ac3a8ad46866db30027a43762612ba95250d524be969adb` |
| `icons/ifm.ico`（Infinity File Manager） | 8,112 | `255409a5ae4789ee74ddeb900df468e7b2a45b12f563bcdc0cfb2ec4baf6f8a6` |
| `icons/ipm.ico`（InfinityPackageManager） | 9,467 | `a19cf69e74bb946f6488f70dfcfe6e4b768707bac38e250a21ee3979acad09c4` |
| `icons/int.ico`（Infinity Toolbox） | 8,241 | `b84cf22e2a3d419db9f0fc4f12c26a113a60742599fa18afd4632209f0536b4e` |
| `icons/ing.ico`（Infinity Games） | 8,242 | `f774518c62b31cc6e52780473bb7f6d1d294d335a974109206b9e86115f74fa3` |

第一、二两节合计 **12 项**校验值，与 `installers/packaging/v1.0pre5/SHA256SUMS.txt` 逐行一致。

## 三、校验方法

```powershell
# 单个安装包
(Get-FileHash -Algorithm SHA256 InfinityCloud_1.0.0-pre5_win64_setup.exe).Hash.ToLower()
certutil -hashfile InfinityCloud_1.0.0-pre5_win64_setup.exe SHA256

# 目录内 14 项一次比对（在含 SHA256SUMS.txt 的目录执行；Windows PowerShell 5.1 已验证）
Get-Content SHA256SUMS.txt | ForEach-Object {
  $h, $f = $_ -split '\s+', 2
  $got = (Get-FileHash -Algorithm SHA256 -LiteralPath $f).Hash.ToLower()
  if ($got -eq $h) { Write-Output ('OK   ' + $f) } else { Write-Output ('FAIL ' + $f) }
}
```

Git Bash / WSL 亦可用 `sha256sum -c SHA256SUMS.txt`。GitHub Release 资产对象上的 `digest: sha256:...` 应与上表逐字符相同。**校验时请核对小写十六进制全文，不要只看前几位。**

## 四、系统要求

- **操作系统**：Windows 10 / Windows 11，x64。本版**只有 win64 单架构**，不提供 32 位与 ARM64 目标。
- **权限**：无需管理员权限。安装器以 `RequestExecutionLevel user` 运行，安装到当前用户的 `%LOCALAPPDATA%/Programs/Infinity.Inc/<产品>`，写 HKCU 环境变量（广播 `WM_SETTINGCHANGE`）与卸载键，并创建开始菜单快捷方式；卸载时删除这些项。
- **运行库**：无。可执行文件只导入 Windows 自带 DLL 与 UCRT 前转器，不依赖 Node / Electron / .NET / VC++ Redistributable。
- **磁盘**：安装包每应用 0.23–0.51 MB；解包后每应用约 0.5–1.6 MB（该应用全部名字副本 + `Uninstall.exe`，Cloud / File Manager / PackageManager 为 7 个文件，Installer Manager / Toolbox / Games 为 5 个文件）。
- **GUI 面**：`gui` 面由独立交付目录 `shell/`（Electron 壳）承载，**该壳不在安装包载荷内**；只用 `cli` 面时无需任何额外组件。
- **网络**：程序启动本身不需要网络；Cloud 的云端功能与 IPM 的目录查询按功能使用 HTTPS。

## 五、已知问题与限制

1. **只发布 win64。** 六个安装包均为单架构 win64；跨架构编译目标尚未加入。
2. **可执行文件资源段图标已随本批安装包落盘（2026-10-06，task-11）。** 每个 `<app>_cli.exe`/`<app>_gui.exe` 的 PE 资源段都带产品 `RT_GROUP_ICON`/`RT_ICON` 与 `VERSIONINFO`（公司 `Infinity.Inc`、版本 `1.0.0-pre5`），资源由 `cpp/tools/build.mjs` 生成的 `.rc` 经 `windres` 编译链接，`build.mjs` 会对缺失图标的链接结果直接判失败；旧稿中「未接入」的表述已作废。**任何再次重建/重打包都会改变字节，本页全部校验值必须重新生成（流程见 `work/icon-rc-report.md`、`work/release-refreeze-report.md` 与 `work/release-refreeze2-report.md`）。**
3. **`.msi`、便携版 `.zip`、源代码 `.zip`/`.tar.zst` 本版无产出工具。** 属规划项，命名待定；本版只交付 `.exe` 安装包。
4. **`gui` 面需要独立的 Electron 壳** `shell/`，不在安装包载荷内。
5. **真实「静默安装 → 校验 → 卸载」的端到端结论以独立验证任务报告为准。** 本页哈希只保证安装包字节与本地发行产物一致；安装行为会写入当前用户 HKCU（环境变量与卸载键），属对机器的持久改动。
6. **JS / SEA 产品线的版本号遗留不影响本批 C++ 安装包。** 例如 `Infinity File Manager/sourcecode/package.json` 仍为 `1.0.0-pre2`，`dist/` 与 `web/` 的部分快照仍指向 pre4；明细见 `work/release-v1.0pre5-report.md` 第 7 节。
7. **没有聚合六个包的单一 Release。** 六个应用在各自仓库分别发布，本页是汇总说明；每个仓库的 Release 只含本应用的安装包。
8. **`7z l` 载荷列表复核未执行。** 本机 PATH 无 `7z`，内置 `7za` 不支持 NSIS（返回 `Errors: 1`），已用 `setup.nsi` 文本断言 + PE 资源字节比对替代；建议在发布机补一次 `7z l` 复核。

## 六、ING（Infinity Games）归属说明

- **ING（Infinity Games）产品线由独立的另一条开发线负责。** 本次 v1.0.0-pre5 按项目负责人指示把五个应用一并纳入发行清单（同步脚本按 5 个资产硬校验），但**只使用 ING 既有的二进制制品进行打包**，未改动 `cpp/apps/ing/**` 与 `icons/ing.ico` 的任何源码或资源。
- 因此本页对 Infinity Games **安装包的字节与哈希**负责（可复算）；其**功能内容、版本演进与缺陷修复的归属**不由本次 C++ 发布任务承担，相关改动与承诺以 ING 产品线自己的说明为准。
- 需要 ING 功能支持或反馈时，请在 `zssx-2026/Infinity-Games` 仓库提 issue，并在标题注明 ING。
- 本次发布任务全程未触碰 `history/`、`work/sync-history.mjs` 与 ING 源码；审计记录见 `work/release-prep-report.md`。

## 七、相关文件

- `docs/RELEASE-v1.0pre5.md` —— 草稿发行说明
- `cpp/release/v1.0pre5/release-assets.json` —— 机器可读清单（tag / version / size / sha256 / fnv1a / repo / url）
- `installers/packaging/v1.0pre5/SHA256SUMS.txt` —— 14 项校验和
- `work/release-v1.0pre5-report.md` —— 构建、打包与产物验证报告
- `work/release-prep-report.md` —— 本次发布预演（`publish.mjs --dry-run`）与本文案校验报告
- `work/icon-rc-report.md` —— exe 资源段图标接入（task-11）报告
- `work/release-refreeze-report.md` —— 发行哈希重新冻结与正文校验（task-15）报告
- `work/release-refreeze2-report.md` —— 二次冻结：INC 载荷重建与哈希刷新（task-26）报告
