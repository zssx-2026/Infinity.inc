# Infinity.Inc 官网与发布脚本审计报告（task-5 / proj-web）

日期：2026-10-04（线上回归）。范围：`web/**`、`icons/**`（只读）、`work/publish-site.mjs`、`work/ghsync.mjs`、`work/backup-publish.mjs`。

约束遵守：未修改/删除 `history/**` 任何内容；未运行 `pack-history.mjs`；未执行任何上传/发布命令（只有 HTTP GET/HEAD 读取）；未改动 `cpp/**`、`icons/**`。

线上版本：Lead 已发布 commit `ad0b0662ea8b`（47 文件）。线上 `https://zssx-2026.github.io/infinity/assets/site.js` 与本地文件逐字节一致（SHA-256 前缀 `a5f1a7eda06ff9d8`）。

## 结论摘要

| 项 | 结果 |
| --- | --- |
| 语言切换（34 条路由） | 34 PASS / 0 FAIL |
| 404 链路 | 缺失路径返回根 404 页；`/404` 自身 HTTP 200、无 Location，不跳转 |
| 下载卡片（6 应用） | 均为整卡 `<a>`，href = 各自仓库 `releases/latest`；六个仓库线上 HTTP 200 |
| 站点静态引用 | 0 缺失（47 文件全量扫描） |
| 发布脚本 | 4 处已修；2 处待 Lead 决策（见第五节） |
| 残余 | docs 页 3 篇文档在源码仓库均 404（跨写作用域，需源码侧提交） |

## 一、英文站语言切换 bug（根因 + 修复 + 线上回归）

根因：`web/infinity/assets/site.js:32` 的 `BASE` 取自 `document.currentScript.src`，浏览器解析后是**绝对 URL**（`https://zssx-2026.github.io/infinity`）；旧 `otherLanguageHref()`（原 531-541 行）用 `location.pathname`（形如 `/infinity/download/`）做 `path.indexOf(BASE) === 0`，永远为假，于是落到 `return path + suffix` —— “中文”链接指向当前页本身。中文站切回英文走 `path.replace('/cn/', '/')`，本来就正常。

修复：

- `web/infinity/assets/site.js:38-43`：新增路径基址 `BASE_PATH = new URL(BASE, location.href).pathname.replace(/\/+$/, '') || '/infinity'`（try/catch 兜底）。
- `web/infinity/assets/site.js:550-565`：`otherLanguageHref()` 改用 `BASE_PATH` 判断与拼接；英文 `/infinity/xxx/` → `/infinity/cn/xxx/`，中文 `/infinity/cn/xxx/` → `/infinity/xxx/`，`search` 原样保留；站点根页面（`web/index.html`，无中文副本）指向 `/infinity/cn/`。

回归表（Node 加载 site.js，桩掉 `document/location/localStorage`，逐路由调用 `otherLanguageHref()`；目标路径映射到本地文件判定存在性）：

| 页面 location.pathname | 另一语言目标 URL | 本地目标 | 结果 |
| --- | --- | --- | --- |
| `/infinity/` | /infinity/cn/ | 存在 | PASS |
| `/infinity/cloud/` | /infinity/cn/cloud/ | 存在 | PASS |
| `/infinity/cn/` | /infinity/ | 存在 | PASS |
| `/infinity/cn/cloud/` | /infinity/cloud/ | 存在 | PASS |
| `/infinity/cn/docs/` | /infinity/docs/ | 存在 | PASS |
| `/infinity/cn/download/` | /infinity/download/ | 存在 | PASS |
| `/infinity/cn/download/infinitycloud/` | /infinity/download/infinitycloud/ | 存在 | PASS |
| `/infinity/cn/download/infinityfilemanager/` | /infinity/download/infinityfilemanager/ | 存在 | PASS |
| `/infinity/cn/download/infinitygames/` | /infinity/download/infinitygames/ | 存在 | PASS |
| `/infinity/cn/download/infinityinstallmanager/` | /infinity/download/infinityinstallmanager/ | 存在 | PASS |
| `/infinity/cn/download/infinitypackagemanager/` | /infinity/download/infinitypackagemanager/ | 存在 | PASS |
| `/infinity/cn/download/infinitytoolbox/` | /infinity/download/infinitytoolbox/ | 存在 | PASS |
| `/infinity/cn/error/` | /infinity/error/ | 存在 | PASS |
| `/infinity/cn/login/` | /infinity/login/ | 存在 | PASS |
| `/infinity/cn/login/link/` | /infinity/login/link/ | 存在 | PASS |
| `/infinity/cn/myself/` | /infinity/myself/ | 存在 | PASS |
| `/infinity/cn/run/` | /infinity/run/ | 存在 | PASS |
| `/infinity/cn/settings/` | /infinity/settings/ | 存在 | PASS |
| `/infinity/cn/signup/` | /infinity/signup/ | 存在 | PASS |
| `/infinity/docs/` | /infinity/cn/docs/ | 存在 | PASS |
| `/infinity/download/` | /infinity/cn/download/ | 存在 | PASS |
| `/infinity/download/infinitycloud/` | /infinity/cn/download/infinitycloud/ | 存在 | PASS |
| `/infinity/download/infinityfilemanager/` | /infinity/cn/download/infinityfilemanager/ | 存在 | PASS |
| `/infinity/download/infinitygames/` | /infinity/cn/download/infinitygames/ | 存在 | PASS |
| `/infinity/download/infinityinstallmanager/` | /infinity/cn/download/infinityinstallmanager/ | 存在 | PASS |
| `/infinity/download/infinitypackagemanager/` | /infinity/cn/download/infinitypackagemanager/ | 存在 | PASS |
| `/infinity/download/infinitytoolbox/` | /infinity/cn/download/infinitytoolbox/ | 存在 | PASS |
| `/infinity/error/` | /infinity/cn/error/ | 存在 | PASS |
| `/infinity/login/` | /infinity/cn/login/ | 存在 | PASS |
| `/infinity/login/link/` | /infinity/cn/login/link/ | 存在 | PASS |
| `/infinity/myself/` | /infinity/cn/myself/ | 存在 | PASS |
| `/infinity/run/` | /infinity/cn/run/ | 存在 | PASS |
| `/infinity/settings/` | /infinity/cn/settings/ | 存在 | PASS |
| `/infinity/signup/` | /infinity/cn/signup/ | 存在 | PASS |

说明：共 34 条（英文 17 + 中文 17，含本次新增的 `/infinity/cn/run/`）。`/infinity/404.html` 不计入：它是独立的 404 处理器，不加载 `site.js`，因此没有语言切换锚点。无任何一行指向自身或不存在路径。

## 二、404 跳转（已实现 + 线上验证）

- 新增 `web/404.html`（发布为仓库根 `/404.html`）；重写 `web/infinity/404.html`（本地预览副本）。两文件脚本逐字节相同。
- 逻辑：`location.pathname` 以 `/infinity/` 开头或等于 `/infinity` → `location.replace('https://zssx-2026.github.io/404')`；其它路径（含 `/404` 自身）**只渲染自包含简洁 404 页，绝不再跳转**，避免 `/404` 死循环。页面不引用 `site.js`/`site.css`，样式内联，回站链接为绝对地址 `https://zssx-2026.github.io/infinity/`。
- `work/publish-site.mjs:74-76, 101-108`：新增把 `web/404.html` 发布到仓库根 `404.html`（保留 `base_tree`，不动其它文件）。
- 发布前检查（GitHub API，只读）：仓库 `zssx-2026/zssx-2026.github.io` 存在，默认分支 `main`，根目录当时只有 `README.md`、`index.html`、`infinity`；`GET /repos/.../contents/404.html` 返回 **HTTP 404** ⇒ 此前没有 404.html，本次为**新建**，不是替换。
- 离线逻辑测试（同一脚本、桩 location/document）：`/infinity/download/nope/`、`/infinity/cn/whatever`、`/infinity` → 均跳 `/404`；`/404`、`/404.html`、`/foo`、`/` → 均渲染、不跳转。
- 线上抓取（curl）：
  - `GET https://zssx-2026.github.io/infinity/nope-xyz/` → **HTTP 404**，返回体为题名 `Not found — Infinity.Inc` 的根 404 页，含 `location.replace('https://zssx-2026.github.io/404')`，且不含 `assets/site.js`。
  - `GET https://zssx-2026.github.io/404` → **HTTP 200**（Pages 将 `/404` 映射到 `404.html`），无 `Location` 头；返回体是同一 404 页，脚本条件对 `/404` 为假（离线已证），因此不会再次跳转。

## 三、下载页卡片化（已实现 + 线上验证）

改动：`web/infinity/download/index.html`、`web/infinity/cn/download/index.html` 改为整卡网格；`web/infinity/assets/product.js` 改为每个产品页渲染同一张卡片；说明性长文（Requirements 段、拉长版 lede）删除。卡片由 `web/infinity/assets/site.js` 的 `productCard()/cards()`（856-884 行）生成，字段含图标、短码、产品名、一句话、平台标签，**整张 `<a>` 即链接**。

| 产品 | 卡片 href | 线上 HTTP |
| --- | --- | --- |
| Infinity Cloud | https://github.com/zssx-2026/Infinity-Cloud/releases/latest | 200 |
| Infinity File Manager | https://github.com/zssx-2026/Infinity-File-Manager/releases/latest | 200 |
| InfinityPackageManager | https://github.com/zssx-2026/InfinityPackageManager/releases/latest | 200 |
| Infinity Toolbox | https://github.com/zssx-2026/Infinity-Toolbox/releases/latest | 200 |
| Infinity Installer Manager | https://github.com/zssx-2026/Infinity-Installer-Manager/releases/latest | 200 |
| Infinity Games | https://github.com/zssx-2026/Infinity-Games/releases/latest | 200 |

验证（重要说明）：卡片是 `site.js` 客户端渲染的，curl 抓到的原始 HTML **不会有卡片 `<a>`**，只有 `I.cards(...)` 调用。因此做了两层验证：
1. 原始 HTML：线上 `/infinity/download/` 与 `/infinity/cn/download/` 均含 `I.cards(document.getElementById('cards'))` 并加载 `site.js`；6 个产品页线上均加载 `site.js` + `product.js`。
2. 真实 DOM：在 Node 中用桩 DOM 执行**线上抓回的 site.js**，调用 `productCard()`，根节点均为 `A` 标签，href 为上表 6 条，子节点为 `img + div(short) + h3(name) + p(tagline) + div(pills)` ⇒ 整卡即超链接成立。

## 四、其它一致性修复（已改）

| 文件 | 问题 | 修复 |
| --- | --- | --- |
| `web/index.html:7,13` | 描述只列 5 个产品（缺 Infinity Games）；正文写 “Five Windows applications” | 补齐 6 个产品名；`Five` → `Six` |
| `web/infinity/index.html:7,51` | 同上缺 Games；首页表格 `I.PRODUCTS.slice(0, 5)` 漏掉第 6 个产品 | 补齐产品名；去掉 `slice` |
| `web/infinity/download/index.html:7` | 描述缺 Infinity Games | 补齐 |
| `web/infinity/docs/index.html:31` | 注释写 “What the four applications are” | 改为 six |
| `web/infinity/assets/product.js:2` | 注释写 “five routes / five download pages” | 改为 six |
| `web/infinity/assets/site.js:8-16` | 新增 `taglineZh`、`winX64`/`selfContained` 文案，中文站卡片显示中文一句话 | 新增 |
| `web/infinity/assets/icons/*.svg`（新增 6 个：inc/ifm/ipm/int/iim/ing） | 卡片图标资源缺失 | 从 `icons/src/*.svg` 复制（只读源，未改动） |
| `web/infinity/cn/run/index.html` | 中文站缺 `run` 路由 → 英文 `/infinity/run/` 切中文会 404 | 新增中文运行页 |
| `web/infinity/assets/site.css:130-136` | 卡片样式 | 新增 `.pcard` 布局 |

## 五、发布脚本审计问题清单

| 文件:行 | 问题 | 处理 |
| --- | --- | --- |
| `work/backup-publish.mjs:39-54` | 默认 TAG 硬编码 `infinity-v1.0pre2`，落后 worklog 记录的 v1.0.0-pre3 两个版本；归档会被记到错误版本名下 | 改为从 `cpp/release/*/release-assets.json` 取最新 tag（当前解析为 `infinity-v1.0.0-pre4`），仍可用 argv 覆盖 |
| `work/backup-publish.mjs:42,90-97` | `EXCLUDE_EXT` 含 `.log`，把 `work/worklog.log` 排除，与脚本头部“归档含工作日志”的自述矛盾 | 对 `work/worklog.log` 开例外 |
| `work/ghsync.mjs:7,126,178,299` | 仓库/目录描述只写 3 个产品，与现状不符 | 按实际发布范围改成 6 个产品 / 目录页的 4 个产品 |
| `work/publish-site.mjs:74-76,101-108` | 只发布 `web/index.html` 与 `web/infinity/**`，缺仓库根 404 处理器 | 新增发布 `web/404.html` → `404.html` |
| `work/ghsync.mjs:30-35` | `CPP_ASSETS` 仍指向 `cpp/release/v1.0pre3` 且只覆盖 4 个应用；磁盘已有 `v1.0pre4` 的 6 应用产物（worklog 尚无 pre4 条目） | **未改**，待 Lead 决策后升级（见第七节） |
| `work/ghsync.mjs:38-47` | Node 时代 `ASSETS`（tag `v1.0pre2`）仍在上传列表；worklog 2727 记 Node 版已被 C++ 取代 | **未改**，保留历史发布属于产品决策 |

仓库名/版本号核对（与 worklog）：源码仓库 `zssx-2026/Infinity.inc` ✓（250/339 行）；三个应用发布仓库 `Infinity-Cloud` / `Infinity-File-Manager` / `InfinityPackageManager` ✓（342 行）；目录仓库 `applications`、页 `application-inc` ✓（344/2626 行）；私有备份仓库 `backup` ✓（347 行）。线上实测这 6 个产品仓库均已存在且 `releases/latest` 返回 200。

## 六、复跑方法（命令）

```powershell
# 1) 站点静态引用扫描（0 缺失为通过）——脚本见本次审计，扫描 web/ 下 html/css 的 href/src 并对路径归一化后判存在
# 2) 语法检查
node --check web/infinity/assets/site.js; node --check web/infinity/assets/product.js
node --check work/publish-site.mjs; node --check work/ghsync.mjs; node --check work/backup-publish.mjs
# 3) 语言切换：Node 中桩 location 后 new Function 加载 site.js，对每条 /infinity/**/index.html 路径调用 otherLanguageHref()
# 4) 线上 404
curl.exe -sS --ssl-no-revoke -w "%{http_code}" https://zssx-2026.github.io/infinity/nope-xyz/
curl.exe -sS --ssl-no-revoke -o NUL -D - https://zssx-2026.github.io/404
# 5) 线上卡片页与 Release 目标
curl.exe -sS --ssl-no-revoke https://zssx-2026.github.io/infinity/download/   # 含 I.cards(...)
curl.exe -sS --ssl-no-revoke -L -o NUL -w "%{url_effective} %{http_code}" https://github.com/zssx-2026/<repo>/releases/latest
```

本次执行结果：引用扫描 0 缺失；6 个脚本 `node --check` 全部 exit 0；语言表 34/34 PASS；线上 404 与卡片验证全部通过。

## 七、残余风险 / 跨写作用域项

1. **卡片 `releases/latest` 会拿到旧稳定版**：线上实测 `Infinity-Cloud`/`Infinity-File-Manager`/`InfinityPackageManager` 的 `releases/latest` 解析到 `v1.0pre1`（Node 时代），因为 C++ 的 `v1.0.0-pre3/pre4` 在 `ghsync.mjs:219` 标记为 `prerelease: true`，GitHub 的 `/latest` 会跳过预发布。`Infinity-Toolbox`/`Infinity-Installer-Manager`/`Infinity-Games` 则回退到 `/releases` 列表（目前无稳定发布）。链接本身可达，但用户可能下到旧构建。建议三选一（需 Lead 决策）：卡片改指 `/releases`（含预发布）、把当前版本改为非预发布、或卡片指向具体 tag。
2. **`ghsync.mjs` CPP_ASSETS 版本滞后**：仍指 `v1.0pre3` 的 4 个安装包，而磁盘已有 `cpp/release/v1.0pre4/` 的 6 个应用安装包（`InfinityToolbox`、`InfinityGames` 也已产出），且 worklog 尚无 pre4 条目。未擅自改动发布清单，待 Lead 与源码负责人确认版本后统一升级。
3. **docs 页 3 篇文档在源码仓库均不存在**（只读 API 实测 `zssx-2026/Infinity.inc`）：`README.md` → 404、`cpp/README.md` → 404（本地存在 16,979 B，但 `git ls-files` 未跟踪）、`docs/catalogue-format.md` → 404。修复需要在源码仓库根/`cpp/` 增补文件，超出我的写作用域；`web/infinity/docs/index.html` 已按设计对 404 如实提示，未强改。
4. `web/infinity/assets/guard.js:211-214` 的加载遮罩文案固定为中文，英文站也会显示中文（历史行为，未改）。
5. `work/ghsync.mjs` 中 Node 时代资产清单（`ASSETS`，`v1.0pre2`）与 C++ 清单并存，历史发布是否清理需产品决策。

（本报告为唯一写入的非站点文件；除报告外所有改动均在 `web/**` 与三个发布脚本内。）
## 八、task-14：卡片改指显式 tag `v1.0.0-pre4`（2026-10-04，已发布并线上验证）

### 改动

- `web/infinity/assets/site.js:46-55`：新增**唯一版本常量** `RELEASE_TAG = 'v1.0.0-pre4'`，注释写明与 `cpp/release/v1.0pre4/release-assets.json` 的 `tag` 字段同步（目录名同版本）。
- `web/infinity/assets/site.js:870-872`：`productHref()` 由 `<repo>/releases/latest` 改为 `<repo>/releases/tag/' + RELEASE_TAG`；`site.js:902` 导出 `RELEASE_TAG`。英文站与 `/cn/` 站共用同一 `site.js`/同一常量，因此两站 href 必然一致。
- 下载页本身无需改：`download/index.html` 与 `cn/download/index.html` 都调用 `I.cards()`，产品页调用 `I.productCard()`，全部经 `productHref()` 取值。

### 本地验证

```powershell
node --check web/infinity/assets/site.js            # exit 0
# 线上抓回 site.js 后用桩 DOM 调用 productCard()，分别以 lang=en / zh-CN 渲染
```

en 与 zh-CN 各 6 条 href 完全一致，均为 `https://github.com/zssx-2026/<repo>/releases/tag/v1.0.0-pre4`。

### 重新发布（work/publish-site.mjs）

```powershell
$env:EV_GH_TOKEN = [Environment]::GetEnvironmentVariable('EV_GH_TOKEN','User'); node work/publish-site.mjs --dry-run   # 47 files，含根 404.html
$env:EV_GH_TOKEN = [Environment]::GetEnvironmentVariable('EV_GH_TOKEN','User'); node work/publish-site.mjs
```

结果：`branch main at ad0b0662ea8b` → `uploaded 47 blobs` → **`pushed fb7eca3c5b0d to main`**。GitHub Pages 重建约 1 分钟后，线上 `site.js` 已含 `var RELEASE_TAG = 'v1.0.0-pre4'`（首次抓取仍是旧版，第二次轮询命中）。

### 线上验证

```powershell
curl.exe -sS --ssl-no-revoke "https://zssx-2026.github.io/infinity/assets/site.js?v=<ts>"   # 含 RELEASE_TAG
curl.exe -sS --ssl-no-revoke "https://zssx-2026.github.io/infinity/download/"               # 含 I.cards(...)
curl.exe -sS --ssl-no-revoke -L -o NUL -w "%{http_code}" "https://github.com/zssx-2026/<repo>/releases/tag/v1.0.0-pre4"
curl.exe -sS --ssl-no-revoke -o NUL -w "%{http_code}" "https://api.github.com/repos/zssx-2026/<repo>/releases/tags/v1.0.0-pre4"
```

| 卡片 href（线上渲染，en = zh） | GitHub 页面 | GitHub API |
| --- | --- | --- |
| https://github.com/zssx-2026/Infinity-Cloud/releases/tag/v1.0.0-pre4 | 200 | 200 |
| https://github.com/zssx-2026/Infinity-File-Manager/releases/tag/v1.0.0-pre4 | 200 | 200 |
| https://github.com/zssx-2026/InfinityPackageManager/releases/tag/v1.0.0-pre4 | 200 | 200 |
| https://github.com/zssx-2026/Infinity-Toolbox/releases/tag/v1.0.0-pre4 | 200 | 200 |
| https://github.com/zssx-2026/Infinity-Installer-Manager/releases/tag/v1.0.0-pre4 | 200 | 200 |
| https://github.com/zssx-2026/Infinity-Games/releases/tag/v1.0.0-pre4 | 200 | 200 |

说明：首轮 curl 时本机 github.com 出口出现瞬时 502（6 条中 3 条），30 秒后重试全部 200，且 `api.github.com` 的 `/releases/tags/v1.0.0-pre4` 对六个仓库均为 200 —— 502 是本机代理抖动，不是标签缺失。线上 `download/` 与 `cn/download/` 均确认调用 `I.cards(...)`。

第七节第 1 条（`releases/latest` 会拿到旧稳定版）至此已按本方案关闭。
## 九、task-16：访问门 + “响应时间过长”（2026-10-04）

发布说明：本任务的站点文件**由 Lead 发布**，commit `58b9accabc4c`（50 blobs）；我未执行发布，仅做线上验证与截图。

### 实现（纯前端，无外部 CDN）

- 新增 `web/infinity/assets/verify.js`、`verify.css`、`verify-worker.js`；`web/infinity/index.html` 与 `web/infinity/cn/index.html` 的 `<head>` 中同步引入（`verify.css` 在 `site.css` 之后、`verify.js` 在其它脚本之前），因此首屏不会闪现正文。
- 遮罩只有“加载中”：产品标识 + 转圈 + `正在加载…` / `Loading…` + 进度条，**没有任何复选、长按、算式等交互控件**。`html.infinity-gate body{visibility:hidden}` 保证 3 秒内正文不可见。
- 后台静默挑战：`verify-worker.js` 在 Worker 里做 hashcash（自写 SHA-256，已与 `node:crypto` 逐例比对一致，含多字节 UTF-8），找 `SHA-256(prefix+nonce)` 前导十六进制 0。目标初始 5 个 0，每 800ms 降一级（最低 3 个 0），保证任何机器都能在窗口内成功 —— 这道门是“总是成功”的仪式，真正的等待来自时长下限。
- 时长常量单点：`MIN_MS=3000`（正文不早于 3s）、`MAX_MS=5000`（页面 5s 内必然有结果）、`SHORT_MS=700`（已通过者只做短延迟，保持一致观感）。
- 通过后写 `localStorage['infinity.verify']={v,ts,zeros}`，后续访问走 `mode=remembered`；`?verify=reset` 清除并重跑。
- 失败分支（均不弹错误、不跳 /404，整页替换为仿 ERR_TIMED_OUT 页：标题 + 一句话 + 无错误码/无诊断）：① `Worker` 不可用或构造异常；② `worker.onerror`；③ 搜索到 `MAX_MS` 仍未完成（`reason=max-time`）。为可复现失败保留只增不减的 QA 钩子 `?verify=difficulty=N`（N≥5，`N=64` 永不可能命中）。运行状态见 `window.__INFINITY_GATE`。
- 这两个入口页原先的 `guard.js` 已移除（改由这道更强的静默门接管，避免两层遮罩与旧门的 `/error/` 跳转）；其它页面仍保留 `guard.js`。

### 线上验证（curl）

```powershell
curl.exe -sS --ssl-no-revoke "https://zssx-2026.github.io/infinity/index.html?v=<ts>"     # verify.js/verify.css 引用有；guard.js 无
curl.exe -sS --ssl-no-revoke "https://zssx-2026.github.io/infinity/cn/index.html?v=<ts>"  # 同上
curl.exe -sS --ssl-no-revoke -o NUL -w "%{http_code}" "https://zssx-2026.github.io/infinity/assets/verify.js"        # 200
curl.exe -sS --ssl-no-revoke -o NUL -w "%{http_code}" "https://zssx-2026.github.io/infinity/assets/verify.css"       # 200
curl.exe -sS --ssl-no-revoke -o NUL -w "%{http_code}" "https://zssx-2026.github.io/infinity/assets/verify-worker.js" # 200
```

结果：en/cn 入口页均引用 `verify.js`/`verify.css` 且不再引用 `guard.js`；三个新资源全部 HTTP 200；线上 `verify.js` 含 `MIN_MS = 3000` 与 `difficulty` 钩子。

### Edge headless 时间证据（CDP 精确计时，计时起点 = 门自身开始）

工具：`work/_verify-shots/cdp-shots.mjs`（Edge 154 headless + DevTools Protocol，按门的 `startedAt` 定时截图）、`remembered-check.mjs`、本地调试用 `serve.mjs`。

| 截图 | 距门开始 | `result` | 遮罩存在 | body 可见性 | 可见文本 |
| --- | --- | --- | --- | --- | --- |
| live-en-01-t0.5s.png | 590 ms | pending | 是 | hidden | （空，只有遮罩） |
| live-en-02-t2.9s.png | 2976 ms | pending | 是 | hidden | （空，只有遮罩） |
| live-en-03-t3.5s.png | 3548 ms | shown | 否 | visible | `Infinity.Inc Overview Download … The Infinity suite …` |
| live-cn-01-t0.5s.png | 550 ms | pending | 是 | hidden | （空，只有遮罩） |
| live-cn-02-t2.9s.png | 2966 ms | pending | 是 | hidden | （空，只有遮罩） |
| live-cn-03-t3.5s.png | 3541 ms | shown | 否 | visible | `Infinity.Inc 概览 下载 文档 … Infinity 套件 …` |
| live-en-05-timed-out.png | ~5016 ms | timeout(max-time) | — | — | `This page took too long to respond / The page is temporarily unavailable. Please try again later.` |
| live-cn-05-timed-out.png | ~5008 ms | timeout(max-time) | — | — | `响应时间过长 / 该网页暂时无法访问，请稍后重试。` |

门自身计时（线上）：en `elapsedMs=3002`（3.002s 放行，`solvedAt` 905ms，实际用 4 个 0），cn `elapsedMs=3005`；两者正文可见时间正好卡在 `MIN_MS`，5s 上限用于兜底。导航到门开始仅 33/36ms（Pages 很快，不计入门时长）。

超时页由真实失败路径产生（`?verify=reset&difficulty=64` 使 PoW 不可能完成，5s 兜底触发），页面为整文档替换，**没有任何导航**，因此不会出现 /404、也没有弹窗。

已通过者的短路径（同一 profile 先完整通过一次，再访问 `/infinity/`）：`mode=remembered`，500ms 时仍是遮罩（pending），`elapsedMs=702` 放行 —— 符合 `SHORT_MS`。

### 交付物与残留

- 截图与逐张 JSON 证据：`work/_verify-shots/live-en-*.png`、`live-cn-*.png`、`live-en-report.json`、`live-cn-report.json`、`live-en-remembered.json`（本地副本 `local-*` 与各 profile 目录已清理）。
- 残留 1：纯前端门，禁用 JS 的访问者不会看到遮罩（无后端可用，属固有限制）。
- 残留 2：门只挂在两个入口页（`/infinity/`、`/infinity/cn/`），按需求未覆盖其它路由。
- 残留 3：PoW 难度是仪式性的（目标约 1.6s 内降到 3 个 0），因为需求要求验证“总是成功”且总时长落在 3–5 秒。
## 十、task-18：Token Key 页面（`/myself/token` 中英，2026-10-04）

### 交付物

- 新增 `web/infinity/assets/token.js`（19,043 B，sha256 前缀 `b48b65a20c8066c9`）与 `web/infinity/assets/token.css`（1,933 B，`d7d8b6f8835a2ced`）；逻辑没有写进 site.js。
- 新增 `web/infinity/myself/token/index.html`、`web/infinity/cn/myself/token/index.html`（各自 `<title>`/说明/资源路径独立，zh 页用 `../../../assets/*`，en 页用 `../../assets/*`）。
- `/infinity/myself/` 与 `/infinity/cn/myself/` 各加一行链接指向 `./token/`；两页均由 Lead 的 `work/apply-verify.mjs` 注入绝对路径的 `/infinity/assets/verify.css` 与 `/infinity/assets/verify.js`。

### 功能（方案 A：本地保险库；无后端）

- 密钥格式 `inc_<32 hex>`（`crypto.getRandomValues`），保存在 `localStorage['inc.tokens.v1']`：`{id, label, secret, createdAt, rotatedAt, lastUsedAt, scopes[]}`。
- 列表默认**打码**（`inc_••••••••••••••••••••`），可显示/隐藏、一键复制（`navigator.clipboard`，失败时回退到临时 textarea）；显示/复制/重新生成/删除每次操作后都有页内状态行。
- 创建：备注（必填）+ 权限范围（读取/写入/删除，默认读取）；重新生成：换新 secret 并记录 `rotatedAt`，旧值在本站立即失效；删除：**按钮内二次确认**（点一次进入“再点一次确认/click again to confirm”，6 秒后自动解除，不使用原生 `window.confirm`）。
- 导出 JSON（下载 `infinity-tokens.json`）与导入 JSON（按 ID 合并，已存在 ID 不覆盖，报告新增/跳过数量）。
- “如何接入”：两段示例（curl 与 `fetch`），均为 `Authorization: Bearer inc_<32 hex>`，并说明把主机/端口换成本地产品实际监听地址。
- 双语：本页自己的字符串表按 `<html lang>` 选择（site.js 未改动）；页面无需登录，与 GitHub 账户无关。
- 方案 B（可选 GitHub PAT 后端写 `tokens.json` 跨设备）**未实现**：它需要用户额外提供 PAT 并对“写到哪个仓库”做决定，属于用户级选择而非站点默认；方案 A 的导出/导入已覆盖“换机器”需求。

### 线上验证与发布

```powershell
$env:EV_GH_TOKEN = [Environment]::GetEnvironmentVariable('EV_GH_TOKEN','User'); node work/publish-site.mjs   # 60 blobs, pushed 19e39a9be000
curl.exe -sS --ssl-no-revoke -o NUL -w "%{http_code}" "https://zssx-2026.github.io/infinity/myself/token/"          # 200
curl.exe -sS --ssl-no-revoke -o NUL -w "%{http_code}" "https://zssx-2026.github.io/infinity/cn/myself/token/"       # 200
curl.exe -sS --ssl-no-revoke -o NUL -w "%{http_code}" "https://zssx-2026.github.io/infinity/assets/token.js"         # 200
curl.exe -sS --ssl-no-revoke -o NUL -w "%{http_code}" "https://zssx-2026.github.io/infinity/assets/token.css"        # 200
curl.exe -sS --ssl-no-revoke -o NUL -w "%{http_code}" "https://zssx-2026.github.io/infinity/assets/verify.js"        # 200
```

发布：`node work/publish-site.mjs` → 60 blobs，**`pushed 19e39a9be000 to main`**（此前 Lead 的 `0c983f221ca3`）。线上两个页面均 200，且引用 `token.js`/`token.css`（相对路径）、`/infinity/assets/verify.js` 与 `guard.js`；线上 `token.js`、`token.css` 与磁盘内容 sha256 一致（前缀 `b48b65a20c8066c9` / `d7d8b6f8835a2ced`）。

### Edge headless 三态截图（线上站点，Edge 154 + CDP）

工具 `work/_token-shots/token-shots.mjs`：先等人机验证门放行（`#infinity-gate` 消失且 body 可见）再截图，然后驱动真实指针/键盘事件走完流程并逐态读取 `localStorage` 断言。

| 截图 | 状态断言 |
| --- | --- |
| live-en-01-empty.png | `inc.tokens.v1` 无密钥，列表文案 `No keys yet. Create one above…` |
| live-en-02-created.png | 1 个密钥，密钥显示为 `inc_••••••••••••••••••••`（默认打码），状态行含备注 |
| live-en-03-regenerated.png | 同一 ID 的 secret 与创建时不同（`rotated: true`），本轮自动展开以便复制 |
| live-cn-01-empty.png | `还没有密钥。在上面创建一个，就能复制进产品里用了。` |
| live-cn-02-created.png | 1 个密钥，`inc_••••••••••••••••••••` |
| live-cn-03-regenerated.png | secret 已变化（`rotated: true`） |

流程断言（线上，逐态 JSON 见 `live-en-report.json` / `live-cn-report.json`）：空态 → 创建（count 1，打码）→ 重新生成（`rotated: true`，旋转后状态行 `Regenerated…` / `已重新生成…`）→ 删除二次确认（按钮文案 `click again to confirm` / `再点一次确认`）→ count 归零（`Deleted.` / `已删除。`）；两页均存在导出按钮、导入文件输入、2 段代码示例与每个密钥 4 个操作按钮。

### 残留

- 无后端：无法做服务端签发/校验/吊销，也无法统计真实调用次数，`lastUsedAt` 只显示“从未（本站无后端）”而非编造数据。
- 密钥按浏览器隔离，跨设备只能靠导出/导入；清除站点数据会一并删除密钥。
- 方案 B 未实现（见上）。

### 后记：Lead 在本任务期间对验证/守卫的调整（记录事实）

- `verify.js` 的失败分支已由 Lead 改为**强制跳转** `https://zssx-2026.github.io/404`（不再是第九节所述的整页替换式 ERR_TIMED_OUT）；`verify.css` 同步精简。
- `guard.js` 去掉了全屏 `#guard` 遮罩与跳 `/error/` 的行为；`web/infinity/error/` 与 `cn/error/` 已删除。
- 人机验证（`verify.css`/`verify.js`，绝对路径）已由 `work/apply-verify.mjs` 注入除 404 外的全部页面。
## 十一、task-28：token 页复验（创建后可反复查看/复制、仅本浏览器、INC 专属，2026-10-04）

线上产物指纹：`https://zssx-2026.github.io/infinity/assets/token.js` = **19956 B，sha256 `b7cbb770498e4673b48a7bc6c7151676609f3e3fdbe2a90cc53dd5ff9e40344c`**（已下载留档 `work/_token-shots/live-token.js`），与磁盘 `web/infinity/assets/token.js` 完全一致（byte 相同、sha256 相同）。

### 复验方法

工具 `work/_token-shots/verify-task28.mjs`：Edge 154 headless + CDP，先等人机验证门放行（`#infinity-gate` 消失、body 可见）再操作；全部操作用真实指针/键盘事件；每一步读取 DOM 与 `localStorage`，最后写 `task28-<lang>-report.json`。命令：

```powershell
node work/_token-shots/verify-task28.mjs "https://zssx-2026.github.io/infinity/cn/myself/token/" cn work/_token-shots 9252 zh "我的笔记本"
node work/_token-shots/verify-task28.mjs "https://zssx-2026.github.io/infinity/myself/token/"    en work/_token-shots 9253 en "my laptop"
```

### 结果：中文 12/12 PASS、英文 12/12 PASS

| # | 验收项 | 检查 | 结果 |
| --- | --- | --- | --- |
| 1 | 空态 | 0 个 `.token-item`，localStorage 无 `inc.tokens.v1`，显示空态文案 | PASS |
| 1 | 创建后 | 1 个密钥，`inc_<32hex>` **明文**（无 `•`），状态行含备注 | PASS |
| 1 | 刷新页面 | 仍 1 个、**同一 ID**、**同一明文密钥** | PASS |
| 1 | 复制 | 点击复制后状态行含 `已复制到剪贴板。` / `Copied to the clipboard.`，**不含** copyFailed 文案 | PASS |
| 2 | 隐藏 | 点“隐藏”后密钥为 `inc_••••••••••••••••••••`，按钮变为“显示” | PASS |
| 2 | 显示 | 再点“显示”后恢复原文，ID 不变，按钮变回“隐藏” | PASS |
| 3 | 重新生成 | 明文变化、仍为明文、ID 不变 | PASS |
| 3 | 复制（生成后） | 状态行再次 `已复制`，无 copyFailed | PASS |
| 3 | 删除 | 第一次点击仅进入 `再点一次确认` / `click again to confirm`（条目仍在），第二次点击后条目为 0、vault 为 0 | PASS |
| 4 | INC 专属文案 | 含 `权限范围（仅限 INC）` / `Scopes (INC only)` | PASS |
| 4 | 仅本浏览器 | 含 `本浏览器中我自己创建的密钥` / `Keys I created in this browser` | PASS |
| 4 | 示例端口 | 两段示例（curl 与 fetch）均为 `127.0.0.1:7621/v1/ping` | PASS |

逐项 DOM/localStorage 证据见 `work/_token-shots/task28-cn-report.json`、`task28-en-report.json`（含每一步的 `secrets`、`ids`、`rowButtons`、`actionButtons`、`status`、`h3`、`scopesLabel`、`pre`）。

### 截图（线上，Edge headless，work/_token-shots/）

`task28-cn-01-empty.png`、`-02-created.png`、`-03-after-reload.png`、`-04-copied.png`、`-05-hidden.png`、`-06-shown.png`、`-07-regenerated.png`、`-08-delete-armed.png`、`-09-deleted.png`；英文同名 `task28-en-01…09`。

### 观察项（不影响上述 5 项结论，但建议修）

- 创建后的状态行文案仍是旧行为的说法：中文 `已创建：我的笔记本。 密钥默认打码，点“显示”再复制。`，英文 `Created: my laptop。 The secret is masked by default; press Show, then Copy.`。而实现已经改为**默认明文**（`revealed[id] === false` 才打码），这条提示与事实矛盾，正是用户上一次报障（“创建后不可查看”）会再次困惑的地方。证据：`task28-*-report.json` 的 `observations`。（token.js 不在本任务写作用域内，未擅改。）
- 复核脚本自身的一个统计口径已修正并重跑：`counts()` 在 localStorage 完全没有键时返回 `-1`（正确语义是 0），首次运行时把“空态无密钥”误判为 FAIL；修正后中英文均 12/12。截图与 JSON 为修正后重跑结果。

### 结论

用户报障的两点（创建后不可查看/再次复制、只显示本浏览器自己创建的密钥）在当前线上版本均**已修复且可复现通过**；剩余问题只有创建提示的过期措辞。




