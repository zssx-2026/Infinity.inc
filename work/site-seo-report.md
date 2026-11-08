# site-seo 报告 — task-16：官网可发现性与元数据补全

- 任务：`task-16`（owner: site-seo）
- 工作区：`D:\dev\DeepSeekHarnessWorkspace\Infinity.inc`
- 时间：2026-10-06
- 结论：**全部达成**。38 个页面全部 200，hreflang 双向对齐、Open Graph / Twitter Card 齐备，新增 `sitemap.xml`（38 URL）与 `robots.txt`，英文 404 已补语言切换；`node work\cn-lead-verify.mjs web` 仍 **PASS（19 页 problems=0）**。

## 1. 交付物

### 1.1 新增文件

| 文件 | 字节 | sha256 | 说明 |
|---|---:|---|---|
| `web/infinity/sitemap.xml` | 16200 | `9a0df8c14b7966dfe19bc1516571b963c385ad0b84182845e47116a3da067471` | 38 个 `<loc>`，19 组中英配对，每个 URL 均带 `en` / `zh-CN` / `x-default` 三条 `xhtml:link` alternate |
| `web/infinity/robots.txt` | 139 | `519b7ac80f6b92babfe2caedf3e020d5c51613a6ab173801df9cf7a6be9934be` | 任务要求的路径：`User-agent: *` + `Allow: /`，`Sitemap:` 指向 sitemap.xml |
| `web/robots.txt` | 195 | `f34dea6672239c2c8e4e78d0870b644bcc84217ce5146a1ed618aa20cd13f963` | **补充**：`web/` 是部署根（`web/index.html` 以 `./infinity/...` 引用资源，即 Pages 主机根 `https://zssx-2026.github.io/`），而爬虫只读取主机根的 `/robots.txt`。只放 `web/infinity/robots.txt` 不会被读到，故在根再放一份同内容 |
| `work/site-seo-apply.mjs` | 7846 | — | 生成/注入脚本，幂等（重跑 `updated:0, skipped:38`） |
| `work/site-seo-verify.mjs` | 9739 | — | 只读静态服务器 + 38 页断言 + sitemap/robots/404 校验 |

### 1.2 修改文件（38 个 HTML，每页均为"纯插入"）

- 每页在 `<head>` 内插入一段带标记 `<!-- site-seo: hreflang + open graph -->` 的元数据块；
- 仅 `web/infinity/404.html` 的正文锚点行做了替换（补中文切换链接），其余正文一行未动；
- **未改动任何英文站文案语义**，**未改动任何 `assets/*.js`**（assets 下所有 .js 的 mtime 均早于本次写入，见 §5）。

## 2. 逐页清单（38/38）

> hreflang 采用**绝对 URL**（Google/Bing 要求 hreflang 与 og:url 为完全限定 URL）；其路径部分即任务要求的 `/infinity/<path>`（英文）与 `/infinity/cn/<path>`（中文）。`en` 与 `zh-CN` 两条在所有 38 页上逐页互为对端，`x-default` 一律等于英文 URL。

| # | 页面 | lang | og:locale | self (canonical / og:url) | hreflang en / x-default | hreflang zh-CN | 描述字数 | 字节 | sha256(前16) |
|---:|---|---|---|---|---|---|---:|---:|---|
| 1 | `web/infinity/404.html` | en | en_US | `https://zssx-2026.github.io/infinity/404.html` | `https://zssx-2026.github.io/infinity/404.html` | `https://zssx-2026.github.io/infinity/cn/404.html` | 48 | 3061 | `e0875bb60626cb77` |
| 2 | `web/infinity/cloud/index.html` | en | en_US | `https://zssx-2026.github.io/infinity/cloud/` | `https://zssx-2026.github.io/infinity/cloud/` | `https://zssx-2026.github.io/infinity/cn/cloud/` | 235 | 10813 | `ad7f267a0635b8ea` |
| 3 | `web/infinity/cn/404.html` | zh-CN | zh_CN | `https://zssx-2026.github.io/infinity/cn/404.html` | `https://zssx-2026.github.io/infinity/404.html` | `https://zssx-2026.github.io/infinity/cn/404.html` | 16 | 3191 | `7fa3ff4c8ebf29eb` |
| 4 | `web/infinity/cn/cloud/index.html` | zh-CN | zh_CN | `https://zssx-2026.github.io/infinity/cn/cloud/` | `https://zssx-2026.github.io/infinity/cloud/` | `https://zssx-2026.github.io/infinity/cn/cloud/` | 44 | 9764 | `c3b91b9adcd5cc18` |
| 5 | `web/infinity/cn/docs/index.html` | zh-CN | zh_CN | `https://zssx-2026.github.io/infinity/cn/docs/` | `https://zssx-2026.github.io/infinity/docs/` | `https://zssx-2026.github.io/infinity/cn/docs/` | 27 | 4944 | `87b814b90aca0866` |
| 6 | `web/infinity/cn/download/index.html` | zh-CN | zh_CN | `https://zssx-2026.github.io/infinity/cn/download/` | `https://zssx-2026.github.io/infinity/download/` | `https://zssx-2026.github.io/infinity/cn/download/` | 167 | 2575 | `0a22e37b95aafbd1` |
| 7 | `web/infinity/cn/download/infinitycloud/index.html` | zh-CN | zh_CN | `https://zssx-2026.github.io/infinity/cn/download/infinitycloud/` | `https://zssx-2026.github.io/infinity/download/infinitycloud/` | `https://zssx-2026.github.io/infinity/cn/download/infinitycloud/` | 48 | 1997 | `c1350bff760ac08e` |
| 8 | `web/infinity/cn/download/infinityfilemanager/index.html` | zh-CN | zh_CN | `https://zssx-2026.github.io/infinity/cn/download/infinityfilemanager/` | `https://zssx-2026.github.io/infinity/download/infinityfilemanager/` | `https://zssx-2026.github.io/infinity/cn/download/infinityfilemanager/` | 49 | 2066 | `e09cccfe917a8889` |
| 9 | `web/infinity/cn/download/infinitygames/index.html` | zh-CN | zh_CN | `https://zssx-2026.github.io/infinity/cn/download/infinitygames/` | `https://zssx-2026.github.io/infinity/download/infinitygames/` | `https://zssx-2026.github.io/infinity/cn/download/infinitygames/` | 46 | 1961 | `d2cfd7db3d39796a` |
| 10 | `web/infinity/cn/download/infinityinstallmanager/index.html` | zh-CN | zh_CN | `https://zssx-2026.github.io/infinity/cn/download/infinityinstallmanager/` | `https://zssx-2026.github.io/infinity/download/infinityinstallmanager/` | `https://zssx-2026.github.io/infinity/cn/download/infinityinstallmanager/` | 49 | 2096 | `9958287aa3b32a26` |
| 11 | `web/infinity/cn/download/infinitypackagemanager/index.html` | zh-CN | zh_CN | `https://zssx-2026.github.io/infinity/cn/download/infinitypackagemanager/` | `https://zssx-2026.github.io/infinity/download/infinitypackagemanager/` | `https://zssx-2026.github.io/infinity/cn/download/infinitypackagemanager/` | 48 | 2066 | `2a0c6f5a5d80d30b` |
| 12 | `web/infinity/cn/download/infinitytoolbox/index.html` | zh-CN | zh_CN | `https://zssx-2026.github.io/infinity/cn/download/infinitytoolbox/` | `https://zssx-2026.github.io/infinity/download/infinitytoolbox/` | `https://zssx-2026.github.io/infinity/cn/download/infinitytoolbox/` | 47 | 1995 | `79bc2100dd11ed19` |
| 13 | `web/infinity/cn/index.html` | zh-CN | zh_CN | `https://zssx-2026.github.io/infinity/cn/` | `https://zssx-2026.github.io/infinity/` | `https://zssx-2026.github.io/infinity/cn/` | 179 | 5328 | `5fdd173b1a302cf5` |
| 14 | `web/infinity/cn/login/index.html` | zh-CN | zh_CN | `https://zssx-2026.github.io/infinity/cn/login/` | `https://zssx-2026.github.io/infinity/login/` | `https://zssx-2026.github.io/infinity/cn/login/` | 60 | 2038 | `530b158d978478ff` |
| 15 | `web/infinity/cn/login/link/index.html` | zh-CN | zh_CN | `https://zssx-2026.github.io/infinity/cn/login/link/` | `https://zssx-2026.github.io/infinity/login/link/` | `https://zssx-2026.github.io/infinity/cn/login/link/` | 40 | 4722 | `8b5fe56f1ee61ffd` |
| 16 | `web/infinity/cn/myself/index.html` | zh-CN | zh_CN | `https://zssx-2026.github.io/infinity/cn/myself/` | `https://zssx-2026.github.io/infinity/myself/` | `https://zssx-2026.github.io/infinity/cn/myself/` | 47 | 5989 | `010231f113c1f750` |
| 17 | `web/infinity/cn/myself/token/index.html` | zh-CN | zh_CN | `https://zssx-2026.github.io/infinity/cn/myself/token/` | `https://zssx-2026.github.io/infinity/myself/token/` | `https://zssx-2026.github.io/infinity/cn/myself/token/` | 49 | 2082 | `9f58171ad6d0f5b7` |
| 18 | `web/infinity/cn/run/index.html` | zh-CN | zh_CN | `https://zssx-2026.github.io/infinity/cn/run/` | `https://zssx-2026.github.io/infinity/run/` | `https://zssx-2026.github.io/infinity/cn/run/` | 75 | 6027 | `81d5d81064f97aef` |
| 19 | `web/infinity/cn/settings/index.html` | zh-CN | zh_CN | `https://zssx-2026.github.io/infinity/cn/settings/` | `https://zssx-2026.github.io/infinity/settings/` | `https://zssx-2026.github.io/infinity/cn/settings/` | 38 | 7472 | `4f901fde816e8a56` |
| 20 | `web/infinity/cn/signup/index.html` | zh-CN | zh_CN | `https://zssx-2026.github.io/infinity/cn/signup/` | `https://zssx-2026.github.io/infinity/signup/` | `https://zssx-2026.github.io/infinity/cn/signup/` | 71 | 2179 | `84f4d705725fff5e` |
| 21 | `web/infinity/cn/versions/archive/index.html` | zh-CN | zh_CN | `https://zssx-2026.github.io/infinity/cn/versions/archive/` | `https://zssx-2026.github.io/infinity/versions/archive/` | `https://zssx-2026.github.io/infinity/cn/versions/archive/` | 39 | 2396 | `3d1d6c3c3490001c` |
| 22 | `web/infinity/docs/index.html` | en | en_US | `https://zssx-2026.github.io/infinity/docs/` | `https://zssx-2026.github.io/infinity/docs/` | `https://zssx-2026.github.io/infinity/cn/docs/` | 92 | 4989 | `d305e1850dffc69b` |
| 23 | `web/infinity/download/index.html` | en | en_US | `https://zssx-2026.github.io/infinity/download/` | `https://zssx-2026.github.io/infinity/download/` | `https://zssx-2026.github.io/infinity/cn/download/` | 148 | 2249 | `6fada147d8340640` |
| 24 | `web/infinity/download/infinitycloud/index.html` | en | en_US | `https://zssx-2026.github.io/infinity/download/infinitycloud/` | `https://zssx-2026.github.io/infinity/download/infinitycloud/` | `https://zssx-2026.github.io/infinity/cn/download/infinitycloud/` | 103 | 1910 | `57b36635e4b62dc1` |
| 25 | `web/infinity/download/infinityfilemanager/index.html` | en | en_US | `https://zssx-2026.github.io/infinity/download/infinityfilemanager/` | `https://zssx-2026.github.io/infinity/download/infinityfilemanager/` | `https://zssx-2026.github.io/infinity/cn/download/infinityfilemanager/` | 110 | 1982 | `aabe7836acde1d51` |
| 26 | `web/infinity/download/infinitygames/index.html` | en | en_US | `https://zssx-2026.github.io/infinity/download/infinitygames/` | `https://zssx-2026.github.io/infinity/download/infinitygames/` | `https://zssx-2026.github.io/infinity/cn/download/infinitygames/` | 103 | 1910 | `b12ed41c9ba4750f` |
| 27 | `web/infinity/download/infinityinstallmanager/index.html` | en | en_US | `https://zssx-2026.github.io/infinity/download/infinityinstallmanager/` | `https://zssx-2026.github.io/infinity/download/infinityinstallmanager/` | `https://zssx-2026.github.io/infinity/cn/download/infinityinstallmanager/` | 115 | 2027 | `23c8e305b47c176c` |
| 28 | `web/infinity/download/infinitypackagemanager/index.html` | en | en_US | `https://zssx-2026.github.io/infinity/download/infinitypackagemanager/` | `https://zssx-2026.github.io/infinity/download/infinitypackagemanager/` | `https://zssx-2026.github.io/infinity/cn/download/infinitypackagemanager/` | 111 | 2003 | `ee101687d04e635f` |
| 29 | `web/infinity/download/infinitytoolbox/index.html` | en | en_US | `https://zssx-2026.github.io/infinity/download/infinitytoolbox/` | `https://zssx-2026.github.io/infinity/download/infinitytoolbox/` | `https://zssx-2026.github.io/infinity/cn/download/infinitytoolbox/` | 105 | 1932 | `d85536e3d9694455` |
| 30 | `web/infinity/index.html` | en | en_US | `https://zssx-2026.github.io/infinity/` | `https://zssx-2026.github.io/infinity/` | `https://zssx-2026.github.io/infinity/cn/` | 179 | 4880 | `340a514301ccf3ef` |
| 31 | `web/infinity/login/index.html` | en | en_US | `https://zssx-2026.github.io/infinity/login/` | `https://zssx-2026.github.io/infinity/login/` | `https://zssx-2026.github.io/infinity/cn/login/` | 144 | 2059 | `dff810a6f383e872` |
| 32 | `web/infinity/login/link/index.html` | en | en_US | `https://zssx-2026.github.io/infinity/login/link/` | `https://zssx-2026.github.io/infinity/login/link/` | `https://zssx-2026.github.io/infinity/cn/login/link/` | 189 | 5192 | `0137ae6d6f10e13c` |
| 33 | `web/infinity/myself/index.html` | en | en_US | `https://zssx-2026.github.io/infinity/myself/` | `https://zssx-2026.github.io/infinity/myself/` | `https://zssx-2026.github.io/infinity/cn/myself/` | 121 | 6233 | `cfa1050d1ddf2db2` |
| 34 | `web/infinity/myself/token/index.html` | en | en_US | `https://zssx-2026.github.io/infinity/myself/token/` | `https://zssx-2026.github.io/infinity/myself/token/` | `https://zssx-2026.github.io/infinity/cn/myself/token/` | 129 | 2028 | `ae4b5c41d9654721` |
| 35 | `web/infinity/run/index.html` | en | en_US | `https://zssx-2026.github.io/infinity/run/` | `https://zssx-2026.github.io/infinity/run/` | `https://zssx-2026.github.io/infinity/cn/run/` | 263 | 6794 | `8382cf0d1b7124e8` |
| 36 | `web/infinity/settings/index.html` | en | en_US | `https://zssx-2026.github.io/infinity/settings/` | `https://zssx-2026.github.io/infinity/settings/` | `https://zssx-2026.github.io/infinity/cn/settings/` | 172 | 7763 | `248a05a44d02fa4d` |
| 37 | `web/infinity/signup/index.html` | en | en_US | `https://zssx-2026.github.io/infinity/signup/` | `https://zssx-2026.github.io/infinity/signup/` | `https://zssx-2026.github.io/infinity/cn/signup/` | 184 | 2215 | `b3a11b8765d58954` |
| 38 | `web/infinity/versions/archive/index.html` | en | en_US | `https://zssx-2026.github.io/infinity/versions/archive/` | `https://zssx-2026.github.io/infinity/versions/archive/` | `https://zssx-2026.github.io/infinity/cn/versions/archive/` | 125 | 2458 | `29f690783663fd33` |

说明：`en` 列在英文页等于 self，在中文页等于同路径英文页；`zh-CN` 列反之。英文 19 页 + 中文 19 页 = 38 页，与 `web/infinity/**/*.html` 的集合完全一致（含两页 404）。

## 3. 元数据口径

- `<link rel="canonical">`：每页 1 条，等于该页自身 URL（38/38）。
- `<link rel="alternate" hreflang="en">` / `"zh-CN"` / `"x-default"`：每页各 1 条（共 3 条，38/38），双向对齐。
- Open Graph：`og:type=website`、`og:site_name=Infinity.Inc`、`og:title`（= `<title>`）、`og:description`（= 该页 meta description）、`og:url`（= self）、`og:locale`（英文 `en_US` / 中文 `zh_CN`）、`og:locale:alternate`（取对端语言）。
- Twitter Card：`twitter:card=summary`、`twitter:title`、`twitter:description`（中英各自取值）。
- 缺失 description 的 9 页（`404.html`、`cloud/`、`cn/404.html`、`cn/run/`、`docs/`、`login/link/`、`myself/`、`run/`、`settings/`）已补 `meta description`：取该页自带可见文案（`<p class="lede">` 或 `<p id="what">`）；`cn/run/` 的 lede 由 JS 注入，改从 `assets/site.js` 的 zh 文本表 `runLede` 取值（只读，未改 site.js）。**没有新增任何文案语义**。
- 数值型 id（`/run/<id>`、`/login/link/<id>` 等动态路由）不生成独立 URL，仍指向静态页 `/infinity/run/` 等，符合"数值型 id 不需要"。

## 4. 验证输出

### 4.1 只读静态服务器逐页 GET（自建 `work/site-seo-verify.mjs`）

命令：`& 'D:\program\nodejs\node.exe' work\site-seo-verify.mjs web` → **exit 0**

```json
{ "pages": 38, "http200": 38, "sitemapLocs": 38, "problems": 0 }
PASS 38/38 页面 200 且 hreflang/og/twitter/sitemap/robots/404 全部通过
```

断言内容：38 页全部 HTTP 200；每页 canonical / 3 条 hreflang / og 六项 / twitter 三项取值逐项比对；对端页面回指本页（双向）；sitemap 38 个 `<loc>` 与页面集合完全一致且 alternate 正确；robots 允许抓取并指向 sitemap；英文 404 ↔ 中文 404 双向切换链接可达。

### 4.2 中文站验收（既有 `work/cn-lead-verify.mjs`）

命令：`& 'D:\program\nodejs\node.exe' work\cn-lead-verify.mjs web` → **exit 0**

```json
{ "cnPages": 19, "missingPages": [], "problems": 0 }
PASS 中文站完全汉化
```

### 4.3 sitemap.xml 结构

- PowerShell `[xml]` 解析：`XML_OK root=urlset urls=38`（well-formed）；
- `sitemapLocs=38`，`xmlns:xhtml` 命名空间存在，逐 `<url>` 含 3 条 `xhtml:link`。

### 4.4 幂等与完整性

- 重跑 apply：`updated:0, skipped:38`（不重复注入）；
- 逐文件断言：标记 1 处、canonical 1 条、alternate 3 条、`<meta name="description">` 1 条、`<script>`/`</script>` 配平、以 `</html>` 结尾 —— 全部通过；
- 两个 404 页面本就是"刻意独立、内联样式、不加载 site.css/site.js"，因此无 `<link rel="stylesheet">` 属预期，非破坏；
- verifier 另校验 `web/robots.txt`（部署根）存在、`Allow: /` 且 Sitemap 指向正确。

## 5. 命令、退出码与时间戳证据

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `& 'D:\program\nodejs\node.exe' work\site-seo-apply.mjs` | 0 | `pages:38, updated:38, skipped:[]`；sitemap 16200B / web/infinity/robots.txt 139B / web/robots.txt 195B |
| `& 'D:\program\nodejs\node.exe' work\site-seo-verify.mjs web` | 0 | `http200:38, problems:0` |
| `& 'D:\program\nodejs\node.exe' work\cn-lead-verify.mjs web` | 0 | `cnPages:19, problems:0` |
| `[xml](Get-Content -Raw web\infinity\sitemap.xml)` | 0 | `XML_OK root=urlset urls=38` |
| 重跑 `work\site-seo-apply.mjs` | 0 | `updated:0, skipped:38`（幂等） |

时间戳证据：38 个 HTML 的写入 mtime 均晚于 `assets/*.js`（如 `site.js` mtime `2026-10-06T03:24:07Z`，HTML 写入 `2026-10-06T05:58Z`），且 apply 脚本的写集合仅 `.html` + `sitemap.xml` + `robots.txt`，可证本次未改 `assets/**`。

## 6. 硬约束遵守情况

- 只写 `web/**`（`web/infinity/` 下 38 个 HTML + `sitemap.xml` + `robots.txt`，以及部署根 `web/robots.txt`）与 `work/site-seo-*.mjs`、本报告；未触碰 ING/Infinity Games 源码资源、`history/`、`work/sync-history.mjs`。
- 未改英文站文案语义（只新增元数据；404 仅加一条语言链接）。
- 未改 `assets/*.js` 逻辑（`site.js` 仅只读读取，取其 zh `runLede`）。
- 未破坏既有脚本引用：每页原有 `<script src>` / `<link rel="stylesheet">` 全部保留（diff 可见纯插入）。

## 7. 遗留与风险（供 Lead 判断）

1. **hreflang 用绝对 URL**：符合 Google/Bing 规范，路径为 `/infinity/...`、`/infinity/cn/...`。若 Lead 的验收口径要求字面 root-relative（`href="/infinity/..."`），只需把 apply 脚本里的 `BASE` 改为 `/infinity/` 重跑即可，但会牺牲 hreflang 的规范性。
2. **404 页同时 `noindex` 又在 sitemap 中**：任务明确要求 sitemap 列出 38 个页面 URL（含 404），故照办；`noindex` 保留未动。搜索引擎会忽略 sitemap 中 noindex 的 404，不影响其余 36 个可收录页。若希望更"纯"，可从 sitemap 移除两条 404，但会变成 36 URL 而与本任务"38"口径不符。
3. **无 `og:image`**：站点没有可用的社交分享图资源，故 `twitter:card=summary`（而非 `summary_large_image`），未新增图片资产。
4. **`og:type` 统一为 `website`**：未给文档页单独用 `article`，因为任务只要求该字段存在且站点为静态官网。
5. **主机根页面未纳入 38 页**：`web/index.html` 与 `web/404.html` 是部署根页面（不在 `web/infinity/**` 内），按任务"38 个页面"的口径未加 hreflang/og，也未列入 sitemap。若需要覆盖这两页请另开任务。
6. 部署域假设为 `https://zssx-2026.github.io`（与站内 404、site.js 注释、Pages 路径一致）。若将来换域，需同步 update `BASE` 后重跑。

---

## 8. task-22 收尾：404 移出 sitemap + 部署根页面元数据

> §1–§7 是 task-16 当时的快照；本节是 task-22 的增量，sitemap / 根页面 / 脚本以本节为准。

### 8.1 改动

1. **sitemap.xml：38 → 36 条可索引 URL**（18 组中英配对）。移除 `/infinity/404.html` 与 `/infinity/cn/404.html`（它们带 `noindex`，不该出现在 sitemap）；其余每组仍保持 `en` / `zh-CN` / `x-default` 三条 `xhtml:link`。**16200B → 15432B**，sha256=`510eba8c3a20725a1d10801ea805f70c03dd18f63a430b57d339f82a76ae07e4`。
2. **部署根 `web/index.html`**：插入 canonical=`https://zssx-2026.github.io/` + `og:type/site_name/title/description/url/locale` + `twitter:card/title/description`（13 行，纯插入）。该页没有中英对应页，故**不写 hreflang**、也不写 `og:locale:alternate`（`og:locale=en_US`）。**3644B → 4589B**，sha256=`32c3d7510a6e05a3cd0d7051a98908c7378193344613fa41e0cff6e553cfce65`。
3. **部署根 `web/404.html`**：插入 canonical=`https://zssx-2026.github.io/404.html` + og + twitter（12 行，含补 `meta description`，取自页内 `<p id="what">`），无 hreflang；**保留 `<meta name="robots" content="noindex">`**。**1830B → 2596B**，sha256=`abf187aafca6039459fec326cdc2bfbe60a41790cb55238e14a528a27924c9f7`。
4. **两份 robots.txt 的 Sitemap 指向一致**，均为 `https://zssx-2026.github.io/infinity/sitemap.xml`：`web/infinity/robots.txt` 139B（sha256=`519b7ac8…`）、`web/robots.txt` 195B（sha256=`f34dea66…`），内容本次未变，仅由 apply 脚本统一生成以保证一致。
5. **脚本同步更新**：`work/site-seo-apply.mjs` 现也处理两个部署根页面、sitemap 只取 18 组、并生成两份 robots（10765B，sha256=`79501b7b…`）；`work/site-seo-verify.mjs` 断言数 38→36 并新增根页面/robots 断言（13250B，sha256=`40092376…`）。

### 8.2 验证（全部 exit 0）

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `& 'D:\program\nodejs\node.exe' work\site-seo-verify.mjs web` | 0 | `{pages:38, http200:38, rootPages:2, sitemapLocs:36, problems:0}` → PASS |
| `& 'D:\program\nodejs\node.exe' work\cn-lead-verify.mjs web` | 0 | `{cnPages:19, missingPages:[], problems:0}` → PASS 中文站完全汉化 |
| `[xml](Get-Content -Raw web\infinity\sitemap.xml)` | 0 | `XML_OK root=urlset urls=36` |
| 重跑 `work\site-seo-apply.mjs` | 0 | `pages:38, updated:0`（幂等；38 套件页 + 2 根页均跳过，sitemapUrls:36） |
| `git diff --stat -- web/index.html web/404.html` | 0 | `web/404.html +12`、`web/index.html +13`，无删除行（纯插入） |

### 8.3 断言数从 38 改为 36 的说明

原 verifier 断言 `sitemapLocs=38`。因为 task-22 明确"404 是 noindex，不应进 sitemap"，改断言为 **36**，并同时加强：

- 期望集合 = 全部 38 页中排除两页 404（即 18 组中英配对）；
- 额外断言 sitemap 中**不得存在任何以 `404.html` 结尾的 `loc`**；
- 每条 `loc` 仍必须带 `en` / `zh-CN` / `x-default` 三条 alternate，且取值与页面一致；
- 新增根页面断言：`/` canonical=`https://zssx-2026.github.io/`、`/404.html` canonical=`https://zssx-2026.github.io/404.html`，两者 og/twitter 齐备、**hreflang 条目为 0**、根 404 具 `noindex`；
- 新增两份 robots.txt 的 `Sitemap:` 指向必须一致。

### 8.4 遗留

- 部署根两页无中英对应，故无 hreflang（即 task-22 的"无对应则只 canonical+og"）；根页面的中文入口由 site.js 运行时改写为 `/infinity/cn/`，属跳转而非 hreflang 关系。
- 根 `/404.html` 保持 `noindex` 且不在 sitemap；`web/infinity/404.html`、`web/infinity/cn/404.html` 同样 `noindex` 且已移出 sitemap，口径矛盾已消除。
- 本次只改 `web/**`（sitemap.xml、两份 robots.txt、web/index.html、web/404.html）与两个脚本/本报告；未改 `assets/*.js`、未改任何正文语义。

