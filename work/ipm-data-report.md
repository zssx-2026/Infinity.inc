# IPM/发布数据一致性收尾（task-20）

- 日期：2026-10-06（Asia/Shanghai）
- 工作区：`D:\dev\DeepSeekHarnessWorkspace\Infinity.inc`
- 目标版本：`v1.0pre5` / `1.0.0-pre5`（依据 `cpp/release/v1.0pre5/release-assets.json`、`cpp/release/v1.0pre5/name.txt`、`version.json`）
- 状态：**完成**。残留逐条判定完毕；`bundles` 采用「显式标注 + 保留已发布可用条目 + 前端缺失降级（14/14 验证）」；三条必过检查全部 EXIT=0。
- 约束遵守：只改 `InfinityPackageManager/**`、`dist/**`、`web/infinity/assets/releases.json`、降级/验证代码与 `work/ipm-data-report.md`；未碰 ING/Infinity Games 源码资源、`history/`、`work/sync-history.mjs`；未联网、未下载、未上传、未弹窗、未 commit/push。
- 方法说明：DSH `grep`（ripgrep，遵循 `.gitignore`）会跳过 `dist/`、`cpp/release/`、`*/build/` 等被忽略目录，因此对 `InfinityPackageManager/**` 与 `dist/**` 另做了一次逐文件字节扫描（排除二进制扩展名）。二进制（`.exe/.msi/.blob/.zip/.asar` 等 267 个）不做文本判定，见 §6 遗留 4。

## 1. 改动清单（before → after，字节 / sha256）

| 文件 | before 字节 | before sha256 | after 字节 | after sha256 |
|---|---|---|---|---|
| `web/infinity/assets/releases.json` | 66283 | `85c6c912af2750d0e2b593dbfb8f6712d83d75d024c9d5ace208707056a44ba5` | 64864 | `3cf7c0f6014bd28c4ce151c70171831d0b3bd7266404c87c6a51552b02c9bf34` |
| `InfinityPackageManager/InfinityPackageManager/applist.json` | 17244 | `8de7d2dbf0c9d0feb4b4381e277462240b91c4b9ad37f24292adbe88a94dac1f` | 23693 | `e9b4f0d07b007f56d5c0e765769674e0cbf6e63988abcfd65e20005681a4976a` |
| `InfinityPackageManager/InfinityPackageManager/url.json` | 19000 | `c9bce08ce7b39cc4ea2e14f656958752aa1ae296f53bfe9f3a7dcd18e7fb5412` | 31740 | `9ad7fa3b1a76da4676be05aa478b625e129c67b2b5b6889ce3dfa35920f3a454` |
| `InfinityPackageManager/build/setup-stage/setup-win64.nsi` | 11164 | `18293a945f2254a3ab45bd83c8abc21546fb0c988e09f87e8da1bc61c5d5243e` | 11161 | `37a29b0f51d829b8b1bd2474083c8bf8122f4040aa776e0800a99dfac5ccdfb6` |
| `InfinityPackageManager/build/setup-stage/setup-winx86.nsi` | 11166 | `c4c5881b18316d9120d83c7c5587beb29f61e71e8b0563f2e45e563be0662201` | 11163 | `ec60238cf108884ecc203019fff2acef00218413b5c2a02749c2b27e87bd6fbd` |
| `InfinityPackageManager/build/setup-stage/setup-win-arm64.nsi` | 11172 | `bc47393859dc2f76b96b9bbd4085078127342524c91ed793f1af5b2e8bcee725` | 11169 | `1b66bd93d54e2cdf19bde37549db3896281dc874fb6038c59e7233f575da0f5a` |
| `InfinityPackageManager/release/chk-apps.mjs` | 407 | `507dab5197f7fe4216368e866189e9a5df77fcad288b7da4ada757518be1ceca` | 416 | `531e96574e94cd5f44d8bfe1a1b3b8dde77310ab9aa9d7dd7c81a61f4ca40dcb` |
| `InfinityPackageManager/release/publish-all.mjs` | 4891 | `95e5889cabcab15041397c2d9bf40e2167a82f4752561d1d5bc0c5fddf19da2c` | 4891 | `5fafb2f86e948a2c4b8c7610ee377e70ff688126cd50b87415f7ccc87ad625b4` |
| `dist/backup-ipm2/applist.json` | 17244 | `8de7d2dbf0c9d0feb4b4381e277462240b91c4b9ad37f24292adbe88a94dac1f` | 17244（内容未改） | 同上 |
| `dist/backup-ipm2/url.json` | 22083 | `89608a1172ad0f6a59d20b1b1c5af2f89c3a2a26a9ca02f1b38e2b21ea5e624f` | 22083（内容未改） | 同上 |

新增文件：

| 文件 | 字节 | sha256 | 作用 |
|---|---|---|---|
| `InfinityPackageManager/release/check-web-archive.mjs` | 7118 | `e1791ee36f55d0acec8cf3ff885ea34d07320357be565681281bd86b95cb3312` | `bundles` 缺失/无 pre5 的回归验证（GET + DOM 桩，14 项断言） |
| `dist/backup-ipm2/BACKUP-NOTE.md` | 835 | `4e348238c312e4b006b1de0cb9a6a871cf21eeb158a975dafae0e658ddfc4d1f` | 历史备份显式标注（保留原数据） |
| `dist/backup-pre4/BACKUP-NOTE.md` | 835 | `0ed1cb92ee7c140366a9a596c2b74e2310bddcf1b7a9380ea0733c88f4fd2f54` | 历史备份显式标注（保留原数据） |

### 1.1 `releases.json` 的 bundles（核心）

- 原 `bundles` 共 12 条：6 条 `tag=v1.0.0-pre4`（Toolbox / Games / Installer-Manager / Cloud / File-Manager / PackageManager）+ 4 条 `v1.0.0-pre3` + 1 条 `v0.1`（Cloud mac-arm64）。
- 逐条判定：
  - 6 条 `v1.0.0-pre4` → **删除**。`repos` 中的 `v1.0.0-pre4` release 对象已被 task-9 换成 `v1.0.0-pre5`，`archive.js` 只渲染 `repos` 里存在的 tag，这 6 条永远不可达（孤儿）；完整已发布历史仍保留在未改动的 `work/archive-bundles.json`。
  - 4 条 `v1.0.0-pre3` + 1 条 `v0.1` → **保留**。其 tag 仍在 `repos` 中，指向 Infinity-Archive 上真实存在的归档，属可继续服务的已发布数据。
  - **不生成 `v1.0.0-pre5` 条目**：`work/archive/archive-plan.json`（47 条计划）的 `sourceTag` 分布为 `v0.1/v1.0.0-pre3/v1.0.0-pre4/v1.0pre1/v1.0pre2`，**没有 pre5**；`make-bundle.mjs` 需从 GitHub 下载 release 资产并上传到 `Infinity-Archive`，本轮禁止下载/上传（`make-bundle.mjs --upload` 本身也按设计拒绝执行）。若强行用本仓 pre5 安装包本地压一个 `.zst`，其 URL 会指向不存在的归档 Release（404 死链），反而破坏页面，故不写。
  - 新增显式标注字段：`bundlesPendingTags: ["v1.0.0-pre5"]`、`bundlesUpdatedAt`、`bundlesNote`（说明 pre4 条目被删原因、pre5 归档尚未发布、页面降级方式、历史真源在 `work/archive-bundles.json`）。
- 删后 `bundles`：`Infinity-Cloud`（v0.1 mac-arm64、v1.0.0-pre3 win64）、`Infinity-File-Manager` / `InfinityPackageManager` / `Infinity-Installer-Manager`（各 v1.0.0-pre3 win64）。
- 注意：`releases.json` 中仅剩的 1 处 `1.0.0-pre4` 文本就是 `bundlesNote` 的说明性显式标注（见 §2 判定表）。

### 1.2 IPM 自带运行目录（InfinityPackageManager/InfinityPackageManager/）

这两个文件是 IPM 启动时真正读取的目录（`bundle.js:2488/5363/5629` → `config.ROOT/applist.json`、`url.json`），也是 `tools/release.mjs:60-63,112-122` 打包进 pre5 的 PAYLOAD：

- `applist.json`：`updatedAt 2026-10-04T08:58:37.509Z`、6 个 Infinity 包为 `1.0.0-pre4`（latest + versions[] 各一处，共 24 处）→ 换成 `dist/applist.json`（`updatedAt 2026-10-06T01:34:24.624Z`、`1.0.0-pre5`）。
- `url.json`：`updatedAt 2026-09-19T08:35:51.920Z`，只有 `application2/application1`，**连 `application-inc` 发布对象都没有**（即 applist 引用的 tag 在其 url.json 里不存在）→ 换成 `dist/url.json`（`2026-10-06`，含 `application-inc` 及 6 个 `1.0.0-pre5` 资产 + `name.txt`）。
- 说明：任务描述中「url.json 仍含 1.0.0-pre4」与实际不符——该文件根本没有 pre4，而是更早的快照（无 `application-inc`）；本轮按同一路径一并同步为 pre5，消除 applist/url 引用不一致。

### 1.3 可安全刷新为 pre5 的脚本/生成物

| 文件:行 | before | after | 判定 |
|---|---|---|---|
| `build/setup-stage/setup-win64.nsi:21` | `!define PRODUCT_VERSION "v1.0pre2"` | `"v1.0pre5"` | 生成物（make-setup.mjs 现默认 pre5），安全刷新 |
| `build/setup-stage/setup-winx86.nsi:21` | 同上 | 同上 | 同上 |
| `build/setup-stage/setup-win-arm64.nsi:21` | 同上 | 同上 | 同上 |
| `release/chk-apps.mjs:3` | `.../applications/releases/tags/v1.0pre2` | `.../tags/infinity-v1.0pre5` | 与 link-infinity.mjs 默认 TAG=infinity-v1.0pre5 对齐 |
| `release/publish-all.mjs:24` | `process.argv[2] || 'v1.0pre2'` | `'v1.0pre5'` | 与 release.mjs / make-setup.mjs 默认值对齐 |

## 2. 全仓 grep 判定（模式：1.0pre2|1.0pre3|1.0pre4|1.0-pre2|1.0.0-pre4）

排除：`history/`、`work/_installer-e2e`、`node_modules`、`temp/`。

### 2.1 写入范围（InfinityPackageManager/**、dist/**、releases.json）

改动后本范围精确命中共 6 个文件，全部为「已刷新」或「显式标注」：

| 文件 | 命中 | 判定 |
|---|---|---|
| `web/infinity/assets/releases.json` | 1（1.0.0-pre4） | 仅存在于新增 bundlesNote 说明文本，属显式标注保留 |
| `dist/backup-ipm2/applist.json` | 24（1.0.0-pre4） | **历史备份**，内容原样保留，新增 BACKUP-NOTE.md 标注 |
| `dist/backup-ipm2/url.json` | 24（1.0.0-pre4） | 同上 |
| `dist/backup-ipm2/BACKUP-NOTE.md` | 2 | 标注文本本身 |
| `dist/backup-pre4/BACKUP-NOTE.md` | 1 | 标注文本本身 |
| `InfinityPackageManager/release/check-web-archive.mjs` | 1 | 新增回归检查里的断言名（bundles has no v1.0.0-pre4 entry） |

改动前本范围的命中（已全部处理）：`InfinityPackageManager/InfinityPackageManager/applist.json`(24)、`build/setup-stage/*.nsi`(各 1)、`release/chk-apps.mjs`(1)、`release/publish-all.mjs`(1)、`dist/backup-ipm2/{applist,url}.json`(各 24)、`releases.json` bundles(24 处)。（`InfinityPackageManager/InfinityPackageManager/url.json` 实测无命中，但已按一致性同步，见 §1.2。）

### 2.2 写入范围之外（只判定，未改）

| 分类 | 代表文件（命中数） | 判定 |
|---|---|---|
| 发布说明 / release notes | `docs/RELEASE-v1.0pre4.md`(28)、`docs/RELEASE-v1.0pre5.md`(1)、`docs/RELEASE-v1.0pre5-body.md`、`work/rel-notes-v1.0pre4.md`(11) | 历史 release notes，显式保留 |
| 任务报告 / 日志 / 会话记录 | `work/*.md`、`work/worklog.log`、`work/_verify-live-out/**`、`work/_live-releases.json`、`work/_dl-shots/rels.json` 等 | 历史记录，保留 |
| 归档工作数据（真源） | `work/archive-bundles.json`(18)、`work/archive/archive-plan.json`(81)、`work/archive/survey.json`、`work/archive/plan-rows.json`、`work/archive/bundles-lines.jsonl`(6) | 已发布归档的历史真源，保留（本次只从中剔除孤儿条目，未改动文件） |
| 归档/发布辅助脚本 | `work/backup-publish.mjs`(1)、`work/ghsync-source.mjs`(1)、`work/_gitee/test-release.mjs`(1)、`work/dl-render-test.mjs`(2) | 历史脚本，保留 |
| 官网静态资源（非 releases.json） | `web/infinity/assets/verify-download.ps1`(1，用法示例里的 InfinityCloud_1.0.0-pre4_win64_setup.exe) | **不在本轮写范围**（web/infinity/assets 仅允许改 releases.json），列为遗留交由 Lead 决定 |
| 其他工程残留 | `cpp/apps/iim/bench/tmp/releases.json`(1)、`cpp/tools/publish.mjs`(pre3) | 不在本轮写范围（cpp/），保留 |
| `work/edge-ui/**`、`work/webview2/**` 内嵌旧页面 | 共约 17 处 | 历史 UI 快照，保留 |
| 被 .gitignore 忽略的 `cpp/release/v1.0pre4/**`、`InfinityPackageManager/build/**` 二进制 | — | 见 §6 遗留 4 |

## 3. bundles 缺失的降级行为证据（测试 + GET）

- 新增并运行 `InfinityPackageManager/release/check-web-archive.mjs`：用内置 `http` 起 127.0.0.1 服务 GET `/infinity/assets/releases.json`，再用最小 DOM 桩加载真实 `web/infinity/assets/archive.js` 渲染两份数据（真实文件 / `bundles` 被删除的副本）。无外部依赖、无网络出站。
- 命令（退出码 0）：

```powershell
& "D:\program\nodejs\node.exe" "InfinityPackageManager\release\check-web-archive.mjs" "D:\dev\DeepSeekHarnessWorkspace\Infinity.inc"
# EXIT=0  ->  DEGRADE-PASS 14/14
```

- 14 项断言全部通过（原始输出）：

```text
ok   GET /infinity/assets/releases.json -> 200  [status=200]
ok   bundles never declares v1.0.0-pre5  [["Infinity-Installer-Manager","Infinity-Cloud","Infinity-File-Manager","InfinityPackageManager"]]
ok   bundles has no v1.0.0-pre4 entry
ok   every repo lists v1.0.0-pre5
ok   bundlesPendingTags includes v1.0.0-pre5
ok   download.js does not read bundles
ok   pre5 row shows "not built yet"
ok   pre5 row links the release file
ok   pre5 row has no archive.zst link
ok   published pre3 archive link survives
ok   bundles absent: pre5 still says "not built yet"
ok   bundles absent: pre5 direct link still there
ok   bundles absent: no archive.zst link at all
ok   bundles absent: version row still rendered
DEGRADE-PASS 14/14
```

- 降级机制（既有代码，未改）：`archive.js:71` 用 `(data.bundles && data.bundles[p.repo]) || []`；`:127-148` 对无 bundle 的版本显示 `the .zst for this platform is not built yet`（中文「该平台的 .zst 归档包尚未生成」）并直接列出该 release 的文件直链，文件头注释即写明「a missing bundle must never look like a missing version」。
- `download.js` 源码不含 `bundles`（断言 6），下载页天然不受 `bundles` 缺失影响。
- 结论：pre5 目前无已发布归档属已知事实，页面按设计降级为直接文件链接，不会把 pre5 显示成不存在，也不会给出 404 的假 `.zst` 链接；已有 pre3/v0.1 的真实归档链接保持可用。

## 4. 三条必过检查（改动后复跑）

| 检查 | 命令 | 结果 | 退出码 |
|---|---|---|---|
| IPM 版本自检 | `cd InfinityPackageManager\InfinityPackageManager; cmd /c ".\ipm.exe version"` | `EasyPackageManager  v1.0.0-pre5` + 15 个已安装包 | **0** |
| INC 回收站自检 | `cd "Infinity Cloud\sourcecode"; & 'D:\program\nodejs\node.exe' tools\test-trash.mjs` | 19 项 ok + `all passed` | **0** |
| 官网中文站验收 | `& 'D:\program\nodejs\node.exe' work\cn-lead-verify.mjs web` | `PASS 中文站完全汉化`（cnPages=19, problems=0） | **0** |

附加自检：

| 检查 | 命令 | 结果 |
|---|---|---|
| 新验证脚本 | `node InfinityPackageManager\release\check-web-archive.mjs .` | DEGRADE-PASS 14/14，EXIT=0 |
| JS 语法 | `node --check` × `chk-apps.mjs`、`publish-all.mjs`、`check-web-archive.mjs` | 3×EXIT=0 |
| JSON 语法 | `JSON.parse` × `releases.json`、APP `applist.json`/`url.json`、`dist/backup-ipm2/*.json` | 全部 ok |

（改动前基线同样为 3×EXIT=0，见 `work/js-version-report.md` §3。改动只涉及 JSON 数据与 NSIS/脚本默认值，不触及这三条检查的代码路径。）

## 5. 验收对照

| 验收项 | 结果 |
|---|---|
| 全仓 grep 逐条判定（可刷新→pre5；备份/release notes→显式标注保留） | §2 表，写入范围内残留全部为已刷新或显式标注 |
| `releases.json.bundles` 无 pre5 假条目 / 无 pre4 孤儿 | 6 条 pre4 孤儿已删；`bundlesPendingTags=[v1.0.0-pre5]` + `bundlesNote` 显式标注 ✅ |
| bundles 缺失时前端优雅降级（测试或 GET 验证） | GET 200 + DOM 桩渲染 14/14 ✅ |
| `ipm.exe version` / `test-trash.mjs` / `cn-lead-verify.mjs web` | 3×EXIT=0 ✅ |
| 报告 `work/ipm-data-report.md` | 本文件 ✅ |

## 6. 遗留（未做/需 Lead 决定）

1. **pre5 归档包本身尚未发布**：`work/archive/archive-plan.json` 无 pre5 条目，Infinity-Archive 上传需 token + 真实构建产物（本轮禁止联网/上传）。发布后应执行 `work/archive/make-bundle.mjs --append` → 重新生成 `work/archive-bundles.json` → 用 `work/gen-releases-json.mjs` 重生成 `releases.json`（会覆盖本轮新增的 `bundlesNote/bundlesPendingTags` 标注）；或手工把 pre5 条目加入 `bundles` 并删除标注。
2. **bundles 的 pre4 历史条目**仍完整保留在未改动的 `work/archive-bundles.json`；`gen-releases-json.mjs` 若在 pre5 发布前被重跑，会把 6 条 pre4 孤儿重新写回 `releases.json`（脚本只做 `data.bundles = archive-bundles.json`，不按 repos 过滤）。建议后续给该脚本加「按 repos tag 过滤」逻辑（不在本轮写范围）。
3. **`web/infinity/assets/verify-download.ps1:11`** 用法示例仍是 `InfinityCloud_1.0.0-pre4_win64_setup.exe`；该文件不在本轮允许修改的范围（web/infinity/assets 只允许 releases.json），未动。建议后续统一为 pre5。
4. **二进制未做文本判定**：`InfinityPackageManager/build/setup/*.exe`、`build/msi/*.msi`、`build/out/**`、`InfinityPackageManager/InfinityPackageManager/{ipm.exe,ipm.blob}`、`dist/{ipm.exe,ipm.blob}` 等 267 个二进制可能内嵌旧版本字符串，本轮仅跳过（.zst/安装器由发布流水线重建）。`build/setup-stage/{win64,winx86,win-arm64}/applist.json` 仍是 2026-09-19 的 20 包旧目录（文本内无 pre4），会在下次 build-all/make-setup 时被 `InfinityPackageManager/InfinityPackageManager/applist.json`（已 pre5）覆盖。
5. **APP 与 dist 的 pre5 字节/URL 口径**：本次把 APP 目录与 `dist/{applist,url}.json` 对齐（`applications` 仓库 `application-inc` 口径，size 为 task-9 记录值，如 InfinityPackageManager 288313）；而当前仓内 `cpp/release/v1.0pre5/release-assets.json`（2026-10-06T03:44 重建）为各仓库 URL 且 size=288570。二者差异属既有「计划态 vs 实际发布仓库」问题（`work/js-version-report.md` 遗留 4），未在本轮扩大改动；若 pre5 实际发布到各应用仓库，需统一刷新 APP 与 dist 的 6 条 Infinity 条目（fileName/size/url）。
6. 未 commit/未 push。临时脚本只写在系统 temp（`%TEMP%\ipm-data-verify\`）并被清理；仓库内无临时文件（曾误建的工作区 `undefined\` 目录已确认内容后删除）。

## 7. task-24 追加：生成器 bundles 过滤 + verify-download 示例（2026-10-06）

对应 task-20 §6 遗留 **2**（生成器会把 pre4 孤儿写回）与 **3**（verify-download.ps1 示例仍 pre4），均已处理。

### 7.1 路径说明（需 Lead 确认）

task-24 写范围写的 `InfinityPackageManager/release/gen-releases-json.mjs` **不存在**（已确认）；实际生成器是 `work/gen-releases-json.mjs`，也正是 task-20 §6.2 引用的那个。本轮按任务描述修复真实文件；如需把生成器迁到 IPM/release 下请另行指示。

### 7.2 (b) work/gen-releases-json.mjs 加过滤

- before：2131 B，sha256 `e84b54f555926a62510249616f0410694abac6fd80a255c4de6e436ca5ce44dc`（按原始 31 行重建校验，字节数与改前一致）
- after：7663 B，sha256 `166f8dc7ad1ecd1987e72dd8ab97a2e4475c2cb8228139ef4266cd501a933341`

改动内容：
1. 新增 `filterBundles(repos, raw)`：只保留 repo 在 release 列表中、且 tag 属于该 repo 当前 tag 集合的归档；其余记入 dropped（pre4 孤儿即在此被剔除）。
2. 新增 `attachBundles(data, repos, raw)`：写入过滤后的 `bundles` + `bundlesUpdatedAt` + `bundlesPendingTags: ['v1.0.0-pre5']` + `bundlesNote`，其中 note 文案与 task-20 写入的逐字一致，重跑不会丢标注。
3. 新增离线 `--check` 模式：读现有 `releases.json` 的 repos + `work/archive-bundles.json`，套用同一过滤并断言 ① 无孤儿存活 ② 重跑结果与现有 `bundles` 完全一致 ③ `bundlesPendingTags`/`bundlesNote` 不会丢 ④ 保留的每个 repo 都在当前版本 `cpp/release/v1.0pre5/release-assets.json` 中。**不写任何文件**。
4. 网络主路径（`EV_GH_TOKEN` + curl）行为不变，仅将原来那 4 行 `data.bundles = ...` 换成过滤 + 标注。

验证命令与退出码：

```powershell
node work\gen-releases-json.mjs --check      # EXIT=0
```

原始输出要点：

```text
release-assets repos (cpp/release/v1.0pre5/release-assets.json): Infinity-Cloud, Infinity-File-Manager, Infinity-Games, Infinity-Installer-Manager, Infinity-Toolbox, InfinityPackageManager
raw bundles: 6 repos / 11 archives
dropped as orphans (6):
  Infinity-Toolbox  v1.0.0-pre4  InfinityToolbox_1.0.0-pre4_win64_archive.zst
  Infinity-Games  v1.0.0-pre4  InfinityGames_1.0.0-pre4_win64_archive.zst
  Infinity-Installer-Manager  v1.0.0-pre4  InfinityInstallerManager_1.0.0-pre4_win64_archive.zst
  Infinity-Cloud  v1.0.0-pre4  InfinityCloud_1.0.0-pre4_win64_archive.zst
  Infinity-File-Manager  v1.0.0-pre4  InfinityFileManager_1.0.0-pre4_win64_archive.zst
  InfinityPackageManager  v1.0.0-pre4  InfinityPackageManager_1.0.0-pre4_win64_archive.zst
kept: 5 archives in 4 repos
  Infinity-Installer-Manager: v1.0.0-pre3/win64
  Infinity-Cloud: v0.1/mac-arm64, v1.0.0-pre3/win64
  Infinity-File-Manager: v1.0.0-pre3/win64
  InfinityPackageManager: v1.0.0-pre3/win64
BUNDLES-CHECK-PASS (offline; releases.json not written)
```

结论：重跑写出的 `bundles` 与当前 `releases.json` 中的完全一致 → **pre4 孤儿不会再写回**，真实 pre3/v0.1 归档与 `bundlesPendingTags` 标注保留。仓库文件本回合未被改动（`--check` 不写盘，`releases.json` 哈希仍为 `3cf7c0f6014bd28c…`）。

负路径实测（temp 沙箱内复制仓库片段运行，不碰仓库）：

| 用例 | 期望 | 实测 |
|---|---|---|
| 正常（当前 releases.json） | PASS | EXIT=0 |
| 删除 `bundlesNote` | FAIL | EXIT=1 |
| bundles 多塞一条 v1.0.0-pre4 孤儿 | FAIL | EXIT=1 |
| bundles 出现 release-assets 之外的 repo | FAIL | EXIT=1 |

说明：真实重跑需要 `EV_GH_TOKEN` 联网抓 release 列表（本轮禁止联网），故用 `--check` 走与主路径**同一套** `filterBundles/attachBundles` 并断言写盘结果；这不能替代发布日的真实重跑，但能保证过滤逻辑与标注不回归。

### 7.3 (c) web/infinity/assets/verify-download.ps1

- before：1382 B，sha256 `fcbb33c9a22f1dc8e755d57db6e869cc59713f6480eb653debba44db24f56fb7`（按原始 34 行重建校验，字节数与改前一致）
- after：2019 B，sha256 `046fe6f0052c73318addac1806f1f816ab41931274a393915d7871656adbbb10`

- 示例文件名改为 `InfinityCloud_1.0.0-pre5_win64_setup.exe`；占位 `<digest>` 改为真实摘要 `0d5d9fcd91d9a41b44334c06628fa1c5950d0728b96c0a5c6243032d93e4dc0c`，并注明来源。
- 摘要三方核对（`cpp/release/v1.0pre5/release-assets.json` ⇄ `installers/packaging/v1.0pre5/SHA256SUMS.txt`，6/6 全等）：

| 安装包 | size | release-assets sha256 | SHA256SUMS sha256 | 一致 |
|---|---|---|---|---|
| InfinityCloud_1.0.0-pre5_win64_setup.exe | 514897 | 0d5d9fcd91d9a41b… | 0d5d9fcd91d9a41b… | 是 |
| InfinityFileManager_1.0.0-pre5_win64_setup.exe | 238722 | 535fb6ecdba1512e… | 535fb6ecdba1512e… | 是 |
| InfinityPackageManager_1.0.0-pre5_win64_setup.exe | 288570 | 2b59a4df0d0ec518… | 2b59a4df0d0ec518… | 是 |
| InfinityInstallerManager_1.0.0-pre5_win64_setup.exe | 307194 | 669bee8be05bd6a3… | 669bee8be05bd6a3… | 是 |
| InfinityToolbox_1.0.0-pre5_win64_setup.exe | 297021 | 1806f62100227ba3… | 1806f62100227ba3… | 是 |
| InfinityGames_1.0.0-pre5_win64_setup.exe | 268784 | 0a6d18c405f164d7… | 0a6d18c405f164d7… | 是 |

- 为让示例可离线自证，新增 `-Example` 开关（打印示例行后 `exit 0`）；`-Path` 由 Mandatory 改为运行时校验，缺参时明确报错而不是卡在交互提示。哈希校验/Unblock 主逻辑未改，脚本仍可正常执行。

验证命令与退出码：

| 命令 | 输出 | 退出码 |
|---|---|---|
| `... -Example` | 打印 pre5 示例行 | 0 |
| 用 `%TEMP%\vd-test\` 的 pre5 安装包副本跑示例（真实摘要） | `size 514897 bytes` + `MATCH: this is the published file.` + `Unblocked: ...` | 0 |
| 同命令传全 0 摘要 | `MISMATCH: the file is not the published one. Do not run it.` | 1 |
| 不传参数 | `Path is required. Use -Example to print the usage line.` | 1 |

### 7.4 (c-附带) verify.js 同类字符串排查

- `web/infinity/assets/verify.js`：9451 B，sha256 `db3cfa0c8828f90b44d51838435995d768be1ffefc3f13c0b0289e0fde1966a6`，**本轮未改**。
- 精确模式 `1.0pre[234]|1.0-pre2|1.0.0-pre4` 命中 0；无 `.exe`/`.zst`/版本示例字符串；唯一硬编码 URL 是 404 回退页 `https://zssx-2026.github.io/404`，属 task-21(Gitee 内容源)范围，不是版本示例。
- 另核：`archive.js` 命中 0；`releases.json` 仅 §1.1 的 `bundlesNote` 说明文本 1 处。

### 7.5 task-24 复跑必过项

| 检查 | 命令 | 结果 | 退出码 |
|---|---|---|---|
| 归档降级回归 | `node InfinityPackageManager\release\check-web-archive.mjs .` | DEGRADE-PASS 14/14 | **0** |
| 中文站验收 | `node work\cn-lead-verify.mjs web` | PASS 中文站完全汉化 | **0** |
| 生成器语法 | `node --check work\gen-releases-json.mjs` | — | **0** |
| 生成器离线校验 | `node work\gen-releases-json.mjs --check` | BUNDLES-CHECK-PASS | **0** |

写范围重叠提示：task-21（cn-gitee）覆盖 `web/infinity/assets/**`。本轮只改 `verify-download.ps1`；`verify.js`、`releases.json`、`archive.js` 未动，供其继续。

