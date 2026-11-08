# 六产品离线自测总扫报告（task-28 / quality-sweep）

- 执行时间：2026-10-06 18:35 ~ 19:48（Asia/Shanghai）
- 工作区：D:\dev\DeepSeekHarnessWorkspace\Infinity.inc
- 运行时：node v24.19.0（D:\program\nodejs\node.exe）、PowerShell 5.1、g++ 16.1.0、makensis 3.12
- 版本：version.json → v1.0pre5 / 1.0.0-pre5；产品树处于中间态（git HEAD=3e3a58a，未提交变更 294 项）
- 约束遵守：只跑 CLI/无窗口测试；未运行任何安装包/卸载程序；未下载/安装；未触碰 D:\program\**、用户快捷方式、ING 源、history/、work/sync-history.mjs。
- 说明：run-tests.ps1、sea-exe-smoke.mjs、verify-meta.mjs、preview-http-check.mjs 等脚本会自行管理其启动的子进程（脚本内部实现），本次未手工结束/终止任何其它进程。

## 一、汇总表

| 产品 | 入口 | 命令（工作区根目录执行） | 退出码 | 通过 | 失败 | 备注 |
| --- | --- | --- | ---: | ---: | ---: | --- |
| INC | 预览全链路（重点回归） | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File '.\Infinity Cloud\preview\tests\run-tests.ps1' -With8s` | 0 | 13/13 子步骤 exit 0；harness 23/23、wire fail:0、ui fail:0 | 0 | `RESULT failures=0`，与历史一致（必须为 0） |
| INC | preview ui-preview.test.mjs | `node 'Infinity Cloud\preview\tests\ui-preview.test.mjs'` | 0 | 17 | 0 | 独立复跑，ui-summary fail:0 |
| INC | installer 检查器 | `node 'Infinity Cloud\sourcecode\tools\nsi-check.mjs'` | 0 | 0 error | 0 | 0 warning；makensis 编译通过；脚本 hash 7697C985…（18:27，nsi-fix 产出） |
| INC | nsi-check 负例自测 | `node 'Infinity Cloud\sourcecode\tools\nsi-check.test.mjs'` | 0 | 25 | 0 | 含 makensis 真编译负例 |
| INC | 回收站/Store 单测 | `node 'Infinity Cloud\sourcecode\tools\test-trash.mjs'` | 0 | 19 | 0 | 纯内存 fakeGh，离线无网络 |
| INC | bootstrap-test.mjs | —（未运行） | — | — | — | 需网络：ensureTools 会下载/解包工具 |
| IFM | 打包器自检 | `node 'Infinity File Manager\bench\bundle-check.mjs'` | 0 | syntax ok / 12 模块 | 0 | generatorExportTransformed、generatorCallable 均 true |
| IFM | 预览页静态检查 | `node 'Infinity File Manager\bench\check-page.mjs'` | 0 | PASS true | 0 | 288 行内联脚本、21 个 id |
| IFM | 两阶段列表等价 | `node 'Infinity File Manager\bench\verify-meta.mjs'` | 0 | PASS true | 0 | meta_mismatches=0，进程内起 loopback 服务（无窗口） |
| IFM | 流式预览 HTTP 证据 | `node 'Infinity File Manager\bench\preview-http-check.mjs'` | 0 | failed checks: none | 0 | 写 work/_preview-shots/ifm 证据 |
| IFM | SEA exe 冒烟 | `node 'Infinity File Manager\bench\sea-exe-smoke.mjs'` | **-1073740791** | 1 场景 ok:true | 0 | 功能面通过（页面 200/79 条目/v1.0pre5），但 node v24 退出时 libuv 断言崩溃（0xC0000409）。详见失败详情 F1 |
| IPM | web 归档降级回归 | `node 'InfinityPackageManager\release\check-web-archive.mjs' .` | 0 | 14 | 0 | `DEGRADE-PASS 14/14`，与历史一致 |
| IPM | release/verify.mjs | —（未运行） | — | — | — | 需网络 + GitHub API/token（ghApi） |
| IPM | release/chk-apps.mjs | —（未运行） | — | — | — | 需网络 + token |
| IPM | tools/test-trash.mjs | —（不存在） | — | — | — | 该文件不在 IPM；同名离线脚本在 INC（已跑） |
| IIM | 版本冒烟 | `.\cpp\build\iim.exe --version` | 0 | 1 | 0 | Infinity Installer Manager [v1.0.0-pre5]，无窗口 |
| INT | 版本冒烟 | `.\cpp\build\int.exe --version` | 0 | 1 | 0 | Infinity Toolbox [v1.0.0-pre5] |
| ING | 版本冒烟 | `.\cpp\build\ing.exe --version` | 0 | 1 | 0 | Infinity Games [v1.0.0-pre5]；仅运行已编译 exe，未触碰 ING 源 |
| INC | cpp 版本冒烟 | `.\cpp\build\inc.exe --version` | 0 | 1 | 0 | Infinity Cloud [v1.0.0-pre5] |
| IFM | cpp 版本冒烟 | `.\cpp\build\ifm.exe --version` | 0 | 1 | 0 | Infinity File Manager 1.0.0-pre5 |
| IPM | cpp 版本冒烟 | `.\cpp\build\ipm.exe --version` | 0 | 1 | 0 | InfinityPackageManager 1.0.0-pre5 |
| cpp | json 单测 | `.\cpp\tests\json_test.exe` | 0 | 57 | 0 | 纯离线 |
| cpp | str 单测 | `.\cpp\tests\str_test.exe` | 0 | 56 | 0 | 纯离线 |
| cpp | store 冒烟 | `.\cpp\tests\store_smoke.exe` | 2 | 0 | 0 | SKIP: no token（需要真实 token/网络） |
| cpp | store 冲突 | `.\cpp\tests\store_collision.exe` | 2 | 0 | 0 | SKIP: no token（需要真实 token/网络） |
| web（共享） | 中文站汉化验收 | `node 'work\cn-lead-verify.mjs' web` | 0 | PASS（19 页、problems 0） | 0 | 与历史一致 |
| web（共享） | 中文站走 Gitee 验收 | `node 'work\cn-gitee-verify.mjs'` | 0 | 76 | 0 | 历史 61 checks；脚本 18:46 已扩写，非回归 |
| web（共享） | SEO/元数据验收 | `node 'work\site-seo-verify.mjs'` | 0 | 38/38 页 | 0 | sitemap 36 条可索引、root 2/2 |
| web（共享） | 账户离线单测 | `node 'work\account-tests.mjs'` | 0 | 56 | 0 | 全程零网络请求 |
| web（共享） | 账户静态自检 | `node 'work\account-static-check.mjs'` | **1** | 20 | **4** | ❌ 详见失败详情 F2 |
| web（共享） | verify 门行为测试 | `node 'work\gate-test.mjs'` | **挂起（无退出码）** | 5 | **4** | ❌ 详见失败详情 F3 |
| shell（共享） | shell/IFM 契约 | `node 'shell\verify-contract.mjs'` | **1** | 36 | **7** | ❌ 详见失败详情 F4 |

统计：已运行入口 27 个；失败/异常入口 3 个（verify-contract、account-static-check、gate-test）+ 1 个退出码异常（IFM sea-exe-smoke）；命令性跳过 2 个（cpp store_*）；未运行 6 个（含 4 个需网络/ token、1 个需下载、1 个按硬禁令跳过）。

## 二、失败详情

### F1 IFM sea-exe-smoke.mjs —— 退出码 -1073740791（功能面通过）
- 命令：`node 'Infinity File Manager\bench\sea-exe-smoke.mjs'`
- 脚本自身输出：`{"ok":true, ... "port":7623, "pageStatus":200, "pageBytes":20663, "hasPreviewOverlay":true, "listedEntries":79, "listOk":true, "infoVersion":"v1.0pre5"}`
- 但 node 进程退出时崩溃：
  `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94`
  退出码 -1073740791（0xC0000409，STATUS_STACK_BUFFER_OVERRUN）。
- 判定：被测产品的功能面 PASS；异常发生在测试脚本在 node v24 下结束子进程/收尾的 libuv teardown 阶段。历史（work/ifm-sea-report.md）用 node v22 跑同一脚本为 exit 0，故属运行时版本差异，非 IFM 产品回归。
- 建议：owner 用 node v22 复跑确认；或在 sea-exe-smoke.mjs 收尾处显式 `process.exit(0)` 规避 libuv 断言。

### F2 work/account-static-check.mjs —— 4/24 静态检查失败
- 命令：`node 'work\account-static-check.mjs'`，退出码 1。
- 4 条失败完全同一断言：`<页面> references no external host`，命中 4 个账户页（en/cn 的 signup、login）。
- 根因（已定位）：该断言为 `!/https?:\/\/[^"']+/.test(html.replace(/github\.com/g,''))`。site-seo（task-16）给账户页补了绝对 URL 的 canonical / hreflang / og:url（如 `https://zssx-2026.github.io/infinity/(cn/)signup/`），断言只排除了 github.com。属**测试脚本口径过期**，非产品缺陷（account.js 的网络清单仍只有 1 处 fetch、仅 api.github.com / github.com/login，静态检查其余 20 条全过）。
- 建议：把断言改为只对"资源型外链/CDN"生效，或把本域绝对 URL（zssx-2026.github.io）加入白名单。

### F3 work/gate-test.mjs —— 5/9 通过且进程不退出
- 命令：`node 'work\gate-test.mjs'`，输出 `5/9 passed` 后进程一直不退出（脚本末尾无 `process.exit`，verify.js 的计时器使事件循环保持存活），因此**无法取得退出码**；本次未终止该进程。
- 4 条失败：
  - `first visit uses infinity-gate` → class=""（期望 infinity-gate）
  - `internal navigation uses infinity-nav` → class="infinity-gate"（期望 infinity-nav）
  - `internal navigation is not a gate` → 失败
  - `internal navigation reveals quickly` → elapsed=0（未揭示）
- 初步判定：脚本对 verify.js 的断言口径与现状不一致（脚本 10-04 20:02，verify.js 现用 sessionStorage `infinity.visited` + document.referrer 判 internal，class 名 106 行为 infinity-nav/infinity-gate）。看起来是**测试脚本过期/DOM 桩不匹配**，但不能排除 verify.js 内部导航判定退化。工作区内没有该脚本的历史通过记录，建议 owner（cn-runtime/release-prep）复核。

### F4 shell/verify-contract.mjs —— 7/36 失败，退出码 1
- 命令：`node 'shell\verify-contract.mjs'`，输出 `SELFTEST FAIL pass=36 fail=7`。
- 7 条失败全部是同一族：`exeNames <target>` 期望 `ifm_cli,ifm_launcher,ifmx_cli,ifmx_launcher`（4 名），实际 build-all.mjs 已返回 6 名 `ifm_cli,ifm_gui,ifm_launcher,ifmx_cli,ifmx_gui,ifmx_launcher`（7 个平台全中）。
- 根因（已定位）：`Infinity File Manager/sourcecode/tools/build-all.mjs` 已按"六名家族（cli/gui/launcher × 普通/提升）"实现并有注释与文档（09:42 版本，MODES=['cli','gui','launcher']）；`shell/verify-contract.mjs`（10-04 15:27）仍写死 4 名。
- 判定：**测试期望未随 build-all.mjs 演进更新**，非 shell/IFM 契约本身失败；其余 36 条（端口表、窗口名映射、electronArch/hasGui/stageGui 等）全通过。

## 三、与历史已知状态的差异

| 回归项 | 历史已知状态 | 本次实测 | 差异判定 |
| --- | --- | --- | --- |
| INC preview run-tests.ps1 -With8s | failures=0 | failures=0（13/13 子步骤 exit 0） | 一致 ✅ |
| IPM check-web-archive.mjs . | 14/14 EXIT=0 | DEGRADE-PASS 14/14 EXIT=0 | 一致 ✅ |
| INC nsi-check.mjs | 0 error | 0 error、0 warning、EXIT=0 | 一致（并升级为 0 warning）✅ |
| work/cn-lead-verify.mjs web | PASS | PASS（19 页 0 问题） | 一致 ✅ |
| work/cn-gitee-verify.mjs | 61 checks / 0 failed | 76 checks / 0 failed | 脚本已扩写（18:46 版本），检查项增加；结果仍 0 failed ✅ |
| shell/verify-contract.mjs | pass=43 fail=0（work/proj-ifm-report.md） | pass=36 fail=7 | ❌ 回归（测试期望过期，见 F4） |
| work/account-static-check.mjs | ALL 24 PASS（work/account-report.md） | 20/24，4 页外链断言失败 | ❌ 回归（site-seo 绝对 URL，见 F2） |
| IFM sea-exe-smoke.mjs | node v22 exit 0（work/ifm-sea-report.md） | 载荷 ok:true，退出码 -1073740791 | ⚠ 运行时差异（见 F1） |
| work/gate-test.mjs | 无历史记录 | 5/9 且不退出 | ⚠ 新发现（见 F3） |
| IFM bundle-check / check-page / preview-http-check / verify-meta | 全 exit 0（work/preview-ifm-report.md、ifm-sea-report.md） | 全 exit 0 | 一致 ✅ |
| cpp json_test / str_test | 无单独历史记录 | 57/0、56/0 exit 0 | 通过 ✅ |
| 六产品版本冒烟 | — | 六个 exe 均 v1.0.0-pre5 exit 0 | 通过 ✅ |

## 四、未运行入口与原因

| 入口 | 原因 |
| --- | --- |
| INC sourcecode/tools/bootstrap-test.mjs | 需要网络/下载（ensureTools 会拉取并解包工具），违反"不下载不安装" |
| IPM release/verify.mjs、release/chk-apps.mjs | 需要网络 + GitHub API + token（ghApi） |
| work/_gitee/test-release.mjs | 需要 Gitee token + 网络，且会**创建远端 release/上传**（副作用） |
| work/smoke-pages.mjs | 需要网络（curl 线上站点逐页比对） |
| work/dl-render-test.mjs | 需要线上 API 数据文件作为入参 |
| work/verify-archive.mjs | 读取 history/（硬禁令：不碰 history/） |
| work/apply-verify.mjs | 会改写 web/ 页面（不是自测脚本，属写操作） |
| work/itbt/e2e-test.ps1 | 属插件安装/卸载类，且依赖外部 fastbrowser.exe 工件（硬禁令：不安装/不卸载） |
| IFM bench/probe-*.mjs、bench-ui.ps1、bench-start.ps1 等 | 需要已运行的宿主/服务或会启动 UI/窗口，非离线无窗口自测 |
| ING 专属自测 | 硬禁令：不碰 ING 源（仅运行已编译 ing.exe --version） |
| IPM/IIM/INT 专属离线单测 | 产品树中不存在（IPM 仅 check-web-archive；IIM/INT 只有共享 cpp/tests 与 --version） |

## 五、遗留与建议

1. **仍有 1 个本次启动的测试进程未退出**（work/gate-test.mjs：pwsh-132 → node）。硬禁令要求不得结束/终止任何进程，故未清理；建议 owner 复核后由脚本自行修复退出路径。
2. 三个离线自测脚本因产品树演进失效，建议划线到对应 owner：
   - `shell/verify-contract.mjs`（F4）→ 与 IFM build-all.mjs 的六名家族对齐（或明确是否只校验旧四名）。
   - `work/account-static-check.mjs`（F2）→ 外链断言白名单本域绝对 URL。
   - `work/gate-test.mjs`（F3）→ 补齐 `process.exit`，并对齐 verify.js 的 class/内部导航判定。
3. cpp `store_smoke.exe / store_collision.exe` 需要真实 token 才能跑，非离线；如需纳入回归，应提供离线 stub 或明确记为 SKIP。
4. IPM、IIM、INT 缺少纯离线自测入口（当前仅 cpp 共享单测 + --version 冒烟 + IPM 的 web 归档检查）；建议每家补一个离线 smoke。
5. 并发提示：nsi-check.mjs（nsi-fix）与 cn-gitee-verify.mjs（cn-gitee）在本次扫描前后可能继续变化；本报告结论对应 hash 见下表。产品树 294 项未提交变更，属中间态。
6. 本次未对任何安装包执行安装/卸载，端到端安装验证属 verifier-e2e 的范围，不在本报告内。

## 六、本次实测脚本版本（SHA256 前 16 位 / 修改时间）

| 脚本 | hash(16) | mtime |
| --- | --- | --- |
| Infinity Cloud/sourcecode/tools/nsi-check.mjs | 7697C985D0E9ED65 | 10-06 18:27:42 |
| Infinity Cloud/sourcecode/tools/nsi-check.test.mjs | 552BA570D97F03D7 | 10-06 17:21:12 |
| Infinity Cloud/sourcecode/tools/test-trash.mjs | A611274CAA7BF8E8 | 09-28 18:36:42 |
| Infinity Cloud/preview/tests/run-tests.ps1 | 255A18BC567A50B4 | 10-06 14:22:51 |
| Infinity Cloud/preview/tests/ui-preview.test.mjs | 1EC2F8E12795E61C | 10-06 14:25:54 |
| InfinityPackageManager/release/check-web-archive.mjs | E1791EE36F55D0AC | 10-06 14:33:52 |
| work/cn-lead-verify.mjs | 2AF09549C0240FA5 | 10-06 10:39:25 |
| work/cn-gitee-verify.mjs | B30E9B4E8A7739A4 | 10-06 18:46:04 |
| work/gate-test.mjs | 152BDE2DF69AB89B | 10-04 20:02:49 |
| work/account-static-check.mjs | 199EAD4E98C89B1E | 10-05 09:11:02 |
| work/account-tests.mjs | 369FDD030C9A4C35 | 10-05 09:15:38 |
| work/site-seo-verify.mjs | 400923765BBDA7A1 | 10-06 14:41:19 |
| shell/verify-contract.mjs | C1C0FFC1231DAE78 | 10-04 15:27:44 |
| Infinity File Manager/sourcecode/tools/build-all.mjs | 1F28D97C7189405C | 10-06 09:42:57 |
| version.json | 546C364D80551996 | 10-06 09:27:49 |

---

# 追加：task-31 修复轮（2026-10-11）

本节记录 F1/F2 由 Lead 修复后的复验，以及 F3/F4 的根因与修复、IPM/IIM/INT 新增离线入口。执行环境不变：node v24.19.0、PS 5.1；git HEAD 仍为 3e3a58a。

## 7.1 F1 / F2 复验（Lead 已修复）

| 入口 | 命令 | 退出码 | 结果 |
| --- | --- | ---: | --- |
| shell/verify-contract.mjs | `node 'shell\verify-contract.mjs'` | 0 | `SELFTEST PASS  pass=43 fail=0`（hash 6FE0ECCD, 10-06 20:08） |
| work/account-static-check.mjs | `node 'work\account-static-check.mjs'` | 0 | `ALL 24 STATIC CHECKS PASS`（hash 995F00BC, 10-06 20:12） |

两项均达到 Lead 声明的 43/0 与 24/24，F1/F2 关闭。

## 7.2 F3 work/gate-test.mjs —— 4 个 FAIL 的真实根因与修法

修前：`5/9 passed`，且脚本无 `process.exit`、verify.js 的两个 setInterval 无人清理，node 事件循环不排空 → **进程不退出、无退出码**（即当时遗留的 pwsh-132；Lead 已确认该进程此后不存在）。

逐条根因（以 web/infinity/assets/verify.js 现行实现为准，**未改产品代码**）：

| # | 修前 FAIL | 真实根因（verify.js 行号） | 修法（仅改测试宿主 work/gate-test.mjs） |
| --- | --- | --- | --- |
| 1 | `first visit uses infinity-gate` → class="" | :106 首次到访写入 `infinity-gate`，但 :121-126 的 `reveal()` 在 MIN_MS=3000 后会 `clearGateClass()` 清掉 class。断言在 `wait(3300)` 之后才读 class，此时 class 必然已空。 | makeEnv 在源码执行后立刻捕获 `initialClass`；断言 `initialClass` 含 infinity-gate 且 `state.mode==='gate'`；另加"reveal 后 class 已清空"一条。 |
| 2 | `internal navigation uses infinity-nav` → class="infinity-gate" | :87-92 在源码**执行时**读 sessionStorage `infinity.visited`；原脚本在 `makeEnv()` **之后**才 `setItem`，为时已晚 → internal=false，走 gate 分支（:94、:106）。 | makeEnv 新增 `opts.session`，在 `fn(...)` 调用**之前**预置存储；用例改为 `makeEnv({ session: { 'infinity.visited': '1' } })`。 |
| 3 | `internal navigation is not a gate` | 同上（internal 误判为 gate，class 即 infinity-gate）。 | 同上；改为断言 `initialClass` 不含 infinity-gate。 |
| 4 | `internal navigation reveals quickly` → elapsed=0 | 同上：误走 gate 分支要等 MIN_MS=3000，而用例只 `wait(900)`，远未 reveal。 | 修好 internal 判定后，:162-171 会按 SHORT_MS=700 reveal；断言 `revealedAt!==null && elapsedMs<2000`。 |

宿主退出修复：verify.js 创建的两个 `setInterval`（:240、:241）从不 clear（页面里正确，node 宿主里致命）。宿主改为传入**受跟踪的 setInterval**，收集句柄，测试末尾对每个 env 调 `stopTimers()` 全部 clearInterval，再 `process.exit(fail?1:0)`。

修后复跑（2026-10-11 10:31，verify.js hash E73072D2）：
```
PASS first visit mode is gate / applies infinity-gate / reveals after >= 3s / clears the gate class after reveal / marks the session visited / does not redirect
PASS internal navigation mode is internal / applies infinity-nav / is not a gate / reveals quickly
PASS worker failure redirects to /404 / keeps the gate class
12/12 passed
EXIT=0
```
残留自查（Get-CimInstance，模式串动态拼接以免自匹配）：
```
NO_RESIDUAL_gate-test
NO_NODE_RESIDUAL_for_gate-test_or_sea-exe-smoke
# 全部 node.exe = HBuilderX 自身 6 个 + 其它任务的 build/release.js、make-setup.mjs，均与本测试无关
# 同一过滤器只命中 DSH Desktop.exe / 一个 powershell.exe，二者 CommandLine 只是文本里提到文件名，isNode=False
```

## 7.3 F4 Infinity File Manager/bench/sea-exe-smoke.mjs —— 结论：可在脚本侧修复

修前退出码：**-1073740791**（0xC0000409），载荷 `ok:true`，stderr：
`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94`。历史（work/ifm-sea-report.md，node v22）同一脚本 exit 0。

根因（最小复现已定位到全局 fetch/undici，而非产品）：用临时探针脚本（已删除）对同一 ifm_gui.exe 逐项二分——

| 探针场景 | 退出码 |
| --- | --- |
| spawn exe + 等 URL + kill + process.exit（不 fetch） | 0 |
| spawn + 1 次 fetch('/') + kill + exit | 0 |
| spawn + fetch('/') + fetch('/api/list') + fetch('/api/info') + kill + exit（≥2 次 JSON fetch，无停顿） | **-1073740791** |
| spawn + 仅两次 JSON fetch + kill + exit | **-1073740791** |
| 同上 + 退出前等 500 ms | 0 |
| 三个请求改用 node:http（不用 fetch）+ kill + exit | 0 |

结论：node v24 全局 fetch（undici）的 keep-alive 套接字仍在拆除时调用 `process.exit()` 触发 libuv 断言；与 ifm_gui.exe/PRODUCT 无关，属测试宿主与运行时交互问题，**可在脚本侧规避**。

修法（仅改 bench/sea-exe-smoke.mjs）：① 三个 loopback 请求改用 `node:http`（无 undici 连接池可拆）；② `stopChild()` 先 kill 再等 `exit/close` 并 destroy stdio，之后才 `process.exit`。

改后退出码：**0**（连续 3 次 + 修版本断言后再 2 次，均 exit 0，载荷 ok:true）。

附带发现（本轮复跑才暴露，已修）：产品 `/api/info` 现在返回 `v1.0.0-pre5`（10-06 时为 `v1.0pre5`），脚本硬编码旧串导致 `ok:false` exit 1。已改为从仓库 `version.json` 的 `version` 派生 `EXPECTED_INFO_VERSION = 'v'+version`，复跑 exit 0，避免下次改名再次失效。这不是崩溃回归，是版本串漂移。

残留自查：`NO_PRODUCT_EXE_RESIDUAL`（无 ifm_gui.exe/int.exe/iim.exe 残留），`sea-exe-smoke` 无 node 残留。

## 7.4 新增 IPM / IIM / INT 纯离线自测入口

| 产品 | 新增入口 | 命令 | 退出码 | 通过 | 说明 |
| --- | --- | --- | ---: | ---: | --- |
| IPM | InfinityPackageManager/tools/data-consistency.test.mjs | `node 'InfinityPackageManager\tools\data-consistency.test.mjs'` | 0 | 31/31 | 纯离线读盘：applist/url/registry/pak/settings/.ipm-versions 之间的真实一致性（count≈packages≈stats.pkgCount、url 前缀/文件名/标签、applist 每条 URL 都能在 url.json 资产里找到、资产数=stats.fileCount、release 数=stats.releaseCount、registry 与 .ipm-versions 同名同版且都是 applist 真实构建、lang/ 至少一个 .lang） |
| IIM | cpp/apps/iim/iim-offline.test.mjs | `node 'cpp\apps\iim\iim-offline.test.mjs'` | 0 | 6/6 | IIM 数据面全部联网（实测：无 token → "not signed in"；带 token → "not signed in (HTTP 401)"），唯一无 token 可跑的 CLI 是 `iim --paths`；再加 IIM 写/读的安装记录格式（main.cpp writeRecord 的 11 个字段、category=product、sha256:64hex、size>0、installedAt 可解析）对 bench/tmp/scan 下 **200 条真实记录**逐条校验 |
| INT | cpp/apps/int/int-offline.test.mjs | `node 'cpp\apps\int\int-offline.test.mjs'` | 0 | 9/9 | 把 LOCALAPPDATA 指向 `cpp/apps/int/_bench/root` 夹具后跑 CLI 面（无窗口）：`int --paths`、`int plugin list`（读到 FastBrowser 1.0.0 installed）、`int plugin verify FastBrowser`（`verified 2 entries` + sha256）；再校验插件记录格式。全程离线、不安装 |

说明：仓库中不存在名为 "Infinity Installer Manager"/"Infinity Toolbox" 的产品目录；IIM/INT 的产品树即 `cpp/apps/iim`、`cpp/apps/int`，故入口放在各自产品目录下（write scope 中那两个目录名不存在）。

## 7.5 本轮改动文件（SHA256 前 16 位 / 大小 / 修改时间）

| 文件 | hash(16) | 大小 | mtime |
| --- | --- | ---: | --- |
| work/gate-test.mjs（F3 修复） | 4FACF949F0A5A1D7 | 7023 | 10-06 20:24 |
| Infinity File Manager/bench/sea-exe-smoke.mjs（F4 修复 + 版本派生） | A54A0ED8261A7E36 | 4734 | 10-11 10:32 |
| InfinityPackageManager/tools/data-consistency.test.mjs（新增） | 632AEFFDAF25322A | 7313 | 10-06 21:03 |
| cpp/apps/iim/iim-offline.test.mjs（新增） | C50246A01B6CFD08 | 3987 | 10-11 10:30 |
| cpp/apps/int/int-offline.test.mjs（新增） | 4D02360AA927FE10 | 3276 | 10-11 10:30 |
| web/infinity/assets/verify.js（只读，未改） | E73072D28A1ACE53 | 9679 | 10-06 16:11 |
| shell/verify-contract.mjs（Lead 修复） | 6FE0ECCD4BAC4B97 | 5544 | 10-06 20:08 |
| work/account-static-check.mjs（Lead 修复） | 995F00BCCE0B8661 | 4902 | 10-06 20:12 |
| version.json（只读，版本基准） | 546C364D80551996 | 513 | 10-06 09:27 |

## 7.6 遗留

1. F3/F4 均已修复并复跑通过，无残留进程；原报告五-1 提到的 pwsh-132 已确认不存在。
2. IIM 真正的数据面（catalog/install/remove）无法离线跑，需有网/需 token；本轮以 `iim --paths` + 安装记录格式契约覆盖，属"可离线部分"，已如实标注。
3. IPM 新增的是数据一致性检查，不执行 IPM 二进制；IPM 的下载/安装路径仍属网络与安装类，按禁令不跑。
4. `work/gate-test.mjs`、`sea-exe-smoke.mjs` 的断言均以现行实现/版本基准为准；若 verify.js 的 class/内部导航语义或 version.json 再次变化，脚本会如实报 FAIL 而不是静默通过。
5. 仍未运行：cpp `store_smoke/store_collision`（需 token）、IPM release/verify+chk-apps（需网络+token）、bootstrap-test（需下载）、work/smoke-pages、dl-render-test（需网络）、verify-archive（history/ 禁令）、itbt e2e（安装类）。
