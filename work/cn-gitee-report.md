# task-21 报告：中文官网内容全部改走 Gitee（英文站保持 GitHub）

- 负责人：cn-gitee
- 日期：2026-10-06（Asia/Shanghai）
- 工作区：D:\dev\DeepSeekHarnessWorkspace\Infinity.inc
- 结论一句话：**内容源分离机制已实现并独立验证通过（61/61，退出码 0）**；但 **Gitee 上并不存在六个产品的公开镜像仓**，匿名只读探测只证实 zssx2026/applications（与无关的 Sink）存在，其余名字 404。因此中文站当前会“按规则只读 Gitee”，在镜像补齐前中文下载/文档会不可用；需要人类确认映射表并创建镜像。详见第 5、6 节。

---

## 1. 任务口径与实现摘要

用户口径：中文官网（/infinity/cn/**，页面本身仍托管在 GitHub Pages）的**内容**必须全部来自 Gitee；英文官网内容全部来自 GitHub。

实现方式：新增一个“内容源解析”模块，按站点既有的语言规则（路径含 /cn/ → 中文）返回 `{api, web, raw, owner}`；assets 里所有内容请求与内容链接都改为向它取源，不再写死主机名。

### 1.1 源映射表

| 语言 | 判定 | api（仓库 API 基址） | web（账号/发布页） | raw（原始文件） | owner |
|---|---|---|---|---|---|
| 英文 | 路径不含 /cn/ 且 html lang 不以 zh 开头 | https://api.github.com/repos/zssx-2026/ | https://github.com/zssx-2026 | https://raw.githubusercontent.com/zssx-2026/ | zssx-2026 |
| 中文 | 路径含 /cn/ 或 html lang 以 zh 开头 | https://gitee.com/api/v5/repos/zssx2026/ | https://gitee.com/zssx2026 | https://gitee.com/zssx2026/<repo>/raw/main/ | zssx2026 |

派生 URL：`releasesApi(repo)`、`releasePage(repo,tag)`、`assetUrl(repo,tag,name)`、`contentsApi(repo,path,ref)`、`rawUrl(repo,path,ref)`；以及 `mirror(url,lang)`（GitHub↔Gitee 的 owner 页/REST 基址/raw 三种形态互转，只动本项目账号范围，不动 github.com/settings 等第三方/账号链接）和 `normalizeReleases(list,repo,lang)`（把 Gitee release 折成页面已在读的 GitHub 形状）。

**明确的例外（不静默跨源）**：账号/令牌接口（`/user`、`/user/repos`、gists、GitHub device flow、邮箱验证）在两种语言下**仍走 api.github.com / github.com**。原因：套件的数据存放在 GitHub release，且只有 GitHub 令牌能被这些接口接受；Gitee 没有等价接口。该例外已写进中文可见文案（见 2.3），不是静默行为。

### 1.2 本地快照

`web/infinity/assets/releases.json` **未改动**，仍是离线回退（中英都用）：download.js 先读它，读不到该仓库才向本语言的源发实时请求；archive.js 只读它。中文态读快照时，其中的 GitHub URL 会经 `mirror()` 解析为 Gitee。

---

## 2. 改动清单（含前后）

只改动了 `web/infinity/assets/**`、`web/infinity/cn/**`、`work/cn-gitee-verify.mjs`、`work/cn-gitee-report.md`。本次 task-21 未改动任何英文页面（en 的 19 个 .html 均未编辑）；未触碰 ING/Infinity Games 源码仓、history/、work/sync-history.mjs。

### 2.1 新增：web/infinity/assets/sources.js（新文件，8923 字节）

- 挂 `window.INFINITY.source(lang)` → `{api,web,raw,owner}` + 构造器；挂 `window.INFINITY.sources`（github/gitee 两视图、mirror、normalizeReleases、hostOf、OWNER、detectLang）。
- 语言判定与 i18n.js/site.js 完全同规则（/cn/ 路径优先，其次 html lang）。

### 2.2 assets/site.js（63258 字节；唯一被改的共享脚本）

| 位置 | 前 | 后 |
|---|---|---|
| IIFE 顶部 | 无 `I` 变量（处处 window.INFINITY） | 新增 `var I = window.INFINITY = window.INFINITY || {};` |
| 新增 | — | `fallbackSource()`：未加载 sources.js 的页面也拿到同样的四要素与构造器；`fallbackMirror()`/`fallbackNormalize()`；`source()` 优先 `I.sources.source()`；未加载 sources.js 时安装等价的 `I.sources` |
| `gh(path)` | 一律 `fetch('https://api.github.com' + path)` | `/repos/**` 内容请求 → `s.apiRoot + path`（owner 由 zssx-2026 改写为 s.owner）；其余（`/user` 等）→ `'https://api.github.com' + path` |
| `releases(repo)` | `gh('/repos/zssx-2026/'+repo+'/releases?per_page=30')` | `gh('/repos/'+s.owner+'/'+repo+'/releases?per_page=30')`，Gitee 时经 `normalizeReleases` |
| `repoInfo(repo)` | 写死 owner | 用 `s.owner` |
| `mirror(href)` | 只做 `MIRROR_FROM→MIRROR_TO` 链接前缀替换 | 优先委托 `I.sources.mirror(href,'zh')`（覆盖 web/api/raw 三形态）；保留两常量作纯链接回退 |
| `productHref(p)` | 写死 `https://github.com/zssx-2026/<repo>/releases/tag/<tag>` | `source().releasePage(p.repo, RELEASE_TAG)` |
| `footer()` | 写死 `link('https://github.com/zssx-2026','GitHub')` | `link(source().web, source().label)`（英文输出不变，中文变 Gitee） |
| 导出 | — | 增加 `source: source` |

### 2.3 assets/site.js 中文可见文案（仅 zh 键；英文键只新增未使用的 sourceNote）

| 键 | 前 | 后 |
|---|---|---|
| `liveNote`(zh) | 实时读取自 GitHub。 | 实时读取自 **Gitee**。 |
| `downloadLede`(zh) | 卡片会打开它在 GitHub 上的最新发布。 | 卡片会打开它在 **Gitee** 上的最新发布。 |
| `requirementsNote`(zh) | 你需要一个 GitHub 账号和个人访问令牌：这套软件把数据存在 GitHub release 里。 | 你需要一个 GitHub 账号和个人访问令牌：**套件的数据仍存在 GitHub release，登录与令牌校验也仍走 GitHub API —— 官网内容读取自 Gitee**。 |
| `tokenHint`(zh) | 它只会发给 api.github.com，绝不会发给本站…… | **内容请求发给 Gitee；登录与令牌校验仍发给 api.github.com（Gitee 没有等价的账户接口，这是唯一例外）**。两者都不会发给本站…… |
| `tokenStoredNote`(zh) | 令牌保存在本浏览器中，只会发送给 api.github.com。 | 令牌保存在本浏览器中；**内容读取发给 Gitee，登录校验仍发给 api.github.com**。 |
| `unverifiedText`(zh) | ……与 GitHub 报告的摘要一致时…… | ……与 **内容源**报告的摘要一致时…… |
| `errGithubRefused`(zh) | GitHub 拒绝了该请求： | **内容源**拒绝了该请求： |
| `sourceNote` | — | 新增（中英）：说明“仓库列表来自 GitHub 账户（账户/令牌接口只有 GitHub）；仓库内容在中文站读取 Gitee” |

### 2.4 assets/i18n.js

- zh `errGithubRefused`：`GitHub 拒绝了该请求：` → `内容源拒绝了该请求：`。英文键未动。

### 2.5 assets/download.js（14834 字节）

- 删除第 24 行写死常量 `var API = 'https://api.github.com/repos/zssx-2026/';`。
- 新增 `src()` / `loc()` / `localize()`：快照 URL 按语言解析（中文→Gitee）。
- `render()`：快照优先（不变）；快照缺失时的实时兜底由 `API + repo + '/releases?per_page=30'`（写死 GitHub）改为 `source.releasesApi(product.repo)`（中文 Gitee，英文 GitHub），返回后经 `normalizeReleases` + `localize`。

### 2.6 assets/archive.js（7687 字节）

- 新增 `M(url)`（经 `I.sources.mirror(url, lang())`）。三处内容链接改为经它解析：.zst bundle 的 `f.url`/`browser_download_url`、缺失 bundle 时的资产直链、Release 页的 `html_url`。快照本身未改。

### 2.7 assets/token.js（20391 字节）

- 顶部注释补充：**本文件没有任何内容请求**（不读 release/资产/文档/tag），因此语言源规则在此没有可路由对象；密钥只进 localStorage。
- zh `footerNote`：`……与 GitHub 账户无关。` → `……与 GitHub 账户无关（中文站的内容读取自 Gitee，同样不涉及这里的密钥）。`

### 2.8 assets/verify.js（9679 字节）

- 仅补注释：本文件没有内容请求（挑战是 verify-worker.js 里的本地哈希）；`FAIL_URL` 是本站页面（仍由 GitHub Pages 托管），不是内容源。**行为零改动**。

### 2.9 中文页面（19 个 cn 页中的 18 个）

- 18 个加载 site.js 的 cn 页面，在 `<script ... site.js>` 之前插入 `<script src="<同相对前缀>/assets/sources.js"></script>`（相对路径，保证本地/Pages 都可用）。cn/404.html 不加载 site.js，未动。
- `cn/docs/index.html`：两处源码链接 `https://github.com/zssx-2026/Infinity.inc/blob/main/...` → `I.source().web + '/Infinity.inc/blob/main/...'`（内容链接随语言；正文抓取走 `I.gh('/repos/.../contents/...')`，由 site.js 按语言路由）。
- `cn/cloud/index.html`：仓库链接与清单里拼出的资产下载链接改为 `I.source().web`/`I.source().owner`；新增一行可见提示 `sourceNote`，明示“仓库列表来自 GitHub 账户、仓库内容来自 Gitee”。
- `cn/myself/index.html`：新增 `data-t="sourceNote"` 的可见提示行（内容由 site.js 翻译）。账号仓库列表链接（github.com/<full_name>）与“在 GitHub 上管理令牌”保持 GitHub —— 属于已声明的账号例外。

### 2.10 未改动（有意）

- `web/infinity/assets/releases.json`：64864 字节，sha256 `3cf7c0f6014bd28c4ce151c70171831d0b3bd7266404c87c6a51552b02c9bf34`（离线回退保持原样）。
- 全部 19 个英文页面；`assets/product.js`、`guard.js`、`account.js`、`verify-worker.js` 行为；ING/Infinity Games 源码仓；history/；work/sync-history.mjs。

---

## 3. 独立验证

脚本：`work/cn-gitee-verify.mjs`（纯 Node 内置模块：http/fs/path/vm；静态服务器在本进程内，**不启动也不结束任何外部进程**）。

它做三件事：
1. 用本机静态服务器加载中/英关键页面（各 6 条路由，共 12 条），断言 HTTP 200、cn 页同时引用 sources.js、en 页无 gitee 字面量；
2. 在最小 DOM shim + 拦截 fetch 下，按语言各跑一遍 `sources.js + site.js + download.js + archive.js`，驱动 `source()`、`productHref()`、`download.render()`（快照路径与实时路径）、`archive.render()`、`I.gh('/repos/**')`、`I.gh('/user')`、`mirror()`，收集**每一个**内容 URL 与**每一次**真实请求；
3. 静态扫描 assets：download.js 不得再出现 `api.github.com`/`github.com/zssx-2026`；archive.js 必须经 sources.mirror；site.js 必须把 `/repos/` 走源且账号仍走 api.github.com。

命令与退出码：

    D:\program\nodejs\node.exe work\cn-gitee-verify.mjs
    → exit code 0
    → checks: 61, failed: 0
    → content URL hosts produced - zh: {"gitee.com":189}
    → content URL hosts produced - en: {"github.com":96}

关键断言（全部 PASS）：中/英 `source()` 四要素；中文 productHref/download(快照)/archive(快照)/download(实时)/content request/无 sources.js 回退 六组内容 URL 主机**只有 gitee.com**；英文同六组**只有 github.com**；中文结果中无任何 github 内容 URL、英文结果中无任何 gitee 内容 URL；实时 release 请求确实落在 gitee.com / api.github.com；账号请求在两语言都落在 api.github.com（已声明例外）；mirror() 的 web/api/raw 双向换算与账号 URL 不被改写；`rawUrl` 形状正确。

语法检查：

    D:\program\nodejs\node.exe --check web\infinity\assets\sources.js 等 11 个脚本
    → 全部 exit 0

---

## 4. Gitee 探测（匿名只读 GET，仅 GET，无令牌）

探测对象：`https://gitee.com/api/v5/repos/zssx2026/<repo>` 与 `.../releases`；工具为 curl.exe（`-sS -o NUL -w "%{http_code}"`，部分用 Invoke-WebRequest 复核）。**原样状态码如下。**

### 4.1 用户与仓库清单（限流前，可信）

| 请求 | 状态码 | 结果 |
|---|---|---|
| GET /api/v5/users/zssx2026/repos?per_page=100&sort=updated | **200** | 公开仓仅两个：`applications`（default=main，pushed_at=2026-10-05T13:27:29+08:00）、`Sink`（default=master，pushed_at=2026-10-02T18:01:39+08:00） |

### 4.2 逐仓状态（第一轮，curl，间隔 1.2s，先于持续限流）

| 仓库 | /repos 状态 | /releases 状态 | 判定 |
|---|---|---|---|
| applications | **200** | **200**（releases 数 1） | 存在 |
| Infinity-Cloud | 404 | 404 | 未公开 |
| Infinity-File-Manager | 404 | 404 | 未公开 |
| InfinityPackageManager | 404 | 404 | 未公开 |
| Infinity-Toolbox | 404 | 404 | 未公开 |
| Infinity-Installer-Manager | 404 | 404 | 未公开 |
| Infinity-Games | 404 | 404 | 未公开 |
| Infinity.inc | 404 | 404 | 未公开 |
| application-inc / infinity-inc / infinity-filemanager / infinity-file-manager / infinitypackagemanager / infinityinstallermanager / infinitytoolbox / infinitygames / InfinityCloud / InfinityFileManager / InfinityToolbox / InfinityInstallerManager | 404（各仓两接口） | 404 | 未公开 |
| InfinityGames | 403 | 403 | **限流，非存在性证据** |
| Sink | 200（网页） | — | 存在（与本项目无关） |

### 4.3 后续复核全部落入限流

| 时间 | 方式 | 结果 |
|---|---|---|
| 15:02–15:05 | API，间隔 8s（冷却 70s 后） | 全部 **403 Forbidden (Rate Limit Exceeded)**，含第一轮 200 的 applications |
| 15:27–15:40 | API，间隔 10s（冷却 10 分钟后） | 全部 **403** |
| 16:27–16:29 | API，间隔 7s（冷却约 46 分钟后） | 全部 **403**，包括 applications 与 list |
| 15:44 | 网页 `https://gitee.com/zssx2026/<repo>` | applications 200、Sink 200、application-inc 404、Infinity-Cloud 404、Infinity-File-Manager 404、Infinity-Toolbox 404、Infinity-Installer-Manager 404、Infinity-Games 404；**InfinityPackageManager/Infinity.inc/infinity-inc/infinity-filemanager/infinitytoolbox/infinitygames 403**（约 9 次请求后触发网页侧限流） |
| 15:4x | 网页 raw `https://gitee.com/zssx2026/applications/raw/main/README.md` | **302**（未跟随跳转） |
| — | 对照：github.com/zssx-2026/Infinity-Cloud | curl 报 schannel `CRYPT_E_NO_REVOCATION_CHECK`（本机吊销检查问题），未取得状态码 |

**结论（如实）**：owner `zssx2026` 存在；`applications` 存在；**没有证据表明六个应用仓、Infinity.inc、Infinity-Archive 在 Gitee 上有公开镜像**（多个候选名 404）。Gitee 对本机匿名请求已持续返回 403 限流，因此对未取得 200 的名字，只能给出“404 已观察到”而非“永久不存在”。本报告不假装镜像已就绪。

### 4.4 受影响的不止六仓

- 归档页的 .zst bundle URL 指向 `zssx-2026/Infinity-Archive`（见 releases.json bundles），中文态会被解析为 `gitee.com/zssx2026/Infinity-Archive/...`；该仓同样需要镜像。
- 文档页正文来自 `zssx-2026/Infinity.inc`（cpp/README.md、README.md、docs/catalogue-format.md）；中文态改走 `gitee.com/zssx2026/Infinity.inc`，需要该仓镜像。
- 云盘/账户页的存储仓 `inc_*` 与账户仓库列表属于账号数据（GitHub 例外）。

---

## 5. 验证/构建命令汇总（可复跑）

    # 语法
    D:\program\nodejs\node.exe --check web\infinity\assets\sources.js
    D:\program\nodejs\node.exe --check web\infinity\assets\site.js
    D:\program\nodejs\node.exe --check web\infinity\assets\download.js
    D:\program\nodejs\node.exe --check web\infinity\assets\archive.js
    # 独立验证（本进程内静态服务器）
    D:\program\nodejs\node.exe work\cn-gitee-verify.mjs        → exit 0（61/61）
    # 匿名只读探测（示例；Gitee 会限流）
    curl.exe -sS -o NUL -w "%{http_code}" -A "infinity-inc-probe/1.0" https://gitee.com/api/v5/repos/zssx2026/applications
    curl.exe -sS -o NUL -w "%{http_code}" -A "infinity-inc-probe/1.0" https://gitee.com/api/v5/repos/zssx2026/applications/releases

文件摘要（sha256）：

| 文件 | 字节 | sha256 |
|---|---|---|
| web/infinity/assets/sources.js | 8923 | b044907a3823f2564747a184440f450d1e8d2c00a8f816a4140f7bef1e629880 |
| web/infinity/assets/site.js | 63258 | a3cc12b098e8d0eafbf7d60e8b0a81330802bbddd6323cef0c405d648acbf346 |
| web/infinity/assets/download.js | 14834 | cbc13e0668c82b67ef4f847bde1e1bb85ea5ae43d5405c219016a07c9d82fc5a |
| web/infinity/assets/archive.js | 7687 | 7c4fa5e65f5310d8bfaed9fc15ff5b6465da41048f466da2b1b6759d21b60dc6 |
| web/infinity/assets/token.js | 20391 | a44919d471a9dcfcfdf8ff8614cb4c58640ffec1e038ee3cccfa9ebd766f482e |
| web/infinity/assets/verify.js | 9679 | e73072d28a1ace53121f78fd246d7f91eae454beec5ee1352930b09e6a240994 |
| web/infinity/assets/i18n.js | 3995 | 9f5707b4ab09138de7d24f6597b378b6bfe140b722cf207f2c94e5bceb03b2fb |
| web/infinity/assets/releases.json（未改） | 64864 | 3cf7c0f6014bd28c4ce151c70171831d0b3bd7266404c87c6a51552b02c9bf34 |

---

## 6. 遗留与需人类确认项

1. **【阻塞性】需人类确认 Gitee 镜像映射表并创建公开镜像。** 现状：只有 `applications` 存在。建议确认/创建以下公开仓（名称待定，需与站点源里的 repo 名一致，否则代码无法找到它们）：六个应用 `Infinity-Cloud`、`Infinity-File-Manager`、`InfinityPackageManager`、`Infinity-Toolbox`、`Infinity-Installer-Manager`、`Infinity-Games`；文档仓 `Infinity.inc`；归档 bundle 仓 `Infinity-Archive`。若 Gitee 上实际使用的名字与 GitHub 不同（例如全小写 `infinity-cloud`），**必须给出一张 仓库名映射表**，我据此把 `sources.js` 增加 repo 名映射（当前按同名处理）。
2. **【体验退化，需决策】镜像补齐前，中文站的实时内容会失败**：首页“最新发布”走 Gitee API→404→空；文档页正文读不到；下载/归档页退回本地快照，但快照里的下载链接在中文态已按规则解析为 Gitee → 镜像不存在时这些链接会 404。两种取舍请人类选一：(a) 维持严格“中文只读 Gitee”（当前实现，验证脚本按此断言）；(b) 允许“Gitee 失败时显式提示并回退 GitHub”（需要放宽第 3 节的严格主机断言）。
3. **Gitee 匿名 API 限流**：本机已持续 403（含曾 200 的仓）。建议复核时冷却后重试，或使用只读令牌（本次按要求仅匿名 GET，未用令牌）。另外需实测 **Gitee API 是否返回 CORS 头**——静态站从 GitHub Pages 直连 Gitee API，若无 CORS 头，浏览器端实时读取会失败（GitHub API 有 CORS 头）。建议在真实浏览器里打开中文下载页确认。
4. **账号/令牌仍在 GitHub（已声明例外）**：登录/令牌校验、邮箱验证、Gist 同步、`/user*` 均走 GitHub，中文页已用可见文案说明（tokenHint/tokenStoredNote/sourceNote/requirementsNote）。Gitee 无等价接口，不静默跨源。若将来要“中文站账户也走 Gitee”，需要重做账户体系（Gitee OAuth/令牌 + 无 Gist 的落盘方案），超出本任务。
5. **Gitee release 字段形状**：`normalizeReleases` 容忍 `assets`/`attach_files` 与多种下载字段；Gitee 列表接口可能不返回资产明细（需按 release id 再取）。镜像建成后应实测一次真实 Gitee 响应，按实际字段收紧。
6. **download.js 的实时兜底仍是第二优先级**：快照优先，因此新建的 Gitee 发布要等 `releases.json` 重建或快照缺失该仓时才被读到；如需“中文实时优先”，需改读取顺序（会影响英文行为，暂未做）。
7. 六应用仓的 GitHub 名称与 Gitee 名称大小写可能不同（GitHub 侧为 `Infinity-Cloud` 等）；Gitee owner 已确认是 `zssx2026`（不是 `zssx-2026`）。

---

## 7. 硬约束遵守说明

- 改动范围：`web/infinity/assets/**`、`web/infinity/cn/**`、`work/cn-gitee-verify.mjs`、`work/cn-gitee-report.md`。**未新增/修改任何英文页面**，英文可见文案语义未变（仅 T.en 增加一个未被英文页使用的 sourceNote）。
- **未触碰 ING/Infinity Games**（源码仓、构建、发行均未动；仅网站 assets 的通用逻辑按语言统一处理）。
- 未碰 `history/`、`work/sync-history.mjs`。
- 未安装/下载任何东西；探测只用匿名只读 GET。
- **未结束/终止任何进程**，未运行任何卸载程序或 msiexec /x，未删除/改动任何已安装应用目录或快捷方式；验证脚本的 HTTP 服务器在本进程内创建并关闭。

---

## 8. task-27（追加）：Gitee 未就绪的显式提示、自动请求断言扩展、CORS 实测

- 追加时间：2026-10-06 18:19–18:55（Asia/Shanghai）
- 目标：中文态在 Gitee 镜像未就绪、内容来自本地快照时**明示**“Gitee 镜像未就绪、以下为本地快照”，并给出 GitHub 对应链接作为**人工出口**，但**不得自动请求 GitHub**；英文站一行不变；用验证脚本证明“自动请求 100% gitee.com”；实测 Gitee API 的 CORS 头。

### 8.1 提示的实现（全部走 zh 闸门，英文页零改动）

| 位置 | 行为 |
|---|---|
| assets/download.js | 快照路径返回 `{rels, snapshot:true}`，渲染后若 `lang()==='zh'` 调用 `pending()`：在结果上方插入可见提示，并附一个 `class="github-exit"` 的 GitHub 发布页链接（`other().repoWeb(repo)+'/releases'`）。实时路径 `snapshot:false` → 不显示提示（Gitee 正常时不打扰读者）。 |
| assets/archive.js | 归档始终读本地快照，渲染前 `pending(box)` 插入同样提示 + GitHub 账户页（`other().web`）。 |
| cn/index.html | 6 个产品在 Gitee 都取不到 release（或请求报错）时，表格下方插入 `giteePendingNote` + GitHub 链接。 |
| cn/docs/index.html | Gitee 取不到文档时，在“publishedInRepo”之后插入 `giteePendingNote` + 该文档在 GitHub 的确切 blob 链接。 |
| cn/cloud/index.html | 在既有 `sourceNote` 旁再插入同样的待就绪提示 + GitHub 链接。 |
| assets/sources.js | 新增 `I.sources.other(lang)`：返回“另一侧”的视图，**只用于人工出口链接**，不做任何请求。 |
| assets/site.js | `fallbackSource` 拆成 `buildFallback(lang)`（未加载 sources.js 时 `I.sources` 也带 github/gitee/other）；新增 `T.zh`/`T.en` 的 `giteePendingNote`/`giteePendingLink`。 |
| download.js / archive.js 的 TEXT | 新增 `snapshotNotice`/`githubExit`（中英各一；en 分支被 lang 闸门挡住，英文页不会出现）。 |

关键点：人工出口链接**不使用 `I.link()`**（I.link 会经 `mirror()` 改写主机），而是直接用 `I.el('a',{class:'github-exit',href,target:'_blank',rel:'noopener'})`，因此它稳定指向 GitHub，同时**不在任何 fetch/XHR 路径上**——没有代码读取它、没有预取、没有 ping。

可见中文文案：

- 下载页：`注意：中文站的内容源为 Gitee，但 Gitee 镜像尚未就绪，以下版本来自本站内置的本地快照，下载链接在镜像就绪前可能不可用。人工出口（需手动点击，本站不会自动请求 GitHub）：在 GitHub 上查看该产品的发布`
- 归档页：`……以下归档来自本站内置的本地快照……在 GitHub 上打开对应仓库`
- 首页 / 云盘 / 文档：`注意：中文站的内容源为 Gitee，但 Gitee 镜像目前尚未就绪，实时数据可能为空、链接可能不可用；页面已回退到本站内置的本地快照。作为人工出口，可以手动打开 GitHub 上的对应页面 —— 本页不会自动请求 GitHub：在 GitHub 上查看`

### 8.2 验证扩展（work/cn-gitee-verify.mjs）

    D:\program\nodejs\node.exe work\cn-gitee-verify.mjs
    → exit code 0
    → checks: 76, failed: 0
    → content URL hosts produced - zh: {"gitee.com":189}
    → content URL hosts produced - en: {"github.com":96}

新增断言（全部 PASS）：

- `zh automatic content requests hit nothing but gitee.com (and the local snapshot)`：download/archive/`gh('/repos/**')`/实时路径四处采集的自动请求主机 = `{"127.0.0.1:<port>":2,"gitee.com":2}`。
- `zh automatic content requests contain no github.com`（0 次）；`en automatic content requests contain no gitee.com`（0 次）。
- `zh pending-mirror notice is visible on the download page / archive page`：直接遍历渲染树的 textContent，断言含“Gitee 镜像”与“本地快照”。
- `zh download/archive manual exit is a github.com link`：`class="github-exit"` 的 href 主机均为 github.com。
- `zh manual exit is never fetched automatically`：把 github-exit 的 URL 与全部自动请求逐一比对，无一命中；它们也被排除在“内容 URL 主机统计”之外，所以 189 条仍是纯 gitee.com。
- `zh live path (Gitee answered) shows no manual exit`；`en shows no pending-mirror notice`；`en has no manual-exit link`。
- `zh without sources.js`：请求仍只有本地快照（site.js 回退源），主机不含 GitHub。
- `cn page wires the pending-mirror notice`：cn/index、cn/docs、cn/cloud 三个页面均含 `giteePendingNote` 与 `github-exit`。

语法：`node --check` 对 sources.js / site.js / download.js / archive.js / cn-gitee-verify.mjs 全部 exit 0。

### 8.3 Gitee API CORS 实测（匿名只读，2026-10-06 18:48–18:49）

命令（curl.exe，带浏览器式 Origin）：

    curl.exe -sS -D - -o NUL --max-time 50 -H "Origin: https://zssx-2026.github.io" -H "Accept: application/json" https://gitee.com/api/v5/repos/zssx2026/applications
    curl.exe -sS -D - -o NUL --max-time 50 -X OPTIONS -H "Origin: https://zssx-2026.github.io" -H "Access-Control-Request-Method: GET" -H "Access-Control-Request-Headers: accept" https://gitee.com/api/v5/repos/zssx2026/applications

原始响应头（GET，当前为限流 403）：

    HTTP/1.1 403 Forbidden
    Server: ADAS/1.0.214
    Date: Tue, 06 Oct 2026 10:49:08 GMT
    Content-Type: text/plain; charset=utf-8
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS
    Access-Control-Expose-Headers: Etag, total_count, total_page
    Access-Control-Max-Age: 1728000
    Vary: Origin
    X-Frame-Options: SAMEORIGIN
    BDWAF-Request-ID: b42c1a1b-d492-4ea6-96b2-3d9b8a1f4a8f

原始响应头（OPTIONS 预检，200）：

    HTTP/1.1 200 OK
    Server: ADAS/1.0.214
    Access-Control-Allow-Origin: *
    Access-Control-Allow-Methods: GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS
    Access-Control-Allow-Headers: accept
    Access-Control-Expose-Headers: Etag, total_count, total_page
    Access-Control-Max-Age: 1728000
    Content-Security-Policy: frame-ancestors 'self' https://*.gitee.com

`GET https://gitee.com/api/v5/repos/zssx2026/applications/releases` 同为 **403**，且同样带 `Access-Control-Allow-Origin: *`。

**结论：Gitee API 有 CORS**——ACAO:* 同时出现在 403 的实际响应和 200 的 OPTIONS 预检上；因此 GitHub Pages 上的中文页可以直接 fetch Gitee API，**CORS 不是阻塞项**。当前 403 是限流/WAF 层（`Server: ADAS/1.0.214`、`BDWAF-Request-ID`），不是 CORS 拒绝；且因为 ACAO 存在，浏览器能读到 403 状态并据此走“未就绪提示 + 本地快照”。第 6 节“需实测 Gitee API 的 CORS”一项据此**关闭**。

诚实说明：同机对照的 GitHub API 探测因本机 schannel 吊销检查（`CRYPT_E_NO_REVOCATION_CHECK`）未取得响应，未能做同机对照；GitHub API 的 ACAO:* 是既有事实，非本次实测。另外本机 curl 经由 HTTP 代理（每个响应前有 “HTTP/1.1 200 Connection Established”），403 也可能与出口 IP/代理相关，镜像建成后应在真实浏览器里复核一次。

### 8.4 遗留更新（相对第 6 节）

1. 第 6 节第 3 条（Gitee CORS 未知）→ **已关闭**：CORS 存在（ACAO:*，含预检）。
2. 仍然阻塞：Gitee 上没有六应用 / Infinity.inc / Infinity-Archive 的公开镜像，且本机匿名 API 仍被 403 限流。镜像建好后中文站实时内容会自动恢复，提示也会自动消失（实时路径 `snapshot:false` 不渲染提示）——不需要再改代码。
3. 决策项不变：(a) 严格“中文只读 Gitee” + 本次的显式提示（已实现）；(b) 若改为“Gitee 失败自动回退 GitHub”，那是**自动跨源**，会削弱“自动请求 100% gitee.com”的保证，需要人类明确同意并同时放宽验证断言；当前不做。
4. 提示只在快照路径出现；若 Gitee 返回 200 但为空，下载页不显示提示（首页空表场景会显示）——有意为之：有实时回答时不该说“镜像未就绪”。

### 8.5 本次改动文件摘要（sha256）

| 文件 | 字节 | sha256 |
|---|---|---|
| web/infinity/assets/sources.js | 9157 | 7c29c8a9b4d26e814dea7e38b6592ebd0e67acb8fea1264aa0e377f05ef2abef |
| web/infinity/assets/site.js | 64243 | 1ec2f368f02f020d233b3b355e50c85ec4a13e3c39ddf3c4f21903e3bf3a06a7 |
| web/infinity/assets/download.js | 16468 | 0a25f1d61b886b7ddce64a3252470568686b1cc74f1012caebe5527f86283629 |
| web/infinity/assets/archive.js | 9086 | 719637f1019a4e8122987bbced7e2e9043d3dfd3715fe354935a799e5b0a4cfb |
| web/infinity/cn/index.html | 6142 | 6fb50155acd7fe06422ae57b704c0b8d8398e0ab16b31bb56e5312d15d56f0a4 |
| web/infinity/cn/docs/index.html | 5627 | 134f5ad0f1cd3a5a12286a8d744d29d0b5b1e96e1549962b13a661f5325f04a0 |
| web/infinity/cn/cloud/index.html | 10731 | 5b01b5d21048c5e4c8736eb6bbff569063e9faf384617bc61e273bf56f1a355c |
| work/cn-gitee-verify.mjs | 27696 | b30e9b4e8a7739a41540e7f3d56ec08e3bf843c94e6b5f7d6969cbaf1a029f6b |
| web/infinity/assets/releases.json（仍未改） | 64864 | 3cf7c0f6014bd28c4ce151c70171831d0b3bd7266404c87c6a51552b02c9bf34 |

英文页（19 个 .html）本次仍未改动；ING/Infinity Games、history/、work/sync-history.mjs 未触碰；未结束任何进程、未安装/卸载任何东西。

