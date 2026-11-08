# Infinity File Manager 单文件可执行（SEA）重建报告

- 任务：task-5（ifm-sea）
- 时间：2026-10-06 09:13–09:33（Asia/Shanghai）
- 结论：**可行**。用本机已安装的 postject 1.0.0-alpha.6 + 本机 Node v22.22.2 真实注入了 SEA blob，产出可运行的单文件 exe；版本号已统一到 **v1.0pre5**；三个指定冒烟脚本全部退出码 0。
- 硬约束遵守：**未下载/未安装任何东西**，未启动任何可见窗口，未触碰 ING / Infinity Games / history/ / work/sync-history.mjs。

---

## 1. 前置勘察

| 项 | 结果 |
| --- | --- |
| Node v22 运行时 | `C:\Users\REDMI\.workbuddy-ai\binaries\node\versions\22.22.2-3\node.exe`，实测 `v22.22.2`，支持 `--experimental-sea-config` |
| Node v24（通用） | `D:\program\nodejs\node.exe`，实测 `v24.19.0` |
| postject | **本机已存在**：`C:\Users\REDMI\AppData\Roaming\npm\node_modules\postject\dist\cli.js`，版本 `1.0.0-alpha.6`，依赖 `commander` 已就位（无需下载） |
| postject 第二候选 | `...\postject\cli.js`（build-all.mjs 的备选路径）：不存在 |
| `D:/temp/tools` | **不存在** → `tools/build-all.mjs` 与 `bench/build-one.mjs` 都会失败（它们硬编码 `D:/temp/tools/node.exe` 与 `D:/temp/tools/runtimes`） |
| 基准运行时 SHA-256 | `ae1a50511be58e987483fdbc12125407443926d2d394669ade2352776e920dd3`（87,074,816 B） |

因为官方工具链目录不存在，我没有改别人的 `tools/`，而是新增了两个脚本（都在我的写入范围内）：

- `Infinity File Manager/bench/sea-build-local.mjs`：本地化的构建脚本，流程与 build-all 相同（一次 bundle → 一次 blob → 注入一个 exe → 其余名字硬链接），但取本机 node22 + 本机 postject，sentinel fuse 仍为 `NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`。
- `Infinity File Manager/bench/sea-exe-smoke.mjs`：真正启动构建出的 `ifm_gui.exe`（`windowsHide:true`，runGui 只在 `open===true` 时才开浏览器，所以无窗口），访问 `/`、`/api/list?lite=1`、`/api/info` 后杀掉进程——证明注入进去的不是只有 `--version` 能跑。

---

## 2. 版本号统一（本轮新增要求：v1.0pre2 → v1.0pre5）

改动文件与前后内容：

| 文件 | 行 | 前 | 后 |
| --- | --- | --- | --- |
| `Infinity File Manager/sourcecode/src/main.js` | 34 | `const VERSION = 'v1.0pre2';` | `const VERSION = 'v1.0pre5';` |
| `Infinity File Manager/sourcecode/src/gui/server.js` | 29 | `const VERSION = 'v1.0pre2';` | `const VERSION = 'v1.0pre5';` |
| `Infinity File Manager/sourcecode/src/installer.js` | 136 | `Version: 'v1.0pre2'` | `Version: 'v1.0pre5'` |

校验：`grep '1\.0pre2' Infinity File Manager/sourcecode/src` → **0 处匹配**。

---

## 3. 构建命令

工作目录 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\Infinity File Manager`：

```powershell
& 'D:\program\nodejs\node.exe' 'bench\sea-build-local.mjs'
```

退出码 0。输出摘要：

```json
{
  "node22": "C:/Users/REDMI/.workbuddy-ai/binaries/node/versions/22.22.2-3/node.exe",
  "node22_version": "v22.22.2",
  "postject": "C:/Users/REDMI/AppData/Roaming/npm/node_modules/postject/dist/cli.js",
  "modules": 12,
  "bundle_bytes": 144947,
  "blob_bytes": 145066,
  "exe_bytes": 87346176,
  "version": "Infinity File Manager [v1.0pre5]  ·  Infinity.Inc",
  "execPath": "...\\build\\out\\win-x64\\ifm_cli.exe"
}
```

## 4. 产物（字节数 / SHA-256 / 时间）

| 产物 | 字节数 | SHA-256 | mtime |
| --- | --- | --- | --- |
| `Infinity File Manager/sourcecode/build/bundle.cjs` | 144,947 | `d24f359e8ccd074af36d623f1c6243699fb794539581a014eae8b134fd75e0d1` | 2026-10-06 09:30:44 |
| `Infinity File Manager/sourcecode/build/sea-config.json` | 327 | `bb6b3eab63ff9c0f4181622a1e1a52237bdb05132d160ae620f9768567edb33f` | 2026-10-06 09:30:44 |
| `Infinity File Manager/sourcecode/build/sea-prep.blob` | 145,066 | `49adae0b196509d413731b31ac0bde24ad91d395f116c65ed421b0415813113c` | 2026-10-06 09:30:45 |
| `Infinity File Manager/sourcecode/build/out/win-x64/ifm_cli.exe`（+5 个硬链接同名同内容） | 87,346,176 | `876b3d212e8e737f6bc93025ed2ed82649f94a2caaab873d463505560a2b9599` | 2026-10-06 09:30:58 |

硬链接的 6 个名字：`ifm_cli.exe`、`ifm_gui.exe`、`ifm_launcher.exe`、`ifmx_cli.exe`、`ifmx_gui.exe`、`ifmx_launcher.exe`（按 `src/core/mode.js` 的 `MODES=['cli','gui','launcher']` × `ifm/ifmx`；每个都是 HardLink，同一份 87,346,176 B 物理文件）。

对比 10-02 旧产物（确认已更新）：bundle 129,237 B → 144,947 B；blob 129,355 B → 145,066 B；exe 80,773,120 B（node v22.11 基座）→ 87,346,176 B（node v22.22.2 基座）。

## 5. 冒烟结果（全部退出码 0）

工作目录 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc`：

```powershell
$node = 'C:\Users\REDMI\.workbuddy-ai\binaries\node\versions\22.22.2-3\node.exe'
& $node 'Infinity File Manager\bench\bundle-check.mjs'      # exit=0
& $node 'Infinity File Manager\bench\check-page.mjs'        # exit=0
& $node 'Infinity File Manager\bench\preview-http-check.mjs' # exit=0
```

| 脚本 | 退出码 | 关键输出 |
| --- | --- | --- |
| `bundle-check.mjs` | 0 | `syntax: ok`，12 模块，`generatorExportTransformed: true`，`generatorCallable: true`，`version: "Infinity File Manager [v1.0pre5] · Infinity.Inc"`，`error: null` |
| `check-page.mjs` | 0 | 内联脚本 288 行、21 个 id、`failures: []`、`PASS: true` |
| `preview-http-check.mjs` | 0 | 40 MiB 文件首块中位 14.908 ms；zip 22 条目只读 66,833 B / 12,667,100 B（0.528%）；5400 条目列表中位 40.042 ms；60 次中断后 handles 6→5、服务仍应答；`failed checks: none` |

exe 自身冒烟（工作目录 `Infinity File Manager`）：

```powershell
& '...\build\out\win-x64\ifm_cli.exe' --version   # exit=0 -> Infinity File Manager [v1.0pre5]  ·  Infinity.Inc
& '...\build\out\win-x64\ifmx_cli.exe' --version  # exit=0 -> Infinity File Manager [v1.0pre5]  ·  Infinity.Inc
& '...\bench\sea-exe-smoke.mjs'  (node22)          # exit=0
```

`sea-exe-smoke.mjs` 输出：`ifm_gui.exe` 在 `127.0.0.1:7623` 起服务，`/` HTTP 200 / 20,663 B / 含 `id="pv"`，`/api/list?lite=1` ok 且 79 条目，`/api/info` 的 `version` = `v1.0pre5`。进程已杀净：构建/冒烟后无 ifm* 残留进程，7623 与 17731 端口均已关闭。

## 6. 为何可行

1. **postject 已经在本机**，不需要 npx/下载；`tools/build-all.mjs` 里预置的正是这条路径。
2. Node v22.22.2 自带 `--experimental-sea-config`，可以直接生成 blob（145,066 B）。
3. 注入侧用同一份脚本 + 官方 sentinel fuse；注入后用字符串检查确认 exe 内含 `NODE_SEA_BLOB` 资源标记，且 exe 在 `bundle.cjs` 不在旁边的目录里照常运行（blob 确实被嵌入而不是运行时读外部文件）。
4. 因此原任务里“若无法注入就做次优启动器”的分支**不需要启用**：拿到的是真正的单文件 SEA exe。

## 7. 遗留 / 需要 lead 决策

1. `out/win-x64` 里仍有 10-02 的 `ifm_tui.exe` / `ifmx_tui.exe`（80,773,120 B，旧基座），本次**没有**重链：`src/core/mode.js` 的 `MODES` 只有 `cli/gui/launcher`，`tui` 不被识别，新的 tui 链接会退化到 GUI 面。但 `installer.nsi` 与 `tools/release.mjs` 里提到 `tui`，三处口径不一致，请 release-v105 / lead 定名后我再补链。
2. `sourcecode/tools/build-all.mjs` 的 `MODES = ['cli','launcher']`（4 名）与 `mode.js` 的 6 名不一致；且它硬编码 `D:/temp/tools`，当前环境跑不通（我的 `bench/sea-build-local.mjs` 是可用替代）。
3. 仍带默认 `v1.0pre2` 的不在我写入范围内的位置：`sourcecode/tools/make-setup.mjs:115`、`sourcecode/tools/release.mjs:145`（命令行默认值）、`sourcecode/package.json` 的 `"version": "1.0.0-pre2"`、`installer.nsi` 的版本处理。若要求全仓一致请指派。
4. 本次 bundle 反映 **2026-10-06 09:30 的工作树**（含此前 prod-ifm 对 `src/core/localfs.js`、以及 `tools/bundle.mjs` 的改动）。此后 `sourcecode/src/**` 若再变，需要重跑第 3 节命令。

## 8. 复现步骤

```powershell
# 1) 版本常量（src 内，已改）
#    src/main.js / src/gui/server.js: const VERSION = 'v1.0pre5';
#    src/installer.js: Version: 'v1.0pre5'
# 2) 构建 bundle + blob + 6 个 exe
Set-Location 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\Infinity File Manager'
& 'D:\program\nodejs\node.exe' 'bench\sea-build-local.mjs'
# 3) 冒烟
Set-Location 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
$node = 'C:\Users\REDMI\.workbuddy-ai\binaries\node\versions\22.22.2-3\node.exe'
& $node 'Infinity File Manager\bench\bundle-check.mjs'
& $node 'Infinity File Manager\bench\check-page.mjs'
& $node 'Infinity File Manager\bench\preview-http-check.mjs'
Set-Location 'Infinity File Manager'
& $node 'bench\sea-exe-smoke.mjs'
& 'sourcecode\build\out\win-x64\ifm_cli.exe' --version
```

---

# 增补（task-8）：版本号收尾与 tui 口径统一

- 时间：2026-10-06 09:40–09:48（Asia/Shanghai）
- 结论：sourcecode 内旧版本号已清零；tui 口径统一为 **已移除**（保留 `cli / gui / launcher` 六名），过期 tui 产物已删除；四个冒烟复跑全部 exit=0。

## 9.1 设计意图判断：tui 已废弃，不留

证据：

1. `cpp/README.md`「### The terminal interface was removed」明文写死：*"An earlier revision also had a `tui` face ... It was dropped from **every** application. ... What is left is one face for scripts (`cli`) and one for people (`gui`)."* —— 这是整套 Infinity.Inc 的既定架构决策。
2. IFM JS 侧 `src/core/mode.js` 的 `MODES = ['cli','gui','launcher']`、`src/main.js` 头部注释的六名（ifm/ifmx × cli/gui/launcher）、`src/gui/server.js` 的 GUI 面，三者自洽，且 `src` 内 0 处 tui 引用。
3. 唯一残留是 `src/ui/ifm.js`（808 行，导出 `Ifm` / `runIfm`），但全仓 **0 处 import**，是孤儿死代码，也没进 bundle（bundle 仍 12 模块）。
4. 反证材料：`installer.nsi` 的 `ifmtui/ifmxtui` 环境变量、`tools/release.mjs` 的注释、`out/win-x64` 的 10-02 tui exe，都属于旧口径残留。

选择：**统一为 cli/gui/launcher，不补齐 tui**。理由：补齐需要把 `src/ui/ifm.js` 接进 `main.js`、给 `mode.js` 加 `'tui'`、并让 launcher 从两选一变三选一——那是新增功能，不是收尾，且与 cpp 侧"tui 已从每个应用移除"的架构决定直接冲突。

## 9.2 改动清单（前 → 后）

| 文件 | 行 | 前 | 后 |
| --- | --- | --- | --- |
| `sourcecode/tools/make-setup.mjs` | 115 | `process.argv[2] \|\| 'v1.0pre2'` | `process.argv[2] \|\| 'v1.0pre5'` |
| `sourcecode/tools/release.mjs` | 145 | `process.argv[2] \|\| 'v1.0pre2'` | `process.argv[2] \|\| 'v1.0pre5'` |
| `sourcecode/tools/release.mjs` | 22 | `<p>_cli / <p>_tui / <p>_launcher` | `<p>_cli / <p>_gui / <p>_launcher` |
| `sourcecode/tools/build-all.mjs` | 68 | `export const MODES = ['cli', 'launcher'];` | `export const MODES = ['cli', 'gui', 'launcher'];` |
| `sourcecode/tools/build-all.mjs` | 12–17 | 四名表、"The four are…"、"instead of four" | 六名表（补 `ifm_gui / ifmx_gui`）、"The six are…"、"instead of six" |
| `sourcecode/package.json` | — | `"version": "1.0.0-pre2"` | `"version": "1.0.0-pre5"` |
| `sourcecode/build/out/win-x64/ifm_tui.exe`、`ifmx_tui.exe` | — | 各 80,773,120 B，2026-10-02 | **已删除**（过期 tui 产物） |

`build-all.mjs` 导出的 `exeNames` 实测（动态 import）：

```
MODES: ["cli","gui","launcher"]
exeNames(win-x64):   ["ifm_cli.exe","ifm_gui.exe","ifm_launcher.exe","ifmx_cli.exe","ifmx_gui.exe","ifmx_launcher.exe"]
exeNames(linux-x64): ["ifm_cli","ifm_gui","ifm_launcher","ifmx_cli","ifmx_gui","ifmx_launcher"]
```

与 `mode.js` 的 MODES 完全一致。`release.mjs` 与 `make-setup.mjs` 都从 `exeNames` 派生名字，所以发布 zip / 安装包现在会带 **gui** 面，而不是继续引用不存在的 tui。

## 9.3 验收

| 检查 | 结果 |
| --- | --- |
| `grep -E '1\.0pre2|1\.0\.0-pre2'` over `sourcecode/` | **0 命中** |
| `grep tui` over `sourcecode/` | **0 命中** |
| `bench/bundle-check.mjs` | exit **0**（syntax ok、12 模块、version `v1.0pre5`） |
| `bench/check-page.mjs` | exit **0**（PASS true、failures []） |
| `bench/preview-http-check.mjs` | exit **0**（failed checks: none；首块中位 10.525 ms、5400 条目 35.319 ms、zip 0.528%） |
| `bench/sea-exe-smoke.mjs` | exit **0**（页面 200 / 20,663 B、`id="pv"`、`/api/info` version `v1.0pre5`） |
| `ifm_cli.exe --version` | exit **0** → `Infinity File Manager [v1.0pre5]  ·  Infinity.Inc` |

产物未变（第 9.2 的改动都不进入 bundle）：bundle.cjs 144,947 B `d24f359e…`；sea-prep.blob 145,066 B `49adae0b…`；ifm_cli.exe 87,346,176 B `876b3d21…`（+5 硬链接）。`out/win-x64` 现在只剩 6 个新 exe，无 tui 残留。

## 9.4 仍不在本次写入范围（需 lead / release-v105 接手）

1. `Infinity File Manager/installer.nsi`（在 IFM 根目录，不在 `sourcecode/**`）：仍有 `ifmtui` / `ifmxtui` 的 `WriteRegStr` / `DeleteRegValue`（约 L410 / L414 / L483 / L487），应随 tui 口径一并删除。本任务硬约束只允许改 `sourcecode/**`，故未动。
2. `sourcecode/src/ui/ifm.js`：808 行孤儿 TUI，0 引用。按"不擅自删既有源码"保留；若确认 tui 永久移除，可另行删除或归档。
3. `sourcecode/build/setup-stage/**`：10-02 的旧 staging（内含 Electron shell 的 package.json 1.0.0），不属本次版本号收尾范围。
4. `tools/build-all.mjs` 仍硬编码 `D:/temp/tools/runtimes`（本机不存在），实际构建请用 `bench/sea-build-local.mjs`；这是环境路径问题，不是命名/版本问题，未在本任务改动。
