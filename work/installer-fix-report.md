# installer-fix-report — task-25 安装脚本缺陷修复报告

- 执行人：teammate `nsi-fix`（Team Lead `lead`）
- 工作区：`D:\dev\DeepSeekHarnessWorkspace\Infinity.inc`
- 日期：2026-10-06
- 关联：task-19（nsi-check 重写）、task-25（本任务）、task-26（release-prep 重新冻结发布物）

## 0. 一句话结论

缺陷 1 不是"全线"：stage 里真正对不上文件的只有 INC 一家（管理员窗口写成 `inx_gui.exe` 而载荷里是 `incx_gui.exe`）。
按证据，脚本名（`inx_gui`）才是权威侧，错的是 shell 打包侧；已按 Lead 批准的**方案 B** 只改 `shell/payload.mjs` 的命名表；
IFM 的 `make-setup.mjs` 另有"C++ gui 与 Electron gui 抢同一个文件名"的阻塞，已按批准的**方案 (i)** 修好。
三个产品（INC/IFM/IPM）的安装包全部重建成功，严格校验 0 error、退出码 0，自测 25/25。
**未做任何 live 安装/卸载**，原因见第 8 节。

## 1. 缺陷与处置总表

| # | 缺陷 | 权威侧判定 | 处置 | 状态 |
|---|---|---|---|---|
| 1 | INC 安装器把管理员窗口写成 `$INSTDIR\inx_gui.exe`，载荷里只有 `incx_gui.exe` | 脚本名权威（见 2.1） | 方案 B：改 `shell/payload.mjs` 引入 `ADMIN_PREFIX` 命名表；INC 安装器保持 `inx_gui.exe` | 已修 |
| 1b | IFM `make-setup.mjs` 与 C++ gui 抢名，直接 exit 1 | C++ gui 优先，Electron 兜底 | 方案 (i)：载荷已有 `ifm_gui.exe`+ifmx_gui.exe` 就不调 `stageGui()`；缺名字时跳过、由 Electron 补 | 已修 |
| 2 | 桌面快捷方式创建用 `${PRODUCT_NAME}.lnk`、删除用 `$LABEL_THIS.lnk`，共存模式留下死链接（INC、IFM） | 卸载段 | 创建改为 `$DESKTOP\$LABEL_THIS.lnk`，与删除严格配对；IPM 本来就配对 | 已修 |
| 3 | 插件环境变量指向不存在的文件（INC 4 个 / IFM 4 个 / IPM 4 个） | 真实产物 | INC、IFM 删除写+删各 4 条；IPM 的 `ipmaria` 改指真实存在的 `$INSTDIR\aria2c.exe`，另 3 条删除 | 已修 |
| 4 | `build/setup-stage/setup-*.nsi` 是 10-02 陈旧产物、缺 MUI_ICON 定义 | 模板 | 全部产品以 `v1.0pre5` 重跑 `make-setup.mjs`，重新生成并重新编译 | 已修 |
| 5 | makensis 编译日志写控制台、抓不到（task-19 遗留） | — | 检查器改用退出码 + 合成载荷编译作为判据，未解决日志不可捕获本身 | 遗留 |

## 2. 证据

### 2.1 管理员孪生命名：为什么 `inx_gui` 才是权威名

| 证据 | 位置 | 内容 |
|---|---|---|
| 唯一显式命名表 | `cpp/tools/package.mjs:38` | `{ dir: 'inc', prefix: 'inc', admin: 'inx', ... }`；第 69 行 `app.admin + '_' + mode + '.exe'` |
| Electron 外壳自己的解析器 | `shell/main.js:16,55-60` | 注释写 `inc_gui.exe inx_gui.exe`；正则 `^(inc|inx|...)_gui$` 只认 `inx`，并明写 "inc 的 administrator twin is inx, not incx" |
| 产品自己的模式表 | `Infinity Cloud/sourcecode/src/core/mode.js` | `PREFIX = { inc, inx }`（没有 `incx`） |
| C++ 安装管线产物 | `cpp/build/installer-stage/inc/setup.nsi:29` | `File "inx_gui.exe"` |
| C++ 头注释 | `cpp/core/include/inc/mode.hpp:7` | `inx_cli inx_gui inx_launcher` |
| **唯一两处例外** | `shell/build.mjs:149` | `t.prefix + 'x_gui'` → inc 得到 `incx_gui`（ifm/ipm/iim/int/ing 恰好正确） |
| | `shell/payload.mjs:69`（原） | `prefix + 'x_gui.exe'`，是**真正产出错名的地方** |

### 2.2 管理员孪生名：改动前后对照（六产品）

表由 `shell/payload.mjs` 导出的 `adminGuiName(prefix)` 直接调用得到，"改动前"为原公式 `prefix + "x_gui.exe"`：

| 产品 | 改动前 | 改动后 | 是否变化 |
|---|---|---|---|
| inc | incx_gui.exe | **inx_gui.exe** | **变化** |
| ifm | ifmx_gui.exe | ifmx_gui.exe | 同 |
| ipm | ipmx_gui.exe | ipmx_gui.exe | 同 |
| iim | iimx_gui.exe | iimx_gui.exe | 同 |
| int | intx_gui.exe | intx_gui.exe | 同 |
| ing | ingx_gui.exe | ingx_gui.exe | 同 |

命名表：`ADMIN_PREFIX = { inc:'inx', ifm:'ifmx', ipm:'ipmx', iim:'iimx', int:'intx', ing:'ingx' }`，
公式等价性：除 inc 外 `ADMIN_PREFIX[p] === p + "x"`，因此对其余五个产品**逐字节等价**（返回的文件名完全一样）。
活证据：IPM 在改动后重跑 `make-setup`，载荷里仍是 `ipmx_gui.exe`（名字未变）。

### 2.3 INC 载荷里两个窗口文件真实存在（字节 + sha256）

| 平台 | inc_gui.exe | inx_gui.exe |
|---|---|---|
| win64 | 188,784,128 B / `1925f358e7f0e9675a5ac4198fb076613f0db318da56d388799a97be74a5b19c` | 188,784,128 B / `1925f358...a5b19c`（与 inc_gui 同字节） |
| winx86 | 159,897,088 B / `e8edd3f41ef6ebf968cb17e5ca30d267e84386c922582d52b05c6491bc39d2f1` | 159,897,088 B / `e8edd3f4...9d2f1`（同字节） |
| win-arm64 | 175,995,904 B / `85fe6b93274854ccabd1e833c79bdbbba030db888915d1430f3cbbfe65f4daf4` | 175,995,904 B / `85fe6b93...4daf4`（同字节） |

三个平台各 8 个 exe（inc/inx × cli/tui/gui/launcher），`inx_gui.exe` 不再缺失。

### 2.4 IFM 载荷里两个窗口文件真实存在（字节 + sha256）

| 平台 | ifm_gui.exe | ifmx_gui.exe | 来源 |
|---|---|---|---|
| win64 | 87,346,176 B / `876b3d212e8e737f6bc93025ed2ed82649f94a2caaab873d463505560a2b9599` | 87,346,176 B / `876b3d21...2b9599` | C++ `build/out/win-x64`（**同字节**，2.5） |
| winx86 | 159,897,088 B / `e8edd3f4...9d2f1` | 159,897,088 B / `e8edd3f4...9d2f1` | Electron 兜底 |
| win-arm64 | 175,995,904 B / `85fe6b93...4daf4` | 175,995,904 B / `85fe6b93...4daf4` | Electron 兜底 |

未因跳过 `stageGui()` 缺文件：三平台 pl 目录都同时有 `ifm_gui.exe` 与 `ifmx_gui.exe`。

### 2.5 IFM gui 与 C++ 构建产物字节等价（抽查 win64）

| 文件 | 字节 | sha256 |
|---|---|---|
| `build/out/win-x64/ifm_gui.exe`（C++ 源） | 87,346,176 | `876b3d212e8e737f6bc93025ed2ed82649f94a2caaab873d463505560a2b9599` |
| `build/setup-stage/win64/ifm_gui.exe`（载荷） | 87,346,176 | `876b3d21...2b9599`（相同） |
| `build/out/win-x64/ifmx_gui.exe`（C++ 源） | 87,346,176 | `876b3d21...2b9599` |
| `build/setup-stage/win64/ifmx_gui.exe`（载荷） | 87,346,176 | `876b3d21...2b9599`（相同） |

winx86 / win-arm64 没有 C++ 侧产物（`build/out/win-ia32|win-arm64` 只有 6 个 cli/tui/launcher 名字），所以那两平台按设计走 Electron 兜底，无法与 C++ 产物对比。

### 2.6 快捷方式创建/删除配对（改后）

| 产品 | 创建 | 卸载删除 | 配对 |
|---|---|---|---|
| INC | `$SMPROGRAMS\$LABEL_THIS\$LABEL_THIS.lnk` / `卸载.lnk` / `$DESKTOP\$LABEL_THIS.lnk` | 同名 Delete + `RMDir` | 是 |
| IFM | 同上（`installer.nsi:379/380/386`） | `:499/500/502` | 是 |
| IPM | `$SMPROGRAMS\${PRODUCT_NAME}\...` / `$DESKTOP\${PRODUCT_NAME}.lnk` | `:303/304/306` 同名 | 是（本来配对） |

### 2.7 插件环境变量处置（缺陷 3）

全仓产物检查结果：`FastGithub.UI.exe`、`Arc.exe`、`7za.exe`（仅 `temp/tools/`，构建工具）、`fgit.exe`、`maria.exe`、`freearc.exe`、`7z.exe` 全部为 0 个；
`aria2c.exe` 真实存在：`dist/aria2c.exe`、`InfinityPackageManager/InfinityPackageManager/aria2c.exe`、IPM 三个平台载荷根目录。

| 产品 | 处置 |
|---|---|
| INC | 删除 `incfgit/incaria/incfreearc/inc7z` 四条写 + 四条卸载删除，留注释说明 |
| IFM | 删除 `ifmfgit/ifmaria/ifmfreearc/ifm7z` 四条写 + 四条卸载删除 |
| IPM | `ipmaria` 改写为 `$INSTDIR\aria2c.exe`（真实文件，make-setup 的 PAYLOAD_FILES 之一）；删除 `ipmfgit/ipmfreearc/ipm7z` 三条写 + 对应删除 |

## 3. 陈旧 setup 重建（缺陷 4）

全部以 `v1.0pre5` 重跑，日志在 `D:\temp\{inc,ifm,ipm}-make-setup*.log`（编码 UTF-16LE）。
生成的 `setup-*.nsi` 满足编码契约：UTF-8 BOM、无残留占位符，且不再比 `installer.nsi` 旧。

### 3.1 新安装包 size + sha256（产品本地 `build/setup`）

**INC**（`Infinity Cloud/sourcecode/build/setup`）

| 平台 | 字节 | sha256 |
|---|---|---|
| win64.exe | 104,768,101 | `ec522446229a9e24711b45e51836fcd397c0e6ca93d3430e9b44ec9eb3b12c1f` |
| winx86.exe | 98,285,930 | `23dc145fa8f9fb0a43e609592859c6690fd271e528ffeb59b479789f61537821` |
| win-arm64.exe | 95,994,373 | `5a3c91a0fbb9d26406ee5310ac902ca6222a79c3429ca42cc20f487cf7d7b6c5` |

**IFM**（`Infinity File Manager/sourcecode/build/setup`）

| 平台 | 字节 | sha256 |
|---|---|---|
| win64.exe | 22,494,216 | `b34deb2dc7a20ffddf2001474fbfb44a17a84ea4a72d559d27b0ef0174163492` |
| winx86.exe | 98,257,036 | `77e9b82dde454e53f51a4ed6ac2facc4e96605206f50e58ea756c5b1b9142e2a` |
| win-arm64.exe | 95,987,212 | `4dc67467fe2e25764cc84447da18794d720cb1090451061f6c4cd234c1f51fd1` |

IFM win64 从约 105 MB 降到 22 MB：win64 窗口改用 C++ 的 87 MB 原生 gui（lzma 后小），x86/arm64 仍是 Electron 目录（约 96-98 MB）。

**IPM**（`InfinityPackageManager/build/setup`）

| 平台 | 字节 | sha256 |
|---|---|---|
| win64.exe | 148,577,606 | `ef38f9f5310454d705506b0b40b81fcc5567766e4c432222cc501f71810790c2` |
| winx86.exe | 137,945,120 | `f96db2f58662ba654f2a3929173c0005b24828f5e22019a5a5a78d15aff61760` |
| win-arm64.exe | 145,000,951 | `462e35d1f18cd6246663cdc95d8709001f55afe25ca8f969499d0c6c8e8294fd` |

## 4. 严格校验结果（命令 + 退出码）

检查器 `nsi-check.mjs` 在 task-25 里新增了 **instance 模式**（`--instance`，对 `build/setup-stage/setup-*.nsi` 自动启用）：
跳过"必须含四个占位符"的模板断言，改为核对实例自身 BOM、结构、快捷方式配对、环境变量配对、以及每个 `$INSTDIR\...` 引用在实例指向的真实载荷里存在；
对老家族（无 `$LABEL_THIS`，如 IPM 的 `nsis.nsi`）自动跳过共存家族专有断言，并在 INFO 里明示跳过了什么。
模板模式（INC 的发布门禁）行为完全未变。

| 命令 | 结果 | 退出码 |
|---|---|---|
| `cd "Infinity Cloud\sourcecode"; node tools\nsi-check.mjs --strict` | OK: 0 error, 0 warning | **0** |
| `node tools\nsi-check.test.mjs` | 25 pass, 0 fail | **0** |
| IFM `--instance --strict --root "Infinity File Manager" --template ...setup-win64.nsi` | OK: 0 error, 0 warning | **0** |
| IFM winx86 同上 | OK: 0 error, 0 warning | **0** |
| IFM win-arm64 同上 | OK: 0 error, 0 warning | **0** |
| IPM `--instance --strict --root InfinityPackageManager --template ...setup-win64.nsi` | OK: 0 error, 0 warning | **0** |

生成的实例脚本 sha256：IFM `win64 3ea8162195b89c947e984bc1eee3a7a4e86f881d91f921e16bd3bf331f94d2fd`、
`winx86 8e6c94629994b5ee5de380393525ecbdf0c3d8286943b6b1d1fa84151660cadb`、`win-arm64 6a97805048645d66679039b589062fe8266e6fc16f7c3258cca4bb4671f3ec4c`；
IPM `win64 01923680ad4f16cfcfac6dd8c8c9623adcb8c52385c8b6a33a2161acb82a0e30`。

说明：IFM/IPM 的 `sourcecode/tools`（IPM 是 `tools`）下没有 `nsi-check.mjs`，检查器只有 INC 一份；
所以上面用的是 INC 的检查器加 `--root/--template` 指向另外两个产品，而不是在各自目录里跑同名脚本。

## 5. 本次改动的文件与 sha256

| 文件 | 改动 | 改后 sha256 |
|---|---|---|
| `shell/payload.mjs` | 新增 `ADMIN_PREFIX` 表 + `adminGuiName()`；`stageGui` 用它生成管理员孪生（原 69/73 行） | `931ed09f66cf99c9c1a806bdd6f05eb83b547e225156171d26d5430990632fb9` |
| `Infinity Cloud/installer.nsi` | 桌面快捷方式改 `$LABEL_THIS`；`inxgui` 指向 `$INSTDIR\inx_gui.exe`；删 4 条插件写 + 4 条删 | `d676234ec58b37f15f0b859531f965e7c6a4614129149f9683914d0adb1eea5e` |
| `Infinity File Manager/installer.nsi` | 桌面快捷方式改 `$LABEL_THIS`；删 4 条插件写 + 4 条删 | `fc1260ea63b83c07ed86235a708582ade5a3bb76bf6f7a578b60238706f2f5bf` |
| `InfinityPackageManager/nsis.nsi` | `ipmaria` 改指 `$INSTDIR\aria2c.exe`；删 3 条插件写 + 3 条删 | `445900fe80184aa84bde5f0c4326a9e0552b4787b4fe03319cba6a91e472487e` |
| `Infinity File Manager/sourcecode/tools/make-setup.mjs` | 方案 (i)：gui 源缺失时跳过（C++ 只有 win-x64）；载荷已有两个 gui 时不调 `stageGui()`，否则 Electron 兜底 | `7642b625e0b8e4652b312c60e52d90ec29b5c5bf37a9ceda7a5d77ffe35f9d43` |
| `Infinity Cloud/sourcecode/tools/nsi-check.mjs` | 新增 instance 模式、家族判定、实例 BOM 检查 | `7697c985d0e9ed6583cae601752a9109f37521b0d609e71060d0e07926b98549` |
| `Infinity Cloud/sourcecode/tools/nsi-check.test.mjs` | 21 → 25 用例（strict 用例重写 + 3 个 instance 用例） | `552ba570d97f03d7ad60ae364499526a686daf54234be6441b8822153b1f1295` |

注意：`Infinity File Manager/sourcecode/tools/make-setup.mjs` 的 git diff 里还有一行 `v1.0pre2 → v1.0pre5`（默认版本号），**不是本次改动**，是并发编辑；
我们一律显式传 `v1.0pre5` 参数，不受该默认值影响。同理 `build-all.mjs` 的 `MODES` 加 `gui` 也不是本次改动。

## 6. 发布物影响（交给 task-26 / release-prep）

本次重建产出的是**产品本地**安装包（第 3.1 节）；仓库级的冻结清单不是我改的范围：

| 需刷新的发布物 | 位置 | 说明 |
|---|---|---|
| `installers/packaging/v1.0pre5/SHA256SUMS.txt` | 9-14 行 6 个 `*_setup.exe` 的哈希 | 若发布包重新打包，需整体刷新 |
| `cpp/release/v1.0pre5/release-assets.json` | `size/sha256/fnv1a` | 同上 |
| `installers/packaging/v1.0pre5/release-assets.json` | 同上 | 同上 |
| `docs/RELEASE-v1.0pre5.md` / `docs/RELEASE-v1.0pre5-body.md` | 正文里的哈希/大小 | 同上 |

另外两个产品线不受影响，无需重建：

- **IIM / INT / ING**：走 C++ 管线（`cpp/tools/package.mjs`），管理员名本来就是 `iimx/intx/ingx`；既不读 `shell/payload.mjs`，也没有改过它们的 installer，产物不受本次改动影响。
- **IPM** 虽然重建了，但改名表对它是恒等映射（`ipmx_gui` 不变），只有插件环境变量与快捷方式配对变了。

## 7. 遗留与风险

1. `shell/build.mjs:149` 仍会生成 `incx_gui-win32-*` 目录（Lead 明示保留）。这些目录现在无人引用（`stageGui` 从 `inc_gui-win32-*` 复制并改名），可留可删；若要删，属于 `shell/build.mjs` 的后续任务。
2. IFM 三平台的窗口来源不同：win64 用 C++ 原生 gui，winx86/win-arm64 用 Electron 目录，因此 win64 安装包明显更小（22 MB vs 96 MB）。这是"C++ gui 优先 + 缺则 Electron 兜底"的直接结果；要三平台一致，需要 C++ 侧补齐 win-ia32/win-arm64 的 gui 构建。
3. IFM 的快捷方式没有图标参数、也没有用 `ifm.ico` 作 MUI_ICON（检查器以 INFO 报告，不计入 strict）。这是样式问题，不在 task-25 的四个缺陷内；是否修由 Lead 决定。
4. INC 的环境变量名仍是 `inxgui`（值指向 `inx_gui.exe`），与既有契约一致，未改名。
5. makensis 的编译日志在本机写控制台、无法通过管道捕获（task-19 遗留）；检查器只能用退出码加合成载荷编译判定语法/宏/图标。
6. IFM/IPM 没有自己的 `nsi-check.mjs`，跨产品校验依赖 INC 的检查器加 `--instance`；老家族（IPM）的 `${UNINST_KEY}` 等价断言尚未实现，目前显式跳过。

## 8. 未做 live 安装/卸载（及原因）

按 Lead 的最高优先级硬禁令，本次**没有运行任何安装包（setup-*.exe）、没有运行任何卸载程序或 msiexec /x、没有删除任何用户已安装目录/快捷方式、没有结束任何进程**。

原计划中的"安装后实测快捷方式目标存在 / 环境变量指向存在文件 / 卸载无残留"无法在不违反禁令的前提下完成，原因是技术性的：

- INC/IFM/IPM 的安装器都会写真实的 `$DESKTOP`/`$SMPROGRAMS` 快捷方式和 HKLM 卸载键；
- NSIS 没有"跳过快捷方式 / 不注册系统项"的静默开关，`/S` 也会按默认组件全部安装；
- 安装器声明 `RequestExecutionLevel admin`，非管理员运行会触发 UAC 弹窗（同样违反"无弹窗"与禁令）。

**等价静态验证（已做）**：instance 模式下逐条核对——每个 `$INSTDIR\...` 引用在真实载荷里存在、每个快捷方式创建都有同名删除、每条环境变量写入都有卸载删除、脚本自身带 UTF-8 BOM、无残留占位符。
即"指向的文件一定存在、卸载一定删干净"这两个断言在**脚本与载荷层面**已被证明；剩下只有"Windows 运行时行为"未实测。
若 Lead 需要 live 结论，建议在隔离环境（独立用户配置或 VM、独立 `INSTDIR`）里做，我可以按指令执行。

## 9. 复现命令

```powershell
$node = "D:\program\nodejs\node.exe"
# 1) INC 发布门禁
cd "D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\Infinity Cloud\sourcecode"
& $node tools\nsi-check.mjs --strict          # 期望 OK: 0 error, 0 warning, exit 0
& $node tools\nsi-check.test.mjs              # 期望 25 pass, 0 fail, exit 0
# 2) IFM 生成脚本
$tools = "D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\Infinity Cloud\sourcecode\tools\nsi-check.mjs"
foreach ($pl in @("win64","winx86","win-arm64")) {
  & $node $tools --instance --strict --root "D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\Infinity File Manager" `
    --template "D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\Infinity File Manager\sourcecode\build\setup-stage\setup-$pl.nsi"
}
# 3) IPM 生成脚本
& $node $tools --instance --strict --root "D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\InfinityPackageManager" `
  --template "D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\InfinityPackageManager\build\setup-stage\setup-win64.nsi"
# 4) 重建（只编译，不安装）
cd "...\Infinity Cloud\sourcecode";     & $node tools\make-setup.mjs v1.0pre5
cd "...\Infinity File Manager\sourcecode"; & $node tools\make-setup.mjs v1.0pre5
cd "...\InfinityPackageManager";         & $node tools\make-setup.mjs v1.0pre5
```
