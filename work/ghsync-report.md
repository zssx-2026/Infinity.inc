# work/ghsync.mjs 升级报告（六应用 / v1.0pre4）

- 任务：task-6（sync-repo）
- 日期：2026-10-06
- 结论：**干跑 0 错误、退出码 0，资产清单覆盖 inc/ifm/ipm/iim/int/ing 六个应用，脚本内已无任何过期版本号引用。**
- 硬约束遵守：**未执行任何 push / 网络操作**；只改 `work/ghsync.mjs` 与本草稿；未触碰 ING / Infinity Games 仓库 / `history/` / `work/sync-history.mjs`。
- 只读核对过的真实产物：`cpp/release/v1.0pre4/`（release-assets.json、name.txt、6 个 exe）、`cpp/out/{inc,ifm,ipm,iim,int,ing}`（中间产物）、`README.md`（版本号 v1.0.0-pre4、六应用表）、`cpp/tools/package.mjs`、`cpp/tools/publish.mjs`。仓库根目录**没有** `installers/` 目录（`packaging` 只存在于 `temp/tools/runtimes` 的 Node 运行时里，与发行资产无关）。

## 1. 改动点（git diff：+258 / -116，仅 work/ghsync.mjs）

1. **删掉过期的 Node 时代资产表**：原 `ASSETS`（9 条，tag `v1.0pre2`，路径如 `InfinityPackageManager/build/setup/win64.exe`、`"Infinity Cloud/sourcecode/build/setup/win64.exe"`）在磁盘上**一个都不存在**；连带删除 `OBSOLETE`（EPM→IPM 旧名清理）。发行资产现在**唯一来源**是 `cpp/release/<version>/release-assets.json`，即当前 6 个 C++ 安装包。
2. **六应用覆盖与一致性校验（新增，缺失即显式报错）**：`EXPECTED_REPOS`（6 个仓库）与 `EXPECTED_APPS = inc/ifm/ipm/iim/int/ing`；校验清单资产数=6、仓库无重复且都在期望集合内、每个文件名形如 `<Package>_<version>_win64_setup.exe` 且携带 manifest 的 version、**每个来源文件必须存在**、大小与 manifest 一致、manifest 带 `sha256` 时逐字节哈希比对、`name.txt` 与清单双向一一对应。全部问题收集进 `RELEASE_PROBLEMS`，真实运行前直接退出 1。
3. **版本号不再硬编码**：删除原 `pre3` 专用守卫，改为相对版本比较——`staleFindings()` 以所选 release 目录的 `pre<N>` 为基准，任何更旧的 `pre<N>`（tag / 资产名 / name.txt 行）都会拒绝目录写入；对 pre5/pre6… 同样有效。脚本中已无 `pre3`、`v1.0pre2`、`pre4` 字面量（grep 结果为 0）。
4. **release 目录选择按数字排序**：`newestReleaseDir()` 原来用字典序 `sort()`（`v1.0pre10` 会排在 `v1.0pre9` 前），现按 `pre<N>` 数值排序，并以目录名推导 tag（`releaseDirToTag`：`v1.0pre4` → `v1.0.0-pre4`）与 manifest tag/version 交叉校验。
5. **干跑改为默认离线**：`--dry-run` 本地完成清单校验 + 本地 git 只读信息，**零网络调用**；只有显式加 `--remote` 才做只读 GitHub GET。新增 `localDryRun()` 逐条打印来源路径、`EXISTS/MISSING`、字节数、sha256 与 name.txt 目录行，并汇总 `entries / total bytes / errors`。
6. **退出码与错误计数修正**：干跑按问题数返回退出码（0 干净 / 1 有错），结束行打印真实错误数（此前会误报为 1）。
7. **日志路径可覆盖**：`INC_GH_LOG` 环境变量可改日志文件，使干跑不写入 `work/ghsync.log`（本次核对：该日志未改动）。

## 2. 关键命令与结果

```powershell
# 语法检查（node v24: D:\program\nodejs\node.exe）
& 'D:\program\nodejs\node.exe' --check 'work\ghsync.mjs'        # exit=0

# 默认干跑（自动选最新的 cpp/release：当前 v1.0pre4）
$env:INC_GH_LOG = Join-Path $env:TEMP 'ghsync-final-default.log'
& 'D:\program\nodejs\node.exe' 'work\ghsync.mjs' --dry-run       # exit=0

# 固定到 v1.0pre4 干跑（可复现）
$env:INC_RELEASE = 'v1.0pre4'
& 'D:\program\nodejs\node.exe' 'work\ghsync.mjs' --dry-run       # exit=0
```

### 默认干跑输出（节选，2026-10-06T01:23:34Z）

```
DRY RUN (local only, no network call): no release, no asset, no catalogue write, no git push
manifest: D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/cpp/release/v1.0pre4/release-assets.json
tag: v1.0.0-pre4   version: 1.0.0-pre4   directory: v1.0pre4   assets: 6
stale guard: ok (no older pre<N> in tag, asset names or name.txt)
entry InfinityCloud_1.0.0-pre4_win64_setup.exe [Infinity-Cloud] -> EXISTS 477846 B sha256=732f909f...f7a5 (matches manifest)
entry InfinityFileManager_1.0.0-pre4_win64_setup.exe [Infinity-File-Manager] -> EXISTS 235017 B sha256=a6062187...d5ae (matches manifest)
entry InfinityPackageManager_1.0.0-pre4_win64_setup.exe [InfinityPackageManager] -> EXISTS 278021 B sha256=56e8afb8...0ed7 (matches manifest)
entry InfinityInstallerManager_1.0.0-pre4_win64_setup.exe [Infinity-Installer-Manager] -> EXISTS 302978 B sha256=08ce3a05...d2f2 (matches manifest)
entry InfinityToolbox_1.0.0-pre4_win64_setup.exe [Infinity-Toolbox] -> EXISTS 262473 B sha256=4827d87c...89f2 (matches manifest)
entry InfinityGames_1.0.0-pre4_win64_setup.exe [Infinity-Games] -> EXISTS 262882 B sha256=96f0eb3e...9456 (matches manifest)
entries: 6   total bytes: 1819217
source: local master@3e3a58a, tracked=258, working-tree changes=4660
source: would run  git push -u origin HEAD:main --force (not attempted in this mode)
network: skipped (pass --remote for the read-only release and catalogue GETs)
errors: 0
DRY RUN complete: 0 errors
EXITCODE=0
```

### 条目清单（六应用，字节数与 SHA-256）

| # | 应用 | 仓库 | 文件名 | 字节 | SHA-256 |
|---|------|------|--------|------|---------|
| 1 | inc | Infinity-Cloud | InfinityCloud_1.0.0-pre4_win64_setup.exe | 477846 | 732f909f578864f1ead0c9539d40aa4e075c26a319d385fad5bacf671d85f7a5 |
| 2 | ifm | Infinity-File-Manager | InfinityFileManager_1.0.0-pre4_win64_setup.exe | 235017 | a6062187cb97e2c7f8732c17529932a2c8356fcc6c2b285a62f4de96caf3d5ae |
| 3 | ipm | InfinityPackageManager | InfinityPackageManager_1.0.0-pre4_win64_setup.exe | 278021 | 56e8afb8bff30cee76c7cc2184fb37f43ef2ec203060261eec6e11cfac2c0ed7 |
| 4 | iim | Infinity-Installer-Manager | InfinityInstallerManager_1.0.0-pre4_win64_setup.exe | 302978 | 08ce3a05d83e9d38b4fb696f156e580fcc04a9e30066a21c8a41f9061210d2f2 |
| 5 | int | Infinity-Toolbox | InfinityToolbox_1.0.0-pre4_win64_setup.exe | 262473 | 4827d87c0ab9eb8f319ee96d59062ffee350ff06e6c571d248d4a74f0fc789f2 |
| 6 | ing | Infinity-Games | InfinityGames_1.0.0-pre4_win64_setup.exe | 262882 | 96f0eb3e4e97044a8c02a4e06dba5a5f4b97de853a45ceba398ff07bfcfb9456 |

合计：6 个条目，**1,819,217 字节**；与 manifest 的 size/sha256、`name.txt` 6 行全部一致。

### 负数测试（证明“缺失显式报错”）

| 场景 | 命令/夹具 | 结果 |
|------|-----------|------|
| 只有 4 个应用的旧目录 | `$env:INC_RELEASE='v1.0pre3'; node work/ghsync.mjs --dry-run` | errors=3（无 version 字段 / 资产数 4≠6 / 缺 Infinity-Toolbox、Infinity-Games），**exit=1** |
| 目录不存在 | `$env:INC_RELEASE='v1.0pre999'; node work/ghsync.mjs --dry-run` | errors=1（`no cpp/release/<version>/release-assets.json found`），**exit=1** |
| 缺失文件 + 大小不符 + sha256 不符 | 临时目录夹具（TEMP 外置，跑完即删） | errors=3：`asset file missing: …/InfinityGames_…exe`、`asset size mismatch … manifest 5001 B, file 5000 B`、`asset sha256 mismatch …`，**exit=1** |

## 3. 遗留 / 说明

- **未做真实运行**：按要求没有执行 push、没有调用 GitHub API（`--remote` 存在但**未运行**）。因此远端 release 的“是否已是最新”只能由真实运行时的只读 GET 判断。
- **新版本自动接管**：release-v105 若随后产出 `cpp/release/v1.0pre5`，`newestReleaseDir()` 会按数值选中它；若该目录清单不完整或文件缺失，脚本会**显式报错退出 1**，不会静默发布旧版本。可用 `INC_RELEASE` 固定版本以复现。
- **catalog 旧资产清理**：`CATALOG_OBSOLETE`（Node v0.1 的 `InfinityCloud_v0.1_*`）保留在真实运行的清理逻辑里，属于历史遗留清理，不涉及过期 `pre<N>` 引用。
- **dry-run 只读但仍会读 git**：离线干跑会执行本地 `git rev-parse/status/ls-files`（只读、非网络）；在非 git 目录下这些调用失败会被捕获并只记一行，不影响清单校验与退出码。
- 本次所有脚本运行均通过 `INC_GH_LOG` 指向 `%TEMP%`，因此 `work/ghsync.log` 未被改动；`work/ghsync.mjs` 相对 HEAD 的改动为 +258/-116。

### 交付物校验

| 文件 | 字节 | SHA-256 |
|------|------|---------|
| work/ghsync.mjs | 35816 | 769a6f1d6de59cee6b591769fc1c0b21cd7af59f16b6866201f22d32cf94c277 |
| work/ghsync-report.md | 约 8.6 KB | （自引用，字节数随本行微调；以磁盘文件为准） |
