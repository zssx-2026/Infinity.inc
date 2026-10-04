# Infinity.Inc 夜间自主工作日志

目标（goal-aa1ae751）：在用户睡觉期间推进 v1.0pre4 六应用发布流水线 + 官网修复 + 归档验证 + 文档。

## 状态基线（2026-10-03 21:0x）
- 历史归档：history/history.jsonl = 264.14 MB（26354 entry / 85 chunk，原 1386.5 MB = 19.05%），全量还原 26354/26354 逐字节一致，原件已删（26355 文件 + 4769 空目录），sha256 8dd00da5…9ebb96。
- C++ 构建：cpp/build/*.exe 于 21:00:17 重新编译；cpp/out 下 6 应用 × (cli/gui/launcher) 均已就位（inc 1456128 B、ifm 514560 B、ipm/iim/int/ing 见 cpp/out）。
- 打包：cpp/tools/package.mjs 默认已是 INC_RELEASE=v1.0pre4 / INC_VERSION=1.0.0-pre4，APPS 六个；cpp/release/ 目前只有 v1.0pre3。
- 发布：cpp/tools/publish.mjs 仍写死 v1.0pre3 / tag v1.0.0-pre3 且只有 4 个仓库。
- 令牌：进程环境为空，用户注册表 `[Environment]::GetEnvironmentVariable("EV_GH_TOKEN","User")` 长度 93（可用于发布脚本，禁止打印）。
- 网站：proj-web 正在改 site.js/site.css（20:57），待落地下载卡片、语言切换（BASE 绝对 URL 根因）、404→zssx-2026.github.io/404。

## 今夜任务清单
1. [进行中] rel-cpp-build 产出 cpp/release/v1.0pre4/（6 个安装包 + name.txt + release-assets.json）
2. [待办] publish.mjs 参数化到 v1.0pre4 + 6 仓库，dry-run 后发布
3. [待办] applications/application-inc 目录刷新 + dist/*.json
4. [进行中] 官网三项修复并发布站点
5. [进行中] 归档独立验证（hist-verifier / hist-restorer 报告）
6. [待办] README + v1.0pre4 发布说明
7. [待办] 独立 QA：安装包与源码一致性校验

## 21:1x 进展
- rel-cpp-build 完成 task-6：cpp/release/v1.0pre4/ 6 个 NSIS 安装包 + name.txt + release-assets.json；7z 校验 Type=Nsis，30 个载荷导入表仅系统 DLL，--version=1.0.0-pre4。报告 work/rel-cpp-report.md。
- 安装包：Cloud 477846 / FileManager 235017 / PackageManager 278021 / InstallerManager 302978 / Toolbox 262473 / Games 262882 B。
- 发现并创建缺失仓库：zssx-2026/Infinity-Toolbox、zssx-2026/Infinity-Games（public，auto_init，default=main）——此前 404，v1.0pre4 六应用发布缺两个落点。
- 线上站点是旧的（最后提交 2026-10-03T00:30Z “publish the site (35 files)”）：/infinity/settings/ 200 但 /infinity/cn/settings/ 404、/404 404。本地 web/404.html 已存在；需重新发布站点才能修好 cn 页面。
- 令牌：发布脚本必须用 [Environment]::GetEnvironmentVariable("EV_GH_TOKEN","User") 自取（$env 里为空）；注意本机 pwsh 是 5.1，Set-Content -Encoding utf8 会写 BOM，JSON 请求体要用 Node 写文件或 [IO.File]::WriteAllText。
## 2026-10-04 18:04 — 界面可见改动落地（Lead）
- 站点连发 5 次：58b9accabc4c（verify 门上线）、37e22e0c511f（下载页版本列表）、245328ea8c21（总览卡片改指产品下载页）、142db658afd9（兼容旧命名资产）、e0f79f3f769a（静态 releases.json 优先）。
- 新增 web/infinity/assets/download.{js,css}、releases.json（49,261 B / 199 资产）；product.js 挂载版本列表，site.js 的 productHref 在 /download/ 下改为产品自身下载页。
- 验证：线段单测渲染（work/dl-render-test.mjs）证明折叠/展开、平台切换、类型分组、中英文；线上 headless 截图 v2-collapsed.png 55,143 B ≠ v2-expanded.png 73,649 B（展开生效）；releases.json 与 download.js 线上 200。
- 此前 headless 截图不变化的原因：浏览器直连 api.github.com 失败 → 落到降级卡片；改为同源静态 releases.json 后解决。
- IPM：once-power 与 piik 两页上线（zip + name.txt，回下载 sha256 = API digest），dist 28 包 / 5 releases。task-11、task-17 完成。

## 2026-10-04 19:10 — 去弹窗/加载条/归档/WebView2 决策（Lead）
- 站点：guard.js 全屏遮罩删除（32 页元凶）、token.js window.confirm 改二次点击（proj-web 又修了我一处优先级 bug）、error 两路由从仓库删除（61151f89/e630caae，线上 404）、verify.js 失败强制跳 /404、apply-verify.mjs 给 35 个页面注入门（404 除外）。
- 加载条：verify.css/js 改为顶部 3px 加载条 + 空白页（无中间转圈），深色纯黑/浅色纯白。
- 下载：五类分类（exe 安装包/Windows msi/便携版 zip/源代码 zip/源代码 zst）、平台简称可切换（Win16/32/64/X86、WinARM、Linux*、Mac*）、一年内窗口（UTC）+ /versions/archive 中英、删除 SHA-256/校验脚本/Release 链接（commit 后 download.js 12878 B）。
- token 页上线：task-18 complete，publish 19e39a9be000（60 blobs），六张线上截图 + 流程断言（打码→重生成→二次点击删除）。
- 自解锁：task-26 → rel-cpp-build（启动早期与安装流程删 Zone.Identifier，共用实现）。
- 内核：CEF 裁剪结论（324.87 MiB > Electron 268.05 MiB）→ task-27 改用系统 WebView2（154.0.4258.53）做 0 字节内核宿主，复用 work/edge-ui 外壳 → kernel-trim。
- Chromium 141 官方源码解包完成：D:\dev\Chormium\src141，547,644 文件 / 11.09 GB。
- 性能：prod-cloud 定位到 guiMain 建窗前同步 2 次 GitHub HTTP、无 token 直接 exit 1（真实缺陷）。

## 2026-10-04 19:35 — 清理 + 每应用一份 Chromium（Lead）
- 工作区清理：删 20 个 Edge headless profile(292.8 MB)、CEF 未压缩 tar(443 MB)、Piik-stage(104.4 MB)、杂项 → 释放 398.1 MB，D: 59.1 GB。
- task-29 → edge-ui：Chormium/<inc|ifm|ipm|iim|int|ing> 六份独立 Chromium 副本（源 work/chromium-trim/out/*，ipm/ing 现裁），各带 app.json/prefs.json/patches（git apply --check 证据）+ 逐份启动验证。
- token：默认明文可反复复制、仅限 INC、只显示本浏览器创建的密钥；publish 6461ba932ca2；复验 task-28/proj-web。
- 冲突处理：rel-cpp-build 已冻结 cpp/apps/**（六应用 unblockSelf 已插入，sha256 已回报），prod-ipm 重读后再改 ipm/main.cpp。
- 内部跳转：verify.js 增加 infinity-nav 模式——只显示顶部加载条，UI 不消失（publish 47c7041adbaf）。

## 2026-10-04 19:50 — 流式预览 + 源码同步（Lead）
- task-32/prod-cloud：INC 远端 Range 流式预览；task-33/prod-ifm：本地随机读流式预览（统一契约 256 KiB/首屏 ≤800 ms/关闭即取消/内存 ≤64 MiB）。
- task-34/rel-publish：用 Git Data API 同步工作树快照到源码仓库（git push 在本机会 malloc failed）。
- task-26 完成：六应用自解锁（BEFORE 1/1 → AFTER 0/0），NSIS 核心 Delete 删不掉 ADS → 改 System::Call kernel32::DeleteFileW。
- task-10 完成：README + docs/RELEASE-v1.0pre4.md（资产合计 1,819,217 B）。
- rel-cpp-build 冻结 cpp/apps/**；prod-int/prod-ipm 获准独占各自 main.cpp；task-31 待触发统一重建。
