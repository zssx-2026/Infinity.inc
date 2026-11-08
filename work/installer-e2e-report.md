# v1.0pre5 NSIS 安装包 端到端验证报告（task-10）

- 验证者：`verifier-e2e`（独立于打包者 release-v105）
- 验证对象：`cpp/release/v1.0pre5/` 下 6 个 per-user NSIS 安装包
- 验证时间：2026-10-06 10:37:53 ~ 10:38:42（Asia/Shanghai）
- 工作区：`D:\dev\DeepSeekHarnessWorkspace\Infinity.inc`
- 原始数据：`work/_installer-e2e/result.json`（机器可读）、`work/_installer-e2e/e2e.log`（全程日志）、`work/_installer-e2e-backup.json`（前态快照）

## 0. 结论

**通过（6/6 包全部成功装、卸，且安装产物与 `cpp/out` 逐字节一致）。**

- 6 个包静默安装退出码均为 `0`，`/D=` 指定的安装目录全部生效（无一个回落到默认 `%LOCALAPPDATA%\Programs\Infinity.Inc`）。
- 共比对可执行文件 30 个，SHA-256 与对应 `cpp/out/<app>/` 产物 **100% 一致**；6 个 `.ico` 与 `cpp/build/installer-stage/<app>/` 源图标也全部一致。
- 开始菜单 `Open.lnk`/`Uninstall.lnk` 的创建与目标路径、`HKCU\...\Uninstall\Infinity.Inc.*` 全部 7 个值、以及 `HKCU\Environment` 下各应用变量，均与 `setup.nsi` 预期完全吻合。
- 6 个包静默卸载退出码均为 `0`；卸载后安装目录、Uninstall 注册表键、开始菜单目录、Environment 变量全部被清理干净（`cleanupComplete=True`，未触发任何兜底强删）。
- 验证前后 HKCU 相关快照 **完全一致**（`restoreEqual=True`），未留下任何被测安装痕迹；`cpp/out` 在验证期间哈希 **无变化**（`cppOutChanged=False`），本次验证未修改任何仓内产物。

## 1. 环境与方法

- OS：Windows；shell：Windows PowerShell 5.1；`pwsh` 均以 `cmd /c start "" /wait ...` 方式拉起安装器，保证无可见窗口且能拿到真实退出码。
- 安装命令（每包一次）：
  ```
  cmd /c start "" /wait "<cpp\release\v1.0pre5\<setup>.exe>" /S /D=<work\_installer-e2e\<app>>
  ```
- 卸载命令：
  ```
  cmd /c start "" /wait "<installdir>\Uninstall.exe" /S
  ```
- 每包流程：备份 HKCU → 静默安装 → 等退出码 → 列文件并逐文件算 SHA-256 与 `cpp/out` 比对 → 校验 `.lnk`/注册表 → 静默卸载 → 轮询确认目录/键/快捷方式/变量消失 → 下一包。全部 6 包结束后恢复前态快照并与前态逐字节比较。
- 全程未下载/安装任何非本仓软件；未修改 `cpp/release` 内容（仅执行其中的 setup.exe）；未触碰 ING 数据、`history/`、`work/sync-history.mjs`。

## 2. 备份与恢复（HKCU 前态）

- 备份文件：`work/_installer-e2e-backup.json`（14198 字节），内容为 `HKCU\Environment` 中 32 个相关值 + 6 个 `Uninstall\Infinity.Inc.*` 键 + 开始菜单目录的「存在性/类型/值」全量快照。
- 前态要点：
  - `def_fm` = `"def"`（String，已存在）；`proxy_ip` = `""`（String，空串，已存在）。
  - 其余 30 个应用变量（inc*/ifm*/ipm*/iim*/int*/ing* 共 6 组）安装前 **均不存在**。
  - 6 个 `Uninstall\Infinity.Inc.*` 键安装前 **均不存在**。
  - 开始菜单父目录 `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Infinity.Inc` 已存在但为空；`%LOCALAPPDATA%\Programs\Infinity.Inc` 已存在。
- 恢复：脚本按快照逐值还原（原本不存在的删除、原本存在的按原类型/原值写回），并删除本次新建的开始菜单子目录。恢复后 `before == after` 比较结果：**True**。

## 3. 汇总表

| 包 | setup 大小(字节) | setup SHA-256(前 16) | 安装退出码 | 安装耗时(s) | 文件数 | exe 哈希一致 | ico 一致 | Environment | Uninstall 键 | 快捷方式 | 卸载退出码 | 卸载耗时(s) | 清理完成 |
|---|---:|---|---:|---:|---:|---|---|---|---|---|---:|---:|---|
| inc | 514535 | `2BB448C1FD0C35F9…` | 0 | 6.611 | 8 | 6/6 | 一致 | 一致 | 一致 | 一致 | 0 | 0.825 | 是 |
| ifm | 238305 | `4EA7673C84CD47BE…` | 0 | 5.937 | 8 | 6/6 | 一致 | 一致 | 一致 | 一致 | 0 | 0.833 | 是 |
| ipm | 288313 | `8295D0AD64C38778…` | 0 | 6.081 | 8 | 6/6 | 一致 | 一致 | 一致 | 一致 | 0 | 0.827 | 是 |
| iim | 306796 | `3B0DE0ED42A9DD92…` | 0 | 6.02 | 6 | 4/4 | 一致 | 一致 | 一致 | 一致 | 0 | 0.777 | 是 |
| int | 296537 | `FDD66258D5627771…` | 0 | 5.97 | 6 | 4/4 | 一致 | 一致 | 一致 | 一致 | 0 | 0.784 | 是 |
| ing | 268383 | `BE13F9C615AA5131…` | 0 | 5.959 | 6 | 4/4 | 一致 | 一致 | 一致 | 一致 | 0 | 0.772 | 是 |
| **合计** | — | — | 6×0 | — | 42 | 30/30 | 6/6 | 6/6 | 6/6 | 6/6 | 6×0 | — | 6/6 |

说明：`文件数` 含各包自身生成的 `Uninstall.exe`（无法与 `cpp/out` 比对，属预期），因此 inc/ifm/ipm 各 8 个（6 exe + 1 ico + Uninstall.exe），iim/int/ing 各 6 个（4 exe + 1 ico + Uninstall.exe）。所有包均**无缺失文件、无多余文件**。

## 4. 逐包详情

### 4.1 `inc` — Infinity Cloud

- 安装包：`cpp/release/v1.0pre5/InfinityCloud_1.0.0-pre5_win64_setup.exe`，514535 字节，SHA-256 `2BB448C1FD0C35F9AE8FB6ED0F32A3185444F5A52943663F4F1DB5D846761544`
- 安装目录（`/D=` 生效）：`D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\inc`（usedDefaultDir=false）
- 安装退出码 `0`，耗时 6.611 秒；文件数 8，多余 []，缺失 []

| 安装后文件 | 字节 | 安装后 SHA-256 | `cpp/out` SHA-256 | 一致 |
|---|---:|---|---|---|
| `inc_cli.exe` | 1559552 | `2296CE390C115989AF574ECE81FA251477004FA76020C58C489F7B871E7D651E` | `2296CE390C115989AF574ECE81FA251477004FA76020C58C489F7B871E7D651E` | ✅ |
| `inc_gui.exe` | 1559552 | `2296CE390C115989AF574ECE81FA251477004FA76020C58C489F7B871E7D651E` | `2296CE390C115989AF574ECE81FA251477004FA76020C58C489F7B871E7D651E` | ✅ |
| `inc_launcher.exe` | 1559552 | `2296CE390C115989AF574ECE81FA251477004FA76020C58C489F7B871E7D651E` | `2296CE390C115989AF574ECE81FA251477004FA76020C58C489F7B871E7D651E` | ✅ |
| `inx_cli.exe` | 1559552 | `2296CE390C115989AF574ECE81FA251477004FA76020C58C489F7B871E7D651E` | `2296CE390C115989AF574ECE81FA251477004FA76020C58C489F7B871E7D651E` | ✅ |
| `inx_gui.exe` | 1559552 | `2296CE390C115989AF574ECE81FA251477004FA76020C58C489F7B871E7D651E` | `2296CE390C115989AF574ECE81FA251477004FA76020C58C489F7B871E7D651E` | ✅ |
| `inx_launcher.exe` | 1559552 | `2296CE390C115989AF574ECE81FA251477004FA76020C58C489F7B871E7D651E` | `2296CE390C115989AF574ECE81FA251477004FA76020C58C489F7B871E7D651E` | ✅ |
| `inc.ico` | 8425 | `D0E3BD6A34DAC65E3AC3A8AD46866DB30027A43762612BA95250D524BE969ADB` | `D0E3BD6A34DAC65E3AC3A8AD46866DB30027A43762612BA95250D524BE969ADB`（installer-stage 源图标） | ✅ |
| `Uninstall.exe` | 47437 | `136E7FC46278360D3CF94D6DB719966DD1FF2EFDF4D4D4C0339D797667798440` | —（安装时生成，无源可比） | n/a |

**环境变量（HKCU\Environment，setup.nsi 预期 vs 实测）**

| 变量 | 实测值 | 与预期一致 |
|---|---|---|
| `inccli` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\inc\inc_cli.exe` | ✅ |
| `incgui` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\inc\inc_gui.exe` | ✅ |
| `inclauncher` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\inc\inc_launcher.exe` | ✅ |
| `inxcli` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\inc\inx_cli.exe` | ✅ |
| `inxgui` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\inc\inx_gui.exe` | ✅ |
| `inxlauncher` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\inc\inx_launcher.exe` | ✅ |

**HKCU 卸载键（`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Infinity.Inc.InfinityCloud`）**

| 值名 | 类型 | 实测值 | setup.nsi 预期 | 一致 |
|---|---|---|---|---|
| `DisplayName` | String | `Infinity Cloud` | `Infinity Cloud` | ✅ |
| `DisplayVersion` | String | `1.0.0-pre5` | `1.0.0-pre5` | ✅ |
| `DisplayIcon` | String | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\inc\inc.ico` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\inc\inc.ico` | ✅ |
| `InstallLocation` | String | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\inc` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\inc` | ✅ |
| `UninstallString` | String | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\inc\Uninstall.exe` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\inc\Uninstall.exe` | ✅ |
| `NoModify` | DWord | `1` | `1` | ✅ |
| `NoRepair` | DWord | `1` | `1` | ✅ |

**开始菜单快捷方式**（`SetShellVarContext current` → `%APPDATA%\...\Programs\Infinity.Inc\Infinity Cloud`）

- `Open.lnk` 存在：true，目标 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\inc\inc_launcher.exe`（预期 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\inc\inc_launcher.exe`）
- `Uninstall.lnk` 存在：true，目标 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\inc\Uninstall.exe`（预期 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\inc\Uninstall.exe`）
- 快捷方式读取错误：无；整体一致：✅

**卸载**：`<installdir>\Uninstall.exe /S` 退出码 `0`，耗时 0.825 秒；目录消失=true，注册表键消失=true，快捷方式目录消失=true，环境变量清除=true，清理完成=true，兜底强删=false。
异常记录：无

### 4.2 `ifm` — Infinity File Manager

- 安装包：`cpp/release/v1.0pre5/InfinityFileManager_1.0.0-pre5_win64_setup.exe`，238305 字节，SHA-256 `4EA7673C84CD47BE7D0DA1D603A36D44E6B1C0886456EA2025F8E66EC18FF310`
- 安装目录（`/D=` 生效）：`D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ifm`（usedDefaultDir=false）
- 安装退出码 `0`，耗时 5.937 秒；文件数 8，多余 []，缺失 []

| 安装后文件 | 字节 | 安装后 SHA-256 | `cpp/out` SHA-256 | 一致 |
|---|---:|---|---|---|
| `ifm_cli.exe` | 521216 | `8EADC46453D62DB12958A3C08824B099E781D437E17B312A841583CF9232ADA2` | `8EADC46453D62DB12958A3C08824B099E781D437E17B312A841583CF9232ADA2` | ✅ |
| `ifm_gui.exe` | 521216 | `8EADC46453D62DB12958A3C08824B099E781D437E17B312A841583CF9232ADA2` | `8EADC46453D62DB12958A3C08824B099E781D437E17B312A841583CF9232ADA2` | ✅ |
| `ifm_launcher.exe` | 521216 | `8EADC46453D62DB12958A3C08824B099E781D437E17B312A841583CF9232ADA2` | `8EADC46453D62DB12958A3C08824B099E781D437E17B312A841583CF9232ADA2` | ✅ |
| `ifmx_cli.exe` | 521216 | `8EADC46453D62DB12958A3C08824B099E781D437E17B312A841583CF9232ADA2` | `8EADC46453D62DB12958A3C08824B099E781D437E17B312A841583CF9232ADA2` | ✅ |
| `ifmx_gui.exe` | 521216 | `8EADC46453D62DB12958A3C08824B099E781D437E17B312A841583CF9232ADA2` | `8EADC46453D62DB12958A3C08824B099E781D437E17B312A841583CF9232ADA2` | ✅ |
| `ifmx_launcher.exe` | 521216 | `8EADC46453D62DB12958A3C08824B099E781D437E17B312A841583CF9232ADA2` | `8EADC46453D62DB12958A3C08824B099E781D437E17B312A841583CF9232ADA2` | ✅ |
| `ifm.ico` | 8112 | `255409A5AE4789EE74DDEB900DF468E7B2A45B12F563BCDC0CFB2EC4BAF6F8A6` | `255409A5AE4789EE74DDEB900DF468E7B2A45B12F563BCDC0CFB2EC4BAF6F8A6`（installer-stage 源图标） | ✅ |
| `Uninstall.exe` | 47427 | `DF35BA8D8196C797465F764C1226F42BA3E215920C62968DF80B74559B3655BF` | —（安装时生成，无源可比） | n/a |

**环境变量（HKCU\Environment，setup.nsi 预期 vs 实测）**

| 变量 | 实测值 | 与预期一致 |
|---|---|---|
| `ifmcli` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ifm\ifm_cli.exe` | ✅ |
| `ifmgui` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ifm\ifm_gui.exe` | ✅ |
| `ifmlauncher` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ifm\ifm_launcher.exe` | ✅ |
| `ifmxcli` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ifm\ifmx_cli.exe` | ✅ |
| `ifmxgui` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ifm\ifmx_gui.exe` | ✅ |
| `ifmxlauncher` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ifm\ifmx_launcher.exe` | ✅ |

**HKCU 卸载键（`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Infinity.Inc.InfinityFileManager`）**

| 值名 | 类型 | 实测值 | setup.nsi 预期 | 一致 |
|---|---|---|---|---|
| `DisplayName` | String | `Infinity File Manager` | `Infinity File Manager` | ✅ |
| `DisplayVersion` | String | `1.0.0-pre5` | `1.0.0-pre5` | ✅ |
| `DisplayIcon` | String | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ifm\ifm.ico` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ifm\ifm.ico` | ✅ |
| `InstallLocation` | String | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ifm` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ifm` | ✅ |
| `UninstallString` | String | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ifm\Uninstall.exe` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ifm\Uninstall.exe` | ✅ |
| `NoModify` | DWord | `1` | `1` | ✅ |
| `NoRepair` | DWord | `1` | `1` | ✅ |

**开始菜单快捷方式**（`SetShellVarContext current` → `%APPDATA%\...\Programs\Infinity.Inc\Infinity File Manager`）

- `Open.lnk` 存在：true，目标 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ifm\ifm_launcher.exe`（预期 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ifm\ifm_launcher.exe`）
- `Uninstall.lnk` 存在：true，目标 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ifm\Uninstall.exe`（预期 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ifm\Uninstall.exe`）
- 快捷方式读取错误：无；整体一致：✅

**卸载**：`<installdir>\Uninstall.exe /S` 退出码 `0`，耗时 0.833 秒；目录消失=true，注册表键消失=true，快捷方式目录消失=true，环境变量清除=true，清理完成=true，兜底强删=false。
异常记录：无

### 4.3 `ipm` — InfinityPackageManager

- 安装包：`cpp/release/v1.0pre5/InfinityPackageManager_1.0.0-pre5_win64_setup.exe`，288313 字节，SHA-256 `8295D0AD64C38778BD63F2F0EB028C33DE2902406AA44C17673543CFC3C8A3EE`
- 安装目录（`/D=` 生效）：`D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ipm`（usedDefaultDir=false）
- 安装退出码 `0`，耗时 6.081 秒；文件数 8，多余 []，缺失 []

| 安装后文件 | 字节 | 安装后 SHA-256 | `cpp/out` SHA-256 | 一致 |
|---|---:|---|---|---|
| `ipm_cli.exe` | 658944 | `FCCE903D6CD907827A9AA90C34DF2FF607AAEAA84DFD11A82D52EC9BCD995EC9` | `FCCE903D6CD907827A9AA90C34DF2FF607AAEAA84DFD11A82D52EC9BCD995EC9` | ✅ |
| `ipm_gui.exe` | 658944 | `FCCE903D6CD907827A9AA90C34DF2FF607AAEAA84DFD11A82D52EC9BCD995EC9` | `FCCE903D6CD907827A9AA90C34DF2FF607AAEAA84DFD11A82D52EC9BCD995EC9` | ✅ |
| `ipm_launcher.exe` | 658944 | `FCCE903D6CD907827A9AA90C34DF2FF607AAEAA84DFD11A82D52EC9BCD995EC9` | `FCCE903D6CD907827A9AA90C34DF2FF607AAEAA84DFD11A82D52EC9BCD995EC9` | ✅ |
| `ipmx_cli.exe` | 658944 | `FCCE903D6CD907827A9AA90C34DF2FF607AAEAA84DFD11A82D52EC9BCD995EC9` | `FCCE903D6CD907827A9AA90C34DF2FF607AAEAA84DFD11A82D52EC9BCD995EC9` | ✅ |
| `ipmx_gui.exe` | 658944 | `FCCE903D6CD907827A9AA90C34DF2FF607AAEAA84DFD11A82D52EC9BCD995EC9` | `FCCE903D6CD907827A9AA90C34DF2FF607AAEAA84DFD11A82D52EC9BCD995EC9` | ✅ |
| `ipmx_launcher.exe` | 658944 | `FCCE903D6CD907827A9AA90C34DF2FF607AAEAA84DFD11A82D52EC9BCD995EC9` | `FCCE903D6CD907827A9AA90C34DF2FF607AAEAA84DFD11A82D52EC9BCD995EC9` | ✅ |
| `ipm.ico` | 9467 | `A19CF69E74BB946F6488F70DFCFE6E4B768707BAC38E250A21EE3979ACAD09C4` | `A19CF69E74BB946F6488F70DFCFE6E4B768707BAC38E250A21EE3979ACAD09C4`（installer-stage 源图标） | ✅ |
| `Uninstall.exe` | 48458 | `B7DE7DFDD4A26F7EC52CA9CE2A99D68ABBA805B527C5474AE924EB0E83B92B77` | —（安装时生成，无源可比） | n/a |

**环境变量（HKCU\Environment，setup.nsi 预期 vs 实测）**

| 变量 | 实测值 | 与预期一致 |
|---|---|---|
| `ipmcli` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ipm\ipm_cli.exe` | ✅ |
| `ipmgui` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ipm\ipm_gui.exe` | ✅ |
| `ipmlauncher` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ipm\ipm_launcher.exe` | ✅ |
| `ipmxcli` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ipm\ipmx_cli.exe` | ✅ |
| `ipmxgui` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ipm\ipmx_gui.exe` | ✅ |
| `ipmxlauncher` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ipm\ipmx_launcher.exe` | ✅ |

**HKCU 卸载键（`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Infinity.Inc.InfinityPackageManager`）**

| 值名 | 类型 | 实测值 | setup.nsi 预期 | 一致 |
|---|---|---|---|---|
| `DisplayName` | String | `InfinityPackageManager` | `InfinityPackageManager` | ✅ |
| `DisplayVersion` | String | `1.0.0-pre5` | `1.0.0-pre5` | ✅ |
| `DisplayIcon` | String | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ipm\ipm.ico` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ipm\ipm.ico` | ✅ |
| `InstallLocation` | String | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ipm` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ipm` | ✅ |
| `UninstallString` | String | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ipm\Uninstall.exe` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ipm\Uninstall.exe` | ✅ |
| `NoModify` | DWord | `1` | `1` | ✅ |
| `NoRepair` | DWord | `1` | `1` | ✅ |

**开始菜单快捷方式**（`SetShellVarContext current` → `%APPDATA%\...\Programs\Infinity.Inc\InfinityPackageManager`）

- `Open.lnk` 存在：true，目标 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ipm\ipm_launcher.exe`（预期 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ipm\ipm_launcher.exe`）
- `Uninstall.lnk` 存在：true，目标 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ipm\Uninstall.exe`（预期 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ipm\Uninstall.exe`）
- 快捷方式读取错误：无；整体一致：✅

**卸载**：`<installdir>\Uninstall.exe /S` 退出码 `0`，耗时 0.827 秒；目录消失=true，注册表键消失=true，快捷方式目录消失=true，环境变量清除=true，清理完成=true，兜底强删=false。
异常记录：无

### 4.4 `iim` — Infinity Installer Manager

- 安装包：`cpp/release/v1.0pre5/InfinityInstallerManager_1.0.0-pre5_win64_setup.exe`，306796 字节，SHA-256 `3B0DE0ED42A9DD9270E6C9E90F1D1C0DF837270E3337AB16C5E2A317C9419221`
- 安装目录（`/D=` 生效）：`D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\iim`（usedDefaultDir=false）
- 安装退出码 `0`，耗时 6.02 秒；文件数 6，多余 []，缺失 []

| 安装后文件 | 字节 | 安装后 SHA-256 | `cpp/out` SHA-256 | 一致 |
|---|---:|---|---|---|
| `iim_cli.exe` | 728064 | `2AE09E17E91A5DF504CAC5693F0F1A535D3A234578A814A5215F62EAE0BFD483` | `2AE09E17E91A5DF504CAC5693F0F1A535D3A234578A814A5215F62EAE0BFD483` | ✅ |
| `iim_gui.exe` | 728064 | `2AE09E17E91A5DF504CAC5693F0F1A535D3A234578A814A5215F62EAE0BFD483` | `2AE09E17E91A5DF504CAC5693F0F1A535D3A234578A814A5215F62EAE0BFD483` | ✅ |
| `iimx_cli.exe` | 728064 | `2AE09E17E91A5DF504CAC5693F0F1A535D3A234578A814A5215F62EAE0BFD483` | `2AE09E17E91A5DF504CAC5693F0F1A535D3A234578A814A5215F62EAE0BFD483` | ✅ |
| `iimx_gui.exe` | 728064 | `2AE09E17E91A5DF504CAC5693F0F1A535D3A234578A814A5215F62EAE0BFD483` | `2AE09E17E91A5DF504CAC5693F0F1A535D3A234578A814A5215F62EAE0BFD483` | ✅ |
| `iim.ico` | 7905 | `DC73410E1941CBBDB4A69CA862F4ECEA3B63C943B6D7B495CF08394D9AE46E04` | `DC73410E1941CBBDB4A69CA862F4ECEA3B63C943B6D7B495CF08394D9AE46E04`（installer-stage 源图标） | ✅ |
| `Uninstall.exe` | 46898 | `648E02D32FBB07A351ABFEE3F1C9F341A11909688987A38AEF0FCF755C280311` | —（安装时生成，无源可比） | n/a |

**环境变量（HKCU\Environment，setup.nsi 预期 vs 实测）**

| 变量 | 实测值 | 与预期一致 |
|---|---|---|
| `iimcli` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\iim\iim_cli.exe` | ✅ |
| `iimgui` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\iim\iim_gui.exe` | ✅ |
| `iimxcli` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\iim\iimx_cli.exe` | ✅ |
| `iimxgui` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\iim\iimx_gui.exe` | ✅ |

**HKCU 卸载键（`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Infinity.Inc.InfinityInstallerManager`）**

| 值名 | 类型 | 实测值 | setup.nsi 预期 | 一致 |
|---|---|---|---|---|
| `DisplayName` | String | `Infinity Installer Manager` | `Infinity Installer Manager` | ✅ |
| `DisplayVersion` | String | `1.0.0-pre5` | `1.0.0-pre5` | ✅ |
| `DisplayIcon` | String | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\iim\iim.ico` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\iim\iim.ico` | ✅ |
| `InstallLocation` | String | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\iim` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\iim` | ✅ |
| `UninstallString` | String | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\iim\Uninstall.exe` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\iim\Uninstall.exe` | ✅ |
| `NoModify` | DWord | `1` | `1` | ✅ |
| `NoRepair` | DWord | `1` | `1` | ✅ |

**开始菜单快捷方式**（`SetShellVarContext current` → `%APPDATA%\...\Programs\Infinity.Inc\Infinity Installer Manager`）

- `Open.lnk` 存在：true，目标 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\iim\iim_gui.exe`（预期 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\iim\iim_gui.exe`）
- `Uninstall.lnk` 存在：true，目标 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\iim\Uninstall.exe`（预期 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\iim\Uninstall.exe`）
- 快捷方式读取错误：无；整体一致：✅

**卸载**：`<installdir>\Uninstall.exe /S` 退出码 `0`，耗时 0.777 秒；目录消失=true，注册表键消失=true，快捷方式目录消失=true，环境变量清除=true，清理完成=true，兜底强删=false。
异常记录：无

### 4.5 `int` — Infinity Toolbox

- 安装包：`cpp/release/v1.0pre5/InfinityToolbox_1.0.0-pre5_win64_setup.exe`，296537 字节，SHA-256 `FDD66258D5627771B879ABB1829ED2B2FF00CC6FEB8745C73AB8BDBC1E1FD2D3`
- 安装目录（`/D=` 生效）：`D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\int`（usedDefaultDir=false）
- 安装退出码 `0`，耗时 5.97 秒；文件数 6，多余 []，缺失 []

| 安装后文件 | 字节 | 安装后 SHA-256 | `cpp/out` SHA-256 | 一致 |
|---|---:|---|---|---|
| `int_cli.exe` | 684544 | `1E1E8A23FFA35861B0F13B716563301EAB013E82E1DFDB339AFDD7751A20F96E` | `1E1E8A23FFA35861B0F13B716563301EAB013E82E1DFDB339AFDD7751A20F96E` | ✅ |
| `int_gui.exe` | 684544 | `1E1E8A23FFA35861B0F13B716563301EAB013E82E1DFDB339AFDD7751A20F96E` | `1E1E8A23FFA35861B0F13B716563301EAB013E82E1DFDB339AFDD7751A20F96E` | ✅ |
| `intx_cli.exe` | 684544 | `1E1E8A23FFA35861B0F13B716563301EAB013E82E1DFDB339AFDD7751A20F96E` | `1E1E8A23FFA35861B0F13B716563301EAB013E82E1DFDB339AFDD7751A20F96E` | ✅ |
| `intx_gui.exe` | 684544 | `1E1E8A23FFA35861B0F13B716563301EAB013E82E1DFDB339AFDD7751A20F96E` | `1E1E8A23FFA35861B0F13B716563301EAB013E82E1DFDB339AFDD7751A20F96E` | ✅ |
| `int.ico` | 8241 | `B84CF22E2A3D419DB9F0FC4F12C26A113A60742599FA18AFD4632209F0536B4E` | `B84CF22E2A3D419DB9F0FC4F12C26A113A60742599FA18AFD4632209F0536B4E`（installer-stage 源图标） | ✅ |
| `Uninstall.exe` | 47413 | `8BB2D66A67BF31C9A38DE3DD23EE8D41E427C82D0A73B9C0066C8626C2B20775` | —（安装时生成，无源可比） | n/a |

**环境变量（HKCU\Environment，setup.nsi 预期 vs 实测）**

| 变量 | 实测值 | 与预期一致 |
|---|---|---|
| `intcli` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\int\int_cli.exe` | ✅ |
| `intgui` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\int\int_gui.exe` | ✅ |
| `intxcli` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\int\intx_cli.exe` | ✅ |
| `intxgui` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\int\intx_gui.exe` | ✅ |

**HKCU 卸载键（`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Infinity.Inc.InfinityToolbox`）**

| 值名 | 类型 | 实测值 | setup.nsi 预期 | 一致 |
|---|---|---|---|---|
| `DisplayName` | String | `Infinity Toolbox` | `Infinity Toolbox` | ✅ |
| `DisplayVersion` | String | `1.0.0-pre5` | `1.0.0-pre5` | ✅ |
| `DisplayIcon` | String | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\int\int.ico` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\int\int.ico` | ✅ |
| `InstallLocation` | String | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\int` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\int` | ✅ |
| `UninstallString` | String | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\int\Uninstall.exe` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\int\Uninstall.exe` | ✅ |
| `NoModify` | DWord | `1` | `1` | ✅ |
| `NoRepair` | DWord | `1` | `1` | ✅ |

**开始菜单快捷方式**（`SetShellVarContext current` → `%APPDATA%\...\Programs\Infinity.Inc\Infinity Toolbox`）

- `Open.lnk` 存在：true，目标 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\int\int_gui.exe`（预期 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\int\int_gui.exe`）
- `Uninstall.lnk` 存在：true，目标 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\int\Uninstall.exe`（预期 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\int\Uninstall.exe`）
- 快捷方式读取错误：无；整体一致：✅

**卸载**：`<installdir>\Uninstall.exe /S` 退出码 `0`，耗时 0.784 秒；目录消失=true，注册表键消失=true，快捷方式目录消失=true，环境变量清除=true，清理完成=true，兜底强删=false。
异常记录：无

### 4.6 `ing` — Infinity Games

- 安装包：`cpp/release/v1.0pre5/InfinityGames_1.0.0-pre5_win64_setup.exe`，268383 字节，SHA-256 `BE13F9C615AA5131840C8C32D2B3DA8E5FDC834E9811669CF0A443F15431398C`
- 安装目录（`/D=` 生效）：`D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ing`（usedDefaultDir=false）
- 安装退出码 `0`，耗时 5.959 秒；文件数 6，多余 []，缺失 []

| 安装后文件 | 字节 | 安装后 SHA-256 | `cpp/out` SHA-256 | 一致 |
|---|---:|---|---|---|
| `ing_cli.exe` | 611840 | `CC8BB3193518ECEC7F4C128FE910FC5F0CFF0C491B7D003A134901FA447AABE4` | `CC8BB3193518ECEC7F4C128FE910FC5F0CFF0C491B7D003A134901FA447AABE4` | ✅ |
| `ing_gui.exe` | 611840 | `CC8BB3193518ECEC7F4C128FE910FC5F0CFF0C491B7D003A134901FA447AABE4` | `CC8BB3193518ECEC7F4C128FE910FC5F0CFF0C491B7D003A134901FA447AABE4` | ✅ |
| `ingx_cli.exe` | 611840 | `CC8BB3193518ECEC7F4C128FE910FC5F0CFF0C491B7D003A134901FA447AABE4` | `CC8BB3193518ECEC7F4C128FE910FC5F0CFF0C491B7D003A134901FA447AABE4` | ✅ |
| `ingx_gui.exe` | 611840 | `CC8BB3193518ECEC7F4C128FE910FC5F0CFF0C491B7D003A134901FA447AABE4` | `CC8BB3193518ECEC7F4C128FE910FC5F0CFF0C491B7D003A134901FA447AABE4` | ✅ |
| `ing.ico` | 8242 | `F774518C62B31CC6E52780473BB7F6D1D294D335A974109206B9E86115F74FA3` | `F774518C62B31CC6E52780473BB7F6D1D294D335A974109206B9E86115F74FA3`（installer-stage 源图标） | ✅ |
| `Uninstall.exe` | 47410 | `99F28042C06CF7B729F11F53B173BA627A5D3F566B141B2882F1D8CA4E2141EE` | —（安装时生成，无源可比） | n/a |

**环境变量（HKCU\Environment，setup.nsi 预期 vs 实测）**

| 变量 | 实测值 | 与预期一致 |
|---|---|---|
| `ingcli` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ing\ing_cli.exe` | ✅ |
| `inggui` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ing\ing_gui.exe` | ✅ |
| `ingxcli` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ing\ingx_cli.exe` | ✅ |
| `ingxgui` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ing\ingx_gui.exe` | ✅ |

**HKCU 卸载键（`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Infinity.Inc.InfinityGames`）**

| 值名 | 类型 | 实测值 | setup.nsi 预期 | 一致 |
|---|---|---|---|---|
| `DisplayName` | String | `Infinity Games` | `Infinity Games` | ✅ |
| `DisplayVersion` | String | `1.0.0-pre5` | `1.0.0-pre5` | ✅ |
| `DisplayIcon` | String | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ing\ing.ico` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ing\ing.ico` | ✅ |
| `InstallLocation` | String | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ing` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ing` | ✅ |
| `UninstallString` | String | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ing\Uninstall.exe` | `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ing\Uninstall.exe` | ✅ |
| `NoModify` | DWord | `1` | `1` | ✅ |
| `NoRepair` | DWord | `1` | `1` | ✅ |

**开始菜单快捷方式**（`SetShellVarContext current` → `%APPDATA%\...\Programs\Infinity.Inc\Infinity Games`）

- `Open.lnk` 存在：true，目标 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ing\ing_gui.exe`（预期 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ing\ing_gui.exe`）
- `Uninstall.lnk` 存在：true，目标 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ing\Uninstall.exe`（预期 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\_installer-e2e\ing\Uninstall.exe`）
- 快捷方式读取错误：无；整体一致：✅

**卸载**：`<installdir>\Uninstall.exe /S` 退出码 `0`，耗时 0.772 秒；目录消失=true，注册表键消失=true，快捷方式目录消失=true，环境变量清除=true，清理完成=true，兜底强删=false。
异常记录：无

## 5. 注册表 / 开始菜单 前 · 中 · 后 快照

- **前（安装任何包之前）**：30 个应用 Environment 变量全部不存在；6 个 Uninstall 键全部不存在；开始菜单 `Infinity.Inc` 下无任何子目录。
- **中（每包安装完成后即时快照，见 result.json 各 `registryDuring`）**：仅当前包的变量/键/快捷方式存在，其余包保持不存在。例（inc 安装后）：`inccli`=`...\_installer-e2e\inc\inc_cli.exe`、`incgui`=`...\inc_gui.exe`、`inclauncher`=`...\inc_launcher.exe`、`inxcli`/`inxgui`/`inxlauncher` 同理；`Infinity.Inc.InfinityCloud` 键 7 个值齐备（DisplayName=Infinity Cloud、DisplayVersion=1.0.0-pre5、DisplayIcon/InstallLocation/UninstallString 指向安装目录、NoModify=1(DWord)、NoRepair=1(DWord)）。
- **后（全部卸载 + 恢复后）**：`residual env product vars = 空`，`residual uninstall keys = 0`，开始菜单 `Infinity.Inc` 子项 `0` 个，`def_fm=def`、`proxy_ip=[]` 与原值一致；单独校验 `before==after` 为 **True**。

## 6. 清理确认与遗留

- 依据约束，本次仅写入以下路径：
  - `work/_installer-e2e/`（脚本、日志、结果、前后快照；`cpp-out-after.json`、`cpp-out-before.json`、`e2e.log`、`e2e.ps1`、`result.json`、`snapshot-after.json`）
  - `work/_installer-e2e-backup.json`
  - `work/installer-e2e-report.md`（本报告）
- 安装目录 `work/_installer-e2e/<app>` 均已由卸载器删除，`work/_installer-e2e/` 下无任何 exe/ico 残留（只剩上述验证数据文件）。
- 用户级残留：**无**。`%LOCALAPPDATA%\Programs\Infinity.Inc` 在测试前后均存在（前态即存在，未被本次测试写入）；开始菜单父目录也未新增内容。
- `cpp/release/v1.0pre5`、`cpp/out`、`cpp/build/installer-stage`、ING 相关目录、`history/`、`work/sync-history.mjs` 均未被修改；`cpp/out` 测试前后 SHA-256 清单完全相等（`cpp-out-before.json` / `cpp-out-after.json`，两文件 5366 字节且内容相同）。

## 7. 硬约束遵守情况

| 约束 | 结果 |
|---|---|
| 只写 `work/_installer-e2e/**`、`work/_installer-e2e-backup.json`、`work/installer-e2e-report.md` | ✅ 仅这些路径（HKCU 注册表为安装/卸载/恢复所必需，已完全还原） |
| 不碰 `cpp/release` 内容 | ✅ 只读执行；包哈希与大小未变 |
| 不碰 ING / Infinity Games 数据目录 / `history/` / `work/sync-history.mjs` | ✅ 未读写（`InfinityGames` 安装器只装入 `work/_installer-e2e/ing` 沙箱目录，卸载器已删除） |
| 不下载/安装任何非本仓软件 | ✅ 全程离线，仅运行本仓 6 个 setup.exe |
| 无弹窗/可见窗口 | ✅ 安装与卸载均 `/S` 静默，通过 `cmd /c start /wait` 隐藏控制台拉起 |
| 任何失败都要如实记录并确保卸载/恢复 | ✅ 本次无失败；仍执行了恢复与前后快照比对 |

## 8. 局限与提示

- 本验证为**特殊路径**（`/D=` 重定向到工作区沙箱目录，随后立即卸载），未验证默认安装路径 `%LOCALAPPDATA%\Programs\Infinity.Inc\<产品>` 下的首次安装；但 `/D=` 生效说明 `InstallDir`/`SetOutPath` 逻辑正常，默认路径仅有目录字符串差异。
- 验证时 `cpp/out` 与 `cpp/release` 的哈希在测试窗口内稳定；若后续重构 `cpp/out` 而未重打安装包，安装内容会与 `cpp/out` 产生差异——本报告只能证明「本次验证时刻」二者一致。
- 未做 UI 交互安装（MUI 向导）与安装后运行 exe 的行为验证，超出本任务范围。

---
原始证据：`work/_installer-e2e/result.json`、`work/_installer-e2e/e2e.log`、`work/_installer-e2e/snapshot-after.json`、`work/_installer-e2e-backup.json`。
