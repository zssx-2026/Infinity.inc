# InfinityStudio 与 InfinityServer — 交付记录（2026-10-16）

## 一、这一轮做了什么

用户要求两件事：把六个产品整合成 **InfinityStudio**（Visual Studio 那种「勾选工作负载」的安装器，Electron 打包），以及按文档做一份 **InfinityServer 的 Electron 实现**。两者都已落地并通过离线验收。

## 二、InfinityStudio（<root>\InfinityStudio\）

| 文件 | 字节 | sha256(前12) | 作用 |
| --- | --- | --- | --- |
| `InfinityStudio/src/catalog.js` | 5,872 | `74840e9eb180` | 产品表、4 个工作负载、形态命名、工作负载展开成具体文件名 |
| `InfinityStudio/src/planner.js` | 8,067 | `206768a9d1a4` | 勾选 → 文件清单（实测字节 + SHA-256）→ 落地后逐文件复核 |
| `InfinityStudio/src/server.js` | 11,200 | `66cfc5e70025` | loopback 服务 + VS 风格安装器页面（零外链） |
| `InfinityStudio/src/main.js` | 1,811 | `36dae780b745` | Electron 外壳，端口 7721 |
| `InfinityStudio/src/cli.js` | 662 | `957fff5b5c43` | 无窗口启动 |
| `InfinityStudio/build.mjs` | 1,819 | `7143dcd18e8b` | 打包：拷本地 Electron → `infinitystudio_gui.exe` |
| `InfinityStudio/README.md` | 2,658 | `1c647e0656e9` | 说明 |
| `work/infinitystudio-test.mjs` | 9,931 | `29228f8114ce` | 离线验收 **36/36** |

**工作负载实测体积**（win-x64，全部条目真实存在、零缺失）：

| 工作负载 | 文件数 | 体积 |
| --- | --- | --- |
| core | 79 | 345 MiB |
| desktop（六产品窗口面） | 237 | 1.0 GiB |
| developer | 95 | 502 MiB |
| minimal | 77 | 345 MiB |

- 窗口面是 **281,073,674 B（268.0 MiB）** 的 Electron 目录（inc/ifm/ipm 各一份，87 文件），不是单个 exe —— 计划里按整棵目录搬运，否则装出来的 exe 跑不起来。
- 命令行面是多文件布局：每个名字 49,152 B 启动器 + 共享 `node.exe`（80,511,640 B）+ `app.cjs`。
- 原生产品（IIM 737,280 / INT 693,760 / ING 621,056）来自 `cpp/out/<id>`。
- 同一文件被多个工作负载点名时只计划一次（按来源路径去重），core+desktop 共 239 个文件、1.0 GiB，无重复。

三条不变式：**计划即事实**（缺件记 `missing:true`，不冒充已存在参与体积累加）、**缺件先报**（必装的 Infinity Cloud 缺件 → `POST /v1/install` 返 409，安装根本不启动）、**装完必验**（逐个 copyFileSync 后重算 SHA-256 与计划比对）。

## 三、InfinityServer（<root>\InfinityServer\）

核心六件套（ESM，零依赖）：`config.js` 4,598 B/`3b4e27ba4ca1`、`cache.js` 6,404 B/`3a09dec05696`、`billing.js` 5,160 B/`03b7f1e8c614`、`schedule.js` 7,412 B/`d0af216eb193`、`pipeline.js` 9,862 B/`1feed5fc9075`、`turing.js` 8,820 B/`53add4ec2e28`。服务 `src/server.js` 14,525 B/`359e7e2b5c5e`，外壳 `src/main.js` 2,688 B/`b71464220503`。离线验收 `work/infinityserver-test.mjs` **36/36**。

修掉的三个真 bug（都实测过）：
1. 图灵机左端越界死循环 —— 原 `if (this.head < 0) this.head = 0;` 把纸带左端钳死，`inc 1011` 跑到 10000 步 timeout；改成头向左生长 `this.tape.unshift(this.blank)`。
2. 加一机多了无用的 home 状态（`'carry,0': ['1','L','home']`）→ 改为 `['1','N','q_accept']`，修后 `1011→1100`、`1111→10000`、`0→1`、`1→10` 全对。
3. 机架执行读空纸带 + 跨运行串味 —— 从不写 tape 且用全局键，第二次运行读到上次残留；改为每次运行独立前缀 `sim<N>:` + PAD=1024 支持左生长。

## 四、Electron 打包（实测）

- `node InfinityStudio/build.mjs` → `INFINITYSTUDIO-PACK OK`，`InfinityStudio/build/win-x64/infinitystudio_gui.exe` = **188,784,128 B**
- `node InfinityServer/build.mjs` → `INFINITYSERVER-PACK OK`，`InfinityServer/build/win-x64/infinityserver_gui.exe` = **188,784,128 B**
- 运行时来自本地 `shell/node_modules/electron/dist`（electron.exe 188,784,128 B，19 个条目），**未下载任何东西**；缺运行时时脚本报错退出 2。

打包脚本自身修过一处路径 bug：`const ROOT = path.resolve(path.dirname(...), '..')` 把 ROOT 算到了工作区根（`...\src` 不存在 → ENOENT），且 `SHELL = path.resolve(ROOT,'..','shell')` 指向了工作区之外。改为 `ROOT = path.dirname(fileURLToPath(import.meta.url))`、`SHELL = path.join(ROOT, '..', 'shell')`（InfinityServer 的 build.mjs 同样修）。

## 五、终验

`work/final-acceptance.json`：`total=25, pass=25, fail=0`，at=2026-10-16T12:58:49.636Z，**FINAL-ACCEPTANCE PASS 25/25**（新增 `infinityserver` 0.5s、`infinitystudio` 15.6s）。

`work/INDEX.md` 145 行 / 12,362 B（gen-index --check 通过）。
