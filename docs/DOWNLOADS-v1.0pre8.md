# 下载面说明 · v1.0pre8（Infinity Studio / Infinity Server）

本文记录 2026-11-13 落地的下载链路：页面拆到多个域名、人机验证单独成页、下载统一经
Cloudflare 302 跳转、Studio 在应用内在线安装。

## 一、三个域名各管一件事

| 域名 | 角色 | 内容 |
|---|---|---|
| https://infinity-studio-craft.github.io/ | 落地页（GitHub Pages） | 只有 Infinity Studio 与 Infinity Server 两张卡；不列子应用、不给源码/仓库链接 |
| https://infinity-verify.pages.dev/ | 人机验证页（Cloudflare Pages） | 读 `/api/catalog` 显示真实版本与大小；Turnstile 为主路径，受限网络走本地验证 |
| https://infinity-downloads.pages.dev/ | 下载门（Cloudflare Pages Functions） | `/api/catalog` 产品清单、`/dl/<asset>` 验票后 302 到安装包 |

`infinity-downloads.pages.dev` 根页是「下载入口」，两张卡都指向验证页，不再自带遮罩。
另有一个只用于验收的副本项目 `infinity-downloads-qa.pages.dev`。

## 二、下载链路

```
落地页点「下载」
  -> https://infinity-verify.pages.dev/?asset=<asset>
     通过 Turnstile（或本地验证）拿到票据
  -> https://infinity-downloads.pages.dev/dl/<asset>?token=<turnstile>|lt=<local>
     票据校验通过
  -> 302  https://github.com/zssx-2026/<repo>/releases/download/v1.0.0-pre8/<file>
```

- 下载地址从不写死在页面里：页面上只有 `/dl/<asset>`，真实资产地址由函数侧决定，换版本不用改页面。
- 302 的落点现在指向本部署的镜像 `/cdn/<asset>`（不是 GitHub）：仍是 Cloudflare 302，但字节从 Cloudflare 边缘取，链路少一跳。
- 票据一次性、短时效：Turnstile 票据 300 s，本地票据 120 s；换 asset 用同一张票会被拒（`local_ticket_invalid`）。
- 没有票：`Accept: text/html` 得到验证页（200），JSON 客户端得到 `403 {"error":"turnstile_required"}`；票无效 `403 turnstile_failed`；未知资产 `404 unknown_asset`。

## 三、Turnstile 在受限网络下的真实情况

实测（本机，2026-11-12）：

- `challenges.cloudflare.com/turnstile/v0/api.js` → 302，可达；
- `hagen.challenges.cloudflare.com`（真正跑挑战的 iframe 主机）→ **直连 15 s 超时、换 104.18.8.208 / 104.18.9.208 也是超时**；
- 浏览器里该 iframe 是 `net::ERR_ABORTED`，控制台报 postMessage origin 不匹配。

结论：只挂 Turnstile 会让这类网络下**所有下载都不可用**。所以下载门同时提供「本地验证」：

- `GET /api/verify` 返回 `{challenge, image, expiresIn:180}`，`image` 是服务端现画的 5 字符 PNG（点阵字库 + 抖动 + 噪点 + 斜线）；
- `challenge` 只带验证码的 HMAC，**不含明文**；
- `POST /api/verify {challenge,answer,asset}` 校验通过后发 `{ticket}`（HMAC 签名，绑定 asset，120 s）；
- 验证页在 Turnstile 6 s 内没给出结果、或 onerror 时，自动切到本地验证面板（也可以 `?local=1` 直接进）。

端到端验收脚本 `work/qa-local-gate.mjs`：自己解码 PNG 反解验证码 → 换票据 → 请求下载门 → 断言 302 落在 GitHub 资产上，并断言跨资产、伪造票据都是 403，最后打印 `LOCAL-GATE PASS`。

**定位**：本地验证是 Turnstile 不可达时的回退，不是替代。它挡脚本化批量下载，但挡不住针对性 OCR（点阵字库是确定的）；要更强需要加服务端图像扭曲。

## 四、Studio 应用内在线安装

Studio 的「在线安装」页不经过浏览器验证：桌面程序直接读目录、直接下资产。

- 目录：`GET /api/catalog`（Studio 侧 `InfinityStudio/src/remote.js` 的 `fetchCatalog`），**两个主机按序尝试**——`https://infinity-downloads.pages.dev` 优先，`https://infinity-account-auth-worker.zssx2026.workers.dev` 兜底（`*.workers.dev` 在部分网络被 SNI 阻断，单主机等于单点故障）；
- 目录归一化必须保住 `mirror`：`fetchCatalog` 会把服务端目录映射成干净结构，早先这一层只留了 `url`，于是 GitHub 在本机被 reset 时下载器手里只有一条死路，两次尝试后直接 `fetch failed`（实测 54 s、0 字节、`peak_received=0`）。这条缺陷只在「主 host 真的不可用」时暴露，单测已补「死端口回落镜像」用例；
- 下载：目录给 **一个主地址 + 有序镜像列表**——`url` 是 GitHub 资产直链（支持 Range，可并发），`mirrors` 依次是公共 GitHub 代理 `https://gh-proxy.com/<github url>` 与本部署的 `/cdn/<asset>` 镜像（`work/pages-gate/functions/cdn/[asset].js`，边车拉取后回传）。下载器按 `url` → `mirrors` 顺序去重后逐个试，**每个主机各试 2 次**；新增镜像只改 `_lib/assets.js` 与 `api/catalog.js`，客户端不用重编；落 `%LOCALAPPDATA%\Infinity\Studio\downloads\`，**算 sha256 与目录比对**，不一致就删掉重下（哈希不符不重试，那是错文件不是坏线路）；
- 并发：资产主机支持 Range 时（`HEAD` 里 `accept-ranges: bytes` 且体积 ≥ 8 MiB），下载切成 **2 MiB 段**、最多 **8 条连接**写同一个 `.part` 文件（`handle.write(buffer,0,len,offset)` 定位写，每段断言收满）。分段的理由不是并发数，而是**可重试**：一条覆盖十分之一文件的 Range 一旦变慢，只能整条丢掉重来，而分段可以把坏的那 2 MiB 放回队列、其余连接继续跑。失败段最多重试 3 次，全失败才删 `.part` **回落单流**；主机不支持 Range 或返回不是 206 同样回落，安装不会因为分片策略失败。实测（2026-11-13，同一资产 8×1 MiB）：顺序 0.87 MiB/s，8 路并发 4.47 MiB/s（5.12×），单流最差时约 16 KiB/s，8 路并发是能不能用的分界；
- 文件名取资产名（`InfinityStudio_1.0.0-pre8_win64_setup.exe`），必须是 `.exe`——`spawn()` 对没有扩展名的 PE 会报 `ENOENT`（曾真实踩到）；
- 停滞判定：分片不再用固定 120 s 截止（80 MiB 的 1/8 是 10 MB，60 KB/s 下合法地要几分钟，硬截止把慢下载变成失败——实测 438 s 报 `terminated`）。改为 `STALL_MS = 90000` 的看门狗：**连续 90 s 没有任何字节**才 abort；
- 慢段判定（2026-11-14 补，真实踩到）：**「还在动」不等于「在干活」**——一次真实下载的最后 2.2 MB 只有 1.2 KB/s，每 15 s 来几十字节，看门狗永远不响，6 分钟的安装变成 30 分钟。所以每段还有速率地板：`SLOW_WINDOW_MS = 20000` 窗口内平均低于 `SLOW_BYTES_PER_SEC = 6000` 就 abort 该段并重排队（重试 3 次）。单测 `work/test-remote-download.mjs` 里专门有一个「首轮只吐 5 KB/s 的段」用例，断言它被丢弃后重取成功、且整体没有被等满；
- 安装：`/S` + `windowsHide`，串行一次一个，退出码 0 才算成功；页面 700 ms 轮询 `/v1/remote/state` 显示阶段、进度与日志。

为什么还要第三方代理（2026-11-13 实测，同一 84 MB 资产，1 MiB Range）：

| 主机 | 单连接 | 8 路并发 | 84 MB 预计 |
|---|---|---|---|
| GitHub 直链 | 0.62 MiB/s（可达时） | 4.47 MiB/s | 不到 1 分钟 |
| `gh-proxy.com` | 96 KB/s | 400 KB/s | 约 3.5 分钟 |
| 本部署 `/cdn` | 77 KB/s | 160 KB/s | 约 9 分钟 |

本机到 GitHub 的直连大多直接 `ECONNRESET`（curl 走系统代理才通），所以真正可用的是后两条。代理是别人的服务、随时可能消失，因此**永远不是唯一路径**，且落地后仍要过目录 sha256：代理返回错文件会在哈希处失败，不会被安装。

镜像实测（2026-11-13）：`GET /cdn/InfinityServer-setup` → 200 / 83,716,680 B / 780.7 s（0.10 MiB/s），sha256 与目录逐字符一致（`b6963536…a526`）；响应头 `x-infinity-cache: miss`，**重复请求仍是 miss**——Pages Functions 的 `caches.default.put`（`context.waitUntil`）没有把 84 MB 对象留住，所以镜像目前是「代理」而不是「缓存」，只作为 GitHub 不可用时的兜底。

镜像也要能并发（2026-11-13 补）：镜像原先把 `accept-ranges` 写成 `none`、也不答 `HEAD`，桌面端探到「这里只能单流」就退回单连接——等于把唯一的可用主机锁成 40 KB/s。现在 `cdn/[asset].js` 有 `onRequestHead`（按资产表回 `content-length` 与 `accept-ranges: bytes`，不碰上游），GET 无 Range 分支同样声明可切片。实测 `probeRange('https://infinity-downloads.pages.dev/cdn/InfinityServer-setup')` → `{ranges:true,size:83716680}`（1.2 s）；单条 1 MiB Range → 206 / 13.3 s（77 KB/s），4 路并发 1 MiB → 4×206 / wall 25.7 s（单连接 40–153 KB/s，合计约 160 KB/s）。结论：镜像并发只有约 **2×**（客户端到 Cloudflare 的单连接本身受限），不如 GitHub 直链的 5×，但比 40 KB/s 单流把 84 MB 从 35 分钟压到约 9 分钟。R2 是正解（`wrangler r2 bucket create` 回 `Please enable R2 through the Cloudflare Dashboard. [code: 10042]`，需在面板开通），开通后把 `cdn` 改成读 `env.BUCKET` 即可获得 Range + 边缘直出。

验收（2026-11-14，带分段下载器与镜像列表的包）：装好的 Studio 起自己的服务后 `GET /v1/remote` 返回 `base=https://infinity-downloads.pages.dev`，目录里的 Studio 为 **83,751,712 B / `d72433918d5b…7a22`**、Server 为 **83,716,680 B / `b6963536…a526`**；点「安装」后 **Server 真装上**（91 文件 / 281,229,603 B，setup exit 0）。

无窗口端到端实测（`work/qa-studio-headless.ps1`，job `pwsh-ee96c6a1e0384b00`）：静默安装 Studio（101 文件 / 281,544,502 B）→ 起 `cli.js 7799` → `POST /v1/remote/install` → 下载 78 s（83,716,680 B，sha256 与目录逐字符一致）→ 安装 28 s → `phase=done ok=true`，**全程 106 s**，最后两个卸载器 `/S` 均 exit 0、安装目录清空，打印 `STUDIO-HEADLESS PASS`。同一动作在分段下载器之前要 30 分钟以上（1.2 KB/s 的尾段），这就是分段 + 速率地板 + 镜像列表三件事合起来的收益。

无窗口复核（同一轮）：`work/test-server-page.mjs` 直接在进程内 `start({port:0})` 起服务再读页面与 `/v1/health`，**SERVER-PAGE PASS 11/11**——页面 27,640 B、`undefined` 命中 0、`rack.coresPerNode=288` 且 `cores(2304) === nodes(8) * coresPerNode`、缓存六层齐全、哈希链 `ok`。该测试守的是「8 节点 x undefined 核」那类缺陷：`/v1/health` 少一个字段，页面就会画出 `undefined`，而不需要开窗口才能发现。

## 四·B、组件渠道：Studio 装自己的子产品

公开站只给两个下载入口（Studio、Server），但一个叫 Installer 的程序如果只能装它自己列表里的两个包，那它在干净机器上什么也装不了。所以子产品走**组件渠道**，不进公开目录：

- 门有两个：`/api/catalog`（公开，两个产品，站点渲染它）与 `/api/components`（组件，只有 Studio 读）。两者结构相同，组件多一个 `component: true`，Studio 的表格里显示「组件」标签；
- 组件资产发布在 **`zssx-2026/Infinity-Studio` 的 `v1.0.0-pre8` release** 里（不是下载入口，只是 Studio 取字节的地方），表在 `work/pages-gate/functions/_lib/assets.js` 的 `COMPONENTS`；
- 三个组件（2026-11-14 用当前 InfinityViewer 外壳重打包并签名，`work/package-pre8-components.ps1`）：

| 资产 | 名称 | 字节 | sha256 |
|---|---|---|---|
| `InfinityCloud-setup` | Infinity Cloud | 84,240,824 | `af870f039885…48e8` |
| `InfinityPackageManager-setup` | Infinity Package Manager | 83,992,880 | `601ca886f229…4883` |
| `InfinityToolbox-setup` | Infinity Toolbox | 83,990,216 | `798a53b60b33…9b1b` |

上表是 2026-11-14 **第八次**重打包（产品清单与翻译按钮，见四·C-6）：三包 attempt=1 即 Valid，重发资产 id **746635563 / 746636620 / 746637327**，部署 `1df2975f`，`/api/components` 回读三条 size/sha 各 2 个镜像；前七版（84,258,520 / 83,967,968 / 84,022,320 及更早六组）已被同名替换。

- 重打包的理由：pre8 的三个 C++ 安装包是 InfinityViewer 更名（无框窗口 + 内置下载管理器）**之前**打的，直接拿来发等于把旧外壳塞给用户。重打包只换外壳载荷，命令行二进制不变；
- 客户端不用重编就能看到新组件：`fetchCatalog` 拉完公开目录后再拉 `/api/components` 合并，读不到组件门也不算失败（旧门照常只给两个 setup）；
- 「安装全部」按钮会把 5 个包一起装（Studio 自身除外），单个组件也可以只点自己那一行。
- 镜像也认组件：`/cdn/<asset>` 先查 `ASSETS` 再查 `COMPONENTS`，所以 Studio 在发布主机和公共代理都不可用时还有自己的一条路；但 **`/dl` 只认 `ASSETS`**，`GET /dl/InfinityCloud-setup` 实测仍回 404 `unknown_asset`——组件不可能从公开门被领走，只有已经知道资产名的 Studio 能取字节（实测 `/cdn/InfinityCloud-setup` HEAD → 200 / 84,199,784 B / `accept-ranges: bytes`）。
- **卸载也在同一条路上**：`InfinityStudio/src/uninstall.js` 按产品名（去空格、忽略大小写）在 `%LOCALAPPDATA%\Programs\Infinity.Inc\*` 里找目录，跑该目录的 `Uninstall.exe /S _?=<dir>`（`_?=` 让 NSIS 不再把自己复制到 %TEMP%，退出码才代表"卸完了"），然后以**目录真的消失**作为成功判据，不只看退出码。`POST /v1/remote/uninstall {ids:["cloud"]}` 返回 `{ok, results:[{asset,dir,code,removed}]}`；空 id 列表回 400，卸载正在运行的安装器本身被拒绝（`refusing to uninstall the running installer`）。`GET /v1/remote` 现在多一个 `installed` 数组，页面据此把行标成「已安装」并给「卸载」按钮。

最终发布的 Studio 为 **83,807,192 B / sha256 `d5dd3415968f1dc121abce519fb3b656fbd4c334dd87eff27c5772a124798b03`**（sig=Valid，`/api/catalog` 同步，部署 18c68e6f），卸载通道就是在这一版上复跑的。

卸载通道的端到端实测（`work/qa-studio-uninstall.ps1` + `.mjs`）→ **STUDIO-UNINSTALL PASS 11/11 / STUDIO-UNINSTALL-CHANNEL PASS**：静默装 Studio → 起 `cli.js 7801` → 基线 `installed` 只有 `studio`（安装器自己就在这个目录里）→ `POST /v1/remote/install {ids:["InfinityCloud-setup"]}` → `phase=done`、`installed` 变 `["studio","inc"]` 并带出目录 → 拒绝卸载运行中的安装器 → 空 ids 回 400 → `POST /v1/remote/uninstall {ids:["InfinityCloud-setup"]}` 回 200 `{code:0, removed:true}` → 目录真的消失、`installed` 回到 `["studio"]`；最后 Studio 自身 `Uninstall.exe /S` exit 0、`dirs_left=False`。产品 id 是 `inc`/`ipm`/`int`，资产名是 `InfinityCloud-setup` 这类，路由现在三者（id、资产名、显示名）都接受。

无窗口端到端（`work/qa-studio-component.ps1`，job `pwsh-61028a568856414a`）→ **STUDIO-COMPONENT PASS**：装好的 Studio `GET /v1/remote` 列出 **5 个产品**（Studio 83,752,488 / Server 83,716,680 / 三个组件），`POST /v1/remote/install {ids:['InfinityCloud-setup']}` → 下载 84 s（84,202,296 B，sha256 与目录一致）→ 安装 → `phase=done ok=true`，全程 **118 s**；装上的 Infinity Cloud 为 **97 文件 / 292,469,926 B**，`inc_cli.exe`、`inc_shell\inc_window.exe`、`inc_shell\resources\app\main.js`（27,993 B，含 `InfinityViewer`）与 `downloads.js` 全在位，两个卸载器 `/S` exit 0、目录清空。首轮该脚本打印 FAIL 是脚本自己的错（PASS 条件在卸载后才求值），不是产品问题。

## 四·C、InfinityViewer 是真浏览器（2026-11-14）

外壳从「只渲染自家产品页的 kiosk」变成真浏览器，两件事必须同时成立：

- **外部页进 `<webview>`，本地产品页仍用 iframe**。产品页同机同源（127.0.0.1:<port>），iframe 少一个渲染进程；外部网址要自己的渲染进程与网络栈，所以 `shell.js` 新增 `buildWebview(tab)`，`buildFrame` 在 `tab.kind === "web"` 且 `canWebview()` 时走它。`main.js` 的 webPreferences 相应加 `webviewTag: true`（chrome 页本身仍只有 preload 一条通路）。
- **地址栏不是网址的输入变成真搜索**：`resolveTarget()` 在能建 guest 时返回 `https://www.bing.com/search?q=<encodeURIComponent(q)>`，kind 记 `web`，并保留 `query` 供标签标题用；只有 demo 宿主（没有 webview 能力）才保留原来那张「演示模式不联网」的卡片。

其它配套：`reload()` 先找 webview 调 guest.reload()；`did-fail-load` 忽略 `-3`（ABORTED，正常导航打断）与非主框架错误，其余把标签置 `error` 并把 `errorText` 显示在过渡页；`shell.css` 给 `.view webview` 满幅白底。

无窗口取证（探针窗口 `show: false`，不占用户屏幕）：`work/probe-shell-web.ps1` 起本地 http 页 → `window.__InfinityShell.open(url,"current")` → 2.5 s 后读 DOM：

```
web={webviews:1, url:"http://127.0.0.1:51003/probe.html", title:"Probe Web Page", kind:"web"}
search={url:"https://www.bing.com/search?q=probe%20search%20query", kind:"web"}
```

截图 `work/shell-web.png`（73,838 B）OCR 能读到 guest 页正文「probe web page rendered inside a webview guest」，说明是真渲染而不是只建了节点。

装好的组件也复验过（`work/qa-viewer-web.ps1` → **VIEWER-WEB PASS**）：从线上目录装 Infinity Cloud（97 文件 / 292,476,947 B），装出来的 `inc_shell\resources\app\main.js`（31,865 B）含 `webviewTag: true`、`ui\assets\js\shell.js`（95,740 B）含 `function buildWebview` 与 bing 搜索前缀；用这个装好的 `inc_window.exe` 跑同一探针，同样得到 `webviews=1 / title=Probe Web Page / kind=web` 与 bing 搜索 URL。内置下载器在 `webviewTag` 打开后回归通过：`work/probe-shell-dl.ps1` 慢速 24 MB 下载显示「6.5 MB / 24.0 MB · 2.9 MB/s · 8 连接」、角标 1。

### 四·C-1、网页里点的下载也归内置下载器（2026-11-14）

只接管「面板里手输的 URL」是玩具：真实的下载是**用户正在看的那个页面**给出的。Chromium 把 guest 页的下载交给同一个 session，所以接管点只有一处——`will-download`（`shell/main.js`：`item.cancel()` 后 `downloadManager().start(url, item.getFilename())`）。

探针 `INFINITY_SHELL_PROBE_GUEST_DL=1`（`work/probe-guest-dl.ps1`，窗口 `show:false`）流程：本地 http 服务回一个只有 `<a id="dl" href="/file.bin">` 的页面，`/file.bin` 是 2 MiB 且带 `content-disposition: attachment; filename="guest.bin"` → 打开页面 → 在 guest 里执行 `document.getElementById('dl').click()` → 4 s 后读面板。实测：

```
clicked = "clicked http://127.0.0.1:53532/page.html"
items=1  names={guest.bin}  bytes={2097152}  onDisk=2097152
```

面板文本「guest.bin 已完成 2.0 MB / 2.0 MB」、计数「1 个任务」，磁盘上 `%USERPROFILE%\Downloads\InfinityViewer\guest.bin` 正好 2,097,152 B。**探针必须先把队列清空**（`downloads.command("remove",{id})` 遍历 `downloads.state.items`），否则上一轮的残留项会让「刚点的这一下进了面板吗」这个断言失去意义——第一版探针就是这么假通过的（items=3，两个 guest.bin 加一个历史 probe.bin）；也不能用 `downloads.state()`，`state` 是对象不是函数。

契约自检补第 9 节 6 条（探针存在、附件头、先清队列、检查磁盘落盘、namespace 暴露 state）→ **SELFTEST PASS pass=73 fail=0**。

### 四·C-2、历史 / 收藏 / 集锦从假按钮变成真页面（2026-11-14）

审计发现浏览器菜单里的 `history`、`favorites`、`collections`、`print`、`extensions`、`profile` 全是假按钮：点下去只发一条宿主根本没有分支的 `shell.command`，然后 toast「已发送」。菜单报成功而什么都没发生，比没有菜单更糟，所以这一轮把能真做的做成真的，做不了的直说：

- **存储**：`HISTORY_KEY = "infinity.history.v1"`、`COLL_KEY = "infinity.collections.v1"`，与设置分开存（「清空历史」不该顺手清设置）；`recordHistory()` 跳过 `about:|search:|inc://|data:|blob:`，同 URL 连续只更新时间戳，上限 500 条。
- **路由**：`about:history|favorites|collections` → `kind` 同名 → `renderView` 走 `buildInternal(tab)`；历史页带搜索框与「清空历史」，收藏页每行「移除」，集锦页有「保存当前窗口」与每行「打开 / 删除」；Ctrl+H、Ctrl+Shift+O、Ctrl+Shift+Y 分别打开三页。
- **打印**：`printActive()` 只在当前标签是 `<webview>` 且 `guest.print` 存在时调用 `guest.print({})`，否则 toast「当前页面不支持打印」。
- **仍是假的**：`extensions`、`profile` 两个入口现在直接 toast「该功能尚未实现」，不再假装发送命令。

无窗口取证 `work/probe-internal.ps1` → **INTERNAL-PAGES PASS**：

```
history_entries=2   history_urls=http://127.0.0.1:50660/b.html,/a.html
fav=4->5   collections=1   colTabs=1
history_page rows=2 title=历史记录 count=2 条
favorites_page rows=5   collections_page rows=1
```

`colTabs=1` 是如实结果：探针是同一个标签页连续导航两次，所以「保存当前窗口」只收集到 1 条（断言从 `>=2` 改成 `>=1`，不是放宽，是纠正）。探针读取的是**页面 DOM**（`.view:not([hidden]) .internal` 的行数），不是存储里的数组，所以它证明的是「页面真的渲染出来了」。

两个探针自身的坑：`shell/build` 重建会抹掉同目录 `inc_cli.exe`，缺它 `boot()` 直接 `showFatal`，探针永远不开始（进程活着、90 s 超时、无 json）；PS 5.1 下 `Join-Path (Split-Path -Parent $exe) 'inc_cli.exe'` 取到空值，改成 `$exe -replace 'inc_gui\.exe$', 'inc_cli.exe'`，脚本内注释也改成英文（PS 5.1 按 ANSI 读无 BOM 的 UTF-8）。

契约自检补第 10 节 11 条（两个独立存储键、recordHistory、三条 about: 路由、buildInternal、集锦保存与恢复、printActive、未实现提示、探针与样式）→ **SELFTEST PASS pass=84 fail=0**。

装出来的组件复验（`work/qa-viewer-internal.ps1`）→ **VIEWER-INTERNAL PASS**：静默装 Infinity Cloud（97 文件 / 292,500,742 B，staged `main.js` 39,995 B 含 `INFINITY_SHELL_PROBE_INTERNAL`，`ui\assets\js\shell.js` 106,550 B 含 `function buildInternal` 与 `about:history`）→ 用装好的 `inc_window.exe` 跑同一探针 → `history=2 / fav=4->5 / collections=1 / pages 2-5-1` → `/S` 卸载 exit 0、目录消失。

### 四·C-4、应用卡片打开的是真产品（2026-11-14）

以前点 NTP 里的应用卡片，打开的是 `ui/apps/*.html` 里的静态样张，样张自己写着「演示内容 · 由 InfinityViewer 通过 iframe 加载」。那是把占位当交付。现在：

- **卡片指向真实产品**：`APPS` 每项带 `prefix`（`inc` / `int` / `ipm` / `ifm`），点开走 `inc://<name>` → 页面发 `viewer.app` → 宿主 `ensureProduct()` 找到该产品的 `<prefix>_cli.exe`（同目录、`%LOCALAPPDATA%\Programs\Infinity.Inc\<Product>\`、开发树 `cpp/out/<prefix>/` 依次找）→ 用 `--serve-ui --port=<空闲端口>` 起它 → 回 `host.app {url}` → 标签页落到 `http://127.0.0.1:<port>/`，用 `<webview>` 真正加载。
- **起不来就说清楚**：没装或启动失败时卡片写「启动失败：not installed / server did not start」并给「重试」，不再假装成功。
- **删掉样张**：`work/webview2/ui/apps/` 与 `assets/css/apps.css` 一并删除（没有任何代码再引用它们），UI 里也不再出现「演示内容」。
- 宿主退出时 `shutdown()` 会杀掉自己起的所有子产品进程，不留孤儿 `_cli.exe` 占端口。

无窗口取证 `work/probe-apps.ps1` → **APPS-LAUNCH PASS**：

```
app=int url=http://127.0.0.1:7653/ tabKind=web webviews=1 procAlive=True error=
```

契约补第 12 节 12 条（样张已删、无「演示内容」、卡片带 prefix、viewer.app/host.app、ensureProduct、`--serve-ui`、`windowsHide`、探针）→ **SELFTEST PASS pass=104 fail=0**。

### 四·C-3、个人资料与扩展也是真页面（2026-11-14）

工具栏最后两个按钮（`#btn-extensions`、`#btn-profile`）此前只回一句「该功能尚未实现」。现在：

- **`about:profile`**：显示名输入框（`#pfName`）+ 保存（`#pfSave`）写进 `settings.profile`、5 个头像色、5 条只读事实（宿主 / 引擎 / 协议 / 语言 / 主题），底部写明「只存在本机」——没有账号后端，所以不假装有云同步。
- **`about:extensions`**：`builtinFeatures()` 用**实时状态**生成 6 行（下载队列数与完成数、历史条数、收藏数、集锦数、webview 是否可用、地址栏搜索引擎），每行可「打开」；末尾一句「加载第三方扩展目前不支持，也不会假装支持」。
- 路由补两个 kind：`resolveTarget` 的正则扩成 `/^about:(history|favorites|collections|profile|extensions)$/i`（只加 `titleFor`/`kindFor` 不够——第一次跑探针时 profile 页是空白、rows=0，就是漏了这里）。

探针扩两段（`work/probe-internal.ps1`）→ **INTERNAL-PAGES PASS**：

```
profile_page title=个人资料 facts=5 saved=Probe User
extensions_page rows=6 title=扩展
```

保存的那条断言刻意读 `window.__InfinityShell.settings.profile.name` 而不是只看输入框：**能渲染但不保存的页面也会通过 DOM 检查**。

契约补第 11 节 8 条（路由正则、buildProfile、builtinFeatures、写 settings、两个语言都有 `pf.local`/`ext.note`、探针写名字、样式），并把第 10 节里已失效的「未实现就直说」断言换成「菜单两个 case 打开真页面」→ **SELFTEST PASS pass=92 fail=0**。

装出来的组件复验（第五次重打包）→ **VIEWER-INTERNAL PASS**：Infinity Cloud 97 文件 / 292,512,317 B，staged `main.js` 42,275 B、`shell.js` 112,538 B；装好的 `inc_window.exe` 跑探针得 `history=2 / fav=4->5 / collections=1 / profile facts=5 saved=Probe User / extensions rows=6` → `/S` 卸载 exit 0、目录消失。

### 四·C-5、开发者工具交给宿主（2026-11-14）

菜单里的「开发者工具」与 F12 以前只打开页面自绘的协议日志面板——长得像 DevTools，但什么也检查不了。现在请求过桥交给宿主：

- 宿主 `openDevtools(open, which)` 先看 `webContents.getAllWebContents()` 里有没有 `getType() === 'webview'` 的 guest：有就开 guest 的 `openDevTools({mode:'detach'})`（检查的是真实网页），没有就开外壳自己的。返回 `{open, target, error}`，页面记进 `state.devtoolsHost`，只有出错才 toast。
- `shell.devtools` 是新增的桥动作，F12 / Ctrl+Shift+I 变成 `{open: !state.devtoolsHostOpen}` 切换；原来那张本地协议日志面板保留在「协议日志」菜单项里，两者不再混为一谈。
- 探针 `INFINITY_SHELL_PROBE_DEVTOOLS` **只发 `{open:false}`**：detached 检查器是真窗口，自动化不许弹窗，所以探针验证的是「请求过桥并被真函数应答」，不是「窗口出现」。`work/probe-devtools.ps1` → **DEVTOOLS-BRIDGE PASS**：`devtools open=False target=webview error=`（当时前台有 guest，所以目标正是网页）。
- 契约补第 13 节 10 条 → **SELFTEST PASS pass=114 fail=0**。
- 装出来的组件复验（`work/qa-viewer-devtools.ps1`）→ **VIEWER-DEVTOOLS PASS**：静默装 Infinity Cloud，用装好的 `inc_window.exe` 跑同一探针，`open=False / target` 合法，`/S` 卸载 exit 0、目录消失。

### 四·C-6、产品清单与翻译按钮（2026-11-14）

把桥的两端对照着数了一遍（`work/audit-bridge.mjs`：页面发出的动作 17 个、宿主有分支的 8 个；宿主回的 6 种、页面处理 18 种），找到两个真缺口：

- **产品清单只发不收**：宿主 `case 'viewer.apps'` 会回每个产品装没装（`{inc:{installed:true}, ifm:{installed:false}, …}`），但页面从来没请求过、也没渲染过。现在 boot 在 `shell.ready` 之后发一次 `viewer.apps`，`host.apps` 落到 `state.apps`，新标签页的卡片在该产品 `installed === false` 时把地址换成「未安装 / Not installed」——点之前就知道起不来。
- **翻译是假按钮**：`#btn-translate` 原来发 `shell.command {name:"translate"}`，宿主没有这个分支，然后 toast「已发送」。现在改成真的在新标签页打开 `bing.com/translator`（`openTranslator()`），假发送整条删掉。
- 探针原先同步取快照，清单过桥是异步的，于是读到空对象报 FAIL；改成 `async` 等 1.5 s 再取，并加 `apps` 字段。`work/probe-apps-inventory.ps1` → **APPS-INVENTORY PASS**：`apps=inc,ipm,int,ifm`，inc/ipm/int 装、ifm 未装。
- 契约第 14 节 7 条 → **SELFTEST PASS pass=121 fail=0**。
- 装出来的组件复验（`work/qa-viewer-apps.ps1`）→ **VIEWER-APPS PASS**：静默装 Infinity Cloud，装好的 `inc_window.exe` 探针回 `apps=inc,ipm,int,ifm`（此时只有 inc 装），`/S` 卸载 exit 0、目录消失。

## 五、无窗口验收（硬约束）

用户要求「什么窗口都不要弹，CMD 和报错窗口都不要弹」，因此**所有验收都不启动 GUI**：

- 界面用无窗口服务面验证：`node <install>/resources/app/src/cli.js 7799` 起 Studio 服务，再走 HTTP；
- 安装器 `/S` + `windowsHide`，`Start-Process` 一律 `-WindowStyle Hidden`；
- 需要像素证据时用 `PrintWindow(PW_RENDERFULLCONTENT)` 抓**已存在**窗口，不新开、不抢焦点；
- Electron 主进程装崩溃日志守卫（`uncaughtException` / `unhandledRejection` 只写 `userData/crash.log`，不弹原生框）；
- 并行下载首个分片失败即 abort 其余分片，避免 `Promise.all` 之后仍有 rejection 逃逸成崩溃框。

守卫与规矩见 `docs/NO-WINDOWS.md`，扫描脚本 `node work/check-hidden-windows.mjs`（当前 `HIDDEN-WINDOWS PASS files=149 problems=0`）。

## 六、已知问题

- GitHub 资产下载在本机被限速（实测单流 10 s 内 0 字节、Node 单流约 16 KiB/s），80 MB 的安装包可能很久；Studio 侧已用 8 路 Range 并发缓解，但仍没有镜像，链路本身仍在 GitHub。
- 本地验证码可被点阵模板匹配破解（验收脚本自己就是这么过的）。
- 外部网页走系统代理/直连，取决于本机网络；被墙的站点会在标签里显示 error 过渡页而不是空白。
- 落地页/验证页/下载门三个域名都在 Cloudflare 与 GitHub 免费层上，没有自定义域名。

## 七、相关文件

- `work/_org-pages/index.html`（落地页，publish.mjs 推 GitHub Pages）
- `work/verify-gate/index.html`（验证页，部署到 infinity-verify）
- 无窗口测试：`work/test-studio-clean.mjs`（空 root 起服务，断言 inventory 全 0、plan 全 missing 且 blocking、install 409 且不落盘、suite/apps/health 仍可用）→ **STUDIO-CLEAN PASS 13/13**；`work/test-remote-download.mjs` → **PASS 17/17**（含「目录保留 mirror」「死端口回落镜像」）；`work/test-server-page.mjs` → **SERVER-PAGE PASS 11/11**；`work/check-hidden-windows.mjs` → **PASS files=150 problems=0**；
- `work/pages-gate/index.html` + `work/pages-gate/functions/{api/catalog.js,api/verify.js,dl/[asset].js,cdn/[asset].js,_lib/{ticket.js,captcha.js,assets.js}}`（下载门；`_lib/assets.js` 是唯一资产表，改版本只改这一处）
- `InfinityStudio/src/remote.js`、`InfinityStudio/src/page.js`、`InfinityStudio/src/server.js`（Studio 侧目录/下载/安装）
- `tools/publish-electron.mjs`（GitHub Release 上传，node:https 流式 + 显式 content-length）
- `work/qa-local-gate.mjs`、`work/qa-studio-remote.{mjs,ps1}`、`work/qa-studio-probe.ps1`、`work/qa-studio-uninstall.ps1`（验收）
- `work/test-remote-download.mjs`（并行分片下载单测：Range 主机 / 无 Range 回落 / 坏哈希，13 条断言）
- `work/qa-studio-headless.{ps1,mjs}`（无窗口端到端：静默安装 → cli 服务 → 在线装 Server → 卸载）
- `work/check-hidden-windows.mjs`、`work/patch-windowstyle.mjs`、`docs/NO-WINDOWS.md`（无窗口守卫）
