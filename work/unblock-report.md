# 文件自行解除锁定（Zone.Identifier）报告 — task-26

状态：**完成**。构建通过（ninja `-j 2`），六个应用与 setup 安装流程都能清掉自己的
`Zone.Identifier` 备用数据流；共用实现只有一份（`cpp/common/unblock.hpp/.cpp`）。
未做任何联网、提权或文件内容修改，路径只来自 `GetModuleFileNameW`。

## 1. 实现

| 位置 | 内容 |
| --- | --- |
| `cpp/common/unblock.hpp` / `unblock.cpp` | 共用实现：`inc::unblockFile(path)`、`inc::unblockSelf()`、`inc::unblockSelfDirectory(maxDepth=2)`。用 `DeleteFileW(L"<path>:Zone.Identifier")` 删流；流不存在/删不掉都不报错；只读属性会临时清掉再复原；目录递归限自身目录、深度 ≤2，只处理 `.exe/.dll/.pak/.dat/.json/.txt`。 |
| `cpp/CMakeLists.txt` | 只加一次 `add_library(inc_common STATIC common/unblock.cpp)`，六个应用统一 `target_link_libraries(${app} PRIVATE inc_core inc_common)`。 |
| 六个 main（`cpp/apps/{inc,ifm,ipm,iim,int,ing}/main.cpp`） | 文件头 `#include "unblock.hpp"`，`main` 第一行前插入 `inc::unblockSelf(); inc::unblockSelfDirectory(2);`（含 ipm，prod-ipm 已确认保留）。 |
| `cpp/tools/package.mjs` | setup 流程对落地文件逐个消流；NSIS 核心 `Delete` 删不掉 ADS，改用 `System::Call 'kernel32::DeleteFileW(w "...")'`（`System.dll` 随 NSIS 自带，不多带文件、不下载）。 |
| `cpp/tools/build.mjs` | 构建改为 `ninja -j 2`。 |

安全边界：只删 `Zone.Identifier` 一个流，不打开、不写入、不改文件内容；目标是自身模块路径
及其所在目录，不接受外部路径参数。

## 2. 验收证据 A：六个应用「打流 → 运行 → 流消失」

命令（PowerShell，节选；每个应用对自身与其管理员孪生 exe 各打一个流）：

```powershell
function Stamp($p) { Set-Content -LiteralPath $p -Stream Zone.Identifier -Value "[ZoneTransfer]`r`nZoneId=3" -Encoding ASCII }
function Streams($p) { (Get-Item -LiteralPath $p -Stream * -EA SilentlyContinue |
  Where-Object { $_.Stream -eq 'Zone.Identifier' } | Measure-Object).Count }
Stamp "$out\inc\inc_cli.exe"; Stamp "$out\inc\inx_cli.exe"
"BEFORE"; & "$out\inc\inc_cli.exe" --version
"AFTER"; Streams "$out\inc\inc_cli.exe"
```

实际输出（cpp/out/<app>/，六个应用全部一样）：

```
== inc_cli.exe ==
BEFORE self=1 twin=1
RUN exit=0 output='Infinity Cloud [v1.0.0-pre4]'
AFTER  self=0 twin=0
== ifm_cli.exe ==
BEFORE self=1 twin=1
RUN exit=0 output='Infinity File Manager 1.0.0-pre4'
AFTER  self=0 twin=0
== ipm_cli.exe ==
BEFORE self=1 twin=1
RUN exit=0 output='InfinityPackageManager 1.0.0-pre4'
AFTER  self=0 twin=0
== iim_cli.exe ==
BEFORE self=1 twin=1
RUN exit=0 output='Infinity Installer Manager [v1.0.0-pre4]'
AFTER  self=0 twin=0
== int_cli.exe ==
BEFORE self=1 twin=1
RUN exit=0 output='Infinity Toolbox [v1.0.0-pre4]'
AFTER  self=0 twin=0
== ing_cli.exe ==
BEFORE self=1 twin=1
RUN exit=0 output='Infinity Games [v1.0.0-pre4]'
AFTER  self=0 twin=0
```

`BEFORE self=1 twin=1` → `AFTER self=0 twin=0`：自身被 `unblockSelf()` 清掉，管理员孪生由
`unblockSelfDirectory(2)` 在同目录清扫时清掉。

## 3. 验收证据 B：便携目录清扫（深度 ≤2，只清指定扩展名）

在 `cpp/out/ing` 下放 `probe.json`、`sub/mid.dat`、`sub/nested/deep.txt` 并各打一个流，
运行该目录里的 `ing_cli.exe --version`：

```
== ing directory sweep ==
BEFORE json=1 mid=1 deep=1
AFTER  json=0 mid=0 deep=0
```

## 4. 验收证据 C：setup 安装流程

先做隔离机制测试（`cpp/build/unblock-nsis-test/`，不写注册表、不动已交付安装包），
同时放 `ran.txt` 标记证明 Section 真的执行、`plain.bin` 验证普通删除：

```
Delete "$INSTDIR\a.bin:Zone.Identifier"                                   <- NSIS 核心 Delete
System::Call 'kernel32::DeleteFileW(w "$INSTDIR\b.bin:Zone.Identifier")'  <- 直调 API
Delete $INSTDIR\c.bin:Zone.Identifier                                     <- 不加引号
```

输出：

```
makensis exit=0
BEFORE ran=False plain=True a=1 b=1 c=1
RUN exit=0
AFTER  ran=True plain=False a=1 b=0 c=1
```

结论：Section 执行了（`ran.txt` 出现、`plain.bin` 被删），但 **NSIS 核心 `Delete`（引号/不加引号）
都删不掉 ADS**；`System::Call` 直调 `DeleteFileW` 成功（`b=0`）。因此 package.mjs 已改为
`System::Call`。生成的脚本形态（iim 为例）：

```nsis
System::Call 'kernel32::DeleteFileW(w "$INSTDIR\iim_cli.exe:Zone.Identifier") i .r2'
System::Call 'kernel32::DeleteFileW(w "$INSTDIR\iimx_cli.exe:Zone.Identifier") i .r2'
System::Call 'kernel32::DeleteFileW(w "$INSTDIR\iim_gui.exe:Zone.Identifier") i .r2'
System::Call 'kernel32::DeleteFileW(w "$INSTDIR\iimx_gui.exe:Zone.Identifier") i .r2'
System::Call 'kernel32::DeleteFileW(w "$INSTDIR\Uninstall.exe:Zone.Identifier") i .r2'
System::Call 'kernel32::DeleteFileW(w "$EXEPATH:Zone.Identifier") i .r2'
```

最终功能测试（同时验证落地文件与 `$EXEPATH`，安装包自身先打流再运行）：

```
makensis exit=0
BEFORE section-ran=False payload-stream=1 setup-stream=1
RUN exit=0
AFTER  section-ran=True payload-stream=0 setup-stream=0
```

生成的 6 个 setup 均用新版脚本重新编译成功（写在临时目录 `cpp/release/v1.0pre26-verify/`
验证后已删除，见第 6 节交接）。

## 5. 构建

命令（`cpp/` 下，已把 `-j 2` 写进 `build.mjs`）：

```powershell
$env:NODE_OPTIONS=''
node tools/build.mjs
```

输出（节选）：

```
configuring
compiling
built D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\cpp\build\inc.exe  1462272 B
  dependencies: Windows only
inc  Infinity Cloud            6 names  1462272 B  Windows dependencies only
ifm  Infinity File Manager     6 names  521216 B  Windows dependencies only
ipm  InfinityPackageManager    6 names  648704 B  Windows dependencies only
iim  Infinity Installer Manager4 names  724992 B  Windows dependencies only
int  Infinity Toolbox          4 names  677888 B  Windows dependencies only
ing  Infinity Games            4 names  606720 B  Windows dependencies only
```

导入表白名单审计照旧生效：六个应用全部 `Windows dependencies only`。

## 6. 冻结清单与哈希（sha256）

| 文件 | sha256 |
| --- | --- |
| `cpp/common/unblock.hpp` | `279e8f34da8f9847f7b550a515b4eb735cbeec247c575316a1aded5700355b75` |
| `cpp/common/unblock.cpp` | `cd448f55c4c3898066ee478eacf2c0576468c80fe1c3d84e5ac68c178f7b7de2` |
| `cpp/CMakeLists.txt` | `8c4ef7dbe75fb84c8542de53c932a9e82bdd06532809b3f723aeeb4799c0d028` |
| `cpp/tools/build.mjs` | `ebfe6b14152cb78ff2f6cc43aff7325086263b8c6a74d6b1b24f384b76284bd6` |
| `cpp/tools/package.mjs` | `02af86e0446ee0cd260eea7977525e5177c7ca6201f7fc81426fc578decc9bd5` |
| `cpp/apps/inc/main.cpp` | `45c98b4f512cf092ab4db48a62f0da22005fe49af4aac442e170831562bdcb79` |
| `cpp/apps/ifm/main.cpp` | `16c8d0ef0856575135fafdd1610480ffb8fd120d899308b63cca38eca14c818d` |
| `cpp/apps/ipm/main.cpp` | `c1a06827eb6aeb9ee491ea1ff70130b09e79f2bfe3b7f438371cdb698e6674d6` |
| `cpp/apps/iim/main.cpp` | `ad03dc54d1c082ffbb907f95d6faf89acff7a74e4f48e4837ab55bae0538fb1e` |
| `cpp/apps/int/main.cpp` | `88af579d677b6d1e3ccee24ad318ad74ffa4b16f05a3b9d9eeb8e78b783e4b70` |
| `cpp/apps/ing/main.cpp` | `dac63bc292c7f0bfaa599341b350b8864b4a2232c566ac7a3c4c10e77761331e` |

**已冻结：不再改 `cpp/apps/**`**（六个 main 的插入已完成；ipm 归 prod-ipm、int 归 prod-int 继续）。
注意 `cpp/tools/package.mjs` 的哈希在冻结消息之后又更新过一次（NSIS `Delete` → `System::Call`），
以本表 `02af86e0…` 为准。

## 7. 交接与遗留

- **`cpp/release/v1.0pre4/` 里的 6 个安装包还是旧脚本产物**：核心 `Delete` 步骤无效。ready 前需在
  产品 owner 冻结后重跑 `node tools/package.mjs`（会带上 `System::Call` 步骤），再跑
  `node tools/manifest.mjs` 更新 `release-assets.json` 的 sha256。我**没有**重打包 pre4，避免把
  其他任务进行中的改动固化进发布件。
- `cpp/tools/publish.mjs` 仍指向 `v1.0pre3` 且只有 4 个应用（发布阶段由 rel-publish 处理）。
- `cpp/README.md` 写着「NSIS 不带插件」，现在用 NSIS 自带的 `System.dll`，建议发布前一并更新
  （本次未改 README，避免与其他任务的文档改动冲突）。
- 未做真实静默安装跑测（会写 HKCU 环境变量与卸载键）；setup 侧的结论来自生成的 nsi + 隔离
  NSIS 功能测试，均为可复现步骤。
