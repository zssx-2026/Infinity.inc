# 第 12 轮：IIM 摘除收口与窗口面 stdout 修复

时间：2026-10-17 · 工作区 `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc`

## 一、IPM 目录数据被 IIM 摘除带崩（真事故，已修）

终验 `ipm-data` 从 31/31 掉到 **26/31**，五项断言同时失败：

```text
FAIL applist count matches packages.length          {"count":28,"len":27}
FAIL applist stats.pkgCount matches packages.length {"pkgCount":28,...,"fileCount":37,...}
FAIL url.json release count matches stats.releaseCount {"releases":4,"stat":5}
FAIL snapshot asset count matches stats.fileCount   {"assets":30,"stat":37}
FAIL every applist version URL has a snapshot asset (5 个 pre5 安装包 URL 无对应资产)
```

根因：五个 `Infinity*_1.0.0-pre5_win64_setup.exe` 在 IPM 目录里挂在 `application-inc` 这个
release 下；摘除 IIM 时整份 `url.json` 被重写，连带丢掉了这个 release，`applist.json` 的
`count` / `stats.pkgCount` / `stats.releaseCount` / `stats.fileCount` 四个字段却仍是旧值。

修法：
1. 按磁盘重建 `application-inc` release（6 个资产：5 个安装包 + name.txt，size 取 applist 口径
   514535 / 238305 / 268383 / 288313 / 296537 / 499，与 `applist.json` 逐字节一致）；
2. 首版照抄了兄弟 release 的 `id` / `name` / `publishedAt` 而那是伪造元数据 —— 立即改成真实值
   （`name: application-inc`、`prerelease: true`、`publishedAt` 取 InfinityCloud 的
   `2026-10-06T01:34:24.624Z`、删掉 `id` 与不属于它的 `nameTxt`）；
3. `count` / `stats.*` 改为按数组实算：pkgCount=27、releaseCount=5、fileCount=36。

结果：`InfinityPackageManager\tools\data-consistency.test.mjs` **RESULT: PASS 31/31**；
`applist.json` 22,767 B、`url.json` 27,325 B。

**教训**：这类"统计字段 + 数组"的双写结构，删条目必须同步重算统计，否则断言全红；
补数据时不能照抄邻居的元数据字段，那会把伪造值写进目录。

## 二、窗口面启动器吞掉 stdout（真 bug，已修）

现象：布局里的 `ifm_gui.exe` 启动后什么都不打印，bench 冒烟报
`the exe did not print a loopback url`；而直接用 `node.exe app.cjs` 设
`INFINITY_EXE_NAME=ifm_gui.exe` 却正常打印 `Infinity File Manager UI http://localhost:7623/`。
→ 程序没问题，是 49 KiB 启动器把输出丢了。

根因：`work\jslayout\launcher.cpp:125` 的 `CreateProcessW(NULL, cmd, NULL, NULL, TRUE,
flags, NULL, NULL, &si, &pi)` 从未给 `si` 设 `STARTF_USESTDHANDLES` 与三个 `hStd*`；窗口版
`flags = CREATE_NO_WINDOW`，子进程既无控制台又无继承句柄 → 输出全部丢弃。

修法（launcher.cpp，重编两个启动器）：

```cpp
HANDLE inH  = GetStdHandle(STD_INPUT_HANDLE);
HANDLE outH = GetStdHandle(STD_OUTPUT_HANDLE);
HANDLE errH = GetStdHandle(STD_ERROR_HANDLE);
if (inH != INVALID_HANDLE_VALUE && outH != INVALID_HANDLE_VALUE && errH != INVALID_HANDLE_VALUE) {
    si.dwFlags |= STARTF_USESTDHANDLES;
    si.hStdInput = inH; si.hStdOutput = outH; si.hStdError = errH;
}
```

编译：`g++ -O2 -s -static -Wl,--subsystem,console`（console 面）与
`-mwindows -DCHILD_NO_WINDOW -Wl,--subsystem,windows`（window 面），两版各 49,152 B、rc=0。
重跑 `build-layout.mjs` 后 `ifm_gui.exe` stdout 恢复为
`Infinity File Manager UI  http://localhost:7623/`；bench `sea-exe-smoke.mjs` rc=0，
`pageStatus 200 / pageBytes 20666 / hasPreviewOverlay true / listedEntries 79`。

**教训**：`CREATE_NO_WINDOW` 必须配合 `STARTF_USESTDHANDLES`，否则无窗口 = 无输出。

## 三、验收工具里的写死数字（三处，已全部改为跟随清单）

| 工具 | 原写死 | 现取值 |
| --- | --- | --- |
| `work\ghsync-validator-test.mjs` | `assets: 6` | `assets: 5`（读 `release-assets.json`） |
| `work\jslayout\verify-layout.mjs` | 断言窗口面 stdout 必须为空 | 断言 stdout 必须传回调用者（含 exe 名） |
| `work\final-acceptance.mjs` | `LAYOUT-VERIFY 34/34  PASS` | `LAYOUT-VERIFY 35/35  PASS`（新增一项） |

`verify-layout.mjs` 的窗口面断言语义同时翻转：原断言"窗口面不借控制台，输出只能读文件"是
bug 的另一面 —— 安装器、脚本、计划任务都会从控制台拉起窗口面，输出必须能回到调用者；
探针文件仍照写，作为完全无控制台时的兜底。

## 四、发布门槛

`node work\publish-preflight.mjs --skip-remote` → `PUBLISH-PREFLIGHT PASS technical=7/7
ready=false tag=v1.0.0-pre5`（`docs-hash-coverage` 由 FAIL 转 PASS）。仍缺两道门：
`EV_GH_TOKEN` 与 `work\_publish-approval.txt`。
## 五、终验收口（2026-10-17）

`node work\final-acceptance.mjs` → **FINAL-ACCEPTANCE PASS 26/26**，exit 0。
上轮遗留的两项 FAIL 均已消除：`ghsync-validator`（写死 `assets: 6` → 读清单得 5）与
`js-layout`（窗口面断言翻转后 35/35）。

| 项 | 耗时 | 项 | 耗时 |
| --- | ---: | --- | ---: |
| inc-preview | 111.7s | infinitystudio | 18.5s |
| nsi-selftest | 6.7s | js-layout | 3.8s |
| gate-test | 9.5s | sync-e2e | 2.7s |
| archive-selfcheck | 9.9s | ipm-data | 0.1s |

`work\INDEX.md` 155 行 / 13,211 B，`gen-index --check` rc=0。
## 六、旧 SEA 单文件目录退役（1.36 GiB）

`work\sea-out-prune.mjs` 的计划确认：三处 `build/out/win-x64` 是死重（该目标已有
`build/layout/win-x64`，make-setup 走布局不再回退），其余六个平台（darwin-arm64 /
darwin-x64 / linux-arm64 / linux-x64 / win-arm64 / win-ia32）没有布局，仍是安装器载荷的
唯一来源，必须保留。

| 产品 | 退役字节 | 去向 |
| --- | ---: | --- |
| ifm | 484,730,880 | `work\_retired-sea-out\ifm-win-x64` |
| inc | 484,598,784 | `work\_retired-sea-out\inc-win-x64` |
| ipm | 485,833,728 | `work\_retired-sea-out\ipm-win-x64` |
| 合计 | 1,455,163,392（1,388 MiB） | 同盘 rename，瞬时可还原 |

执行时宿主空闲内存仅 1.34 GiB 且前台有游戏进程，所以**没有走删除**：三个目录整体 rename
到 `work\_retired-sea-out\`（同盘重命名，零拷贝、零内存压力、随时可还原）。

退役后复核：`ipm-nsi-check` PASS、`shell\verify-contract.mjs` SELFTEST PASS —— 载荷解析
未受影响。同时把两处仍在描述旧路径的注释改写（IFM `make-setup.mjs` 的窗口面说明、
`bench\sea-build-local.mjs` 的输出说明），两份 `node --check` rc=0。