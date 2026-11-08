# 发行哈希重新冻结报告（task-15）

- 时间：2026-10-06（Asia/Shanghai）
- 触发：task-11（可执行文件资源段图标）重建了 6 个 exe 并重打了 6 个安装包，旧哈希全部作废。
- 执行：`icon-rc`（打包/文档/`publish.mjs`），Lead 独立复算并代收报告（该成员在写报告前被 Lead 中断以收敛）。

## 1. 重新冻结后的安装包（字节 + sha256）

| 文件 | 字节 | sha256 |
| --- | ---: | --- |
| `InfinityCloud_1.0.0-pre5_win64_setup.exe` | 514897 | `0d5d9fcd91d9a41b…` | `0d5d9fcd91d9a41b44334c06628fa1c5950d0728b96c0a5c6243032d93e4dc0c` |
| `InfinityFileManager_1.0.0-pre5_win64_setup.exe` | 238722 | `535fb6ecdba1512e…` | `535fb6ecdba1512e12f518bb7a414c886b7239ae1ada22e50f5f2e4a323a0a5d` |
| `InfinityGames_1.0.0-pre5_win64_setup.exe` | 268784 | `0a6d18c405f164d7…` | `0a6d18c405f164d76cb7a548facf6aecab3647b18879ee83ed4c454b274a7bfb` |
| `InfinityInstallerManager_1.0.0-pre5_win64_setup.exe` | 307194 | `669bee8be05bd6a3…` | `669bee8be05bd6a3df826ca91a81719d4c0383ff22b10fe1066971d63720615d` |
| `InfinityPackageManager_1.0.0-pre5_win64_setup.exe` | 288570 | `2b59a4df0d0ec518…` | `2b59a4df0d0ec5188c7a5ad8379d25de812380ee0fec25593805b702687ba532` |
| `InfinityToolbox_1.0.0-pre5_win64_setup.exe` | 297021 | `1806f62100227ba3…` | `1806f62100227ba3f8e6d97b570fb676a6ee51c262722becdfa366596b6670ac` |

## 2. 与旧冻结的差异（旧 → 新，前 8 位）

| 应用 | 旧安装包 sha256 | 新安装包 sha256 | 字节变化 |
| --- | --- | --- | --- |
| InfinityCloud | `2bb448c1…` | `0d5d9fcd…` | 514535 → 514897 |
| InfinityFileManager | `4ea7673c…` | `535fb6ec…` | 238305 → 238722 |
| InfinityPackageManager | `8295d0ad…` | `2b59a4df…` | 288313 → 288570 |
| InfinityInstallerManager | `3b0de0ed…` | `669bee8b…` | 306796 → 307194 |
| InfinityToolbox | `fdd66258…` | `1806f621…` | 296537 → 297021 |
| InfinityGames | `be13f9c6…` | `0a6d18c4…` | 268383 → 268784 |

## 3. Lead 独立复算（不依赖执行者结论）

1. `cpp/release/v1.0pre5/*.exe` 与 `installers/packaging/v1.0pre5/*.exe` 逐字节比对：**same=6 diff=0**（第一次比对时是 6/6 DIFF，即 packaging 还是旧包；已修复）。
2. `installers/packaging/v1.0pre5/SHA256SUMS.txt` 逐条重算：**ok=14 bad=0**（6 安装包 + name.txt + release-assets.json + 6 图标）。
3. `cpp/release/v1.0pre5/release-assets.json` 每条 size/sha256 与磁盘：**matched=6 stale=0**。
4. 两份文档中的全部 64 位哈希：`docs/RELEASE-v1.0pre5.md` **14/14 在磁盘存在**、`docs/RELEASE-v1.0pre5-body.md` **14/14 在磁盘存在**，`notOnDisk=0`。
5. `cpp/tools/publish.mjs`：Release BODY 改为运行时读 `docs/RELEASE-v1.0pre5-body.md`（`loadBody()`，缺失时回退内联 `FALLBACK_BODY` 并打印来源）；无令牌 `--dry-run` 复跑输出逐字 `NO TOKEN (set EV_GH_TOKEN)`、exit=1、0 写请求。
6. 图标证据：用 `cpp/build/pe-resources.ps1` 独立复算 `cpp/build/inc.exe` → `Section=.rsrc`、`IconCount=21`、`GroupIconCount=3`、`FileVersion=ProductVersion=1.0.0-pre5`、`Company=Infinity.Inc`。

## 4. 文档同步

- `docs/RELEASE-v1.0pre5.md`：状态行改为"已构建、已打包、哈希已重新冻结"；§6 资产表换成新哈希；六应用"图标接入"条目与 §7 由"未接入"改为"已完成（2026-10-06，task-11）"。
- `docs/RELEASE-v1.0pre5-body.md`：六应用表哈希与字节全部换新（由脚本直读 `release-assets.json` + `SHA256SUMS.txt`，非手抄）。
- `cpp/README.md`：资源段图标接入说明已补（`windres` 编译 `<app>.rc`）。

## 5. 遗留

- 仍未发布：无 `EV_GH_TOKEN`、未获书面批准；`publish.mjs --dry-run` 在无令牌时明确退出。
- 版本默认值 `1.0.0-pre5` 分散在 `cpp/tools/{build,package,manifest}.mjs` 三处，下个 pre-release 需同步或用 `INC_VERSION` 覆盖。
- `installers/packaging/icons` 优先、仓库根 `icons/` 回退（当前同哈希）。
