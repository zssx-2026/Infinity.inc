# hist-verifier · 运行队列申请（task-9 补验，等受控窗口）

- 提交时间：2026-10-04 20:47 (Asia/Shanghai)
- 成员 / 任务：hist-verifier / task-9（报告已入库：work/qa-release-report.md，副本 work/rel-qa-report.md）
- 合规声明：两份申请都只用命令行工具，不涉及浏览器 / WebView2 / CEF / Electron / 宿主 / 服务 / headless 截图。若需清理，仅按“命令行含 %TEMP%\qa9 或我方测试路径”的精确 PID 逐个 taskkill，杀前打印完整命令行并回报 PID 清单；不会按进程名批量杀 msedge / msedgewebview2 / chrome / explorer / SearchHost / fastbrowser。

## 申请 A：Piik zip 整文件字节回归

- 任务号 / 成员：task-9 / hist-verifier
- 要跑什么（完整命令，逐条）：

```
curl.exe -sS -L --ssl-no-revoke --max-time 3600 -o "%TEMP%\qa9\dl\Piik_1.0.0_win64_port.zip" ^
  "https://gh-proxy.com/https://github.com/zssx-2026/applications/releases/download/application-piik/Piik_1.0.0_win64_port.zip"
:: 若再次中断（大小 < 37,994,813），加断点续传重跑同一条：
curl.exe -sS -L --ssl-no-revoke -C - --max-time 3600 -o "%TEMP%\qa9\dl\Piik_1.0.0_win64_port.zip" ^
  "https://gh-proxy.com/https://github.com/zssx-2026/applications/releases/download/application-piik/Piik_1.0.0_win64_port.zip"
```

- 为什么必须运行：task-9 第 2 项里 once_power 已完成“回下载 sha256 = API digest”的字节级验证，而 Piik 目前只有 API digest + dist/url.json + piik/application-piik 两个 release 互证，缺整文件字节回归；静态产出无法替代。
- 窗口隐藏方式：curl 是控制台程序，不创建窗口；不加任何 --app / --new-window / GUI 参数。
- 跑完怎么杀 + 残留核对：命令自行退出；核对 `Get-Process -Name curl -ErrorAction SilentlyContinue` 计数为 0。全程不涉及浏览器进程。
- 期望产出（文件 + 判定标准）：%TEMP%\qa9\dl\Piik_1.0.0_win64_port.zip，大小 **37,994,813 B**，sha256 = **f1449e59290d7d2f68a16efcb5c6c499f5b2afcfba7ca12750126761db121df6**。大小与 sha256 全等 → PASS；否则回报实测值 → FAIL（并保留残件供排查）。
- 预计耗时 / 是否会联网：约 10–30 分钟；会联网（gh-proxy.com 只读 GET；api.github.com 本机不可达）。实测：单连接 600 s 只得 6.0/38.0 MB；6 路分片 13 分钟只得 34.6/38.0 MB（p1、p6 截断）。建议单连接长超时或 `-C -` 续传。
- 备注：上次 34,619,604 B 的残件已作废，请勿直接复用。

## 申请 B：安装器内部载荷解包核对

- 任务号 / 成员：task-9 / hist-verifier
- 要跑什么（完整命令，逐条；6 个安装包各一次，此处以 Cloud 为例）：

```
:: 需要 7z.exe 或 7zr.exe（本机当前无 7-Zip，这属于允许清单外的二进制，需 Lead 批准/提供便携版）
7z.exe l cpp\release\v1.0pre4\InfinityCloud_1.0.0-pre4_win64_setup.exe
7z.exe x -y -o"%TEMP%\qa9\x\inc" cpp\release\v1.0pre4\InfinityCloud_1.0.0-pre4_win64_setup.exe
:: 其余 5 个依次：InfinityFileManager -> ifm、InfinityPackageManager -> ipm、
:: InfinityInstallerManager -> iim、InfinityToolbox -> int、InfinityGames -> ing
```

- 为什么必须运行：目前只核对了 NSIS 头与本机打包载荷目录 `cpp/build/installer-stage/<dir>/`（含 setup.nsi 的 File 清单），安装器内部 lzma 载荷未解包，无法证明发布出去的 setup.exe 里确实装着对应构建产物。
- 窗口隐藏方式：7z 是命令行程序，无窗口。
- 跑完怎么杀 + 残留核对：7z 自行退出；核对无 7z 进程残留；解包输出只写 %TEMP%\qa9\x\，不写入仓库。
- 期望产出（判定标准）：每个包解出的 .exe 数量应为 inc 6、ifm 6、ipm 6、iim 4、int 4、ing 4；解包文件与 `cpp/build/installer-stage/<dir>/<同名文件>` 的 sha256 一致（NSIS 原样存储载荷）。全部一致 → PASS。
- 预计耗时 / 是否会联网：< 1 分钟；不联网（只用本地文件）。

## 当前残留状态（供窗口前快照对照）

- 2026-10-04 20:32 复核：命令行含 Piik/serve.mjs 的进程 = 0；curl 进程 = 0；127.0.0.1:8199 无监听。
- 本成员线程内不再启动任何二进制；等待 Lead 安排窗口。
