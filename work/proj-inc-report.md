# task-3 报告：Infinity Cloud 收尾 —— 图标接入与命名契约核查

- 日期：2026-10-04
- 负责人：proj-inc（teammate）
- 范围：本轮按 Lead 指示做**只读核查 + 落盘**：cpp 命名契约三方对齐、Infinity Cloud 源码改动是否随 v1.0pre4 生效、图标映射与接入。
- 约束遵守：未修改 `cpp/**`、`web/**`、`history/**`；未运行 `pack-history.mjs`；未做网络上传/发布；未跑大型构建。临时文件只写在 `D:/temp/inc-verify`。

---

## 0. 一句话结论

1. **cpp v1.0pre4 的命名契约三方完全一致**：inc / ifm / ipm 各 6 个名字，iim / int / ing 各 4 个名字；六份发布安装包的 size + SHA-256 与 `release-assets.json` 全部匹配。
2. **v1.0pre4 没有任何图标接入**：安装载荷内 .ico 数量为 0，生成的 setup.nsi 无 MUI_ICON / Icon / 快捷方式图标 / DisplayIcon；`package.mjs` 注释声称“用户提供后会被拾取”，但没有任何拾取代码。
3. **Infinity Cloud（JS/SEA，v1.0pre2 线）的源码改动不在 v1.0pre4 内**：v1.0pre4 完全由 `cpp/tools/{build,package,manifest}.mjs` 管线产出，不读取 `Infinity Cloud/`。

---

## 1. 命名契约三方对齐（cpp，只读）

期望值来自 `cpp/tools/build.mjs:41-48` 的 APPS（`modes`），实际值来自目录清单；安装包内清单以 `cpp/build/verify-pre4/<setup>/`（项目自带的解包校验目录）与生成的 `setup.nsi` 的 `File` 指令为准。

| app | build.mjs modes | 期望名字（用户 + 管理员孪生） | cpp/out/<app> | installer-stage/<app> | verify-pre4 包内 | 结论 |
|---|---|---|---|---|---|---|
| inc | cli, gui, launcher | inc_cli / inc_gui / inc_launcher / inx_cli / inx_gui / inx_launcher | 6 | 6 | 6+Uninstall.exe | **OK** |
| ifm | cli, gui, launcher | ifm_cli / ifm_gui / ifm_launcher / ifmx_cli / ifmx_gui / ifmx_launcher | 6 | 6 | 6+Uninstall.exe | **OK** |
| ipm | cli, gui, launcher | ipm_cli / ipm_gui / ipm_launcher / ipmx_cli / ipmx_gui / ipmx_launcher | 6 | 6 | 6+Uninstall.exe | **OK** |
| iim | cli, gui | iim_cli / iim_gui / iimx_cli / iimx_gui | 4 | 4 | 4+Uninstall.exe | **OK** |
| int | cli, gui | int_cli / int_gui / intx_cli / intx_gui | 4 | 4 | 4+Uninstall.exe | **OK** |
| ing | cli, gui | ing_cli / ing_gui / ingx_cli / ingx_gui | 4 | 4 | 4+Uninstall.exe | **OK** |

证据行号：

- `cpp/tools/build.mjs:41-48`（APPS + modes）、`cpp/tools/build.mjs:114-128`（emitNames：每个 mode × {prefix, admin} 复制成真实文件）。
- `cpp/tools/package.mjs:33-40`（第二份 APPS + faces）、`cpp/tools/package.mjs:129-143`（stage 逐名复制并缺失即报错）。
- `cpp/build/installer-stage/inc/setup.nsi:24-29`（`File "inc_cli.exe"` … `File "inx_launcher.exe"` 六条）。
- `cpp/core/include/inc/mode.hpp:76-82`（两/三面规则：iim/int/ing 只认 cli|gui，其余再加 launcher）。

**副发现（一致性瑕疵，均在 cpp/tools，只读记录）**

- `cpp/tools/package.mjs:33-40` 与 `cpp/tools/build.mjs:41-48` 是两份**重复定义**的 APPS（字段名 modes/faces 不同）。程序化比对：当前各 app 的模式集合完全相同 → 目前无漂移，但存在未来漂移风险。
- `cpp/tools/build.mjs:2` 注释仍写 “give each executable its **eight** names”，与现状（3 面×2=6 / 2 面×2=4）不符。
- `cpp/tools/build.mjs:49` `export const MODES = ['cli','gui','launcher']` 是全局模式表，与按应用 modes 不同；全仓库仅此一处出现（无引用）。若有人误用它生成名字，iim/int/ing 会多出 `_launcher`。建议删除或从 APPS 派生。
- `cpp/core/include/inc/mode.hpp:44` `modeNames()` 返回全局 `"cli gui launcher"`，靠 :78-81 再做每应用裁剪，自洽。

---

## 2. Infinity Cloud 源码改动是否已随 v1.0pre4 生效 —— **否**

证据：

1. v1.0pre4 的全部产物在 `cpp/release/v1.0pre4/`，元数据 `release-assets.json.generated = 2026-10-03T13:07:19.167Z`；由 `cpp/tools/package.mjs:150-164` 调用 makensis 生成 setup，`cpp/tools/manifest.mjs:47-66` 写 name.txt / release-assets.json。这两个脚本（以及 build.mjs）**没有任何一处引用 `Infinity Cloud/` 目录**。
2. 安装包清单（`cpp/build/verify-pre4/*/`）：每个包只有对应应用的 6 或 4 个 .exe + `Uninstall.exe`；**没有 .ico，也没有任何 JS/SEA 产物**。
3. JS 树自身版本仍是 `v1.0pre2`（`Infinity Cloud/sourcecode/src/main.js:26`），其安装包走 `sourcecode/tools/make-setup.mjs` + `Infinity Cloud/installer.nsi`，版本默认也是 v1.0pre2（`make-setup.mjs:41-43` 的 SETUPS / `:162` 的循环，compile 时填 `@@VERSION@@`）。
4. 直接列 setup.exe 内容不可行的说明：本机只有 `D:/temp/tools/7za.exe`（7-Zip 21.07 精简版），不支持 Unicode NSIS（`Cannot open the file as archive`）。故采用项目自带的 verify-pre4 解包目录 + setup.nsi 的 `File` 指令作为“安装包内清单”的证据；两者互相印证。

**JS 树当前 git 状态与兼容性（只读观察，未再改动）**

- `git status`：`Infinity Cloud/sourcecode/src/tui/{tui,ifm,fs-model}.js` 在工作树被删除（`D`），但 HEAD 仍保留它们，且 **HEAD 的 `src/main.js` 仍 `import { runTui } from './tui/tui.js'`** → 若检出 HEAD 而不带工作树，启动即因模块缺失失败。
- 工作树原本的 `src/core/mode.js` 模式表是 `['cli','gui','launcher']`（无 tui），方向是**去掉 TUI**，与 cpp `mode.hpp:13-21`（“终端界面已从所有应用移除”）一致。
- 我此前按任务/worklog 记载的“八命名含 `_tui`”契约做过改动（见 §4），方向与上述两者相反；该改动**未随 v1.0pre4 生效**，待 Lead 决定保留或回退。

---

## 3. 图标核查

### 3.1 icons/ 现状与映射：是 6 个产品各自一枚，不是 ing/int/iim 取代 inc/ifm/ipm

| 图标 | 对应产品 | 证据 |
|---|---|---|
| `icons/inc.ico` + `icons/src/inc.svg` | Infinity Cloud | `icons/src/inc.svg:3` 头注释；`work/worklog.log:9` |
| `icons/ifm.ico` + `icons/src/ifm.svg` | Infinity File Manager | `icons/src/ifm.svg:3-4`；`worklog.log:11` |
| `icons/ipm.ico` + `icons/src/ipm.svg` | InfinityPackageManager | `icons/src/ipm.svg:3`；`worklog.log:10` |
| `icons/iim.ico` + `icons/src/iim.svg` | Infinity Installer Manager | `icons/src/iim.svg:3` |
| `icons/int.ico` + `icons/src/int.svg` | Infinity Toolbox | `icons/src/int.svg:3` |
| `icons/ing.ico` + `icons/src/ing.svg` | Infinity Games | `icons/src/ing.svg:3` |

这不是猜出来的，有可复算的证据：

- 6 个 .ico 全部由 `icons/tools/svg2ico.py` 产出：ICO 目录 7 项、尺寸 16/24/32/48/64/128/256 且每项都是内嵌 PNG（`svg2ico.py:30` 的 ICO_SIZES）；旧脚本 `sourcecode/tools/make-icons.mjs` 产出的是 BMP 条目、文件大 102,134 B，与本目录的 8 KB 级文件不符。
- 每个 .ico 的 32px 主色与其**同名 SVG** 的调色板逐一对上：
  inc `#12233f/#1b3a6b/#58a6ff`、ifm `#1f4d3a/#0f2a1e/#56d364`、ipm `#241338/#4a2a6b/#a371f7`、
  iim `#6b3f0a/#3a2308/#f2cc60`、int `#14406b/#0a2540/#1f6feb`、ing `#7a1236/#3d0a1e/#f778ba`。
- mtime：inc/ifm/ipm 为 2026-10-02 10:57，iim/int/ing 为 2026-10-03 09:04 → **后三个是新增产品，不是改名**。
- 结论：inc/ifm/ipm 的对应关系由文件名即产品名直接确定，**不存在需要猜测的映射**；请勿把 iim/int/ing 当作 inc/ifm/ipm 的替代图标。

**唯一的不确定项**：图标是否“本应接入 C++ 安装包”没有实现或明确文档（见 3.2）。映射本身不确定的部分为零。

### 3.2 cpp v1.0pre4 的图标接入 —— 缺失

- `cpp/tools/package.mjs:5-7` 注释：`No icons are assumed - they will be picked up when the user supplies them, but they are not a build prerequisite.`
  但全文没有读取任何 .ico 的代码；`:54-127` 生成的 setup.nsi 无 `MUI_ICON` / `Icon`；`:96-97` 两条 CreateShortCut 没有第 4 个图标参数；也没有写 `DisplayIcon`。
- 生成物 `cpp/build/installer-stage/inc/setup.nsi:1-19, 30-33, 48-54` 同样没有任何图标语句。
- `cpp/build/installer-stage/<app>/` 与 `cpp/build/verify-pre4/<setup>/` 内 .ico 数量均为 **0**。
- `cpp/CMakeLists.txt` 内无 `.rc` / `ICON` 资源，C++ exe 自身也没有应用图标。
- ⇒ v1.0pre4 的安装器、开始菜单/桌面快捷方式、卸载项都使用默认图标。若要接入，最小改动是在 `package.mjs` 里按 `app.dir` 映射到 `icons/<dir>.ico` 并写进 NSIS（MUI_ICON/MUI_UNICON、CreateShortCut 第 4 参、DisplayIcon）——**本次未做，属只读范围之外**。

### 3.3 Infinity Cloud（JS，v1.0pre2 线）的图标接入：我此前已改，但未随 v1.0pre4 生效

- `Infinity Cloud/installer.nsi:32-33` `MUI_ICON`/`MUI_UNICON` = `@@APP_DIR@@\inc.ico`；`:369` `DisplayIcon` = `$INSTDIR\inc.ico`；`:388-393` 三个快捷方式都带 `"$INSTDIR\inc.ico" 0`。
- `sourcecode/tools/make-setup.mjs:82-108`：只暂存 `inc.ico`（优先 `Infinity.inc/icons`，回退 `sourcecode/assets`），缺失即抛错；此前会连无引用的 `ifm.ico` 一起暂存。
- 现状提醒：`build/setup-stage/win64/inc.ico` 仍是旧的 102,134 B（sha256 前缀 `1cdcab7f52db211c`），新图标是 8,425 B（`d0e3bd6a34dac65e`）→ 只有重跑 make-setup 才会替换；本次未构建。

---

## 4. 我此前的改动清单（Infinity Cloud/**，6 个文件，工作树未提交）

| # | 文件 | 一句话说明 |
|---|---|---|
| 1 | `Infinity Cloud/sourcecode/tools/build-all.mjs:75` | MODES 恢复为 `['cli','tui','launcher']`，SEA 产出六名；同步命名注释 |
| 2 | `Infinity Cloud/sourcecode/src/core/mode.js:25` | MODES 增加 `tui`，可识别 `_tui` 名字 |
| 3 | `Infinity Cloud/sourcecode/src/core/launcher.js:17-21,45` | 启动器菜单恢复 TUI 项；非交互提示补 `_tui` |
| 4 | `Infinity Cloud/sourcecode/src/main.js:65-68` | `_tui` 分派到交互式 CLI（复用同一 Cli，避免引用已删除的 `src/tui/`） |
| 5 | `Infinity Cloud/installer.nsi:32-33,369,388-393,431,435,526,530` | 安装器/卸载器/快捷方式/DisplayIcon 统一用 `inc.ico`；环境变量补 `inctui`/`inxtui` |
| 6 | `Infinity Cloud/sourcecode/tools/make-setup.mjs:82-108` | 只暂存安装器真正引用的 `inc.ico`，缺失即报错 |

> 声明：以上均为工作树未提交改动；按 Lead 指示，本轮**不再改动任何源码**。它们属于 JS/SEA（v1.0pre2）线，与 cpp v1.0pre4 无关。

---

## 5. 验证命令与输出摘要

### 5.1 任务要求的轻量验证（`Infinity Cloud/sourcecode`）

```
node --check tools/build-all.mjs    -> exit 0
node --check tools/make-setup.mjs   -> exit 0
node --check src/main.js            -> exit 0
node --check src/core/mode.js       -> exit 0
node --check src/core/launcher.js   -> exit 0
node src/main.js --version          -> Infinity Cloud [v1.0pre2]
node src/main.js --paths            -> {"cli": "...\cli_set.ics", "cache": "D:\temp\Infinity Cloud",
                                        "trash": "D:\temp\recyle.bin\Infinity Cloud",
                                        "backup": "D:\temp\backup\Infinity Cloud"}   exit 0
```

### 5.2 只读契约脚本（临时文件在 `D:/temp/inc-verify`，不写入项目）

- `build-all.mjs` 的 `exeNames()`：7 个平台 × 6 名（inc/inx × cli/tui/launcher），Windows 带 `.exe`、unix 不带。
- `mode.js` 的 `detect()`（覆写 process.execPath 后逐个喂名字）：`inc_cli/inc_tui/inc_launcher/inc_gui/inx_cli/inx_tui/inx_launcher/inx_gui` 全部命中正确 mode/admin；`inc_old.exe`、`node.exe` 返回 mode=null。
- cpp 三方对齐脚本：6 个应用全部 OK（期望=out=stage=verify-pre4）。
- `release-assets.json` 完整性：6 个 setup.exe 的 size 与 sha256 **全部匹配**。
- 清理：临时目录 `D:/temp/inc-verify`、以及 run_code 误建的项目根 `Infinity.inc/undefined/` 已删除（后者为工具把空环境下的 tmpdir 解析成相对路径所致）。

---

## 6. 未决项 / 建议（供 Lead 决策）

1. **【高】C++ 安装包图标接入完全缺失**：`package.mjs:5-7` 的注释与实现不符；v1.0pre4 六套安装包全部使用默认图标。
2. **【中】JS 树 TUI 方向冲突**：工作树原本在删 `src/tui/`（与 C++ 一致），我此前按“八命名含 `_tui`”契约把它补回。请决定是**保留**（则 JS 树与 worklog 八名契约一致）还是**回退**（则与 v1.0pre4 方向一致）。
3. **【低】** `cpp/tools/build.mjs:2` “eight names” 注释过时；`:49` `MODES` 是死导出且会误导。
4. **【低】** `build.mjs:41-48` 与 `package.mjs:33-40` 的 APPS 应合并为单一来源。
5. **【低】** JS 树 HEAD 的 `src/main.js` 引用已从工作树删除的 `src/tui/*`；该提交被单独检出时无法启动。

---

## 7. 验收对照

- 改动文件清单 + 每条一行说明：§4（6 个文件）。
- 八命名/命名契约三方对齐：§1（未发现不一致）。
- Infinity Cloud 改动是否随 v1.0pre4 生效：§2（否，附证据）。
- 图标映射与接入核查：§3（映射确定；cpp 接入缺失；JS 接入已改但不在 v1.0pre4）。
- 验证命令与输出摘要：§5。
