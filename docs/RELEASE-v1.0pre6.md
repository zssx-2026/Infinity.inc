# Infinity.Inc v1.0.0-pre6 发行说明 / Release notes

> 本文件是仓库内的发行说明副本；GitHub Release 正文见 `docs/RELEASE-v1.0pre6-body.md`。
> 预发布（prerelease） ｜ Git 标签 `v1.0.0-pre6` ｜ 版本目录 `cpp/release/v1.0pre6/` ｜ 平台 win64（单架构）

## 简介

v1.0.0-pre6 是套件的第六个预发布版，本批交付三个应用：

- **Infinity Cloud**（`inc`）—— GitHub 承载的云端：凭据、清单、上传/下载、回收站
- **InfinityPackageManager**（`ipm`）—— 软件目录：浏览目录页、校验摘要并运行安装包
- **Infinity Toolbox**（`int`）—— 小工具注册表，支持内置工具与 `.itbt` 容器插件

本版要点：

- **窗口外壳换成 Electron 套壳，界面不再发糊。** 上一版用自建 WebView2 宿主，进程没有任何 DPI 声明，在 150% 缩放的显示器上被系统按位图拉伸（原生 1920×1200 → 逻辑 1280×800），文字发虚。本版改为 Electron 33.4.11 外壳：进程本身 per-monitor DPI aware，实测 `devicePixelRatio = 1.5`、窗口 1180×752 DIP、抓帧 1749×1073 **原生像素**，即按显示器原生分辨率渲染，没有位图放大。
- **第一次启动自己弹令牌界面。** 不再要求先设环境变量才能开程序：未登录时窗口里就是一张单字段页（一个令牌输入框 + 一个「继续」按钮），令牌用 Windows DPAPI（`CryptProtectData`，`CRYPTPROTECT_UI_FORBIDDEN`）加密后写到 `%LOCALAPPDATA%\Infinity\<app>\token.bin`（隐藏属性），明文只存在于进程内存；下次启动自动解密登录，不再询问。环境变量 `gittoken_zssx-2026_1` / `EV_GH_TOKEN` 仍被认，但只是回退路径，不再是前置条件。
- **未登录时界面与 API 分离。** 页面拿得到令牌页；`/api/*` 在未登录时统一返回 401（`尚未登录`），不会拿空凭据去撞 GitHub。
- **三个应用都换壳。** 安装包从上一版的 0.44–0.67 MB 变为 **80 MB 级**（Electron 运行时随包，自包含，不依赖系统里的任何浏览器内核）。

## 一、下载：三个安装包（字节数 + SHA-256）

三个应用在各自 GitHub 仓库发布，**一个仓库一个安装包**，标签统一为 `v1.0.0-pre6`，合计 **252,069,312 字节**。

| 应用 | 安装包 | 字节数 | SHA-256 | 发布页 |
| --- | --- | ---: | --- | --- |
| Infinity Cloud | `InfinityCloud_1.0.0-pre6_win64_setup.exe` | 84,211,080 | `e9f6fdad9a390aba3e6e6cdd93a9a1cd9dd1cee337ac2f4c7af0931e30df80db` | <https://github.com/zssx-2026/Infinity-Cloud/releases/tag/v1.0.0-pre6> |
| InfinityPackageManager | `InfinityPackageManager_1.0.0-pre6_win64_setup.exe` | 83,935,056 | `721f4dccf09a979a82f840da2d5abb08163415e9190dbd6d7ac564a6738f7b20` | <https://github.com/zssx-2026/InfinityPackageManager/releases/tag/v1.0.0-pre6> |
| Infinity Toolbox | `InfinityToolbox_1.0.0-pre6_win64_setup.exe` | 83,923,176 | `b76a84446891838d169e8d2cf1b9aeb19835cee0338b07074fdd92a98ed1d971` | <https://github.com/zssx-2026/Infinity-Toolbox/releases/tag/v1.0.0-pre6> |

直接下载地址（`browser_download_url`，来自 `cpp/release/v1.0pre6/release-assets.json`）：

```text
https://github.com/zssx-2026/Infinity-Cloud/releases/download/v1.0.0-pre6/InfinityCloud_1.0.0-pre6_win64_setup.exe
https://github.com/zssx-2026/InfinityPackageManager/releases/download/v1.0.0-pre6/InfinityPackageManager_1.0.0-pre6_win64_setup.exe
https://github.com/zssx-2026/Infinity-Toolbox/releases/download/v1.0.0-pre6/InfinityToolbox_1.0.0-pre6_win64_setup.exe
```

三个安装包均已用代码签名证书签名（Authenticode，状态 `Valid`，证书指纹 `3C626CCE1DFA8833F844BA176DB1922B7B4069C2`）。

## 二、校验方法

```powershell
# 单个安装包
(Get-FileHash -Algorithm SHA256 InfinityCloud_1.0.0-pre6_win64_setup.exe).Hash.ToLower()
certutil -hashfile InfinityCloud_1.0.0-pre6_win64_setup.exe SHA256

# 发行目录内逐项比对（在含 SHA256SUMS.txt 的 cpp/release/v1.0pre6/ 执行）
Get-Content SHA256SUMS.txt | ForEach-Object {
  $h, $f = $_ -split '\s+', 2
  $got = (Get-FileHash -Algorithm SHA256 -LiteralPath $f).Hash.ToLower()
  if ($got -eq $h) { Write-Output ('OK   ' + $f) } else { Write-Output ('FAIL ' + $f) }
}
```

GitHub Release 资产对象上的 `digest: sha256:...` 应与上表逐字符相同。**请核对小写十六进制全文，不要只看前几位。**

## 三、系统要求

- **操作系统**：Windows 10 x64 及以上 / Windows 11，x64。本版**只有 win64 单架构**。
- **无需任何额外运行时**：Electron 与 Chromium 随安装包分发（每个应用 stage 载荷约 268 MB，安装后占用同量级），不需要 Microsoft Edge WebView2 Runtime，也不需要系统装 Node.js。
- **权限**：无需管理员权限。安装器以 `RequestExecutionLevel user` 运行，安装到 `%LOCALAPPDATA%\Programs\Infinity.Inc\<产品>`，写 HKCU 环境变量（广播 `WM_SETTINGCHANGE`）与卸载键，并创建开始菜单快捷方式；卸载时删除这些项。
- **磁盘**：每个应用安装后约 277 MB（`<p>_cli.exe` + `<p>_shell\` 下的 Electron 运行时，75 个文件）。
- **网络**：程序启动本身不需要网络；Cloud 的云端功能与 IPM 的目录查询按功能使用 HTTPS。

## 四、安装与卸载

```powershell
# 图形安装
.\InfinityCloud_1.0.0-pre6_win64_setup.exe

# 静默安装（无需管理员）
.\InfinityCloud_1.0.0-pre6_win64_setup.exe /S

# 静默卸载
& "$env:LOCALAPPDATA\Programs\Infinity.Inc\Infinity Cloud\Uninstall.exe" /S
```

安装后从开始菜单启动；快捷方式指向 `<p>_shell\<p>_window.exe`。外壳负责拉起同目录的 `<p>_cli.exe --serve-ui --port=<port>`，**关闭窗口即结束服务进程**，不留后台残留。

首次启动会看到令牌页（见下）；填入 GitHub 个人访问令牌（需要 `repo` 权限）后窗口自动刷新进入应用，之后启动不再询问。Infinity Toolbox 不需要令牌，直接进入工具列表。

### 管理员孪生

安装包同时带管理员变体可执行文件（`inx_cli.exe` / `ipmx_cli.exe` / `intx_cli.exe`）。用 `<p>_window.exe --admin` 启动即切到管理员孪生（同一份 Electron 载荷，只换被拉起的服务进程），不需要另装一套。

## 五、令牌存放在哪里

| 项目 | 值 |
| --- | --- |
| 路径 | `%LOCALAPPDATA%\Infinity\<app>\token.bin`（`<app>` 为 `inc` / `ipm`） |
| 加密 | Windows DPAPI，当前用户作用域，`CryptProtectData` + `CRYPTPROTECT_UI_FORBIDDEN` |
| 落盘大小 | 304 字节（密文 blob） |
| 明文 | 只在进程内存，不写日志、不回显 |
| 换令牌 | 删掉该目录或该文件，下次启动重新询问 |
| 回退 | 未保存令牌时才读 `gittoken_zssx-2026_1` / `EV_GH_TOKEN` |

## 六、已知问题与限制

1. **本批只发布三个应用。** Infinity File Manager、InfinityInstallerManager、Infinity Games 本轮未随包发布，其仓库仍停留在 `v1.0.0-pre4`；六个应用的统一发行在后续版本恢复。
2. **安装包体积跃升到 80 MB 级。** 这是「自包含、不依赖系统浏览器内核」的代价；上一版 WebView2 宿主只有 452 KB，但依赖系统运行时且在 150% 缩放下界面发糊，故本版换回 Electron。
3. **只发布 win64。** 三个安装包均为单架构 win64；`ia32` / `arm64` 外壳可构建（`INC_SHELL_ARCHES`）但本版未打包。
4. **没有聚合三个包的单一 Release。** 三个应用在各自仓库分别发布，本页是汇总说明。
5. **首次启动首帧略慢。** Electron 冷启动 + 服务进程就绪 + 页面首绘，实测窗口在数秒内出现；此后启动更快。
6. **管理员孪生只能通过 `--admin` 启动。** 安装器不为管理员变体单独创建快捷方式。
7. **任何重建/重打包都会改变字节**，本页全部校验值必须重新生成。

## 七、IPM 目录与 name.txt

InfinityPackageManager 的目录页（仓库 `zssx-2026/applications`，tag `application-inc`）不按 GitHub
Release 解析版本，而是读挂在同一个 Release 上的 `name.txt`，每行一个可下载产品：

```text
<包名>_<版本>_win64_setup.exe Infinity.Inc <包名> setup Infinity.Inc win64
```

v1.0.0-pre6 发布后该文件是 **6 行 / 620 字节**（CRLF）：Cloud、PackageManager、Toolbox 为
`1.0.0-pre6`，FileManager、InstallerManager、Games 仍为 `1.0.0-pre4`。合并逻辑固化在
`work/nametxt-cross.mjs`（按六产品历史顺序合并、CRLF 行尾），因此 `cpp/tools/manifest.mjs`
重跑不会再把旧版本的三行删掉。

端到端复核：`ipm_cli.exe search Infinity` 返回 6 条，`info InfinityCloud` 与
`info InfinityToolbox` 指向 pre6 下载地址。

## 八、相关文件

- `cpp/release/v1.0pre6/release-assets.json` —— 机器可读清单（tag / version / size / sha256 / fnv1a / repo / url）
- `cpp/release/v1.0pre6/SHA256SUMS.txt` —— 三项安装包 + `name.txt` + `release-assets.json` 校验和
- `work/qa-pre6-install.ps1` —— 静默安装 → 窗口探针（DPI / 尺寸 / 标题 / 抓帧）→ 卸载 的端到端 QA
- `work/TASKS.md` —— 外壳换代、令牌界面、发布状态台账
- `work/nametxt-cross.mjs` —— 跨版本 `name.txt` 合并（六产品历史顺序、CRLF）
- `docs/ENGINEERING-RULES.md` —— 语言选择、界面原则、验收与发布纪律
