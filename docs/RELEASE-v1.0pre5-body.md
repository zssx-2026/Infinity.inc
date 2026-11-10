> **预发布（prerelease）** ｜ Git 标签 `v1.0.0-pre5` ｜ 版本目录 `cpp/release/v1.0pre5/` ｜ 平台 **win64（单架构）** ｜ 发布账号 GitHub `zssx-2026`

# Infinity.Inc v1.0.0-pre5 发行说明 / Release notes

## 简介

v1.0.0-pre5 是套件的第五个预发布版，本批交付三个应用：

- **Infinity Cloud**（`inc`）—— GitHub 承载的云端：凭据、清单、上传/下载、回收站
- **InfinityPackageManager**（`ipm`）—— 软件目录：浏览目录页、校验摘要并运行安装包
- **Infinity Toolbox**（`int`）—— 小工具注册表，支持内置工具与 `.itbt` 容器插件

本版要点：

- **窗口外壳换代（WebView2 宿主）。** 上一版的 GUI 面依赖 268 MB 的 Electron 外壳目录且与 `<p>_gui.exe` 同名冲突；本版改为自带 **452,114 字节**的 WebView2 宿主（`<p>_window.exe` 58,880 B + `WebView2Loader.dll` 194,912 B + `ui/` 11 个文件 201,906 B），浏览器内核由系统 Microsoft Edge WebView2 Runtime（Evergreen）提供。自建精简 Chromium 内核方案经实测被否：CEF 精简内核 324.87 MiB/应用，比 Electron 外壳 268.05 MiB 还大 21.2%，裁掉 locale 后 Electron 219.99 MiB、CEF 反高 47.7%。
- **开始菜单快捷方式直达窗口。** 快捷方式指向 `<p>_window.exe`，参数 `--app=<p> --port=<port> --show --title=<产品名>`；宿主以 CreateProcessW + Job Object 拉起 `--serve-ui` 服务进程，**关闭窗口即连带结束子进程**，不留后台残留。
- **安装包与可执行文件接入产品图标。** `setup.nsi` 含 `MUI_ICON`/`MUI_UNICON`，载荷含 `<p>.ico`，快捷方式与卸载项 `DisplayIcon` 指向该图标；可执行文件 PE 资源段带同款图标与 `VERSIONINFO`（公司 `Infinity.Inc`、版本 `1.0.0-pre5`）。
- **自解锁**：程序启动最早期清除自身与自身目录（深度 ≤2，仅 `.exe/.dll/.pak/.dat/.json/.txt`）的 `Zone.Identifier`；安装包同样清除落地文件的该标记。

## 一、下载：三个安装包（字节数 + SHA-256）

三个应用在各自 GitHub 仓库发布，**一个仓库一个安装包**，标签统一为 `v1.0.0-pre5`，合计 **1,560,112 字节**。

| 应用 | 安装包 | 字节数 | SHA-256 | 发布页 |
| --- | --- | ---: | --- | --- |
| Infinity Cloud | `InfinityCloud_1.0.0-pre5_win64_setup.exe` | 671,016 | `502edbae695d656c1d5ada40571c79420b9c6e3bf6a0174db1cb09f5226e407f` | <https://github.com/zssx-2026/Infinity-Cloud/releases/tag/v1.0.0-pre5> |
| InfinityPackageManager | `InfinityPackageManager_1.0.0-pre5_win64_setup.exe` | 436,840 | `ab37f574d415ee44a9c2bc0c4bab05016362629f88035930ea5e7d14091cacfc` | <https://github.com/zssx-2026/InfinityPackageManager/releases/tag/v1.0.0-pre5> |
| Infinity Toolbox | `InfinityToolbox_1.0.0-pre5_win64_setup.exe` | 452,256 | `efd3466d10871109f94934fb4799085fcbb473bb4519dad0b90d14a5adbd8d24` | <https://github.com/zssx-2026/Infinity-Toolbox/releases/tag/v1.0.0-pre5> |

直接下载地址（`browser_download_url`，来自 `cpp/release/v1.0pre5/release-assets.json`）：

```text
https://github.com/zssx-2026/Infinity-Cloud/releases/download/v1.0.0-pre5/InfinityCloud_1.0.0-pre5_win64_setup.exe
https://github.com/zssx-2026/InfinityPackageManager/releases/download/v1.0.0-pre5/InfinityPackageManager_1.0.0-pre5_win64_setup.exe
https://github.com/zssx-2026/Infinity-Toolbox/releases/download/v1.0.0-pre5/InfinityToolbox_1.0.0-pre5_win64_setup.exe
```

## 二、校验方法

```powershell
# 单个安装包
(Get-FileHash -Algorithm SHA256 InfinityCloud_1.0.0-pre5_win64_setup.exe).Hash.ToLower()
certutil -hashfile InfinityCloud_1.0.0-pre5_win64_setup.exe SHA256

# 发行目录内逐项比对（在含 SHA256SUMS.txt 的 cpp/release/v1.0pre5/ 执行）
Get-Content SHA256SUMS.txt | ForEach-Object {
  $h, $f = $_ -split '\s+', 2
  $got = (Get-FileHash -Algorithm SHA256 -LiteralPath $f).Hash.ToLower()
  if ($got -eq $h) { Write-Output ('OK   ' + $f) } else { Write-Output ('FAIL ' + $f) }
}
```

GitHub Release 资产对象上的 `digest: sha256:...` 应与上表逐字符相同。**请核对小写十六进制全文，不要只看前几位。**

## 三、系统要求

- **操作系统**：Windows 10 1803 及以上 / Windows 11，x64。本版**只有 win64 单架构**。
- **Microsoft Edge WebView2 Runtime**：GUI 面必需。Windows 11 已内置；Windows 10 若未安装，宿主会以退出码 20 退出并提示 `Microsoft Edge WebView2 Runtime is not installed.`，请先安装 Evergreen Runtime（<https://developer.microsoft.com/microsoft-edge/webview2/>）。**安装包不捆绑内核。**
- **权限**：无需管理员权限。安装器以 `RequestExecutionLevel user` 运行，安装到 `%LOCALAPPDATA%\Programs\Infinity.Inc\<产品>`，写 HKCU 环境变量（广播 `WM_SETTINGCHANGE`）与卸载键，并创建开始菜单快捷方式；卸载时删除这些项。
- **磁盘**：安装包每应用 0.44–0.67 MB。
- **网络**：程序启动本身不需要网络；Cloud 的云端功能与 IPM 的目录查询按功能使用 HTTPS。

## 四、安装与卸载

```powershell
# 图形安装
.\InfinityCloud_1.0.0-pre5_win64_setup.exe

# 静默安装（无需管理员）
.\InfinityCloud_1.0.0-pre5_win64_setup.exe /S

# 静默卸载
& "$env:LOCALAPPDATA\Programs\Infinity.Inc\Infinity Cloud\Uninstall.exe" /S
```

安装后在开始菜单启动对应产品；首次启动会初始化 WebView2 用户数据目录，首帧可能比后续启动慢数秒（实测 inc 首次 6.07 s、int 1.62 s）。

## 五、已知问题与限制

1. **本批只发布三个应用。** Infinity File Manager、InfinityInstallerManager、Infinity Games 本轮未随包发布，其仓库仍停留在上一版 `v1.0.0-pre4`；六个应用的统一发行在后续版本恢复。
2. **WebView2 Runtime 不随包分发。** 缺少运行时的机器只能使用 CLI 面；GUI 面需要系统已安装 Evergreen Runtime（见第三节）。
3. **只发布 win64。** 三个安装包均为单架构 win64；跨架构编译目标尚未加入。
4. **没有聚合三个包的单一 Release。** 三个应用在各自仓库分别发布，本页是汇总说明。
5. **真实「静默安装 → 校验 → 卸载」的端到端结论以独立验证任务报告为准。** 本页哈希只保证安装包字节与本地发行产物一致；安装行为会写入当前用户 HKCU（环境变量与卸载键），属对机器的持久改动。
6. **任何重建/重打包都会改变字节**，本页全部校验值必须重新生成。

## 六、相关文件

- `cpp/release/v1.0pre5/release-assets.json` —— 机器可读清单（tag / version / size / sha256 / fnv1a / repo / url）
- `cpp/release/v1.0pre5/SHA256SUMS.txt` —— 三项安装包 + `name.txt` + `release-assets.json` 校验和
- `work/PLAN-v1.0pre5.md` §1 —— 外壳换代决策与实证数据
- `work/TASKS.md` —— task-12（外壳）、图标接线、发布状态台账
