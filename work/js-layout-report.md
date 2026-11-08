# JS 线多文件布局改造

## 问题：单文件大侠

IFM 与 INC 每个名字都会把整个 Node 运行时打进 exe。实测 win-x64：

| 事实 | 数值 |
| --- | --- |
| 单个 exe | 80,788,480 B |
| 硬链接计数 | Links=1（**不是硬链接，是 6 份独立副本**） |
| win-x64 一个平台 | 462.3 MiB |
| 真实代码 | bundle.cjs 143,157 B（IFM）/ 120,832 B（INC） |

`build-all.mjs` 注释里写“五个是硬链接，占一份”，实测与实际不符：文件系统上就是六份运行时。

## 方案：共享运行时 + 小启动器

```
<dir>/node.exe        运行时，共享，只有一份   80,511,640 B
<dir>/app.cjs         整个程序                143,157 B
<dir>/ifm_gui.exe     启动器（窗口面）            49,152 B
<dir>/ifm_cli.exe     启动器（控制台面）          49,152 B
...                   每个名字一个
```

`work/jslayout/launcher.cpp`（5,518 B）做四件事：

1. `GetModuleFileNameW` 找到自己所在目录，校验 `node.exe` 与 `app.cjs` 都在；
2. 把自己的文件名写入 `INFINITY_EXE_NAME`（共享运行时的名字永远是 `node.exe`，程序无法据此判断形态）；
3. 从原始命令行取尾部参数，原样带上，引号与空格保真；
4. `CreateProcessW` 启动并等待，退出码原样返回。

**不保留**调用者当前目录之外的东西：CLI 必须继承用户所在目录，否则相对路径会解析到安装目录。

## 两次编译，区别只在子系统

| 面 | 编译参数 | PE subsystem | 用途 |
| --- | --- | --- | --- |
| console | `-O2 -s -static -Wl,--subsystem,console` | 3 (CUI) | cli / tui / launcher |
| window | `-O2 -s -static -mwindows -DCHILD_NO_WINDOW -Wl,--subsystem,windows` | 2 (GUI) | gui |

两版各 49,152 B，仅 6 字节不同。窗口版给运行时加 `CREATE_NO_WINDOW`——运行时本身是控制台程序，
不然双击 GUI 会闪一个黑框。源码里 `WinMain` 与 `wmain` 两个入口都给，逻辑只有一份 `run()`。

**全程无弹窗**：失败只写 stderr + 退出码 2，源码里没有任何 `MessageBoxW`。

## 结果

| 产品 | 旧 out/ | 新 layout/ | 节省 |
| --- | --- | --- | --- |
| Infinity File Manager | 462.3 MiB | 77.2 MiB | 385.1 MiB |
| Infinity Cloud | 462.1 MiB | 77.3 MiB | 384.9 MiB |

去掉共享运行时后，IFM 自身 430 KiB、INC 自身 504 KiB。

## 验证

`work/jslayout/verify-layout.mjs` — 25 项全通过（`LAYOUT-VERIFY 25/25  PASS`）：

- 6 个名字各自拿到正确的形态（prefix/mode）；
- 6 个名字参数与引号保真（`--path "C:/somewhere with spaces/a file.txt"`）；
- 6 个名字退出码回传（探针 exit 7 → 启动器返回 7），含 GUI 面；
- GUI 面运行无 stdout（不借控制台）；
- `node.exe` 只有一份；
- 布局内没有 >5 MiB 的命名 exe；
- 缺 `node.exe` 时退出码 2，而不是去猜别的程序。

真实 bundle 实测（5/5）：

```
ifm_cli.exe  --version  exit=0  "Infinity File Manager [v1.0.0-pre5]  ·  Infinity.Inc"
ifmx_cli.exe --version  exit=0  同上
inc_cli.exe  --version  exit=0  "Infinity Cloud [v1.0.0-pre5]"
inx_cli.exe  --version  exit=0  同上
```

形态判定单测 7/7：环境变量 `INFINITY_EXE_NAME` 优先，未设置时回退 `process.execPath`（单文件 exe 行为不变）。

## 源码改动

- `Infinity File Manager/sourcecode/src/core/mode.js` 与 `Infinity Cloud/sourcecode/src/core/mode.js`：
  `detect()` 改为读 `process.env.INFINITY_EXE_NAME || path.basename(process.execPath)`。

## 边界

- 编译器只有 win-x64，`RUNTIMES` 里其余 6 个平台暂不改，保持原布局而不是换成没测过的东西。
- 冻结的 v1.0pre5 发布资产未触碰，输出落在 `build/layout`，与 `build/out` 并存。
- 此改动属 pre6 计划；冻结的 v1.0pre5 发布资产未参与（`release-set-parity` 仍锁旧包）。
## 接入安装打包（setup-stage）

布局只在 build/layout 目录里不算数，安装包得真的从它取载荷。两个产品的
`sourcecode/tools/make-setup.mjs` 都已改：

- 新增 `const LAYOUT = path.join(ROOT,'build','layout')`，仅当该平台目录下同时有
  `node.exe` 与 `app.cjs` 时才切布局，否则回退 `build/out`（没测过的平台不换）。
- 切布局时额外拷 `node.exe` 与 `app.cjs`：它们不是具名 exe，按名字枚举的循环
  永远不会想到拷这两个。
- NSIS 模板用的是 `File /r "<stage>\\*.*"`（`installer.nsi` 第 355 行），整目录递归，
  所以新文件无需改模板就进了包。

### 实测

| 产品 | 平台 | 载荷 | stage | setup.exe |
| --- | --- | --- | --- | --- |
| Infinity File Manager | win64 | layout | 10 文件 / 77.4 MiB | 21,178,225 B |
| Infinity File Manager | winx86 / win-arm64 | out（回退） | 8 文件 / 412 MiB | — |
| Infinity Cloud | win64 | layout | 29 文件 / 484.9 MiB | 40,881,185 B |
| Infinity Cloud | winx86 | out（回退） | — | 69,192,737 B |

### INC 的窗口面是例外

第一次 INC 构建后 `inc_gui.exe` 与 `inx_gui.exe` 各 188,784,128 B —— Electron 壳的
`stageGui()` 覆盖了 49 KB 的启动器。这是对的：Infinity Cloud 的窗口是 Electron 目录，
不是 Node 程序，`app.cjs` 对它毫无意义，Electron 运行时无论如何都要装；布局启动器
会把它换成"起个端口却什么也不开"的东西。

因此加了 `hasGuiShell = hasGui('inc', platform.target)`：Electron 壳存在时跳过
`*_gui.exe` 的布局启动器，其余名字照旧走布局。重跑后实测：

```
node.exe        80,511,640 B   app.cjs           122,831 B
inc_gui.exe    188,784,128 B   inx_gui.exe    188,784,128 B   ← Electron 壳保留
inc_cli / inc_tui / inc_launcher / inx_cli / inx_tui / inx_launcher  各 49,152 B
```

IFM 不适用这条例外——它的 gui 是 C++ 窗口，不是 Electron。

### 打包体积对比

win64 安装包从 104,824,629 B 降到 40,881,185 B（省 63.9 MiB），因为 Electron 运行时
只有一份，六个名字不再各带一份 Node。

## IPM：源码只剩 bundle.js，布局照样能落地

InfinityPackageManager 是六个产品里唯一一个「没有源码树」的：
`InfinityPackageManager\tools\build-all.mjs` 开头就写着
`The source tree is gone; what survives is bundle.js`。
全仓 grep `detectRoot|MODE_PREFIX|INFINITY_EXE_NAME` 只命中三个文件——IFM 与 INC 的
`sourcecode\src\core\mode.js`，以及 `InfinityPackageManager\InfinityPackageManager\bundle.js`。
所以对 IPM 来说，**改 bundle.js 就是改源码**，而 `work\jslayout\build-layout.mjs` 里那句
`const bundleMaker = path.join(product.root, 'tools', 'bundle.mjs')` 对它根本不成立
（IPM 没有 `tools\bundle.mjs`）。

### 源码侧：两处最小改动

`bundle.js` 打了两处补丁（330,928 → 331,586 B，sha256:`b490f5b4d1ad…`）：

1. `detectRoot()`（原偏移 9026）——把启动器传来的名字折进路径，让紧随其后的
   `isNodeExe` 正则仍然成立：
   ```
   const exec = process.env.INFINITY_EXE_NAME
     ? path2.resolve(path2.dirname(process.execPath || "."), process.env.INFINITY_EXE_NAME)
     : process.execPath || "";
   ```
2. `detectMode()`（原偏移 326433）——同一个名字决定形态与是否管理员：
   ```
   const base = (process.env.INFINITY_EXE_NAME || path.basename(process.execPath))
     .replace(/\.exe$/i, "").toLowerCase();
   ```

两处都是「有环境变量就用、没有就与原来逐字相同」，所以未设 `INFINITY_EXE_NAME` 时
行为零变化。`parseArgs()` 不需要改：它在 `isNodeExe` 分支下本来就走
`process.argv.slice(2)`，布局模式行为正确。

改动的必要性有实测支撑。`detectRoot()` 算出来的 ROOT 是 `package.json` / `settings.json` /
`url.json` / `applist.json` / `aria2c.exe` / `lang/` 的根，也是 daemon 派生时 `IPM_ROOT` 的
取值。布局模式下 `process.execPath` 恒为 `node.exe`，原来的代码会命中
`return path2.resolve(__dirname, "..")`，ROOT 被算到 layout 的父目录。冒烟结果正是这个病：

| 场景 | `ipm version` 输出 |
| --- | --- |
| 布局下未设 `INFINITY_EXE_NAME`（基线） | `InfinityPackageManager  Infinity.Inc` **v0.0.0** |
| 布局下 `INFINITY_EXE_NAME=ipm_cli.exe` | `InfinityPackageManager  Infinity.Inc` **v1.0.0-pre5** |

`v0.0.0` 是 `getPkgVersion()` 读不到 `package.json` 时的兜底值，ROOT 算错就必然出现它。

### 构建侧：现成 bundle 入口

`build-layout.mjs` 新增 `PRODUCTS.ipm`：`prefixes: ['ipm','ipmx']`、
`modes: ['cli','tui','launcher']`，并加了一个新字段 `bundle` 指向现成的
`InfinityPackageManager\InfinityPackageManager\bundle.js`。`build()` 现在分两路：
有 `product.bundle` 就直接读文件，没有才去 `import` 产品的 `tools\bundle.mjs`。

```
node work\jslayout\build-layout.mjs ipm
  ipm: bundle 331556 B (shipped file ...\InfinityPackageManager\InfinityPackageManager\bundle.js)
    win-x64 8 files  81138138 B  (77.4 MiB)
  ipm win-x64: without the shared runtime 626498 B (612 KiB)
  BUILD-LAYOUT OK 1 product(s)
```

真实 49,152 B 启动器端到端（cwd = 布局目录）：`ipm_cli.exe version` 与
`ipmx_cli.exe version` 均 rc=0 输出 `InfinityPackageManager  Infinity.Inc  v1.0.0-pre5`；
`ipm_cli.exe help` 输出 `InfinityPackageManager (ipm) - 跨平台软件包管理器`。
（`ipm_tui.exe version` 会进交互式 REPL 而不是打印版本号——`version` 不是它的命令，
它打印出的标题条带正确版本号，恰好证明形态识别与 ROOT 都对了。）

### 打包侧：IPM 也走 layout 载荷

`InfinityPackageManager\tools\make-setup.mjs` 加了 `LAYOUT` 常量与 `hasLayout` 分支，
与 IFM/INC 同构：布局存在就拷 `node.exe` + `app.cjs`（它们不是具名 exe，按名字枚举的循环
永远不会想到拷），其余名字从 layout 取，取不到才回退 `build\out`。
IPM 的载荷文件（`applist.json`/`url.json`/`registry.json`/`settings.json`/`pak.json`/
`.ipm-versions.json`/`update.js`/`aria2c.exe`/`package.json`）与 `lang/` 照旧并入。

| 产品 | 平台 | 载荷 | stage | setup.exe |
| --- | --- | --- | --- | ---: |
| InfinityPackageManager | win64 | layout | 38 文件 / 490.5 MiB | 148,603,675 B |
| InfinityPackageManager | winx86 | out（回退） | — | 137,945,458 B |
| InfinityPackageManager | win-arm64 | out（回退） | — | 145,001,291 B |

stage/win64 的 490.5 MiB 里，377.6 MiB 是两个 Electron 壳（`ipm_gui.exe` 与
`ipmx_gui.exe` 各 188,784,128 B）——它们与 INC 同构，必须保留，和 IFM 的 C++ 窗口不是
一回事。命令行面（cli/tui/launcher × ipm/ipmx）六份各 49,152 B，`node.exe` 一份
80,511,640 B，`app.cjs` 331,586 B。

### IPM 体积实测

```
build/out/win-x64    :  6 files  485,833,728 B (463.3 MiB)
build/layout/win-x64 :  8 files   81,138,138 B ( 77.4 MiB)
saved                :         404,695,590 B (385.9 MiB)
```

七个平台的 `build\out` 合计 4,053,954,456 B（3.78 GiB），全部仍是 SEA 单文件；
`build\layout` 目前只产 win-x64 一份 77.4 MiB。setup 侧 win64.exe 由 148,577,948 B
变为 148,603,675 B（+25,727 B）——新增的是 `app.cjs` 与六个小启动器，而安装包里的
六个 80 MiB SEA 被换成了六份 49 KiB，压缩器对内容的取舍让净变化几乎持平；
真正的收益在**安装后的磁盘占用**：463.3 MiB → 77.4 MiB。

### 自测补强

`work\jslayout\verify-layout.mjs` 原来只验证探针程序。新增 `PRODUCT_LAYOUTS`
（ifm / inc / ipm），对**真实产出的布局**各查三项：只有一个 `node.exe`、带 `app.cjs`、
没有大于 5 MiB 的具名 exe。这样某个产品「构建过但从未验证」的情况会被直接抓住。
`LAYOUT-VERIFY` 从 25/25 变为 **34/34 PASS**。