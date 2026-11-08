# prod-ing / task-24 运行队列（受控窗口执行单）

状态：**等待 Lead 在“受控窗口”统一执行**。本文件由 prod-ing 编写；执行者按顺序跑，回填 §11。
范围：只跑 Infinity Games（ING）。构建用 `-j 2`，不与其它成员的重构建并发。

## 0. 前置条件

- 源码（本次候选，已冻结）：`cpp/apps/ing/main.cpp`
  - 49,940 B，mtime 2026-10-04 20:39:32，sha256 = `948A8B4852570045...`（§11 回填完整值）
  - 工作树 vs HEAD：261 insertions / 47 deletions（含第三方 unblock hunk，见 report §3 diff 摘要）
- 基线二进制（我已备份，无需重建基线源码）：
  - `cpp/apps/ing/perf/artifacts/ing-baseline-2026-10-04T1916.exe`，606,720 B，sha256 前16 = `DE3189FFD3264D51`
  - 所有 before 数字都是它测出来的（report §2.1）。
- 测量脚本：`cpp/apps/ing/perf/` 下 bench.ps1 / dirwalk.ps1 / unblock-evidence.ps1 / check-static.mjs
- 约束：不启动浏览器/Electron/WebView2/宿主；ING 的 `--serve-ui` 只监听 127.0.0.1 环回，不创建窗口（CreateNoWindow=true, UseShellExecute=false）。清理只按本队列列出的 PID（先打印命令行），禁止按进程名批量杀。

## 1. 冻结校验（只读，可先跑）

`@powershell
$env:NODE_OPTIONS=''
(Get-FileHash 'cpp/apps/ing/main.cpp' -Algorithm SHA256).Hash
(Get-Item 'cpp/apps/ing/main.cpp').Length
(Get-FileHash 'cpp/apps/ing/perf/artifacts/ing-baseline-2026-10-04T1916.exe' -Algorithm SHA256).Hash
node cpp/apps/ing/perf/check-static.mjs cpp/apps/ing/main.cpp
`@

期望：main.cpp 与基线 exe 的哈希与 §0 一致；check-static 输出 `all static checks passed (24)`、exit 0。
若源码哈希不符 → **停止，不要构建**，回报 Lead。

## 2. 构建（控制台，无窗口）

`@powershell
$env:NODE_OPTIONS=''
Copy-Item cpp/build/ing.exe "$env:TEMP\ing-before-build.exe" -Force   # 以防 ninja 之前又有人改过
ninja -C cpp/build -j 2 ing
(Get-Item 'cpp/build/ing.exe').Length
(Get-FileHash 'cpp/build/ing.exe' -Algorithm SHA256).Hash
`@

期望产出：新的 exe 字节数 + sha256（回填 §11 的 exe 行）。
判定：@ninja` 退出码 0（core/common 的既存告警不影响判定）；exe 字节预期在 606,720 附近（+3~6 KB 量级）。
失败处置：任何编译/链接错误 → 停，把完整错误贴回 task-24，**不要**改源码；回滚方式见 §10。

## 3. 功能验证（CLI，控制台，无窗口）

`@powershell
$env:LOCALAPPDATA="$env:TEMP\ing-bench-worker\LocalAppData"
$ing = 'cpp/build/ing.exe'
& $ing --version
& $ing list
& $ing info game-0001
& $ing run game-0007        # 文件故意不存在：期望退出码 1，且不启动任何 UI
"run-missing exit=$LASTEXITCODE"
`@

期望：--version 打印一行版本且 exit 0；list 行数与库内游戏数一致；info game-0001 exit 0；run game-0007 exit 1 且打印原因；无残留进程（§9）。

## 4. CLI 计时（控制台，无窗口；before/after 同 harness）

`@powershell
$env:LOCALAPPDATA="$env:TEMP\ing-bench-worker\LocalAppData"
$p = @{ Exe=(Resolve-Path 'cpp/build/ing.exe').Path; DataRoot="$env:TEMP\ing-bench-worker" }
powershell -NoProfile -File cpp/apps/ing/perf/bench.ps1 @p -Scenario list -Count 0     -Reps 5
powershell -NoProfile -File cpp/apps/ing/perf/bench.ps1 @p -Scenario list -Count 500   -Reps 5
powershell -NoProfile -File cpp/apps/ing/perf/bench.ps1 @p -Scenario list -Count 2000  -Reps 5
powershell -NoProfile -File cpp/apps/ing/perf/bench.ps1 @p -Scenario list -Count 10000 -Reps 5
powershell -NoProfile -File cpp/apps/ing/perf/bench.ps1 @p -Scenario info -Count 2000  -Reps 5
powershell -NoProfile -File cpp/apps/ing/perf/bench.ps1 @p -Scenario run-missing -Count 2000 -Reps 5
powershell -NoProfile -File cpp/apps/ing/perf/bench.ps1 @p -Scenario version -Reps 5
`@

期望产出：每条命令一行 JSON（含 samplesMs / medianMs / exitCode）。回填 §11。

## 5. 窗口面指标（--serve-ui，环回，无窗口）

`@powershell
$p = @{ Exe=(Resolve-Path 'cpp/build/ing.exe').Path; DataRoot="$env:TEMP\ing-bench-worker" }
powershell -NoProfile -File cpp/apps/ing/perf/bench.ps1 @p -Scenario serve -Count 0     -Reps 5
powershell -NoProfile -File cpp/apps/ing/perf/bench.ps1 @p -Scenario serve -Count 500   -Reps 5
powershell -NoProfile -File cpp/apps/ing/perf/bench.ps1 @p -Scenario serve -Count 2000  -Reps 5
powershell -NoProfile -File cpp/apps/ing/perf/bench.ps1 @p -Scenario serve -Count 10000 -Reps 5
`@

期望产出：每行 JSON 含 listenMedianMs / firstFrameMedianMs / routeMedianMs / routeBytes / privateWorkingSetIdleMedianMB。
判定标准：
- @10000 `/api/games` 中位数 ≤ 220 ms（before 342.16）→ PASS
- @10000 `/api/state` 中位数 ≤ 125 ms（before 176.45）→ PASS
- @10000 UI 首帧 ≤ 560 ms（before 717.43）→ PASS
- @10000 空闲 PWS ≤ 3.5 MB（before 2.113；缓存常驻允许上升）→ PASS；> 3.5 MB 视为 C2 代价不可接受，见 §10
- @10000 `/api/games` 字节 ≈ 1.4~1.7 MB（before 2,323,299，紧凑 JSON）→ 记录即可
- N=0 / 500 / 2000 不得出现比 before 差 15% 以上的指标（缓存的首次成本要小）

## 6. 启动目录清扫成本（dirwalk）

`@powershell
powershell -NoProfile -File cpp/apps/ing/perf/dirwalk.ps1 -Exe cpp/build/ing.exe -Reps 5 -TopFiles 2000 -SubDirs 100 -FilesPerSub 10
`@

期望：3,001 文件目录里 --version 中位数从 before 89.30 ms 降到 ~36 ms（≈ selfonly 变体实测值）；空目录两组都在 12~20 ms。
判定：3,001 文件目录中位数 ≤ 55 ms → PASS。

## 7. unblock 延迟清扫与 24h 标记（6/6 流消失 + 不重复扫）

`@powershell
powershell -NoProfile -File cpp/apps/ing/perf/unblock-evidence.ps1 -Exe cpp/build/ing.exe -Root "$env:TEMP\ing-unblock" -WaitMs 7000
`@

它自建目录、复制 ing.exe、给 7 个文件（6 个在 2 层内 + ing.exe 自身 + 1 个故意放在第 3 层）打 Zone.Identifier，然后跑三次 `--serve-ui`（17910/17911/17912 端口，避免同端口重绑假象），只杀自己启动的 PID。

判定（脚本会打印 `verdict: A=True B=True C=True`）：
- **A 全新环境**：6 个目标文件 + ing.exe 的标记全部消失（left=1，剩下的正是第 3 层的 g.dat，证明 maxDepth=2 语义未变）；`.infinity-unblocked` 存在且内容是 UTC 时间戳；exeMark=0 证明 `unblockSelf()` 仍然同步。
- **B 标记新鲜**：仅 ing.exe 的标记被清（exeMark=0），6 个文件仍带标记 → 证明 24h 内不重复扫。
- **C 标记回拨 2 天**：6/7 再次被清 → 证明到期会重扫。
- 三次的 `aliveAfterWait` 必须为 True（若 False，说明端口被占或进程秒退，该次无效）。

## 8. 行为回归（JSON 契约，不受缩进影响）

起两次窗口实例（基线与候选），curl 两个接口，比较**语义**快照，再停掉：

`@powershell
$env:LOCALAPPDATA="$env:TEMP\ing-bench-worker\LocalAppData"
function Sample([string]$exe, [int]$port, [string]$tag) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = (Resolve-Path $exe).Path
  $psi.Arguments = '--serve-ui --port=' + $port
  $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  try {
    Start-Sleep -Seconds 3
    $g = (curl.exe -s ("http://127.0.0.1:{0}/api/games" -f $port)) | ConvertFrom-Json
    $s = (curl.exe -s ("http://127.0.0.1:{0}/api/state"  -f $port)) | ConvertFrom-Json
    $rows = $g.games | ForEach-Object { '{0}|{1}|{2}|{3}|{4}' -f $_.name, $_.kind, $_.ready, $_.host, $_.path }
    Set-Content "$env:TEMP\ing-contract-$tag.txt" ($rows -join [char]10) -Encoding UTF8
    "tag=$tag games={0} state={1}" -f $g.games.Count, ($s | ConvertTo-Json -Compress)
  } finally {
    if (-not $p.HasExited) { $p.Kill(); $p.WaitForExit(5000) | Out-Null }
    $p.Dispose()
  }
}
Sample 'cpp/apps/ing/perf/artifacts/ing-baseline-2026-10-04T1916.exe' 17930 'before'
Sample 'cpp/build/ing.exe' 17931 'after'
(Get-FileHash "$env:TEMP\ing-contract-before.txt" -Algorithm SHA256).Hash
(Get-FileHash "$env:TEMP\ing-contract-after.txt" -Algorithm SHA256).Hash
`@

期望：两个哈希**相同**（折叠排序不变、字段值不变）；games 条数与库规模一致。
若不同 → 用 `Compare-Object (Get-Content before) (Get-Content after)` 看差异，判定行为回归，按 §10 回滚 C3。
（可选，Lead 自定）成功路径 `& $ing run game-0001` 会用 ShellExecute 拉起 UI，属产品自身；如要跑，跑完按 PID+命令行核对再清理。

## 9. 残留核对与清理（严格按 PID）

`@powershell
Get-CimInstance Win32_Process | Where-Object {
  $_.ExecutablePath -like '*\cpp\build\ing.exe' -or
  $_.ExecutablePath -like '*\ing-unblock\ing.exe' -or
  $_.ExecutablePath -like '*ing-baseline-2026-10-04T1916.exe' -or
  $_.CommandLine   -like '*cpp\apps\ing\perf*'
} | Select-Object ProcessId, Name, ExecutablePath, CommandLine | Format-List
`@

- 先**打印完整命令行**，确认每条都在本队列范围（cpp/build/ing.exe、%TEMP%\ing-unblock\ing.exe、备份的基线 exe、本队列脚本）。
- 只对确认后的 PID 执行 `Stop-Process -Id <pid> -Force`（需要连子进程时 `taskkill /T /F /PID <pid>`）。
- **禁止**按进程名批量杀 msedge / msedgewebview2 / chrome / explorer / SearchHost / fastbrowser。
- 跑完后重跑查询，期望**空结果**；并确认端口无监听：`Get-NetTCPConnection -State Listen | Where-Object LocalPort -ge 17000`。

## 10. 回滚方式（判定失败时）

- C1（compareFolded）→ 恢复 `return lower(a.name) < lower(b.name);`
- C2（库缓存）→ 删除 LibraryCache 与缓存分支，恢复每次 readTextFile+parse
- C3（直接序列化）→ 恢复 gameRowJson/gamesJson（Json 树 + dump(2)）
- C4（延迟清扫）→ 恢复 main() 里同步的 `inc::unblockSelfDirectory(2);`
四处相互独立，可单独回滚；回滚后必须重跑 §1 静态检查 + §2 构建 + 对应指标。源码未提交 git，交付以工作树为准；直接在 task-24 里说“回滚 Cx”即可（我在写作用域内改）。

## 11. 回填表（执行者填写）

| 项 | before（实测，2026-10-04） | after（受控窗口） |
| --- | --- | --- |
| main.cpp sha256 前16 | 948A8B4852570045 | — |
| exe 字节 | 606,720 | |
| exe sha256 前16 | DE3189FFD3264D51 | |
| --version（空目录）ms | 13.71 | |
| --version（3,001 文件目录）ms | 89.30 | |
| list @0 / 500 / 2000 / 10000 ms | 13.41 / 17.41 / 34.41 / 126.15 | |
| info @2000 ms | 28.21 | |
| run-missing @2000 ms | 26.89（exit 1） | |
| serve listen @10000 ms | 41.92 | |
| UI 首帧 @0/500/2000/10000 ms | 224.41 / 283.09 / 354.71 / 717.43 | |
| /api/games @0/500/2000/10000 ms | 1.68 / 16.53 / 63.81 / 342.16 | |
| /api/state @0/500/2000/10000 ms | 1.98 / 11.39 / 34.32 / 176.45 | |
| 空闲 PWS @10000 MB | 2.113 | |
| /api/games 字节 @10000 | 2,323,299 | |
| unblock 证据 A/B/C | — | |
| 语义快照哈希一致 | — | |
| 残留进程 | 0 | |

## 12. 预计耗时与网络

- 构建 1~3 min；CLI 计时 2~4 min；窗口面 20~30 min（每个样本起停一个进程，@10000 的 5 次占大头）；dirwalk 约 3 min；unblock 证据约 40 s；回归约 10 s。
- 合计 **约 30~45 min**。
- 联网：**无**。全部走 127.0.0.1 环回；合成库里的 https://example*.example.com 只做语法/主机名校验（checkAddress 不发请求）。
- 依赖：本机已有 node / ninja / curl.exe。

## 13. 我在受控窗口之前不做任何运行

本文件只描述“跑什么”。在 Lead 执行前我不启动编译/进程；我这边剩余只有静态工作（报告校对、脚本静态语法检查）。
