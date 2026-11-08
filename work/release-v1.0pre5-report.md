# Infinity.Inc v1.0pre5 发行产物报告（task-4 / release-v105）

- 日期：2026-10-06（Asia/Shanghai）
- 工作区：`D:\dev\DeepSeekHarnessWorkspace\Infinity.inc`
- 目标版本：`1.0.0-pre5`，tag `v1.0.0-pre5`，版本目录 `cpp/release/v1.0pre5/`，平台 win64
- 状态：**产物已产出并验证（未发布）**。本轮未执行 `publish.mjs`（需 `EV_GH_TOKEN` 与 Lead 批准）。
- 验收：`build.mjs` 六应用 exit=0；6 个 NSIS 安装包 + `name.txt` + `release-assets.json` 齐备；`release-assets.json` 的 size/sha256 与磁盘逐一相等；六个 `--version` 均输出 `1.0.0-pre5`；安装器已接入产品图标。

## 1. 版本号统一改动（前 → 后）

| 文件:行 | 前 | 后 | 说明 |
| --- | --- | --- | --- |
| `cpp/core/src/github.cpp:8` | `const char* version() { return "1.0.0-pre4"; }` | `... "1.0.0-pre5"; }` | 中央版本常量（inc/ipm/iim/int/ing 共用；github.hpp 注释声明“一处改动”） |
| `cpp/apps/ifm/main.cpp:26` | `const char* kVersion = "1.0.0-pre4";` | `... "1.0.0-pre5";` | IFM 自带的第二个版本常量 |
| `cpp/tools/package.mjs` | 默认 `v1.0pre4` / `1.0.0-pre4`，注释 `v1.0pre4 -> 1.0.0-pre4` | 默认 `v1.0pre5` / `1.0.0-pre5` | 打包脚本默认版本目录与文件名版本 |
| `cpp/tools/manifest.mjs` | Usage 与默认 `[v1.0pre4] [1.0.0-pre4]` | `[v1.0pre5] [1.0.0-pre5]` | 清单脚本默认值 |
| `README.md` | 25 处 `pre4`（发行说明链接、下载 tag、发布目录默认值、示例文件名等） | 全部 `pre5` | 指向 `docs/RELEASE-v1.0pre5.md` 与 `v1.0.0-pre5` |
| `web/infinity/assets/site.js:51,55` | 注释 `cpp/release/v1.0pre4/...`；`RELEASE_TAG = 'v1.0.0-pre4'` | 注释与常量均为 `v1.0pre5` / `v1.0.0-pre5` | 官网下载卡片唯一版本锚点（超出 task-4 写作用域，一并统一） |
| `Infinity Cloud/tools/perf/probe.ps1:291` | `cpp\release\v1.0pre4\InfinityCloud_1.0.0-pre4_win64_setup.exe` | `...v1.0pre5...1.0.0-pre5...` | 性能探针的发行包路径（JS 产品线的工具，非 IFM 源码） |
| `version.json`（新建） | — | `{release: v1.0pre5, version: 1.0.0-pre5, tag: v1.0.0-pre5, ...}` | 机器可读的版本单点声明 |

> `cpp/tools/publish.mjs` 在本轮开始前其默认值已经是 `v1.0pre5` / `v1.0.0-pre5`，本轮未再改动；`cpp/README.md` 亦已是 pre5。

### 1.1 顺带新增（非版本号）

- `cpp/tools/package.mjs`：接入产品图标（见第 5 节）；新增可选 `INC_APPS` 过滤（逗号分隔应用目录，缺省=全部），便于按应用重建。
- `cpp/tools/manifest.mjs`：APPS 增加 `dir` 字段与可选 `INC_APPS` 过滤；缺省行为不变（六应用）。

## 2. 构建命令与退出码

```powershell
# 1) 全量重建六个应用（cmake -G Ninja + ninja -j 2 + objdump 导入表审计）
$env:NODE_OPTIONS=''
& 'D:\program\nodejs\node.exe' cpp\tools\build.mjs          # exit 0

# 2) 打包六个 NSIS 安装包（含图标）→ cpp/release/v1.0pre5/
$env:NODE_OPTIONS=''; & 'D:\program\nodejs\node.exe' cpp\tools\package.mjs   # exit 0

# 3) 写 name.txt 与 release-assets.json（size/sha256/fnv1a）
$env:NODE_OPTIONS=''; & 'D:\program\nodejs\node.exe' cpp\tools\manifest.mjs v1.0pre5 1.0.0-pre5   # exit 0
```

`build.mjs` 输出（exit 0）：

```text
built cpp\build\inc.exe  1559552 B
  dependencies: Windows only
inc  Infinity Cloud            6 names  1559552 B  Windows dependencies only
ifm  Infinity File Manager     6 names  521216 B  Windows dependencies only
ipm  InfinityPackageManager    6 names  658944 B  Windows dependencies only
iim  Infinity Installer Manager4 names  728064 B  Windows dependencies only
int  Infinity Toolbox          4 names  684544 B  Windows dependencies only
ing  Infinity Games            4 names  611840 B  Windows dependencies only
```

说明：构建前后对 `cpp/{apps,core,common}` + `cpp/CMakeLists.txt`（2433 个文件）取整体 SHA-256 快照，均为 `aacd443da54bfddad9944ed6a5f868db556dfbbf2b8b35239d0a640bbcc3ada3`，即构建期间源码未变。

## 3. 产物清单（字节数 + sha256）

### 3.1 发行目录 `cpp/release/v1.0pre5/`

| 文件 | 字节 | sha256 |
| --- | ---: | --- |
| `InfinityCloud_1.0.0-pre5_win64_setup.exe` | 514535 | `2bb448c1fd0c35f9ae8fb6ed0f32a3185444f5a52943663f4f1db5d846761544` |
| `InfinityFileManager_1.0.0-pre5_win64_setup.exe` | 238305 | `4ea7673c84cd47be7d0da1d603a36d44e6b1c0886456ea2025f8e66ec18ff310` |
| `InfinityGames_1.0.0-pre5_win64_setup.exe` | 268383 | `be13f9c615aa5131840c8c32d2b3da8e5fdc834e9811669cf0a443f15431398c` |
| `InfinityInstallerManager_1.0.0-pre5_win64_setup.exe` | 306796 | `3b0de0ed42a9dd9270e6c9e90f1d1c0df837270e3337ab16c5e2a317c9419221` |
| `InfinityPackageManager_1.0.0-pre5_win64_setup.exe` | 288313 | `8295d0ad64c38778bd63f2f0eb028c33de2902406aa44c17673543cfc3c8a3ee` |
| `InfinityToolbox_1.0.0-pre5_win64_setup.exe` | 296537 | `fdd66258d5627771b879abb1829ed2b2ff00cc6feb8745c73ab8bdbc1e1fd2d3` |
| `name.txt` | 614 | `8ba19832f532e7b5d0ae9825b192b4d44bc64bb31cdfa30277a92803e12f5c12` |
| `release-assets.json` | 2485 | `cb619d53990345b7c049c64353df509e46f09ccdf95f6edbd75e4ab22a3d36f3` |

`release-assets.json`：`tag=v1.0.0-pre5`、`version=1.0.0-pre5`、`assets=6`、`generated=2026-10-06T01:34:24.624Z`；每条资产的 size/sha256 已与磁盘逐一比对相等（6/6）。

### 3.2 各应用二进制（`cpp/out/<app>/`，同一应用名下所有名字是同一份副本）

| app | 产品 | 字节 | 名字数 | sha256（`<app>_cli.exe`，等同 `cpp/build/<app>.exe`） |
| --- | --- | ---: | ---: | --- |
| inc | Infinity Cloud | 1559552 | 6 | `2296ce390c115989af574ece81fa251477004fa76020c58c489f7b871e7d651e` |
| ifm | Infinity File Manager | 521216 | 6 | `8eadc46453d62db12958a3c08824b099e781d437e17b312a841583cf9232ada2` |
| ipm | InfinityPackageManager | 658944 | 6 | `fcce903d6cd907827a9aa90c34df2ff607aaeaa84dfd11a82d52ec9bcd995ec9` |
| iim | Infinity Installer Manager | 728064 | 4 | `2ae09e17e91a5df504cac5693f0f1a535d3a234578a814a5215f62eae0bfd483` |
| int | Infinity Toolbox | 684544 | 4 | `1e1e8a23ffa35861b0f13b716563301eab013e82e1dfdb339afdd7751a20f96e` |
| ing | Infinity Games | 611840 | 4 | `cc8bb3193518ecec7f4c128fe910fc5f0cff0c491b7d003a134901fa447aabe4` |

### 3.3 可验证发行目录 `installers/packaging/v1.0pre5/`

6 个安装包副本 + `name.txt` + `release-assets.json` + `icons/`（6 个 .ico）+ `SHA256SUMS.txt`（1311 B，sha256 `38d2abce5a8ba99d37dad5e85a60d787f85013b99450b0dcb7d99a1a4398853c`）。

### 3.4 图标（`icons/` 既有，未生成新图标）

| 文件 | 字节 | sha256 |
| --- | ---: | --- |
| `inc.ico` | 8425 | `d0e3bd6a34dac65e3ac3a8ad46866db30027a43762612ba95250d524be969adb` |
| `ifm.ico` | 8112 | `255409a5ae4789ee74ddeb900df468e7b2a45b12f563bcdc0cfb2ec4baf6f8a6` |
| `ipm.ico` | 9467 | `a19cf69e74bb946f6488f70dfcfe6e4b768707bac38e250a21ee3979acad09c4` |
| `iim.ico` | 7905 | `dc73410e1941cbbdb4a69ca862f4ecea3b63c943b6d7b495cf08394d9ae46e04` |
| `int.ico` | 8241 | `b84cf22e2a3d419db9f0fc4f12c26a113a60742599fa18afd4632209f0536b4e` |
| `ing.ico` | 8242 | `f774518c62b31cc6e52780473bb7f6d1d294d335a974109206b9e86115f74fa3` |

每个 .ico 均为 7 尺寸（16/24/32/48/64/128/256），满足 PLAN-v1.0pre5 第 2 节的规格，**无需生成**。

## 4. 验证方式与结果

1. **构建**：`build.mjs` exit=0；六应用均通过导入表白名单审计，输出 `Windows dependencies only`。
2. **二进制版本串**：六个 `<app>_cli.exe --version` 均 exit=0，输出 `1.0.0-pre5`：
   `Infinity Cloud [v1.0.0-pre5]`、`Infinity File Manager 1.0.0-pre5`、`InfinityPackageManager 1.0.0-pre5`、`Infinity Installer Manager [v1.0.0-pre5]`、`Infinity Toolbox [v1.0.0-pre5]`、`Infinity Games [v1.0.0-pre5]`。
   另按字节在 exe 中检索：每个二进制 `1.0.0-pre5` 命中 1 处，`1.0.0-pre4` 命中 0 处。
3. **清单一致性**：`release-assets.json` 中 6 条资产的 size+sha256 与磁盘 6 个安装包逐一相等（脚本重算，PASS）。
4. **NSIS 图标接入**（对 6 份生成的 `cpp/build/installer-stage/<app>/setup.nsi` 做文本断言，全部 true）：
   `File "<app>.ico"`（载荷内携带 .ico）、`!define MUI_ICON` / `!define MUI_UNICON`、`WriteRegStr ... "DisplayIcon" "$INSTDIR\<app>.ico"`、`CreateShortCut ... "$INSTDIR\<app>.ico" 0`。
5. **安装器图标资源**：对每个 setup.exe 按字节检索对应 `icons/<app>.ico` 的 7 个图像条目，6/6 全部命中 16/24/32/48/64/128/256——即 `MUI_ICON` 确实把产品图标编入了安装器 PE 资源。
6. **打包器**：`makensis` 6/6 exit=0（`package.mjs` 总 exit=0）。
7. **归档器限制**：本机 PATH 无 `7z`，仅有 `temp/tools/7za.exe`（7-Zip 21.07），其 NSIS 解析返回 `Errors: 1`，故第 4/5 项的文本断言 + PE 资源字节比对替代了 `7z l` 载荷列表。

## 5. 图标并入 installers/packaging

- 输入：`icons/{inc,ifm,ipm,iim,int,ing}.ico`（既有资源，多尺寸）+ `icons/preview.png`，复制到 `installers/packaging/icons/`，并生成 `installers/packaging/icons.sha256`。
- 接线（`cpp/tools/package.mjs`，不改 NSIS 之外的构建）：
  - `stage()` 校验 `icons/<dir>.ico` 存在并复制进安装载荷；缺失即抛错，不再静默用默认图标。
  - 生成的 `setup.nsi` 增加 `!define MUI_ICON/MUI_UNICON`（安装器/卸载器自身图标）。
  - 载荷 `File "<dir>.ico"`；开始菜单 `Open.lnk`/`Uninstall.lnk` 指定 `$INSTDIR\<dir>.ico`；卸载项 `DisplayIcon` 指向该 .ico。
- 组装：`installers/packaging/v1.0pre5/` 含 6 个安装包副本、`icons/`、`name.txt`、`release-assets.json`、`SHA256SUMS.txt`，可直接用 `Get-FileHash`/`certutil -hashfile` 复验。

## 6. ING（Infinity Games）说明

- **ING 产品线由另一个 Agent 负责**；本轮按 Lead 指示将其纳入 v1.0pre5 六应用清单（`ghsync` 硬校验资产数=6），**仅以其既有二进制制品打包**，未改动 Infinity Games 的任何源码/资源。
- 本任务从未编辑 `cpp/apps/ing/**`、`icons/ing.ico` 或 ING 专属脚本；`git status` 中 `cpp/apps/ing/main.cpp` 的改动（+261/−47）是本会话开始前就存在的工作树改动，非 release-v105 所为。
- 本轮 `build.mjs` 全量重建时 ING 源码处于冻结状态（源码快照在构建前后一致），打包用的是该源码对应的 `cpp/out/ing/*.exe`（sha256 `cc8bb319...aabe4`，611840 B）。

## 7. 仍显示旧版本号的位置（grep 1.0pre2/1.0pre3/1.0pre4）

### A. 历史资料（应保留，不需改）

- `docs/RELEASE-v1.0pre4.md`（v1.0pre4 发行说明全文）、`cpp/release/v1.0pre3|v1.0pre4/`（历史产物）、`work/*.md` 中 rel-*/qa-*/archive-*/docs-*/ghsync-* 等历史报告、`cpp/apps/iim/bench/tmp/releases.json`（API 快照）。
- `docs/RELEASE-v1.0pre5.md:73` 的「相对 v1.0.0-pre4」是版本对比表述，保留。
- `cpp/tools/publish.mjs:27` 注释「v1.0.0-pre3 and friends」为说明性文字，非版本常量。

### B. 待办：需由对应 owner 统一的现行位置（本轮未改，避免越界）

- **Infinity File Manager（ifm-sea 负责，Lead 明确本轮不碰）**：`Infinity File Manager/sourcecode/package.json:4`（`1.0.0-pre2`）、`sourcecode/tools/release.mjs:145`、`sourcecode/tools/make-setup.mjs:115`（默认 `v1.0pre2`）。这正是 Lead 冒烟发现「IFM SEA 产物仍打印 v1.0pre2」的根因所在。
- **Infinity Cloud（JS/SEA，v1.0pre2 线）**：`sourcecode/package.json:4`、`src/cli.js:97`、`src/gui/server.js:27`、`src/main.js:26`、`src/installer.js:136`、`tools/make-setup.mjs:153`、`tools/release.mjs:124`。
- **InfinityPackageManager（JS 线）**：`InfinityPackageManager/InfinityPackageManager/package.json:4`（`1.0.0-pre2`）。
- **目录/注册表数据（发布后刷新）**：`dist/applist.json`、`dist/url.json`（仍指 `*_1.0.0-pre4_win64_setup.exe`）；`dist/backup-ipm2/`、`dist/backup-pre4/` 为备份快照。
- **官网**：`web/infinity/assets/releases.json:1`（2026-10-04 抓取的 pre4 数据快照）；`web/infinity/assets/verify-download.ps1:11` 示例文件名仍为 pre4。
- **work 下工具脚本**：`work/backup-publish.mjs:52`（默认 `v1.0.0-pre3`）、`work/ghsync-source.mjs:204`（keys 含 `docs/RELEASE-v1.0pre4.md`）、`work/dl-render-test.mjs:44`、`work/_gitee/test-release.mjs:12`。

> 已统一的现行位置：`README.md`（0 处 pre4）、`cpp/README.md`（0 处）、`cpp/tools/{package,manifest,publish}.mjs`、`web/infinity/assets/site.js`、`Infinity Cloud/tools/perf/probe.ps1`、`version.json`。

## 8. 遗留与未做

1. **未执行发布**：`publish.mjs --dry-run` / 真发均需 `EV_GH_TOKEN` 与 Lead 批准；本轮只到本地发行产物。
2. **`docs/RELEASE-v1.0pre5.md` 仍是草稿**（字节/SHA 全为「待填」；`docs/` 不在 task-4 写作用域）。建议文档 owner 直接引用本报告第 3 节数据回填。
3. **exe 资源段图标未做**：PLAN 第 2 节提到的 windres `.rc`（让 `<app>_cli.exe` 自身带图标）不在本轮范围；本轮只做安装器侧（MUI_ICON/MUI_UNICON、载荷 .ico、快捷方式、DisplayIcon）。
4. **未新增桌面快捷方式**：原脚本只创建开始菜单项，本轮保持该行为，仅给既有快捷方式加图标。
5. **`7z l` 载荷列表校验无法执行**（本机无 7z，内置 7za 不支持 NSIS），已用 setup.nsi 断言 + PE 资源字节比对替代；建议发布机上补一次 `7z l` 复核。
6. **未触碰**：`history/`、`work/sync-history.mjs`、ING 源码、`Infinity File Manager/sourcecode/src/**`。
7. `web/` 与 `Infinity Cloud/tools/perf/` 的两处改动超出 task-4 名义写作用域，但属于「版本号统一」要求，已在上文列出。

## 9. 本轮变更文件总表

| 文件 | 动作 |
| --- | --- |
| `cpp/core/src/github.cpp` | 版本常量 → pre5 |
| `cpp/apps/ifm/main.cpp` | 版本常量 → pre5 |
| `cpp/tools/package.mjs` | 默认版本 → pre5；图标接入；`INC_APPS` 过滤 |
| `cpp/tools/manifest.mjs` | 默认版本 → pre5；`dir`/`INC_APPS` |
| `README.md` | pre4 → pre5（25 处） |
| `web/infinity/assets/site.js` | `RELEASE_TAG` → v1.0.0-pre5 |
| `Infinity Cloud/tools/perf/probe.ps1` | 探针路径 → pre5 |
| `version.json` | 新建 |
| `cpp/out/**`、`cpp/build/**` | 重建产物（30 个名字副本 = 6+6+6+4+4+4，以及 6 个 build exe） |
| `cpp/release/v1.0pre5/**` | 新建：6 安装包 + name.txt + release-assets.json |
| `installers/packaging/**` | 新建：icons/、icons.sha256、v1.0pre5/、SHA256SUMS.txt |
| `work/release-v1.0pre5-report.md` | 本报告 |

