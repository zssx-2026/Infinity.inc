# site-release-sync-report.md — task-32 站点发布数据与冻结清单同步

- 任务：task-32（owner: site-seo）
- 目标：v1.0pre5 两次冻结（task-26/task-29）后，6 个安装包哈希全部变化（合计 1,920,380 B），
  但静态站快照 `web/infinity/assets/releases.json` 与 `web/infinity/assets/verify-download.ps1`
  的示例摘要仍是旧包，网站会把过期校验值交给读者。本任务把站点数据与冻结清单对齐，并加上断言防止再次漂移。
- 结论：**完成**。6/6 资产 size+sha256 与 `cpp/release/v1.0pre5/release-assets.json` 逐条相等；
  `-Example` 自检通过（不匹配时非零退出）；一致性断言 34/34 通过；5 个复跑命令全部 exit 0。
- 禁令遵守：未下载、未安装/卸载、未结束进程、未发布（未跑 `ghsync --apply`）、未改英文页语义、
  未触碰 ING 源码与 `history/`。

---

## 1. 口径澄清（重要，防止假断言）

`releases.json` 有两个互不相干的目录，本任务严格区分：

| 目录 | 结构 | 内容 | 与 `cpp/release/v1.0pre5/release-assets.json` 的关系 |
| --- | --- | --- | --- |
| `repos[<repo>][]` | 每个 release 含 `assets[]` | GitHub/Gitee 发布页上的资产，pre5 每仓 1 个 setup.exe | **就是它的 6 个安装包**，逐条核对 size+sha256 |
| `bundles[<repo>][]` | `{tag,platform,name,size,url,sha256}` | Infinity-Archive 仓库的 `.zst` 归档包（5 条，tag 为 pre3/v0.1） | **无关**：不同产物、不同 release。只核对结构、归档主机、CN 镜像与本地文件 |

因此断言脚本**没有**、也不会写出"bundles 的 size/sha256 必须等于安装包清单"这种口径错误的断言。
`bundles` 单独按第 5.3 节核对。

---

## 2. 改动一：`web/infinity/assets/releases.json`

- 生成方式：由 `work/gen-releases-json.mjs` **离线**从冻结清单重建（见第 4 节）。
- 只重写冻结 tag `v1.0.0-pre5` 下 6 个资产的 `size / digest / browser_download_url`；
  其余历史 release（pre4/pre3/v0.1 等）与 `bundles` 原样保留。

| | 字节 | sha256 |
| --- | --- | --- |
| 改前 | 64,864 | `3cf7c0f6014bd28c4ce151c70171831d0b3bd7266404c87c6a51552b02c9bf34` |
| 改后 | 64,864 | `46806e1101a71119db9e0188bc92e50e60b5f409b337e986dc422b9c826008c7` |

### 2.1 6 个安装包 改前 → 改后

改前值直接读自改动前的 `releases.json`（该文件在本仓库未被 git 跟踪，无法用 `git show` 取回；
括号内全量旧哈希与 `work/release-v1.0pre5-report.md`、`work/icon-rc-report.md` 中记录的同一构建交叉核对一致）。

| 仓库 / 资产 | 改前 size / sha256 | 改后 size / sha256 |
| --- | --- | --- |
| Infinity-Cloud `InfinityCloud_1.0.0-pre5_win64_setup.exe` | 514535 / `2bb448c1fd0c35f9ae8fb6ed0f32a3185444f5a52943663f4f1db5d846761544` | **516504 / `78dd21b814f86352f639747f7f348ab9af0d6efe1aa2630ddcd32cb844d7c909`** |
| Infinity-File-Manager `...FileManager...setup.exe` | 238305 / `4ea7673c84cd47be7d0da1d603a36d44e6b1c0886456ea2025f8e66ec18ff310` | **239234 / `3f3f060a9a09dd6dbd13d1fe2d85afed4e6f47899502edf299b25acfbbaaf60a`** |
| InfinityPackageManager `...PackageManager...setup.exe` | 288313 / `8295d0ad64c38778bd63f2f0eb028c33de2902406aa44c17673543cfc3c8a3ee` | **289595 / `c475055ca4803482c0b067bd31506323ce949104ab6463be877845190a1875ca`** |
| Infinity-Installer-Manager `...InstallerManager...setup.exe` | 306796 / `3b0de0ed42a9dd9270e6c9e90f1d1c0df837270e3337ab16c5e2a317c9419221` | **308219 / `82b416c70ac0e123cee766420f7b4bcde7aac9285807ec421344a808c6221fb7`** |
| Infinity-Toolbox `...Toolbox...setup.exe` | 296537 / `fdd66258d5627771b879abb1829ed2b2ff00cc6feb8745c73ab8bdbc1e1fd2d3` | **297534 / `af90acb311306acf603bb1a5f3f1e5fade44d419fe3aaec1726404d2c49fb8c9`** |
| Infinity-Games `...Games...setup.exe` | 268383 / `be13f9c615aa5131840c8c32d2b3da8e5fdc834e9811669cf0a443f15431398c` | **269294 / `40b21389a3c5a487f6928ca2356a6f15f821f409ae58748876ef3c33fe03d39d`** |

改后合计 1,920,380 B，与冻结清单一致（断言脚本第 16 项）。

---

## 3. 改动二：`web/infinity/assets/verify-download.ps1`

- 字节：2,019 → 3,581；sha256：`046fe6f0052c73318addac1806f1f816ab41931274a393915d7871656adbbb10` →
  `d209c0ca1837f8dd907060c84bd41a8d877ec2193c968b3410a85498743f14ef`。
- 示例摘要：`0d5d9fcd91d9a41b44334c06628fa1c5950d0728b96c0a5c6243032d93e4dc0c`（甚至不是第一次冻结的
  514535/2bb448c1，而是中间一次 514897 B 构建，见 `work/icon-rc-report.md`）
  → **`78dd21b8…` / 516504 B**，注释用法行与 `-Example` 输出两处同步更新。
- 新增自检：`-Example` 用 `$PSScriptRoot` 读同目录 `releases.json`，取 Infinity-Cloud 的
  `v1.0.0-pre5` 资产，**示例摘要必须等于快照 digest，否则 exit 1**。

实测：

```
$ web/infinity/assets/verify-download.ps1 -Example
    powershell -ExecutionPolicy Bypass -File verify-download.ps1 -Path .\InfinityCloud_1.0.0-pre5_win64_setup.exe -Sha256 78dd21b814f86352f639747f7f348ab9af0d6efe1aa2630ddcd32cb844d7c909
SELF-CHECK PASS: example digest equals releases.json (InfinityCloud_1.0.0-pre5_win64_setup.exe, 516504 bytes).
EXIT=0
```

负例（在 `work/_vd-negtest/` 放一份把 Cloud digest 改成 `dddd…` 的快照后运行，测完即删）：

```
SELF-CHECK FAIL: releases.json says dddd… but the example prints 78dd21b8…
EXIT=1
```

---

## 4. 改动三：`work/gen-releases-json.mjs`（离线重建）

原来只有联网 `main()`（curl GitHub API，需 `EV_GH_TOKEN`），本轮**禁止下载**且发布已冻结，
故改为：从 `version.json` 指向的冻结清单离线重建。

- 默认（无参数）：读现有 `releases.json` 作历史基底 → 用 `cpp/release/v1.0pre5/release-assets.json`
  重写 pre5 的 6 个资产 → 重新附加 `bundles` → 写回。全程无网络。
- `--check`：①逐条核对快照 6 个资产 = 清单 6/6；②用快照自己的 `generatedAt` 重建并证明
  `repos+bundles+bundlesPendingTags+bundlesNote` 完全不变（即再跑一次是 no-op）；
  ③保留原有 bundles 孤儿校验。只读，不写文件。
- 运行结果：`--check` **exit 0**，输出
  `RELEASES-CHECK-PASS 6/6 frozen assets match the manifest; rebuild is a no-op`。
- 中途 6 个 pre4 归档因 tag 已被 pre5 取代而作为孤儿丢弃（历史保留在 `work/archive-bundles.json`），
  与改动前快照行为一致。

---

## 5. 改动四：`work/site-release-consistency.mjs`（新，34 项断言）

只读、无网络、无子进程。`node work/site-release-consistency.mjs` → **checks: 34, failed: 0, exit 0**。

### 5.1 安装包 ↔ 冻结清单
- 6 个仓库各存在 `v1.0.0-pre5` release；每个资产 size 与 digest（去 `sha256:` 前缀）逐条等于清单，
  **6/6**（逐条 PASS 行 + 表）。
- 冻结 tag 下没有清单未列出的多余资产；合计 1,920,380 B。

### 5.2 `verify-download.ps1`
- 示例名字 = 冻结 Cloud 资产名；示例摘要 = 清单 Cloud sha256 = 快照 Cloud digest；
  用法行携带冻结摘要；旧摘要 `0d5d9fcd…` 已不存在。

### 5.3 `bundles` 归档目录（独立口径，不与安装包清单比较）
- 结构完整：每条都有 `tag/platform/name/size/sha256/url`；
- url 主机为 `github.com/zssx-2026/Infinity-Archive` 且以文件名结尾；
- **CN 渲染态**：用真实 `assets/sources.js` 求值，每条 url 经 `mirror(url,'zh')` 后都是
  `gitee.com/zssx2026/Infinity-Archive/…`；
- 无孤儿：每条 bundle 的 tag 仍存在于该 repo 的 release 列表；
- **本地逐条核对 5/5**（`work/archive/<name>` 均存在，size+sha256 全部相等）：

| 仓库 | tag/platform | size | sha256 | 本地核对 |
| --- | --- | --- | --- | --- |
| Infinity-Installer-Manager | v1.0.0-pre3/win64 | 249284 | `a110b49b1a54091dbc1a7a7d346c9051053c188d1aa185ff2b9c88b4b17dbcae` | MATCH |
| Infinity-Cloud | v0.1/mac-arm64 | 31481667 | `637fec75aeeb5a2d48aba5eef8b8d2b37d7d7822ab50e8acfac3076f9eb18bba` | MATCH |
| Infinity-Cloud | v1.0.0-pre3/win64 | 428689 | `4e4bdfea6bee6d25334893bb1df271ebd1271c55e57bd69cc677f96a8472e73c` | MATCH |
| Infinity-File-Manager | v1.0.0-pre3/win64 | 172331 | `66b4c60844023f23c6616486e5395962e2ff2f56f7931efc9e499f2d9d270791` | MATCH |
| InfinityPackageManager | v1.0.0-pre3/win64 | 227286 | `1c03ed5879f4ac634da7aebc2288ede4306fc435314ff8116ca124fbab2478be` | MATCH |

  若某条本地无文件，脚本打印 `NOTE … 本地无该资产，无法离线校验` 并计为未核对，**不会**判失败、
  也不会凭空断言成立。本轮 5 条本地全有，故无 SKIP。

- `bundlesPendingTags` 含 `v1.0.0-pre5`，且没有任何 pre5 bundle（与快照 `bundlesNote` 的
  "pre5 归档尚未发布"一致）。

### 5.4 CN 自动请求 100% gitee.com
- 在 `node:vm` 沙箱中加载真实 `assets/sources.js`（zh 路径）：zh = gitee，en = github。
- 快照中 **210 条项目 URL**（含 `bundles` 归档 URL）经 `mirror(url,'zh')` 全部落在 `gitee.com`；
  同批 URL 经 `mirror(url,'en')` 全部留在 GitHub；冻结 6 个资产 URL 同样全部 gitee。
- `download.js` 走 `I.sources.mirror` + `localize(rels, source)`。
- 19 个中文页静态扫描：`script/img/iframe src`、会发起请求的 `link rel`、内联 `fetch(http…)`
  中没有任何 GitHub 内容主机（站点自身 `*.github.io` 与 `rel=canonical/alternate` 属元数据，不算自动请求）。

---

## 6. 全部命令与退出码（最终一次复跑）

| # | 命令 | 结果 | exit |
| --- | --- | --- | --- |
| 1 | `node work\gen-releases-json.mjs --check` | `RELEASES-CHECK-PASS 6/6 … rebuild is a no-op` | **0** |
| 2 | `node work\site-release-consistency.mjs` | `checks: 34, failed: 0` | **0** |
| 3 | `node work\site-seo-verify.mjs` | `pages 38 / http200 38 / rootPages 2 / sitemapLocs 36 / problems 0` | **0** |
| 4 | `node work\cn-gitee-verify.mjs` | zh hosts `{"gitee.com":189}`，en hosts `{"github.com":96}`，`checks: 76, failed: 0` | **0** |
| 5 | `node work\cn-lead-verify.mjs web` | `cnPages 19 / missingPages [] / problems 0` → `PASS 中文站完全汉化` | **0** |
| 6 | `node work\account-static-check.mjs` | `ALL 24 STATIC CHECKS PASS` | **0** |
| 7 | `web/infinity/assets/verify-download.ps1 -Example` | `SELF-CHECK PASS … 516504 bytes` | **0** |
| 8 | 负例：示例摘要与快照不一致 | `SELF-CHECK FAIL …` | **1**（预期） |

注：site-seo-verify 的断言数仍是 **38 页面 / 36 条 sitemap loc**（task-22 已把两个 404 页排除出 sitemap），
与上一轮一致，未被本任务改动。

---

## 7. 约束遵守与未做事项

- 未下载任何东西：`gen-releases-json.mjs` 的联网 `main()`（curl GitHub API）已被离线重建取代，全程未执行网络请求。
- 未安装/卸载、未结束进程、未发布（未跑 `ghsync --apply`）、未改英文页语义、未触碰 ING 源码与 `history/`。
- 只写了 4 个文件（见第 8 节）；`web/infinity/assets/` 下其余 `.js/.css` 的 mtime 均早于本任务，未被改动。
- `releases.json` 与 `verify-download.ps1` 在本仓库**未被 git 跟踪**（`git status` 为 `??`），
  故无法提供 git diff，改动前后对照以 sha256 为准。

## 8. 交付文件

| 文件 | 字节 | sha256 |
| --- | --- | --- |
| `work/site-release-sync-report.md` | 本文件 | 见文件本身 |
| `web/infinity/assets/releases.json` | 64,864 | `46806e1101a71119db9e0188bc92e50e60b5f409b337e986dc422b9c826008c7` |
| `web/infinity/assets/verify-download.ps1` | 3,581 | `d209c0ca1837f8dd907060c84bd41a8d877ec2193c968b3410a85498743f14ef` |
| `work/gen-releases-json.mjs` | 11,263 | `4d6436f158d6db7ad75bc808e9648d0e25fdd85b4b4efbe999a2623818915418` |
| `work/site-release-consistency.mjs` | 13,384 | `5764c2ccb52e81a6d09ed09d1d7b4c8c8936ec299b22a6e70617be002d19cd24` |

输入（未改动）：`cpp/release/v1.0pre5/release-assets.json` 2,485 B
`df5afe218f58497bf27e0ea34e6d8a25c012cd06c9bcb85c228f801f783662dd`。

## 9. 遗留

1. **pre5 归档缺失是有意的**：`bundlesPendingTags` 仍列 `v1.0.0-pre5`，站上显示"该平台 .zst 尚未构建"，
   与 `bundlesNote` 一致。若将来发布 pre5 归档，需要更新 `work/archive-bundles.json` 并重跑本脚本，
   一致性脚本会自动核对新条目（本地有文件时逐条校验）。
2. **联网重建路径已移除**：以后若想从 GitHub API 刷新整份快照，需要另写联网脚本；
   当前发布已冻结，离线路径是唯一可能给出正确结果的方式。
3. `releases.json` / `verify-download.ps1` 仍未纳入 git 跟踪，建议后续任务把它们加入版本控制，
   否则以后只能靠报告里的 sha256 做前后对照。
