# 中文官网页面汉化报告（task-13 / cn-pages）

日期：2026-10-06 · 责任人：cn-pages · 范围：`web/infinity/cn/**` + 本报告
硬约束遵守：未改动 `web/infinity/assets/**`（运行时文案归 cn-runtime / task-14），未改动英文站页面与任何英文 404。

## 1. 结论

- 中文站页面由 18 页补齐为 **19 页**，与英文站 19 页（`404.html` + 18 个目录页）**一一对应**。
- 新增 `web/infinity/cn/404.html`，全中文，返回首页指向 `/infinity/cn/`，语言切换指向英文 `/infinity/404.html`。
- 11 个页面的 `<title>` / `<meta name="description">` 中残留的英文产品名已替换为『中文名（English）』首次出现形式；同页后续只用中文名。
- 静态 HTML 结构 / class / 资源路径 / `<script>` 引用 **零改动**（只改文案文本节点与文案属性）。
- 独立验收 `work/cn-lead-verify.mjs`：**PASS，problems=0**；自建只读静态服务器逐页 GET：**19/19 返回 200 且 title 含中文**。

## 2. 品牌名对照（统一约定）

| 中文名 | 首次出现形式（本页第一次出现时使用） | 后续出现 |
| --- | --- | --- |
| 无限云盘 | 无限云盘（Infinity Cloud） | 无限云盘 |
| 文件管理器 | 文件管理器（Infinity File Manager） | 文件管理器 |
| 包管理器 | 包管理器（InfinityPackageManager） | 包管理器 |
| 工具箱 | 工具箱（Infinity Toolbox） | 工具箱 |
| 安装管理器 | 安装管理器（Infinity Installer Manager） | 安装管理器 |
| 游戏 | 游戏（Infinity Games） | 游戏 |

说明：包管理器的英文品牌在英文站一律写作 `InfinityPackageManager`（无空格），为保证与英文站一字不差，中文页沿用该原始写法；其余产品沿用英文站的空格写法。站点品牌 `Infinity.Inc` 作为公司/站点专名保留，出现在每页 title 后缀。套件名 `Infinity suite` 在首页 title 译为「无限套件」。

## 3. 新增文件

| 文件 | 说明 |
| --- | --- |
| `web/infinity/cn/404.html` | 对应英文 `web/infinity/404.html`。`lang="zh-CN"`，title「页面未找到 — Infinity.Inc」，`meta robots=noindex`，内联样式与英文版逐条对应（只把注释与文案译成中文）。首页链接 `https://zssx-2026.github.io/infinity/cn/`（指向 cn）；语言切换 `https://zssx-2026.github.io/infinity/404.html`（指向英文 404，带 `hreflang="en"`）。内联脚本保留英文版的 404 语义：`/infinity/*` 视为套件路径 → 重定向到真实存在的 `https://zssx-2026.github.io/404`（与英文版完全一致，避免死循环），其余路径把中文提示填入 `#what`。 |

## 4. 逐页 前 → 后 文案摘要（共 11 页有文案改动）

### web/infinity/cn/index.html
- title：`Infinity.Inc — Infinity 套件` → `Infinity.Inc — 无限套件`
- description：`Infinity Cloud、Infinity File Manager、InfinityPackageManager、Infinity Toolbox、Infinity Installer Manager 与 Infinity Games：只需要 Windows 的 Windows 应用。`
  → `无限云盘（Infinity Cloud）、文件管理器（Infinity File Manager）、包管理器（InfinityPackageManager）、工具箱（Infinity Toolbox）、安装管理器（Infinity Installer Manager）与游戏（Infinity Games）：只需要 Windows 的 Windows 应用。`

### web/infinity/cn/download/index.html
- title：`下载 — Infinity.Inc`（不变，已是中文）
- description：`下载 Infinity Cloud、Infinity File Manager、InfinityPackageManager、Infinity Toolbox、Infinity Installer Manager 与 Infinity Games。`
  → `下载无限云盘（Infinity Cloud）、文件管理器（Infinity File Manager）、包管理器（InfinityPackageManager）、工具箱（Infinity Toolbox）、安装管理器（Infinity Installer Manager）与游戏（Infinity Games）的 Windows 版。`

### web/infinity/cn/cloud/index.html
- title：`云盘 — Infinity.Inc`（不变；对应英文 `Cloud — Infinity.Inc`）
- description：`Infinity Cloud 在桌面上显示的同一个云盘，从同一批 release 里读出来。`
  → `与桌面端无限云盘（Infinity Cloud）所显示的同一个云盘，从同一批发布中读取。`

### web/infinity/cn/myself/index.html
- title：`账户 — Infinity.Inc`（不变）
- description：`这里没有需要管理的 Infinity 账户。本页显示这套软件正在以哪个 GitHub 账户行动，以及它能访问什么。`
  → `这里没有需要管理的账户；本页显示这套软件正在以哪个 GitHub 账户行动，以及它能访问什么。`

### web/infinity/cn/myself/token/index.html
- title：`令牌密钥 — Infinity.Inc`（不变）
- description：`创建、显示、复制、重新生成和删除保存在本浏览器中的 Infinity 令牌密钥，并给出把密钥发给产品 API 的示例。`
  → `创建、显示、复制、重新生成和删除保存在本浏览器中的令牌密钥，并给出把密钥发给产品 API 的示例。`

### 六款产品下载页（title 与 description 各一处）
| 页面 | title 前 → 后 | description 前 → 后（产品名部分） |
| --- | --- | --- |
| `download/infinitycloud/` | `Infinity Cloud — Infinity.Inc` → `无限云盘（Infinity Cloud）— Infinity.Inc` | `下载 Windows 版 Infinity Cloud。…` → `下载 Windows 版无限云盘。…` |
| `download/infinityfilemanager/` | `Infinity File Manager — Infinity.Inc` → `文件管理器（Infinity File Manager）— Infinity.Inc` | `…Infinity File Manager…` → `…文件管理器…` |
| `download/infinitypackagemanager/` | `InfinityPackageManager — Infinity.Inc` → `包管理器（InfinityPackageManager）— Infinity.Inc` | `…InfinityPackageManager…` → `…包管理器…` |
| `download/infinitytoolbox/` | `Infinity Toolbox — Infinity.Inc` → `工具箱（Infinity Toolbox）— Infinity.Inc` | `…Infinity Toolbox…` → `…工具箱…` |
| `download/infinityinstallmanager/` | `Infinity Installer Manager — Infinity.Inc` → `安装管理器（Infinity Installer Manager）— Infinity.Inc` | `…Infinity Installer Manager…` → `…安装管理器…` |
| `download/infinitygames/` | `Infinity Games — Infinity.Inc` → `游戏（Infinity Games）— Infinity.Inc` | `…Infinity Games…` → `…游戏…` |

（六款产品页 description 均为「下载 Windows 版<产品>。一个自包含的可执行文件，除 Windows 之外什么都不需要。」，句式与英文版一一对应，只替换产品名。）

### 复核后无需改动的 7 页
`cn/docs/`、`cn/login/`、`cn/login/link/`、`cn/run/`、`cn/settings/`、`cn/signup/`、`cn/versions/archive/`
——逐行扫描后，其可见文本节点、`alt`、`placeholder`、`aria-label`、`title`、表格表头均为中文；行内 `<script>` 中的英文字符串全部是 `I.t('key')` 键名 / class 名 / URL / 机器值，不是可见文案。

## 5. 验证

### 5.1 自建只读静态服务器（node http，127.0.0.1 随机端口）逐页 GET
命令：`node`（v24，`D:\program\nodejs\node.exe`）内联脚本，`http.createServer` + `fetch`，只读读取 `web/` 静态文件。
输出（节选，完整 19 行）：

```
static server: http://127.0.0.1:58875/ (read-only, random port)
PASS  200  lang=zh-CN  title="页面未找到 — Infinity.Inc"  /infinity/cn/404.html
PASS  200  lang=zh-CN  title="无限云盘（Infinity Cloud）— Infinity.Inc"  /infinity/cn/download/infinitycloud/
PASS  200  lang=zh-CN  title="包管理器（InfinityPackageManager）— Infinity.Inc"  /infinity/cn/download/infinitypackagemanager/
PASS  200  lang=zh-CN  title="Infinity.Inc — 无限套件"  /infinity/cn/index.html
...（云盘/文档/下载/文件管理器/游戏/安装管理器/工具箱/登录/关联产品/账户/令牌密钥/运行程序/设置/创建账户/版本归档 均 PASS）
pages=19  fails=0
ALL PAGES 200 + CHINESE TITLE
```

### 5.2 Lead 独立验收器
命令：`& 'D:\program\nodejs\node.exe' work\cn-lead-verify.mjs web` · 退出码 `0`

```
{ "cnPages": 19, "missingPages": [], "problems": 0 }
... 19 行均为 200 / zh-CN / leftover=0 ...
assets/download.js  en=6 zh=6
assets/archive.js   en=5 zh=5
assets/site.js      en=47 zh=47
assets/verify.js    zh 三元=1 中文字符=24
assets/token.js     zh 三元=3 中文字符=510
assets/product.js   zh 三元=0 中文字符=0
PASS 中文站完全汉化
```

### 5.3 静态残留英文扫描
对 `web/infinity/cn/**/*.html` 去除 `<script>/<style>` 后扫描可见文本节点与文案属性（`alt/placeholder/aria-label/title/content/value`）：
- 改动前：只有 6 个产品页的 `<title>` 整行无中文（NO-CJK TEXT），另有 `win64/winx86/win-arm64/true/false/dark/light` 等机器值（非可见文案）。
- 改动后：可见文本节点中出现的拉丁字符仅有 `API`、`Infinity.Inc`、`.zst`（技术/品牌词，与英文站一一对应），无英文产品名、无英文 UI 词。

## 6. 遗留与说明

1. **404 语言切换为单向**：本次新建的 `cn/404.html` 内有「English」切换链到英文 `/infinity/404.html`，但英文 `404.html` 本身没有语言切换（且属于硬约束中的「英文站页面」，本任务不可改），因此从英文 404 无法一键切回中文。若需要双向切换，需在英文 404 上补一个 `cn/404.html` 链接（不在本任务范围）。
2. **cn/404.html 的重定向语义与英文版完全一致**：`/infinity/*` 路径重定向到真实存在的 `https://zssx-2026.github.io/404`（英文根 404）。未改成 cn 目标是为了不产生「cn/404 → cn/404」死循环；首页链接才指向 cn。
3. **og 标签**：英文站与中文站全部 19+19 页均无任何 `og:*` / `twitter:*` 标签（已 grep 确认），故本次没有 og 文案可译；任务书中提到的 og 项不适用。
4. **运行时文案归 cn-runtime（task-14）**：导航、按钮、footer、表格表头、`data-t` 文本、产品卡片名称/标语、`I.t()` 键值等均由 `web/infinity/assets/*.js` 在浏览器里注入，本任务不触碰。cn 页面引用的键（如 `getInfinityCloud`、`deletedWord`、`docSuite` 等）已由 cn-runtime 在 site.js 的 `T.zh` 中补齐；验收器 B 项（en/zh 键对齐）通过。
5. **页面结构差异（预先存在，未改）**：`cn/index.html` 比英文 `index.html` 多一个「它们是怎么配合的」`<section class="stack">`（由 `data-t` 键 `howItFits/twoFaces/oneCatalogue/unverified` 等驱动）。按「保持 HTML 结构不变」的要求原样保留。
