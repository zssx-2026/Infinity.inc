# 流式预览（Streaming preview）并入正式源码树：取证审计

时间：2026-10-11（Asia/Shanghai）｜作者：Lead｜可重复执行：`node work/preview-integration-audit.mjs`

## 1. 结论

**INC 与 IFM 两条产品线的流式预览都已在其"权威源码树"内：路由已注册、UI 已调用、测试入口齐备。**
审计脚本 `PREVIEW-AUDIT-PASS`，退出码 0，JSON 见 `work/preview-integration-audit.json`。

## 2. INC（C++ 线，`cpp/apps/inc`）

| 事实 | 值 |
|---|---|
| `cpp/apps/inc/preview.hpp` | 29,658 B / `b5004e1e93dc…` / 84 个 preview 符号 |
| `cpp/apps/inc/main.cpp` 注册 `/api/preview` | 5 处 |
| `cpp/apps/inc/ui.hpp` 调用 `/api/preview` | 6 处 |
| 预览测试入口 | `Infinity Cloud/preview/tests/run-tests.ps1`（10,501 B） |

**防漂移**：同名头文件存在三份，审计要求逐字节一致 —— 现状三份全部为 29,658 B / `b5004e1e93dc…`：

    cpp/apps/inc/preview.hpp                       <- 权威源
    Infinity Cloud/preview/preview.hpp             <- 构建用副本
    Infinity Cloud/preview/generated/preview.hpp   <- 构建用副本

三份中的任意一份被单独改动，审计即失败（防止"改了权威源、构建仍用旧副本"）。

## 3. IFM（JS/SEA 线，`Infinity File Manager/sourcecode`）

| 事实 | 值 |
|---|---|
| 核心模块 | `src/core/preview.js` 12,588 B / `4ffc402dd471…` |
| 服务器接线 | `src/gui/server.js` 中出现 preview 43 处 |
| 测试/基准入口 | `bench/preview-http-check.mjs`（11,831 B）、`bench/preview-bench.mjs`（21,759 B） |

## 4. 记录在案、但不判失败的事实

- `Infinity Cloud/sourcecode`（Electron/JS-SEA 线）中 `/api/preview` 出现 **0** 次：该线的 INC 窗口由 C++ 后端提供 UI（shell 只承载窗口，见 `shell/main.js` 的端口表 7621），
  因此 INC 的预览由 C++ 线负责；此事实已记录，避免日后误判为"漏并"。
- 发布文档与站点**尚未提及**流式预览（`docs/RELEASE-v1.0pre5*.md` 命中 0，`web/**` 命中 0）——属可见性缺口，已由新增的 `docs/FEATURE-streaming-preview.md` 补齐文档侧。

## 5. 复现

    node work/preview-integration-audit.mjs
    PREVIEW-AUDIT-PASS 三份 preview.hpp 同源同哈希; INC 路由/UI 接线在; IFM 核心+服务器接线在


## 6. 站点/文档可见性补齐（2026-10-11 第 8 轮）

审计脚本新增两项**失败条件**，不再只做记录：

1. **文档中心接线**：web/infinity/docs/index.html（英文）与 web/infinity/cn/docs/index.html（中文）都必须列出
   docs/FEATURE-streaming-preview.md；现状两侧各 4 个条目：
   cpp/README.md、README.md、docs/catalogue-format.md、docs/FEATURE-streaming-preview.md；
2. **死链检测**：文档中心里每个 path: 指向的文件必须在磁盘上存在；现状 danglingDocRefs=0。

### 6.1 修掉一个真实的死链

文档中心第三条一直是 docs/catalogue-format.md，但该文件**并不存在**（站点的文档阅读器会落到"无法读取"分支）。
本轮按代码事实补写了 docs/catalogue-format.md（4,243 B / f79971c9a270…）：

- 目录 = applications 仓库，**每个 Release 一个目录页**（application-inc）；
- name.txt 六字段真实形状 &lt;资产名&gt; &lt;公司&gt; &lt;包名&gt; setup &lt;公司&gt; &lt;平台&gt;
  （例：InfinityCloud_1.0.0-pre5_win64_setup.exe Infinity.Inc InfinityCloud setup Infinity.Inc win64）；
- release-assets.json 的 tag/version/generated/assets[name,size,sha256,fnv1a,repo,url]；
- 发布前校验：清单与磁盘逐项 size/sha256 相符、name.txt 与清单互为全集、残留旧 preN 名字则**拒绝写目录**、
  InfinityCloud_v0.1_* 视为过时；
- 整套 v1.0.0-pre5 六个安装包合计 **1,920,380 字节（1.83 MiB）**（实测，非沿用注释里的旧数字）。

### 6.2 顺带修正两处过时注释（work/ghsync.mjs，仅注释、不改行为）

- 目录行字段序：&lt;asset name&gt; &lt;company&gt; &lt;package&gt; setup &lt;company&gt; &lt;platform&gt;
  （原文把第 2 字段误标为 version、把 setup 误标为 install kind）；
- 目录页体积：about 1.8 MiB（原文 870 KB 为旧构建的旧数字）。

### 6.3 站内多语言键

web/infinity/assets/site.js 增加 docPreview / docPreviewNote 双语键（现 64,483 B），
审计要求两语言各出现一次（i18nPreviewKeys=4），中英键平权由 work/cn-lead-verify.mjs 把关。

### 6.4 本轮站点回归

    node work/cn-lead-verify.mjs web   -> PASS 中文站完全汉化（76 项检查，failed 0）
    node work/cn-gitee-verify.mjs      -> checks 76, failed 0（英文内容 host 仅 github.com: 96 处）
    node work/site-seo-verify.mjs      -> PASS 38/38 页面 200、sitemap 36 条可索引 URL
    node work/site-release-consistency.mjs -> checks 34, failed 0
    node work/ghsync.mjs --dry-run     -> DRY RUN complete: 0 errors
