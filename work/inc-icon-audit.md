# Infinity Cloud 图标 / 资源引用静态审计（inc-icon-audit）

- 审计日期：2026-10-05
- 审计人：proj-inc（teammate）
- 审计范围：`Infinity Cloud/**` 源码（`.js .mjs .cjs .json .nsi .md .txt`）中出现的图标 / 资源 / 文件路径引用
- 方法：正则提取引用 → 相对各自基准目录解析 → 逐个 `statSync` + `SHA-256` 比对磁盘实际文件
- 运行禁令遵守情况：**未启动任何 exe / 编译 / 浏览器 / 宿主 / 服务**；仅用纯 Node 脚本读写文件（`node` 即 run_code 宿主，未派生其它进程）；未联网；未改动任何产品代码，本文件是唯一新增文件。
- 结论速览：**存在 3 处真实悬空引用（D1–D4，其中 D2 为按设计可缺省）**，另有 2 处"同名不同源"的双轨不一致（旧图标集 vs 新图标集、旧单名 exe vs 八命名 exe）。

---

## 1. 磁盘侧图标清单（`Infinity.inc/icons/`，新 SVG 世代）

| 文件 | 字节 | SHA-256 | 对应产品 |
|---|---:|---|---|
| `icons/inc.ico` | 8425 | `d0e3bd6a34dac65e3ac3a8ad46866db30027a43762612ba95250d524be969adb` | Infinity Cloud |
| `icons/ifm.ico` | 8112 | `255409a5ae4789ee74ddeb900df468e7b2a45b12f563bcdc0cfb2ec4baf6f8a6` | Infinity File Manager |
| `icons/ipm.ico` | 9467 | `a19cf69e74bb946f6488f70dfcfe6e4b768707bac38e250a21ee3979acad09c4` | InfinityPackageManager |
| `icons/iim.ico` | 7905 | `dc73410e1941cbbdb4a69ca862f4ecea3b63c943b6d7b495cf08394d9ae46e04` | Infinity Installer Manager |
| `icons/int.ico` | 8241 | `b84cf22e2a3d419db9f0fc4f12c26a113a60742599fa18afd4632209f0536b4e` | Infinity Toolbox |
| `icons/ing.ico` | 8242 | `f774518c62b31cc6e52780473bb7f6d1d294d335a974109206b9e86115f74fa3` | Infinity Games |

映射证据：文件名、`icons/src/<name>.svg` 头注释中的产品名、以及每个 .ico 内嵌 32px 主色与同名 SVG 调色板一致（上轮已核；SVG 与 .ico 均由 `icons/tools/svg2ico.py` 产出）。**本次不涉及需要猜测的映射。**

### 1.1 旧图标集（`sourcecode/assets/`，与上表不同源）

| 文件 | 字节 | SHA-256 | 说明 |
|---|---:|---|---|
| `Infinity Cloud/sourcecode/assets/inc.ico` | 102134 | `1cdcab7f52db211cfa35e51ee6f39361735c019c457a647b639b454dd4e833a4` | 旧脚本 `tools/make-icons.mjs` 生成的 BMP 条目图标 |
| `Infinity Cloud/sourcecode/assets/ifm.ico` | 102134 | `763c7a99914e15b660d6bf8edfb0a71aa9fde8d3a399ee91c54ab6d8361277f6` | 同上 |

> **双轨不一致 A**：`make-setup.mjs`（NSIS 安装包）优先用 `icons/inc.ico`（8425 B，新）；`package.mjs:116-117` / `release.mjs:91-92`（便携包/源码包）只用 `sourcecode/assets/*.ico`（102134 B，旧）。同一次发布里两条产线会用**两套视觉不同的图标**。

---

## 2. 逐条引用核对表

### 2.1 引用且磁盘存在（OK）

| # | 引用处（文件:行） | 解析路径 | 字节 | SHA-256（存在项给全量） |
|---|---|---|---|---|
| 1 | `sourcecode/tools/package.mjs:116`、`release.mjs:91`、`make-setup.mjs:101` | `Infinity Cloud/sourcecode/assets/inc.ico` | 102134 | `1cdcab7f…`（见 §1.1） |
| 2 | `package.mjs:117`、`release.mjs:92`、`make-setup.mjs:101` | `Infinity Cloud/sourcecode/assets/ifm.ico` | 102134 | `763c7a99…`（见 §1.1） |
| 3 | `make-setup.mjs:98-106`（共享优先） | `icons/inc.ico` | 8425 | `d0e3bd6a…`（见 §1） |
| 4 | `package.mjs:138`、`release.mjs:117` | `Infinity Cloud/sourcecode/VERSIONS.md` | 887 | `ff883a3c53940998b426399bc510363f967d71ac094c59ae0edbc8ea7e254c6d` |
| 5 | `package.mjs:138`、`release.mjs:117` | `Infinity Cloud/sourcecode/package.json` | 401 | `7d26abe266032e5936d48f53c1a70a8bc654dba26acc59cf62a13c449710f0bd` |
| 6 | `package.mjs:137`、`release.mjs:116` | `sourcecode/{src,tools,bin,assets}`（4 个目录） | DIR | — |
| 7 | `release.mjs:118-119` | `Infinity Cloud/installer.nsi` | 19444 | `0a26089977a1ece515d373b656e77ef8bb7a5613ae12f37b2503edd291fb742e` |
| 8 | `release.mjs:149-154` | `sourcecode/build/setup/win64.exe` | 104801495 | `9588dabdd12a4a9545c4b837e81a321f1c59d633f6e122854218c2eccacd3aa8` |
| 9 | 同上 | `sourcecode/build/setup/winx86.exe` | 98295670 | `3c7895c74bb69085d1798895cbb204c4156dbdc6f2392aefeea8f71fc253b664` |
| 10 | 同上 | `sourcecode/build/setup/win-arm64.exe` | 95996205 | `5f777f6d834164bcd3d3828fa6f8c04ec823b3b342ec9e32f26c4194986a0578` |
| 11 | `sourcecode/bin/inc.js:8` → `../src/main.js` | `Infinity Cloud/sourcecode/src/main.js` | 4108 | `7df75076d1ef6f3c1f25c0c32bfcb26ee964c010c2313f65d02831d1a3096f83` |
| 12 | `sourcecode/package.json:9` `"inc": "bin/inc.js"` | `Infinity Cloud/sourcecode/bin/inc.js` | 403 | `05981be46bf7d3e3a03c302c059dd71f2a4bca37fa1cf50a4599b1773fef0df2` |
| 13 | `package.mjs:22`、`release.mjs:33`、`package.mjs:67` | `D:/temp/tools/7za.exe` | 1231360 | `b0cfdeaf429f5cc53f85123dd8f5a5feb92c19d31aa34df257edf9a26be05f95` |
| 14 | `installer.nsi:32-33,369,388-393`（安装期路径，取自载荷） | `sourcecode/build/setup-stage/win64/inc.ico`（上次构建遗留） | 102134 | `1cdcab7f52db211cfa35e51ee6f39361735c019c457a647b639b454dd4e833a4` |
| 15 | `release/publish.mjs:7` 默认 `FILE='InfinityCloud.exe'` | `Infinity Cloud/release/InfinityCloud.exe` | 80745472 | `2fcbcf9d7b7dee6c…`（旧单名产物；`sourcecode/InfinityCloud.exe` 同 sha） |

### 2.2 悬空引用（MISSING）

| # | 引用处（文件:行） | 解析路径 | 磁盘状态 | 判定 |
|---|---|---|---|---|
| D1 | `sourcecode/tools/package.mjs:110-111`、`package.mjs:33-39`；`release.mjs:86`、`release.mjs:36-42`；`build.mjs:31` | `sourcecode/build/out/<target>/InfinityCloud.exe` | **不存在** | **真悬空** |
| D2 | `release.mjs:155-160` | `sourcecode/build/msi/{win64,winx86,win-arm64}.msi` | 不存在 | 脚本已用 `missing.push` 记为 MISSING，不抛错 → **可缺省但静默** |
| D3 | `sourcecode/src/installer.js:142` | `Infinity Cloud/program/inc.ico`（安装后 = `installDir/inc.ico`） | 不存在（`Infinity Cloud/program/` 下只有空目录 `plugins/`） | **真悬空**（快捷方式图标指向不存在的文件） |
| D4 | `installer.nsi:440-443` | `Infinity Cloud/program/plugins/fastgithub/FastGithub.UI.exe`、`plugins/aria2/aria2c.exe`、`plugins/freearc/Arc.exe`、`plugins/7zip/7za.exe` | 全部不存在（`program/plugins/` 为空） | **真悬空**（注册的环境变量指向不存在的路径） |
| D5 | `sourcecode/src/net/bootstrap.js:30,40`（`known` 候选） | `C:/Program Files/aria2/aria2c.exe`、`C:/Program Files/FastGithub/fastgithub.exe` | 不存在（本机） | **可选候选，缺失属正常**（源码语义即"先找机器上已装的"） |

#### D1 详情与修复建议

- 期望：`build-all.mjs:42-48` 现在产出的是八命名家族；`build/out/win-x64/` 实际内容为
  `inc_cli.exe, inc_launcher.exe, inc_tui.exe, inx_cli.exe, inx_launcher.exe, inx_tui.exe`（win-ia32 / win-arm64 同构；linux-x64 为无扩展名同名文件）——**没有 `InfinityCloud.exe`**。
- 即 `package.mjs` / `release.mjs` 的便携包与源码包发布路径在当前构建下会直接 `throw new Error('missing build: …InfinityCloud.exe')`。
- 修复建议（择一）：
  1. 把 `PLATFORMS[].exe` 从写死的 `'InfinityCloud.exe'` 改为实际主名（Windows `inc_cli.exe` / unix `inc_cli`），并从 `build/out/<target>/` 复制整族名字；
  2. 或直接复用 `tools/build-all.mjs` 的 `exeNames({id: target})` 与 `tools/make-setup.mjs` 的暂存逻辑，删掉 package/release 里重复的平台表。
- 附带：`sourcecode/build.mjs:31` 的 `EXE_NAME='InfinityCloud.exe'` 是同一历史遗留（旧单名 SEA 构建器），与八命名构建器 `build-all.mjs` 并存，建议标注废弃或统一。

#### D3 详情与修复建议

- `src/installer.js:110` 把 `<cwd>/program` 当作安装载荷整目录复制，随后 `:142` 用 `path.join(installDir, 'inc.ico')` 作为桌面快捷方式图标。
- 现树中 `Infinity Cloud/program/` 只有空目录 `plugins/`，既没有 exe 也没有 `inc.ico`；因此内置安装器（`inc_cli.exe install`）产出的快捷方式图标路径必然无效（PowerShell 会静默退回目标 exe 图标）。
- 修复建议：打包 `program/` 时把 `icons/inc.ico`（或 `sourcecode/assets/inc.ico`）复制成 `program/inc.ico`；或在 `installer.js` 里加 `fs.existsSync(icon)` 回退到 `process.execPath`。

#### D4 详情与修复建议

- NSIS 安装器把四个内置工具的绝对路径写进 HKCU 环境变量（`incfgit/incaria/incfreearc/inc7z`），但**没有任何源码向 `plugins/` 投放这些文件**：
  - `bootstrap.js:100-101` 实际使用的是 `<baseDir>/program/tools/<aria2c.exe|fastgithub.exe>`；
  - `accelerator.js:31` 同样指向 `<baseDir>/program/tools`；
  - `bootstrap.js:159` 另找 `FastGithub.UI.exe`（位于 `fastgithub.exe` 同级），与 `plugins/fastgithub/FastGithub.UI.exe` 命名/目录都不同。
- 修复建议（择一）：
  1. 打包时把内置工具按 `program/plugins/<name>/…` 放好，使环境变量成立；
  2. 或把 `installer.nsi:440-443` 的路径改为应用实际运行位置（`$INSTDIR\program\tools\…`），并让应用首次运行时再补写这两个变量；
  3. 顺带统一 FastGithub 的命名（`fastgithub.exe` vs `FastGithub.UI.exe`）。

### 2.3 其他资源核查（结论：干净）

- **GUI 无外部图片资源**：`src/gui/server.js:233,274` 的 logo 是纯 CSS 渐变方块（尚无图片），`:295-301` 的行内图标是按扩展名返回的 emoji 字符（仅是文件名分类正则，不指向任何图片文件）。全仓库不存在 `<img>` / favicon / `url(...)` 形式的图片资源引用，也没有以 `.png|.svg|.jpg|.gif|.webp` 结尾的实际文件路径 → 不存在图片断链。
- `Infinity Cloud/preview/apply-preview.mjs`、`Infinity Cloud/tools/perf/**`：**无任何图标/资源路径引用**。
- `Infinity Cloud/assets/`（项目根）为空目录，源码也无引用（`installer.nsi:30` 注释指向 `Infinity.inc/icons`）；属遗留空目录，可清理（不属悬空引用）。
- `Infinity Cloud/sourcecode/program/tools/` 为空目录（运行时由 `bootstrap.js` 创建），正常。

---

## 3. 双轨不一致（非悬空，但会造成同版本内行为不同）

| # | 项目 | A 侧 | B 侧 | 影响 |
|---|---|---|---|---|
| A | 图标来源 | `icons/*.ico` 新 SVG 世代（8 KB 级），被 `make-setup.mjs:98-106` 优先使用 | `sourcecode/assets/*.ico` 旧世代（102134 B），被 `package.mjs:116-117`、`release.mjs:91-92` 使用 | 安装包与便携包图标不一致 |
| B | 可执行名 | `build-all.mjs` 八命名（`inc_cli/inc_tui/inc_launcher/inx_*`） | `package.mjs`/`release.mjs`/`build.mjs` 仍用 `InfinityCloud.exe` | 见 D1，便携/源码发布路径不可用 |
| C | 图标落地位置 | `make-setup.mjs` 只暂存 `inc.ico` 进载荷 | 旧构建遗留 `build/setup-stage/win64/inc.ico` 仍是旧 102134 B 版本 | 未重跑 make-setup 前，安装包图标还是旧图 |

---

## 4. 结论与修复优先级

1. **P0（会导致运行期缺文件）**：D4（`installer.nsi:440-443` 的 4 个插件路径全部不存在）、D3（`installer.js:142` 图标路径不存在）。
2. **P1（会导致发布脚本直接失败）**：D1（`package.mjs:110-111`/`release.mjs:86` 找 `InfinityCloud.exe`）。
3. **P2（静默缺失，可接受但应显式）**：D2（MSI 未构建，脚本已记录 MISSING）。
4. **P2（一致性）**：双轨 A/B/C——建议把图标来源统一到 `Infinity.inc/icons/`，并把 `package.mjs`/`release.mjs` 的平台名表改为复用 `build-all.mjs` 的 `exeNames()`。
5. **无需处理**：D5（bootstrap 的可选候选路径）、§2.3 的空目录与 GUI 现代码。

---

## 5. 复现方式（纯 Node，不启动任何外部进程）

审计脚本逻辑（本次以内联 Node 运行，未落盘到项目）：

1. 对 `Infinity Cloud/**` 的 `.js/.mjs/.cjs/.json/.nsi/.md/.txt` 跑正则收集 `.ico|.png|.svg|assets/|icons/|VERSIONS|plugins/|build/out|build/setup|build/msi` 等命中（`grep` 工具）；
2. 对每条命中按所在文件的基准目录解析为绝对路径；
3. `fs.statSync` 取类型与大小，文件则 `crypto.createHash('sha256')`；
4. 与上表逐条对照。

机器可读中间结果：`D:/temp/inc-icon-audit.json`（31 条候选，11 条 MISSING，其中 2 条为可选候选、3 条为 MSI 可缺省、4 条为插件、1 条为 program/inc.ico、1 条为 InfinityCloud.exe）。

> 本文件由 proj-inc 产出，未修改任何产品代码；未运行 `pack-history.mjs`、未触碰 `history/`、未发布、未联网。
