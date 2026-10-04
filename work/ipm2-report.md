# rel-catalog 报告：IPM 打包 once_power / Piik 并注册（task-11）

- 完成时间：2026-10-04（Asia/Shanghai）；owner rel-catalog
- 结论：两个 zip 已上传到 applications 仓库并各带 name.txt；回下载 sha256 与本地一致；dist 已同步为 28 包 / 5 页。

## 1. 打包

源目录：`IPM Applications/once_power`（87 文件 / 76,000,476 B）、`IPM Applications/Piik`（4 文件 / 109,422,488 B）。
PE 架构：once_power.exe / piik-app.exe / piik-capture.exe 均为 **x64** → 平台列 `win64`。

打包命令（PowerShell + .NET，条目分隔符强制 `/`，避免 ZipFile::CreateFromDirectory 在 pwsh 5.1 下写反斜杠）：
```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[System.IO.Compression.ZipFile]::Open($dst,"Create")
Get-ChildItem -LiteralPath $src -Recurse -Force -File | ForEach-Object {
  $rel=$_.FullName.Substring($src.Length+1) -replace '\\','/'
  [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$_.FullName,$rel,Optimal)
}
$zip.Dispose()
// Piik 先复制到 work/_ipm2/Piik-stage 并写入 VERSION(1.0.0) 再打包
```

| zip | 条目 | 未压缩字节 | zip 字节 | sha256 |
| --- | --- | --- | --- | --- |
| once_power_3.1.3_win64_port.zip | 87 | 76,000,476 | 31,454,111 | a656ec035a31cebbbd08ae7cc5fd994e292f1eed8dac5e8c3d7d67ff8a2a332b |
| Piik_1.0.0_win64_port.zip | 5 | 109,422,492 | 37,994,813 | f1449e59290d7d2f68a16efcb5c6c499f5b2afcfba7ca12750126761db121df6 |

内容摘要：once_power zip 根目录含 `once_power.exe`、30 个 DLL（flutter_windows.dll、ffmpeg-8.dll 等）、`unins000.exe/.dat` 与完整 `data/` 子树（flutter_assets、app.so、icudtl.dat）；Piik zip = `piik-app.exe`、`VERSION`、`runtime/native/piik-capture.exe`、`runtime/tunnel/cloudflared.exe`、`runtime/tunnel/THIRD-PARTY-NOTICES.txt`。

## 2. Release 与 name.txt

| 应用 | tag | Release URL | 资产 |
| --- | --- | --- | --- |
| once_power | `application-once-power` | https://github.com/zssx-2026/applications/releases/tag/application-once-power | once_power_3.1.3_win64_port.zip (31,454,111) + name.txt (72) |
| Piik | `application-piik` | https://github.com/zssx-2026/applications/releases/tag/application-piik | Piik_1.0.0_win64_port.zip (37,994,813) + name.txt (53) |

name.txt 内容（行格式 `<asset name> <version> <package> <install kind> <company> <platform>`）：
```text
once_power_3.1.3_win64_port.zip 3.1.3 once_power port com.ilgnefz win64
Piik_1.0.0_win64_port.zip 1.0.0 Piik port null win64
```
每行的 asset 名都与同页资产同名（大小一致），满足 IPM 的“同名资产否则跳过”契约。

### install kind 取值依据
- 现存目录里 `type` 只有 `setup` 与 `port`（dist/applist.json：blurautoclicker、MCTier、resource_hacker 均为 port）。
- 决定性证据：Node 端 `dist/bundle.js` `src/names.js:5117` 明确 `if (type !== "setup" && type !== "port") continue;` —— 写 `portable` 的行会被整行丢弃，包不会出现在 applist/url 里；C++ 端 `main.cpp:236` 只按列数取值，但可运行性只认 `setup`。
- 因此按 live 实际取值用 **`port`**，未使用任务描述里的 `portable`。

### 版本依据
- once_power：PE 版本资源 FileVersion=ProductVersion=`3.1.3+0`，CompanyName=`com.ilgnefz` → 取 `3.1.3`（去 `+0`），company 用 `com.ilgnefz`。
- Piik：`piik-app.exe`、`runtime/native/piik-capture.exe`、`runtime/tunnel/cloudflared.exe` 三个 PE 均无 FileVersion/ProductVersion/CompanyName，目录内也无 VERSION / package.json / tauri 元数据 → 取初始版本 `1.0.0`，并在 zip 根目录写入 `VERSION`（内容 `1.0.0`）作为版本权威来源；company 无证据 → `null`（沿用既有未知公司写法）。

## 3. 上传后校验

- GET release：每页恰好 2 个资产，name/size 与本地一致，state=uploaded。
- API digest 与本地 sha256 一致（GitHub 在上传时计算）。
- **回下载**（api.github.com asset 端点，Accept: application/octet-stream，curl -L）：

| 资产 | HTTP | 下载字节 | 回下载 sha256 | 与本地一致 |
| --- | --- | --- | --- | --- |
| once_power_3.1.3_win64_port.zip | 200 | 31,454,111 | a656ec03…a332b | 是 |
| Piik_1.0.0_win64_port.zip | 200 | 37,994,813 | f1449e59…21df6 | 是 |

（证据文件：`work/_ipm2/redownload-check.txt`，下载副本 `work/_ipm2/dl-*.zip`。）

## 4. dist 改动摘要

备份：`dist/backup-ipm2/`（本次改动前的状态）、`dist/backup-pre4/`（task-8 状态）。

| 文件 | 改动 |
| --- | --- |
| dist/url.json | 新增两页记录（application-once-power、application-piik，kind=app，含 nameTxt.raw/entries 与资产 url/digest）；updatedAt 刷新；releases = [application-piik, application-once-power, application-inc, application2, application1]（5 条），字段集合与既有记录逐键一致 |
| dist/applist.json | count 26 → **28**；stats `{pkgCount:28, releaseCount:5, fileCount:37}`；新增 `once_power`(3.1.3, port, com.ilgnefz, tag application-once-power) 与 `Piik`(1.0.0, port, null, tag application-piik)，按 name 忽略大小写排序（MCTier 之后、resource_hacker 之前）；其余 26 包不变；可由 url.json 重放 |

注意：改动前的 dist（backup-ipm2，08:58 夜间运行产物）里 `piik`/`once-power` 两条 release **没有 nameTxt**，包是手工塞进 applist 的；那种状态下真实 `ipm update` 会把这两个包丢掉。本次用带 nameTxt 的可重放结构替代，并把这些不可见记录从 url.json 移除（相关资产未做任何删除）。

## 5. 重要发现：已有 once-power / piik 两页（未改动）

- applications 仓库里本就存在 tag `once-power` / `piik` 两个 Release（2026-10-04T08:55Z 发布），同样各带 zip + name.txt；其 zip 字节与本任务的构建**逐字节相同**（sha256 相同），name.txt 用 `Infinity.Inc` 填 version/company 两列。
- 但它们的 `tag` 与 `name` 都不含 `application`，而 `dist/bundle.js:5413 hasAppTag = /application/i.test(tag + " " + name)`，`fetchAll()` 会直接 `continue` 跳过 —— 真实 IPM 刷新看不到这两页，包会消失。
- 本次为不改动他人已发布的页与资产，未删除、未改名、未替换它们；改用 tag `application-*`（按 tag 即可通过 hasAppTag）注册，并把它们排除在 dist 之外。
- 建议（需 Lead 决定）：要么删除/保留这两个冗余页并在文档标注，要么把它们的 Release `name` 加上 `application` 前缀 + 修正 name.txt 的 version/company 后再删掉本次的 `application-*` 两页，让目录只保留一套。

## 6. 风险与遗留

1. GitHub 上现在存在 4 个页（2 个可见 + 2 个不可见）描述同两个包，zip 重复占用约 70 MB；建议尽快二选一收敛。
2. `work/ghsync.mjs` 的 `publishCatalog()` 仍硬编码 application-inc 的 4 个 pre3 包（task-8 已标记）：任何一次 ghsync 运行都会清掉目录 name.txt，需先改。
3. dist 仍只包含 application-inc/application1/application2 + 本次两页；线上还有 application-local / application-001 / v1.0pre1 未纳入（既有偏差，未扩大改动面）。
4. Piik 无版本资源，1.0.0 为人为确定值；zip 内 VERSION 文件是唯一权威记录，升级时需同步更新 name.txt 与 VERSION。
