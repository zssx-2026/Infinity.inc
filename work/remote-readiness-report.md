# 远程发布就绪只读检查报告（task-17）

- 检查人：remote-ready（teammate）
- 检查时间：2026-10-06 13:35–14:01（Asia/Shanghai）
- 工作区：D:\dev\DeepSeekHarnessWorkspace\Infinity.inc
- 目标版本：目录 cpp/release/v1.0pre5，发布标签 v1.0.0-pre5
- 前提：本机 **未设置 EV_GH_TOKEN**（实测长度 0）
- 硬约束遵守情况：本次仅执行 **HTTP GET**（外加本地只读命令 git remote -v / git rev-parse / git tag -l / 列目录 / 读文件）。**没有任何 POST/PUT/PATCH/DELETE、没有上传、没有创建或删除任何远端对象、没有写 git 远端。** 唯一写入工作区的文件是本报告；ghsync 的运行日志通过 INC_GH_LOG 重定向到系统临时目录，未追加到 work/ghsync.log（该文件 mtime 仍为 2026-10-06 12:16:14，42031 B，早于本次检查）。

---

## 0. 结论摘要（TL;DR）

1. **node work\ghsync.mjs --dry-run --remote 退出码 0，但这份"绿灯"是假的。** 它把 8 个远端查询全部打成 **HTTP 401**（source: remote Infinity.inc pushed_at=?、6 个 release lookup HTTP 401、catalogue ... lookup HTTP 401），却仍打印 errors: 0 并 exit 0。根因已实测证明：脚本在 token 为空时仍发送 authorization: Bearer （空值），GitHub 对此返回 401 Bad credentials；去掉该头即 200。**因此发布当天不能用这个命令判定远端状态，必须先有 EV_GH_TOKEN。**
2. **8 个目标仓库全部存在且为 public**（含 6 个应用仓 + 目录仓 applications + 源码仓 Infinity.inc），默认分支均为 main。**不存在需要新建仓库的问题。**
3. **6 个应用仓都没有 v1.0.0-pre5 的 release，也没有该 tag（release 查询与 git ref 查询均 404）。** 发布时会新建 6 个 prerelease，然后各上传 1 个安装包——这是**需要写权限**的操作，也是"是否需要新建 release"的答案：**是，需要新建（由脚本自动创建）。**
4. **6 个应用仓不存在同名资产**（因为 pre5 release 不存在），所以应用仓侧没有 409 冲突；每个仓已有的 v1.0.0-pre4 release 不会被脚本碰。
5. **目录仓 applications / release application-inc 是唯一"已存在且会被改动"的远端对象**：它当前挂着 **6 个 pre4 安装包 + name.txt(614 B，内容是 pre4 清单)**。发布 pre5 会：删除并重传 name.txt（改为 pre5 清单）+ 上传 6 个 pre5 安装包，但**不会删除那 6 个 pre4 安装包**（脚本按"名字不同即视为外来资产保留"），结果页面会同时留 12 个安装包。需要人类决定是否清理 pre4。
6. **node cpp\tools\publish.mjs --dry-run 在无 token 时直接 NO TOKEN (set EV_GH_TOKEN) 退出 1**，任何 GET 都不发。它和 ghsync 会往同一批仓库写同一批文件，**发布当天必须二选一或明确分工**。
7. 外网可用、匿名只读 API 可用（本次匿名配额 60/h，结束时剩余 30），没有任何 TLS/代理阻塞。真正的未知项只剩"令牌与人类决策"。

---

## 1. 命令 1：node work\ghsync.mjs --dry-run --remote

执行方式（把运行日志重定向到临时目录，避免污染工作区；node 为 v24 路径）：

```
$env:INC_GH_LOG = "$env:TEMP\inc-ghsync-dryrun.log"
Set-Location 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
& 'D:\program\nodejs\node.exe' 'work\ghsync.mjs' --dry-run --remote 2>&1
```

**退出码：EXITCODE=0**（原样记录，未做任何二次重试）

原始输出（逐行原样）：

```
[2026-10-06T05:42:46.960Z] DRY RUN (local validation + read-only GitHub GETs): no release, no asset, no catalogue write, no git push
[2026-10-06T05:42:46.982Z] manifest: D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/cpp/release/v1.0pre5/release-assets.json
[2026-10-06T05:42:46.983Z] tag: v1.0.0-pre5   version: 1.0.0-pre5   directory: v1.0pre5   assets: 6
[2026-10-06T05:42:46.984Z] stale guard: ok (no older pre<N> in tag, asset names or name.txt)
[2026-10-06T05:42:46.987Z] entry InfinityCloud_1.0.0-pre5_win64_setup.exe [Infinity-Cloud] -> EXISTS 514897 B sha256=0d5d9fcd91d9a41b44334c06628fa1c5950d0728b96c0a5c6243032d93e4dc0c (matches manifest)
[2026-10-06T05:42:46.988Z]   source path: D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/cpp/release/v1.0pre5/InfinityCloud_1.0.0-pre5_win64_setup.exe
[2026-10-06T05:42:46.988Z]   catalog line: InfinityCloud_1.0.0-pre5_win64_setup.exe Infinity.Inc InfinityCloud setup Infinity.Inc win64
[2026-10-06T05:42:46.990Z] entry InfinityFileManager_1.0.0-pre5_win64_setup.exe [Infinity-File-Manager] -> EXISTS 238722 B sha256=535fb6ecdba1512e12f518bb7a414c886b7239ae1ada22e50f5f2e4a323a0a5d (matches manifest)
[2026-10-06T05:42:46.990Z]   source path: D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/cpp/release/v1.0pre5/InfinityFileManager_1.0.0-pre5_win64_setup.exe
[2026-10-06T05:42:46.991Z]   catalog line: InfinityFileManager_1.0.0-pre5_win64_setup.exe Infinity.Inc InfinityFileManager setup Infinity.Inc win64
[2026-10-06T05:42:46.992Z] entry InfinityPackageManager_1.0.0-pre5_win64_setup.exe [InfinityPackageManager] -> EXISTS 288570 B sha256=2b59a4df0d0ec5188c7a5ad8379d25de812380ee0fec25593805b702687ba532 (matches manifest)
[2026-10-06T05:42:46.993Z]   source path: D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/cpp/release/v1.0pre5/InfinityPackageManager_1.0.0-pre5_win64_setup.exe
[2026-10-06T05:42:46.993Z]   catalog line: InfinityPackageManager_1.0.0-pre5_win64_setup.exe Infinity.Inc InfinityPackageManager setup Infinity.Inc win64
[2026-10-06T05:42:46.994Z] entry InfinityInstallerManager_1.0.0-pre5_win64_setup.exe [Infinity-Installer-Manager] -> EXISTS 307194 B sha256=669bee8be05bd6a3df826ca91a81719d4c0383ff22b10fe1066971d63720615d (matches manifest)
[2026-10-06T05:42:46.995Z]   source path: D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/cpp/release/v1.0pre5/InfinityInstallerManager_1.0.0-pre5_win64_setup.exe
[2026-10-06T05:42:46.995Z]   catalog line: InfinityInstallerManager_1.0.0-pre5_win64_setup.exe Infinity.Inc InfinityInstallerManager setup Infinity.Inc win64
[2026-10-06T05:42:46.996Z] entry InfinityToolbox_1.0.0-pre5_win64_setup.exe [Infinity-Toolbox] -> EXISTS 297021 B sha256=1806f62100227ba3f8e6d97b570fb676a6ee51c262722becdfa366596b6670ac (matches manifest)
[2026-10-06T05:42:46.997Z]   source path: D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/cpp/release/v1.0pre5/InfinityToolbox_1.0.0-pre5_win64_setup.exe
[2026-10-06T05:42:46.997Z]   catalog line: InfinityToolbox_1.0.0-pre5_win64_setup.exe Infinity.Inc InfinityToolbox setup Infinity.Inc win64
[2026-10-06T05:42:47.000Z] entry InfinityGames_1.0.0-pre5_win64_setup.exe [Infinity-Games] -> EXISTS 268784 B sha256=0a6d18c405f164d76cb7a548facf6aecab3647b18879ee83ed4c454b274a7bfb (matches manifest)
[2026-10-06T05:42:47.000Z]   source path: D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/cpp/release/v1.0pre5/InfinityGames_1.0.0-pre5_win64_setup.exe
[2026-10-06T05:42:47.001Z]   catalog line: InfinityGames_1.0.0-pre5_win64_setup.exe Infinity.Inc InfinityGames setup Infinity.Inc win64
[2026-10-06T05:42:47.001Z] entries: 6   total bytes: 1915188
[2026-10-06T05:42:48.090Z] source: local master@3e3a58a, tracked=258, working-tree changes=4382
[2026-10-06T05:42:48.091Z] source: would run  git push -u origin HEAD:main --force
[2026-10-06T05:42:48.091Z] source: would leave out 1146 path(s): Chormium/ifm/icudtl.dat [over 8388608 B], Chormium/ifm/resources.pak [over 8388608 B], Chormium/iim/icudtl.dat [over 8388608 B], Chormium/iim/resources.pak [over 8388608 B], Chormium/inc/icudtl.dat [over 8388608 B], Chormium/inc/resources.pak [over 8388608 B], Chormium/ing/icudtl.dat [over 8388608 B], Chormium/ing/resources.pak [over 8388608 B], Chormium/int/icudtl.dat [over 8388608 B], Chormium/int/resources.pak [over 8388608 B] ...
[2026-10-06T05:42:48.762Z] source: remote Infinity.inc pushed_at=?
[2026-10-06T05:42:49.354Z] asset InfinityCloud_1.0.0-pre5_win64_setup.exe [Infinity-Cloud]: release lookup HTTP 401
[2026-10-06T05:42:50.608Z] asset InfinityFileManager_1.0.0-pre5_win64_setup.exe [Infinity-File-Manager]: release lookup HTTP 401
[2026-10-06T05:42:51.677Z] asset InfinityPackageManager_1.0.0-pre5_win64_setup.exe [InfinityPackageManager]: release lookup HTTP 401
[2026-10-06T05:42:52.309Z] asset InfinityInstallerManager_1.0.0-pre5_win64_setup.exe [Infinity-Installer-Manager]: release lookup HTTP 401
[2026-10-06T05:42:54.191Z] asset InfinityToolbox_1.0.0-pre5_win64_setup.exe [Infinity-Toolbox]: release lookup HTTP 401
[2026-10-06T05:42:54.893Z] asset InfinityGames_1.0.0-pre5_win64_setup.exe [Infinity-Games]: release lookup HTTP 401
[2026-10-06T05:42:55.661Z] catalogue application-inc: lookup HTTP 401
[2026-10-06T05:42:55.662Z] errors: 0
[2026-10-06T05:42:55.662Z] DRY RUN complete: 0 errors

EXITCODE=0
```

### 1.1 本地校验部分：通过

- stale guard: ok（tag / 资产名 / name.txt 里没有比 pre5 更旧的 pre<N>）。
- 6 个安装包全部 **EXISTS**，字节数与 release-assets.json 完全一致，sha256 与清单一致；合计 **1,915,188 B**。
- cpp/release/v1.0pre5 目录实测：6 个 exe 共 1,915,188 B，另有 name.txt 614 B、release-assets.json 2485 B。
- 本地 git remote -v 为 https://github.com/zssx-2026/Infinity.inc.git（fetch/push），当前分支 master @ 3e3a58a；git config --get-regexp proxy 无输出（本机当前没有 git 代理项）。

### 1.2 远端部分：全部 401，dry-run 结论无效

| 查询 | 输出 | HTTP |
|---|---|---|
| 源码仓 Infinity.inc | source: remote Infinity.inc pushed_at=? | 401（data 为 null，所以显示 ?） |
| Infinity-Cloud 的 v1.0.0-pre5 release | release lookup HTTP 401 | 401 |
| Infinity-File-Manager | 同上 | 401 |
| InfinityPackageManager | 同上 | 401 |
| Infinity-Installer-Manager | 同上 | 401 |
| Infinity-Toolbox | 同上 | 401 |
| Infinity-Games | 同上 | 401 |
| applications / application-inc | catalogue application-inc: lookup HTTP 401 | 401 |

**根因实测（GET，两组对照）：**

```
# A) 完全复刻 ghsync 在 token 为空时发送的请求头
curl.exe -sS --ssl-no-revoke --max-time 20 -o NUL -w 'HTTP=%{http_code}' \
  -H 'authorization: Bearer ' -H 'accept: application/vnd.github+json' \
  -H 'user-agent: infinity-inc' https://api.github.com/repos/zssx-2026/Infinity-Cloud
HTTP=401
{"message":"Bad credentials","documentation_url":"https://docs.github.com/rest","status":"401"}

# B) 对照组：不带 Authorization 头（匿名只读）
curl.exe -sS --ssl-no-revoke --max-time 20 -o NUL -w 'HTTP=%{http_code}' \
  -H 'accept: application/vnd.github+json' \
  -H 'user-agent: infinity-inc' https://api.github.com/repos/zssx-2026/Infinity-Cloud
HTTP=200
```

**结论：** work\ghsync.mjs 的 api()（第 297–304 行）无条件附加 authorization: Bearer ，token 为空时变成"空 Bearer"，GitHub 直接 401；而 dryRun() 对 401 只打印一行、既不置错也不改退出码，于是 errors: 0 / exit 0。**发布当天若照这个退出码放行，等于没做任何远端检查。**

---

## 2. 命令 2：匿名只读 GitHub API（Invoke-RestMethod，GET only）

```
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$H = @{ 'User-Agent'='infinity-inc-readonly'; 'Accept'='application/vnd.github+json' }
Invoke-RestMethod -Uri 'https://api.github.com/repos/zssx-2026/<repo>' -Headers $H -TimeoutSec 25
```

### 2.1 目标仓库是否存在（每个仓库 1 次 GET）

| 仓库 | HTTP | 存在 | private | 默认分支 | pushed_at |
|---|---|---|---|---|---|
| Infinity.inc（源码） | 200 | 是 | False | main | 2026-10-04T12:16:57Z |
| Infinity-Cloud | 200 | 是 | False | main | 2026-10-04T07:08:54Z |
| Infinity-File-Manager | 200 | 是 | False | main | 2026-10-04T07:09:01Z |
| InfinityPackageManager | 200 | 是 | False | main | 2026-10-04T07:09:07Z |
| Infinity-Installer-Manager | 200 | 是 | False | main | 2026-10-04T07:09:12Z |
| Infinity-Toolbox | 200 | 是 | False | main | 2026-10-04T07:09:17Z |
| Infinity-Games | 200 | 是 | False | main | 2026-10-04T07:09:22Z |
| applications（目录页） | 200 | 是 | False | main | 2026-10-04T12:20:31Z |

账号 zssx-2026 存在，public_repos=12。**8 个目标仓库全部存在且公开，无 404 风险。**

### 2.2 v1.0.0-pre5 的 release / tag 是否已存在（GET only）

GET /repos/zssx-2026/<repo>/releases/tags/v1.0.0-pre5：

| 仓库 | release tag HTTP | 结论 |
|---|---|---|
| Infinity-Cloud | **404** | 无 pre5 release |
| Infinity-File-Manager | **404** | 无 pre5 release |
| InfinityPackageManager | **404** | 无 pre5 release |
| Infinity-Installer-Manager | **404** | 无 pre5 release |
| Infinity-Toolbox | **404** | 无 pre5 release |
| Infinity-Games | **404** | 无 pre5 release |
| applications / application-inc | **200**（id=398198245, draft=False, prerelease=False, assets=7） | 目录页已存在 |

GET /repos/zssx-2026/<repo>/git/ref/tags/v1.0.0-pre5（用于区分"只有 tag 没有 release"）：

| 仓库 | tag ref HTTP | 结论 |
|---|---|---|
| 上述 6 个应用仓 | **404** | tag 也不存在 → 应用仓干净，pre5 从零创建 |
| applications / application-inc | 200，sha=79c5b8811dd281768002a6876ea5deaf913dd594 | 目录页 tag 已存在 |

**因此"是否需要新建 release"的答案是：6 个应用仓各需新建 1 个 prerelease（POST /releases，需要写权限）；目录页不需要新建，直接复用 application-inc。**

### 2.3 同名资产（409 风险点）

- 6 个应用仓：pre5 release 不存在 ⇒ **不存在同名资产**，publish.mjs 的"同名资产需先删除"分支不会被触发，也没有 409 冲突。
- applications / application-inc 现有资产（GET release 结果，7 个）：

```
InfinityCloud_1.0.0-pre4_win64_setup.exe             size=477846  state=uploaded
InfinityFileManager_1.0.0-pre4_win64_setup.exe       size=235017  state=uploaded
InfinityGames_1.0.0-pre4_win64_setup.exe             size=262882  state=uploaded
InfinityInstallerManager_1.0.0-pre4_win64_setup.exe  size=302978  state=uploaded
InfinityPackageManager_1.0.0-pre4_win64_setup.exe    size=278021  state=uploaded
InfinityToolbox_1.0.0-pre4_win64_setup.exe           size=262473  state=uploaded
name.txt                                             size=614     state=uploaded
```

- 这 7 个资产里**没有任何 pre5 名字**，所以 ghsync 的 ?name=<pre5 名字> 上传不会撞名（无 409）。
- **但 name.txt 的内容是 pre4 清单**（见 2.5），且字节数恰好也是 614 B，与 pre5 清单等长——这触发一处 dry-run 与真实运行的判断分歧（见第 5 节 R3）。

### 2.4 各应用仓已有 release（GET /releases?per_page=100）

| 仓库 | 已有 release（tag(资产数)） |
|---|---|
| Infinity-Cloud | v1.0.0-pre4(1), v1.0.0-pre3(1), v1.0pre1(40), v1.0pre2(3), v0.1(40) |
| Infinity-File-Manager | v1.0.0-pre4(1), v1.0.0-pre3(1), v1.0pre1(40), v1.0pre2(3) |
| InfinityPackageManager | v1.0.0-pre4(1), v1.0.0-pre3(1), v1.0pre1(60), v1.0pre2(3) |
| Infinity-Installer-Manager | v1.0.0-pre4(1), v1.0.0-pre3(1) |
| Infinity-Toolbox | v1.0.0-pre4(1) |
| Infinity-Games | v1.0.0-pre4(1) |

每个仓都有 pre4 各 1 个资产；publish.mjs 明确只动 TAG 指定的 release，pre4 不会被碰。

### 2.5 目录页 name.txt 现网内容 vs 本地 pre5 清单

```
# 下载（GET，带 -L 跟随 302 到 objects.githubusercontent.com）
curl.exe -sSL --ssl-no-revoke --max-time 30 -o "$env:TEMP\inc-cat-nametxt.txt" \
  'https://github.com/zssx-2026/applications/releases/download/application-inc/name.txt'
HTTP=200 size=614
local exists=True bytes=614 ; remote bytes=614
identical=False
```

现网 name.txt 6 行全部是 **pre4**；本地 cpp/release/v1.0pre5/name.txt 6 行全部是 **pre5**：

```
line 1 LOCAL : InfinityCloud_1.0.0-pre5_win64_setup.exe Infinity.Inc InfinityCloud setup Infinity.Inc win64
line 1 REMOTE: InfinityCloud_1.0.0-pre4_win64_setup.exe Infinity.Inc InfinityCloud setup Infinity.Inc win64
line 2 LOCAL : InfinityFileManager_1.0.0-pre5_win64_setup.exe Infinity.Inc InfinityFileManager setup Infinity.Inc win64
line 2 REMOTE: InfinityFileManager_1.0.0-pre4_win64_setup.exe Infinity.Inc InfinityFileManager setup Infinity.Inc win64
line 3 LOCAL : InfinityPackageManager_1.0.0-pre5_win64_setup.exe Infinity.Inc InfinityPackageManager setup Infinity.Inc win64
line 3 REMOTE: InfinityPackageManager_1.0.0-pre4_win64_setup.exe Infinity.Inc InfinityPackageManager setup Infinity.Inc win64
line 4 LOCAL : InfinityInstallerManager_1.0.0-pre5_win64_setup.exe Infinity.Inc InfinityInstallerManager setup Infinity.Inc win64
line 4 REMOTE: InfinityInstallerManager_1.0.0-pre4_win64_setup.exe Infinity.Inc InfinityInstallerManager setup Infinity.Inc win64
line 5 LOCAL : InfinityToolbox_1.0.0-pre5_win64_setup.exe Infinity.Inc InfinityToolbox setup Infinity.Inc win64
line 5 REMOTE: InfinityToolbox_1.0.0-pre4_win64_setup.exe Infinity.Inc InfinityToolbox setup Infinity.Inc win64
line 6 LOCAL : InfinityGames_1.0.0-pre5_win64_setup.exe Infinity.Inc InfinityGames setup Infinity.Inc win64
line 6 REMOTE: InfinityGames_1.0.0-pre4_win64_setup.exe Infinity.Inc InfinityGames setup Infinity.Inc win64
```

### 2.6 匿名 API 配额

```
GET /rate_limit  -> core limit=60 remaining=60（起始）
本次检查结束时   -> core limit=60 remaining=30
```

全程无 403 / rate-limit 限流，TLS（schannel）+ --ssl-no-revoke 正常，网络不构成阻塞。**匿名只读完全可用，唯一缺的是写权限令牌。**

---

## 3. 命令 3：node cpp\tools\publish.mjs --dry-run

```
Set-Location 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc'
& 'D:\program\nodejs\node.exe' 'cpp\tools\publish.mjs' --dry-run
```

原始输出与退出码：

```
NO TOKEN (set EV_GH_TOKEN)

EXITCODE=1
```

**结论：** cpp/tools/publish.mjs 第 59–60 行在发任何请求之前就要求 EV_GH_TOKEN；即使 --dry-run 本身是 GET-only 也不放行。所以"用 publish.mjs --dry-run 做发布前只读预演"这条路，**必须先有令牌**。（脚本行为本身正确、安全：无令牌即退出，未发请求、未写任何东西。docs/RELEASE-v1.0pre5-body.md 已存在，真实运行会用该文档作为 release body。）

---

## 4. 发布当天各脚本会做的写操作（GET-only 检查的推论，未执行）

| 对象 | 工具 | 将发生的写操作 | 需要的权限 |
|---|---|---|---|
| zssx-2026/Infinity.inc | ghsync（pushSource） | git remote add origin https://<TOKEN>@... 后 git push -u origin HEAD:main --force（本地 master@3e3a58a，258 tracked，工作树 4382 项变更，1146 个路径将被排除）；失败则退化为一串 Git Data API POST/PATCH 写远程 | 仓库 Contents 写 + git push（public_repo） |
| zssx-2026/Infinity.inc | ghsync（ensureRepo） | 仅当 GET /repos/... 非 200 时会 POST /user/repos 建仓；令牌有效且仓库存在时不会触发 | 建仓权限（正常路径不需要） |
| 6 个应用仓 | ghsync 或 publish.mjs | 各 POST /releases 新建 v1.0.0-pre5 prerelease；各 POST uploads.github.com 上传 1 个安装包（无同名资产，无需删除） | Contents 写 |
| applications / application-inc | ghsync（publishCatalog） | 复用已有 release；DELETE name.txt（旧 pre4 清单）→ 上传 6 个 pre5 安装包 + 新 name.txt；**pre4 安装包按代码逻辑保留不删** | Contents 写 + 删除资产 |
| applications / application-inc | publish.mjs | publish.mjs 不碰目录页（只处理 6 个应用仓） | — |

---

## 5. 风险清单

| ID | 风险 | 证据 | 影响 |
|---|---|---|---|
| R1 | **ghsync --dry-run --remote 在无 token 时"假绿灯"**：所有远端查询 401，仍 errors: 0、退出码 0 | 命令 1 原始输出；1.2 的 A/B 对照 | 高：发布当天会误判远端就绪 |
| R2 | **ghsync 真实运行在无 token 时的首步是写操作**：ensureRepo 先 GET，401/404 后走 POST /user/repos；pushSource 会把空 token 拼进 remote URL | ghsync 第 353–362、388–389 行；命令 1 输出 401 | 中：无 token 的真实运行不会只读，必须确保仓库已存在且令牌有效 |
| R3 | **dry-run 与真实运行对 name.txt 的判定不一致**：dry-run 只用字节数比较（第 739 行），现网 pre4 name.txt 与本地 pre5 恰好都是 614 B，dry-run 会报 already current, would not be rewritten 且 would delete 里不含 name.txt；真实 publishCatalog 的 same 判定因安装包名不同而为 false，删除循环（第 576–583 行）会先 DELETE name.txt 再重传 | 2.5 实测（内容不同、字节相同）；代码第 564–583、739 行 | 中：dry-run 低估目录页改动（实际会短时删除 name.txt）。本项为代码级推断（带令牌的 dry-run 因无令牌未能执行） |
| R4 | **目录页 pre4 安装包将残留**：发布后 application-inc 会同时有 6 个 pre4 + 6 个 pre5 安装包，页面 name.txt 只列 pre5 | 2.3 资产列表；ghsync 第 576–583 行"外来资产保留"逻辑 | 中：旧包仍可下载、仓库膨胀；需人类决定清理 |
| R5 | **ghsync 与 publish.mjs 职责重叠**：两者都会往 6 个应用仓建 release/传同一批 exe；ghsync 还会强推源码和重写目录页 | 第 4 节端点表 | 中：同时跑会重复劳动、body 文案不一致（ghsync 用 Infinity.Inc build <tag>，publish.mjs 用 docs/RELEASE-v1.0pre5-body.md） |
| R6 | **源码强推 main**：git push -u origin HEAD:main --force，本地分支为 master，工作树有 4382 项变更、1146 个路径被排除（含 Chromium 大文件） | 命令 1 的 source 段 | 中高：需人类确认"强推 main"是预期，并复核将被提交的内容 |
| R7 | 应用仓 v1.0pre1/pre2 等早期 release 保留 40–60 个资产，ghsync 的目录页清理只处理 ^InfinityCloud_v0\.1_ 这一类 | 2.4；ghsync 第 279 行 | 低：不影响 pre5 发布 |

---

## 6. 发布前必须由人类提供 / 决策的东西

**A. 令牌（硬前提，缺一不可）**
1. 提供一个 EV_GH_TOKEN（当前为空）。需要能对 zssx-2026 的 **Infinity.inc、6 个应用仓、applications** 共 8 个仓库做：
   - Contents **Read and write**（建 release、上传/删除资产、git push）；ghsync 的建仓回退还需要 **Administration: write**（仅建仓回退路径用；仓库已存在时正常不会用）。
   - 经典 PAT：public_repo（8 个仓库均公开）；细粒度 PAT：对上述 8 仓 Contents: Read and write。
2. 令牌**只供发布命令本次使用**，不要写入任何文件；ghsync/publish.mjs 都有 scrub 逻辑，不要 echo 它。
3. 决定用哪个令牌主体/账号（所有仓库 owner 均为 zssx-2026，脚本里 OWNER 硬编码为该值）。

**B. 仓库清单核对（本次已由匿名 GET 核实，供人类确认）**
4. 确认 8 个目标仓库就是：Infinity.inc（源码）、Infinity-Cloud、Infinity-File-Manager、InfinityPackageManager、Infinity-Installer-Manager、Infinity-Toolbox、Infinity-Games、applications（目录页）——**全部存在、全公开、默认分支 main，无需新建仓库**。
5. 确认不会新增/改名任何仓库；若清单有变，先告知。

**C. Release 策略**
6. 确认 **6 个应用仓的 v1.0.0-pre5 release 由脚本新建**（当前不存在，也没有同名 tag/资产；pre4 不受影响）。
7. 确认目录页**复用现有 application-inc release**，不新建目录页 release。
8. 决定目录页 **6 个 pre4 安装包是否清理**（脚本不会删；如需删除属于写操作，需人类明确授权，用带令牌的 DELETE，本次不执行）。

**D. 发布入口与源码**
9. 决定发布入口唯一化：work/ghsync.mjs（含强推源码 + 写目录页，release body 为通用文案）还是 cpp/tools/publish.mjs（仅 6 个应用仓，用 docs/RELEASE-v1.0pre5-body.md 作为 body），或明确两者先后与分工。
10. 确认源码 git push -u origin HEAD:main --force（master@3e3a58a，强推）是预期；并确认 1146 个被排除路径（Chromium 大文件等）与 4382 项工作树变更中不含不应公开的内容。
11. 确认是否先执行"带令牌的 ghsync --dry-run --remote 与 publish.mjs --dry-run"再做真实发布（建议：这是唯一能验证 R3 的方式）。
12. 确认 release 文案：docs/RELEASE-v1.0pre5-body.md 已存在，将作为 publish.mjs 的 release body。

**E. 网络异常兜底（本次未发生）**
13. 本次网络与匿名只读 API 均正常，不存在"本机无外网"的情形，因而没有需要记录的连接错误/HTTP 状态码异常；若发布当天网络异常，所有 curl 都是 --max-time 有界（ghsync 300 s/次 ×8，publish.mjs 3600 s/次，带 4 次重试），不会无限挂起，但会拉长发布窗口。

---

## 7. 可复核的原始数据（汇总）

- ghsync dry-run 退出码：**0**；远端查询：**8 个全 401**（含源码仓、6 应用仓、目录仓）。
- publish.mjs --dry-run 退出码：**1**（NO TOKEN (set EV_GH_TOKEN)）。
- 匿名 GET：账号 200；8 仓全部 200 且 private=false；6 个应用仓 releases/tags/v1.0.0-pre5 = 404、git/ref/tags/v1.0.0-pre5 = 404；applications/application-inc = 200（7 资产）。
- 本地 pre5 安装包：6 个，共 1,915,188 B，sha256 全部与 release-assets.json 一致。
- 匿名 API 配额：60/h，检查结束剩余 30。
- 工作区写入：**仅本报告**；work/ghsync.log 未被本次运行改动（mtime 2026-10-06 12:16:14）。

> 说明：本报告所有远端状态均来自 **匿名只读 GET**（无令牌），因而不是"以发布账号视角"的权限验证；令牌实际权限是否符合第 6 节要求，仍需人类提供令牌后由带令牌的 dry-run 确认。
