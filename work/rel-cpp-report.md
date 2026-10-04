# C++ 套件 v1.0pre4 构建与打包报告（task-6，rel-cpp-build）

状态：**完成**。`cpp/release/v1.0pre4/` 下 6 个应用安装包 + `name.txt` + `release-assets.json` 齐备，
逐个解包校验 NSIS 结构、文件清单、导入表（无外部依赖）全部通过。**未做任何发布动作。**

## 1. 交付产物

| 安装包 | 字节数 | SHA-256 | 载荷 | 安装包内可执行名 |
| --- | --- | --- | --- | --- |
| InfinityCloud_1.0.0-pre4_win64_setup.exe | 477,846 | `732f909f578864f1ead0c9539d40aa4e075c26a319d385fad5bacf671d85f7a5` | 7 | inc_cli/gui/launcher, inx_cli/gui/launcher, Uninstall |
| InfinityFileManager_1.0.0-pre4_win64_setup.exe | 235,017 | `a6062187cb97e2c7f8732c17529932a2c8356fcc6c2b285a62f4de96caf3d5ae` | 7 | ifm_cli/gui/launcher, ifmx_cli/gui/launcher, Uninstall |
| InfinityPackageManager_1.0.0-pre4_win64_setup.exe | 278,021 | `56e8afb8bff30cee76c7cc2184fb37f43ef2ec203060261eec6e11cfac2c0ed7` | 7 | ipm_cli/gui/launcher, ipmx_cli/gui/launcher, Uninstall |
| InfinityInstallerManager_1.0.0-pre4_win64_setup.exe | 302,978 | `08ce3a05d83e9d38b4fb696f156e580fcc04a9e30066a21c8a41f9061210d2f2` | 5 | iim_cli/gui, iimx_cli/gui, Uninstall |
| InfinityToolbox_1.0.0-pre4_win64_setup.exe | 262,473 | `4827d87c0ab9eb8f319ee96d59062ffee350ff06e6c571d248d4a74f0fc789f2` | 5 | int_cli/gui, intx_cli/gui, Uninstall |
| InfinityGames_1.0.0-pre4_win64_setup.exe | 262,882 | `96f0eb3e4e97044a8c02a4e06dba5a5f4b97de853a45ceba398ff07bfcfb9456` | 5 | ing_cli/gui, ingx_cli/gui, Uninstall |

同目录另有两个描述文件：

| 文件 | 字节数 | SHA-256 |
| --- | --- | --- |
| name.txt | 614 | `b2a95228e6c27618cb6c30caff531ce30565cca5ec1cbe659e3060d196baf75f` |
| release-assets.json | 2,485 | `e29c82079ef94841f82abb289348e525be09dfed1a63c2e10e1e8e1323624c5e` |

`name.txt` 沿用既有目录页格式（与 v1.0pre3、work/ghsync.mjs 的 `catalogAsset` 一致）：
`<asset> Infinity.Inc <package> setup Infinity.Inc win64`。`release-assets.json` 在 v1.0pre3 字段
（tag/size/fnv1a/repo/url）之上补了 `version` 与 `sha256`，便于不重算即可核对。

## 2. 构建命令（可复现）

在 `cpp/` 下依次执行（PowerShell，清空 NODE_OPTIONS 是本机要求）：

```powershell
$env:NODE_OPTIONS=''
node tools/build.mjs      # CMake+Ninja 编译 6 个应用，复制出全部名字，逐个审计导入表
node tools/package.mjs    # makensis 生成 6 个 NSIS 安装包到 cpp/release/v1.0pre4/
node tools/manifest.mjs   # 读盘写 name.txt 与 release-assets.json（含 size/sha256/fnv1a）
```

版本目录已参数化：`package.mjs` 顶部 `RELEASE = process.env.INC_RELEASE || 'v1.0pre4'`、
`VERSION = process.env.INC_VERSION || '1.0.0-pre4'`，目录名与文件名/NSIS 版本同源，下一次
预发布只需改这两个常量（或用环境变量覆盖）。

## 3. 名字（关于「八个名字」）

套件历史上的「八命名」是 4 个面（cli/tui/gui/launcher）× 用户/管理员孪生 = 8 个名。
当前代码里 `core/include/inc/mode.hpp` 已删除 tui，gui 的窗口由 shell/（Electron）承载，
C++ 侧提供 `--serve-ui` 环回服务。本次严格按 mode.hpp 实际接受的面生成名字，绝不产出
一个 `detectMode()` 会判为空的死名字：

- inc / ifm / ipm：cli、gui、launcher × (前缀, 管理员 x 前缀) = **6 名/应用**
- iim / int / ing：cli、gui × (前缀, 管理员 x 前缀) = **4 名/应用**（这三个没有可选项，故无 launcher）

合计 30 个可执行名，全部是同一个 C++ 产物的真实副本（非硬链接），落在 `cpp/out/<app>/`，
并被对应安装包逐一收录（见上表「安装包内可执行名」）。

## 4. 校验方法与结果（逐包，双击级）

对 6 个安装包逐个执行：

1. `7z l -slt <setup.exe>` → `Type = Nsis`（6/6，NSIS 结构成立；stub 含 Nullsoft 标记）。
2. `7z x` 解包到 `cpp/build/verify-pre4/<安装包名>/` → 文件清单与上表完全一致，
   每个包都带 `Uninstall.exe`（卸载器已生成）。
3. 对解包出的**每个** `.exe`（含 Uninstall.exe）跑 `objdump -p`，收集 `DLL Name:` 并对照
   build.mjs 的白名单（Windows 自带 DLL + `api-ms-win-crt-*`/`api-ms-win-core-*` UCRT 前转器）：
   **外部依赖 = none（6/6）**。
4. 运行每个包的 `<prefix>_cli.exe --version`：退出码 0，输出均为 `1.0.0-pre4`
   （inc `Infinity Cloud [v1.0.0-pre4]`、ifm `Infinity File Manager 1.0.0-pre4`、
   ipm `InfinityPackageManager 1.0.0-pre4`、iim `Infinity Installer Manager [v1.0.0-pre4]`、
   int `Infinity Toolbox [v1.0.0-pre4]`、ing `Infinity Games [v1.0.0-pre4]`）。
5. 解包载荷逐文件 SHA-256 与 `cpp/out/<app>/` 同名文件比对：**全部一致**。
6. 编译用的 `cpp/build/installer-stage/<app>/setup.nsi` 均含 `!define VERSION "1.0.0-pre4"`，
   产品名分别为 6 个产品。

未做真实「静默安装 + 卸载」跑测：那会写入用户 HKCU 的环境变量与卸载键，属于对开发机注册表的
持久改动；本任务验收口径为解包级校验，故以第 2–6 项为准。若需要，可在隔离用户下补做。

## 5. 源码/脚本变更（均在 cpp/** 写作用域内）

- `cpp/tools/build.mjs`：6 应用的 modes 与 mode.hpp 对齐（inc/ifm/ipm 增加 `gui`；
  iim/int/ing 为 `cli,gui`），`MODES` 同步；保留 objdump 导入表白名单审计（读不到即失败）。
- `cpp/tools/package.mjs`：`RELEASE`/`VERSION` 参数化（默认 v1.0pre4 / 1.0.0-pre4）；
  `APPS` 由 4 个扩到 6 个，新增 InfinityToolbox、InfinityGames；安装包文件名与 NSIS 版本
  均由 `VERSION` 生成。
- `cpp/tools/manifest.mjs`：新增；从磁盘读安装包写 `name.txt` 与 `release-assets.json`
  （缺文件即报错，不写指向不存在文件的清单）。
- `cpp/core/src/github.cpp`、`cpp/apps/ifm/main.cpp`：程序内置版本串 `1.0.0-pre3` → `1.0.0-pre4`。
- 未触碰 `history/`、Infinity Cloud / Infinity File Manager / web 目录。

## 6. 交接与遗留（交给 rel-publish / Lead）

- `cpp/tools/publish.mjs` **未改**：仍指向 `release/v1.0pre3`、`v1.0.0-pre3`，且 `REPOS` 只有 4 个
  应用。发布 6 个 pre4 安装包前需由 rel-publish（或授权我）把它参数化到 v1.0pre4 并补
  InfinityToolbox / Infinity-Games 两个仓库映射。
- `release-assets.json` 里 int/ing 的 `repo` 为按命名规律假定的 `zssx-2026/Infinity-Toolbox`、
  `zssx-2026/Infinity-Games`；发布成功后应由 publish 用 GitHub 返回的
  `browser_download_url` 覆盖。
- `cpp/README.md` 仍写着「四个产品」与 v1.0pre3 的体积表，本次未改，建议后续与 pre4 同步。
- `work/ghsync.mjs` 的目录页同步路径硬编码 `v1.0pre3/name.txt` 与 4 个 CPP_ASSETS，同样需要在
  发布阶段更新（work/ 不在我的写作用域）。
