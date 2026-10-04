# Infinity.Inc 任务清单（队列：先到先做，用户新需求排最后）

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
- [进行中] task-12 精简 Chromium 内核（子智能体 61bc9dfb）
- [进行中] task-13 仿 Edge UI（子智能体 471c3210）
- [进行中] task-15 .itbt 容器 + Toolbox 加载（子智能体 467651cd；契约 work/ITBT-FORMAT.md）
- [进行中] task-11 IPM 打包 once_power/Piik（rel-catalog）
- [进行中] ghsync 修 CPP_ASSETS + 源码仓库同步（rel-publish）
- [完成] work/PLAN-v1.0pre5.md（下一版本计划：Chromium 外壳、图标、IPM 扩展、ITB 容器）
