# INC 流式预览并入正式源码树 —— 验收报告（task-3）

日期：2026-10-06 08:30–08:50（Asia/Shanghai）  负责人：lead（原 owner inc-merge 中途失联，已改派）

## 结论

流式预览已经从 `Infinity Cloud/preview`（离树）正式落到 `cpp/apps/inc` 源码树，树内代码可独立编译，
编译产物包含全部预览路由与页面标记，完整验收 `run-tests.ps1 -With8s` 通过：

```
RESULT failures=0 wire=0 harnessCompile=0 ui=0 apply=0 verify-hello.txt=0 verify-stored.txt=0 fixtures=0 appCompile=0 verify-data.bin=0 harness=0
exit=0
```

## 一、树内改动（sha256 前后对照）

| 文件 | 改动前 sha256 | 改动后 sha256 | 字节 |
| --- | --- | --- | --- |
| `cpp/apps/inc/main.cpp` | `ad9c8e18527fbdbc2cb37a5a3b23a826aea38c7fb0c5ef533029e5d3fc604da0` | `943df724dc74392e02a2bf6a2ca5594d764aec145f723b90bd11b7ebe68a14ea` | 41,338 → 50,781 |
| `cpp/apps/inc/ui.hpp` | `0cf91dc72608dd1de5496658efe21c46a988ea5c5a30c8af9fcd36a3b1f211ec` | `47b696d8077e56e934afaa2cacb1e674cdaee48e8a16606d32f9c17538cd9115` | 20,209 → 38,082 |
| `cpp/apps/inc/preview.hpp` | （树内旧副本） | `b93fe348492be855a287363e7ac7852962e79f1b935e953395cf45f33c0606cd` | 26,554 |

5 处插入（`generated/main.cpp`、`generated/ui.hpp` 与树内文件逐字节一致）：

1. `main.cpp:28` `#include "preview.hpp"`（+1）
2. `main.cpp:439` 预览路由：`/api/preview/meta`、`/chunk`、`/zip`、`/zip/entry`、`POST /cancel`（+178）
3. `ui.hpp:88` 预览面板标记（+10）
4. `ui.hpp:197` 预览样式（+15）
5. `ui.hpp:471` 预览模块 JS（+391）

## 二、顺带修掉的两个真实缺陷

### 1. `apply-preview.mjs` 不幂等（已修）

原实现每次都无条件插入：第二次 `--write` 会**把同一段代码再插一遍**（实测 main.cpp 涨到 60,214 B、ui.hpp 涨到 48,014 B）。
修法：插入前检查目标位置是否已经存在**完全相同的代码块**（`before` 类插入向前看、`after` 类向后看），命中即报
`= <edit> already applied` 并跳过；全部命中时不写 `generated/`、不动 `preview.patch`，输出
`the tree already contains the preview patch (5/5 insertions in place); preview.patch left untouched`。

实测：树已打完补丁后再跑 `--write`，5/5 全部识别为已应用，`main.cpp`/`ui.hpp`/`preview.patch` 的 sha256 与 mtime 均不变。

### 2. `run-tests.ps1` 起 range server 失败（已修）

本机进程环境里同时存在 `NO_PROXY` 与 `no_proxy` 两个大小写不同的键，PowerShell 5.1 的 `Start-Process`
在把环境变量拷进大小写不敏感的字典时抛 `已添加项。字典中的关键字:“NO_PROXY”所添加的关键字:“no_proxy”`，
于是 `$proc` 为 `null` → `range server pid ` 为空 → `server never printed LISTENING` → exit 3。
这与本次补丁无关（同样是这批测试，昨天通过、今天失败，差异只在环境）。
修法：新增 `Start-RangeServer` helper，先走 `Start-Process`，失败则用 `System.Diagnostics.ProcessStartInfo`
经 `cmd.exe /c ""<node>" <args> > out 2> err"` 启动（同样落盘 server.out/server.err，`taskkill /PID ... /T` 仍能整棵杀），
断言逻辑一行未动。

## 三、编译验证（树内代码，不依赖 generated/）

```
node cpp\tools\build.mjs inc
built ...\cpp\build\inc.exe  1559552 B
  dependencies: Windows only
inc  Infinity Cloud  6 names  1559552 B  Windows dependencies only
done.  ...\cpp\out\<app>        exit=0
```

产物：`cpp/build/inc.exe` 1,559,552 B（Windows 依赖），`cpp/out/inc/` 下 `inc_cli.exe`/`inc_gui.exe`/`inc_launcher.exe`。
二进制字符串检查：`/api/preview/meta`、`/api/preview/chunk`、`/api/preview/zip/entry`、`/api/preview/cancel`、`pvFollow` 全部存在。

## 四、回滚

```powershell
Copy-Item 'Infinity Cloud\preview\_merge-backup\main.cpp' 'cpp\apps\inc\main.cpp' -Force
Copy-Item 'Infinity Cloud\preview\_merge-backup\ui.hpp'   'cpp\apps\inc\ui.hpp'   -Force
node cpp\tools\build.mjs inc
```

备份目录同时留有 `_merge-backup\before.json`（改动前 sha256/尺寸/时间）。

## 五、遗留

- `preview.patch`（635 行）在树已打补丁的情况下**不再重新生成**；如需给另一份干净树打补丁，先回滚到改动前再跑 `--write`。
- INC 的应用内真人预览尚未做（只有本机 loopback 的 GUI 面）；v1.0pre5 的图标/打包（task-31）仍未做。
- 归档同步：`history/history.jsonl` 现为 289162947 B / 26389 条目 / 98 块（实时会话日志按增量分片自动追加）。

## 六、应用级 e2e 的限制（如实记录）

直接运行树内产物 `cpp/out/inc/inc_gui.exe --port=39190` 时程序立即退出并打印：

```
not signed in - set gittoken_zssx-2026_1 (or EV_GH_TOKEN) first.
```

即 INFINITY CLOUD 的 GUI 面需要 GitHub 令牌才能起服务，因此"真进程起 HTTP 打预览路由"这条端到端需要凭据，本轮未做（不猜测、不搜集令牌）。
替代证据：`generated/main.cpp` 与树内 `cpp/apps/inc/main.cpp` **逐字节一致**（sha256 `943df724…`），而验收脚本正是编译并真实跑这份代码
（真 HTTP range server + 真 g++ 产物），`RESULT failures=0` 已覆盖全部预览路由与 UI 行为。