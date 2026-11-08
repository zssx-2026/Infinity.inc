# task-13 · 仿 Microsoft Edge 窗口 UI —— 实现报告

交付目录：`work/edge-ui/`　运行方式：直接用 Chromium / WebView2 / Edge 打开 `index.html`（无构建、无网络）。
本报告覆盖：Edge 相似度实现、标签动画清单（选择器/时长/缓动）、`?anim-demo=1` 取证、截图清单、
localStorage 数据结构、游玩区唯一性强制、会话恢复、无固定主页、宿主接口约定与未完成项。
宿主接口的完整报文表在 [README.md](README.md)。

---

## 1. 交付物

| 文件 | 说明 |
| --- | --- |
| `index.html` (≈21 KB) | 外壳：标题栏/标签栏、导航行、地址栏、侧栏、菜单、设置、协议检查器、游玩区 |
| `newtab.html` | 独立本地新标签页（无固定主页；零外部请求） |
| `assets/css/shell.css` (≈35 KB) | Fluent/Edge 观感、深+浅主题、标签动画系统、游玩区 |
| `assets/js/shell.js` (≈70 KB) | 标签模型与动画引擎、会话恢复、游玩区、宿主桥 |
| `assets/js/i18n.js` / `icons.js` | zh-CN/en-US 文案；内联 SVG 图标（新增 play/pause/volume/music） |
| `apps/{cloud,toolbox,installer,files}/index.html` | 演示应用页（iframe 内容） |
| `mock-host.html` | 参考宿主（postMessage 双向） |
| `report.md` / `README.md` | 本报告 / 宿主接口约定 |
| `tools/{anim-probe,verify,layout-check,pz-diag,smoke}.mjs` | CDP 证据脚本（动画冻结帧 / 功能断言 / 标签宽度 / 游玩区 / 参数冒烟）；`anim-probe.json` 为实测动画状态 |
| `shot-*.png` ×11 | 1280×800 headless 截图（含 4 帧动画证据） |

## 2. Edge 相似度实现要点

- **标签栏**：`--tab-w: 232px / --tab-min: 68px`，少标签时保持 Edge 的 232px 宽标签，标签变多按比例收窄
  （实测：1–4 个标签 = 232px，5 个 = 204px，窗口 1280 宽）；新建按钮、标签列表按钮、窗口按钮同排。
- **活动标签**：圆角矩形高亮 + 顶部 2px 滑动指示条；`Fluent` 的 hover/pressed 层级与 8/12/16px 圆角体系。
- **导航行**：侧栏、后退、前进、刷新、主页 + 圆角药丸型地址栏（搜索图标、协议前缀、翻译、收藏）+ 集锦/扩展/头像/菜单。
- **侧栏**：应用卡、垂直标签列表、搜索、底部「游玩区 / 设置」，可折叠（`Ctrl+Shift+E`）。
- **菜单**：`Alt+F` / ⋮，含新建标签、新窗口、历史、收藏、下载、集锦、**游玩区**、开发者工具、打印、主题、语言、设置、关于。
- **主题**：`html[data-theme=dark|light]` 全套 CSS 变量 + `color-scheme`，支持 `?theme=`、设置项与
  `prefers-color-scheme`（“跟随系统”）；标题栏用 Mica/Acrylic 近似（`backdrop-filter`）。
- **新标签页**：品牌渐变 logo、问候/日期、居中圆角搜索框、常用站点磁贴（本地 `inc://`）、页脚引擎标识，**无固定主页**。

## 3. 标签动画清单（选择器 · 属性 · 时长 · 缓动）

CSS 变量集中在 `shell.css :root`：`--anim-in/out/shift/switch/hover/settle` + `--ease-out/in/shift/settle`。

| # | 动画 | CSS 选择器 / 关键帧 | 动画属性 | 时长 | cubic-bezier |
| --- | --- | --- | --- | --- | --- |
| 1 | **新建标签**（宽度撑开 + 淡入） | `.tab.enter` → `@keyframes tab-enter` | `flex-basis 0→232px`、`min-width 0→68px`、`max-width 0→232px`、`opacity 0→1`、`transform translateY(6px) scale(.94)→none` | **260 ms** | `cubic-bezier(.16, 1, .3, 1)` |
| 2 | **关闭标签**（收拢 + 淡出） | `.tab.exit` → `@keyframes tab-exit` | `width var(--exit-w)→0`、`padding 10/8→0`、`opacity 1→0`、`transform translateY(4px) scale(.9)` | **200 ms** | `cubic-bezier(.55, .06, .68, .19)` |
| 3 | **剩余标签平滑位移**（FLIP） | `.tab.flip` | `transform`（由 JS 写入 `translate3d(dx,dy,0)` 后归零） | **240 ms** | `cubic-bezier(.2, .9, .3, 1)` |
| 4 | **切换标签**（指示条滑动） | `.tab-indicator`（`#tabIndicator`） | `transform translate3d(x,0,0)` + `width` | **220 ms** | `cubic-bezier(.2, .9, .3, 1)`（`opacity` 120 ms linear） |
| 4b | 活动高亮过渡 | `.tab.active` | `background`、`color` | **220 ms** | `cubic-bezier(.2, .9, .3, 1)` |
| 4c | 内容视图淡入 | `.view-enter` → `@keyframes view-in` | `opacity .55→1`、`transform translateY(4px)→none` | **200 ms** | `cubic-bezier(.16, 1, .3, 1)` |
| 5 | **悬停抬升** | `.tab:hover` | `transform translate3d(0,-1px,0)` | **140 ms** | `cubic-bezier(.16, 1, .3, 1)` |
| 6 | **拖拽排序**（跟随指针） | `.tab.dragging` | `transition: none`（`transform` 由指针直接驱动 `scale(1.03)` + `box-shadow`） | 跟随 | — |
| 6b | 拖拽时邻居让位 | `.tabs.tab-dragging .tab:not(.dragging)` | `transform`（FLIP） | **240 ms** | `cubic-bezier(.2, .9, .3, 1)` |
| 7 | **拖拽回弹** | `.tab.settle` → `@keyframes tab-settle` | `transform`（0% 上抬 -4px/1.03 → 55% 1px/.998 → 100% none，过冲回弹） | **380 ms** | `cubic-bezier(.18, 1.42, .42, 1)` |
| 8 | 游玩区面板入场 / 高亮 | `.playzone`（`@keyframes pz-in`）、`.playzone.pz-flash` | `opacity`、`transform translate3d(18px,0,0) scale(.98)`；`box-shadow` 脉冲 | **220 ms** / 640 ms | `cubic-bezier(.16, 1, .3, 1)` |
| 9 | 无障碍 | `@media (prefers-reduced-motion: reduce)` | 上述 `animation/transition` 全部关闭 | — | — |

**动画引擎（`shell.js → TabAnim`）**

- `renderTabs()` 从“整条重建 DOM”改为**按 `tabId` 复用节点的 reconcile**：标题/图标/活动态增量更新，
  只有真正新增的节点才挂 `.enter`，否则动画每次刷新都会重放。
- 关闭时先 `TabAnim.measure()` 记录旧盒子，再把节点 `position:absolute` 钉在旧位置播放 `.exit`
  （收拢+淡出），随后对剩余节点做 **FLIP**（先写入反向 `translate3d`、强制回流、再归零），
  两者同帧发生，因此“收拢 + 邻居左移”是连续平滑的；`animationend`（外加 600ms 兜底）后移除节点。
- 指示条是绝对定位的单例 `#tabIndicator`，切换标签时只改 `transform` + `width`，由 CSS 过渡完成滑动；
  窗口 resize 时重算。
- 拖拽排序用 Pointer Events：移动超过 **5px** 才进入拖拽（不干扰点击切换），
  指针跨过邻居中线即重排 `state.tabs` 并 FLIP 邻居；释放时移除内联 transform 并挂 `.settle` 播放回弹；
  拖拽结束的那次 `click` 被吞掉。
- 三重 `transform/width/opacity` 过渡，全部只在合成层属性上做，无布局抖动。

## 4. `?anim-demo=1` 自动循环与冻结取证

- `index.html?anim-demo=1`：先铺 4 个种子标签，然后按 **newtab → close → switch → drag** 循环，
  每个阶段 1.3–1.7 s，左上角 HUD 显示阶段名、循环序号、该段时长与缓动；窗口暴露
  `window.__InfinityShell.anim.{run,step,freeze,probe,stop}`。
- `?anim-demo=1&freeze=1&phase=<newtab|close|switch|drag>&at=MS`：执行该阶段后用 Web Animations API
  暂停 `document.getAnimations()` 并把 `currentTime` 设为 `MS`，得到**确定性**中间帧
  （含 CSS transition），同时把实测状态写进隐藏的 `#animProbe`。

真实命令（与用户给定形式一致；Edge 会脱离父进程，故需轮询产物文件）：

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu \
  --window-size=1280,800 --screenshot="work\edge-ui\shot-anim-newtab.png" \
  "file:///D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/work/edge-ui/index.html?anim-demo=1&freeze=1&phase=newtab&at=130"
```

## 5. 截图清单（全部 1280×800，Edge headless）

| 文件 | 内容 | URL |
| --- | --- | --- |
| `shot-anim-newtab.png` | 新建标签：新标签宽度撑开、淡入中（`.tab.enter` 130ms） | `?anim-demo=1&freeze=1&phase=newtab&at=130` |
| `shot-anim-close.png` | 关闭标签：被关标签收拢淡出 + 邻居已左移（`.tab.exit` 110ms + `.tab.flip`） | `?anim-demo=1&freeze=1&phase=close&at=110` |
| `shot-anim-switch.png` | 切换标签：指示条滑动中 + 活动高亮过渡（`.tab-indicator` 110ms） | `?anim-demo=1&freeze=1&phase=switch&at=110` |
| `shot-anim-drag.png` | 拖拽排序：被拖标签抬升/加阴影，邻居 FLIP 让位 | `?anim-demo=1&freeze=1&phase=drag&at=260` |
| `shot-playzone-dark.png` | 游玩区面板（深色）：配色/主题/音乐控件 + 守卫行 | `?playzone=1&theme=dark` |
| `shot-playzone-light.png` | 游玩区面板（浅色） | `?playzone=1&theme=light` |
| `shot-newtab-page.png` | 独立本地新标签页 `newtab.html`（浅色） | `newtab.html?theme=light` |
| `shot-dark.png` / `shot-light.png` | 外壳整体：深色 / 浅色 Fluent 主题（新标签页版） | `?theme=dark` / `?theme=light` |
| `shot-app-cloud.png` | 应用标签（INC）演示页 | 上一轮产物 |
| `shot-devtools.png` | 协议检查器面板 | 上一轮产物 |

实测动画状态（`anim-probe.json`，节选）：

| 冻结帧 | 正在进行的动画（名称 当前时间/时长 状态） |
| --- | --- |
| `newtab@120` | `tab-enter 120/260 paused`；`transform 120/220`（指示条）；`view-in 120/200`；活动标签 `w=65`（0→232 撑开中），`opacity 0.999` |
| `newtab@250` | `tab-enter 250/260 paused`，活动标签 `w=232` 到位 |
| `close@160` | `tab-exit 160/200 paused`（被关标签 `w=30, opacity=0.46`）；3 个邻居 `.flip` 中（`transform 160/240`）；指示条 `width 160/220` |
| `switch@110` | `transform 110/220` + `width 110/220`（指示条滑动中）；`opacity 110/120`（活动高亮） |
| `drag@200` | 被拖标签 `cls="tab active dragging"`、`scale(1.03)`、`opacity .96`；邻居 `tab flip`（`transform 200/240`） |

（这些值由 CDP 脚本 `tools/anim-probe.mjs` 读取 `#animProbe` 得到，可复跑。）

## 6. 数据结构（localStorage / sessionStorage）

| 键 | 存储 | schema |
| --- | --- | --- |
| `infinity-shell-state` | localStorage | `{themeMode:"dark"\|"light"\|"system", locale:"zh-CN"\|"en-US", sidebar:bool, acrylic:bool, restoreSession:bool=true, exitAsk:bool=false, home:string="about:home", favorites:[{labelKey?,label,url,code,color}]}` |
| `infinity-shell-session` | localStorage | `{v:1, windowId:"win-…", savedAt:epochMs, activeTabId:"tab-…", home:string, tabs:[{id,url,title,kind:"ntp"\|"app"\|"web"\|"search"\|"page",appId,frameUrl}]}` |
| `infinity-shell-playzone` | localStorage | `{v:1, zones:[{id:"pz-…", name, theme:"dark"\|"light"\|"system", primary:"#rrggbb", accent:"#rrggbb", bg:"#rrggbb", music:{name, volume:0..1, playing:bool, src:string\|null}}], activeId:"pz-…"\|null, open:bool, windowId:"win-…", activeWindow:"win-…"\|null, updatedAt}` |
| `infinity-shell-window-id` | sessionStorage | 每个窗口一个 `win-…`，用于“同一窗口唯一游玩区”的归属与冲突判定 |

写入时机：会话在 `beforeunload` / `pagehide` / `visibilitychange(hidden)` / 手动“立即保存” / “保存并关闭”；
游玩区在每次改动与开关时；设置项变更即时。

## 7. 游玩区“同一窗口最多一个”的强制方式

1. **单例 DOM + 单值状态**：只有一个 `#playzone` 面板和一个 `playzone.activeId`；
   `pzOpen(id)` 在切换时先把 `open` 置假再开新，物理上不可能并列两个面板；`data-pz-count` 只能为 0/1。
2. **窗口归属**：`windowId()`（sessionStorage）写入 localStorage 记录 `windowId/activeWindow`，
   面板底部守卫行显示 `窗口 xxxxxx · 本窗口已打开 n/1`。
3. **跨实例一致性**：`BroadcastChannel("infinity-shell-playzone")` 广播 `claim/closed`；
   若另一实例以相同 `windowId` 且更晚的时间戳声明，本地实例立即关闭游玩区、计数 `dup-closed` 并提示
   `playzone.dupWindow`；同时监听 `storage` 事件刷新守卫状态。
4. **验证**：`tools/pz-diag.mjs` 实测 `open → data-pz-count=1`、`create+switch → 仍为 1（库内 2 个、下拉 2 项）`、
   `close → 0`；`localStorage` 记录 `{v:1, open, zones:2, windowId}`。

游玩区音乐由外壳文档的单个 `<audio id="pzAudio">` 播放（不在标签 iframe 内），因此切换标签/应用时持续播放；
`localStorage` 保存 `name/volume/playing`，`blob:` 句柄不跨重启，需宿主用 `playzone.setMusic(path)` 重注入。

## 8. 会话恢复与“无固定主页”

- **无固定主页**：默认启动分支为 `newTab("about:home")`，只有 `?url=`/`?app=` 或用户导航才会离开新标签页；
  `settings.home` 默认 `about:home`（仅决定 Home 按钮）。新标签页由外壳本地渲染（内联模板 / `newtab.html`），
  零外部请求。
- **会话恢复**：`restoreSession`（默认开）→ 启动时读 `infinity-shell-session`，按序重建标签，
  只渲染活动标签（`lazy`），其余在首次激活时才建视图（`silent reload`）。
- **只有新标签页的会话**：启动时检测到 `tabs` 全为 `about:home`，则不恢复、直接显示新标签页并提示
  `toast.newTabOnly`（实测：`tabs=1, url=about:home, ntp=true`）。
- **退出询问**：`exitAsk=false`（默认）时点关闭按钮弹 `#dialog-exit`，列出标签清单 + “退出时不再询问”；
  确认后保存会话、把快照放进 `shell.window {action:"close", session}`；勾选后写回设置不再询问。
- 宿主侧职责（持久化 `shell.session-save` / 下发 `host.session-restore`）见 README 第「会话恢复」节。

## 9. 宿主接口约定（摘要，完整见 README.md）

- **通道探测顺序**：`window.__INFINITY_HOST__.postMessage`（CEF/原生注入）→
  `window.chrome.webview.postMessage`（**WebView2**）→ `window.parent.postMessage`（iframe 宿主）→ 内置 demo 宿主；
  可用 `?host=webview2|cef|bridge|demo` 强制。
- **信封**：`{channel:"infinity-shell", v:1, dir:"to-host"|"to-shell", type, payload, ts, id}`，
  双向同构；两侧都过滤 `channel` 与相反的 `dir` 防回声。
- **URL/title 注入**：宿主回 `host.tab-update {tabId,url,title,kind,loading}` 更新标签标题、favicon、地址栏、加载条；
  `host.tab` 可整体替换列表；`host.activate-tab`/`host.close-tab` 驱动切换/关闭（走同一套动画）。
- **内容区**：外壳周期性发 `shell.content-rect {x,y,width,height}`；`host.config {render:"native"}` 时外壳只画
  chrome，宿主把 CEF Browser / WebView2 控制器摆到该矩形上。
- **窗口**：`shell.window {action:minimize|maximize|close|new, session?}`；`?frame=0` 用宿主的原生标题栏。
- **新增**：`shell.session-save` / `shell.session-restored` / `host.session-restore` / `host.playzone` / `shell.home`。

## 10. 验证记录

```powershell
# 1) 语法
node --check work\edge-ui\assets\js\shell.js ; node --check work\edge-ui\assets\js\i18n.js
# 2) 布局（CDP + Emulation.setDeviceMetricsOverride 1280x800）
node work\edge-ui\tools\layout-check.mjs 9236
#    tabs=1..4 → 每个 232px；tabs=5 → 204px（按比例收窄）
# 3) 功能断言（会话 / 游玩区 / 新标签页）
node work\edge-ui\tools\verify.mjs <port>
# 4) 动画冻结帧状态
node work\edge-ui\tools\anim-probe.mjs <port> "file:///…/work/edge-ui/index.html"
```

`verify.mjs` 最终结果（同一 profile 连续导航）：

- 初始：`url=about:home, tabs=1, ntp=true, home=about:home, pzCount=0, bootError=null`
- 快照：`{v:1, windowId:true, active:true, tabs:[about:home, inc://cloud, inc://toolbox], savedAt:true}`
- 重启恢复：`tabs=[about:home, inc://cloud, inc://toolbox]`，活动 `inc://toolbox`，`lazyViews=1`（只渲染活动标签）
- 仅新标签页的会话：`tabs=1, url=about:home, ntp=true`，提示“上次会话只有新标签页，仍显示新标签页”
- `newtab.html`：`local=true, theme=light, tiles=4`，点击磁贴发出 `shell.navigate`
- 无 JS 错误：`data-boot-error` / `data-js-error` 均为 `null`

## 11. 未完成项 / 已知限制

1. 标签**拖拽**用鼠标/指针实现，未做触摸长按拖拽；也没有 pinned tabs、标签分组、Edge 的溢出滚动条。
2. 标签宽度策略为“≤4 个保持 232px、更多按比例收窄”，未实现 Edge 的“标签数超过阈值后固定最小宽 + 横向滚动”。
3. 游玩区音乐 `blob:` 不跨重启；跨窗口同步只广播打开/关闭与冲突，不做音乐进度同步。
4. 关闭窗口的“保存并关闭”只发报文，真正销毁窗口由宿主完成；`file://` 下 localStorage 在部分策略下会被清空，
   因此宿主必须落盘 `shell.session-save`。
5. 拖拽排序未做自动滚动（标签条溢出时无法拖到视口外）。
6. 未在真实 CEF/WebView2 进程中测量合成层 FPS；`--disable-gpu` 下 Mica 模糊为软件合成，
   观感与系统材质有差异。
7. `?anim-demo=1` 的 HUD 仅用于演示/取证，正常启动不显示。
