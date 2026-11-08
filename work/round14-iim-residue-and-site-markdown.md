# 第 14 轮：流式预览文档中文化与官网 IIM 残迹清除

## 1. 站点 markdown 渲染器两个真实缺陷（已修 + 已有测试锁死）

`web/infinity/assets/site.js` 的 `markdown()` 有两个缺陷，都会让 `/docs/` 页面显示错乱内容：

1. **四空格缩进代码块被吞掉**：缩进行不匹配 fence/table/heading/blockquote/hr/bullet/有序列表任一条规则，
   于是落到段落分支，块内所有换行被 `join(' ')` 合成一行，缩进原样渲染成段落文字。
   `docs/FEATURE-streaming-preview.md`（原中文版）与 `docs/catalogue-format.md` 的示例块都中招，
   连站点自称的 `name.txt` 格式示例也是糊的。
2. **折行的列表项被截成两个元素**：bullet 之后若下一行不是新 bullet，`closeList()` 先关闭列表，
   续行变成独立 `<p>`。`cpp/README.md` 里有 15 处这样的折行 bullet，全都在线上表现为断行。

**修复**（site.js，65,693 B，sha256:5dd49b4abbd2fb9b）：
- 在段落分支前插入四空格缩进代码块分支：连续缩进行收集为一个块，相邻空行一并吃入，
  末梢空行去掉，输出 `<pre><code>`；
- bullet 处理改为「读入列表项后，继续吞掉缩进到该块内容列（≥2 空格）且不是新块起点、不是新 bullet 的行」，
  折行续文因此留在同一个 `<li>` 里；
- 段落分支的续行条件加上 `| {4}\S`，让代码块不会在段中被截。

**证据**（`work/md-render-test.mjs`，4,818 B，sha256:d847405da6fe83e6）：
把渲染器三个纯函数从 site.js 里 carve 出来，对 fixture 与站点实际渲染的 5 份文档逐份断言。
为证明测试有效，把 site.js 的 `markdown()` 回退到旧版再跑：**FAIL 9 项**（fixture 5 项 + 4 份文档的
「段落以代码缩进开头」），恢复修复后 **MD-RENDER-TEST pass=41 fail=0**。

测试自身还暴露了一个会让它失去牙齿的 bug：`count()` 助手用非全局正则，`String.match` 只返回首个匹配，
任何计数断言恒为 1——已改为强制补 `g` 标志。

## 2. 流式预览特性文档补齐英文正文

`docs/FEATURE-streaming-preview.md` 原为中文独篇（387 汉字、无英文正文），而它被站点 `/docs/`（英文）
与 `/cn/docs/`（中文）两侧同时引用——英文读者看到的是中文。

改为项目既有约定（英文正文在前、`---` 之后中文摘要），5,017 B，sha256:1bc32921a2a85331。
全部数字沿用 `work/preview-integration-audit.mjs` 的产出口径：
`preview.hpp` 29,658 B / `b5004e1e93dc…`、`src/core/preview.js` 12,588 B / `4ffc402dd471…`、
`main.cpp` 注册路由 5 处、`ui.hpp` 调用 6 处、INC 13 项检查含 8 秒压测、IFM 首屏 256 KiB / 5,400 条列表 / abort 60 次。

`cpp/README.md`（cn/docs 的「套件总览」条目）此前 0 汉字，中文读者读到的是英文总览。
已按同一约定补中文摘要（22,441 B，754 汉字，sha256:60081655a7dbbc92），
摘要内容逐条对齐源码事实：五产品、26 个名字（inc/ifm/ipm 各 6，int/ing 各 4；6 = cli/gui/launcher 三面孔 × 基础/管理两个名字，4 = cli/gui × 两个）、
端口 7621/7623/7632/7653/7664、IPM 目录字段与 `name.txt` 六字段、
下载落地 `%LOCALAPPDATA%\InfinityPackageManager\downloads\`、`sha256:` 71 字符摘要规则、构建四命令。

## 3. 官网与文档里遗漏的 IIM 拼写引用（前几轮只 grep 了 `iim`，漏了全称）

前几轮 IIM 删除用 `/\biim\b/` 扫描，全称拼写「Infinity Installer Manager」不在该模式内，
因此源码、构建链、官网三处残迹整轮漏掉。本轮全部清除：

- **`cpp/apps/int/main.cpp`**（80,808 B，sha256:7672c6955daff76a）：3 处注释声称
  「Infinity Installer Manager 把插件装到这里 / 它用 item.json 记录布局 / 它就那样写一个插件目录」。
  经核实这是错的：全树（`iim` 源已退役）再没有 `item.json` 的**写者**；
  `item.json` 是插件自带的清单，由插件作者或 `cpp/tools/itbt/itbt-pack.cpp` 生成（见 `work/ITBT-FORMAT.md` 规则 2）。
  已按事实重写三处注释，并称「本程序自己的安装根」，不再引用已删除的产品。
  改动仅注释，`g++ -fsyntax-only -I cpp/core/include -I cpp/common` **rc=0** 零输出。
- **`cpp/core/include/inc/mode.hpp`**、**`cpp/tools/build.mjs`**、**`cpp/tools/package.mjs`**：
  三处「没有 launcher 面孔的产品」名单中去掉 IIM，只剩 Infinity Toolbox 与 Infinity Games（与源码事实一致）。
- **`cpp/tools/publish.mjs`**：删除 `REPOS` 里的 `InfinityInstallerManager` 仓库映射；
  `FALLBACK_BODY` 由「六个应用 / 六个纯 C++ 应用」改为「五个应用 / 五个纯 C++ 应用」并去掉 IIM。
  `node --check` rc=0。
- **`docs/RELEASE-v1.0pre5.md`**（15,601 B，sha256:0bdb68792f94b57b）：标题「六个应用」→「五个应用」；
  名字合计 30 → 26；删去两行 IIM 资产行（源代码 zip / zst）；`package.mjs` 产包数 6 → 5。
  该文档此前已把载荷一致性写成「5 应用 25 个可执行文件」，本轮修完后内部一致。

## 4. 官网 IIM 产品页与描述清除

- 删除 `/download/infinityinstallmanager/` 与 `/cn/download/infinityinstallmanager/` 两个孤立页面
  （全站无任何链接指向它们；`I.cards()` 渲染的 `PRODUCTS` 早已只含 inc/ifm/ipm/int/ing/isv 六项，无 IIM）。
- 5 个 HTML 页面的 `description` / `og:description` / `twitter:description` 由列举 IIM 改为列举 Infinity Server，
  与 `PRODUCTS` 实际六项对齐；`web/index.html`、`web/infinity/index.html`、
  `download/index.html` 与两份中文对应页全部覆盖。
- `site.js` 文案：`oneCatalogueText` / `wantEverythingText` 的中英两份把「Infinity Installer Manager 是统一入口」
  改为「InfinityPackageManager 是统一入口」，链接同步改为 `./download/infinitypackagemanager/`（该页真实存在）。
- 删除已孤立的 `assets/icons/iim.svg`（1,045 B）。
- `work/site-seo-apply.mjs` 与 `work/site-seo-verify.mjs` 的页数/对数断言随真实页面数更新
  （web/infinity 36 个 HTML、17 组中英配对、sitemap 34 条 URL），并重跑 apply 重新生成 sitemap（14,449 B）。

**复验**：site-seo-verify **PASS 36/36 页面 200、sitemap 34 条**；cn-lead-verify **中文站完全汉化**；
cn-gitee-verify **76 检 0 失败**（zh 内容主机 181 条全 gitee.com、en 92 条全 github.com，守规无跨源）；
site-release-consistency **32 检 0 失败**；md-render-test **41/41**。


### 本轮产物（字节数 + sha256 前 16 位）

| 文件 | 字节 | sha256 |
| --- | ---: | --- |
| `web/infinity/assets/site.js` | 65,693 | `5dd49b4abbd2fb9b` |
| `work/md-render-test.mjs` | 4,818 | `d847405da6fe83e6` |
| `docs/FEATURE-streaming-preview.md` | 5,017 | `1bc32921a2a85331` |
| `cpp/README.md` | 22,441 | `60081655a7dbbc92` |
| `cpp/apps/int/main.cpp` | 80,808 | `7672c6955daff76a` |
| `docs/RELEASE-v1.0pre5.md` | 15,601 | `0bdb68792f94b57b` |
| `web/infinity/sitemap.xml` | 14,449 | `cf84d98bc1aa0140` |

## 5. 有意保留的 IIM 痕迹（非构建链）

- `docs/RELEASE-v1.0pre4.md`：pre4 的历史发布说明，pre4 确实发布过 IIM，历史文件不改写。
- CMake 构建缓存（`cpp/build/`、`cpp/apps/int/_bench/build-*/`、`Infinity Cloud/tools/perf/_build/`）
  里的 `iim.dir`：生成物，CMakeLists 已改为 `set(INC_APPS inc ifm ipm int ing)`，下次构建自然消失，
  本轮不做大规模 rm（宿主内存低且有游戏在跑）。
- `work/_retired-iim`（276 文件 / 48,405,294 B）：IIM 源码的 rename 退役目录，可还原，未真删。

## 6. 本轮终验

宿主实测 `FreePhysicalMemory ≈ 0.35 GiB`，且 blender（0.53 GB）、java（1.44 GB）、DSH Desktop（0.53 GB）在跑，
按准则「内存 < 2 GB 只做静态/只读/合成检查」，本轮**不跑**重量级终验（`inc-preview` 一项即需常驻服务逾两分钟）。
实际跑通的均为轻量项：

| 项 | 工具 | 结果 |
| --- | --- | --- |
| markdown 渲染器 | `work/md-render-test.mjs` | MD-RENDER-TEST pass=41 fail=0 |
| 中文站汉化 | `work/cn-lead-verify.mjs` | PASS 中文站完全汉化 |
| 中文站内容源守规 | `work/cn-gitee-verify.mjs` | checks: 76, failed: 0（zh 181 条全 gitee.com、en 92 条全 github.com） |
| 发布物一致性 | `work/site-release-consistency.mjs` | checks: 32, failed: 0 |
| shell 命名契约 | `shell/verify-contract.mjs` | SELFTEST PASS pass=45 fail=0 |
| Studio 目录/客户端 | `work/infinitystudio-test.mjs` | INFINITYSTUDIO-TEST-PASS 48/48 |
| 站点 SEO/配对 | `work/site-seo-verify.mjs` | PASS 36/36 页面 200、sitemap 34 条 URL |

`node --check` 对 `cpp/tools/{build,package,publish}.mjs` 与 `work/final-acceptance.mjs` 均 rc=0；
`g++ -std=c++17 -fsyntax-only` 对改动的 `cpp/apps/int/main.cpp` rc=0 零输出（改动仅注释）。

**重量级终验（`work/final-acceptance.mjs`）推迟到宿主空闲**：该项含 `inc-preview`（约 90–300 秒常驻服务）
与 `archive-selfcheck`（约 30 秒），在 0.35 GiB 空闲下跑会把 blender/java 挤爆，属明确的宿主敏感场景。
推迟已写入报告而非静默跳过。

## 7. 仍未收口的事项

- 发布仍缺 `EV_GH_TOKEN` + `work/_publish-approval.txt`。
- 5 平台 runtime 主副本未恢复（win-ia32/win-arm64/linux-x64/linux-arm64/darwin-x64）。
- `docs/catalogue-format.md` 已有中文摘要但偏简（160 汉字），测试里以 `NEEDS_CN` 显式记账。
- `PRODUCTS` 含 Infinity Server 但 `/download/infinityserver/` 页不存在、`icons/isv.svg` 缺失，
  下载页该卡片会指向 404——本轮发现但未扩大范围，记入下一轮。
