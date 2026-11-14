# Infinity.Inc 任务清单（队列：先到先做，用户新需求排最后）

## 2026-11-14 组件渠道（Studio 装自己的子产品，用户「真正实现所有功能」）
- [x] **动机**：公开站按 m02647 只给 Studio / Server 两个入口，但 Studio 在干净机器上只能远程装 Server——一个叫 Installer 的程序装不了自己的子产品，等于半个下载页。
- [x] 三个子产品用**当前 InfinityViewer 外壳**重打包（pre8 的三个 C++ 包是更名与无框窗口之前打的，直接发等于把旧外壳塞给用户）：`work/package-pre8-components.ps1`（只签这三个，避免误签已发布的 Studio/Server 包）→ InfinityCloud **84,202,296 B / `117227717b6b…3d65`**、InfinityPackageManager **83,957,264 B / `d10d48e6e57d…093a`**、InfinityToolbox **83,963,224 B / `ecac7213acb1…4874`**，三个 sig=Valid。
- [x] 发布到 `zssx-2026/Infinity-Studio` 的 `v1.0.0-pre8` release（asset id 745885043 等），**不作为下载入口**，只作为 Studio 取字节的地方；`tools/publish-electron.mjs` 增加 inc/ipm/int 三个产品项。
- [x] 门拆成两个：`/api/catalog`（公开，站点渲染，2 条）与 `/api/components`（组件，只有 Studio 读，3 条，带 `component: true` 与 `mirrors`）；表在 `_lib/assets.js` 的 `COMPONENTS`，由 `work/components-update.mjs` 按真实字节重写。
- [x] Studio 侧 `InfinityStudio/src/remote.js`：抽出 `cleanProduct()`，`fetchCatalog` 拉完公开目录再 `fetchComponents(root)` 合并（读不到组件门不算失败）；`page.js` 表格给组件加「组件」标签。
- [x] Studio 重建发布：**83,752,488 B / sha256 `ef08da02d2edd1dd498f8ff63f7abbd656ce9b985e9450d5ba40b73ee3120ff6`**，asset 745830063 删除后重传，部署 89055884；`/api/catalog` 实测 2 条、`/api/components` 实测 3 条（各带 2 个 mirrors）。
- [x] 无窗口端到端（`work/qa-studio-component.ps1`）→ **STUDIO-COMPONENT PASS**：装好的 Studio `GET /v1/remote` 列出 **5 个产品**，`POST /v1/remote/install {ids:['InfinityCloud-setup']}` → 下载 84 s（84,202,296 B，sha256 `117227717b6b…3d65` 与目录一致）→ 安装 → `phase=done ok=true`，全程 **118 s**；**Infinity Cloud 真装上 97 文件 / 292,469,926 B**，`inc_cli.exe`、`inc_shell\inc_window.exe`、`resources\app\main.js`（27,993 B，含 `InfinityViewer`）、`downloads.js` 全在位；两个卸载器 `/S` exit 0、目录清空。
- [x] 首轮该 QA 打印 FAIL 是**脚本缺陷**（PASS 条件在卸载后才求值，`Test-Path` 必然为假），修法是把断言布尔值在卸载前算好，再与「目录已清空」相与。
- [x] 边界复核：落地页 6,436 B 仍只有两张卡（Infinity Studio / Infinity Server，零 Infinity Cloud、零 github.com 链接）；`/api/catalog` 2 条、`/api/components` 3 条；`/dl/InfinityCloud-setup` → **404 unknown_asset**（公开门只认 ASSETS），`/cdn/InfinityCloud-setup` HEAD → 200 / 84,202,296 B / `accept-ranges: bytes`（镜像认组件，供 Studio 兜底）。
- [x] 源码快照推送：old_head `6ade9bff` → **new_head `7c5bdd7569f1fe6a0ecce6081cd170a4b39ef7f9`**，changed=69 / snapshot 1,148 文件 / 139,512,868 B，verify_blobs=1250 全 match，耗时 77 s。
- [x] 首启页面无窗口复核（`work/qa-component-firstrun.ps1`，直接跑 `cpp/out/<p>/<p>_cli.exe --serve-ui`）：Infinity Cloud **2,109 B 令牌页**（含 `id='t'`）、Infinity Package Manager **2,125 B 令牌页**、Infinity Toolbox **1,346 B 真工具页**（title `Infinity Toolbox`，无令牌要求）；三个进程都存活、HTTP 200。
- [x] **干净机器提示**：`InfinityStudio/src/page.js` 新增 `installNote()`，把 `required artefact missing` 翻成「本机没有构建产物，无法就地安装。请切到「在线安装」，从发布服务器安装已签名的安装包。」；`work/test-studio-clean.mjs` 加两条断言（页面含该提示、含错误码映射）→ **STUDIO-CLEAN PASS 16/16**。
- [x] **卸载通道**：新建 `InfinityStudio/src/uninstall.js`（`installRoot`/`installedDirs`/`findInstalled`/`listInstalled`/`uninstallProduct`，名字归一化去空格、`Uninstall.exe /S _?=<dir>`、以目录消失为判据、拒绝卸载运行中的安装器）；`server.js` 加 `POST /v1/remote/uninstall` 与 `GET /v1/remote` 的 `installed` 字段；`page.js` 表格标「已安装」+ 卸载按钮；`work/test-remote-uninstall.mjs` → **REMOTE-UNINSTALL-TEST PASS 10/10**（含 `INFINITY_INSTALL_ROOT` 覆盖、拼写差异匹配、缺卸载器与自我卸载均被拒）。
- [x] Studio 再发一版（含提示与卸载）：**83,768,320 B / sha256 `c10526525c20516360e0bd81bd4ecb7248bc1b4f7231a4f5a75892ef0114c1c9`**，部署 23784d6e；staged `src` 里 page.js/server.js/uninstall.js 与源码逐字节同时间戳。
- [x] 卸载通道端到端（`work/qa-studio-uninstall.ps1` + `.mjs`）→ **STUDIO-UNINSTALL PASS 11/11 / STUDIO-UNINSTALL-CHANNEL PASS**：静默装 Studio → 起 `cli.js 7801` → `POST /v1/remote/install {ids:["InfinityCloud-setup"]}` → `phase=done` → `installed` 变 `["studio","inc"]` 且带目录 → 拒绝卸载运行中的安装器（`refusing to uninstall the running installer`）→ 空 ids 回 400 → `POST /v1/remote/uninstall {ids:["InfinityCloud-setup"]}` 回 200 `{code:0, removed:true}` → 目录真的消失、`installed` 回到 `["studio"]`；最后 Studio 自身 Uninstall.exe /S exit 0、`dirs_left=False`。
- [x] 两次 FAIL 都是**断言写错**：一次按 `cloud` 找产品（目录里的 id 是 `inc`），一次把「安装器自己」当成不该存在的条目；改完才 PASS，产品侧只有一处健壮性增强（路由现在同时接受 id / 资产名 / 显示名）。
- [x] 最终发布（含 id/资产名/显示名三路匹配）：**83,807,192 B / sha256 `d5dd3415968f1dc121abce519fb3b656fbd4c334dd87eff27c5772a124798b03`**，sig=Valid、verify=Valid；`assets.js` 与 `/api/catalog` 实测同步（Studio 83,807,192 / `d5dd3415968f`），部署 18c68e6f；staged `server.js` 含 `ids.indexOf(x.name)`。

## 2026-11-13 无窗口化 + 并行下载抗崩（用户硬约束，本轮）
- [x] 用户指令 m03838「真正做到什么窗口都不要弹！CMD和报错窗口都不要弹！」→ 立规矩并落地守卫，见 `docs/NO-WINDOWS.md`。
- [x] **崩溃根因**：并行下载中某片失败时 `Promise.all` 先 reject，其余 job 再 reject 成为 unhandledRejection，Electron 主进程默认弹原生错误框并退出（表现为下载到 454,730 B 后 7721 端口 ECONNREFUSED、日志全空）。
- [x] `InfinityStudio/src/remote.js`：`downloadParallel` 首个失败即 `AbortController.abort()` 其余分片、每个 job 自己 catch、`Promise.all` 结束后再抛第一个错误；分片 signal 用 `AbortSignal.any([stop.signal, AbortSignal.timeout(120000)])`。
- [x] `download()` 加 2 次尝试（每次重新 `probeRange`、失败删 `.part`、间隔 1500 ms）；sha256 不匹配不重试（错文件不是坏线路）。`work/test-remote-download.mjs` 仍 **PASS 13/13**。
- [x] `InfinityStudio/src/main.js` 重写：`logLine` 写 `userData/studio.log`；`uncaughtException`/`unhandledRejection` 只记日志；`render-process-gone` 记 details。
- [x] `InfinityServer/src/main.js`、`shell/main.js` 同样加崩溃日志守卫（`userData/crash.log`）。
- [x] `InfinityStudio/src/apps/codecraft.js` 三处 `spawnSync`（`:118` probeCompiler、`:127` readVersion、`:174` compile）补 `windowsHide: true`。
- [x] 守卫脚本 `work/check-hidden-windows.mjs`（JS 看 spawn 前后 30 行、.ps1 看 Start-Process 后 3 行）→ **HIDDEN-WINDOWS PASS files=149 problems=0**。
- [x] 修补脚本 `work/patch-windowstyle.mjs`（argv 传清单，PowerShell 5.1 无 `<` 重定向），已给 19 个历史探针补 `-WindowStyle Hidden`。
- [x] Studio 用最终代码重建：`node InfinityStudio/build.mjs` + `tools/pack-electron.mjs studio` → 未签名 83,788,329 B；签名后 **83,795,576 B / sha256 `8a3bcad8e1b379f7324d668590498a6a4607ae68fa5bdfcb0f238e894f3347a1`**，sig=Valid。
- [x] 重传资产：删旧 742989515，上传 **id 743422200**，digest 与本地一致；`work/pages-gate/functions/api/catalog.js` 的 Studio size/sha256 更新并重部署（deployment 2ac91cb2）→ `/api/catalog` 实测 Studio 83,795,576 / `8a3bcad8…`，Server 83,716,680 / `b6963536…`。
- [ ] 无窗口端到端：静默安装 Studio → `node resources/app/src/cli.js 7799` → `POST /v1/remote/install` 装 Server → 断言越过 454,730 B 且服务存活（job `pwsh-541863b55e724692`）。
- [x] `docs/DOWNLOADS-v1.0pre8.md` 补「五、无窗口验收（硬约束）」并指向 `docs/NO-WINDOWS.md`；新增 `docs/NO-WINDOWS.md`。
- [x] 无窗口端到端脚本 `work/qa-studio-headless.{ps1,mjs}`：静默安装（101 文件 / 281,540,790 B）→ `-WindowStyle Hidden node <abs cli.js> 7799`（`-ArgumentList` 里路径**必须自己加引号**，否则含空格被拆开 → ECONNREFUSED）→ 轮询 `/v1/remote/state`。
- [x] 真实缺陷修复：分片硬超时 `AbortSignal.timeout(120000)` 把慢下载砍断（438 s 后 `error=terminated`）→ 改为 `STALL_MS = 90000` 停滞看门狗（5 s 心跳检查，连续 90 s 零字节才 abort）。

## 2026-11-13 下载镜像 + 主机回退（本轮）
- [x] 动机：GitHub 单流 60–73 KB/s，80 MB 要半小时；用户要求「真正实现所有功能」。
- [x] 新增 `work/pages-gate/functions/_lib/assets.js`（唯一资产表 ASSETS + TAG `v1.0.0-pre8` + `sourceUrl`/`mirrorUrl`），catalog / dl / cdn 三处共用。
- [x] 新增 `work/pages-gate/functions/cdn/[asset].js`：带 Range 时代理上游；无 Range 时 `caches.default` 读写 + `x-infinity-cache` 头。
- [x] `api/catalog.js` 每项给 `url`（GitHub 直链）、`mirror`（`/cdn/<asset>`）、`dl`；`dl/[asset].js` 的 302 落点改为 `mirrorUrl(...)`。四函数 `node --check` exit 0，已部署（57c5666d、efa0b95b）。
- [x] 镜像实测：`GET /cdn/InfinityServer-setup` → 200 / 83,716,680 B / 780.7 s（0.10 MiB/s），sha256 与目录一致；**重复请求仍 `x-infinity-cache: miss`** → `caches.default.put` 留不住 84 MB 对象，镜像只是代理。
- [x] R2 路线受阻：`wrangler r2 bucket create` 回 `Please enable R2 through the Cloudflare Dashboard. [code: 10042]`，需面板开通，暂缓。
- [x] 最终策略：`InfinityStudio/src/remote.js` 的 `download()` 用主机列表 `[product.url, product.mirror]`，每主机试 2 次，收到字节即停；单测仍 **PASS 13/13**。
- [x] 用该策略重建/签名/上传（job `pwsh-390177a1eccb48b1` exit 0）：未签名 83,763,558 B → 签名 **83,770,800 B / sha256 `692832981c5337d8622692c141632e941ac4aded055904384ae0156ba0bf11f8`**，资产 id **743531525**；`_lib/assets.js` 已更新 size 83770800 / sha `692832981c53…`；部署 deployment b0e1d5ff；`/api/catalog` 实测两条产品 size/sha/url/mirror/dl 全对。
- [x] 无窗口复核 Server 页面：新建 `work/test-server-page.mjs`（进程内 `start({port:0})`，读页面 + `/v1/health` + `/v1/cache/stats` + `/v1/verify`）→ **SERVER-PAGE PASS 11/11**：页面 27,640 B、`undefined` 0 命中、`coresPerNode=288`、`cores 2304 === 8*288`、缓存六层、哈希链 ok。
- [x] **真实缺陷（本轮找到）**：`fetchCatalog` 的归一化只留 `url`、丢掉 `mirror`，于是本机 GitHub 被 `ECONNRESET` 时下载器只剩死路——无窗口 QA 实测 54 s / 0 字节 / `error=fetch failed`。修法：`InfinityStudio/src/remote.js` 的 map 增 `mirror: String(p.mirror || '')`；单测补两条（目录保留 mirror、死端口回落镜像）→ **REMOTE-DOWNLOAD-TEST PASS 17/17**。
- [x] 新增 `work/test-studio-clean.mjs`（空 root 起服务）：**STUDIO-CLEAN PASS 13/13** —— inventory 四面全 0、desktop plan `files=10 missing=10 blocking=4 totalBytes=0`、`/v1/install` 回 **409 required artefact missing** 且不建 dest、suite 8 分支 / apps 10 个 / health ok。证明干净机器上「子产品」不会假装能装。
- [x] 修 `work/qa-studio-headless.mjs` 的日志打印（`state.log` 元素是 `{at,text}` 对象，原来打印成 `[object Object]`）。
- [x] 带修复重建发布（job `pwsh-a8e5e9193253492d` exit 0）：未签名 83,745,812 B → 签名 **83,753,056 B / sha256 `8973059ae182c3f7b859ae6730e2c1e806bb579554d51385fc976a55acfc9e10`**，删旧资产 743531525、上传 **id 743613817**；`_lib/assets.js` 已更新、部署 0ea577e9；`/api/catalog` 实测 Studio 83,753,056 / `8973059ae182` + mirror 字段。
- [x] `work/pages-gate/functions/cdn/[asset].js` 增 `onRequestHead`（按资产表回 `content-length` + `accept-ranges: bytes`），GET 无 Range 时也声明 `accept-ranges: bytes`：让桌面端把镜像当成可并发主机，而不是只能单流的兜底。
- [x] **下载主机升级为有序镜像列表**：`_lib/assets.js` 增 `GH_PROXY = 'https://gh-proxy.com/'` 与 `proxyUrl(item)`；`api/catalog.js` 每条产品给 `mirrors: [proxyUrl(item), mirrorUrl(origin, asset)]`（`mirror` 字段保留兼容）；`InfinityStudio/src/remote.js` 的 map 增 `mirrors`（去重保序），`download()` 用 `addHost()` 按 `url` → `mirrors` → `mirror` 去重后逐个试。理由：本机到 GitHub 直连 `ECONNRESET`、自建 `/cdn` 8 路只有 160 KB/s，而公共代理 `gh-proxy.com` 8 路 400 KB/s（实测同一 84 MB 资产）；代理不是唯一路径，且落地必过目录 sha256，错文件在哈希处失败。
- [x] `work/test-remote-download.mjs` 扩到 **PASS 18/18**：新增「目录保留有序 mirrors（含去重）」与「只有 `mirrors` 没有 `mirror` 时，死主地址仍能从 mirrors 下载成功」两条。
- [x] 带 mirrors 重建发布：**83,803,040 B / sha256 `15478764012a0dc06562f051470cfc0b9223bcba41fbba62daf46d44ecb17ada`**，删旧资产 743613817、上传 **id 743675234**；`assets.js` 同步、部署 e5c99fbd；`/api/catalog` 实测两条都带 `mirrors`（代理 + 自建）。已知：产物里的 `remote.js` 比源码少一行 mirrors 去重（构建早于该编辑），行为一致（`addHost` 已去重），下次重建自动带上。
- [x] **真实缺陷（2026-11-14 定位）**：并行下载按「8 条等分 Range」切分，一条覆盖 10 MB 的 Range 一旦爬行就只能整条丢掉重来——实测最后 2.2 MB 只有 1.2 KB/s、每 15 s 来几十字节，看门狗（90 s 零字节）永不触发，安装从 6 分钟拖成 30 分钟。重写 `downloadParallel`：**2 MiB 段 + 8 条连接的队列**，段失败或速率低于地板（`SLOW_WINDOW_MS=20000` 窗口内 < `SLOW_BYTES_PER_SEC=6000`）就 abort 该段并重排队，最多重试 3 次；进度按段高水位计，重试不重复计数也不倒退。
- [x] `work/test-remote-download.mjs` 扩到 **PASS 21/21**：新增「首轮只吐 5 KB/s 的段」用例，断言该段被丢弃、重取成功、整体没有被等满（< 180 s）；`test-studio-clean` 13/13、`test-server-page` 11/11、`check-hidden-windows` files=151 problems=0 全绿。
- [x] 带分段下载器重建发布：**83,751,712 B / sha256 `d72433918d5b402f8ed03594866ea236336894e1e119c0295fd72916b6cb7a22`**，删旧资产 743675234、上传 **id 745830063**；`assets.js` 同步、部署 050b0173；`/api/catalog` 实测 Studio 83,751,712 / `d72433918d5b`。
- [x] **无窗口端到端 STUDIO-HEADLESS PASS（2026-11-14）**：job `pwsh-ee96c6a1e0384b00` exit 0 —— 静默安装 Studio（101 文件 / 281,544,502 B）→ 起 `cli.js 7799` → `POST /v1/remote/install` 装 Server → **下载 78 s（83,716,680 B，sha256 `b6963536…a526` 校验通过）→ 安装 28 s → phase=done ok=true**，全程 **106 s**（旧代码同样一步要 30 分钟以上）；Server 装上 91 文件 / 281,229,603 B，两个卸载器 `/S` 均 exit 0、安装目录清空。
- [ ] 部署镜像 HEAD 改动并实测 `probeRange(mirror)` → `ranges:true size:83716680`。


## 2026-11-13 并行分片下载（Studio 在线安装提速，本轮）
- [x] 动因：GitHub 资产单流在本机约 16 KiB/s（83 MB 要一个半小时），在线安装实际不可用；资产主机支持 Range，改为 8 路分片。
- [x] `InfinityStudio/src/remote.js`：新增 `PARALLEL_MIN_BYTES = 8 * 1024 * 1024`、`PARALLEL_CONNECTIONS = 8`、`probeRange(url)`（HEAD 读 content-length / accept-ranges，20 s 超时）、`downloadParallel(url, part, size, onProgress)`（`fs.promises.open(part,'w')`，每片 `range: bytes=from-to` 要求 206，`handle.write(buffer,0,len,offset)` 定位写，末尾断言收满）、`downloadSingle(...)`（原单流抽成函数）；`download()` 先 probe，命中 Range 且 ≥ 8 MiB 走并行，任何异常删 `.part` 回落单流，最后仍做 sha256 校验再 rename。
- [x] 单测 `work/test-remote-download.mjs`（本地 http server 12 MiB+12,345 B 随机体，三种主机行为）：**REMOTE-DOWNLOAD-TEST PASS 13/13**，覆盖 range 请求数 ≥ 4、有 Range 时零全量请求、进度单调且收尾等于 size、无 `.part` 残留、二次调用 `cached:true`、无 Range 主机回落单流、坏哈希抛 `sha256 mismatch` 并清理。
- [x] 文档同步：`docs/DOWNLOADS-v1.0pre8.md` 第四节增并发下载说明、第五节限速条目改为「已用 8 路 Range 缓解但无镜像」、第六节列单测文件。
- [ ] 用并行版重建 Studio → 签名 → 重传资产 → 更新 catalog size/sha256 并重部署 → 复验 `/api/catalog` 与 `GET /v1/remote`。
- [ ] 真机验证并行下载对 GitHub 的实际吞吐；若仍不可用需考虑镜像。

## 2026-11-13 下载面收口：本地验证回退 + Studio 在线安装真跑通（本轮）
- [x] 网络定性（决定架构）：Turnstile 的挑战 iframe 主机 `hagen.challenges.cloudflare.com` 本机不可达（直连与 `--resolve` 104.18.8.208/104.18.9.208 均 15 s 超时；浏览器 `net::ERR_ABORTED`），而 `challenges.cloudflare.com/turnstile/v0/api.js` 是 302 可达 → 只挂 Turnstile 会让受限网络**所有下载不可用**。
- [x] 本地验证回退（Pages Functions，`work/pages-gate/functions/`）：`_lib/ticket.js`（b64url + HMAC-SHA256 + 定时安全比较 + `makeCode(5)`）、`_lib/captcha.js`（5x7 点阵 32 字形 + 手写 PNG 编码器 CRC32/IHDR/IDAT/IEND + CompressionStream）、`api/verify.js`（GET 发 `{challenge,image,expiresIn:180}`，challenge 只带 HMAC 不含明文；POST 比对后发绑定 asset 的 120 s 票据）、`dl/[asset].js`（先验 `?lt=` 再验 `?token=`，通过才 302；未知资产 404 `unknown_asset`）。
- [x] 验证页 `work/verify-gate/index.html`（7,817 B，部署 https://infinity-verify.pages.dev）：Turnstile 为主路径，6 s 看门狗 + onerror + error-callback 自动切本地验证面板（`?local=1` 直接进），面板含验证码图、输入框、确认并下载、换一张。
- [x] 端到端验收 `work/qa-local-gate.mjs`：自解码 PNG + 点阵模板匹配（jitter -3..3，满分 35）→ `recovered=CRP8V scores=35,35,35,35,35` → 换票 200 → 下载门 302 到 GitHub 资产 → 跨资产 403 `local_ticket_invalid` → 伪造票据 403 → **LOCAL-GATE PASS**（多次运行验证码随机：CRP8V / 8C6DT / EUEP4）。
- [x] 落地页：子智能体 landing-page 完成并发布，commit `bc14406ccb`，线上 200 / 6,436 B / 两张卡 / 两条 `infinity-verify.pages.dev` 链接 / 零 Turnstile / 零 github.com 链接（`LANDING PASS`）。
- [x] 下载门根页重写（`work/pages-gate/index.html`）：旧的页内遮罩版整页替换为「下载入口」两张卡（链到验证页），无 Turnstile、无直链；随 Functions 一起部署（deployment 88a19c64 / 2b69d2be）。
- [x] **真 bug 1**：`InfinityStudio/src/remote.js` 的 `DEFAULT_DL_BASE` 还是被 SNI 阻断的 `*.workers.dev` → 改为 `DL_BASES` 双主机按序尝试（`infinity-downloads.pages.dev` 优先，worker 兜底），`fetchCatalog` 逐个试并带 12 s 超时。
- [x] **真 bug 2**：下载文件按 catalog 的 asset 键命名（`InfinityServer-setup`，无扩展名）→ `spawn()` 报 `ENOENT` 装不上；新增 `fileNameOf(product)` 取资产 URL 的文件名（无则补 `.exe`），下载落 `InfinityServer_1.0.0-pre8_win64_setup.exe`。
- [x] Studio 在线安装端到端（`work/qa-studio-remote.{ps1,mjs}`）：`GET /v1/remote` base=pages.dev、两条产品；`POST /v1/remote/install {ids:['InfinityServer-setup']}` → 21 s 后 `results[0].ok=true code=0`，日志「下载（已缓存）→ 运行安装程序 /S → 安装完成」，**Infinity Server 真装上 91 文件 / 281,229,558 B**。
- [x] Studio 重打包与重发：`node InfinityStudio/build.mjs` + `tools/pack-electron.mjs studio`（含修复后的 src/remote.js，staged 校验 `fileNameOf=2`、`pages_base=1`）→ 未签名 83,735,229 B；签名（证书 `3C626CCE…4069C2`）后 **83,742,472 B / sha256 `7283a3f6a409ae4495a9de2e84eb006d35a8f4f9c6204006e308ebc49c5f5312`**，sig=Valid；`tools/publish-electron.mjs studio` 删旧资产 738942420、上传新资产 **id 742890015**（digest 与本地一致）。
- [x] 目录同步：`work/pages-gate/functions/api/catalog.js` 的 Studio size/sha256 改为新值并重部署 → `/api/catalog` 实测返回 83,742,472 / `7283a3f6…5312`；`/dl/InfinityStudio-setup` HTML 200、JSON 403 `turnstile_required`、根页 200 / 2,281 B。
- [x] 装好的 Studio 自证：`/S` 安装后 101 文件 / 281,535,099 B，起自身服务 `GET /v1/remote` → base=pages.dev、Studio 83,742,472 / Server 83,745,744 —— **发布的包里就是修好的代码**。
- [x] 窗口取证：Studio 的 Electron 主进程（`InfinityStudio/src/main.js`）自带窗口、不认 `INFINITY_SHELL_PROBE`（那是 InfinityViewer 外壳的开关）；改用 `PrintWindow`（PW_RENDERFULLCONTENT）抓 1080x720 窗口（`work/studio-window2.png` 15,760 B，不用前台抢焦点），OCR 读到「InfinityStudio / InfinityStudio Installer / 组件 套件 工作区 刷新 项目 子产品 在线安装 设置」。
- [x] 卸载清理：两个 Uninstall.exe /S 均 exit=0，安装根目录清空，下载缓存 `%LOCALAPPDATA%\Infinity\Studio\downloads` 已删。
- [x] 文档：新增 `docs/DOWNLOADS-v1.0pre8.md`（三域名分工、下载链路、Turnstile 受限网络实测、本地验证契约、Studio 在线安装规则、已知问题）。
- [ ] 遗留：GitHub 资产在本机被限速（10 s 0 字节 / Node 约 16 KiB/s），80 MB 包下载很慢，没有镜像；本地验证码可被点阵模板匹配破解；pre8 三应用（C++ 线 inc/ipm/int）发布链路仍未做。
- 工具坑：`dsh-browser` 在审批禁用下只有只读动作可用（`target.open`/`observe.*`/`inspect.*`），`act.fill`/`act.click` 被拒；fs-observation 要求完整读文件后才能 write/edit（会话重启后读状态会丢，需重读）。

## 2026-11-12 下载面重构：独立验证页 + 多域名 + Cloudflare 302
- [x] 用户指令：m02647 只提供 Infinity Studio / Infinity Server 下载、无源码链接、走 Cloudflare 302；m03070 所有页面加 Turnstile 且功能真跑通；m03279 人机验证做**单独页面**；m03280 页面**拆到多个域名**；m03281 多开子智能体并行。
- [x] 网络定性：`*.workers.dev` 在本机被 **SNI 阻断**（DNS 被污染到 157.240.2.36 / 199.96.62.21；`curl --resolve` 到 104.16.132.229 / 104.17.0.1 / 172.67.0.1 / 104.21.0.1 全部 `schannel: failed to receive handshake`）；`*.pages.dev`、netlify.app、azurewebsites.net、challenges.cloudflare.com 均可达。故下载门从 Worker 迁到 **Pages Functions**。
- [x] 资产上传：`tools/publish-electron.mjs` 的 uploadStream（node:https + 显式 content-length + 256 KiB 分块）真发成功——Studio asset id 738942420 / 83,773,072 B / digest `869fbb70…330f`，Server asset id 738942978 / 83,745,744 B / digest `129e4ec1…54a4`，URL 在 `zssx-2026/Infinity-Studio` 与 `zssx-2026/Infinity-Server` 的 `v1.0.0-pre8` release。
- [x] 下载门（`work/pages-gate/functions/api/catalog.js` + `functions/dl/[asset].js`）：`/api/catalog` 返回两条产品（asset/id/name/version/size/sha256/url/dl）；`/dl/<asset>` 无票返回 Turnstile 验证页、`siteverify` 通过才 302 到 GitHub 资产，否则 403 `turnstile_required` / `turnstile_failed`，未知资产 404 `unknown_asset`。实测：catalog 200 / 830 B，gate 200 / 1,588 B 含 turnstile，假票 403，`/dl/Nope` 404。
- [x] Pages 部署坑：`wrangler pages deploy work/pages-gate` 只传静态文件、Functions 不生效（wrangler 从 CWD 找 functions）→ 必须 `Push-Location work/pages-gate; wrangler pages deploy . --project-name infinity-downloads --branch main --commit-dirty=true`，看到 `Compiled Worker successfully` 才算部署。
- [x] Turnstile：worker 用旧 widget `0x4AAAAAAF8t6z1cwYgU47BZ`；pages.dev 用新 widget `0x4AAAAAAF-CBPThfL7uy0hi`（secret 以 Pages `TURNSTILE_SECRET` secret_text 存，未回显）。**widget 更新必须 PUT，PATCH 回 405 code 10405**；PUT 后 domains = infinity-downloads.pages.dev / infinity-studio-craft.github.io / infinity-verify.pages.dev / zssx-2026.github.io。
- [ ] 独立验证页 `https://infinity-verify.pages.dev`（子智能体 verify-page，写 `work/verify-gate/`）。
- [ ] 落地页改跳独立验证页并发布 GitHub Pages（子智能体 landing-page，写 `work/_org-pages/index.html`）。
- [ ] Studio 静默安装 QA + 在线安装端到端（子智能体 studio-qa，写 `work/qa-studio-*`）。
- [ ] 浏览器真过 Turnstile → 302 → 文件可下（dsh-browser 的 `script.evaluate` 在审批禁用下被拒，只能用 target.open / observe.read / act.click + Windows OCR 取证）。
- 工具坑：fs-observation 要求**完整读**文件后才能 write/edit（只读前几行不够）；PowerShell 写进 TS String.raw 时不能出现反引号。

## 2026-11-11 InfinityViewer 更名 + 内置下载管理器（本轮）
- [x] 更名：窗口标题与内部 UI 全改 `InfinityViewer`（`shell/main.js` 的 `title`、fatal 页标题/标题行、`work/webview2/ui` 11 个文件、console 前缀、`about` 文案），`work/patch-viewer.mjs` 一次性替换并复核命中清单。
- [x] 下载引擎 `shell/downloads.js`（CommonJS，16,780 B，零依赖）：HEAD 探测（>=400 退化为 `GET range: bytes=0-0`）→ `Accept-Ranges` 且 >256 KB 走 8 连接分片直写同一 fd、否则单流续传；队列持久化到 `userData/downloads.json`，重启把 running 降为 paused；重试 3 次退避、暂停/继续/取消/移除/清除已完成、速率与 ETA 由 500 ms tick 计算。
- [x] 引擎单测 `shell/download-test.mjs`（19 条断言）：本地 range 服务器 + 4,206,649 B 随机体，**DOWNLOAD-TEST PASS 19/19**（8 分片、sha256 与源一致、Content-Disposition 取名、HEAD-405 回退、暂停不增长、续传从 1,048,576 B 继续且哈希一致、重启恢复无 running）。修掉真 bug：续传时 `uniquePath` 换名导致旧字节被弃 → `it.file = it.file || self.uniquePath(it.name)`。
- [x] 宿主接管：`session.defaultSession.on('will-download')` 对 http(s) 一律 `item.cancel()` 后交给引擎，Chromium 自带下载面板不再出现；`viewer.download` 帧支持 list/start/pause/resume/cancel/remove/clear/open/folder，异常也回快照。
- [x] 面板 UI：工具栏 `#btn-downloads`（含 running 数角标）、右侧 `.dlpanel`（目录、粘贴地址、任务列表、速率/ETA/分片数、按钮组、清除已完成），i18n 两种语言各 23 条 `dl.*` 键；菜单「下载」改为直接开面板。
- [x] 端到端探针（真点按钮、真填地址、真落盘）：`INFINITY_SHELL_PROBE_DL` 驱动页面自己的工具栏与输入框，24 MB 慢速服务器 8 连接，中途快照 `probe.bin 6.5 MB / 24.0 MB · 2.9 MB/s · 6s · 8 连接`、角标 1，完成后文件 25,165,824 B 落 `%USERPROFILE%\Downloads\InfinityViewer`。证据 `work/viewer-dl.png` 115,363 B，OCR 读到「10.0 MB / 24.0 MB · 2.x MB/s · 7s · 8 连接 / 暂停 / 取消 / 移除 / 1 个任务」。
- [x] 无框窗口：`windowOptions` 增 `frame: false`，页面自绘标题栏（`shell.css` 的 `-webkit-app-region: drag` 与 cap 按钮）成为唯一标题栏，不再与原生框重复；探针 `windowActions` 五动作全真（minimize true / restore false / maximize true / restore false / new windows=2）。证据 `work/viewer-win.png` 75,912 B，探针 dpr=1.5、title `InfinityViewer`、origin `infinity-shell://ui`。
- [x] 契约自检扩到 **59 条全绿**（新增下载 13 条 + 无框 3 条 + `build.mjs` 必须随包发 `downloads.js`）。
- [x] 清理：删掉 `.pz-music*` 五条死 CSS 与 i18n 音乐键 8 处（`work/strip-music.mjs`）。
- [x] 构建：`INC_SHELL_ARCHES=x64 node shell/build.mjs` → 六个 x64 目录，每个 188,784,128 B；探针后已清 `%APPDATA%\infinity-shell` 与下载目录，无残留进程。

## 2026-11-11 v1.0pre7 收口（本轮）
- [x] 外壳接线（本轮核心）：`work/webview2/ui` 的 Edge 风格界面接进 Electron 窗口——`shell/preload.js` 改为唯一桥（`__INFINITY_HOST__.postMessage` → ipc），`shell/main.js` 新增 `serveChrome()`/`shellFrame()`/`windowCommand()`/`sessionFile()`；产品页面以 iframe 跑在外壳里。
- [x] 稳定 origin 修复：外壳页面原来由随机端口的 HTTP 服务提供，每次启动 origin 都变 → localStorage 全丢、会话恢复名存实亡。改为注册私有 scheme `infinity-shell://ui/index.html?render=iframe&url=…`，`protocol.handle` 从 `resources/app/ui` 读资源（路径穿越 403、`cache-control: no-store`），导航白名单只允许该 origin + `http://127.0.0.1:<port>/`。探针两次连跑：第一次 `hasSession=false`，第二次 `hasSession=true` —— 会话真的跨重启留下。
- [x] 窗口命令实证：page → preload → ipc → main → window 全链路，探针 `windowActions` = minimize(minimized=true) / restore(false) / maximize(maximized=true) / restore(false) / new(windows=2)。
- [x] 契约自检：`shell/verify-contract.mjs` 换成现架构的 35 条断言 → `SELFTEST PASS pass=35 fail=0`。
- [x] 版本串统一 pre7：`cpp/core/src/github.cpp:8`、`cpp/tools/{build,package,manifest,publish,sha256sums}.mjs` 默认值、`cpp/apps/int/int-offline.test.mjs:48` 断言；`publish.mjs` 内联兜底发行说明改写为 pre7。
- [x] 构建：`work/build-pre7.ps1` → inc 1,584,640 B / ipm 685,056 B / int 693,760 B，六个 x64 Electron 目录各 188,784,128 B（ia32/arm64 误建后已删，磁盘余 117 GB）。
- [x] 安装包（`work/package-pre7.ps1`，NSIS solid LZMA + Authenticode）：InfinityCloud **84,170,280 B**（sha256 `1c662e19…deee0`）、InfinityPackageManager **83,968,776 B**（`70562392…d59c`）、InfinityToolbox **84,025,408 B**（`52f3b731…45f5`），合计 252,164,464 B，三包签名均 Valid（指纹 `3C626CCE1DFA8833F844BA176DB1922B7B4069C2`）。
- [x] 安装 QA（`work/qa-pre7-install.ps1`，修掉两处脚本缺陷：PS 5.1 默认 ANSI 读探针 JSON 导致 `ConvertFrom-Json` 抛 ArgumentException → 改 `[System.IO.File]::ReadAllText($json, UTF8)`；上一轮中断残留的安装目录未清 → 开头先删 Programs 目录）→ **PRE7-INSTALL-QA PASS 3/3**：三次静默安装 exit=0、payload 三件齐全、探针 dpr=1.5 / title `Infinity Edge Shell` / origin `infinity-shell://ui` / tabCount=1 / frameSrc 分别 7621·7632·7653、截图 74,572 / 78,901 / 54,558 B、卸载后目录消失。安装后实测 96 文件 / 292,437,898 B（278.9 MB）。
- [x] OCR 复核（`work/ocr-any.ps1`）：qa7-inc 读到「侧栏 / 搜索标签页 / 应用 / 垂直标签页 / 游玩区 / 设置」外壳 + 框内 inc 首启令牌页；qa7-int 读到外壳 + 7653 地址栏。
- [x] 发布：三仓库真发，release id 441550619 / 441550969 / 441551558，asset id 735127897 / 735129198 / 735130840，远端 digest 与本地 sha256 逐字符一致，`published 3 installer(s) as v1.0.0-pre7, 0 failure(s)`；`work/patch-release-body-pre7.mjs` 把三份 release 正文 PATCH 成修订后的 2,873 字符版本（match=true）。
- [x] 发行说明：`docs/RELEASE-v1.0pre7-body.md`（4,777 B）+ `docs/RELEASE-v1.0pre7.md`（6,822 B 仓库副本，含「七、IPM 目录与 name.txt」「八、相关文件」）。已知问题里明确写了「地址栏搜索还是占位」（`shell.search` 宿主只回执、没接搜索引擎）。
- [x] IPM 目录页：`work/catalog-pre7.mjs` → 上传三 pre7 包（id 735139186 / 735143058 / 735143782）、删三 pre6 包、name.txt 重传（620 B / id 735144531），**FINAL assets=7 / failed=0**；`catalog-verify-pre7.ps1` 跑 `ipm_cli search Infinity` → 6 条，inc/ipm/int 指向 pre7。
- [x] 官网：`work/_org-pages/index.html` 全量改 `v1.0.0-pre7`，`node work/_org-pages/publish.mjs` 提交 **93a19d604981ea1dc69348755e8c3acc0ba5c8ae**（tree e389c54d1a，parent 6951835412），Pages 首次 errored 后转 built；实测 200 / 5,531 B / pre7×5、pre6×0、pre4×3。`web/infinity/assets/site.js:168` RELEASE_TAG 改 pre7。
- [x] 事故记录：`tools.read` 读 `web/infinity/assets/site.js` 只返回 51,163 B（真实 64,504 B），整文件回写丢了 451 行、`node --check` 报 `SyntaxError: Unexpected end of input`；已 `git checkout --` 还原，改用 `work/site-tag-pre7.mjs`（Node fs 只替换两处）→ 字节不变、diff 2 行。**教训：整文件改写一律走 Node fs，不要拿 tools.read 的输出回写。**
- [x] README 更新到 pre7（289 行 / 16,704 B）：版本串全量替换、外壳说明改 pre7、安装包合计改 252,164,464、文件名示例改 pre7。
- [x] name.txt / 校验：`node work/nametxt-cross.mjs cpp/release/v1.0pre7 1.0.0-pre4` → 六行 620 B / sha256 `5b54247f071145a0436377a72d2953fddffd14dee953d61ec79bf445380bde05`；`sha256sums.mjs` → SHA256SUMS.txt 493 B（含三安装包 + name.txt + release-assets.json）。

## 2026-11-11 v1.0pre6 收口（本轮）
- [x] 发布：三仓库真发，asset id 734976887 / 734977795 / 734978673，84,211,080 / 83,935,056 / 83,923,176 B，远端 digest 与本地 sha256 逐字符一致（e9f6fdad…80db / 721f4dcc…7b20 / b76a8444…d971），`published 3 installer(s) as v1.0.0-pre6, 0 failure(s)`。
- [x] 发行说明：`docs/RELEASE-v1.0pre6-body.md`（8,292 B，GitHub Release 正文）+ `docs/RELEASE-v1.0pre6.md`（8,355 B，仓库内副本，README 链接到它）。
- [x] IPM 目录页：`work/catalog-pre6.mjs` → FINAL assets=7 / failed=0（三 pre6 包 + 三 pre4 包 + name.txt 620 B，三 pre5 包已删）；`ipm_cli search Infinity` 6 条、`info InfinityCloud`/`info InfinityToolbox` 均指向 pre6 下载地址。
- [x] 官网：`work/_org-pages/index.html` 三卡片改 `releases/tag/v1.0.0-pre6`，commit 4756fe45e8（tree 8297fdeae7），Pages 首次 errored 后 75 s 转 built；实测 200 / 5,529 B / pre6×5、pre5×0、pre4×3。`web/infinity/assets/site.js:168` 的 RELEASE_TAG 同步 pre6。
- [x] 下载回验（公开地址，不靠本地文件）：Cloud / PackageManager / Toolbox 3/3 QA-OK，字节数与 sha256 全部一致（`work/qa-pre6-download5.ps1` + 日志 `work/qa-pre6-download5.log`）。
- [x] 界面证据：`work/qa-inc.png` 28,469 B、`work/qa-ipm.png` 32,096 B（首启令牌页）、`work/qa-int.png` 56,890 B（真实产品页），三次探针 devicePixelRatio 均 1.5。
- [x] README 更新到 pre6（289 行，双语）：三应用表补 Infinity Toolbox、pre5→pre6 全量替换、新增「实现选择」小节、发布目录默认值改 v1.0pre6。
- [x] 新增 `docs/ENGINEERING-RULES.md`（5,026 B）：语言选择（C++/Rust 默认、汇编仅测量过的热点、Python 做无速度要求的部分、Node ESM 只做构建脚本）、「页面不是回答」界面原则、自包含交付、验收标准、「重建即改字节」发布纪律。
- [x] `cpp/tools` 默认版本统一 pre6：build.mjs / package.mjs / manifest.mjs / publish.mjs / sha256sums.mjs 的默认值由 v1.0pre5/1.0.0-pre5 改 v1.0pre6/1.0.0-pre6，publish.mjs 的内联兜底发行说明改写为 pre6 三应用；五个脚本 `node --check` 全通过，`node cpp/tools/manifest.mjs` 重跑产出与发布版一致（release-assets.json sha c77182fb… 不变）。
- [x] name.txt 跨版本合并固化为 `work/nametxt-cross.mjs`：按六产品历史顺序合并、CRLF 行尾，重跑得 620 B / sha `7fca9475aa4bda6b9e71d91db41343eac7658f9296ec7fb76774b8776aefdc37`，与目录页在架文件逐字节一致——修掉「manifest.mjs 重跑会把旧版本三条目录行删掉」的隐患（本轮就发生过一次，已用 `work/restore-nametxt.mjs` 从目录页按资产 id 735001151 还原并核对 sha）。
- [x] SHA256SUMS.txt 重算（493 B，含三安装包 + name.txt + release-assets.json）。
- [x] 源码同步：`work/ghsync-source.mjs --push` 两次推送，远端 HEAD `f1172a82` → `56fb7db0`（227 文件）→ `57232ddc`（3 文件：dist 镜像脚本 + 两份 JSON 之外的文档改动）→ `ed34e231`（ghsync 自身）；快照 828 文件 / 38,270,085 B，verify_blobs=930，key_check 全 match（`cpp/apps/ifm|iim|ing/main.cpp` 两边都不存在，属已退役产品）。用 blob sha 复核：README / docs/ENGINEERING-RULES.md / docs/RELEASE-v1.0pre6.md / work/TASKS.md / work/dist-refresh.mjs 远端与本地逐字节一致。`dist/` 整个目录在 `.gitignore:37` 里，所以那两份镜像 JSON 只存在于本机，不会被快照带走（本轮试过给 ghsync 加白名单，确认无效后已回退）。
- [x] `dist/url.json` 与 `dist/applist.json` 刷新到实况（新增 `work/dist-refresh.mjs`，只读 GitHub 目录页、不上传）：8 个 release / 33 个包 / 35 个文件，url.json 141,600 B、applist.json 29,934 B。顺带修掉旧镜像的解析错误——Infinity 目录行第二列是公司名（`Infinity.Inc`），旧解析器把它当成版本号，所以六个产品全显示 `@Infinity.Inc`；新解析器对非数字版本回退到文件名里的版本，现为 Cloud/PackageManager/Toolbox `1.0.0-pre6`、FileManager/InstallerManager/Games `1.0.0-pre4`。注意 `dist/` 被 `.gitignore:37` 忽略，这两份 JSON 只是本机镜像，不进源码仓库。

## 2026-10-25 登录验证 Cloudflare Worker（本轮）
- [x] auth-worker/：worker.zh.mjs + worker.en.mjs（双版同逻辑）。人机验证服务端化：挑战 HMAC 签名（prefix|bits|expires|email），register 服务端复核 sha256(prefix+nonce) 前 32 位 < 2^(32-bits)，防重放/防调难度/绑定邮箱，可选 Turnstile；GitHub OAuth：state Cookie + code 换 token + #token fragment 回传；auth-data PR 状态机：建分支→提交 users/<email>.json（含 verifyToken）→开 PR→Actions 双语邮件→/api/verify 比对 token→squash 合并激活+分支清理。
- [x] e2e.test.mjs：mock GitHub API 端到端 22 断言×2 版全 PASS。
- [x] auth-data.workflow.yml、wrangler.toml、需求.md（双语需求书，工作区根）。
- [ ] 待办：用户按需求书部署后接线前端 login/signup。

## 2026-10-05 历史归档追加（本轮）
- [x] 会话日志压缩追加：24 个日志（主会话 + 23 个子智能体）83.84 MiB → 9.25 MiB（11.03%），归档 276,969,754 → 286,666,513 B、条目 26,354 → 26,378、块 85 → 91。
- [x] append-only 工具 work/sync-history.mjs（含排他锁）+ 状态 work/history-sync-state.json；头部新增 snapshots/appended[]。
- [x] 独立验证：追加段导出后 restore-history.ps1 还原 24/24 完全一致；全归档抽样 505/505 完全一致（0 不匹配）。
- [x] 持续同步：计划任务 InfinityInc-SyncHistory 每 15 分钟跑 work\sync-history.cmd；详见 work/history-append-report.md。
- [x] 找到 DSH 实时会话库 ~/.dsh/sessions/…/*.jsonl.zstd（多帧 zstd，需逐帧解码）；sync-history.mjs v2 起按增量分片追加实时日志：全量 21.13 MiB→2.27 MiB，增量 39,872 B→7,681 B，独立还原 5/5、2/2 完全一致。
- [x] task-1 INC 远端流式预览：prod-cloud 实现，Lead 独立跑 run-tests.ps1 -With8s 退出码 0（RESULT failures=0），报告 work/preview-inc-report.md。
- [x] task-2 IFM 本地流式预览：prod-ifm 实现，Lead 独立复跑 check-page/bundle-check/preview-http-check/preview-bench 全 0，报告 work/preview-ifm-report.md。
- ING 由另一个 Agent 负责，本线未触碰。

## 已完成
- [x] 历史压缩：1386.5 MB → 264.14 MB（19.05%），原 26355 个文件 + 4769 空目录已删；三方独立验证（Lead 全量还原比对 26354/26354、hist-verifier 内容层 26354/26354、hist-restorer 全量+抽样还原 26354/26354）。
- [x] 归档头元数据修复：补 uniqueBytes=1343363336 / blobs=23012 / root 与清单一致；sha256 b136ec6f90bb355528bd32e1a8a31d71c93dcf9cb6854c9521ec2376fb7ce4cf，大小 276,969,754 B。
- [x] v1.0pre4 六应用发布：6 仓库各 1 个资产，回下载 sha256 四方一致（rel-publish 报告）。
- [x] IPM 目录刷新 application-inc（rel-catalog 报告）；dist/url.json、applist.json 同步。
- [x] 官网发布（commit ad0b0662ea8b，47 文件）：语言切换 BASE_PATH 修复、/infinity/** 缺失→/404、6 张下载卡片；cn/settings 与 cn/run 已从 404 变 200。
- [x] 文档：README.md（109 行）+ work/rel-notes-v1.0pre4.md（49 行）。
- [x] task-3/4/5/6/7/8 完成，报告齐备。
- [x] 独立 QA（子智能体）：8 项检查全 PASS，无 FAIL（work/qa-report.md）。
- [x] 澄清 _gui 真相：cpp/out/<p>/<p>_gui.exe 与 <p>_cli.exe 同哈希同二进制（程序按自身文件名判面）；INC 的 gui 面是原生 Win32 窗口（cpp/apps/inc/main.cpp GuiState/HWND），其余应用 gui 面只起 HTTP UI 服务等外部窗口。
- [ ] task-14 下载卡片显式 tag（proj-web 执行中）。

## 待办（按顺序）
1. [x] hist-verifier 独立全量验证 PASS（26354/26354、header 0 问题、manifest 全 PASS；仅 chunk #75 为已声明的首包尾块 WARN）→ task-1 完成。
2. 源码仓库同步：work/ghsync.mjs 的 CPP_ASSETS 仍指 v1.0pre3 四应用（会把 pre4 覆盖回 pre3、删掉新 name.txt）；需先改到 v1.0pre4 六应用再推送 zssx-2026/Infinity.inc（远端 HEAD 还停在 2026-10-02 7b189e41）。
3. 下载卡片链接：目前指向 <repo>/releases/latest，三个老仓库会解析到旧稳定版 v1.0pre1（C++ 版是 prerelease）；应改为显式 tag /releases/tag/v1.0.0-pre4。
4. 安装包图标：proj-inc 查明 v1.0pre4 载荷 0 个 .ico、setup.nsi 无 MUI_ICON/DisplayIcon；icons/ 下 6 产品图标已就绪，需接入下一步版本。
5. _gui.exe 同名冲突：cpp/out/<p>_gui.exe 是 C++ stub（514,560 B），Electron 版是 shell/build/<p>_gui-win32-x64 下 268 MB 目录；由第 7 项（精简 Chromium 外壳）取代/改名。

## 用户新需求（排在最后）
30. [进行中] 邮件验证用于注册与登录 + 2FA（离线 TOTP、本地二维码、恢复码）→ 并入 task-30/proj-web。
29. [进行中] 流式预览（边下边看）部分类型文件：INC 远端 Range → task-32/prod-cloud；IFM 本地随机读 → task-33/prod-ifm（统一契约：256 KiB 分块、首屏 ≤800 ms、关闭即取消、内存 ≤64 MiB）。
28. [待触发] task-31：等 task-19..24 + task-26 完成后统一重建 v1.0pre5 发行产物（含图标、自解锁、性能优化），避免把中间态发出去。
27. [进行中] 不依赖后端实现邮件验证与“存储所有信息”：本地加密账户库 + GitHub Device Flow 真实验证 + mailto 自助验证（self-attested，Ed25519 离线可验）+ 导出/导入 → task-30/proj-web。
24. [进行中] 每个用 Chromium 的应用一份自己的 Chromium 副本，路径 /Chormium/应用名（INC/IFM/ITB/ING/IIM/IPM 全用）→ task-29/edge-ui。
25. [已做] 工作区清理：删除 20 个 Edge headless 临时 profile、CEF 未压缩 tar、Piik-stage、杂项，释放 398.1 MB（D: 59.1 GB 可用）。
26. [已上线] token 仅限 INC、只显示本浏览器创建的密钥、创建后默认明文可反复复制（commit 6461ba932ca2）→ 复验 task-28/proj-web。
17. [已上线] 加载中＝顶部横穿页面的加载条（类似 GitHub），屏幕中间不转圈；加载页无 UI；深色纯黑/浅色纯白。
18. [已上线] 下载分类：exe 安装包 / Windows msi / 便携版 zip / 源代码 zip / 源代码 zst；平台简称（Win16/32/64/X86、WinARM、Linux16/32/64/X86、Mac16/32/64/X86）可切换。
19. [已上线] 对话式去弹窗：guard 遮罩删除、token 删除改二次点击、原生 confirm 全部移除。
20. [已上线] 删除 /error 页面；验证不通过强制跳 404；人机验证覆盖所有子页面（404 除外）。
21. [进行中] 下载页只显示 1 年内（UTC）版本；更早版本 → /versions/archive（中英），归档只按平台分组、提供 .zst → task-25/rel-catalog。
22. [进行中] 文件安全：公布 SHA-256 + verify-download.ps1（校验并 Unblock-File）；后续让 IPM 安装前校验摘要。
23. [进行中] 每产品专属性能智能体（可再召唤子智能体）→ task-19..24 / prod-cloud,ifm,ipm,iim,int,ing。
16. [进行中] Chromium 内核应用不要固定主页：首次打开显示为新标签页（新标签页做成 Edge 风格：搜索框/常用站点/品牌色）→ task-13/edge-ui。
13. [进行中] Token Key：/infinity/myself/token 与 /infinity/cn/myself/token 页面可查看/创建/删除/重新生成 token，并支持用 token key 接入我们的应用 → task-18/proj-web。
14. [进行中] 优化各大产品性能 → 6 个产品专属智能体（prod-cloud/filemanager/packagemanager/installermanager/toolbox/games），各自可再召唤子智能体。
15. [进行中] 组织结构：每个产品交给一个专属子代理，子代理可自行召唤下级子代理为产品工作。
11. [进行中] Chromium 内核应用：关闭时自动保存当前标签页（会话恢复，仅 Chromium 内核版）；可创建“游玩区”（一个窗口只能开一个），游玩区可自定义配色方案、主题、背景音乐 → task-13/edge-ui。
12. [进行中] 下载界面重建（用户：全被搞坏了）：按版本/类型/平台分组，版本默认折叠、点击展开；平台可切换 → task-17/proj-web。
10. [进行中] Chromium 内核应用的功能要求（已转给 task-13 的 UI 子智能体 471c3210）：① 与 Edge 相似的 UI；② 标签页带（切换/新建/关闭的）动画效果。
9. [部分完成] Gitee 源码：查证 gitee 无公开 Chromium 镜像（mirrors/chromium 页面 405、archive 403、API tarball 404；gitee.com/mirrors 列表里无 chromium）；可访问的 gitee Chromium 仓库只有 OpenHarmony 的第三方适配仓（API tarball 12,811,174 B，解出 22 文件/43.7 MB，是 patch+build 脚本而非完整源码）→ 已下载解包到 D:\dev\Chormium\gitee-chromium。完整源码改用 Google 官方公开桶 storage.googleapis.com/chromium-browser-official（最新 chromium-141.0.7340.2，约 6.3 GB），已后台下载到 D:\dev\Chormium。另：本机 git 传输对大仓 malloc 失败（rel-publish 也遇到），故走 tarball/API 而非 git clone。
6. IPM Applications：把 D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\IPM Applications\once_power（Flutter，3.1.3+0，约 90 MB）与 Piik（piik-app.exe 46 MB + runtime/native/piik-capture.exe + runtime/tunnel/cloudflared.exe 54 MB）分别打包，并注册为 applications 仓库里公开可下载的 IPM 包（一页一 Release + name.txt）。
7. 精简 Chromium 内核：为 INC、ITB、IIM、IFM 各定制一份精简内核（精简工作交给专门子智能体），并模仿 Edge 的 UI。已确认：本机有 Edge/WebView2 154.0.4258.53；cef-builds.spotifycdn.com 与 chromium-browser-snapshots 可达；C: 59.1 GB / D: 79.5 GB 可用；无 Chromium 源码树（本机无法从源码构建 Chromium）。
8. ITB Tools：D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\ITB Tools\ 目前只有 "rename to InfinityProxy/session.v4.jsonl"（6.4 MB，是一份 DSH 会话记录，主题是 fastbrowser/FastGithub 代理工具，不含工具二进制）。需确认工具本体位置（会话里出现 D:\dev\DeepSeekHarnessWorkspace\fastbrowser\fastbrowser.exe、temp/src/fastbrowser.cpp、fastgithub_sourcecode/），再用 C++ 打包成 .itbt 工具二进制。

## 新增（本轮）
- [已完成] task-12 外壳换代（2026-11-08）：自建精简内核不成立（CEF 324.87 MiB/应用 > Electron 268.05 MiB），改采 WebView2 宿主（自身 452,114 B，系统 Evergreen 157.0.4341.42）。cpp/hosts/webview2/main.c 增 shell 模式（--show/--title/--spawn/--app/--port/--wait-ms，CreateProcessW + Job Object 关窗即杀）；package.mjs 增 INC_SHELL=webview2（载荷加 _window.exe + WebView2Loader.dll + ui/，快捷方式带 --app/--port/--show/--title）。三产品静默安装实证：665,288 / 436,840 / 452,256 B，快捷方式与载荷正确，宿主 exit 0 无残留，卸载清零。命令：INC_RELEASE=v1.0pre5 INC_SHELL=webview2 node cpp/tools/package.mjs
- [进行中] task-13 仿 Edge UI（子智能体 471c3210）
- [进行中] task-15 .itbt 容器 + Toolbox 加载（2026-11-08 更新）：packer cpp/tools/itbt/itbt-pack.cpp 编译零错（MinGW g++ -std=c++17，work/itbt-pack.exe 195,815 B）；round-trip 实证 pack→独立 Node 校验器 work/itbt-verify.mjs 19/19 PASS（魔数/小端/entry 表连续/逐条 sha256/item.json 在位）。本 MinGW 无 zlib.h（仅 zlib1.dll 无导入库）→ deflate 缓行，store 模式为准，packer 对 --deflate 有明确降级警告。Toolbox 加载侧（plugin list/install/verify + itbt_container 共享实现）由子智能体 int-toolbox-dev 进行中。坑：本会话 run_code 的 os.tmpdir() 返回相对路径 undefined\temp，临时文件一律用工作区显式路径。
- [进行中] task-11 IPM 打包 once_power/Piik（rel-catalog）
- [已完成] ghsync 修 CPP_ASSETS + 源码仓库同步（rel-publish）：git HTTPS 到 github.com 被阻断（Connection was reset / 443 超时），改走 Git Data API 推送；仓库瘦身 7900 文件/1739.5 MB → 697 文件/51,772,524 B（.gitignore 新增 never-publish 段排除 Chormium/、Python/、work/chromium-trim/、work/_retired-products/、IPM Applications/ 等）；用 git cat-file blob 取索引内容上传（磁盘字节受 CRLF 归一化影响会不一致）；最终 ref main = 3047bcda1f86，远端 tree 48b5be07… 与本地 HEAD^{tree} 完全一致，697 blobs，仓库公开、size 2435 KB、pushed_at 2026-11-08T10:40:18Z。凭据取自 Windows 凭据管理器（git credential fill），未落盘未回显。
- [完成] work/PLAN-v1.0pre5.md（下一版本计划：Chromium 外壳、图标、IPM 扩展、ITB 容器）
- [已完成] 组织主页 404 修复（2026-11-10）：Infinity-Studio-craft 原 0 仓库 → 新建 infinity-studio-craft.github.io，Git Data API 推 index.html（4,673 B），Pages 启用（source main /，build_type legacy）。首轮 build errored 系建仓即触发、内容未落地；补推后 status=built。实测 https://infinity-studio-craft.github.io/ 返回 200、4,673 B、标题「Infinity.Studio — 一套自己的工具链」。
- [已完成] v1.0pre5 三包带 WebView2 外壳重建（2026-11-10）：InfinityCloud 671,016 B / InfinityPackageManager 436,840 B / InfinityToolbox 452,256 B，三包 signed Valid；release-assets.json 与 SHA256SUMS.txt 按实际文件重算（sha256 502edbae… / ab37f574… / efd3466d…）。
- [已完成] v1.0.0-pre5 正式发布（2026-11-10）：cpp/tools/publish.mjs 真发三仓库 —— Infinity-Cloud asset 730958201、InfinityPackageManager 730958421、Infinity-Toolbox 730958668，均 prerelease=true、draft=false，远端 digest 与本地 sha256 逐字符一致；独立 QA 用公开 browser_download_url 下载回验 3/3 QA-OK（work/qa-pre5-download.ps1）。
- [已完成] 发行说明重写：docs/RELEASE-v1.0pre5-body.md 由旧六应用稿改为实际三应用稿（WebView2 外壳、图标、退出码 20、三包字节/哈希、1,560,112 B 合计），随发布上传，三仓库 Release 正文各 4,771 字符。
- [已完成] IPM 目录页刷新（work/catalog-pre5.mjs）：applications/application-inc 页上传 3 个 pre5 包、替换 name.txt（614 B，3 条 pre5 + 3 条 pre4）、删除 3 个 pre4 旧包，终态 6 包 + name.txt；name.txt 同步为 6 行跨版本清单，SHA256SUMS 重算（name.txt 38803657…）。
- [已完成] 目录端到端验证：用已发布 cpp/out/ipm/ipm_cli.exe（带 token）实测 search Infinity 列出 6 条 —— inc/ipm/int 为 1.0.0-pre5，ifm/iim/ing 为 1.0.0-pre4；info InfinityCloud / InfinityToolbox 均命中 pre5 下载地址。
- [已完成] 组织主页下载卡片改为显式 tag（work/_org-pages/index.html）：inc/ipm/int → /releases/tag/v1.0.0-pre5，ifm/iim/ing → /releases/tag/v1.0.0-pre4；重发 commit b40cc0fe02，Pages status=built，实测 200、4,789 字符、含 4 处 pre5 与 3 处 pre4 链接。
- [待办] dist/url.json 与 dist/applist.json 仍是 2026-10-06 快照（Node IPM 旧产品线的目录镜像），本次未改；C++ IPM 直读 GitHub 目录页，不受影响。

## 新增（2026-10-25 晚：官网根化 + 下载门禁 + 备份）
- [已完成] 官网 URL 根化：16 目录退役（.retired- 同盘改名），保留 10 页（/ cn/ download/ download/infinitycloud/ download/infinitypackagemanager/ cloud/ 双语），sitemap 10 URL + robots 重建，404 智能剥 /infinity 前缀。
- [已完成] 站点脚本适配全绿：site-seo-apply（12 页/10 URL）、site-seo-verify（PASS 12/12，服务器改从 web/infinity 伺服）、site-release-consistency（26 checks 0 fail，退役产品豁免比较）、verify-contract 自测 25 pass。
- [已完成] worker v2 下载门禁三端点 /api/gate、/api/gate/verify、/api/dl（scope 绑定 PoW 签名 + g1 短票据 HMAC + DL_MAP 直链 302），worker.zh/en 同步，e2e 29×2 全绿。
- [已完成] download.js 门禁客户端：仅 GitHub setup 直链走 PoW 挑战→票据→/api/dl，worker 不可达自动回退直下；msi/zip/源码与 Gitee 镜像直下。
- [已完成] 工作区最小化：infinity-ops.mjs clean --apply（temp 全部 + work/archive → .retired- 改名保恢复）。
- [进行中] 实时备份：infinity-ops.mjs backup --watch → github backup 仓库 Releases（tag workspace-backup，首轮 4809 文件/3.15 GB，大文件>64MB 与 .retired- 路径自动跳过）。

## 新增（2026-11-01 晚：Infinity Studio 全家桶改造）
- [已完成] InfinityStudio 模块层：suite.js（8 分支/38 组件/39 codecs/版本语义）、hosts.js（15 宿主探测）、project.js（ISCP 容器 v2，.is-ccp/.is-ccpx）、workspace.js（.is-ws）、associate.js（HKCU 文件关联计划）。
- [已完成] InfinityStudio/src/page.js：四视图单页（组件树/工作区/项目/设置），51 语言、零外链、内联 CSS+JS，实测渲染 54,877 字符、script 编译通过。
- [已完成] InfinityStudio/src/server.js hub 接线（27,130 → 32,812 B）：新增 /v1/suite、/v1/suite/install、/v1/suite/remove、/v1/hosts、/v1/project/create|open、/v1/workspace/create|load、/v1/associate；页面路由改 renderPage。
- [已完成] 测试：work/suite-hub-test.mjs 41/41 PASS、work/infinitystudio-test.mjs 56/56 PASS、work/project-smoke.mjs 113/113 PASS。
- [已完成] InfinityStudio/src/apps/CONTRACT.md：子产品模块契约（META/capabilities/plan/run，零依赖，冒烟脚本命名规范）。
- [进行中] 子产品模块（每个子产品一个子智能体）：codecraft / videocraft / picturecraft / 3dcraft / aicraft（task-5..task-9）。
- [已完成] apps/*.js 接入 server.js 与 page.js（2026-11-08）：套件树 craft.* 组件渲染「进入」按钮（未安装模块显示「未接入」），点击切到子产品视图并自动展开 capabilities 详情；page.js 新增 appForComponent/state.appOk/state.pendingApp。验收：suite-hub-test 45/45（新增 4 断言：入口接线、注册表服务、craft↔组件双射）、infinitystudio-test 56/56、project-smoke 113/113、渲染内联脚本编译通过（50,287 字符）。
- [待办] work/TASKS.md 之外的其余子产品：webviewer / office / packages / integrations / server 本体模块。
- [阻塞] 组织迁移：zssx-2026 非 Infinity 组织成员，POST /orgs/Infinity/repos 403，需用户授权。
