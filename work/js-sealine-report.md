# js-sealine-report — task-30 版本串对齐报告（INC / IPM JS-SEA 载荷）

- 执行人：teammate `nsi-fix`；Lead：`lead`
- 工作区：`D:\dev\DeepSeekHarnessWorkspace\Infinity.inc`；日期：2026-10-06
- 关联：task-25（安装脚本）、task-26（发布冻结，只读实测发现本缺陷）、task-30（本任务）

## 0. 结论

| 产品 | 改前 | 改后 | 根因 |
|---|---|---|---|
| INC | `Infinity Cloud [v1.0pre2]` | `Infinity Cloud [v1.0pre5]` | 源码早已是 pre5，**SEA 二进制陈旧**（2026-10-02 构建），需重建 |
| IPM | `InfinityPackageManager  Infinity.Inc  v0.0.0` | `InfinityPackageManager  Infinity.Inc  v1.0.0-pre5` | **载荷缺 `package.json`**，运行时读不到就退回 `'0.0.0'` |
| IFM | `Infinity File Manager [v1.0pre5]  ·  Infinity.Inc` | 不变（基准） | 其 build/out 在 2026-10-06 01:30 已重建过 |

两个产品都已重新生成 stage 载荷并重新打包安装器；win64 载荷**实跑 CLI 验证通过**（只跑 `--version`，未开 GUI、未安装、未卸载、未结束进程）。

## 1. 版本串来源定位（文件:行）

### 1.1 INC —— 源码常量，打包进 SEA

| 文件:行 | 内容 | 是否权威 |
|---|---|---|
| `Infinity Cloud/sourcecode/src/main.js:26` | `const VERSION = 'v1.0pre5';` | 是（`--version` 输出它，第 39 行） |
| `Infinity Cloud/sourcecode/src/cli.js:97` | `this.print('Infinity Cloud [v1.0pre5]  ·  Infinity.Inc');` | 是（CLI banner） |
| `Infinity Cloud/sourcecode/src/installer.js:136` | `regWrite({ InstallDir, Version: 'v1.0pre5', ... })` | 是（自安装器写注册表） |
| `Infinity Cloud/sourcecode/src/gui/server.js:27` | `const VERSION = 'v1.0pre5';` | 是（Web GUI 页脚） |
| `Infinity Cloud/sourcecode/tools/build-all.mjs:97-118` | `makeBlob() → bundle.cjs → sea-prep.blob` | 版本就是被嵌进 blob 的这些常量 |
| `Infinity Cloud/sourcecode/tools/bundle.mjs` | 自写 ESM→CJS 打包器（12 modules） | 产物 `build/bundle.cjs` |

**为什么陈旧的**：`git show HEAD:.../src/main.js` 仍是 `const VERSION = 'v1.0pre2';`，工作区里这 4 处已被改成 pre5（未提交改动）；
而 `build/out/*/inc_cli.exe` 的时间戳是 **2026-10-02 19:40**，早于改版 —— 源码改了但 SEA 从未重建，二进制里仍嵌着旧源码文本（可直接在 exe 里搜到 `v1.0pre2` 字面量）。
所以 INC 侧**不需要改源码**，要做的是重建 + 重新打包。

### 1.2 IPM —— 运行时读 package.json，载荷里没有这个文件

| 文件:行 | 内容 |
|---|---|
| `InfinityPackageManager/InfinityPackageManager/bundle.js:8442` | `console.log(... "v" + versionLib.getPkgVersion())` —— banner 的版本串来自这里 |
| `InfinityPackageManager/InfinityPackageManager/bundle.js:783-790` | `getPkgVersion()`：读 `path.join(config.ROOT, "package.json")` 的 `.version`，异常时 `return '0.0.0'` |
| `InfinityPackageManager/InfinityPackageManager/bundle.js:292-304` | `detectRoot()`：非 node 运行时取 `path.dirname(process.execPath)` —— 即 **exe 所在目录** |
| `InfinityPackageManager/InfinityPackageManager/package.json` | `"version": "1.0.0-pre5"`（真实版本源） |
| `InfinityPackageManager/tools/make-setup.mjs:47-51` | 原 `PAYLOAD_FILES` **不含** `package.json` → stage 里没有它 |
| `InfinityPackageManager/tools/build-all.mjs:92-111` | `makeBlob()` 直接用 `InfinityPackageManager/bundle.js`（注释：源码树已丢失） |

**为什么是 v0.0.0**：`detectRoot()` 指向 exe 目录，stage/安装目录里没有 `package.json`，`readFileSync` 抛异常被 catch，于是返回字面量 `'0.0.0'`。这解释了它既不是 v1.0pre2 也不是 v0.0.1 的怪值。

### 1.3 IFM —— 对照基准

| 文件:行 | 内容 |
|---|---|
| `Infinity File Manager/sourcecode/src/main.js:34`、`src/gui/server.js:29` | `const VERSION = 'v1.0pre5';`（与 INC 同构） |
| `Infinity File Manager/sourcecode/build/out/win-x64/ifm_cli.exe` | 构建时间 **2026-10-06 01:30**，二进制里 `v1.0pre5` ×3、`v1.0pre2` ×0 |

于是同一个"源码常量打包进 SEA"的机制，IFM 因为重建过所以是对的，INC 因为没重建所以陈旧。

## 2. 改动内容

| 文件 | 改动 |
|---|---|
| `Infinity Cloud/sourcecode/**（源码）` | **未改**（4 处已经是 v1.0pre5）——只重建 |
| `InfinityPackageManager/tools/make-setup.mjs` | `PAYLOAD_FILES` 增加 `'package.json'`（含 6 行注释说明 getPkgVersion 的读法），其余不动 |
| `InfinityPackageManager/InfinityPackageManager/bundle.js` | **未改**（IPM 唯一现存的 JS 形态；改它会破坏与 package.json 的一致性） |
| `Infinity Cloud/sourcecode/tools/*` | **未改**（build-all.mjs 里硬编码的 `D:/temp/tools` 也没动，用目录联接解决，见 §3） |

## 3. 工具链：build-all.mjs 的硬编码路径与临时目录联接

`Infinity Cloud/sourcecode/tools/build-all.mjs` 与 IPM 的 build-all.mjs 都硬编码：

- `D:/temp/tools/node.exe`（生成 SEA blob）
- `D:/temp/tools/runtimes/<target>/.../node.exe`（postject 注入的 Node 运行时，7 个平台）

本机 `D:\temp\tools` **不存在**，但同一套工具链在仓库里：`<workspace>\temp\tools`（`node.exe` = v22.11.0，win-x64/win-ia32/win-arm64/linux/ darwin 五类运行时齐全）。
为了不改 build-all.mjs 就让它原样跑通，建了一个目录联接（junction，非拷贝）：

```powershell
cmd /c mklink /J "D:\temp\tools" "D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\temp\tools"
```

重建完成后已删除该联接（`cmd /c rmdir "D:\temp\tools"`，不带 /S，只删链接），`D:\temp\tools` 现不存在、仓库里的 `temp\tools` 原封不动。
另一处例外：`postject` 只有 `C:/Users/REDMI/AppData/Roaming/npm/node_modules/postject/dist/cli.js` 命中（脚本里两个候选路径的第一个），可用。

## 4. 命令与输出原文

### 4.1 改前（task-26 只读实测 + 本次复测）

```
> Infinity Cloud\sourcecode\build\setup-stage\win64\inc_cli.exe --version
Infinity Cloud [v1.0pre2]                                        EXIT=0

> InfinityPackageManager\build\setup-stage\win64\ipmx_cli.exe version
InfinityPackageManager  Infinity.Inc  v0.0.0                     EXIT=0

> Infinity File Manager\sourcecode\build\setup-stage\win64\ifm_cli.exe --version
Infinity File Manager [v1.0pre5]  ·  Infinity.Inc               EXIT=0
```

### 4.2 重建 INC SEA（7/7 目标）

```
> cd Infinity Cloud\sourcecode
> node tools\build-all.mjs
bundle  120557 B  (12 modules)
blob    122667 B
win-x64      80766464 B  x6     win-ia32     71985664 B  x6
win-arm64    72074240 B  x6     linux-x64   117574784 B  x6
linux-arm64 114953280 B  x6     darwin-x64  110529720 B  x6
darwin-arm64 106211276 B  x6
built 7 of 7                                                    EXIT=0
```

### 4.3 改后验证（只跑 CLI）

```
> Infinity Cloud\sourcecode\build\out\win-x64\inc_cli.exe --version
Infinity Cloud [v1.0pre5]                                        EXIT=0

> Infinity Cloud\sourcecode\build\setup-stage\{win64,winx86,win-arm64}\inc_cli.exe --version
win64     Infinity Cloud [v1.0pre5]                             EXIT=0
winx86    见 §6（运行时本身在本机起不来，与本次改动无关）
win-arm64 见 §6（ARM64 目标不能在 x64 主机执行）

> InfinityPackageManager\build\setup-stage\win64\ipmx_cli.exe version
InfinityPackageManager  Infinity.Inc  v1.0.0-pre5               EXIT=0
> InfinityPackageManager\build\setup-stage\win64\ipm_cli.exe version
InfinityPackageManager  Infinity.Inc  v1.0.0-pre5               EXIT=0
```

二进制字面量核对（直接搜 exe 字节）：

| 目标 | v1.0pre2 | v1.0pre5 |
|---|---|---|
| win-x64 / win-ia32 / win-arm64 / linux-x64 / linux-arm64 / darwin-x64 / darwin-arm64 | **0** | 4 |

（旧二进制是 `v1.0pre2` ×5；新源码里 5 处里有一处 TUI 标题改成拼接 `VERSION`，所以剩 4 个字符串常量 + 4 个源文件一一对应。）

### 4.4 重新打包安装器

```
> cd Infinity Cloud\sourcecode;         node tools\make-setup.mjs v1.0pre5
built 3 installers                                              EXIT=0
> cd InfinityPackageManager;           node tools\make-setup.mjs v1.0pre5
built 3 installers                                              EXIT=0
```

## 5. 产物字节与 sha256

### 5.1 INC stage 载荷（win64 可直接执行验证）

| 平台 | inc_cli.exe 字节 | sha256 |
|---|---|---|
| win64 | 80,766,464 | `432c65e9074fcd6496eb6afeb561fe5eede2e11b91f86a56f81250a54beef9a6` |
| winx86 | 71,985,664 | `2d01f90562938d156fd9280fb1d01cf97d29ac6fbcbb1bc056588c621a702c42` |
| win-arm64 | 72,074,240 | `c0c484bae286738e50866e64c6f52f923b1aa5bdb49303ad1cd391e68df84552` |

`inx_gui.exe` 未变（Electron 窗口，不在本任务范围）：win64 188,784,128 / `1925f358…`，winx86 159,897,088 / `e8edd3f4…`，win-arm64 175,995,904 / `85fe6b93…`。

### 5.2 INC 新安装包（`Infinity Cloud/sourcecode/build/setup`）

| 平台 | 字节（旧） | sha256 |
|---|---|---|
| win64.exe | 104,743,805（旧 104,768,101） | `4575d71ad033e96a669381448985bd6120b635a6f199ceb507996a9a409d312f` |
| winx86.exe | 98,278,405（旧 98,285,930） | `a32af17df6f87413a03436c528a7f89da29d606066079c1ab8b40054ab1f0fff` |
| win-arm64.exe | 95,987,219（旧 95,994,373） | `9bec107afbcfb005caf687325273312d72b07a3563de18a3b215aa3e2f6d456e` |

### 5.3 IPM

| 文件 | 字节 | sha256 |
|---|---|---|
| stage win64 package.json（新增） | 684 | `6c7fa4cea4be71e15c3603446e0ff986f7725f2cd490e10675d9ff63193765db` |
| stage win64 ipmx_cli.exe | 80,972,288 | `2dd7382fa0f9959d5f4024f38fdea18f030be02fc55b26b04c924fb7ead4af59` |
| setup win64.exe | 148,577,948（旧 148,577,606） | `372d70dfacd3dbbe86a743ff600c6ace2b5cd7f4a25b12d07a8e4ab20455a5d9` |
| setup winx86.exe | 137,945,458（旧 137,945,120） | `70e75a7e1638c79b83388fa7f5186280d694249be71ab5f71bb040fd45e1bf59` |
| setup win-arm64.exe | 145,001,291（旧 145,000,951） | `aed50d73612551d6a805185a59849039a259ba248a91d9a782a797be22e17f51` |

（三个安装包刚好各 +342 B = package.json 的 684 B 压缩后大小；IPM 的 exe 本身没重建，bundle.js 未改。）

### 5.4 生成脚本 sha256

| 脚本 | sha256 |
|---|---|
| INC setup-win64.nsi | `25fe91a0dc0aeb11127c0cbf241c04fbe093d751797ce34fc0113bccfbecab15` |
| INC setup-winx86.nsi | `3c10baffd30de2affea75b85de781c4e851447a0eb40c4994f4fc5850bc02ca7` |
| INC setup-win-arm64.nsi | `f19d857c7ad9364505015561137c91e565f1b7fea27f70707bd8572dcd700a32` |
| IPM setup-win64.nsi | `01923680ad4f16cfcfac6dd8c8c9623adcb8c52385c8b6a33a2161acb82a0e30` |
| IPM setup-winx86.nsi | `9848f1f0090dd7c180b00fd67a47a040a965c6f89f5d2083d2583ff721ff1085` |
| IPM setup-win-arm64.nsi | `e99925d04ae0e5fe90ebfffaa8cc1fc153459abe00307bc5917613b8171f2dbc` |

## 6. 可运行性证据与限制（未开 GUI）

| 目标 | 结果 | 原因 |
|---|---|---|
| win-x64 | ✅ `Infinity Cloud [v1.0pre5]`，EXIT=0 | 主机就是 x64 |
| win-ia32 | ⚠ 无法在本机启动：`FATAL ERROR: v8::ToLocalChecked Empty MaybeLocal`，EXIT=-1 | **与本次改动无关**：未注入的原始 `temp\tools\runtimes\win-ia32\node-v22.11.0-win-x86\node.exe` 在**同一台机器上同样报这个错**（EXIT=-1）；井水不犯河水地讲，任何由它注入出来的 exe 都会这样，旧的 2026-10-02 构建也一样 |
| win-arm64 | ⚠ 无法在本机执行：`指定的可执行文件不是此操作系统平台的有效应用程序` | PE machine = 0xAA64，x64 主机不能执行 ARM64（需要 Windows on ARM） |

因此"产物可运行"的实测只覆盖 win-x64；x86/arm64 的**版本字面量**已用字节比对证明改成了 v1.0pre5，但无法在本机执行验证。这不算回归：这两个平台的失败模式在我动手之前就存在（运行时二进制自身的问题 / 架构限制）。

## 7. 需要 Lead 决策：版本"字形"不统一

| 产品 | 显示 | 来源 |
|---|---|---|
| INC / IFM | `v1.0pre5` | 源码常量（产品自己写的展示串） |
| IPM | `v1.0.0-pre5` | `package.json` 的 semver，发布标签本来就是 v1.0.0-pre5 |

IPM 现在**与自己的 package.json 完全一致**（task-30 的最低要求），但它不会打印成 `v1.0pre5`。
若要三个产品字形完全统一，只能改 `InfinityPackageManager/InfinityPackageManager/bundle.js:8442` 的显示逻辑（那是 IPM 唯一现存的 JS；源码树已丢失），代价是显示串与 package.json 脱钩。我没有擅自做这个改动，等 Lead 指示。

## 8. 回归校验（全部退出码 0）

| 检查 | 结果 | 退出码 |
|---|---|---|
| INC 模板 `node tools\nsi-check.mjs --strict` | OK: 0 error, 0 warning | 0 |
| `node tools\nsi-check.test.mjs` | 25 pass, 0 fail | 0 |
| INC 实例 ×3（win64/winx86/win-arm64） | 各 OK: 0 error, 0 warning | 0 |
| IFM 实例 ×3 | 各 OK: 0 error, 0 warning | 0 |
| IPM 实例 ×3 | 各 OK: 0 error, 0 warning | 0 |

## 9. 发布物影响（task-26）

需要刷新哈希的发布物（我没有碰 `cpp/release` 与 `docs`）：

- INC：`build/setup/win64.exe`、`winx86.exe`、`win-arm64.exe`（§5.2）
- IPM：`build/setup/win64.exe`、`winx86.exe`、`win-arm64.exe`（§5.3）
- 清单/正文：`installers/packaging/v1.0pre5/SHA256SUMS.txt`、`installers/packaging/v1.0pre5/release-assets.json`、`cpp/release/v1.0pre5/release-assets.json`、`docs/RELEASE-v1.0pre5*.md`
- IFM 与 IIM/INT/ING：**本次未受影响**（IFM 我已复测，其 stage 与安装包哈希和 task-25 一致；IIM/INT/ING 无 JS stage）。

## 10. 禁令遵守与遗留

- 只编译/打包 + 只跑 CLI `--version`/`version`：**未安装、未卸载、未打开 GUI 窗口、未结束任何进程、未往 `D:\program\**` 拷任何东西**。
- 只读执行过一次 IPM 应用目录里的 `ipm.exe version`（诊断用，该命令只读），但它读到了用户真实数据目录 `%USERPROFILE%\.ipm`；未写入、未修改。
- 遗留 1：`temp\tools\runtimes\win-ia32` 的 Node v22.11.0 win-x86 在本机无法启动（原始运行时即如此），ipm/inc 的 32 位产物因此无法在本机实跑验证。
- 遗留 2：win-arm64 需要 ARM64 Windows 才能实跑。
- 遗留 3：IPM 显示 `v1.0.0-pre5` / INC-IFM 显示 `v1.0pre5` 的字形差异（§7），等 Lead 决策。
- 遗留 4：IPM 的 JS 源码树已丢失，bundle.js 是唯一形态；任何 JS 侧修复都要直接改 bundle.js。
- 遗留 5：`build-all.mjs` 硬编码 `D:/temp/tools`，与仓库内 `temp/tools` 不一致；本次用临时 junction 绕过，未改脚本。

## 11. 复现命令

```powershell
$node = "D:\program\nodejs\node.exe"
cmd /c mklink /J "D:\temp\tools" "D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\temp\tools"
cd "...\Infinity Cloud\sourcecode";      & $node tools\build-all.mjs
& "...\Infinity Cloud\sourcecode\build\out\win-x64\inc_cli.exe" --version   # Infinity Cloud [v1.0pre5]
& $node tools\make-setup.mjs v1.0pre5
cd "...\InfinityPackageManager";          & $node tools\make-setup.mjs v1.0pre5   # PAYLOAD_FILES 含 package.json
& "...\InfinityPackageManager\build\setup-stage\win64\ipmx_cli.exe" version  # v1.0.0-pre5
cmd /c rmdir "D:\temp\tools"
```

---

## 12. task-33 —— 字形统一到发布标签 `v1.0.0-pre5`（2026-10-06 改码/重建，2026-10-11 补完 INC 重打包）

### 12.0 决策与口径

Lead 决定：以发布标签 `v1.0.0-pre5` 为**唯一口径**。INC/IFM 的版本是"源码常量注入 SEA"，改源码之后依旧满足"显示 = 源码真值"；
IPM 继续读自己的 `package.json`（其值本来就是 1.0.0-pre5），因此 IPM 不动。

### 12.1 源码改动（7 处，全部是显示常量，无运行时拼接）

**INC**（`Infinity Cloud/sourcecode/`）

| 文件:行 | 改前 | 改后 |
|---|---|---|
| `src/main.js:26` | `const VERSION = 'v1.0pre5';` | `const VERSION = 'v1.0.0-pre5';` |
| `src/cli.js:97` | `this.print('Infinity Cloud [v1.0pre5]  ·  Infinity.Inc');` | `this.print('Infinity Cloud [v1.0.0-pre5]  ·  Infinity.Inc');` |
| `src/installer.js:136` | `regWrite({ InstallDir, Version: 'v1.0pre5', Hashes })` | `regWrite({ InstallDir, Version: 'v1.0.0-pre5', Hashes })` |
| `src/gui/server.js:27` | `const VERSION = 'v1.0pre5';` | `const VERSION = 'v1.0.0-pre5';` |

**IFM**（`Infinity File Manager/sourcecode/`，与 INC 同构；它没有 hardcode 的 banner 常量，banner 由 `main.js:42` 用 VERSION 拼）

| 文件:行 | 改前 | 改后 |
|---|---|---|
| `src/main.js:34` | `const VERSION = 'v1.0pre5';` | `const VERSION = 'v1.0.0-pre5';` |
| `src/installer.js:136` | `regWrite({ InstallDir, Version: 'v1.0pre5', Hashes })` | `regWrite({ InstallDir, Version: 'v1.0.0-pre5', Hashes })` |
| `src/gui/server.js:29` | `const VERSION = 'v1.0pre5';` | `const VERSION = 'v1.0.0-pre5';` |

改后两棵源码树里 `v1.0pre5` 出现次数均为 **0**（`grep -c` 于 `src/`）。

### 12.2 重建（各自 tools/build-all.mjs，7/7 目标）

```
> cd "Infinity Cloud/sourcecode";        node tools\build-all.mjs
bundle 120569 B (12 modules) / blob 122679 B / built 7 of 7        EXIT=0
> cd "Infinity File Manager/sourcecode"; node tools\build-all.mjs
bundle 142894 B (12 modules) / blob 145074 B / built 7 of 7        EXIT=0
```

（工具链照旧用临时目录联接 `D:\temp\tools` → `<workspace>\temp\tools`，用完 `rmdir`；`build-all.mjs` 未改。）

### 12.3 只跑 CLI 的验证（命令 / 原文 / 退出码）

```
> Infinity Cloud\sourcecode\build\setup-stage\win64\inc_cli.exe --version
Infinity Cloud [v1.0.0-pre5]                                      EXIT=0

> Infinity File Manager\sourcecode\build\setup-stage\win64\ifmx_cli.exe --version
Infinity File Manager [v1.0.0-pre5]  ·  Infinity.Inc             EXIT=0

> Infinity File Manager\sourcecode\build\setup-stage\win64\ifm_cli.exe --version
Infinity File Manager [v1.0.0-pre5]  ·  Infinity.Inc             EXIT=0
```

### 12.4 字节比对：旧字面量为 0（每个平台都查）

| 产物 | 平台 | 字节 | `v1.0pre5` | `v1.0.0-pre5` |
|---|---|---|---|---|
| INC build/out + stage | win-x64 / win-ia32 / win-arm64 | 80,766,464 / 71,985,664 / 72,074,240 | **0 / 0 / 0** | 4 / 4 / 4 |
| INC build/out | linux-x64 / linux-arm64 / darwin-x64 / darwin-arm64 | — | **0** | 4 |
| IFM build/out + stage | win-x64 / win-ia32 / win-arm64 | 80,788,480 / 72,007,680 / 72,096,256 | **0 / 0 / 0** | 3 / 3 / 3 |
| IFM build/out | linux-x64 / linux-arm64 / darwin-x64 / darwin-arm64 | — | **0** | 3 |

### 12.5 产物字节 / sha256

**INC stage（`build/setup-stage`）**

| 平台 | inc_cli.exe | sha256 |
|---|---|---|
| win64 | 80,766,464 | `45ed558dc7c93e03553e93dc61b5c968f6c3470eabdaba2e2af93650a02f147d` |
| winx86 | 71,985,664 | `100765e6947ced68c4f4422dd9c3f43612c6ed039484b177019015cad5855279` |
| win-arm64 | 72,074,240 | `b65a7c44bc0662c3d4ef1e32534ee1d02c94173af49d236ebc470df00b987c4e` |

**INC 安装包（`build/setup`）**

| 平台 | 字节 | sha256 |
|---|---|---|
| win64.exe | 104,768,594 | `3ae36cb94471f016fb09c5a71155930c5d96fd82cb92c7560e7e8e28f1503f3a` |
| winx86.exe | 98,261,560 | `177bd7c042476723ecdb58b8e4f56a2018e15d4b8c1d0698faf8d3141853d492` |
| win-arm64.exe | 95,983,727 | `2b37a7fc645f0843f5e56faa57e782e1f5c4976aa73110a87d1594be7e4a580a` |

**IFM stage（`build/setup-stage`，`ifmx_cli.exe` 与 `ifm_gui.exe` 同字节）**

| 平台 | 字节 | sha256 |
|---|---|---|
| win64 | 80,788,480 | `9d2a8b8f62b3d55fcd786f99460a0c8ca2a5a71d02ec3dcd20f777d89d6ed7b8` |
| winx86 | 72,007,680 | `09d6f196fd1db9f2a23b5e7c86aa3d0b26728969bb96ac6498d4e29ea4a6814f` |
| win-arm64 | 72,096,256 | `eda8b0ec766c564d08f9b2eee24b8ed704fda421a4288f984e9f0b3f38d03853` |

**IFM 安装包（`build/setup`）**

| 平台 | 字节（task-25 时） | sha256 |
|---|---|---|
| win64.exe | 21,162,900（旧 22,494,216） | `0dbe8299ce796f9ff1ee6954204f810fedf94a92dc1e68183ee622eb38d83e5a` |
| winx86.exe | 19,403,904（旧 98,257,036） | `1b8666a8729596071dd15a752f540a098a58af9398ed6f46b59a5af3abae6275` |
| win-arm64.exe | 17,436,517（旧 95,987,212） | `9b406fcd99866f6b8762f354002574319e161178e8d14c59acfb8402d6b0a8c8` |

### 12.6 回归（全部退出码 0）

| 检查 | 结果 | 退出码 |
|---|---|---|
| INC 模板 `node tools\nsi-check.mjs --strict` | OK: 0 error, 0 warning | 0 |
| `node tools\nsi-check.test.mjs` | 25 pass, 0 fail | 0 |
| INC 实例 ×3 | 各 OK: 0 error, 0 warning | 0 |
| IFM 实例 ×3 | 各 OK: 0 error, 0 warning | 0 |
| IPM 实例 ×3 | 各 OK: 0 error, 0 warning | 0 |

### 12.7 范围澄清（重要）

`sourcecode/build/setup/*.exe` 与 `sourcecode/build/setup-stage/**` 属于 **JS/SEA 线**，不是发布物；
发布包由 `cpp/apps → build.mjs → cpp/out → package.mjs → makensis` 生成。
本任务**没有也不需要**刷新 `cpp/release`、`installers/packaging`、`docs` 的任何哈希，也一个字都没改。§9 里"需刷新的发布物"一节仅适用于那条 C++ 线，与本节无关。

### 12.8 副作用（需要 Lead 确认，非本任务缺陷）

IFM 的 `tools/build-all.mjs` 的 `MODES` 含 `'gui'`（此前别的任务改的），本次按指名重建 7/7 之后，**三个平台都产出了 SEA 窗口 `ifm_gui.exe/ifmx_gui.exe`**；
而 IFM 的 `make-setup.mjs` 在"载荷已有两个 gui"时不再调 Electron `stageGui()`，于是：

- IFM win64：窗口本来就是 SEA（不变），安装包 22.5 MB → 21.2 MB；
- IFM winx86 / win-arm64：窗口**从 Electron（159,897,088 / 175,995,904 B）换成 SEA（72,007,680 / 72,096,256 B）**，安装包 98.3 MB → 19.4 MB、96.0 MB → 17.4 MB。

后果是三个平台的窗口来源**变一致了**（都是 SEA 的 loopback 窗口），但 x86/arm64 的窗口实现与 task-25 交付时不同。
如果这不是预期（例如打算 x86/arm64 继续用 Electron），只要把 IFM `MODES` 里的 `'gui'` 去掉再重跑即可；我按 Lead 已批准的"载荷已有两个 gui 就不调 stageGui"规则执行，未改 `MODES`。

### 12.9 过程说明与遗留

- INC 的第一次重打包（2026-10-06 21:0x）在会话运维事故中被中断（job killed），当时只有 win64/winx86 安装包是新产物、win-arm64 仍是 task-30 的旧包；2026-10-11 10:3x-10:4x 已**全量重跑** `make-setup.mjs v1.0pre5`（exit 0，3 个安装包），本节的 INC 数字全部来自这次完整重跑。
- 遗留同 §6：win-ia32 的原始 Node v22.11.0 win-x86 运行时在本机无法启动（V8 FATAL ERROR），win-arm64 不能在 x64 主机执行；因此"可运行"实测只覆盖 win-x64，x86/arm64 依赖字节比对证明字面量已改对。
- IPM 未改动（继续读 `package.json` → `v1.0.0-pre5`），六产品口径现已统一为 `1.0.0-pre5`。
