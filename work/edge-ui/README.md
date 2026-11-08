# Infinity Edge Shell

模仿 Microsoft Edge 的窗口 UI 外壳，用于在精简 Chromium（Chromium Trim）内核中承载 Infinity 套件应用页面：

| 代号 | 应用 | 演示地址 |
| --- | --- | --- |
| INC | Infinity Cloud | `inc://cloud` |
| ITB | Infinity Toolbox | `inc://toolbox` |
| IIM | Infinity Installer Manager | `inc://installer` |
| IFM | Infinity File Manager | `inc://files` |

无构建步骤、无外部 CDN、无网络依赖：全部为本地 HTML/CSS/JS（classic script，可 `file://` 直接打开）。

## 目录

```
work/edge-ui/
  index.html                 外壳主页面（标签栏 / 导航行 / 侧栏 / 菜单 / 设置 / 协议检查器 / 游玩区）
  newtab.html                独立本地新标签页（无固定主页；宿主可把 infinity://newtab 指向它）
  mock-host.html             参考宿主：用 postMessage 与外壳对话
  report.md                  实现报告：标签动画清单、localStorage schema、截图清单、未完成项
  tools/                     证据脚本（anim-probe / verify / layout-check，CDP 驱动）
  anim-probe.json            ?anim-demo=1 各动画冻结帧的实测状态（含选择器时长/缓动）
  assets/css/shell.css       外壳样式（深色默认 / 浅色主题、亚克力近似）
  assets/css/apps.css        演示应用页样式
  assets/js/icons.js         内联 SVG 图标集
  assets/js/i18n.js          zh-CN（默认）/ en-US 文案
  assets/js/shell.js         外壳逻辑 + 宿主桥
  apps/cloud|toolbox|installer|files/index.html   演示应用页（iframe 内容）
  shot-dark.png shot-light.png shot-app-cloud.png shot-devtools.png   基础截图
  shot-anim-newtab|close|switch|drag.png                             标签动画证据帧（1280x800）
  shot-playzone-dark|light.png  shot-newtab-page.png                游玩区与新标签页截图
```

## 运行

```powershell
# 直接打开（演示宿主模式）
start work\edge-ui\index.html

# 参考宿主（外壳嵌在宿主页 iframe 中，走 postMessage 协议）
start work\edge-ui\mock-host.html

# 无头截图（深色 / 浅色）
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu ^
  --window-size=1280,800 --virtual-time-budget=5000 ^
  --screenshot=work\edge-ui\shot-dark.png ^
  "file:///<repo>/work/edge-ui/index.html?theme=dark&tabs=3"
```

### 启动参数

| 参数 | 说明 |
| --- | --- |
| `?theme=dark\|light` | 强制主题（等价于设置项） |
| `?locale=zh-CN\|en-US` | 强制界面语言 |
| `?host=1`（或 `cef` / `host`） | 强制宿主模式：不渲染 iframe，等待宿主提供内容 |
| `?render=iframe\|native` | 覆盖内容承载方式（宿主模式下也可强制用 iframe 调试） |
| `?frame=0` | 隐藏自绘的最小化/最大化/关闭按钮（宿主已有原生标题栏时使用） |
| `?app=cloud\|toolbox\|installer\|files` | 启动时直接打开某个应用 |
| `?url=<地址>` | 启动时打开任意地址 |
| `?tabs=N` | 启动时预开 N 个标签（用应用页填充，便于截图/联调） |
| `?devtools=1` | 启动时打开协议检查器 |
| `?anim-demo=1` | 自动循环演示新建/关闭/切换/拖拽排序动画，循环切换阶段并显示 HUD |
| `?anim-demo=1&freeze=1&phase=newtab|close|switch|drag&at=MS` | 把指定动画冻结在 MS 毫秒处（WAAPI 暂停），用于截图取证 |
| `?playzone=1` | 启动即打开游玩区（宿主联调/截图） |
| `?music=<url>` | 为当前游玩区注入背景音乐（本地 file:// 或宿主提供的地址） |

## 宿主接口约定

### 1. 宿主检测顺序

外壳在启动时按以下顺序选择通信通道（`shell.js → detectHost()`），并把结果放在
`document.documentElement.dataset.host` / 设置页“宿主”一节：

1. `window.__INFINITY_HOST__.postMessage(frame)` — 自定义桥（CEF 注入、原生 WebView 包装）
2. `window.chrome.webview.postMessage(frame)` — **WebView2** 标准通道
3. `window.parent.postMessage(frame, "*")` — 宿主把外壳放在 `<iframe>` 中（`?host=1`）
4. 以上都不存在 → **演示模式**：内置 demo 宿主 + `<iframe>` 直接加载应用页

需要强制某种模式时用 `?host=1`（外部宿主）或 `?host=demo`（演示）。

### 2. 报文信封

所有报文都是可 JSON 序列化的对象，双向同构：

```js
{
  channel: "infinity-shell",   // 固定通道名，用于过滤
  v: 1,                        // 协议版本（PROTOCOL = "infinity-shell/1"）
  dir: "to-host" | "to-shell", // 方向；两侧都必须忽略与自身相同的 dir，避免回声
  type: "shell.open",          // 事件名
  payload: { },                // 事件负载
  ts: 1730000000000,           // 时间戳
  id: "sh-3f2a1b"              // 报文 id（宿主可用 host.ack 回执）
}
```

- **外壳 → 宿主**：`dir: "to-host"`，由外壳主动发出。
- **宿主 → 外壳**：`dir: "to-shell"`，宿主调用同一通道回发。
- 宿主可用的三种投递方式（任选）：
  - `webview.postMessage(obj)`（WebView2，对象会被序列化）
  - `shellFrame.contentWindow.postMessage(obj, "*")`（iframe 宿主，见 `mock-host.html`）
  - 派发 DOM 事件 `document.dispatchEvent(new CustomEvent("infinity-shell-host", { detail: obj }))`

### 3. 外壳 → 宿主（命令）

| type | payload | 含义 |
| --- | --- | --- |
| `shell.ready` | `{version, protocol, locale, theme, host, ua}` | 外壳就绪，宿主可在此后下发 `host.info`/`host.config` |
| `shell.open` | `{tabId, url, kind, title, disposition:"newTab"}` | 在新标签打开（来自“+”、Ctrl+T、Alt+Enter、中键） |
| `shell.navigate` | `{tabId, url, kind, title, disposition:"current"}` | 当前标签导航（地址栏回车、应用卡片） |
| `shell.activate-tab` | `{tabId, url}` | 切换活动标签 |
| `shell.close-tab` | `{tabId}` | 关闭标签 |
| `shell.back` / `shell.forward` / `shell.reload` | `{tabId, url}` | 历史/刷新 |
| `shell.favorite` | `{url, active}` | 收藏状态变更 |
| `shell.search` | `{query}` | 地址栏输入的不是 URL（搜索由宿主提供） |
| `shell.window` | `{action:"minimize"\|"maximize"\|"close"\|"new"}` | 窗口控制（自绘按钮 / Ctrl+N） |
| `shell.command` | `{name:"history"\|"downloads"\|"extensions"\|"collections"\|"print"\|"profile"\|"translate"}` | 宿主原生功能，演示宿主会回 `host.command-result` |
| `shell.devtools` | `{open, tab}` | 打开/关闭开发者工具（宿主可接入自己的 DevTools） |
| `shell.theme` | `{theme:"dark"\|"light", mode:"dark"\|"light"\|"system"}` | 主题变更 |
| `shell.locale` | `{locale:"zh-CN"\|"en-US"}` | 语言变更 |
| `shell.content-rect` | `{x, y, width, height}` | 内容区在窗口中的矩形（窗口尺寸变化时重发；原生宿主用它摆放 WebView） |
| `shell.home` | `{tabId, url}` | 点击 Home（目标为 `settings.home`，默认 `about:home` 新标签页） |
| **`shell.session-save`** | `{reason, windowId, savedAt, activeTabId, home, tabs:[{id,url,title,kind,appId,frameUrl}]}` | **退出前持久化会话**（beforeunload / pagehide / visibilitychange(hidden) / “保存并关闭”），宿主应落盘 |
| `shell.session-restored` | `{windowId, savedAt, activeTabId, tabs:[{url,title}]}` | 外壳已按会话恢复（只渲染活动标签，其余惰性） |

### 4. 宿主 → 外壳（状态注入）

| type | payload | 含义 |
| --- | --- | --- |
| `host.info` | `{host, engine, runtime, protocol, shell, ua}` | 宿主自述，显示在协议检查器/设置页 |
| `host.tab` | `{url, title, activate, tabId?}` | 让外壳新建标签（宿主主导的标签） |
| `host.tab-update` | `{tabId, url, title, kind, frameUrl, loading}` | **URL/title 注入**：更新标签标题、地址栏、图标、加载态 |
| `host.activate-tab` / `host.close-tab` | `{tabId}` | 宿主驱动标签状态 |
| `host.navigate` | `{url, push?}` | 宿主发起导航 |
| `host.favorite-list` | `{favorites:[{label,url,code,color}]}` | 用宿主的收藏夹覆盖开始页 |
| `host.theme` / `host.locale` | `{mode}` / `{locale}` | 宿主下发主题/语言 |
| `host.config` | `{themeMode, locale, sidebar, acrylic, home, frame, render}` | 一次性配置；`render:"iframe"` 让外壳自己渲染内容页，`render:"native"` 则显示“等待宿主合成”的占位卡片 |
| `host.command-result` | `{name, ok, reason}` | 对 `shell.command` 的回复（演示宿主用） |
| `host.ack` | `{of, id}` | 通用回执 |
| **`host.session-restore`** | `{tabs:[{url,title,kind}], activeTabId}` | 宿主在 `shell.ready` 后主动下发上次会话，优先于 localStorage |
| **`host.playzone`** | `{action:"open"\|"close", music:{src,name}}` | 控制游玩区开关 / 注入背景音乐 |

### 5. URL / 标题注入示例

```js
// 宿主把真实 WebView 的标题与地址回灌给外壳
function postToShell(frame) {
  shellEl.contentWindow.postMessage(
    { channel: "infinity-shell", v: 1, dir: "to-shell", ...frame }, "*");
}

postToShell({ type: "host.info", payload: { host: "webview2", engine: "Chromium 132", protocol: "infinity-shell/1" } });
postToShell({ type: "host.config", payload: { themeMode: "dark", locale: "zh-CN", render: "native" } });

// 打开新标签时（回应 shell.open）
postToShell({ type: "host.tab-update", payload: { tabId: "tab-3", url: "inc://cloud", title: "Infinity 云", kind: "app", loading: true } });
postToShell({ type: "host.tab-update", payload: { tabId: "tab-3", loading: false } });
```

外壳还暴露了可直接调用的调试 API（仅在同一文档内，供宿主 preload 使用）：

```js
window.__InfinityShell.open("inc://files", "newTab"); // 新建标签打开
window.__InfinityShell.navigate("https://example.com"); // 当前标签导航
window.__InfinityShell.close();                       // 关闭当前标签
window.__InfinityShell.setTheme("light");             // "dark" | "light" | "system"
window.__InfinityShell.setLocale("en-US");            // "zh-CN" | "en-US"
window.__InfinityShell.log();                         // 协议报文数组
window.__InfinityShell.state;                         // 完整状态（tabs / activeTab / renderIframe）
```

### 6. 内容承载的两种形态

- **`render: "iframe"`（演示/调试）**：外壳自己用 `<iframe>` 加载页面，应用页地址形如
  `apps/cloud/index.html?embed=1&theme=dark&locale=zh-CN`。
- **`render: "native"`（推荐用于精简 Chromium）**：外壳只画窗口 UI，内容区留空并周期性上报
  `shell.content-rect`；宿主把原生视图（CEF Browser / WebView2 Controller）摆到该矩形上。
  `?host=1` 默认进入该形态。

### 7. 替换为 CEF 或 WebView2 宿主

**WebView2（推荐）**

1. `CoreWebView2` 导航到 `index.html?host=1`（或 `file:///.../index.html` + `--allow-file-access-from-files`）。
2. 注入宿主信息：`webView.CoreWebView2.PostWebMessageAsJson(json)`，JSON 内容为第 4 节报文；外壳通过
   `window.chrome.webview.postMessage` 回发，宿主在 `WebMessageReceived` 中解析 `channel === "infinity-shell"`。
3. 用 `WebMessageReceived` 里收到的 `shell.content-rect` 摆放第二个 WebView（或 `WebView2CompositionControl`）承载页面，
   标签切换时只换承载视图，窗口 UI 保持在外壳里。
4. 标题/URL 变化时回发 `host.tab-update`。
5. 窗口控制：拦截 `shell.window`，调用 `AppWindowPresenter` / `OverlappedPresenter.Minimize()/Maximize()`；
   或直接使用系统标题栏并传 `?frame=0`。

**CEF**

1. 在 `OnContextCreated` 里注入桥：
   ```cpp
   // window.__INFINITY_HOST__ = { postMessage: (frame) => nativeBridge(frame) }
   CefRefPtr<CefV8Value> host = CefV8Value::CreateObject(nullptr, nullptr);
   host->SetValue("postMessage", CefV8Value::CreateFunction("postMessage", handler), V8_PROPERTY_ATTRIBUTE_NONE);
   frame->GetContext()->GetGlobal()->SetValue("__INFINITY_HOST__", host, V8_PROPERTY_ATTRIBUTE_NONE);
   ```
   外壳检测到该对象后自动使用它（`host.api = window.__INFINITY_HOST__.postMessage`）。
2. 反向投递：`frame->ExecuteJavaScript("window.postMessage(<json>, '*')", ...)`，
   或派发 `new CustomEvent("infinity-shell-host", { detail: <obj> })`。
3. 页面承载：外壳用 `?host=1`，宿主为每个标签创建 `CefBrowser`，按 `shell.content-rect` 调整
   `SetWindowPos` / OSR 视口；在 `OnTitleChange` / `OnLoadEnd` / `OnAddressChange` 中回发 `host.tab-update`。
4. 若要保留内嵌页面（例如宿主只在窗口外框做文章），传 `render:"iframe"`。

**协议实现清单（宿主最少要实现）**：`host.info`、`host.config`、`host.tab-update`；
接收 `shell.ready`、`shell.open`、`shell.navigate`、`shell.close-tab`、`shell.content-rect`。

## 无固定主页与新标签页

- **Chromium 内核外壳没有固定主页**：首次打开、新窗口、`Ctrl+T` 一律显示**本地渲染的新标签页**，
  不会自动加载某个应用或固定 URL；只有 `?url=` / `?app=` 或用户导航后，宿主才注入内容。
- 新标签页两条等价路径：
  1. `index.html` 内联模板 `#tpl-ntp`（默认；享受主题、标签动画、会话恢复，零网络请求）；
  2. 独立文件 `newtab.html`（宿主可把 `infinity://newtab` / `about:home` 直接指到它；只发
     `shell.navigate` / `shell.search`，无字体/CDN/遥测请求，支持 `?theme=` 与 `?locale=`）。
- 新标签页包含：问候与日期、居中搜索框、常用站点磁贴（INC/ITB/IIM/IFM 本地地址）、品牌色渐变、
  页脚引擎标识；`settings.home` 只决定 **Home 按钮**的目标（默认 `about:home`）。
- 会话恢复时若上次只有新标签页，仍显示新标签页（不会回退到任何固定主页）。

## 会话恢复（宿主职责边界）

1. 外壳在 `beforeunload` / `pagehide` / `visibilitychange(hidden)` 与“保存并关闭”时写
   `localStorage["infinity-shell-session"]` 并发 **`shell.session-save`**。
2. **宿主应在窗口真正销毁前把该报文的 payload 持久化到自己的存储**（WebView2：`WebMessageReceived`
   中写配置/文件；CEF：`CefLifeSpanHandler::OnBeforeClose` 落盘），因为 `file://` 下 localStorage
   可能被策略清空或按“无痕”处理。
3. 下次启动：宿主可先回 **`host.session-restore`**；若未下发，外壳在设置项
   `restoreSession`（默认开）为真时自行读 localStorage 恢复。
4. 恢复是**静默**的：只渲染活动标签，其余标签保留模型、激活时才创建视图。
5. 设置项：`启动时恢复上次的标签页`（默认开）、`退出时不再询问`（默认关，关闭窗口前弹一次确认并
   提供“不再询问”）。

## 游玩区（Play Zone，一个窗口一个）

- 入口：侧栏底部「游玩区」按钮、`⋮` 菜单「游玩区」、快捷键 `Ctrl+Shift+G`；`Esc` 关闭。
- 能力：创建 / 关闭 / 切换游玩区；自定义名称、主题（深 / 浅 / 跟随系统）、主色 / 强调色 / 背景色；
  背景音乐支持本地文件选择、播放 / 暂停 / 音量。
- **同一窗口唯一性强制**：
  1. 面板是单例（`#playzone`），状态只有 `activeId` 一个；`playzone.open(id)` 在切换前先关闭旧游玩区；
  2. `localStorage["infinity-shell-playzone"].windowId` 记录持有窗口，`data-pz-count` 恒为 `0|1`；
  3. `BroadcastChannel("infinity-shell-playzone")` 广播 claim：若另一个实例以同一 `windowId` 声明，
     较旧者自动关闭本地游玩区并提示（`playzone.dupWindow`，计数见面板底部守卫行）。
- 音乐由**外壳文档**播放（不在标签 iframe 内），因此切换标签、切换应用时持续播放；
  宿主也可用 `host.playzone {music:{src,name}}` 或 `window.__InfinityShell.playzone.setMusic(path)` 注入。

## 标签动画

新建 / 关闭 / 切换 / 拖拽排序 / 悬停抬升的完整 CSS 选择器、时长与 cubic-bezier 见 **`report.md`**；
`?anim-demo=1` 自动循环，`?anim-demo=1&freeze=1&phase=…&at=MS` 冻结取证。

## 交互与快捷键

| 操作 | 快捷键 |
| --- | --- |
| 新建/关闭标签、重开 | `Ctrl+T` / `Ctrl+W` |
| 聚焦地址栏 | `Ctrl+L` / `F6` / `Alt+D` |
| 刷新 / 前进 / 后退 / 主页 | `F5`·`Ctrl+R` / `Alt+→` / `Alt+←` / `Alt+Home` |
| 切换标签 | `Ctrl+Tab`、`Ctrl+1..9` |
| 收藏 | `Ctrl+D` |
| 侧栏 / 菜单 / 开发者工具 | `Ctrl+Shift+E` / `Alt+F` / `F12` |
| 游玩区开关 / 关闭 | `Ctrl+Shift+G` / `Esc` |
| 地址栏内 Alt+Enter | 新标签打开 |

地址栏输入规则：`inc://` 走套件应用；含 scheme 的走原样加载；形如 `a.b` 的补 `https://`；
其余交给宿主搜索（`shell.search`），演示模式显示“演示模式不联网”的说明卡片。

## 安全与约束

- 报文过滤 `channel === "infinity-shell"` 且 `dir` 与自身相反，避免自我回声；
- 所有注入文本（标题/URL）在写 DOM 前经过 HTML 转义；
- 不加载任何网络资源（字体使用系统字体栈 `Segoe UI Variable / Segoe UI / Noto Sans SC`）；
- 宿主模式建议校验 `event.origin` / `WebMessageSource`，只接受可信来源的 `to-shell` 报文。

## 已知限制

- 亚克力/Mica 用 `backdrop-filter` 近似，非系统级材质；`--disable-gpu` 下模糊由软件合成，观感略有差异。
- 自绘窗口按钮只发 `shell.window`，真正的最小化/最大化/关闭由宿主实现。
- 演示模式下外部网络地址受浏览器与网络环境限制（应用页为本地文件，始终可用）。
- 协议检查器是自研的报文日志面板，不是 Chromium DevTools；`shell.devtools` 用于交给宿主接管。
- 标签拖拽排序目前是鼠标/指针实现，未做触摸长按与标签固定（pinned tabs）、标签分组、溢出滚动。
- 游玩区背景音乐的 `blob:` 句柄不能跨重启保存，localStorage 只保留文件名/音量/播放态；
  重启后需宿主用 `playzone.setMusic(path)` 重新注入（或用 `?music=` 参数）。
- 关闭窗口的“保存并关闭”只发 `shell.window {action:"close", session}`，真正的窗口销毁由宿主执行。
