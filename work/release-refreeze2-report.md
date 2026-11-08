# v1.0pre5 发布物二次冻结报告（task-26 / release-prep）

- 日期：2026-10-06（Asia/Shanghai）
- 工作区：`D:\dev\DeepSeekHarnessWorkspace\Infinity.inc`
- 任务：`task-26`（v1.0pre5 发布物重新冻结：6 安装包重建 + 哈希 + 文档 + PE 资源复验）
- 结论：**6 个发布包已用最新 C++ 载荷重建、双目录逐字节同步、14 项哈希全部刷新并双向复算通过；全部离线验收命令 exit 0。未运行任何安装/卸载，未 push。**

## 1. 真实构建链路（先摸清再做）

### 1.1 发布线（真正的 `cpp/release/v1.0pre5/*_win64_setup.exe` 来源）

```text
cpp/apps/<app>/**.cpp
  -> node cpp\tools\build.mjs          # cmake -G Ninja + ninja -j2；生成 .rc（图标+VERSIONINFO）经 windres 链接
     -> cpp/build/<app>.exe             # 每应用一份 C++ 产物
     -> cpp/out/<app>/<prefix|admin>_<face>.exe   # 按文件名复制的名字族 6/6/6/4/4/4 = 30 个
  -> node cpp\tools\package.mjs         # stage 载荷 + 生成 setup.nsi + makensis
     -> cpp/build/installer-stage/<app>/        # inc.ico + 名字族 exe + setup.nsi
     -> cpp/release/v1.0pre5/<Package>_1.0.0-pre5_win64_setup.exe
  -> node cpp\tools\manifest.mjs v1.0pre5 1.0.0-pre5
     -> cpp/release/v1.0pre5/name.txt + release-assets.json   （size/sha256/fnv1a/repo/url）
```

- `cpp/tools/package.mjs` 的 APPS 表是本线的命名权威：INC 管理员前缀为 `inx`（`{ dir: 'inc', prefix: 'inc', admin: 'inx', ... }`），其余为 `ifmx/ipmx/iimx/intx/ingx`；`build.mjs` 的 APPS 与之逐字一致。
- `installers/packaging/v1.0pre5/` **没有任何脚本自动生成**：它是 `cpp/release/v1.0pre5/` 的镜像，历次都由人工/任务同步（本次同样手工 copyFileSync）。清单文件 `release-assets.json` 与 `name.txt` 也是复制件，`SHA256SUMS.txt` 只存在于 packaging 侧。

### 1.2 JS/SEA（Electron）线——**与本发布包无输入输出关系**

```text
Infinity Cloud/sourcecode（IFM、IPM 同理）
  -> sourcecode/tools/build-all.mjs -> sourcecode/build/out/<target>/
  -> sourcecode/tools/make-setup.mjs（stage 到 sourcecode/build/setup-stage/<id>/，再填 installer.nsi 模板 + makensis）
     -> sourcecode/build/setup/{win64,winx86,win-arm64}.exe   # 104,768,101 / 98,285,930 / 95,994,373 B（Electron，~100 MB）
```

- 关键判定：`sourcecode/build/setup/*.exe` **不是** `cpp/release/*_setup.exe` 的输入，也不是它的输出。两者尺寸差三个数量级（~100 MB vs ~0.5 MB）：
  - release 包 ~0.23–0.52 MB，载荷是 `cpp/out/<app>/` 的 C++ 可执行文件（每个 0.5–1.6 MB，LZMA 后变成几百 KB）；
  - setup 包 ~96–105 MB，载荷是 Electron 运行时 + SEA 应用（`make-setup.mjs` 的 `stage()` 从 `build/out/<target>` 取 `inc_launcher.exe` 等并 `stageGui()` 注入 Chromium 目录）。
- `shell/payload.mjs` 的 ADMIN_PREFIX 只影响 JS/SEA 线的 stage 名；C++ 发布线的管理员前缀由 `build.mjs`/`package.mjs` 各自 APPS 表决定，**当前已是 `inx`**。

## 2. 本轮为什么要重建（真实的陈旧点）

task-26 触发点是 task-25 对 JS/SEA 线的改名重建。核实后发现：

- 发布线的陈旧点不是改名，而是**源码在上一冻结后又被修改**：
  - `cpp/apps/inc/preview.hpp` mtime = **2026-10-06T06:02:57Z**；
  - 上一批 `cpp/out` / `cpp/build` 产物 mtime = **2026-10-06T03:00:14Z**；
  - 上一批发布包 mtime = 03:43–03:44Z。
  - 即 INC 载荷落后于源码约 3 小时。重建后 `cpp/build/inc.exe` 从 1,569,280 B 变为 **1,570,304 B**（+1024 B），证明载荷确实陈旧。
- 上一批发布包（task-15 冻结的 514,897 等）**已经**含 `inx_*` 载荷（stage 脚本当时即 `File "inx_gui.exe"`），所以「包内还是 incx」的假设不成立；本轮重建的价值是吸收 preview.hpp 变更并做一次可复现的统一定版。
- 旧名 `incx_*` 在整条发布线已不存在：6 份生成的 `setup.nsi` 中 `incx` 命中 0。

## 3. 改动前后对照

### 3.1 发布安装包（`cpp/release/v1.0pre5/` = `installers/packaging/v1.0pre5/`）

| 安装包 | 前字节 | 前 sha256（前 16） | 后字节 | 后 sha256 | 变化 |
| --- | ---: | --- | ---: | --- | --- |
| `InfinityCloud_1.0.0-pre5_win64_setup.exe` | 514,897 | `0d5d9fcd91d9a41b` | **515,480** | `48fcad2445311ef2286e2b773d149575c825ca0a9b69f60bddb3d4a3d5af88fb` | **改** |
| `InfinityFileManager_1.0.0-pre5_win64_setup.exe` | 238,722 | `535fb6ecdba1512e` | 238,722 | `535fb6ecdba1512e12f518bb7a414c886b7239ae1ada22e50f5f2e4a323a0a5d` | 不变 |
| `InfinityPackageManager_1.0.0-pre5_win64_setup.exe` | 288,570 | `2b59a4df0d0ec518` | 288,570 | `2b59a4df0d0ec5188c7a5ad8379d25de812380ee0fec25593805b702687ba532` | 不变 |
| `InfinityInstallerManager_1.0.0-pre5_win64_setup.exe` | 307,194 | `669bee8be05bd6a3` | 307,194 | `669bee8be05bd6a3df826ca91a81719d4c0383ff22b10fe1066971d63720615d` | 不变 |
| `InfinityToolbox_1.0.0-pre5_win64_setup.exe` | 297,021 | `1806f62100227ba3` | 297,021 | `1806f62100227ba3f8e6d97b570fb676a6ee51c262722becdfa366596b6670ac` | 不变 |
| `InfinityGames_1.0.0-pre5_win64_setup.exe` | 268,784 | `0a6d18c405f164d7` | 268,784 | `0a6d18c405f164d76cb7a548facf6aecab3647b18879ee83ed4c454b274a7bfb` | 不变 |

六包合计：**1,915,188 B → 1,915,771 B**（+583 B）。

### 3.2 C++ 载荷（`cpp/out/<app>/<app>_cli.exe`）

| app | 前字节 | 后字节 | 后 sha256 | 变化 | 内置 `--version` |
| --- | ---: | ---: | --- | --- | --- |
| inc | 1,569,280 | **1,570,304** | `fac4f562a2d55fd852b79ea86f488bdb85666d9151a0d7a075b1a0a32d569667` | **改** | `Infinity Cloud [v1.0.0-pre5]` |
| ifm | 530,432 | 530,432 | `d543d3024a22e0389aeb0a4afd9d4d3fb57635e96d728e12975d40b8453d5c3a` | 不变 | `Infinity File Manager 1.0.0-pre5` |
| ipm | 669,696 | 669,696 | `7832ed397b68a02e32fa6e078497e5c4b79feb23f3950403fa7390c0350bada0` | 不变 | `InfinityPackageManager 1.0.0-pre5` |
| iim | 737,280 | 737,280 | `0739700b88b2afda457f548a1ff3c7ed70a2cd53802ed26458a833edc761d7ab` | 不变 | `Infinity Installer Manager [v1.0.0-pre5]` |
| int | 693,760 | 693,760 | `4aa70a5925f6e498b84c9ab97161811132e39edfe98c879d446c3f5b1c721b54` | 不变 | `Infinity Toolbox [v1.0.0-pre5]` |
| ing | 621,056 | 621,056 | `a29e7218080b78ebbd980626a172ac95fb1ead1e85176c92c1251a227a58c333` | 不变 | `Infinity Games [v1.0.0-pre5]` |

ING 载荷哈希前后一致（`a29e7218080b78eb…`），**未触碰 `cpp/apps/ing/**` 与 `icons/ing.ico`**。

### 3.3 清单与文档

| 文件 | 前 sha256（前 16） | 后 sha256 |
| --- | --- | --- |
| `name.txt`（614 B，内容不变） | `8ba19832f532e7b5` | `8ba19832f532e7b5d0ae9825b192b4d44bc64bb31cdfa30277a92803e12f5c12` |
| `release-assets.json`（2,485 B） | `fec33ae32d3b2490`（task-15 值） | `5ce3d37fd17074849fc594fb25e5a96c884644852fa53a3d3b7238e3c94a32fb` |
| `installers/packaging/v1.0pre5/SHA256SUMS.txt`（1,325 B） | — | 14 行，逐条与磁盘一致 |

> 注意：`release-assets.json` 内含 `generated` 时间戳，**每跑一次 `manifest.mjs` 其自身 sha256 都会变**。文档里记录的是本次值 `5ce3d37f…`；若再次运行 `manifest.mjs`，必须同步刷新两份文档，否则 14/14 会失败。

## 4. 版本口径对照（发布包 / 载荷 / 安装器）

| 层面 | 版本来源 | INC | IFM | IPM | IIM | INT | ING |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **发布包文件名** | `package.mjs` 的 `VERSION`（`1.0.0-pre5`） | 1.0.0-pre5 | 同左 | 同左 | 同左 | 同左 | 同左 |
| **安装器 Add/Remove `DisplayVersion`** | `setup.nsi` 的 `!define VERSION` | 1.0.0-pre5 | 同左 | 同左 | 同左 | 同左 | 同左 |
| **安装器自身 PE FileVersion** | NSIS 默认，无 VERSIONINFO | 空 | 空 | 空 | 空 | 空 | 空 |
| **载荷 PE FileVersion / ProductVersion** | `build.mjs` 生成的 `.rc` → windres | 1.0.0-pre5 | 1.0.0-pre5 | 1.0.0-pre5 | 1.0.0-pre5 | 1.0.0-pre5 | 1.0.0-pre5 |
| **载荷运行时 `--version`** | 程序内版本常量 | `Infinity Cloud [v1.0.0-pre5]` | `1.0.0-pre5` | `1.0.0-pre5` | `[v1.0.0-pre5]` | `[v1.0.0-pre5]` | `[v1.0.0-pre5]` |

结论：**发布包、载荷、安装器三者的版本口径全部为 1.0.0-pre5**，唯一「空」的是安装器 exe 自身的 PE VERSIONINFO（NSIS 未写；不影响功能与卸载项显示）。

### 4.1 对照：JS/SEA（Electron）线（非本轮发布物，仅记录 Lead 关注点）

| 产品 | stage 路径 | `--version` 实测 | 结论 |
| --- | --- | --- | --- |
| Infinity Cloud | `sourcecode/build/setup-stage/win64/inc_cli.exe` | `Infinity Cloud [v1.0pre2]` | **陈旧**（应为 1.0.0-pre5 / v1.0pre5） |
| Infinity File Manager | `Infinity File Manager/sourcecode/build/setup-stage/win64/ifm_cli.exe` | `Infinity File Manager [v1.0pre5]  ·  Infinity.Inc`（另有 UNDICI-EHPA 实验性警告） | 已 pre5 |
| InfinityPackageManager | `InfinityPackageManager/build/setup-stage/win64/ipm_cli.exe` | `--version` 仅打 banner；`version` 子命令 → `InfinityPackageManager  Infinity.Inc  v0.0.0` | **陈旧/异常**（v0.0.0） |
| Infinity Installer Manager / Toolbox / Games | — | — | **不存在 JS stage**（这三个产品只有 C++ 线，`**/setup-stage/*/*_cli.exe` 全库仅命中 INC/IFM/IPM） |

另测 INC stage exe 的 PE 元数据：`FileVersion=ProductVersion=22.11.0`、`Company=Product=Node.js`、`FileDescription=Node.js JavaScript Runtime`——SEA 可执行文件的 PE VERSIONINFO 是内嵌 Node 运行时的版本，**与产品版本无关**。

> 归属：JS/SEA 线的版本串修正属于该线自己的任务（`src/cli.js` 等版本常量），**不在 task-26 的写作用域**（本任务 scope 为 `cpp/release/v1.0pre5`、`installers/packaging/v1.0pre5`、两份 docs、本报告）。已按 Lead 要求把「修复前证据」固定在此，供 JS 线 owner 接手。

## 5. 验证命令与退出码

| # | 命令 | 退出码 | 结果 |
| --- | --- | ---: | --- |
| 1 | `node cpp\tools\build.mjs`（首次，吸收 preview.hpp） | 0 | inc 1,570,304 B；6 应用 `Windows dependencies only  icon+VERSIONINFO` |
| 2 | `node cpp\tools\build.mjs`（幂等复跑） | 0 | 6 个 `.rc` 全 `unchanged`；尺寸/哈希与第 1 次完全相同 |
| 3 | `node cpp\tools\package.mjs` | 0 | 6 包产出（Cloud 515,480 B，其余不变） |
| 4 | `node cpp\tools\package.mjs`（确定性复跑） | 0 | **6/6 哈希不变**（makensis 对该输入确定） |
| 5 | `node cpp\tools\manifest.mjs v1.0pre5 1.0.0-pre5` | 0 | 写 `name.txt` + `release-assets.json`（6 资产） |
| 6 | `cpp\build\pe-resources.ps1` × 6 载荷 | 0 | IconCount=21、GroupIconCount=3、FileVersion=1.0.0-pre5 |
| 7 | `cpp\build\pe-resources.ps1` × 6 安装器 | 0 | IconCount=21、GroupIconCount=3（MUI 图标），FileVersion 空 |
| 8 | 等价 `nsi-check --strict`：静态解析 6 份 `installer-stage/*/setup.nsi` | 0 | **NSI-STATIC PASS**（File/快捷方式/环境变量/DisplayIcon/图标目标全部存在；无孤儿文件） |
| 9 | docs 14/14 ×2（`RELEASE-v1.0pre5.md`、`-body.md`） | 0 | 14 项全部命中磁盘，stale=0 |
| 10 | `SHA256SUMS.txt` 逐条复算 | 0 | 14/14 |
| 11 | `cpp/release` vs `installers/packaging` 逐字节 | 0 | **same=6 diff=0** |
| 12 | `release-assets.json` 每条 size+sha256 vs 磁盘 | 0 | 6/6 |
| 13 | `node work\cn-gitee-verify.mjs` | 0 | 76 checks, failed 0 |
| 14 | `node work\cn-lead-verify.mjs web` | 0 | cnPages=19、problems=0、`PASS 中文站完全汉化` |
| 15 | `node work\ghsync.mjs --dry-run --remote` | 0 | entries 6、total bytes **1,915,771**、errors 0；6 个 release 均 absent →「would be created and uploaded」；未发布 |

`ghsync --dry-run --remote` 关键输出：

```text
[DRY RUN (local validation + read-only GitHub GETs): no release, no asset, no catalogue write, no git push]
stale guard: ok (no older pre<N> in tag, asset names or name.txt)
entries: 6   total bytes: 1915771
asset InfinityCloud_1.0.0-pre5_win64_setup.exe [Infinity-Cloud]: release v1.0.0-pre5 absent -> would be created and uploaded
（其余 5 个资产同型）
errors: 0
DRY RUN complete: 0 errors
```

## 6. PE 资源实测明细

| exe | 字节 | .rsrc | IconCount | GroupIconCount | FileVersion | ProductVersion | Company |
| --- | ---: | --- | ---: | ---: | --- | --- | --- |
| `cpp/out/inc/inc_cli.exe` | 1,570,304 | 有 | 21 | 3 | 1.0.0-pre5 | 1.0.0-pre5 | Infinity.Inc |
| `cpp/out/ifm/ifm_cli.exe` | 530,432 | 有 | 21 | 3 | 1.0.0-pre5 | 1.0.0-pre5 | Infinity.Inc |
| `cpp/out/ipm/ipm_cli.exe` | 669,696 | 有 | 21 | 3 | 1.0.0-pre5 | 1.0.0-pre5 | Infinity.Inc |
| `cpp/out/iim/iim_cli.exe` | 737,280 | 有 | 21 | 3 | 1.0.0-pre5 | 1.0.0-pre5 | Infinity.Inc |
| `cpp/out/int/int_cli.exe` | 693,760 | 有 | 21 | 3 | 1.0.0-pre5 | 1.0.0-pre5 | Infinity.Inc |
| `cpp/out/ing/ing_cli.exe` | 621,056 | 有 | 21 | 3 | 1.0.0-pre5 | 1.0.0-pre5 | Infinity.Inc |

6 个发布安装器自身：每个 `IconCount=21`、`GroupIconCount=3`、资源类型含 `RT_ICON(3)/RT_DIALOG(5)/RT_GROUP_ICON(14)/RT_MANIFEST(24)`，即 `MUI_ICON`/`MUI_UNICON` 已编入 PE；`FileVersion` 为空（NSIS 默认，见 §4）。

## 7. 静态安装器检查（等价 nsi-check --strict）

对 `cpp/build/installer-stage/<app>/setup.nsi` 逐条断言：

- 每个 `File "X"` 的 X 都存在于同目录 stage；
- 两条 `CreateShortCut` 的目标（`<prefix>_launcher.exe` 或 `<prefix>_gui.exe`、`Uninstall.exe`）存在；
- 每条 `WriteRegStr HKCU Environment <key> $INSTDIR\<file>` 的 file 存在；
- `DisplayIcon` 与 `!define MUI_ICON` 指向的 `icon` 存在；
- stage 目录无未被引用的孤儿文件；
- 全文无 `incx`（旧管理员名）。

结果：`OK ifm / iim / inc / ing / int / ipm`，每应用 `files=7/5`、`icons=yes`、`shortcuts=2`、`regs=6/4`、`orphans=none`，汇总 `NSI-STATIC PASS`。

INC 的 stage 载荷名即为权威名族：`inc.ico, inc_cli.exe, inc_gui.exe, inc_launcher.exe, inx_cli.exe, inx_gui.exe, inx_launcher.exe`；环境变量为 `inccli/incgui/inclauncher` 与 `inxcli/inxgui/inxlauncher`。

## 8. 硬约束遵守情况

- **未运行任何安装包或卸载程序**；全部校验均为静态解析 / PE 读取 / CLI `--version`（无窗口，退出即止）。
- **未结束任何进程**；未使用 `Start-Process`（该机 `NO_PROXY`/`no_proxy` 重复会抛异常）。
- **未触碰 `D:\program\**`** 与任何用户快捷方式。
- **未改 ING 源**：`cpp/apps/ing/**`、`icons/ing.ico` 只读；ing 载荷哈希前后一致。
- **未 push / 未创建 / 未上传 / 未删除**：`ghsync --dry-run --remote` 仅 GET；无 `EV_GH_TOKEN` 参与。
- 写入范围：`cpp/release/v1.0pre5/`、`installers/packaging/v1.0pre5/`、`docs/RELEASE-v1.0pre5.md`、`docs/RELEASE-v1.0pre5-body.md`、`work/release-refreeze2-report.md`；另外重建写入了 `cpp/build/`、`cpp/out/`（任务的「用新 payload 重建」必然产物）。

## 9. 遗留与发布前必办

1. **哈希已冻结，任何再构建都会作废**：只要再跑 `build.mjs`/`package.mjs`/`manifest.mjs`，就必须重新走本报告 §5 的第 9–12 项并刷新两份 docs。
2. **`release-assets.json` 自身哈希不稳定**：其 `generated` 字段每次运行都变。建议发布流程中以 `SHA256SUMS.txt` 的 6 个安装包摘要为冻结依据，或在 `manifest.mjs` 里把 `generated` 改为可注入常量。
3. **JS/SEA 线版本串未修（Lead 关注点）**：INC `v1.0pre2`、IPM `v0.0.0`、IFM 已 `v1.0pre5`；IIM/INT/ING 无 JS stage。归属该线自己的任务，本轮只出证据不改动。
4. **安装器自身无 PE FileVersion**：如需在资源管理器属性页看到版本，需要在 `cpp/tools/package.mjs` 的 `nsiFor()` 里加 `VIProductVersion` + `VIAddVersionKey`（NSIS 一行级改动）。一旦修改，6 个包全部变化，必须再次冻结。
5. **无法在包内逐文件列名**：本机无 `7z`，随附 `temp/tools/7za.exe` 21.07 解析 NSIS 返回 `Errors: 1`（列出即失败）。因此包内名族的证据链是：stage `setup.nsi`（makensis 的直接输入）+ `package.mjs` 复跑 6/6 哈希不变（确定性）+ 载荷变更时包体字节同步变化。发布机若能装 7-Zip 官方版，建议补一次 `7z l` 逐文件复核。
6. **未发布**：仍缺 `EV_GH_TOKEN` 与 Lead 书面批准；`publish.mjs --dry-run` 无令牌时输出 `NO TOKEN (set EV_GH_TOKEN)`、exit 1（task-12 结论）。`ghsync --dry-run --remote` 已确认 6 个 release 均不存在、dry-run 会创建并上传。
7. **发布形态未变**：六个应用分别在各自仓库发布（每仓库一个安装包），没有聚合 Release。

## 10. 相关文件

- `cpp/release/v1.0pre5/release-assets.json`、`name.txt`、6 个安装包
- `installers/packaging/v1.0pre5/SHA256SUMS.txt`（14 行）、6 个安装包、`icons/`
- `docs/RELEASE-v1.0pre5.md`、`docs/RELEASE-v1.0pre5-body.md`（两份均 14/14 命中磁盘）
- `work/release-refreeze-report.md`（task-15 上一次冻结）、`work/release-v1.0pre5-report.md`（task-4 产物）
- `work/release-refreeze2-report.md`（本报告，含 task-29 附录 A）

---

# 附录 A：task-29 发布终态打磨（安装器属性页 + 时间戳确定性）

- 日期：2026-10-06（Asia/Shanghai）
- 任务：`task-29`（承 task-26 遗留①②）
- 结论：**6 个安装器已写入 NSIS 版本资源、属性页字段不再为空且图标资源保持 21/3；`release-assets.json` 的 `generated` 已改为发布常量（复跑幂等）；冻结链 build/package/manifest 各跑两次全部幂等；14 项哈希刷新后 docs 14/14×2、双目录 same=6 diff=0；全部复验命令 exit 0。**

## A.1 改了哪两处代码

| 文件 | 改动 |
| --- | --- |
| `cpp/tools/package.mjs` | 新增 `versionQuad()`（`1.0.0-pre5` → `1.0.0.5`）；`nsiFor()` 生成的 `setup.nsi` 在 `!define UNKEY` 之后新增 `VIProductVersion` + 6 条 `VIAddVersionKey /LANG=2052` |
| `cpp/tools/manifest.mjs` | 新增 `generatedAt(files)`：`INC_GENERATED` 环境变量 > `version.json` 的 `updated`（→ `<updated>T00:00:00.000Z`）> 最新安装包 mtime；`generated` 不再取 `new Date()`，并打印所选值 |

生成的 `setup.nsi` 片段（6 份一致，仅 ProductName/FileDescription 随产品变化）：

```nsis
VIProductVersion "1.0.0.5"
VIAddVersionKey /LANG=2052 "ProductName" "Infinity Cloud"
VIAddVersionKey /LANG=2052 "CompanyName" "Infinity.Inc"
VIAddVersionKey /LANG=2052 "FileDescription" "Infinity Cloud Setup"
VIAddVersionKey /LANG=2052 "FileVersion" "1.0.0-pre5"
VIAddVersionKey /LANG=2052 "ProductVersion" "1.0.0-pre5"
VIAddVersionKey /LANG=2052 "LegalCopyright" "Copyright (C) Infinity.Inc"
```

### 为什么是 `VIProductVersion "1.0.0.5"` 而不是任务原文的 `1.0.0.0`

NSIS 的 `VIProductVersion` 只接受四段数字，而本版是 `1.0.0-pre5`（1.0.0 的第 5 个预览）。若写 `1.0.0.0` 就会把“pre5”丢掉，且与载荷 exe 的 `FILEVERSION` 不一致——`build.mjs` 早已把 `1.0.0-pre5` 映射为四段 `1,0,0,5`。因此这里复用同一映射取第 5 位为 `5`：安装器的版本资源与其携带的六个可执行文件同口径。字符串键 `FileVersion`/`ProductVersion` 仍写人类可读的 `1.0.0-pre5`（属性页显示的就是它）。

## A.2 属性页改前 / 改后对照（`cpp/build/pe-resources.ps1` 实测）

| 安装包 | Company | Product | FileVersion | ProductVersion | FileDescription | IconCount | GroupIconCount |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| InfinityCloud | 空 → **Infinity.Inc** | 空 → **Infinity Cloud** | 空 → **1.0.0-pre5** | 空 → **1.0.0-pre5** | 空 → **Infinity Cloud Setup** | 21 → **21** | 3 → **3** |
| InfinityFileManager | 空 → **Infinity.Inc** | 空 → **Infinity File Manager** | 空 → **1.0.0-pre5** | 空 → **1.0.0-pre5** | 空 → **Infinity File Manager Setup** | 21 → **21** | 3 → **3** |
| InfinityPackageManager | 空 → **Infinity.Inc** | 空 → **InfinityPackageManager** | 空 → **1.0.0-pre5** | 空 → **1.0.0-pre5** | 空 → **InfinityPackageManager Setup** | 21 → **21** | 3 → **3** |
| InfinityInstallerManager | 空 → **Infinity.Inc** | 空 → **Infinity Installer Manager** | 空 → **1.0.0-pre5** | 空 → **1.0.0-pre5** | 空 → **Infinity Installer Manager Setup** | 21 → **21** | 3 → **3** |
| InfinityToolbox | 空 → **Infinity.Inc** | 空 → **Infinity Toolbox** | 空 → **1.0.0-pre5** | 空 → **1.0.0-pre5** | 空 → **Infinity Toolbox Setup** | 21 → **21** | 3 → **3** |
| InfinityGames | 空 → **Infinity.Inc** | 空 → **Infinity Games** | 空 → **1.0.0-pre5** | 空 → **1.0.0-pre5** | 空 → **Infinity Games Setup** | 21 → **21** | 3 → **3** |

汇总计数（脚本输出直接统计）：`FileVersion=1.0.0-pre5` ×6、`ProductVersion=1.0.0-pre5` ×6、`Company=Infinity.Inc` ×6、`IconCount=21` ×6、`GroupIconCount=3` ×6；资源类型仍含 `RT_ICON(3)`/`RT_DIALOG(5)`/`RT_GROUP_ICON(14)`/`RT_MANIFEST(24)`。**图标资源未丢失。**

## A.3 时间戳方案：选 (a) 固定发布常量，并说明理由

选 **(a)**：`generated` 从 `version.json` 的 `updated` 字段读取（本版 `2026-10-06` → `2026-10-06T00:00:00.000Z`），`INC_GENERATED` 可覆盖，取不到时回退到最新安装包 mtime。

理由：
1. `generated` 的语义是“本发布清单属于哪个发布”，不是“这次命令几点跑的”；用发布常量比用运行时刻更贴语义。
2. `version.json` 已是本发布唯一版本源（release/version/tag/releaseDir/packages 均在其中），把 `generated` 挂到它的 `updated` 上不引入新文件、新字段；`work/ghsync.mjs`、`gen-releases-json.mjs` 只读 `assets`，消费者无需改动。
3. 方案 (b)（把 `release-assets.json` 排除出 docs 哈希表）会把“发布清单自身不可校验”变成永久缺口——docs 的 14/14 正是发布前最后一道资产完整性检查，排除它等于放弃对清单文件的校验；而 (a) 让 14/14 继续保持全部可校验。
4. 复跑幂等已实测：两次 `manifest.mjs` 后 `release-assets.json` 均为 2,485 B、sha256 `df5afe21…`（改前 task-26 是每跑一次换一个值）。

## A.4 复跑幂等证据（每步两次）

| 步骤 | 第 1 次 | 第 2 次 | 幂等 |
| --- | --- | --- | --- |
| `node cpp\tools\build.mjs` | exit 0 | exit 0 | `cpp/out` 6/6 哈希与 task-26 完全相同（inc `fac4f562…` 1,570,304 B 等） |
| `node cpp\tools\package.mjs` | exit 0 | exit 0 | 6/6 包字节+sha256 完全相同（见 A.5） |
| `node cpp\tools\manifest.mjs v1.0pre5 1.0.0-pre5` | exit 0，`generated: 2026-10-06T00:00:00.000Z` | exit 0，同值 | `release-assets.json` 2,485 B `df5afe21…` 两次相同；`name.txt` 两次相同 |
| 生成 `SHA256SUMS.txt` | 14 行 | 14 行 | 两次 sha256 相同：`ae658e2f9a34d4f2fd4b3ba54418be15329a56c29488ad5a86e1e5b4c656a6b2`（1311 B） |

（`package.mjs` 复跑前的 baseline 由第 1 次运行的 6 个包哈希构成，第 2 次逐一比对：`unchanged=6 changed=0`。）

## A.5 全量哈希对照（task-26 → task-29）

| 文件 | task-26 字节 / sha256 | task-29 字节 / sha256 |
| --- | --- | --- |
| `InfinityCloud_1.0.0-pre5_win64_setup.exe` | 515,480 / `48fcad24…a3d5af88fb` | **516,504 / `78dd21b814f86352f639747f7f348ab9af0d6efe1aa2630ddcd32cb844d7c909`** |
| `InfinityFileManager_1.0.0-pre5_win64_setup.exe` | 238,722 / `535fb6ec…a323a0a5d` | **239,234 / `3f3f060a9a09dd6dbd13d1fe2d85afed4e6f47899502edf299b25acfbbaaf60a`** |
| `InfinityPackageManager_1.0.0-pre5_win64_setup.exe` | 288,570 / `2b59a4df…687ba532` | **289,595 / `c475055ca4803482c0b067bd31506323ce949104ab6463be877845190a1875ca`** |
| `InfinityInstallerManager_1.0.0-pre5_win64_setup.exe` | 307,194 / `669bee8b…63720615d` | **308,219 / `82b416c70ac0e123cee766420f7b4bcde7aac9285807ec421344a808c6221fb7`** |
| `InfinityToolbox_1.0.0-pre5_win64_setup.exe` | 297,021 / `1806f621…96b6670ac` | **297,534 / `af90acb311306acf603bb1a5f3f1e5fade44d419fe3aaec1726404d2c49fb8c9`** |
| `InfinityGames_1.0.0-pre5_win64_setup.exe` | 268,784 / `0a6d18c4…4b274a7bfb` | **269,294 / `40b21389a3c5a487f6928ca2356a6f15f821f409ae58748876ef3c33fe03d39d`** |
| `name.txt` | 614 / `8ba19832…e12f5c12` | 614 / `8ba19832f532e7b5d0ae9825b192b4d44bc64bb31cdfa30277a92803e12f5c12`（不变） |
| `release-assets.json` | 2,485 / `5ce3d37f…c94a32fb` | 2,485 / `df5afe218f58497bf27e0ea34e6d8a25c012cd06c9bcb85c228f801f783662dd` |
| `SHA256SUMS.txt` | 1,325 B（旧） | **1311 B / `ae658e2f9a34d4f2fd4b3ba54418be15329a56c29488ad5a86e1e5b4c656a6b2`** |
| `icons/*.ico` ×6 | 见 task-26 值 | 全部不变 |

六包合计：**1,915,771 B → 1,920,380 B**（+4,609 B，即 6 份 setup 各多约 0.5–1.0 KB 的版本资源）。

## A.6 复验命令与退出码（task-29）

| # | 命令 | 退出码 | 结果 |
| --- | --- | ---: | --- |
| 1 | `node cpp\tools\build.mjs` ×2 | 0 / 0 | `cpp/out` 6/6 哈希不变 |
| 2 | `node cpp\tools\package.mjs` ×2 | 0 / 0 | 6 包重建，两次哈希一致 |
| 3 | `node cpp\tools\manifest.mjs v1.0pre5 1.0.0-pre5` ×2 | 0 / 0 | `generated` 固定，`release-assets.json` 两次相同 |
| 4 | `cpp\build\pe-resources.ps1` ×6 安装器 | 0（`$?=True`） | Company/Product/FileVersion/ProductVersion/FileDescription 全非空；IconCount=21、GroupIconCount=3 |
| 5 | `node work\ghsync.mjs --dry-run --remote` | 0 | `stale guard: ok`、`entries: 6`、`total bytes: 1920380`、`errors: 0`；6 个 release 均 `absent -> would be created and uploaded`（**只预演，未发布**） |
| 6 | `node work\cn-gitee-verify.mjs` | 0 | `checks: 76, failed: 0` |
| 7 | `node work\cn-lead-verify.mjs web` | 0 | `PASS 中文站完全汉化`（problems=0） |
| 8 | docs 14/14 ×2 + `SHA256SUMS` 14/14 + 双目录 same=6 diff=0 + manifest 6/6 | 0 | `FINAL PASS`；stale 哈希 0 |

## A.7 task-29 遗留

1. **再次改动了全部 6 个包**：本轮之后任何再构建都会再次作废哈希；发布前应停止所有写操作，并重跑 A.6 第 8 项。
2. `generated` 现在依赖 `version.json` 的 `updated`；若该字段被改成别的日期，`release-assets.json` 哈希会随之变化（属预期，需同步 docs）。
3. `VIAddVersionKey` 只写了 `/LANG=2052`（与安装器 UI 语言一致）。简体中文 Windows 的资源管理器属性页正常显示；如未来要覆盖英文系统，可补一组默认语言键（会再次改哈希）。
4. 仍未发布：缺 `EV_GH_TOKEN` 与书面批准；`ghsync --dry-run --remote` 已确认 6 个 release 均不存在。
5. **JS/SEA 线版本串问题依旧**（INC `v1.0pre2`、IPM `v0.0.0`；IIM/INT/ING 无 JS stage）——归属该线自己的任务，本轮未触碰。
