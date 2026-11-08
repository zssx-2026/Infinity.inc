# JS 侧版本号统一到 v1.0pre5 + 发布快照刷新（task-9）

- 日期：2026-10-06（Asia/Shanghai）
- 工作区：`D:\dev\DeepSeekHarnessWorkspace\Infinity.inc`
- 目标版本：`v1.0pre5` / `1.0.0-pre5` / tag `v1.0.0-pre5`（与 `cpp/release/v1.0pre5/release-assets.json`、`name.txt` 一致）
- 状态：**完成**。验收 grep 四个范围均为 0；INC 与 IPM 的现有自检 exit=0（见 §3）。
- 约束：只改 `Infinity Cloud/sourcecode/**`、`InfinityPackageManager/**`、`dist/**`、`web/infinity/assets/releases.json`、`work/js-version-report.md`；未碰 Infinity Games/ING、`history/`、`work/sync-*.mjs`；未联网、未下载、未弹窗；未 commit、未 push。

## 1. 版本号改动（前 → 后，逐处）

### 1.1 Infinity Cloud/sourcecode（7 处）

| 文件:行 | 前 | 后 |
|---|---|---|
| `package.json:4` | `"version": "1.0.0-pre2"` | `"version": "1.0.0-pre5"` |
| `src/main.js:26` | `const VERSION = 'v1.0pre2'` | `const VERSION = 'v1.0pre5'` |
| `src/gui/server.js:27` | `const VERSION = 'v1.0pre2'` | `const VERSION = 'v1.0pre5'` |
| `src/cli.js:97` | `'Infinity Cloud [v1.0pre2]  ·  Infinity.Inc'` | `'Infinity Cloud [v1.0pre5]  ·  Infinity.Inc'` |
| `src/installer.js:136` | `Version: 'v1.0pre2'` | `Version: 'v1.0pre5'` |
| `tools/make-setup.mjs:153` | 默认 `'v1.0pre2'` | 默认 `'v1.0pre5'` |
| `tools/release.mjs:124` | 默认 `'v1.0pre2'` | 默认 `'v1.0pre5'` |

`tools/make-setup.mjs` 用 `.split('@@VERSION@@').join(version)` 渲染 `Infinity Cloud/installer.nsi` 模板，因此安装包标题/OutFile 会随该默认值变为 v1.0pre5。`installer.nsi` 本身未被修改（`git diff --stat -- "Infinity Cloud/installer.nsi"` 为空）。

### 1.2 InfinityPackageManager（6 文件 7 处）

| 文件:行 | 前 | 后 |
|---|---|---|
| `InfinityPackageManager/package.json:4` | `"version": "1.0.0-pre2"` | `"version": "1.0.0-pre5"` |
| `name.txt:12` | `Build status for v1.0pre2` | `Build status for v1.0pre5` |
| `nsis.nsi:21` | `PRODUCT_VERSION "v1.0pre2"` | `PRODUCT_VERSION "v1.0pre5"` |
| `nsis.nsi:25` | `OutFile "InfinityPackageManager_v1.0pre2_Setup.exe"` | `..._v1.0pre5_Setup.exe` |
| `tools/link-infinity.mjs:34` | 默认 tag `'infinity-v1.0pre2'` | 默认 tag `'infinity-v1.0pre5'` |
| `tools/make-setup.mjs:117` | 默认 `'v1.0pre2'` | 默认 `'v1.0pre5'` |
| `tools/release.mjs:151` | 默认 `'v1.0pre2'` | 默认 `'v1.0pre5'` |

（`InfinityPackageManager/package.json` 即 `InfinityPackageManager/InfinityPackageManager/package.json`，name=`infinity-package-manager`；任务描述里的 `v1.0-pre2` 实际值为 `1.0.0-pre2`。）

### 1.3 数据快照：pre4 → pre5

来源：`cpp/release/v1.0pre5/release-assets.json`（`tag=v1.0.0-pre5`、`version=1.0.0-pre5`、`generated=2026-10-06T01:34:24.624Z`、6 条资产的 name/size/sha256/repo/url）+ `cpp/release/v1.0pre5/name.txt`（614 B，sha256 `8ba19832f532e7b5d0ae9825b192b4d44bc64bb31cdfa30277a92803e12f5c12`）。

6 个安装包新值（字节 / sha256 前 16）：

| 应用 | 新文件名 | 字节 | sha256(前16) |
|---|---|---|---|
| InfinityCloud | InfinityCloud_1.0.0-pre5_win64_setup.exe | 514535 | 2bb448c1fd0c35f9 |
| InfinityFileManager | InfinityFileManager_1.0.0-pre5_win64_setup.exe | 238305 | 4ea7673c84cd47be |
| InfinityPackageManager | InfinityPackageManager_1.0.0-pre5_win64_setup.exe | 288313 | 8295d0ad64c38778 |
| InfinityInstallerManager | InfinityInstallerManager_1.0.0-pre5_win64_setup.exe | 306796 | 3b0de0ed42a9dd92 |
| InfinityToolbox | InfinityToolbox_1.0.0-pre5_win64_setup.exe | 296537 | fdd66258d5627771 |
| InfinityGames | InfinityGames_1.0.0-pre5_win64_setup.exe | 268383 | be13f9c615aa5131 |

**dist/applist.json**（23645 → 23693 B）：6 个 Infinity 包的 `latest` 与 `versions[]` 条目由 pre4 就地换成 pre5（fileName/size/url/publishedAt=generated）；`updatedAt`、`stats.updatedAt` → generated；包数/发布数/文件数统计不变（28/5/37）。
URL 主机沿用快照既有的 `zssx-2026/applications/releases/download/application-inc/<file>`（见 §5 遗留 4）。

**dist/url.json**（31740 B，等长）：`application-inc` 发布对象里 6 个 Infinity 资产换成 pre5 的 name/size/digest/url；`name.txt` 资产 size=614、digest=`sha256:8ba19832...`；`nameTxt.raw` 换成 pre5 name.txt 全文、`nameTxt.entries` 6 条 fileName 更新；顶层 `updatedAt` → generated。

**web/infinity/assets/releases.json**（69792 → 66283 B）：6 个仓库的 `v1.0.0-pre4` release 对象替换为 `v1.0.0-pre5`（tag_name/name=`v1.0.0-pre5  C++`/html_url/published_at=generated/单一 asset 的 name+size+browser_download_url+digest 全部取自 release-assets.json）；`generatedAt` → generated；为满足验收 grep，移除 3 个遗留的 `v1.0pre2` release 条目（Infinity-Cloud / Infinity-File-Manager / InfinityPackageManager，Node 时代旧 tag）；`bundles` 未改（见 §5 遗留 1）。

## 2. 改动文件 sha256（改动后）

| 文件 | 字节 | sha256 |
|---|---|---|
| Infinity Cloud/sourcecode/package.json | 401 | 6cc0ed1fd1a1164281fe7d7a3b5a62a8051248ea0a348a13c8f7690c8fb7f220 |
| Infinity Cloud/sourcecode/src/cli.js | 16934 | 8267039edee4c3bd69fd6c8568bbe9bd07c23334a281c7c46aab7245d8a1127a |
| Infinity Cloud/sourcecode/src/installer.js | 6388 | 29f6356bdf8cb8a5b279f39c4973aae5f8efdd3a6ebcb9a1718db3735b65f99f |
| Infinity Cloud/sourcecode/src/main.js | 4108 | 4ab52bc93c567b7950b9db00f3c52c9bba038f1729929d347f0bf34eb8662286 |
| Infinity Cloud/sourcecode/src/gui/server.js | 23532 | 2ae31ef89f4e5038c8801ca22af7fff847f83efc3df1e6b701feb569a99dd1a9 |
| Infinity Cloud/sourcecode/tools/make-setup.mjs | 7136 | 3de7824cb43757206414ddbe992678750d238e0351dc034f5e684cfd98f9453c |
| Infinity Cloud/sourcecode/tools/release.mjs | 7221 | e0556aece12e31d9dc8fac0afface1aac70ffced7dbf5cad12ea76e1b6a6788c |
| InfinityPackageManager/InfinityPackageManager/package.json | 684 | 6c7fa4cea4be71e15c3603446e0ff986f7725f2cd490e10675d9ff63193765db |
| InfinityPackageManager/name.txt | 750 | e73c0201d933360a1cb360a55d966513bbffd7556c7c0e9b44f5df0d6da84a58 |
| InfinityPackageManager/nsis.nsi | 11046 | d176d3d411ef3ee4ee8afbc6100565192ac436f72fa296e4f13884ff1a4b898f |
| InfinityPackageManager/tools/link-infinity.mjs | 10312 | 2ff72fdf713c26cf8a4119200234a5dbb787ad102d46008adb2e7c2edb542d60 |
| InfinityPackageManager/tools/make-setup.mjs | 5359 | a328ee03947885002c8310600b8099839048786b05850bfb1753f63fe7c51584 |
| InfinityPackageManager/tools/release.mjs | 8244 | bc5aace8491f8a3883025c2f09217e4c583d41d9acde5955dee77afa481819b7 |
| dist/applist.json | 23693 | e9b4f0d07b007f56d5c0e765769674e0cbf6e63988abcfd65e20005681a4976a |
| dist/url.json | 31740 | 9ad7fa3b1a76da4676be05aa478b625e129c67b2b5b6889ce3dfa35920f3a454 |
| web/infinity/assets/releases.json | 66283 | 85c6c912af2750d0e2b593dbfb8f6712d83d75d024c9d5ace208707056a44ba5 |

## 3. 自检命令、输出与退出码

```powershell
# 1) INC 现有自检：存储/回收站（纯本地，19 项断言）
cd "Infinity Cloud\sourcecode"; & 'D:\program\nodejs\node.exe' tools\test-trash.mjs
#   -> 19 行 "ok ..." + "all passed"；EXIT=0

# 2) 改动的 JS 语法自检（9 个文件）
& 'D:\program\nodejs\node.exe' --check <file>   # 每个 exit=0

# 3) IPM 现有自检：包内 exe 的版本命令
cd "InfinityPackageManager\InfinityPackageManager"; & .\ipm.exe version
#   -> "EasyPackageManager  v1.0.0-pre5"（并列出 15 个已安装包）；EXIT=0

# 4) 验收 grep（四个范围）
rg -n "1\.0pre[234]|1\.0-pre2" "Infinity Cloud/sourcecode" InfinityPackageManager dist web/infinity/assets/releases.json
#   -> 0 命中（四个范围分别 0 / 0 / 0 / 0）
```

说明：`ipm.exe version` 走的是 `bundle.js` 的 `getPkgVersion()`（读 exe 同目录 `package.json`），所以它直接证明 §1.2 的 package.json 改动生效：`1.0.0-pre2 → 1.0.0-pre5`。用 `node bundle.js version` 直接跑会因 `config.ROOT` 不是 exe 目录而回退成 `v0.0.0`，属该自检在 node 直跑下的固有行为，故以 exe 为准。

未运行/失效的既有检查（如实列出）：

- `tools/bootstrap-test.mjs`：会走 `ensureTools` 下载工具链，本轮禁止下载/联网，**未运行**。
- `tools/nsi-check.mjs`：脚本自身退出码 0，但其内部 `makensis` 对**模板** `Infinity Cloud/installer.nsi` 直编失败（`Bad text encoding: installer.nsi:4`，且文件含未替换的 `@@VERSION@@/@@OUTFILE@@/@@APP_DIR@@/@@EXE@@`）。该失败与版本号无关：`installer.nsi` 本次未改（`git diff` 为空），且正确流程是先经 `tools/make-setup.mjs` 渲染。渲染后（`D:/temp/nsi-pre5.nsi`，VERSION=`v1.0pre5`，`makensis /INPUTCHARSET UTF8`）已产出 `D:/temp/nsi-pre5.exe`。
- `InfinityPackageManager/release/verify.mjs`、`release/chk-apps.mjs`、`tools/head-all.mjs`：分别需要 `EV_GH_TOKEN`/网络或 `D:/temp/plan.json`，本轮禁止联网，**未运行**。

## 4. 验收对照

| 验收项 | 结果 |
|---|---|
| `Infinity Cloud/sourcecode` 内 `1.0pre2|1.0pre3|1.0pre4|1.0-pre2` = 0 | 0 ✅ |
| `InfinityPackageManager` 同上 = 0 | 0 ✅ |
| `dist` 同上 = 0 | 0 ✅ |
| `web/infinity/assets/releases.json` 同上 = 0 | 0 ✅ |
| INC 现有自检 exit=0 | `test-trash.mjs` EXIT=0（19/19）✅ |
| IPM package.json → 1.0.0-pre5 且自检 | `ipm.exe version` → v1.0.0-pre5，EXIT=0 ✅ |
| 三处数据文件按 release-assets.json + name.txt 刷新为 pre5 | 6/6 资产、name.txt、6 个 release 对象已刷新 ✅ |

## 5. 遗留（未做/需确认）

1. **`releases.json` 的 `bundles` 仍是 pre4**（24 处 `1.0.0-pre4` 的 `.zst` archive）：`release-assets.json` 没有 pre5 归档数据，最新可用的 Infinity-Archive 包就是 pre4/pre3；待归档发布后再刷新，故本轮未动。
2. **IPM 自带目录的 applist/url 仍是 pre4**：`InfinityPackageManager/InfinityPackageManager/applist.json`、`InfinityPackageManager/InfinityPackageManager/url.json`、`dist/backup-ipm2/{applist,url}.json` 仍含 `1.0.0-pre4` 的 Infinity 套装条目。它们不在任务指定的三处数据文件内（`dist` 只要求 applist/url，且 `backup-ipm2` 是备份），本轮未改；若 IPM 实际读取的是 `InfinityPackageManager/InfinityPackageManager/applist.json`，需要再刷新一次。
3. **`dist/package.json`**（name=`easy-package-manager`）version 仍是 `"1.0"`，不含 pre2/3/4 标记，不在“v1.0-pre2 → 1.0.0-pre5”范围内，未改。
4. **快照是"计划态"**：`work/release-v1.0pre5-report.md` 明确 pre5 **尚未发布**（`publish.mjs` 未执行、需 token）。本轮 URL 按 `release-assets.json` 的仓库/文件名重写，但 `dist/*` 的下载 URL 主机沿用快照既有约定 `applications/download/application-inc/`；若 pre5 实际发布到各 app 仓库（`Infinity-Cloud` 等），这三个位置的 URL 需再改成各仓库地址。
5. 未 commit/未 push；本轮产生的临时文件在仓库外：`D:/temp/nsi-pre5.nsi`、`D:/temp/nsi-pre5.exe`、`D:/temp/nsi-check.exe`、`D:/temp/trash-test/`（后两者是既有脚本自身的输出）。
6. `InfinityPackageManager/build/setup-stage/*/resources/app/package.json` 是 name=`infinity-shell` version=`1.0.0` 的 Electron 外壳产物，与产品版本号无关，未改。
