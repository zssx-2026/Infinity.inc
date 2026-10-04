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

