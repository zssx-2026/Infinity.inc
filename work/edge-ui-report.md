# Edge UI 外壳实现报告

- 目标：为精简 Chromium 内核提供一套模仿 Microsoft Edge 的窗口 UI 外壳，承载 Infinity 套件应用页面（INC / ITB / IIM / IFM）。
- 范围：仅 `work/edge-ui/` 与 `work/edge-ui-report.md`，未改动 `web/`、`cpp/`、`shell/`、`work/chromium-trim/`。
- 形态：纯静态、无构建、无外部 CDN/网络资源；classic script（非 ES module），保证 `file://` 直接可跑。

## 1. 交付物

| 文件 | 字节 | 说明 |
| --- | --- | --- |
| `work/edge-ui/index.html` | 17094 | 外壳主页面（标签栏、导航行、侧栏、菜单、设置/关于、协议检查器） |
| `work/edge-ui/assets/css/shell.css` | 33361 | 深色（默认）/浅色主题、亚克力近似、Fluent 圆角与动效 |
| `work/edge-ui/assets/js/shell.js` | 71852 | 外壳逻辑 + 宿主桥 + 演示宿主 |
| `work/edge-ui/assets/js/i18n.js` | 11635 | zh-CN（默认）/ en-US 文案（约 90 键） |
| `work/edge-ui/assets/js/icons.js` | 6380 | 内联 SVG 图标集（36 个，无字体/无图片依赖） |
| `work/edge-ui/assets/css/apps.css` | 6217 | 演示应用页样式 |
| `work/edge-ui/apps/{cloud,toolbox,installer,files}/index.html` | 3624 / 3573 / 3151 / 3114 | 四个套件应用的演示页（iframe 内容） |
| `work/edge-ui/mock-host.html` | 2947 | 参考宿主：演示 postMessage 双向协议 |
| `work/edge-ui/README.md` | 9141 | 宿主接口约定（协议、WebView2/CEF 接法、URL/title 注入） |

## 2. 截图（无头 Edge 验证，均 > 20 KB）

| 文件 | 字节 | 参数 | 内容 |
| --- | --- | --- | --- |
| `work/edge-ui/shot-dark.png` | **139641** | `?theme=dark&tabs=3` | 深色 + 开始页 + 3 标签（活动标签高亮） |
| `work/edge-ui/shot-light.png` | **135951** | `?theme=light&tabs=3` | 浅色主题同一布局 |
| `work/edge-ui/shot-app-cloud.png` | 115317 | `?theme=dark&app=cloud&tabs=3` | `inc://cloud` 应用页在内容区通过 iframe 渲染 |
| `work/edge-ui/shot-devtools.png` | 185346 | `?theme=dark&tabs=3&devtools=1` | 协议检查器（shell.* / host.* 报文日志） |

采集命令（与任务给定一致，逐张单独进程执行）：

```powershell
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu `
  --window-size=1280,800 --virtual-time-budget=5000 `
  --screenshot=work\edge-ui\shot-dark.png `
  "file:///<repo>/work/edge-ui/index.html?theme=dark&tabs=3"
```

**非空白核验**：除文件大小外，用 `System.Drawing` 采样像素统计——
深色图平均 RGB ≈ (35,39,46)、浅色图 ≈ (244,245,247)，两图均检出品牌色像素（蓝/紫/琥珀）与 49+ 个内联 SVG 描边，
说明 Chrome 层、侧栏、开始页卡片均已实际绘制，不是空屏。

## 3. 实现要点

### 3.1 视觉（Edge 近似）
- **标签栏**：圆角（9px）标签、活动标签用与工具栏同色的“连通”底色 + 顶部 2px 强调线、悬停显示关闭按钮、溢出省略、中键关闭、`+` 新建。
- **导航行**：后退/前进/刷新/主页/侧栏/集锦/扩展/头像/菜单，按钮 34px、圆角 8px，禁用态降透明度。
- **地址栏**：胶囊字段（悬停/聚焦变色 + 聚焦描边），左侧安全/搜索/地球图标随标签类型切换，`https://` 以灰字前缀显示（模仿 Edge 隐藏 scheme），右侧翻译与收藏（收藏态实心星）。
- **侧栏**：可折叠（`Ctrl+Shift+E`），含搜索框、四个应用快捷入口、**垂直标签页**列表（含活动态高亮与计数）。
- **Fluent 观感**：圆角卡片（8/12/16px）、分层 `--surface-1..3`、1px 细边框、悬停浮起、`cubic-bezier(.2,.9,.3,1)` 动效。
- **亚克力/Mica 近似**：固定壁纸层（渐变 + 3 个模糊色斑）→ `.app` 半透明 + `backdrop-filter: blur(34px) saturate(150%)`；侧栏/菜单/对话框各自再次模糊；设置项可关闭该效果。
- **主题**：`html[data-theme]` + CSS 变量；深色为默认，浅色/跟随系统可在菜单与设置中切换（首帧前内联脚本应用，避免闪烁）。
- **字体栈**：`"Segoe UI Variable Text/Display","Segoe UI","Noto Sans SC","Microsoft YaHei UI",system-ui`。
- **中文优先**：`data-i18n / data-i18n-title / data-i18n-placeholder` 全量覆盖，默认 zh-CN，菜单与设置可切 en-US，日期用 `Intl.DateTimeFormat` 本地化。
- **自绘窗口按钮**：最小化/最大化/关闭（关闭悬停变红），`?frame=0` 或宿主 `host.config{frame:false}` 隐藏。

### 3.2 行为
- 标签：新建（`+`/Ctrl+T）、关闭（×、中键、Ctrl+W）、切换（点击、Ctrl+Tab、Ctrl+1..9、垂直标签页）；每标签独立浏览历史，前进/后退按钮按历史索引启用。
- 地址栏：回车导航；`inc://` → 套件应用；含 scheme → 原样；`a.b` → 补 `https://`；其它 → 交给宿主搜索；`Alt+Enter` 新标签打开。
- 菜单：新建标签/窗口、历史、收藏夹、下载、集锦、打印、开发者工具、协议消息、主题分段、语言分段、设置、关于；点击外部或 Esc 关闭。
- 设置对话框：主题（深/浅/跟随系统）、亚克力开关、默认侧栏、主页地址、界面语言、宿主模式与宿主 API 只读展示、恢复默认。
- 协议检查器：`协议消息`（`→ host` / `← shell` 双色报文日志，可复制/清空/模拟宿主响应）与 `宿主信息`（host、api、content-rect、UA 等）。
- 收藏：开始页收藏胶囊 + 地址栏星标切换，写入 `localStorage`。
- 演示宿主：内置 demo host 会真实回包（`host.info` / `host.ack` / `host.tab-update`），因此无宿主时外壳仍完整可用。

### 3.3 宿主桥
检测顺序：`window.__INFINITY_HOST__` → `window.chrome.webview` → `?host=1` 时的 `window.parent.postMessage` → 演示模式。
报文信封 `{channel, v, dir, type, payload, ts, id}`，两侧都忽略与自己同向的 `dir`，杜绝回声。
内容承载两种形态：`render:"iframe"`（外壳内嵌页面）与 `render:"native"`（外壳只画 UI，按 `shell.content-rect` 交宿主合成）。
详细接口见 `work/edge-ui/README.md`。

## 4. 接口清单（速查）

**外壳 → 宿主（`dir:"to-host"`）**：`shell.ready`、`shell.open`、`shell.navigate`、`shell.activate-tab`、`shell.close-tab`、`shell.back`、`shell.forward`、`shell.reload`、`shell.favorite`、`shell.search`、`shell.window`、`shell.command`、`shell.devtools`、`shell.theme`、`shell.locale`、`shell.content-rect`

**宿主 → 外壳（`dir:"to-shell"`）**：`host.info`、`host.tab`、`host.tab-update`、`host.activate-tab`、`host.close-tab`、`host.navigate`、`host.favorite-list`、`host.theme`、`host.locale`、`host.config`、`host.command-result`、`host.ack`

**文档内调试 API**：`window.__InfinityShell.{open,navigate,close,setTheme,setLocale,toast,send,emit,log,state,settings}`

## 5. 验证记录

无头 Edge（Edg/154.0.4258.53）经 CDP `Runtime.evaluate` 实测（探针返回原文）：

| 检查 | 结果 |
| --- | --- |
| 启动无异常 | `data-boot-error=null`、`data-js-error=null`、`title="Infinity Edge Shell"` |
| 开始页渲染 | `appCards=4`、`favChips=4`、`svgs=49`、问候语随时段（下午好） |
| 标签系统 | `tabs=3`、`activeTabs=1`、点击关闭 3→2、末标签点击后仍只有 1 个活动标签 |
| 侧栏 | `sbApps=4`、垂直标签 `sbTabs=3`、折叠/展开两次状态正确 |
| 协议往返 | 日志含 `shell.ready → host.info`、`shell.activate-tab → host.ack` |
| 宿主注入 | `host.tab-update` 后活动标签标题变为 `HOST-INJECTED`、地址栏显示该 URL、kind=web |
| 主题/语言 | `setLocale('en-US')` 得 `New tab`，切回得 `新建标签页`；`setTheme('light')` 生效并可切回 |
| 应用内嵌 | iframe 帧树子帧 = `apps/cloud/index.html?embed=1&theme=dark&locale=zh-CN`；开启 `--allow-file-access-from-files` 后可读其 `document.title="Infinity 云 · INC"`、`body.class="app-page"`、6 个卡片节点 |
| 地址栏回车 | 输入 `inc://toolbox` 后 iframe src 变为 `apps/toolbox/index.html...` |
| 宿主模式 | `?host=1` 与演示模式内容区像素差 7.6%（meanAbsDiff 37.64）；`?host=1&render=iframe` 与演示模式**逐像素一致（0 差异）**，证明宿主模式与承载开关均按预期生效 |

## 6. 未完成项与已知限制

1. **自绘窗口按钮只发协议**：`shell.window {action}` 已发出，真正的最小化/最大化/关闭需宿主实现（无头环境无法验证）。
2. **亚克力为近似**：`backdrop-filter` 非系统 Mica；`--disable-gpu` 下为软件模糊，观感与真机 GPU 合成略有差异，未接入 Windows DWM 材质。
3. **开发者工具为自研协议面板**：不是 Chromium DevTools；已通过 `shell.devtools` 预留交给宿主接真 DevTools 的入口。
4. **演示模式的外部网络页**：受离线/跨域限制，仅本地应用页保证可加载；截图与自检均基于本地页面（符合“不引用网络资源”约束）。
5. **未实现（本次范围外）**：标签拖拽排序/拖出成新窗口、标签组与工作区、真正的下载/历史/扩展页面、收藏夹多级目录、页面缩放与查找栏、PDF/阅读模式、垂直标签页的拖拽与置顶。
6. **CEF/WebView2 宿主未随附**：仅提供 `mock-host.html` 参考实现与 README 接入步骤（本任务写入范围不含 `cpp/`/`shell/`）。
7. **截图时序说明**：截图在最终 UI 定稿后采集，其后仅追加了一行 `console.log` 启动诊断（`[InfinityEdgeShell] host=... render=...`），不影响画面。
