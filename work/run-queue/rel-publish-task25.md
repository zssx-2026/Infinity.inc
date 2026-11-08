# 运行申请：task-25 归档续跑（下载 → 打包 → 上传 assets）

- 任务号 / 成员：**task-25（rel-catalog 主责，rel-publish 执行上传段）/ rel-publish**
- 申请时间：2026-10-04 20:50（Asia/Shanghai）
- 状态：**等待 Lead 集中执行窗口批复**，本文件之外我没有运行任何命令。

## 0. 现状（静态读取，未运行任何进程）

来源：[work/archive/archive-plan.json](../archive/archive-plan.json)（47 个包：11 verified / 36 pending）、[work/archive-report.md](../archive-report.md)、[work/archive/bundles-lines.jsonl](../archive/bundles-lines.jsonl)。

| 类别 | 已完成 | 剩余 | 剩余体量 |
| --- | ---: | ---: | ---: |
| 现行版本（v1.0.0-pre3 / pre4）win64 | 11 | 0 | 0 |
| 旧版本（v0.1 / v1.0pre1 / v1.0pre2） | 1 | **36** | **4,161,865,886 B（约 3.88 GiB）** |

按产品：Infinity-Cloud 16 包（1,518,326,170 B）、InfinityPackageManager 10 包（1,598,610,826 B）、Infinity-File-Manager 10 包（1,044,928,890 B）。
按版本：v0.1 6 包（473,056,991 B）、v1.0pre1 21 包（2,659,091,344 B）、v1.0pre2 9 包（1,029,717,551 B）。
每个待办包的源资产名、字节与 GitHub API digest（sha256）已在 archive-plan.json 的 `sourceAssets` 中列全，无需再手抄。

## 1. 要跑什么（逐条命令）

### 阶段 A · 只读/纯 node（符合当前允许清单，仍请你确认）

1. 下载源资产（`curl.exe` **只读 GET**，`-L --ssl-no-revoke`，写出到 `work/archive/downloads/<repo>/<tag>/`）：
   ```text
   curl.exe -sS -L --ssl-no-revoke -H "Accept: application/octet-stream" \
     -o work/archive/downloads/<repo>/<tag>/<asset> \
     https://api.github.com/repos/zssx-2026/<repo>/releases/assets/<asset_id>
   ```
   已有可复用的下载目录：Infinity-Cloud、Infinity-File-Manager、InfinityPackageManager（v1.0pre1 mac-arm64 已下完，上轮 502 的那条无需重下）。
2. 压缩为 .zst（`node <脚本>.mjs`，使用 Node v24 内建 `zlib.zstdCompressSync`，**不 spawn 任何外部可执行文件**）：
   ```text
   node work/archive/make-zst.mjs <输入 tar> <输出 .zst>
   ```

### 阶段 B · 需要批准（外部 exe / 写请求）

3. **tar 打包**。现管线 `work/archive/make-bundle.ps1` 调用 **`tar.exe`（外部可执行文件）**，与当前禁令冲突。两个选项，请择一：
   - B1（推荐，零 exe）：由我或 rel-catalog 提供一个**纯 node tar 写入器**（tar 头 512 字节 + 校验和，约 60 行，无外部依赖），脚本内不 spawn 任何东西；
   - B2：批准 `tar.exe -cf <out.tar> -C <目录> <资产名...>`（控制台程序，无窗口）。
4. **上传 .zst 资产**（`curl.exe` **POST**，写请求）：
   ```text
   curl.exe -sS --ssl-no-revoke -X POST \
     -H "Authorization: Bearer $env:EV_GH_TOKEN" \
     -H "Content-Type: application/octet-stream" \
     --data-binary "@work/archive/<name>.zst" \
     "https://uploads.github.com/repos/zssx-2026/Infinity-Archive/releases/<release_id>/assets?name=<name>"
   ```
   若归档 Release 尚不存在，还需一次写请求建 Release：`POST /repos/zssx-2026/Infinity-Archive/releases`（`tag_name=archive-<产品>-<版本>-<平台>`，`prerelease=true`）。
5. 回下载校验（`curl.exe` 只读 GET + `Get-FileHash`）：`GET /repos/zssx-2026/Infinity-Archive/releases/assets/<id>`，比对 sha256 与字节数。
6. 记录：追加 `work/archive/bundles-lines.jsonl`，重新生成 `work/archive-bundles.json`（纯 node）。

## 2. 为什么必须运行（静态产出无法替代的点）

- .zst 的 sha256 与字节数只能由真实压缩产生；archive-plan.json 明确标注「Bundle sha256 requires a real build」。
- 上传后必须回下载比对，否则无法证明归档资产可下载且逐字节一致（task-25 的验收口径）。
- 36 个包共 3.88 GiB；`sourceAssets` 的 digest 可静态核对源，但不能代替产物哈希。

## 3. 窗口隐藏方式

- 全程只有控制台程序：`curl.exe`、`tar.exe`（若选 B2）、`node.exe`。
- **不启动**浏览器、WebView2、CEF、Electron、宿主 exe、服务、headless 截图、smoke、安装包测试；不调用 `Start-Process`，不产生任何有窗口的进程。
- 每条命令前台执行并设超时；`tar.exe` 若被批准，用 `Start-Process -WindowStyle Hidden -Wait` 的等价方式（`& tar.exe ...` 由当前无窗口 pwsh 承载）执行，绝不新开控制台窗口。

## 4. 跑完怎么杀 + 残留核对

1. 每条命令结束后立即核对：`Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'Infinity.inc\\work\\archive|uploads.github.com' }`，**先打印完整命令行**，只对匹配到的 PID 执行 `taskkill /T /F`。
2. 绝**不**按进程名批量杀 msedge / msedgewebview2 / chrome / explorer / SearchHost / fastbrowser 或任何用户程序。
3. 批次结束核对：上述过滤结果为空；我方 PID 的 `MainWindowHandle` 全为 0；回一句 PID 清单（含「已清理」）。
4. 批次开始前也做一次同样快照，便于对比。

## 5. 期望产出与判定标准

| 产出 | 判定 |
| --- | --- |
| `work/archive/<name>.zst` × N | 字节数 > 0；sha256 记录进 bundles-lines.jsonl |
| Infinity-Archive 各归档 Release 资产 | 回下载 HTTP 200，sha256 与字节数一致 |
| `work/archive/bundles-lines.jsonl` | 每完成一条追加一行；总数从 11 → 11+N |
| `work/archive-bundles.json` | 由 jsonl 重新生成，条目数 = verified 数 |
| `work/archive-report.md` | 更新覆盖表与剩余队列 |

## 6. 预计耗时 / 联网

- 实测速率：小资产 120–150 KB/s，>10 MB 资产约 40–45 KB/s（31.9 MB 的包约 13 分钟）。
- 3.88 GiB 上行按 45 KB/s 约 **25–29 小时**，**单个窗口不可能完成**。建议：
  - 窗口 1（约 20–30 分钟）：先做体量最小的 11 个包（v0.1/v1.0pre1 的 mac、mac-arm64、linux、linux-arm64，单包 32–37 MB，合计约 400 MB），验证 B1/B2 管线与新 Release 建页；
  - 窗口 2+：按 `sourceBytes` 升序推进 v0.1/v1.0pre2，最后做 win64/winx86/win-arm64 大包（单包最大 301,565,887 B）。
- 全程联网（api.github.com / uploads.github.com）。GitHub 匿名配额与 100 MB 单文件上限不影响本计划：所有待传 .zst 均远小于 100 MB，上传走已认证令牌。

## 7. 我不做、也不申请的部分

- 不重建 v1.0pre5 安装包（task-31，属 rel-cpp-build 的 cmake/ninja/makensis 申请）。
- 不跑任何应用二进制、不做 GUI/窗口证据、不做安装包安装测试。
- 在获得批准前，`curl` 的写请求（上传/建 Release）一律不执行。
