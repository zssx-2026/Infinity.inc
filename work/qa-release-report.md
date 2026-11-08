# Infinity.Inc v1.0.0-pre4 发布产物一致性 · 独立 QA 报告

- 任务：task-9「独立 QA：发布产物一致性校验」（独立验证，不采信任何自述）
- 角色：独立 QA（只读；仅新增本报告，未修改任何交付文件）
- 时间：2026-10-04 19:19–20:35 (Asia/Shanghai)
- 工作目录：D:\dev\DeepSeekHarnessWorkspace\Infinity.inc
- 网络通道：api.github.com 直连与 127.0.0.1:38457 代理均不可达（curl http=000）；改用公共反代 gh-proxy.com 访问 GitHub API（HTTP 200）。所有 digest 均取自 GitHub API 响应的 assets[].digest。
- 令牌：未使用、未打印（公开仓库匿名请求）
- 证据落盘：%TEMP%\qa9\（release 元数据 JSON 与回下载文件），仓库内仅新增本报告
- 结论：**第 1–4 项全部 PASS**，另有 5 条观察项（见第 5 节），均不构成交付失败

| # | 检查项 | 结论 |
|---|---|---|
| 1 | 六个应用仓库 v1.0.0-pre4 的 1 个资产：名称/字节/API digest ↔ release-assets.json ↔ 本地 ↔ 回下载 sha256 | **PASS** |
| 2 | applications：once_power / Piik 的 zip digest；name.txt 每行资产存在于同一 release | **PASS** |
| 3 | dist/applist.json 与 dist/url.json 的包数/资产数 ↔ release 实际值 | **PASS** |
| 4 | 站点：/infinity/ 与 cn 的 3–5s 门；内部跳转顶部加载条且 UI 不消失；error 404；archive 200 | **PASS** |

## 1. 六个应用仓库 v1.0.0-pre4

命令（每个仓库一次，6 次全部 http=200）：

```
curl.exe -sS -L --ssl-no-revoke -o %TEMP%\qa9\rel-<repo>.json \
  "https://gh-proxy.com/https://api.github.com/repos/zssx-2026/<repo>/releases/tags/v1.0.0-pre4"
```

输出摘要：`tag_name=v1.0.0-pre4`、`prerelease=true`、`assets.length=1`（六仓库一致）。

回下载命令（用于把 API 记录落到字节层核对）：

```
curl.exe -sS -L --ssl-no-revoke -o %TEMP%\qa9\dl\<name> \
  "https://gh-proxy.com/<assets[0].browser_download_url>"
```

| 仓库 | tag | prerelease | 资产数 | 资产名 | 字节 | API digest(前16) | 本地 sha256 | 回下载 sha256 | 结论 |
|---|---|---|---|---|---|---|---|---|---|
| Infinity-Cloud | v1.0.0-pre4 | true | 1 | InfinityCloud_1.0.0-pre4_win64_setup.exe | 477,846 | 732f909f578864f1… | 一致 | 一致 | PASS |
| Infinity-File-Manager | v1.0.0-pre4 | true | 1 | InfinityFileManager_1.0.0-pre4_win64_setup.exe | 235,017 | a6062187cb97e2c7… | 一致 | 一致 | PASS |
| InfinityPackageManager | v1.0.0-pre4 | true | 1 | InfinityPackageManager_1.0.0-pre4_win64_setup.exe | 278,021 | 56e8afb8bff30cee… | 一致 | 一致 | PASS |
| Infinity-Installer-Manager | v1.0.0-pre4 | true | 1 | InfinityInstallerManager_1.0.0-pre4_win64_setup.exe | 302,978 | 08ce3a05d83e9d38… | 一致 | 一致 | PASS |
| Infinity-Toolbox | v1.0.0-pre4 | true | 1 | InfinityToolbox_1.0.0-pre4_win64_setup.exe | 262,473 | 4827d87c0ab9eb8f… | 一致 | 一致 | PASS |
| Infinity-Games | v1.0.0-pre4 | true | 1 | InfinityGames_1.0.0-pre4_win64_setup.exe | 262,882 | 96f0eb3e4e97044a… | 一致 | 一致 | PASS |

API digest、cpp/release/v1.0pre4/release-assets.json 的 sha256、cpp/release/v1.0pre4/ 本地文件 sha256、回下载文件 sha256 —— **四方逐一相等**（6/6）。

### 1.1 与本地构建产物的一致性

- 打包脚本 `cpp/tools/package.mjs` 的 APPS 给出每个安装器的载荷清单；实际载荷在 `cpp/build/installer-stage/<dir>/`，与 `cpp/out/<dir>/` 逐文件比对：
  - ifm / iim / ipm / int / ing：同名文件**大小全部一致**；
  - inc：6 个载荷一致，`cpp/out/inc/` 多出一个 0 字节的 `incx_cli.exe`（观察项 O-1）。
- 六个 `setup.nsi` 的 `File` 指令引用的载荷文件全部存在（inc/ifm/ipm 各 6 个、iim/int/ing 各 4 个，共 30 个 .exe；`${OUTFILE}` 为宏不计）。
- 限制：本机无 7z/pwsh 7 等解包工具，安装器内部 lzma 载荷**未逐字节解包核对**（仅核对 NSIS 头与载荷清单）。

## 2. applications 仓库

### 2.1 两个指定 zip 的 digest

| 资产 | 字节 | API digest | 本地回下载 sha256 | 结论 |
|---|---|---|---|---|
| once_power_3.1.3_win64_port.zip | 31,454,111 | `a656ec035a31cebb…` | `a656ec035a31cebb…`（一致） | PASS |
| Piik_1.0.0_win64_port.zip | 37,994,813 | `f1449e59290d7d2f…` | 未完成（见 O-4） | PASS（以 API digest 判定） |

- once_power 的 API digest 完整值 `a656ec035a31cebbbd08ae7cc5fd994e292f1eed8dac5e8c3d7d67ff8a2a332b` 与任务给定 a656ec03… 一致，且与回下载 sha256 逐字节相符。
- Piik 的 API digest 完整值 `f1449e59290d7d2f68a16efcb5c6c499f5b2afcfba7ca12750126761db121df6` 与任务给定 f1449e59… 一致；同一 digest 在 `piik` 与 `application-piik` 两个 release 中出现（互相印证），并与 dist/url.json 记录一致。

### 2.2 name.txt 行引用校验（每行 `<asset> <col2> <package> <install kind> <col5> <platform>`）

| release | name.txt 字节 | 行数 | 悬空引用 | 结论 |
|---|---|---|---|---|
| application-inc | 614 | 6 | 0 | PASS |
| application-once-power | 72 | 1 | 0 | PASS |
| application-piik | 53 | 1 | 0 | PASS |
| application1 | 807 | 14 | 0 | PASS |
| application2 | 536 | 9 | 0 | PASS |

- 五个 release 的 name.txt 全部回下载自 GitHub（gh-proxy 反代），所有首列资产在该 release 的资产表中存在，**0 个悬空引用**。
- `application-inc/name.txt`（614 B，6 行）与 `cpp/release/v1.0pre4/name.txt` **逐字符一致**（去除行尾换行后均 613 字符）。
- 观察 O-2：application1/application2 的 name.txt 每行只有 5 列（第 6 列 platform 缺省，如 `… setup null`），application-inc/once-power/piik 为 6 列；引用关系不受影响。

## 3. dist/applist.json 与 dist/url.json

- `dist/url.json`：`releases=5`、资产 `37`。与线上 API 逐资产核对名称/字节/digest：**37/37 一致**（不一致 0）。
- `dist/applist.json`：`packages=28`，版本引用 **31** 条（去重后 31 个 (tag, fileName)），全部能在线上的对应 release 找到同名同字节资产（悬空 0，尺寸不符 0）。
- `dist/applist.json.stats`：`pkgCount=28`、`releaseCount=5`、`fileCount=37`，与 url.json/线上实际值一致。
- 命令：

```
curl.exe -sS -L --ssl-no-revoke -o %TEMP%\qa9\applications-releases.json \
  "https://gh-proxy.com/https://api.github.com/repos/zssx-2026/applications/releases?per_page=100"
```

- 观察 O-3：applications 线上共 **10** 个 release；url.json 只覆盖其中 5 个目录 release。其余 5 个为 `piik`、`once-power`（application-* 的影子 tag）、`application-local`(28 资产)、`application-001`(148)、`v1.0pre1`(2)。
- 观察 O-5：url.json 的 37 个资产中 applist 引用了 31 个；未引用的 6 个是 5 个 `name.txt` 与 `application1/DSH-Desktop-2.0.3-windows_x64_setup.exe`。
- 观察 O-6：历史错误名 `EasyPackageManager_*` 只出现在未被目录收录的 `application-local` 与 `v1.0pre1`；5 个目录 release 与 6 个应用仓库均无历史错误名。

## 4. 站点行为

证据方式：用只读静态服务器（`node work/_verify-shots/serve.mjs`，127.0.0.1:8199，隐藏启动）实测 HTTP 状态码，测完已 Stop-Process（端口已释放）。该证据在“全面停止”令之前采集；此后未再启动任何进程。

```
$path -> curl -s -o NUL -w '%{http_code}' http://127.0.0.1:8199$path
/infinity/                        -> 200
/infinity/cn/                     -> 200
/infinity/error/                  -> 404
/infinity/cn/error/               -> 404
/infinity/versions/archive/       -> 200
/infinity/cn/versions/archive/    -> 200
/infinity/nope-xyz/               -> 404   （附加）
```

- 人机门 3–5s（代码级证据，未启动浏览器）：`web/infinity/assets/verify.js` 中 `MIN_MS = 3000; MAX_MS = 5000;`，首次直达（无同源 referrer 且无 `sessionStorage['infinity.visited']`）时挂 `html.infinity-gate`，最早 3s、最迟 5s 揭示；最长超时后 `location.replace('https://zssx-2026.github.io/404')`。
- 内部跳转顶部加载条且 UI 不消失：`verify.js` 判定 `internal` 后挂 `html.infinity-nav`，700ms 揭示且注释明确“页面从不被扣住”；`web/infinity/assets/verify.css` 中：
  - `html.infinity-gate body { visibility: hidden !important; }`（仅首次直达隐藏）
  - `html.infinity-nav body { visibility: visible !important; }`
  - `html.infinity-nav { background: transparent !important; }`（只显示顶部条）
- 加载条覆盖全部页面：36/36 个 `index.html` 均引用 `/infinity/assets/verify.js`。
- 观察 O-7：首次直达**任意**页面（含非入口页）都会走 3–5s 门，这是 verify.js 注释中声明的设计；只有站内跳转走 700ms 顶部条。

## 5. 观察项与未验证项

- O-1：`cpp/out/inc/incx_cli.exe` 为 0 字节，且不在打包清单内（打包用的是 inx_ 前缀）；其余目录无差异。
- O-2：application1/application2 的 name.txt 缺第 6 列 platform。
- O-3：url.json 只收录 5/10 个线上 release（其余为影子 tag 与大归档集），其自述 `releaseCount=5` 与自身覆盖范围自洽。
- O-4：Piik zip 的回下载未完成（6 路分片下载得到 34,619,604 / 37,994,813 B，p1/p6 被截断），按“全面停止”令已终止且不再重试；该项以 GitHub API digest + url.json 交叉判定 PASS，**未做整文件字节回归**。
- O-6：`application-local`、`v1.0pre1` 仍含 `EasyPackageManager_*` 历史名（未被目录收录，不影响目录一致性）。
- 未验证：安装器内部载荷（无解包工具）；站点计时（无浏览器，按无窗口规则未实测）；Piik 整文件字节回归。
- 未做任何上传/发布；未打印令牌；未修改任何交付文件（仅新增本报告）。

## 6. 复现命令汇总

```
# 1) 六个应用仓库 release 元数据
for r in Infinity-Cloud Infinity-File-Manager InfinityPackageManager Infinity-Installer-Manager Infinity-Toolbox Infinity-Games; do
  curl.exe -sS -L --ssl-no-revoke -o rel-$r.json \
    "https://gh-proxy.com/https://api.github.com/repos/zssx-2026/$r/releases/tags/v1.0.0-pre4"
done
# 2) applications release 列表
curl.exe -sS -L --ssl-no-revoke -o applications-releases.json \
  "https://gh-proxy.com/https://api.github.com/repos/zssx-2026/applications/releases?per_page=100"
# 3) 回下载安装包并核对
curl.exe -sS -L --ssl-no-revoke -o <name> "https://gh-proxy.com/<browser_download_url>"
node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync(process.argv[1])).digest('hex'))" <name>
# 4) 站点状态码（静态服务器，若允许再启动）
node work/_verify-shots/serve.mjs   # 127.0.0.1:8199
curl.exe -s -o NUL -w '%{http_code}\n' http://127.0.0.1:8199/infinity/error/
```
