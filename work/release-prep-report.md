# v1.0pre5 发布预演与 Release 文案报告（task-12 / release-prep）

- 日期：2026-10-06（Asia/Shanghai）
- 工作区：`D:\dev\DeepSeekHarnessWorkspace\Infinity.inc`
- 角色：teammate `release-prep`，任务 `task-12`
- 目标：在不触碰任何网络写操作的前提下，把 v1.0.0-pre5 发布前能做的做完
- 结论：**预演被令牌门挡住（如实记录，未绕过）；Release 文案已成稿并 14/14 校验通过；距离真发布只差令牌 + 书面批准 + 冻结哈希。**

## 1. `publish.mjs --dry-run` 预演（步骤 1）

### 命令与输出（原始记录）

```powershell
& 'D:\program\nodejs\node.exe' 'cpp\tools\publish.mjs' --dry-run 2>&1
Write-Output ('__EXITCODE__=' + $LASTEXITCODE)
```

输出（逐字）：

```text
NO TOKEN (set EV_GH_TOKEN)
__EXITCODE__=1
```

- **node 退出码：1**（外层 pwsh 包装进程因随后打印 `$LASTEXITCODE` 而返回 0，退出码以 node 自身为准）。
- **不要误读**：这次失败不是网络/API 问题，而是脚本的**前置令牌门**——`cpp/tools/publish.mjs` 在解析完参数后、进入任何网络调用之前执行：

```js
const token = process.env.EV_GH_TOKEN || '';
if (!token) { console.log('NO TOKEN (set EV_GH_TOKEN)'); process.exit(1); }
```

- 因此本机环境无 `EV_GH_TOKEN` 时，**连 `--dry-run` 也进不去**：脚本在 6 个应用循环开始前就退出，**本次预演实际发生 0 次网络请求**。
- 只读网络约束下我**没有伪造/借用令牌**去强行触发 GET：任务明确要求「若脚本要求令牌才能预演，如实记录并说明」，且伪造 Bearer 会让 GitHub 收到无效凭据请求，收益为零。
- 令牌存在性检查（只打印布尔与长度，绝不打印值）：`EV_GH_TOKEN_present=False length=0`、`GH_TOKEN_present=False`。

### 用静态审查补足「dry-run 是 GET-only」的证据

在无令牌的情况下无法跑通，因此我通读了 `cpp/tools/publish.mjs`（352 行）确认预演路径的写操作不可达：

- `--dry-run` 时 `DRY_RUN=true`；`ensureRelease()` 的 `if (DRY_RUN) return null;` 位于任何 `POST /releases` 之前——**不会创建 Release**。
- `uploadAsset()`（`POST uploads.github.com`）与 `deleteAsset()`（`DELETE`）只在非 dry-run 分支调用，dry-run 分支在 `continue` 前就结束循环体。
- dry-run 分支实际只会发出：`GET /repos/{owner}/{repo}`、`GET /repos/{owner}/{repo}/releases?per_page=100`、`GET /repos/{owner}/{repo}/releases/tags/{tag}`，并对每个存在的同名资产打印「同尺寸→比摘要/不同→先删再传」的**计划文本**。
- 因此：**一旦有合法令牌，`--dry-run` 全程只有 GET**，符合只读网络硬约束；唯一的写操作都排在 dry-run 之后。

## 2. Release 文案（步骤 2）

- 路径：`docs/RELEASE-v1.0pre5-body.md`
- 字节数：**11,120 B**（UTF-8，117 行）；sha256 未写入正文以免污染 14 项校验集合。
- 素材来源：`docs/RELEASE-v1.0pre5.md`、`cpp/release/v1.0pre5/release-assets.json`、`installers/packaging/v1.0pre5/SHA256SUMS.txt`、`work/release-v1.0pre5-report.md`（ING 归属说明取自其第 6 节）。
- 正文表格中的字节数与 sha256 **不是手抄**：由一次性脚本直接读 `release-assets.json` 与 `SHA256SUMS.txt` 生成行，杜绝转录错误。
- 已覆盖任务要求的全部区块：简介、六应用与安装包表（字节+sha256+发布页+直链）、随附 8 项校验值（name.txt / release-assets.json / 6 个 .ico）、校验方法（Get-FileHash / certutil / SHA256SUMS.txt 批量 / sha256sum -c）、系统要求、已知问题与限制（8 条）、ING 归属说明、相关文件。
- 六个安装包合计 **1,912,869 B**（514,535+238,305+288,313+306,796+296,537+268,383），与 `work/release-v1.0pre5-report.md` / `ghsync` 的 `total bytes: 1912869` 一致。

## 3. 文案 sha256 与磁盘比对（步骤 3）

一次性 Node 片段（经 pwsh stdin 执行，未落盘临时文件）：抽取正文中全部 64 位十六进制串，逐条在 `installers/packaging/v1.0pre5/` 重算比对，并回查集合覆盖度。

```text
OK   2bb448c1fd0c35f9ae8fb6ed0f32a3185444f5a52943663f4f1db5d846761544  <= InfinityCloud_1.0.0-pre5_win64_setup.exe (514535 B)
OK   4ea7673c84cd47be7d0da1d603a36d44e6b1c0886456ea2025f8e66ec18ff310  <= InfinityFileManager_1.0.0-pre5_win64_setup.exe (238305 B)
OK   8295d0ad64c38778bd63f2f0eb028c33de2902406aa44c17673543cfc3c8a3ee  <= InfinityPackageManager_1.0.0-pre5_win64_setup.exe (288313 B)
OK   3b0de0ed42a9dd9270e6c9e90f1d1c0df837270e3337ab16c5e2a317c9419221  <= InfinityInstallerManager_1.0.0-pre5_win64_setup.exe (306796 B)
OK   fdd66258d5627771b879abb1829ed2b2ff00cc6feb8745c73ab8bdbc1e1fd2d3  <= InfinityToolbox_1.0.0-pre5_win64_setup.exe (296537 B)
OK   be13f9c615aa5131840c8c32d2b3da8e5fdc834e9811669cf0a443f15431398c  <= InfinityGames_1.0.0-pre5_win64_setup.exe (268383 B)
OK   8ba19832f532e7b5d0ae9825b192b4d44bc64bb31cdfa30277a92803e12f5c12  <= name.txt (614 B)
OK   cb619d53990345b7c049c64353df509e46f09ccdf95f6edbd75e4ab22a3d36f3  <= release-assets.json (2485 B)
OK   d0e3bd6a34dac65e3ac3a8ad46866db30027a43762612ba95250d524be969adb  <= icons/inc.ico (8425 B)
OK   255409a5ae4789ee74ddeb900df468e7b2a45b12f563bcdc0cfb2ec4baf6f8a6  <= icons/ifm.ico (8112 B)
OK   a19cf69e74bb946f6488f70dfcfe6e4b768707bac38e250a21ee3979acad09c4  <= icons/ipm.ico (9467 B)
OK   dc73410e1941cbbdb4a69ca862f4ecea3b63c943b6d7b495cf08394d9ae46e04  <= icons/iim.ico (7905 B)
OK   b84cf22e2a3d419db9f0fc4f12c26a113a60742599fa18afd4632209f0536b4e  <= icons/int.ico (8241 B)
OK   f774518c62b31cc6e52780473bb7f6d1d294d335a974109206b9e86115f74fa3  <= icons/ing.ico (8242 B)
RESULT 14/14  doc-hashes=14  disk-entries=14  disk-not-in-doc=0  exit=0
```

另做两项交叉检查：

1. `installers/packaging/v1.0pre5/SHA256SUMS.txt` 自身独立复算：**14/14**（第一次单独跑，exit=0）。
2. `cpp/release/v1.0pre5/*.exe` 与 `installers/packaging/v1.0pre5/*.exe` 逐字节：**same=6 diff=0**——文案里的哈希同时代表发行目录与打包目录。

## 4. 还需要什么才能真发布

按阻塞强度排序：

1. **`EV_GH_TOKEN`（硬阻塞）。** 现有令牌脚本用 `EV_GH_TOKEN`（也接受 `GH_TOKEN` 命名的是另一套，本脚本只认 `EV_GH_TOKEN`），需具备六个应用仓库的 Releases 写权限；只应注入到发布进程，任何输出都不得包含令牌（脚本已有 `scrub()` 兜底，但预演输出里也不应有）。
2. **Lead 书面批准（硬阻塞）。** `docs/RELEASE-v1.0pre5.md` 与 `work/release-v1.0pre5-report.md` 都写明「发布到 GitHub 前需 Lead 书面批准」。
3. **确认六个目标仓库存在。** `publish.mjs` 对 404 仓库只**报告并跳过**（`repo-missing`），绝不创建仓库：需确认 `zssx-2026/Infinity-Cloud`、`Infinity-File-Manager`、`InfinityPackageManager`、`Infinity-Installer-Manager`、`Infinity-Toolbox`、`Infinity-Games` 均已存在且允许该令牌写入。
4. **冻结哈希：先确认并行任务是否还会改产物。** 任务 `icon-rc`（windres `.rc` 接入 exe 资源段）与 `verifier-e2e` 若重建/重打包，`release-assets.json`、`SHA256SUMS.txt` 与本文案**全部哈希都会失效**。正确顺序：等这些任务收敛 → 重跑 `node cpp\tools\manifest.mjs v1.0pre5 1.0.0-pre5` → 重生成 `docs/RELEASE-v1.0pre5-body.md`（本文案可用同样脚本再生成）→ 再上传。
5. **文案与 `publish.mjs` 内嵌 BODY 的关系（容易遗漏）。** `publish.mjs` 创建 Release 时用的是脚本第 108 行附近写死的短 BODY（7 条要点），**不会自动读取 `docs/RELEASE-v1.0pre5-body.md`**。若要 GitHub 上的 Release 正文就是本文案，需要：把该常量替换为本文案内容，或发布后在 GitHub 上手动粘贴/编辑正文。二者取其一，需 Lead 定夺。
6. **真发命令（批准后）。** `& 'D:\program\nodejs\node.exe' 'cpp\tools\publish.mjs'`（去掉 `--dry-run`；默认 tag `v1.0.0-pre5`、release 目录 `v1.0pre5`，可用 `INC_RELEASE`/`INC_TAG`/`INC_VERSION` 覆盖）。脚本会逐仓库创建 `draft=false、prerelease=true` 的 Release、上传、再用 `GET /releases/tags/{tag}` 回读 size 与 `digest` 复核。
7. **建议补的复核（非阻塞）。** 发布机上跑一次 `7z l` 核对 NSIS 载荷清单（本机只有内置 `7za`，不支持 NSIS）；把 `verifier-e2e` 的静默安装→卸载结论补进 `docs/RELEASE-v1.0pre5.md` 的已知问题区（若已结论）。

## 5. 硬约束遵守情况

- **网络**：仅允许只读 GET；本次实际 **0 次网络请求**（被令牌门挡住），更没有任何 push / create / upload / delete。
- **写入**：只写了 `docs/RELEASE-v1.0pre5-body.md` 与 `work/release-prep-report.md` 两个文件；临时脚本用 pwsh stdin 喂给 node，未落盘。
- **未触碰**：`ING` / `Infinity Games` / `history/` / `work/sync-history.mjs`（`cpp/apps/ing/**`、`icons/ing.ico` 只读引用）。
- **禁装禁下**：未下载、未安装任何东西；只用本机 `D:\program\nodejs\node.exe`（v24.19.0）与 Windows PowerShell 5.1。
- **无窗口/无弹窗**：全部命令为普通前台调用，未使用 `Start-Process`（该机因 `NO_PROXY`/`no_proxy` 大小写重复会抛异常）。

## 6. 交付物

| 文件 | 字节 | 说明 |
| --- | ---: | --- |
| `docs/RELEASE-v1.0pre5-body.md` | 11,120 | 可直接粘贴的 GitHub Release 正文（中文，14 项校验值） |
| `work/release-prep-report.md` | 本文件 | 预演、文案、校验与遗留 |

命令与退出码汇总：`node cpp\tools\publish.mjs --dry-run` → node exit **1**（`NO TOKEN (set EV_GH_TOKEN)`，0 网络）；14 项 sha256 复算 → exit **0**，`14/14`；文案 vs 磁盘 → exit **0**，`14/14`。
