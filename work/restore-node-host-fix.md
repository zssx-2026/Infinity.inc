# restore-history.ps1 调不起 node：宿主静默吞掉原生进程（2026-10-17）

## 一、现象

`node work\sync-e2e-test.mjs` 从 PASS 变成 FAIL，三处告警：

```
restore produced no summary (exit 1): ... chunk 0 brotli decode failed exit=
restore exit=1
restored session.v4.jsonl missing
```

注意 `exit=` 后面什么都没有——`$LASTEXITCODE` 是空的。同一份 brotli 解包脚本用 node 直接跑
完全正常（手写复现 `rc=0`、`len=3435`），所以不是数据问题，是**调用没发生**。

## 二、根因链（三层，逐层排除）

### 第 1 层：`node` 不在 PATH
- `ps Get-Command node` → rc=1，无输出。脚本默认 `[string]$NodeExe = 'node'`，
  于是第一次解包直接 `CommandNotFoundException`。
- 修：在路径归一化之后做一次解释器解析，依次找工作区自带运行时、
  `D:\program\nodejs\node.exe`、`$env:ProgramFiles\nodejs\node.exe`、
  `$env:SystemDrive\program\nodejs\node.exe`；仍找不到就带着名字抛错。
- 坑：解析块一开始插在 `$repoRoot` 赋值**之前**，而 `$env:ProgramFiles` 在受限宿主里是空串，
  `Join-Path` 收到空参数直接 `ParameterArgumentValidationErrorNullNotAllowed`。
  必须放在 `$repoRoot` 之后，并且每个候选都判空。

### 第 2 层：`& $exe ...` 在无 stdio 的宿主里是空操作（真正的主因）
- 补齐 PATH 后错误变成 `chunk 0 brotli decode failed exit=`（退出码为空）。
- 对照实验（同一台机器、同一 PowerShell）：

| 调用方式 | 结果 |
| --- | --- |
| `& 'C:\Windows\System32\whoami.exe'` | 无输出（**连 whoami 都跑不出来**） |
| `& 'D:\program\nodejs\node.exe' -e ...`（写文件） | 文件不存在，rc=0 |
| `cmd /c ...` | `CommandNotFoundException: cmd` |
| `Start-Process -Wait -PassThru -NoNewWindow` | 文件写出，成功 |

  结论不是 node 的问题：这个宿主下 PowerShell **直接调用任何原生 exe 都被静默丢弃**，
  而 `Start-Process -Wait` 这条路径仍然可用。受影响的场景包括定时任务（无交互会话）
  和被 `execFileSync` 拉起的 PowerShell（管道 stdio 交给父进程）。
- 修：新增 `Invoke-Node`，用 `Start-Process -FilePath $NodeExe -ArgumentList ... -Wait -PassThru
  -NoNewWindow -RedirectStandardError/-RedirectStandardOutput`，返回 `$p.ExitCode`；
  失败时把 stderr 回显出来再删除临时文件。调用点由
  `& $NodeExe $jsPath ...` 改为 `$rc = Invoke-Node $jsPath @(...)`。

### 第 3 层：PowerShell 续行符是反引号
- 首版 `Start-Process` 那行用 `\` 续行，PowerShell 把 `\` 当成实参，报
  `找不到接受实际参数"\"的位置形式参数`（PositionalParameterNotFound）。
- 改成反引号 `` ` `` 续行后正常。

## 三、验证

`node work\sync-e2e-test.mjs` → `SYNC-E2E-PASS`：

```
run1 action=appended changed=2 files=2 archive=4697
run2 action=appended changed=1 files=3
run3 action=up-to-date (expect up-to-date)
manifest uniquePaths=2 aliased=0 verifyFailed=0 bytes=277
restore sample=2 exact=2 mismatch=0 bytes=3435
restored session.v4.jsonl 3380 B sha efdf9b7a2995c73f (first version, manifest says efdf9b7a2995c73f)
real archive 301057052 B, real manifest sha a3157321f17e9699 (untouched)
```

`work\restore-history.ps1` 24,749 → **26,290 B**（UTF-8 带 BOM，PS 5.1 必需）。

## 四、可复用规则

- 任何被调度器或 `execFileSync` 拉起的 PowerShell 脚本，**不要用 `& $exe` 调原生程序**，
  一律走 `Start-Process -Wait -PassThru` 并显式重定向 stdio。
- PowerShell 脚本里的解释器路径不能只写 `node`：先 `Get-Command`，失败则回退到已知绝对路径。
- 引用 `$env:*` 前先判空，`Join-Path` 收到空参会直接抛参数绑定错误。
- PowerShell 续行用反引号，不是反斜杠。
- 诊断"某个子进程失败"时，先用 `whoami` 这类零依赖程序验证调用通道本身是否可用，
  再怀疑被调用的程序——本次若直接查 brotli 数据会白查很久。