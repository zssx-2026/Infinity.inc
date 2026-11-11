# Infinity.Inc 任务清单（队列：先到先做，用户新需求排最后）

## 2026-11-11 v1.0pre6 收口（本轮）
- [x] 发布：三仓库真发，asset id 734976887 / 734977795 / 734978673，84,211,080 / 83,935,056 / 83,923,176 B，远端 digest 与本地 sha256 逐字符一致（e9f6fdad…80db / 721f4dcc…7b20 / b76a8444…d971），`published 3 installer(s) as v1.0.0-pre6, 0 failure(s)`。
- [x] 发行说明：`docs/RELEASE-v1.0pre6-body.md`（8,292 B，GitHub Release 正文）+ `docs/RELEASE-v1.0pre6.md`（8,355 B，仓库内副本，README 链接到它）。
- [x] IPM 目录页：`work/catalog-pre6.mjs` → FINAL assets=7 / failed=0（三 pre6 包 + 三 pre4 包 + name.txt 620 B，三 pre5 包已删）；`ipm_cli search Infinity` 6 条、`info InfinityCloud`/`info InfinityToolbox` 均指向 pre6 下载地址。
- [x] 官网：`work/_org-pages/index.html` 三卡片改 `releases/tag/v1.0.0-pre6`，commit 4756fe45e8（tree 8297fdeae7），Pages 首次 errored 后 75 s 转 built；实测 200 / 5,529 B / pre6×5、pre5×0、pre4×3。`web/infinity/assets/site.js:168` 的 RELEASE_TAG 同步 pre6。
- [x] 下载回验（公开地址，不靠本地文件）：Cloud / PackageManager / Toolbox 3/3 QA-OK，字节数与 sha256 全部一致（`work/qa-pre6-download5.ps1` + 日志 `work/qa-pre6-download5.log`）。
- [x] 界面证据：`work/qa-inc.png` 28,469 B、`work/qa-ipm.png` 32,096 B（首启令牌页）、`work/qa-int.png` 56,890 B（真实产品页），三次探针 devicePixelRatio 均 1.5。
- [x] README 更新到 pre6（289 行，双语）：三应用表补 Infinity Toolbox、pre5→pre6 全量替换、新增「实现选择」小节、发布目录默认值改 v1.0pre6。
- [x] 新增 `docs/ENGINEERING-RULES.md`（5,026 B）：语言选择（C++/Rust 默认、汇编仅测量过的热点、Python 做无速度要求的部分、Node ESM 只做构建脚本）、「页面不是回答」界面原则、自包含交付、验收标准、「重建即改字节」发布纪律。
- [x] `cpp/tools` 默认版本统一 pre6：build.mjs / package.mjs / manifest.mjs / publish.mjs / sha256sums.mjs 的默认值由 v1.0pre5/1.0.0-pre5 改 v1.0pre6/1.0.0-pre6，publish.mjs 的内联兜底发行说明改写为 pre6 三应用；五个脚本 `node --check` 全通过，`node cpp/tools/manifest.mjs` 重跑产出与发布版一致（release-assets.json sha c77182fb… 不变）。
- [x] name.txt 跨版本合并固化为 `work/nametxt-cross.mjs`：按六产品历史顺序合并、CRLF 行尾，重跑得 620 B / sha `7fca9475aa4bda6b9e71d91db41343eac7658f9296ec7fb76774b8776aefdc37`，与目录页在架文件逐字节一致——修掉「manifest.mjs 重跑会把旧版本三条目录行删掉」的隐患（本轮就发生过一次，已用 `work/restore-nametxt.mjs` 从目录页按资产 id 735001151 还原并核对 sha）。
- [x] SHA256SUMS.txt 重算（493 B，含三安装包 + name.txt + release-assets.json）。
- [ ] 源码同步：`work/ghsync-source.mjs --push`（本轮改动落定后执行，避免推途中被历史同步任务改写）。
- [x] `dist/url.json` 与 `dist/applist.json` 刷新到实况（新增 `work/dist-refresh.mjs`，只读 GitHub 目录页、不上传）：8 个 release / 33 个包 / 35 个文件，url.json 141,600 B、applist.json 29,934 B。顺带修掉旧镜像的解析错误——Infinity 目录行第二列是公司名（`Infinity.Inc`），旧解析器把它当成版本号，所以六个产品全显示 `@Infinity.Inc`；新解析器对非数字版本回退到文件名里的版本，现为 Cloud/PackageManager/Toolbox `1.0.0-pre6`、FileManager/InstallerManager/Games `1.0.0-pre4`。

## 2026-10-25 登录验证 Cloudflare Worker（本轮）
- [x] auth-worker/：worker.zh.mjs + worker.en.mjs（双版同逻辑）。人机验证服务端化：挑战 HMAC 签名（prefix|bits|expires|email），register 服务端复核 sha256(prefix+nonce) 前 32 位 < 2^(32-bits)，防重放/防调难度/绑定邮箱，可选 Turnstile；GitHub OAuth：state Cookie + code 换 token + #token fragment 回传；auth-data PR 状态机：建分支→提交 users/<email>.json（含 verifyToken）→开 PR→Actions 双语邮件→/api/verify 比对 token→squash 合并激活+分支清理。
- [x] e2e.test.mjs：mock GitHub API 端到端 22 断言×2 版全 PASS。
- [x] auth-data.workflow.yml、wrangler.toml、需求.md（双语需求书，工作区根）。
- [ ] 待办：用户按需求书部署后接线前端 login/signup。

## 2026-10-05 历史归档追加（本轮）
- [x] 会话日志压缩追加：24 个日志（主会话 + 23 个子智能体）83.84 MiB → 9.25 MiB（11.03%），归档 276,969,754 → 286,666,513 B、条目 26,354 → 26,378、块 85 → 91。
- [x] append-only 工具 work/sync-history.mjs（含排他锁）+ 状态 work/history-sync-state.json；头部新增 snapshots/appended[]。
- [x] 独立验证：追加段导出后 restore-history.ps1 还原 24/24 完全一致；全归档抽样 505/505 完全一致（0 不匹配）。
- [x] 持续同步：计划任务 InfinityInc-SyncHistory 每 15 分钟跑 work\sync-history.cmd；详见 work/history-append-report.md。
- [x] 找到 DSH 实时会话库 ~/.dsh/sessions/…/*.jsonl.zstd（多帧 zstd，需逐帧解码）；sync-history.mjs v2 起按增量分片追加实时日志：全量 21.13 MiB→2.27 MiB，增量 39,872 B→7,681 B，独立还原 5/5、2/2 完全一致。
- [x] task-1 INC 远端流式预览：prod-cloud 实现，Lead 独立跑 run-tests.ps1 -With8s 退出码 0（RESULT failures=0），报告 work/preview-inc-report.md。
- [x] task-2 IFM 本地流式预览：prod-ifm 实现，Lead 独立复跑 check-page/bundle-check/preview-http-check/preview-bench 全 0，报告 work/preview-ifm-report.md。
- ING 由另一个 Agent 负责，本线未触碰。

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
- [已完成] task-12 外壳换代（2026-11-08）：自建精简内核不成立（CEF 324.87 MiB/应用 > Electron 268.05 MiB），改采 WebView2 宿主（自身 452,114 B，系统 Evergreen 157.0.4341.42）。cpp/hosts/webview2/main.c 增 shell 模式（--show/--title/--spawn/--app/--port/--wait-ms，CreateProcessW + Job Object 关窗即杀）；package.mjs 增 INC_SHELL=webview2（载荷加 _window.exe + WebView2Loader.dll + ui/，快捷方式带 --app/--port/--show/--title）。三产品静默安装实证：665,288 / 436,840 / 452,256 B，快捷方式与载荷正确，宿主 exit 0 无残留，卸载清零。命令：INC_RELEASE=v1.0pre5 INC_SHELL=webview2 node cpp/tools/package.mjs
- [进行中] task-13 仿 Edge UI（子智能体 471c3210）
- [进行中] task-15 .itbt 容器 + Toolbox 加载（2026-11-08 更新）：packer cpp/tools/itbt/itbt-pack.cpp 编译零错（MinGW g++ -std=c++17，work/itbt-pack.exe 195,815 B）；round-trip 实证 pack→独立 Node 校验器 work/itbt-verify.mjs 19/19 PASS（魔数/小端/entry 表连续/逐条 sha256/item.json 在位）。本 MinGW 无 zlib.h（仅 zlib1.dll 无导入库）→ deflate 缓行，store 模式为准，packer 对 --deflate 有明确降级警告。Toolbox 加载侧（plugin list/install/verify + itbt_container 共享实现）由子智能体 int-toolbox-dev 进行中。坑：本会话 run_code 的 os.tmpdir() 返回相对路径 undefined\temp，临时文件一律用工作区显式路径。
- [进行中] task-11 IPM 打包 once_power/Piik（rel-catalog）
- [已完成] ghsync 修 CPP_ASSETS + 源码仓库同步（rel-publish）：git HTTPS 到 github.com 被阻断（Connection was reset / 443 超时），改走 Git Data API 推送；仓库瘦身 7900 文件/1739.5 MB → 697 文件/51,772,524 B（.gitignore 新增 never-publish 段排除 Chormium/、Python/、work/chromium-trim/、work/_retired-products/、IPM Applications/ 等）；用 git cat-file blob 取索引内容上传（磁盘字节受 CRLF 归一化影响会不一致）；最终 ref main = 3047bcda1f86，远端 tree 48b5be07… 与本地 HEAD^{tree} 完全一致，697 blobs，仓库公开、size 2435 KB、pushed_at 2026-11-08T10:40:18Z。凭据取自 Windows 凭据管理器（git credential fill），未落盘未回显。
- [完成] work/PLAN-v1.0pre5.md（下一版本计划：Chromium 外壳、图标、IPM 扩展、ITB 容器）
- [已完成] 组织主页 404 修复（2026-11-10）：Infinity-Studio-craft 原 0 仓库 → 新建 infinity-studio-craft.github.io，Git Data API 推 index.html（4,673 B），Pages 启用（source main /，build_type legacy）。首轮 build errored 系建仓即触发、内容未落地；补推后 status=built。实测 https://infinity-studio-craft.github.io/ 返回 200、4,673 B、标题「Infinity.Studio — 一套自己的工具链」。
- [已完成] v1.0pre5 三包带 WebView2 外壳重建（2026-11-10）：InfinityCloud 671,016 B / InfinityPackageManager 436,840 B / InfinityToolbox 452,256 B，三包 signed Valid；release-assets.json 与 SHA256SUMS.txt 按实际文件重算（sha256 502edbae… / ab37f574… / efd3466d…）。
- [已完成] v1.0.0-pre5 正式发布（2026-11-10）：cpp/tools/publish.mjs 真发三仓库 —— Infinity-Cloud asset 730958201、InfinityPackageManager 730958421、Infinity-Toolbox 730958668，均 prerelease=true、draft=false，远端 digest 与本地 sha256 逐字符一致；独立 QA 用公开 browser_download_url 下载回验 3/3 QA-OK（work/qa-pre5-download.ps1）。
- [已完成] 发行说明重写：docs/RELEASE-v1.0pre5-body.md 由旧六应用稿改为实际三应用稿（WebView2 外壳、图标、退出码 20、三包字节/哈希、1,560,112 B 合计），随发布上传，三仓库 Release 正文各 4,771 字符。
- [已完成] IPM 目录页刷新（work/catalog-pre5.mjs）：applications/application-inc 页上传 3 个 pre5 包、替换 name.txt（614 B，3 条 pre5 + 3 条 pre4）、删除 3 个 pre4 旧包，终态 6 包 + name.txt；name.txt 同步为 6 行跨版本清单，SHA256SUMS 重算（name.txt 38803657…）。
- [已完成] 目录端到端验证：用已发布 cpp/out/ipm/ipm_cli.exe（带 token）实测 search Infinity 列出 6 条 —— inc/ipm/int 为 1.0.0-pre5，ifm/iim/ing 为 1.0.0-pre4；info InfinityCloud / InfinityToolbox 均命中 pre5 下载地址。
- [已完成] 组织主页下载卡片改为显式 tag（work/_org-pages/index.html）：inc/ipm/int → /releases/tag/v1.0.0-pre5，ifm/iim/ing → /releases/tag/v1.0.0-pre4；重发 commit b40cc0fe02，Pages status=built，实测 200、4,789 字符、含 4 处 pre5 与 3 处 pre4 链接。
- [待办] dist/url.json 与 dist/applist.json 仍是 2026-10-06 快照（Node IPM 旧产品线的目录镜像），本次未改；C++ IPM 直读 GitHub 目录页，不受影响。

## 新增（2026-10-25 晚：官网根化 + 下载门禁 + 备份）
- [已完成] 官网 URL 根化：16 目录退役（.retired- 同盘改名），保留 10 页（/ cn/ download/ download/infinitycloud/ download/infinitypackagemanager/ cloud/ 双语），sitemap 10 URL + robots 重建，404 智能剥 /infinity 前缀。
- [已完成] 站点脚本适配全绿：site-seo-apply（12 页/10 URL）、site-seo-verify（PASS 12/12，服务器改从 web/infinity 伺服）、site-release-consistency（26 checks 0 fail，退役产品豁免比较）、verify-contract 自测 25 pass。
- [已完成] worker v2 下载门禁三端点 /api/gate、/api/gate/verify、/api/dl（scope 绑定 PoW 签名 + g1 短票据 HMAC + DL_MAP 直链 302），worker.zh/en 同步，e2e 29×2 全绿。
- [已完成] download.js 门禁客户端：仅 GitHub setup 直链走 PoW 挑战→票据→/api/dl，worker 不可达自动回退直下；msi/zip/源码与 Gitee 镜像直下。
- [已完成] 工作区最小化：infinity-ops.mjs clean --apply（temp 全部 + work/archive → .retired- 改名保恢复）。
- [进行中] 实时备份：infinity-ops.mjs backup --watch → github backup 仓库 Releases（tag workspace-backup，首轮 4809 文件/3.15 GB，大文件>64MB 与 .retired- 路径自动跳过）。

## 新增（2026-11-01 晚：Infinity Studio 全家桶改造）
- [已完成] InfinityStudio 模块层：suite.js（8 分支/38 组件/39 codecs/版本语义）、hosts.js（15 宿主探测）、project.js（ISCP 容器 v2，.is-ccp/.is-ccpx）、workspace.js（.is-ws）、associate.js（HKCU 文件关联计划）。
- [已完成] InfinityStudio/src/page.js：四视图单页（组件树/工作区/项目/设置），51 语言、零外链、内联 CSS+JS，实测渲染 54,877 字符、script 编译通过。
- [已完成] InfinityStudio/src/server.js hub 接线（27,130 → 32,812 B）：新增 /v1/suite、/v1/suite/install、/v1/suite/remove、/v1/hosts、/v1/project/create|open、/v1/workspace/create|load、/v1/associate；页面路由改 renderPage。
- [已完成] 测试：work/suite-hub-test.mjs 41/41 PASS、work/infinitystudio-test.mjs 56/56 PASS、work/project-smoke.mjs 113/113 PASS。
- [已完成] InfinityStudio/src/apps/CONTRACT.md：子产品模块契约（META/capabilities/plan/run，零依赖，冒烟脚本命名规范）。
- [进行中] 子产品模块（每个子产品一个子智能体）：codecraft / videocraft / picturecraft / 3dcraft / aicraft（task-5..task-9）。
- [已完成] apps/*.js 接入 server.js 与 page.js（2026-11-08）：套件树 craft.* 组件渲染「进入」按钮（未安装模块显示「未接入」），点击切到子产品视图并自动展开 capabilities 详情；page.js 新增 appForComponent/state.appOk/state.pendingApp。验收：suite-hub-test 45/45（新增 4 断言：入口接线、注册表服务、craft↔组件双射）、infinitystudio-test 56/56、project-smoke 113/113、渲染内联脚本编译通过（50,287 字符）。
- [待办] work/TASKS.md 之外的其余子产品：webviewer / office / packages / integrations / server 本体模块。
- [阻塞] 组织迁移：zssx-2026 非 Infinity 组织成员，POST /orgs/Infinity/repos 403，需用户授权。
