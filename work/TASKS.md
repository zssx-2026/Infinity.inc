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
10. [进行中] Chromium 内核应用的功能要求（已转给 task-13 的 UI 子智能体 471c3210）：① 与 Edge 相似的 UI；② 标签页带（切换/新建/关闭的）动画效果。
9. [进行中] 从 gitee 克隆 Chromium 源代码（令牌在环境变量 gitee_zssx-1，禁止打印）；目的：为第 7 项（精简内核/自建裁剪）准备源码树。落点 D:\dev\chromium-src（不放进本仓库）。
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
