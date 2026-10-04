# v1.0pre4 发布验证报告（task-7 / rel-publish）

- 结论：**PASS** — 6 个应用仓库的 `v1.0.0-pre4` Release 各含 1 个资产；下载回来的字节与本地安装包、`release-assets.json`、GitHub API 的 `digest` **四方一致**（sha256 全等）。
- 验证时间：2026-10-04（Asia/Shanghai）
- 验证人：rel-publish（独立于上传方）
- 本次验证**只做 GET 与下载**，没有创建/删除/上传任何资产。

## 1. 目标仓库与标签

| # | 应用 | 仓库 | 标签 | Release id | 资产数 |
|---|------|------|------|-----------|-------|
| 1 | Infinity Cloud | zssx-2026/Infinity-Cloud | v1.0.0-pre4 | 402892541 | 1 |
| 2 | Infinity File Manager | zssx-2026/Infinity-File-Manager | v1.0.0-pre4 | 402892580 | 1 |
| 3 | InfinityPackageManager | zssx-2026/InfinityPackageManager | v1.0.0-pre4 | 402892616 | 1 |
| 4 | Infinity Installer Manager | zssx-2026/Infinity-Installer-Manager | v1.0.0-pre4 | 402892644 | 1 |
| 5 | Infinity Toolbox | zssx-2026/Infinity-Toolbox | v1.0.0-pre4 | 402892666 | 1 |
| 6 | Infinity Games | zssx-2026/Infinity-Games | v1.0.0-pre4 | 402892692 | 1 |

6 个 Release 均为 `draft=false`、`prerelease=true`，与 v1.0.0-pre3 的发布口径一致。

### 发布前的仓库勘察（2026-10-03）

- 已存在：`Infinity-Cloud`、`Infinity-File-Manager`、`InfinityPackageManager`、`Infinity-Installer-Manager`、`applications`、`Infinity.inc`。
- **不存在（404）**：`Infinity-Toolbox`、`Infinity-Games` → 已报告 Lead；Lead 随后创建了这两个仓库并完成上传。发布脚本按约定**只报告不创建**。

## 2. 上传前 dry-run（GET only）

命令（令牌来自用户级环境变量，不打印）：

```powershell
$env:EV_GH_TOKEN = [Environment]::GetEnvironmentVariable("EV_GH_TOKEN","User")   # 长度 93，未回显
node cpp/tools/publish.mjs --dry-run
```

结果摘要（退出码 0）：

```
DRY RUN complete: 6 application(s) checked, 0 repository/repositories missing, 0 local/API error(s)
```

| 应用 | 计划 | 本地字节 | 本地 sha256（前 12 位） |
|------|------|---------|----------------------|
| Infinity Cloud | create release + upload | 477846 | 732f909f5788 |
| Infinity File Manager | create release + upload | 235017 | a6062187cb97 |
| InfinityPackageManager | create release + upload | 278021 | 56e8afb8bff3 |
| Infinity Installer Manager | create release + upload | 302978 | 08ce3a05d83e |
| Infinity Toolbox | create release + upload | 262473 | 4827d87c0ab9 |
| Infinity Games | create release + upload | 262882 | 96f0eb3e4e97 |

dry-run 同时确认：`release-assets.json` 里 6 个文件名 == `<package>_1.0.0-pre4_win64_setup.exe`，且 6 个文件均存在。

> 提示（可追溯性）：`cpp/release/v1.0pre4/release-assets.json` 的当前版本 `generated=2026-10-03T13:07:19.167Z`；此前 13:02:11Z 的一版清单（例如 InfinityCloud 477915 B）已被重新打包后的版本取代。上传与本次验证均以 13:07:19Z 版为准，其内容与实际文件、线上资产完全一致（见第 4 节）。

## 3. 上传后的 API 元数据

命令：

```powershell
curl.exe -sS --ssl-no-revoke -H ("Authorization: Bearer " + $env:EV_GH_TOKEN) ^
  -H "Accept: application/vnd.github+json" -H "User-Agent: Infinity.Inc" ^
  https://api.github.com/repos/zssx-2026/<repo>/releases/tags/v1.0.0-pre4
```

| 仓库 | 资产名 | size (B) | state | digest (sha256) |
|------|--------|---------|-------|-----------------|
| Infinity-Cloud | InfinityCloud_1.0.0-pre4_win64_setup.exe | 477846 | uploaded | `sha256:732f909f578864f1ead0c9539d40aa4e075c26a319d385fad5bacf671d85f7a5` |
| Infinity-File-Manager | InfinityFileManager_1.0.0-pre4_win64_setup.exe | 235017 | uploaded | `sha256:a6062187cb97e2c7f8732c17529932a2c8356fcc6c2b285a62f4de96caf3d5ae` |
| InfinityPackageManager | InfinityPackageManager_1.0.0-pre4_win64_setup.exe | 278021 | uploaded | `sha256:56e8afb8bff30cee76c7cc2184fb37f43ef2ec203060261eec6e11cfac2c0ed7` |
| Infinity-Installer-Manager | InfinityInstallerManager_1.0.0-pre4_win64_setup.exe | 302978 | uploaded | `sha256:08ce3a05d83e9d38b4fb696f156e580fcc04a9e30066a21c8a41f9061210d2f2` |
| Infinity-Toolbox | InfinityToolbox_1.0.0-pre4_win64_setup.exe | 262473 | uploaded | `sha256:4827d87c0ab9eb8f319ee96d59062ffee350ff06e6c571d248d4a74f0fc789f2` |
| Infinity-Games | InfinityGames_1.0.0-pre4_win64_setup.exe | 262882 | uploaded | `sha256:96f0eb3e4e97044a8c02a4e06dba5a5f4b97de853a45ceba398ff07bfcfb9456` |

## 4. 回下载 + 三方/四方 sha256 比对

下载命令（每个资产一次；不携带令牌，仓库为 public）：

```powershell
curl.exe -sS -L --ssl-no-revoke --max-time 300 -o work/_pubcheck/<name> ^
  https://github.com/zssx-2026/<repo>/releases/download/v1.0.0-pre4/<name>
(Get-FileHash -Algorithm SHA256 work/_pubcheck/<name>).Hash.ToLower()
```

| 仓库 | 资产 | 本地 B | 下载 B | 下载 sha256 == 本地 | == release-assets.json | 下载 == API digest | 判定 |
|------|------|--------|--------|--------------------|------------------------|--------------------|------|
| Infinity-Cloud | InfinityCloud_1.0.0-pre4_win64_setup.exe | 477846 | 477846 | 是 | 是 | 是 | PASS |
| Infinity-File-Manager | InfinityFileManager_1.0.0-pre4_win64_setup.exe | 235017 | 235017 | 是 | 是 | 是 | PASS |
| InfinityPackageManager | InfinityPackageManager_1.0.0-pre4_win64_setup.exe | 278021 | 278021 | 是 | 是 | 是 | PASS |
| Infinity-Installer-Manager | InfinityInstallerManager_1.0.0-pre4_win64_setup.exe | 302978 | 302978 | 是 | 是 | 是 | PASS |
| Infinity-Toolbox | InfinityToolbox_1.0.0-pre4_win64_setup.exe | 262473 | 262473 | 是 | 是 | 是 | PASS |
| Infinity-Games | InfinityGames_1.0.0-pre4_win64_setup.exe | 262882 | 262882 | 是 | 是 | 是 | PASS |

完整哈希（下载字节的 sha256，与上表 API digest、`release-assets.json` 逐字符相同）：

```
732f909f578864f1ead0c9539d40aa4e075c26a319d385fad5bacf671d85f7a5  InfinityCloud_1.0.0-pre4_win64_setup.exe
a6062187cb97e2c7f8732c17529932a2c8356fcc6c2b285a62f4de96caf3d5ae  InfinityFileManager_1.0.0-pre4_win64_setup.exe
56e8afb8bff30cee76c7cc2184fb37f43ef2ec203060261eec6e11cfac2c0ed7  InfinityPackageManager_1.0.0-pre4_win64_setup.exe
08ce3a05d83e9d38b4fb696f156e580fcc04a9e30066a21c8a41f9061210d2f2  InfinityInstallerManager_1.0.0-pre4_win64_setup.exe
4827d87c0ab9eb8f319ee96d59062ffee350ff06e6c571d248d4a74f0fc789f2  InfinityToolbox_1.0.0-pre4_win64_setup.exe
96f0eb3e4e97044a8c02a4e06dba5a5f4b97de853a45ceba398ff07bfcfb9456  InfinityGames_1.0.0-pre4_win64_setup.exe
```

- 下载总字节：**1,819,217 B**（6 个文件之和，与本地一致）。
- 落盘目录：`work/_pubcheck/`（仅本次验证的副本，非发布产物）。
- 过程中的网络抖动：Infinity Cloud 首次下载返回 **HTTP 502**（101 B 错误页）；重试第 1 次即得 200 / 477846 B，随后哈希校验通过。**这属于下载侧抖动，与线上资产无关。**

## 5. 历史 Release 未被改动（发布前 vs 验证时）

| 仓库 | 标签 | Release id | 资产数 | 判定 |
|------|------|-----------|--------|------|
| Infinity-Cloud | v1.0.0-pre3 | 401753877 → 401753877 | 1 → 1（InfinityCloud_1.0.0-pre3_win64_setup.exe 441856 B） | 未变 |
| Infinity-File-Manager | v1.0.0-pre3 | 401753916 → 401753916 | 1 → 1（…187658 B） | 未变 |
| InfinityPackageManager | v1.0.0-pre3 | 401753948 → 401753948 | 1 → 1（…241405 B） | 未变 |
| Infinity-Installer-Manager | v1.0.0-pre3 | 401805551 → 401805551 | 1 → 1（…262570 B） | 未变 |
| applications | application-inc | 398198245 → 398198245 | 5 → 5（4×pre3 exe + name.txt 424 B） | 未变 |

Release 总数变化只来自新增的 pre4：Infinity-Cloud 4→5、Infinity-File-Manager 3→4、InfinityPackageManager 3→4、Infinity-Installer-Manager 1→2、applications 7→7。其余标签（`v1.0pre1`、`v1.0pre2`、`v0.1`、`application-local`、`application-001`、`application1`、`application2`、`001`）的资产名与字节数逐条比对无差异。**未发现对 v1.0.0-pre3 及更早 Release 的任何删除或替换。**

## 6. `cpp/tools/publish.mjs` 改动清单（补丁清单，供 Lead 归档）

1. `RELEASE = process.env.INC_RELEASE || "v1.0pre4"`、`OUT = path.join(ROOT,"release",RELEASE)`；删除写死的 `v1.0pre3`。
2. `TAG` 取第一个非 flag 参数或 `INC_TAG`，默认 `v1.0.0-pre4`；`VERSION` 由 TAG 去掉前导 `v` 得到（`INC_VERSION` 可覆盖），与 `package.mjs` 对齐。
3. `REPOS` 从 4 个扩到 6 个：新增 `Infinity-Toolbox`（package `InfinityToolbox`）与 `Infinity-Games`（package `InfinityGames`）。
4. 新增 `--dry-run`：只发 GET，不创建 Release、不删除、不上传；打印每个应用的 PLAN 与本地文件名/字节/sha256。
5. `api()` 增加 `-w '%{http_code}'`，把 404（仓库不存在）与空成功响应区分开。
6. 新增 `withRetry()`：对 status 0（没连上）与 5xx 自动重试 4 次、退避 2s/4s/6s，覆盖 GET/POST/DELETE/上传。
7. 上传后校验 `name/size/digest(sha256)`；不一致时删除并重传，最多 3 轮。
8. **不再写** `cpp/release/<release>/release-assets.json`（避免覆盖 `package.mjs` 的 6 应用清单）；发布清单元数据改为打印到 stdout。
9. 新增 `scrub()`，所有日志/错误串里的令牌替换为 `<token>`（本次运行输出中未出现令牌明文）。
10. 不存在的仓库只报告并跳过，绝不自动创建；脚本只操作 TAG 指定的那个 Release，只删除与待传文件同名的那一个资产。
11. Release 说明文案从「四个应用」更新为「六个应用」，并补一句「本版新增 Infinity Toolbox 与 Infinity Games」。

## 7. 遗留与待办

- **源码仓库尚未同步**：`zssx-2026/Infinity.inc` 远端 HEAD 仍为 `7b189e41d3`（2026-10-02T12:00:11Z，129 files），远端 `cpp/tools/publish.mjs` 仍是 **6155 B 旧版**，本地新版为 15988 B。task-7 的「同步源码仓库」一项**尚未完成**，需要 Lead 决定何时用 `work/ghsync.mjs` 推送（本次验证未执行任何写操作）。
- IPM 目录页 `applications/application-inc` 仍是 4 个 pre3 条目（name.txt 424 B），是 task-8（rel-catalog）的写作范围，本报告只做「未变」确认。

## 8. 复现命令

```powershell
# 1) 令牌（用户级环境变量，长度 93；不要打印）
$env:EV_GH_TOKEN = [Environment]::GetEnvironmentVariable("EV_GH_TOKEN","User")

# 2) 发布前 dry-run（GET only）
node cpp/tools/publish.mjs --dry-run

# 3) 列 6 个 Release 的资产
foreach ($r in 'Infinity-Cloud','Infinity-File-Manager','InfinityPackageManager',
               'Infinity-Installer-Manager','Infinity-Toolbox','Infinity-Games') {
  curl.exe -sS --ssl-no-revoke -H ("Authorization: Bearer " + $env:EV_GH_TOKEN) ^
    -H "Accept: application/vnd.github+json" -H "User-Agent: Infinity.Inc" ^
    "https://api.github.com/repos/zssx-2026/$r/releases/tags/v1.0.0-pre4"
}

# 4) 回下载并校验
$dir='work/_pubcheck'; New-Item -ItemType Directory -Force $dir | Out-Null
$n='InfinityCloud_1.0.0-pre4_win64_setup.exe'   # 其余 5 个同理
curl.exe -sS -L --ssl-no-revoke -o "$dir/$n" ^
  "https://github.com/zssx-2026/Infinity-Cloud/releases/download/v1.0.0-pre4/$n"
(Get-FileHash -Algorithm SHA256 "$dir/$n").Hash.ToLower()
```

**判定：task-7 的发布与一致性验收全部 PASS（6/6 仓库、6/6 资产、sha256 四方一致）；仅「源码仓库同步」一项遗留，需 Lead 决定。**
