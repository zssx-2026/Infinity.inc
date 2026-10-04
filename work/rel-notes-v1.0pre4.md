# Infinity.Inc v1.0.0-pre4 发布说明

- 发布日期：2026-10-04
- 标签：`v1.0.0-pre4`（GitHub Release，`draft=false`、`prerelease=true`）
- 发布清单：`cpp/release/v1.0pre4/release-assets.json`

## 下载

6 个应用仓库各含 1 个 NSIS 安装包：

| 应用 | 安装包 | 字节数 | SHA-256 | 下载页 |
| --- | --- | --- | --- | --- |
| Infinity Cloud | `InfinityCloud_1.0.0-pre4_win64_setup.exe` | 477,846 | `732f909f578864f1ead0c9539d40aa4e075c26a319d385fad5bacf671d85f7a5` | https://github.com/zssx-2026/Infinity-Cloud/releases/tag/v1.0.0-pre4 |
| Infinity File Manager | `InfinityFileManager_1.0.0-pre4_win64_setup.exe` | 235,017 | `a6062187cb97e2c7f8732c17529932a2c8356fcc6c2b285a62f4de96caf3d5ae` | https://github.com/zssx-2026/Infinity-File-Manager/releases/tag/v1.0.0-pre4 |
| InfinityPackageManager | `InfinityPackageManager_1.0.0-pre4_win64_setup.exe` | 278,021 | `56e8afb8bff30cee76c7cc2184fb37f43ef2ec203060261eec6e11cfac2c0ed7` | https://github.com/zssx-2026/InfinityPackageManager/releases/tag/v1.0.0-pre4 |
| Infinity Installer Manager | `InfinityInstallerManager_1.0.0-pre4_win64_setup.exe` | 302,978 | `08ce3a05d83e9d38b4fb696f156e580fcc04a9e30066a21c8a41f9061210d2f2` | https://github.com/zssx-2026/Infinity-Installer-Manager/releases/tag/v1.0.0-pre4 |
| Infinity Toolbox | `InfinityToolbox_1.0.0-pre4_win64_setup.exe` | 262,473 | `4827d87c0ab9eb8f319ee96d59062ffee350ff06e6c571d248d4a74f0fc789f2` | https://github.com/zssx-2026/Infinity-Toolbox/releases/tag/v1.0.0-pre4 |
| Infinity Games | `InfinityGames_1.0.0-pre4_win64_setup.exe` | 262,882 | `96f0eb3e4e97044a8c02a4e06dba5a5f4b97de853a45ceba398ff07bfcfb9456` | https://github.com/zssx-2026/Infinity-Games/releases/tag/v1.0.0-pre4 |

## 本版变化

- **六应用首个 C++ 自包含版本。** Infinity Cloud、Infinity File Manager、
  InfinityPackageManager、Infinity Installer Manager、Infinity Toolbox、Infinity
  Games 均以单个 C++ 可执行文件构建，按文件名分派面孔
  （`<前缀>_cli` / `<前缀>_gui` / `<前缀>_launcher`，管理员孪生用
  `inx` / `ifmx` / `ipmx` / `iimx` / `intx` / `ingx` 前缀）。构建时用
  `objdump -p` 审计导入表，链接结果只依赖 Windows 自带 DLL，无需任何运行时。
- **NSIS 安装包。** 每个应用一个自包含安装包
  （`<package>_1.0.0-pre4_win64_setup.exe`），安装到
  `%LOCALAPPDATA%\Programs\Infinity.Inc\<产品>\`，写入 HKCU 环境变量与卸载键、
  创建开始菜单快捷方式，卸载器随包生成并在卸载时清理上述注册项。
- **去掉 TUI 面。** 每个应用不再提供全屏终端界面，只保留 `cli` 与
  `gui` 两个面；Infinity Cloud、Infinity File Manager、
  InfinityPackageManager 另含 `launcher` 菜单面，其余三款没有 launcher。
- **gui 面由 Electron 壳承载。** 窗口不再由原生代码直接绘制，而由
  `shell/`（Electron 壳）承载，C++ 程序提供环回 UI 服务。该壳是独立交付目录，
  不包含在这几个 NSIS 安装包的载荷中。

安装包内只有对应应用的可执行名与 `Uninstall.exe`；按报告验收，6 个包均为
NSIS 结构、文件清单一致、导入表无外部依赖、`--version` 输出 `1.0.0-pre4`。

## 已知限制

- **未做静默安装测试。** 本版没有跑真实的「静默安装 + 卸载」流程：它会写入
  当前用户的 HKCU 环境变量与卸载键，属于对开发机注册表的持久改动。本版验收
  口径为解包级校验（NSIS 结构、文件清单、导入表、`--version`、逐文件哈希）。
- **Toolbox / Games 仓库为本次新建。** 发布前勘察时
  `zssx-2026/Infinity-Toolbox` 与 `zssx-2026/Infinity-Games` 尚不存在
  （404），本次为这两个仓库首次上传。
