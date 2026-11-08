# task-22 · Infinity Installer Manager · 待运行队列（prod-iim）

**状态：等待 Lead 批准。禁令期内（禁止 exe / 编译 / 浏览器 / 宿主 / 服务）不得执行本文件中的任何命令。**

产品：Infinity Installer Manager（UI 端口 7643）。改动已落在 `cpp/apps/iim/main.cpp`，并已在本轮禁令之前**成功编译**过一次
（`iim.exe` 727040 B，SHA256 CDF87B1298FE9DDDD6EBACC40E6EECFD255DD915C76D1CF542775EA5C4FE791F）。
报告：`work/perf-iim.md`（含全部 before 数据与原始输出）。

## 0. 先做的一步：重新编译测量工具

改动后我修改了 `cpp/apps/iim/bench/harness.cpp`（把唯一的建窗口基准 `benchPaint` 换成**无窗口**的 GDI 内存 DC 基准 `benchBrush`），
但按禁令**没有重新编译**，所以该文件目前是「静态可审查、未编译」状态。批准后第一步：

```
& cpp/apps/iim/bench/build.ps1        # 从仓库根目录运行；编译 runner.exe / harness_after.exe / harness_before.exe
```

注意 `build.ps1` 会从 `bench/baseline/main_before.cpp` 生成 `harness_before_gen.cpp`（改动前代码 + 同一份基准），
这是 before/after 可比的前提。若 `harness.cpp` 报编译错误，先修它再往下走。

## 1. 运行清单（全部无窗口）

| # | 命令 | 需要多久 | 它回答什么 | 窗口/清理 |
|---|---|---|---|---|
| 1 | `cpp/apps/iim/bench/runner.exe 5 cpp/apps/iim/bench/run/install/iim_gui.exe --version` | <1 s | 冷启动 ms 中位数 + 峰值私有工作集（仿真安装目录 5 个 exe） | runner 是控制台程序；子进程 CREATE_NO_WINDOW，打印版本后立即退出；runner 内 WaitForSingleObject + CloseHandle |
| 2 | `cpp/apps/iim/bench/runner.exe 5 cpp/apps/iim/bench/run/dirty/iim_cli.exe --version` | <1 s | 同一指标在 52 个候选文件的脏目录里（改动 B 的收益最大处） | 同上 |
| 3 | `cpp/apps/iim/bench/harness_after.exe real` | ~5 s | 安装计划生成 CPU（读本地 `bench/tmp/releases.json`，不联网） | 无任何建窗口代码（`benchPaint` 已删除）；跑完即退出 |
| 4 | `cpp/apps/iim/bench/harness_after.exe brush` | ~10 s | 每次擦除的 GDI 成本：新建/删除画刷 vs 复用（改动 C） | 只用 `CreateCompatibleDC(null)` 内存 DC，**不建窗口** |
| 5 | `cpp/apps/iim/bench/harness_before.exe real` / `brush` | ~15 s | 同一基准跑改动前代码，得到 before 列（注意：`real` 在改动前会走 8 次串行 HTTP，无令牌时是 401，用时会被网络拖长——这正是要证明的东西） | 同 3/4 |
| 6 | `cpp/apps/iim/bench/harness_after.exe load 2` | ~10 s | 目录加载端到端：release 列表 + 每页 manifest + 组装 | 无窗口；只读 api.github.com 公开接口；匿名无令牌 |
| 7 | `cpp/apps/iim/bench/harness_before.exe load 2` | ~20 s | 同上，改动前（8 次串行 manifest 拉取） | 同 6 |
| 8 | `cpp/apps/iim/bench/harness_before.exe sha` | ~30 s | sha256 基线（已测，可跳过） | 无窗口；会写 `bench/tmp/sha.bin`（最大 256 MB） |

命令行杀进程（我对每个进程都会在 finally 兜底；**严禁按进程名批量杀**）：

```
# 只按「路径属于本仓库 bench/ 目录」精确匹配，打印完整命令行后再杀
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*\Infinity.inc\cpp\apps\iim\bench\*' } |
  Select-Object ProcessId,Name,CommandLine
# 确认无误后再：Stop-Process -Id <上述 PID>
```

## 2. 已知会挡路的因素

- **GitHub 匿名配额**：60 次/小时/IP。第 6、7 项的 before 版一次 `loadItems` 就是 1 + 8 = 9 次请求，两份各 2 次共 36 次。
  执行前先 `curl -sS https://api.github.com/rate_limit`（只读）确认 `core.remaining` ≥ 40；不足就等 `core.reset`。
  配额耗尽时 `loadItems` 直接返回 403/空，测出来的就是假值（我本轮第一次就踩到了，见报告 §2.6）。
- **内存**：本机空闲物理内存曾低到 1.3 GB，cc1plus 因此 OOM 过一次。编译用 `-j 2`，失败就重试。
- 第 3/5 项读 `bench/tmp/releases.json`（352764 B，线上 `releases?per_page=100` 原始响应），已随仓库保留；缺了可以用只读 curl 重新拉。

## 3. after 数字占位（批准后填）

| 指标 | before（已实测） | after（占位） |
|---|---|---|
| exe 字节 | 724992 | 727040（已实测，文件属性） |
| 发行安装包字节 | 302978 | 待重打包（makensis，未批准） |
| 冷启动 --version 中位数 · 仿真安装目录 | 32.198 ms | ____ ms |
| 冷启动 --version 中位数 · 脏目录(52 文件) | 34.874 ms | ____ ms（预期 ~30.3） |
| 峰值私有工作集 | 8.72–8.74 MB | ____ MB |
| 安装计划生成 real（含网络） | 1441.8 ms | ____ ms |
| loadItems 端到端 | 无有效值（403） | ____ ms |
| brush 每次擦除 | 4.701 us（窗口版基准） | ____ us（内存 DC 版） |
| sha256 | 644–996 MB/s | 未改动 |

## 4. 复核要点（跑完请把原始输出贴回 work/perf-iim.md）

1. 冷启动三项各 5 次，取中位数，并要求第 2–5 次稳定（第 1 次是文件缓存冷启动，必然偏高）。
2. `loadItems` 的 `items` 数在 before/after 两份必须**相等**（线上目录约 208 项）——不相等说明并发改动改变了行为，先回滚再查。
3. `harness_before.exe real` 与 `harness_after.exe real` 的 item 数必须相等。
4. 跑完用 §1 的精确 PID 查询确认 0 残留，并把 PID 清单回报。

## 5. 回滚

```
Copy-Item cpp/apps/iim/bench/baseline/main_before.cpp cpp/apps/iim/main.cpp -Force
cmake --build cpp/build --target iim -j 2
```
