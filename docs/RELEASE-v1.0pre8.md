# Infinity.Inc 1.0.0-pre8

> 本文件是仓库内的发行说明副本；GitHub Release 正文见 [docs/RELEASE-v1.0pre8-body.md](RELEASE-v1.0pre8-body.md)。

Infinity.Inc 1.0.0-pre8 —— 三个自包含 Windows 安装包；这一版只做两件事：彻底安静，和把外壳打磨到不打扰人。

## 这一版变了什么

pre7 把 Edge 风格外壳接进了 Electron 窗口。pre8 按「安静运行」的两条硬规则收口：

- **不再有任何声音**：游玩区里原来的背景音乐整块删除（选曲、播放、音量、`<audio>` 元素全部移除），游玩区只保留配色与主题。外壳不再构造 `Audio` 对象、不打开 `AudioContext`、不调用 `play()`，页面加载与切换都不会发声。
- **不再弹控制台窗口**：界面服务以隐藏窗口方式启动（`spawn(..., { windowsHide: true })`），快捷方式指向 GUI 可执行文件而不是 `_cli.exe`；安装、卸载、静默运行全程不出黑框。
- **规则写进工程文档**：`docs/ENGINEERING-RULES.md` 新增「安静运行」一节，并进英文摘要（`Quiet by default`）。验收侧同步加断言：契约自检 42 项（含 7 项安静性检查），窗口探针回报 `audioElements === 0`。

窗口能力与 pre7 一致，没有回退：标签页条（新建/关闭/切换/拖拽排序 + FLIP 归位动画）、垂直标签页、地址栏、应用侧栏、收藏夹、游玩区（配色/主题）、设置面板、会话跨重启恢复、窗口命令真桥（最小化/最大化/还原/关闭/新开窗口）。

## 稳定 origin（会话能恢复的前提）

外壳页面由注册的私有 scheme 提供，不再依赖随机端口：

    infinity-shell://ui/index.html?render=iframe&url=<产品地址>

外壳资源由 `protocol.handle` 从 `resources/app/ui` 读取，路径穿越返回 403，响应 `cache-control: no-store`；导航白名单只允许该 origin 与 `http://127.0.0.1:<port>/`。

## 下载

| 产品 | 文件 | 字节 | SHA-256 |
| --- | --- | --- | --- |
| Infinity Cloud | InfinityCloud_1.0.0-pre8_win64_setup.exe | 84,199,920 | `2cc53ef876e7651fc4c34bcef8691ea4bd8ed465203b11a6b8f6a28e1e4e0b3f` |
| InfinityPackageManager | InfinityPackageManager_1.0.0-pre8_win64_setup.exe | 83,959,040 | `cf06418719ca1351434f530c8d9121a776f375c7f8c61a8e35ad374469eaddfd` |
| Infinity Toolbox | InfinityToolbox_1.0.0-pre8_win64_setup.exe | 83,992,376 | `6950fc9e283080da390bed0ef2703a84f3e916cb3e17017d9bb8abe1daa217d7` |

三个包合计 252,151,336 B，均用 CN=Infinity.Inc（指纹 `3C626CCE1DFA8833F844BA176DB1922B7B4069C2`，2027-11-01 到期）签名，时间戳 http://timestamp.digicert.com。

校验：

    Get-FileHash .\InfinityCloud_1.0.0-pre8_win64_setup.exe -Algorithm SHA256

## 系统要求

- Windows 10/11 x64。不需要 WebView2 Runtime，不需要 Node.js —— Electron 运行时随包。
- 每个应用安装后约 279 MB（96 个文件），安装包 80 MB 级（NSIS solid LZMA）。

## 安装与卸载

- 图形安装：双击对应 setup，默认装到 `%LOCALAPPDATA%\Programs\Infinity.Inc\<产品>\`，不需要管理员权限。
- 静默安装：`InfinityCloud_1.0.0-pre8_win64_setup.exe /S`；卸载 `Uninstall.exe /S`。
- 每个产品目录里有两件东西：`<prefix>_cli.exe`（C++ 服务与命令行）与 `<prefix>_shell\<prefix>_window.exe`（Electron 外壳，内含 `resources/app/ui` 界面资源）。
- 管理员孪生：`<prefix>_window.exe --admin` 会以 `<prefix>x` 身份启动（安装包同时带 inx_cli / ipmx_cli / intx_cli）。

## 首次启动的令牌

首次打开窗口会直接弹出令牌页：粘贴一个有 `repo` 权限的 GitHub 个人访问令牌，点继续即可。令牌用 DPAPI 加密保存在 `%LOCALAPPDATA%\Infinity\<app>\token.bin`（约 304 B 密文，隐藏属性），明文只存在于进程内存，下次启动不再询问。环境变量 `gittoken_zssx-2026_1` 或 `EV_GH_TOKEN` 只是回退。未登录时所有 `/api/*` 统一返回 401。

## 已知问题

- **地址栏搜索还是占位**：输入非地址文本会开一个搜索标签页并显示「演示模式不联网」的说明，查询经 `shell.search` 交给宿主，宿主目前只回执、没有接搜索引擎。请不要把它当搜索功能。
- 只发布 Cloud / PackageManager / Toolbox 三个应用；FileManager / InstallerManager / Games 停在 1.0.0-pre4，没有源码可重建。
- 只有 win64 安装包；没有聚合 release，三个仓库各自一个。
- 管理员孪生没有独立快捷方式，需要手动加 `--admin`。
- 首帧略慢：外壳要先起本地服务再等窗口就绪，冷启动约 1-3 秒。
- 任何一次重新构建都会改变字节与 SHA-256，请以本页数值为准。

## 界面原则

窗口里只放产品本身：没有提示词、没有功能清单、没有版本亮点。首启页、错误页、空状态都压到最小（一个输入框、一个按钮、一行说明）。不弹控制台、不播放声音。

## 七、IPM 目录与 name.txt

IPM 目录页读取 `zssx-2026/applications` 仓库 `application-inc` 标签上的 `name.txt`，每行格式：

    <包名>_<版本>_win64_setup.exe Infinity.Inc <包名> setup Infinity.Inc win64

pre8 之后该文件是跨版本六行（Cloud / PackageManager / Toolbox 为 1.0.0-pre8，FileManager / InstallerManager / Games 沿用 1.0.0-pre4）。合并逻辑固化在 `work/nametxt-cross.mjs`（当前版本行优先，缺失的用 pre4 行补齐）：

    node work/nametxt-cross.mjs cpp/release/v1.0pre8 1.0.0-pre4

目录页刷新用 `work/catalog-pre8.mjs`（上传三个 pre8 安装包、删三个 pre7 安装包、name.txt 先删后传，上传后校验尺寸）。端到端复核：

    cpp/out/ipm/ipm_cli.exe search Infinity   # 应返回六条，inc/ipm/int 指向 pre8

## 八、相关文件

- [docs/RELEASE-v1.0pre8-body.md](RELEASE-v1.0pre8-body.md) —— GitHub Release 正文原文
- [docs/ENGINEERING-RULES.md](ENGINEERING-RULES.md) —— 语言选择、界面原则、安静运行、验收与发布纪律
- `shell/main.js` —— Electron 外壳主进程：起 `<prefix>_cli.exe --serve-ui`（隐藏窗口）、注册 `infinity-shell://`、窗口命令桥、会话落盘
- `shell/preload.js` —— 唯一桥：`__INFINITY_HOST__.postMessage` → ipc → 主进程
- `shell/verify-contract.mjs` —— 外壳契约自检（当前 42 条断言全绿，含 7 条安静性检查）
- `work/shell-probe.ps1` —— 窗口探针：dpr / origin / tabCount / frameSrc / audioElements / 窗口命令 / 截图
- `work/qa-pre8-install.ps1` —— 静默安装 + 窗口探针 + 卸载清理，成功打印 `PRE8-INSTALL-QA PASS 3/3`
- `work/package-pre8.ps1` —— 打包 + Authenticode 签名（含重试）
- `work/catalog-pre8.mjs`、`work/nametxt-cross.mjs` —— 目录页刷新与跨版本清单合并
