# rel-catalog 报告：IPM 目录刷新到 v1.0pre4

- 任务：task-8（owner rel-catalog）
- 完成时间：2026-10-04（Asia/Shanghai）
- 触发条件：探测 `repos/zssx-2026/<6 个应用仓库>/releases/tags/v1.0.0-pre4` 全部存在且各含 1 个 uploaded 资产，故按 Lead 授权直接执行。
- 结论：application-inc 页已由 pre3（4 包）接管为 v1.0pre4（6 包）+ 新 name.txt；dist 三件套已同步；全部校验 PASS。

## 1. ghsync.mjs 的目录逻辑（原文摘录）

`work/ghsync.mjs`（属于 proj-web 写作用域，本任务只读）：

```js
const CATALOG_REPO = 'applications';
const CATALOG_TAG = 'application-inc';
// 每个 Release 即 IPM 的一个目录页；页面用 name.txt 广播构建，行格式：
//   <asset name> <version> <package> <install kind> <company> <platform>
// name 若不同时是该 Release 的资产则被跳过 —— 所以安装包要同时挂到目录页。
// publishCatalog(): 删除 CATALOG_OBSOLETE(/^InfinityCloud_v0\.1_.*\.(exe|msi)$/)
//   + 与 CPP_ASSETS 同名的资产 + name.txt，然后重新上传 4 个 exe 与 name.txt。
```

- 解析端（C++ `cpp/apps/ipm/main.cpp:219-237`）：`columns[0]`=asset 名（必须命中同页资产）、`columns[1]`=version（去首字母 v）、`columns[2]`=package、`columns[3]`=install kind（列数 ≥6 才取）、`columns[5]`=platform（列数 ≥6 才取，否则 any）。
- 解析端（Node `dist/bundle.js` `src/names.js:5103-5121`）：`parts[1]`=version（去 v）、`parts[2]`=name、`parts[3]`=type（setup/port）、`parts[4]`=company（默认 null）；列数 <4 的行丢弃。
- 排序（`main.cpp:265-271`）：package（忽略大小写）→ platform → version 降序。name.txt 行序不影响结果。

## 2. application-inc 页更新

Release: `applications`，tag `application-inc`，id `398198245`（已存在，未新建）。

### 2.1 更新前后资产对比

| 动作 | 资产 | 大小 (B) | 结果 |
| --- | --- | --- | --- |
| 删除 | InfinityCloud_1.0.0-pre3_win64_setup.exe | 441856 | 已删除 |
| 删除 | InfinityFileManager_1.0.0-pre3_win64_setup.exe | 187658 | 已删除 |
| 删除 | InfinityInstallerManager_1.0.0-pre3_win64_setup.exe | 262570 | 已删除 |
| 删除 | InfinityPackageManager_1.0.0-pre3_win64_setup.exe | 241405 | 已删除 |
| 删除+上传 | name.txt（424 B → 614 B） | 424 → 614 | 已替换 |
| 上传 | InfinityCloud_1.0.0-pre4_win64_setup.exe | 477846 | uploaded |
| 上传 | InfinityFileManager_1.0.0-pre4_win64_setup.exe | 235017 | uploaded |
| 上传 | InfinityPackageManager_1.0.0-pre4_win64_setup.exe | 278021 | uploaded |
| 上传 | InfinityInstallerManager_1.0.0-pre4_win64_setup.exe | 302978 | uploaded |
| 上传 | InfinityToolbox_1.0.0-pre4_win64_setup.exe | 262473 | uploaded |
| 上传 | InfinityGames_1.0.0-pre4_win64_setup.exe | 262882 | uploaded |

更新后页面资产 = 6 个安装包 + name.txt = 7 个，pre3 条目 0 个残留。
上传顺序：先传 6 个新包（与 pre3 不同名，无冲突）→ 再替换 name.txt → 最后删除 4 个 pre3 包，全程页面都保持“name.txt 所引用的资产存在”。

### 2.2 新版 name.txt（6 行，照抄现有约定：第 2 列为 Infinity.Inc）

```text
InfinityCloud_1.0.0-pre4_win64_setup.exe Infinity.Inc InfinityCloud setup Infinity.Inc win64
InfinityFileManager_1.0.0-pre4_win64_setup.exe Infinity.Inc InfinityFileManager setup Infinity.Inc win64
InfinityPackageManager_1.0.0-pre4_win64_setup.exe Infinity.Inc InfinityPackageManager setup Infinity.Inc win64
InfinityInstallerManager_1.0.0-pre4_win64_setup.exe Infinity.Inc InfinityInstallerManager setup Infinity.Inc win64
InfinityToolbox_1.0.0-pre4_win64_setup.exe Infinity.Inc InfinityToolbox setup Infinity.Inc win64
InfinityGames_1.0.0-pre4_win64_setup.exe Infinity.Inc InfinityGames setup Infinity.Inc win64
```

字节数 614，sha256 `b2a95228e6c27618cb6c30caff531ce30565cca5ec1cbe659e3060d196baf75f`（与 `cpp/release/v1.0pre4/name.txt` 同源）。

### 2.3 API 校验（GET /repos/zssx-2026/applications/releases/tags/application-inc）

| name.txt 行内 asset | 页内存在 | 页内 size | 本地 size | digest == 本地 sha256 |
| --- | --- | --- | --- | --- |
| InfinityCloud_1.0.0-pre4_win64_setup.exe | 是 | 477846 | 477846 | 是 |
| InfinityFileManager_1.0.0-pre4_win64_setup.exe | 是 | 235017 | 235017 | 是 |
| InfinityPackageManager_1.0.0-pre4_win64_setup.exe | 是 | 278021 | 278021 | 是 |
| InfinityInstallerManager_1.0.0-pre4_win64_setup.exe | 是 | 302978 | 302978 | 是 |
| InfinityToolbox_1.0.0-pre4_win64_setup.exe | 是 | 262473 | 262473 | 是 |
| InfinityGames_1.0.0-pre4_win64_setup.exe | 是 | 262882 | 262882 | 是 |
| name.txt | 是 | 614 | 614 | 是 |

全部 19 项校验 PASS（含：页内恰好 7 个资产、name.txt 每行 asset 均存在且大小一致、name.txt 与 6 个安装包双向一一对应、6 包 digest 与本地 sha256 一致）。

## 3. dist 三件套同步

### 3.1 dist/url.json（新增 application-inc release 记录 + updatedAt）

- `updatedAt`: `2026-09-28T10:36:24.954Z` → `2026-10-04T07:16:49.670Z`
- `releases`: `[application2(10), application1(16)]` → `[application-inc(7), application2(10), application1(16)]`（新页按 GitHub 时间倒序放最前，既有两条相对顺序不变）
- `source` 不变；release/asset/nameTxt/entries 的字段集合与旧记录逐键一致（校验 PASS），未新增字段。
- 新增记录：id 398198245、publishedAt 2026-09-28T11:47:20Z、kind `app`、`nameTxt.raw` = 上面的 6 行，`nameTxt.entries` = 6 条 `{fileName, version:"Infinity.Inc", name, type:"setup", company:"Infinity.Inc"}`；asset 的 `type` 由 `classify()` 得 `installer`（name.txt 为 `unknown`）。
- 文件：524 行/21470 B → 669 行/28066 B；sha256 `39519d1f82e4e42f23add3dc7d0bfb5c0587aceb166344e7149694d475143011`

### 3.2 dist/applist.json（按 url.json 重算）

- `count`: 20 → 26；`stats`: `{pkgCount:20, releaseCount:2, fileCount:26}` → `{pkgCount:26, releaseCount:3, fileCount:33}`；`stats.updatedAt` = url.json 的 updatedAt。
- 新增 6 个 package（各 1 个 version，tag `application-inc`）：InfinityCloud、InfinityFileManager、InfinityGames、InfinityInstallerManager、InfinityPackageManager、InfinityToolbox；插在 `idman` 与 `lanzoud` 之间（仍按 name 忽略大小写升序）。
- package 内部 version 升序、`latest` 取末位（沿用 `sources.listPackages()` 的 `compareVer`）；其余 20 个 package 的字节内容不变。
- 文件：498 行/16708 B → 636 行/22026 B；sha256 `f9bfe35cd1b0706ba2f906df6707f3d67b6c41ae82adeab1125c2c2f993ac623`
- 校验：用 url.json 重放 `listPackages()` + `build()` 与写入内容逐字段一致（PASS）。

### 3.3 dist/registry.json（无改动）

- 现有 3 条安装记录 ARCHPRV / lanzoud / IDEA 的 source 均为 `application1` 页，安装包在页面上仍然存在，也不在本次删除集合内；按“仅删除目录中已不存在的条目”的规则无一条命中。
- 文件与备份逐字节相同（PASS），schema 仍为 `{version, packages}`。

## 4. 备份与回滚

- 原文件已备份到 `dist/backup-pre4/`（applist.json / url.json / registry.json），可原样拷回。
- 回滚页面：重新上传 `cpp/release/v1.0pre3/` 的 4 个 exe 与 `name.txt`，再删除 6 个 pre4 包即可（pre3 文件仍在盘上）。
- 临时抓取的 `dist/.tmp-inc-release.json` 已删除。

## 5. 风险与遗留

1. **ghsync.mjs 仍是 pre3 硬编码（高风险）**：`CPP_ASSETS`/`publishCatalog()` 还是 4 个 pre3 包 + `cpp/release/v1.0pre3/name.txt`；一旦有人再次运行 ghsync，它会删掉本页的 name.txt、传回 4 个 pre3 包，留下 pre3+pre4 混页。需 proj-web（task-5）同步改成 6 个 pre4 包后再允许运行。
2. **dist 与线上其它目录页存在既有偏差（本次未扩大改动面）**：线上 applications 仓库还有 `application-local`(28 资产)、`application-001`(148 资产)、`v1.0pre1`、草稿 `001`，而 dist 快照仍只有 application1/application2 + 本次新增的 application-inc。本次按“与新发布一致”的最小增量处理；若要让 dist 全量对齐线上，需要另开任务整页重抓（会新增约 170+ package）。
3. **name.txt 第 2 列沿用 Infinity.Inc**：按 Lead 指示照抄既有约定，未自创 version。副作用是 IPM 界面会把 version 显示为 `Infinity.Inc`（C++/Node 解析端第 2 列都是 version）。如需修正，应同时改 `cpp/tools/manifest.mjs`、已发布 name.txt 与 dist，属跨作用域变更。
4. 页面在替换 name.txt 的瞬间存在“无 name.txt”窗口（删除后立即上传），窗口很短；顺序已保证安装包先到位。

