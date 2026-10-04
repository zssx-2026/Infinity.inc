# v1.0pre5 里程碑计划（草案，Lead 维护）

基线：v1.0.0-pre4 已发布（6 仓库各 1 个 NSIS 安装包，QA 8/8 PASS，sha256 三方一致）。

## 1. 窗口外壳换代（对应 task-12/task-13）
- 现状：`<p>_gui.exe` 与 `<p>_cli.exe` 是同一份二进制（程序按自身文件名判面）。INC 的 gui 面是原生 Win32 窗口（cpp/apps/inc/main.cpp:460+ GuiState/HWND）；IFM/ITB/IIM 的 gui 面只起 `--serve-ui` 的 HTTP 服务，等外部窗口接管。Electron 外壳是 268 MB/应用的目录（shell/build/<p>_gui-win32-x64），且与 cpp/out/<p>/<p>_gui.exe 同名冲突（shell/payload.mjs 已加拒绝覆盖保护）。
- 目标：用精简 Chromium 内核 + 仿 Edge UI 取代 Electron：每个应用一份定制内核（task-12），UI chrome 统一（task-13）。
- 验收：每个应用 `_gui.exe` 双击 → Edge 风格窗口 → 加载 http://127.0.0.1:<port>/（inc 7621 / ifm 7623 / ipm 7632 / iim 7643 / int 7653 / ing 7664）；单应用运行时体积目标 < 120 MB（对比 Electron 268 MB）。
- 命名：Electron 版应改名（如 `<p>_window.exe`）或彻底移除，避免与 C++ 侧同名不同物。

## 2. 安装包图标（对应 proj-inc 报告）
- 现状：v1.0pre4 载荷 0 个 .ico，setup.nsi 无 MUI_ICON/Icon/DisplayIcon；icons/ 下 6 个产品 SVG 已就绪。
- 目标：SVG → ICO（多尺寸 16/24/32/48/64/128/256）→ CMake 资源（.rc）+ NSIS MUI_ICON/UNINSTALL_ICON/DisplayIcon + 快捷方式图标。
- 验收：`7z l` 显示 .ico 在载荷中；注册表 DisplayIcon 指向安装目录图标；安装后开始菜单/桌面快捷方式显示对应产品图标。

## 3. IPM 目录扩展（对应 task-11）
- once_power 与 Piik 各自一个 applications 页（tag once-power / piik）+ zip + name.txt；dist/url.json、applist.json 同步。

## 4. ITB 工具容器（对应 task-15）
- .itbt v1（契约 work/ITBT-FORMAT.md）：C++ packer + Toolbox 容器插件加载；首批 FastBrowser.itbt 样例。

## 5. 发布纪律（已固化）
- 版本：tag `v1.0.0-preN`、目录 `cpp/release/v1.0preN`、文件名 `<package>_<version>_win64_setup.exe`。
- 发布前：`package.mjs` → `publish.mjs --dry-run`（GET-only）→ 真发 → 独立 QA（下载回验 sha256 三方一致）→ rel-catalog 刷新 applications 页 → dist 同步 → 官网卡片指向显式 tag。
- 令牌：`[Environment]::GetEnvironmentVariable("EV_GH_TOKEN","User")`；本机 pwsh 5.1，JSON 请求体需无 BOM 文件。
