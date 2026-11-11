# Infinity.Inc 1.0.0-pre7

> 本文件是仓库内的发行说明副本；GitHub Release 正文见 [docs/RELEASE-v1.0pre7-body.md](RELEASE-v1.0pre7-body.md)。

Infinity.Inc 1.0.0-pre7 —— 三个自包含 Windows 安装包，窗口外壳换成真正的 Edge 风格界面。

## 这一版变了什么

pre6 把窗口从 WebView2 换成 Electron（解决 150% 缩放下的模糊），但窗口里还只是一个浏览器框。pre7 把早已写好、一直没接线的 Edge 风格外壳接进了 Electron 窗口：

- **标签页条**：新建、关闭、切换、拖拽排序；FLIP 归位动画与滑动高亮条；新标签页淡入。
- **垂直标签页列表**：侧栏里列出全部标签（含数量徽标），与标签条同步。
- **地址栏**：前进、后退、刷新、主页，输入 127.0.0.1 地址或本地路径直接跳转。
- **应用侧栏**：一键切到 Infinity Cloud / Infinity Toolbox / InfinityPackageManager。
- **收藏夹、游玩区、设置面板**：收藏夹持久化；游玩区支持配色、主题与背景音乐（单实例）；设置面板可开关会话恢复。
- **会话跨重启恢复**：打开的标签、主题、游玩区状态会留下来（实测第二次启动 `hasSession=true`）。
- **窗口命令走真桥**：页面按钮经 preload 桥发给主进程，最小化 / 最大化 / 还原 / 关闭 / 新开窗口全部真生效（探针实测 minimize→minimized=true、maximize→maximized=true、new→窗口数 2）。

## 稳定 origin（会话能恢复的前提）

外壳页面以前由随机端口的 HTTP 服务提供，每次启动 origin 都变，localStorage 全丢。现在改用注册的私有 scheme：

    infinity-shell://ui/index.html?render=iframe&url=<产品地址>

外壳资源由 `protocol.handle` 从 `resources/app/ui` 读取，路径穿越返回 403，响应 `cache-control: no-store`；导航白名单只允许该 origin 与 `http://127.0.0.1:<port>/`。

## 下载

| 产品 | 文件 | 字节 | SHA-256 |
| --- | --- | --- | --- |
| Infinity Cloud | InfinityCloud_1.0.0-pre7_win64_setup.exe | 84,170,280 | `1c662e194b7899b36dc54a72fd4643bbf8a2315159f4912bbe3c0f2aa41deee0` |
| InfinityPackageManager | InfinityPackageManager_1.0.0-pre7_win64_setup.exe | 83,968,776 | `7056239209dfe2912949ae67f8d5e1b20844f9bedfe8ecbb57ee9d0e37e4d59c` |
| Infinity Toolbox | InfinityToolbox_1.0.0-pre7_win64_setup.exe | 84,025,408 | `52f3b731d015fe22818abc97b43554181d5710af70c0adc115f1a98572b645f5` |

三个包合计 252,164,464 B，均用 CN=Infinity.Inc（指纹 `3C626CCE1DFA8833F844BA176DB1922B7B4069C2`，2027-11-01 到期）签名，时间戳 http://timestamp.digicert.com。

校验：

    Get-FileHash .\InfinityCloud_1.0.0-pre7_win64_setup.exe -Algorithm SHA256

## 系统要求

- Windows 10/11 x64。不需要 WebView2 Runtime，不需要 Node.js —— Electron 运行时随包。
- 每个应用安装后约 279 MB（96 个文件），安装包 80 MB 级（NSIS solid LZMA）。

## 安装与卸载

- 图形安装：双击对应 setup，默认装到 `%LOCALAPPDATA%\Programs\Infinity.Inc\<产品>\`，不需要管理员权限。
- 静默安装：`InfinityCloud_1.0.0-pre7_win64_setup.exe /S`；卸载 `Uninstall.exe /S`。
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

窗口里只放产品本身：没有提示词、没有功能清单、没有版本亮点。首启页、错误页、空状态都压到最小（一个输入框、一个按钮、一行说明）。

## 七、IPM 目录与 name.txt

IPM 目录页读取 `zssx-2026/applications` 仓库 `application-inc` 标签上的 `name.txt`，每行格式：

    <包名>_<版本>_win64_setup.exe Infinity.Inc <包名> setup Infinity.Inc win64

pre7 之后该文件是跨版本六行（Cloud / PackageManager / Toolbox 为 1.0.0-pre7，FileManager / InstallerManager / Games 沿用 1.0.0-pre4），620 B、CRLF 行尾，SHA-256 `5b54247f071145a0436377a72d2953fddffd14dee953d61ec79bf445380bde05`。合并逻辑固化在 `work/nametxt-cross.mjs`（当前版本行优先，缺失的用 pre4 行补齐）：

    node work/nametxt-cross.mjs cpp/release/v1.0pre7 1.0.0-pre4

目录页刷新用 `work/catalog-pre7.mjs`（上传三个 pre7 安装包、删三个 pre6 安装包、name.txt 先删后传，上传后校验尺寸）。端到端复核：

    cpp/out/ipm/ipm_cli.exe search Infinity   # 应返回六条，inc/ipm/int 指向 pre7

## 八、相关文件

- [docs/RELEASE-v1.0pre7-body.md](RELEASE-v1.0pre7-body.md) —— GitHub Release 正文原文
- [docs/ENGINEERING-RULES.md](ENGINEERING-RULES.md) —— 语言选择、界面原则、验收与发布纪律
- `shell/main.js` —— Electron 外壳主进程：起 `<prefix>_cli.exe --serve-ui`、注册 `infinity-shell://`、窗口命令桥、会话落盘
- `shell/preload.js` —— 唯一桥：`__INFINITY_HOST__.postMessage` → ipc → 主进程
- `shell/verify-contract.mjs` —— 外壳契约自检（当前 35 条断言全绿）
- `work/shell-probe.ps1` —— 窗口探针：dpr / origin / tabCount / frameSrc / 窗口命令 / 截图
- `work/qa-pre7-install.ps1` —— 静默安装 + 窗口探针 + 卸载清理，成功打印 `PRE7-INSTALL-QA PASS 3/3`
- `work/package-pre7.ps1` —— 打包 + Authenticode 签名（含重试）
- `work/catalog-pre7.mjs`、`work/nametxt-cross.mjs` —— 目录页刷新与跨版本清单合并
