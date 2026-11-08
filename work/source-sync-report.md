# task-34 源码仓库快照同步报告（Git Data API）

- 任务：把当前工作树快照同步到 `zssx-2026/Infinity.inc`
- 执行者：rel-publish
- 执行时间：2026-10-04T12:14:26Z（提交时间戳）/ committer date 2026-10-04T12:16:57Z
- 传输方式：**GitHub Git Data API**（`blobs` → `trees`(base_tree) → `commits` → `PATCH refs/heads/main`）
- **未使用 `git push`**（本机 git 传输会 `Out of memory, malloc failed`，曾尝试分配 1.9 GB）
- 脚本：[work/ghsync-source.mjs](ghsync-source.mjs)（`--plan` 只读 / `--push` 写入）

## 1. 结果

| 项目 | 值 |
| --- | --- |
| 旧 HEAD | `2b2a3d4c02f91d6a72ce166f98516b47dbd5d70b` |
| 旧 tree | `eccd00033ed812b8a1a99347e11069d89895ae2b`（258 个 blob） |
| **新 HEAD** | **`3af6dd45672c5f853c35abd65557342c1347c00b`** |
| 新 tree | `a795bdfe53f89e1d968b6e91bf218519a31439e8`（323 个 blob） |
| commit 标题 | `worktree snapshot 2026-10-04T12:14:26Z [1/1] 118 file(s)` |
| 父提交 | `2b2a3d4c02f9`（单亲，未改写历史、未 force-push 其他分支） |
| 远端 tree `truncated` | false |

## 2. 分批情况（每批 ≤300 文件）

| 批次 | 文件数 | commit | tree | 父 |
| --- | ---: | --- | --- | --- |
| 1/1 | 118 | `3af6dd45672c5f853c35abd65557342c1347c00b` | `a795bdfe53f89e1d968b6e91bf218519a31439e8` | `2b2a3d4c02f9` |

变更 118 个文件未达 300 的上限，因此实际只需 1 批；脚本按 300 切批，超出时会顺序提交并在每批更新 ref（每批产生独立 commit，报告追加对应 sha）。

## 3. 本次同步的实质内容（118 个变更文件中的关键项）

- `README.md`（15 项索引的中英双语版）、`docs/RELEASE-v1.0pre4.md`（v1.0pre4 发行说明）
- `cpp/common/unblock.cpp`、`cpp/common/unblock.hpp`（自解锁实现）
- 六个应用的 `main.cpp`：`cpp/apps/{inc,ifm,ipm,iim,int,ing}/main.cpp`
- `cpp/CMakeLists.txt`、`cpp/tools/build.mjs`、`cpp/tools/package.mjs`、`cpp/apps/*/perf*`
- `.itbt` 实现修正相关：`cpp/apps/int/main.cpp`、`work/ITBT-FORMAT.md`、`work/itbt-report.md`
- `web/` 站点页与资源、`Infinity Cloud/`、`Infinity File Manager/`、`InfinityPackageManager/` 遗留源码
- `work/` 各报告与脚本（含本任务脚本 [work/ghsync-source.mjs](ghsync-source.mjs)）

未变更（远端已一致）170 个文件通过 `base_tree` 继承，不上传 blob。

## 4. 快照口径与排除

快照集 = git 可见文件（`git ls-files` ∪ `ls-files --others --exclude-standard`），再减去构建产物、scratch/private 前缀、会话转录与超过 8 MiB 的文件。推送时：**快照 288 个文件 / 3,158,025 字节（3.0 MiB）**，排除 5,244 个路径；收尾对账时为 289 文件 / 3,231,797 字节、排除 5,267 个路径（工作树是活的，缓存目录仍在增长）。下表为推送前 `--plan` 的逐规则明细（规则与推送时一致，仅总数随后续活动变化）。

| 排除规则 | 命中数 | 说明 |
| --- | ---: | --- |
| `artifact:_bench` | 2092 | `cpp/apps/int/_bench/` 生成的测试夹具与二进制 |
| `scratch:work/_account-shots/` | 999 | 浏览器 profile 抓取缓存 |
| `scratch:work/chromium-trim/` | 993 | Chromium/CEF 裁剪树（含数百 MiB tar） |
| `scratch:work/restore-sample/` | 339 | 私有会话转录（含 72 MB+ session.v4.jsonl） |
| `artifact:bench` | 236 | `cpp/apps/iim/bench/`（含 **256 MiB 的 tmp/sha.bin**） |
| `scratch:Chormium/` | 105 | 浏览器运行时（resources.pak 等） |
| `scratch:IPM Applications/` | 65 | 185 MB Flutter 打包物 |
| `scratch:work/webview2/` | 45 | WebView2 SDK 缓存（.nupkg） |
| `scratch:work/edge-ui/` | 32 | 截图 |
| `scratch:work/_token-shots/` | 31 | 截图 |
| `artifact:_build` | 26 | CMake 构建目录 |
| `scratch:work/archive/` | 19 | 旧发布归档（.zst，30 MB+） |
| `scratch:work/_dl-shots/` | 16 | 截图 |
| `scratch:work/_verify-shots/` | 14 | 截图 |
| `scratch:work/itbt/` | 12 | 打包测试产物（.itbt / .exe） |
| `scratch:work/_ipm2/` | 10 | 中间产物 |
| `scratch:work/_ghstate/` | 7 | 中间状态 |
| `scratch:work/_pubtmp/` | 6 | 临时目录 |
| `artifact:tmp` | 2 | 临时文件 |
| `scratch:work/screenshots/` | 2 | 截图 |
| 其他（ITB Tools、2 个 ghsync 清单文件、workitbt_sandbox、session 转录） | 5 | 见脚本 `PREFIX_SKIP` / `FILE_SKIP` |

必须排除的硬理由：三个遗留目录 `Infinity Cloud/`、`Infinity File Manager/`、`InfinityPackageManager/` 的 `build/setup-stage`、`build/out` 合计约 **21 GiB**；`cpp/apps/iim/bench/tmp/sha.bin` 单文件 **256 MiB**，GitHub 单文件上限 100 MB，必然被拒；全量未过滤为 5,041 个文件 / 432 MB。

**推送前密钥扫描**：对快照内文件匹配 `ghp_*`、`github_pat_*`、`sk-*`、`AKIA*`、私钥头、`EV_GH_TOKEN=<值>`，4 处模式命中（`InfinityPackageManager/InfinityPackageManager/bundle.js` 的 `ghp_xxxx…` 占位符、`measure-ipm.ps1` 与两份 work 报告中的环境变量名）。逐一用真实令牌值做子串比对，结果 `contains_real_token=False`（4/4），确认不含真实令牌。

## 5. 核验（同步后，独立重算）

远端 `git/trees/a795bdfe…?recursive=1` 共 **323 个 blob**（258 旧 + 65 新增路径）。对下列关键路径，用本地文件独立计算 git blob sha（`sha1("blob <len>\0" + 内容)`）与远端 tree 比对：

| 路径 | blob sha | 一致 |
| --- | --- | --- |
| `README.md` | `17a1b7c126b56cfdf983d0b1f3675d0394d84560` | ✅ |
| `docs/RELEASE-v1.0pre4.md` | `387a3b3b0bdcb12b818bfda6996b6cd8c641a806` | ✅ |
| `cpp/common/unblock.cpp` | `5f55fcd5c0e81f98ec9b391e26b287c2d99f47d2` | ✅ |
| `cpp/common/unblock.hpp` | `0ba75568a87d37c16afe3bd44774f24be0ee479b` | ✅ |
| `cpp/apps/inc/main.cpp` | `9801e63029ad6776e781eb1ea45a34f16e5e4af0` | ✅ |
| `cpp/apps/ifm/main.cpp` | `e8cc2cb3a13623f05bf9c3b971afc87db7c7f4cd` | ✅ |
| `cpp/apps/ipm/main.cpp` | `17deb212d78a85e003c5da244e8dd46dfa828bb3` | ✅ |
| `cpp/apps/iim/main.cpp` | `99995efaae7460a2bece960a4e33c5d2e7fb9d78` | ✅ |
| `cpp/apps/int/main.cpp` | `3ac5b54c227af74b20116df59c5389d4de19ad5b` | ✅ |
| `cpp/apps/ing/main.cpp` | `0d157a05daba2465eb6368dc8838edf6d13ac945` | ✅ |
| `work/ITBT-FORMAT.md` | `9eaf6f54305d5df16f353a0800cee4b66654abd4` | ✅ |
| `work/ghsync-source.mjs` | `f9256e355c36c6986129e15fd30d5d9f47bdc583` | ✅ |

**不一致数 0**。另核对：远端 tree 中带构建段（`build/out/bench/_bench/_build/node_modules/tmp`）的路径 **0 条**；`work/_account-shots`、`work/chromium-trim`、`work/restore-sample`、`IPM Applications`、`Chormium`、`work/archive`、`work/webview2` 等前缀远端 **0 条**。

## 6. 未删除的内容（本脚本只增改，不做破坏性操作）

| 远端路径 | 数量 | 处理 |
| --- | ---: | --- |
| `web/infinity/error/index.html`、`web/infinity/cn/error/index.html` | 2 | 磁盘上已不存在（tracked 但缺失），**未删除**；如需清理请单独确认 |
| 早前已发布、现被排除规则覆盖的路径（`work/edge-ui/*` 截图 15、`work/_ghstate/*` 7、`work/_pubtmp/*` 6、`work/_ipm2/*` 2、`work/screenshots/*` 2、`work/itbt/*` 1） | 33 | 保留在远端（base_tree 继承），不再随快照更新 |

## 7. 收尾对账

同步完成后再次 `--plan`：`REMOTE old_head=3af6dd45672c5f853c35abd65557342c1347c00b`，`changed=10`（快照 289 文件）—— 说明工作树是**活的**，其他成员在这几分钟内又改了 10 个文件（多为 work/ 下的报告与日志）。脚本可重复执行，增量补齐，不产生重复 blob。

本报告写于同步之后，因此**未包含在上述 commit 中**（远端尚无 `work/source-sync-report.md`）；如需入库，执行 `node work/ghsync-source.mjs --push` 即可作为下一次增量。

## 8. 复现

```powershell
$env:EV_GH_TOKEN = [Environment]::GetEnvironmentVariable('EV_GH_TOKEN','User')   # 不回显
$env:NODE_OPTIONS = ''
node work/ghsync-source.mjs --plan        # 只读：快照口径、排除明细、changed/unchanged、将删除项
node work/ghsync-source.mjs --push        # 写入：blobs -> tree(base_tree) -> commit -> PATCH ref
```

## 9. 合规

- 未执行 `git push`；未 force-push 其他分支；未删除任何远端路径。
- 全程只读工作树（`git ls-files` 读取 + 文件读取），未修改任何文件内容。
- 令牌仅用于 `api.github.com` 请求头，未出现在任何输出、报告或日志中（脚本内含 `scrub()`）。
- 未启动任何可见窗口：本任务只用 `node` 与 `curl.exe`，无浏览器、无 GUI、无 explorer、无系统对话框。
