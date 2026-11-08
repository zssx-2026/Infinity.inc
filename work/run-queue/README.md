# 运行禁令与运行队列（Lead 2026-10-04 20:35 生效）

## 背景：桌面刷屏（第二次）
- 20:31 全机扫描：chrome 222 个、msedge 24 个、msedgewebview2 6 个。
- 222 个 chrome 为团队测试浏览器残留（已全部 taskkill /T /F）。
- 可见窗口主责：kernel-trim 的 CEF 冷启动基准（自认 IsWindowVisible 采样到 4 次可见窗口，SW_HIDE 对 CEF 宿主无效）。
- 保留不动：explorer.exe / SearchHost.exe 及其派生的 msedgewebview2（Windows 自带组件，杀了会重生），以及用户自己的 Edge 会话。

## 硬规则（对全体成员，未书面解除前一律有效）
1. 禁止启动任何 .exe / .msi / 浏览器 / WebView2 / CEF / Electron / 宿主进程 / 服务，含 `--version`、`_cli`、`--serve-ui`、headless 截图、smoke、安装包测试；编译（cmake/ninja/g++/makensis/objdump）同样禁止。
2. 允许：读文件、写文件、`node <脚本>.mjs`（纯计算/生成文本，不得 spawn 外部可执行文件）、`git` 只读、`curl` 只读 GET。
3. 违反一次：该成员本次交付作废，改动回滚，任务重开。
4. 需要运行证据时：写 `work/run-queue/<成员>-<任务>.md`（模板见下），然后**等待**，不要执行。Lead 会集中在一个时间窗统一执行并回收证据。

## 运行申请模板（写入 work/run-queue/ 后通知 Lead）
- 任务号 / 成员：
- 要跑什么（完整命令，逐条）：
- 为什么必须运行（静态产出无法替代的点）：
- 窗口隐藏方式：
- 跑完怎么杀 + 残留核对方式：
- 期望产出（文件名 + 判定标准）：
- 预计耗时 / 是否会联网：

## 已收到的申请（待 Lead 集中执行，截至 20:35）
| 成员 | 任务 | 申请内容 | 处置 |
| --- | --- | --- | --- |
| prod-iim | task-22 | runner.exe 冷启动 5 次 / harness_after real+plan / load（GitHub 匿名配额已耗尽，需等 reset） | 待批：仅 (1)(2)；(3) 等配额重置 |
| prod-int | task-23 | ninja 构建 _bench/build-perf + node ab.mjs（--version/list/plugin）| 待批 |
| prod-ing | task-24 | ninja 构建 ing + ing --version/list + perf/bench.ps1 | 待批 |
| prod-cloud | task-19/32 | probe.ps1（inc* 进程探测） | 待批，优先只做静态 |
| prod-ipm | task-21 | 无需新跑（ipm.exe 已构建，658,944 B） | 否 |
| proj-web | task-30 | Edge headless 一次（断网 + 2FA 截图，CDP 注入） | 待批：仅 --headless=new + 独立 user-data-dir |
| kernel-trim | task-27 | kernel-host(CEF) 5 次 / Electron 5 次 / WebView2 降级 2 条 | 待批：CEF 必须先打补丁去掉 ShowWindow；降级 2 条可批 |
| rel-cpp-build | task-31 | cmake/ninja/objdump/makensis 重建 v1.0pre5 | 待批，排在源码冻结后 |
| rel-publish | task-25/34 | make-tar.mjs + zstd.mjs + curl 上传 assets | 待批：node 脚本可放行，curl 上传单独报 |
| rel-publish | task-34 | 源码快照已 push（HEAD 3af6dd45，118 文件，12/12 blob 校验一致） | 已完成 |

## Lead 集中执行窗口
统一在用户不在使用电脑时执行；执行前后各做一次全量进程快照，逐条 taskkill /T /F，核对 0 残留。
任何一次执行若探针发现可见窗口，立即 Kill 该批次并永久取消该类运行。