# task-10 文档写作报告（rel-publish）

- 任务：Infinity.Inc 对外文档 —— 根 README 与 v1.0pre4 发行说明
- 执行者：rel-publish
- 日期：2026-10-04（Asia/Shanghai）
- 写作用域内实际改动：`README.md`（更新）、`docs/RELEASE-v1.0pre4.md`（新建）、`work/docs-report.md`（本文件）
- **未改动**：`web/`、`cpp/`、`dist/`、`history/`，以及任何 Release/仓库状态

## 1. 交付物

| 文件 | 状态 | 内容 |
| --- | --- | --- |
| [README.md](../README.md) | 更新（11,812 字节） | 顶部中英索引（树形）→ 中文正文 → English 原文（原内容整体保留，标题降一级）。中文部分含六应用与下载表、30 个可执行名的命名规则、构建/发布命令、发布约定、目录结构、更多资料表 |
| [docs/RELEASE-v1.0pre4.md](../docs/RELEASE-v1.0pre4.md) | 新建（12,697 字节） | v1.0pre4 发行说明：版本/日期/状态、6 个安装包（名称、字节、sha256、下载页与直链）、六应用定位、本版包含什么与验收口径、`.itbt` 容器摘要、IPM 目录与 `name.txt` 六列语义、历史归档还原用法与结果、已知限制、相关文件、English summary |
| [work/docs-report.md](docs-report.md) | 新建 | 本报告 |

文件名按 Lead 本轮指示使用 `docs/RELEASE-v1.0pre4.md`；task-10 原始描述里的 `docs/release-notes-v1.0pre4.md` 未创建，以免出现两份互相漂移的发行说明。若需要旧名，可加一个跳转文件，请告知。

## 2. 每个数字的来源（全部为核对过的真实值）

| 文档中的数字 | 值 | 来源 |
| --- | --- | --- |
| 安装包数量 | 6 | `cpp/release/v1.0pre4/release-assets.json`（6 条 assets） |
| 单个安装包字节/SHA-256 | 477,846 / 235,017 / 278,021 / 302,978 / 262,473 / 262,882 及对应 sha256 | 同上；并与线上资产回下载、GitHub API `digest` 四方比对（见 [work/rel-publish-report.md](rel-publish-report.md) 第 4 节） |
| 六包合计 | 1,819,217 字节 | 上表求和 |
| Release 公开时间 | 2026-10-04T07:08:55Z | GitHub API `GET /repos/zssx-2026/Infinity-Cloud/releases/tags/v1.0.0-pre4` 的 `published_at`（北京时间 2026-10-04 15:08） |
| 发布账号 / 状态 | `zssx-2026` / `draft=false`、`prerelease=true` | 同一次 API 调用 |
| `name.txt` | 614 字节，sha256 `b2a95228…baf75f` | 本地文件实测 `Get-FileHash` |
| `release-assets.json` | 2,485 字节，sha256 `e29c8207…3624c5e` | 本地文件实测 |
| 30 个可执行名（6/6/6/4/4/4） | — | [work/rel-cpp-report.md](rel-cpp-report.md) 第 3 节（严格按 `cpp/core/include/inc/mode.hpp` 实际接受的面生成） |
| 「外部依赖 = none」 | 6/6 | [work/rel-cpp-report.md](rel-cpp-report.md) 第 4 节（`objdump -p` 逐 exe 审计） |
| 每包载荷文件数 7/7/7/5/5/5 | — | [work/rel-cpp-report.md](rel-cpp-report.md) 第 4 节（`7z x` 解包清单 + Uninstall.exe） |
| `--version` 输出 `1.0.0-pre4` | 6/6 | [work/rel-cpp-report.md](rel-cpp-report.md) 第 4 节 |
| `.itbt` 布局与规则 | magic `ITBT`、version 1、flags bit0=deflate、headerSize/entryCount/totalSize、entry 表字段 | [work/ITBT-FORMAT.md](ITBT-FORMAT.md)（契约）；实现位置 `cpp/apps/int/main.cpp` 与 `cpp/tools/itbt/itbt-pack.cpp` 已核对存在 |
| `name.txt` 六列语义与排序 | 6 列 + package→platform→version 降序 | `cpp/apps/ipm/main.cpp`、`dist/bundle.js`（引自已核对的说明）；本仓库 [cpp/release/v1.0pre4/name.txt](../cpp/release/v1.0pre4/name.txt) 六行原样引用 |
| `application-inc` 页 | 7 资产（6 安装包 + `name.txt` 614 B），Release id 398198245 | GitHub API（本次核验） |
| history 归档 | 276,969,754 字节 / 26,354 entry / 85 chunk / 16 MiB / origBytes 1,453,849,729 / brotli | [work/restore-report.md](restore-report.md)（hist-restorer 独立实现并验证）；归档文件本地实测 276,969,754 字节 |
| 还原结果 | 全量 26,354/26,354、抽样 500/500、不一致 0 | 同上 |
| 还原脚本参数与退出码 | `-Archive`/`-Manifest`/`-OutDir`/`-All`/`-Path`/`-MinSample`/`-TopLargest`/`-ChineseSample`/`-CrossChunkSample`，退出码 0/3 | [work/restore-history.ps1](restore-history.ps1) 的 `param` 块实测 |

## 3. 本次执行的校验（脚本化，非肉眼）

1. **相对链接存在性**：解析 README 与发行说明中的全部相对 Markdown 链接，逐个 `fs.existsSync`；结果 **MISSING_LINKS=0**（README 14 条、发行说明 16 条）。
2. **资产行配对**：对 `release-assets.json` 的 6 条资产，逐条检查文档中是否同时出现正确的 name、字节数（千分位格式）、完整 sha256 与对应仓库 URL；结果 **ASSET_ROWS_BAD=[]**。
3. **合计与描述文件哈希**：文档中 1,819,217 / 614 / 2,485 三个数字与两个 sha256 全部命中实测值。
4. **history 数字**：`276,969,754`、`26,354`、`85`、`1,453,849,729`、`26,354/26,354`、`500/500` 均在文档中出现。
5. **营销词扫描**：`强大/赋能/一站式/完美/极致/颠覆/业界领先` 全部未出现。
6. **锚点**：索引中的跳转锚点与中文/英文小节标题对应（`#中文`、`#english`、`#产品与下载`、`#构建与发布`、`#目录结构`，以及发行说明的 `#5-ipm-目录与-nametxt`）。
7. **index 锁检查**：写入期间未产生 `.git/index.lock`；本次任务未执行任何 git 写操作。

## 4. 发现并处理的问题

- **QA 报告文件名与任务描述不一致**：task-9 要求 `work/rel-qa-report.md`，实际落盘为 [work/qa-report.md](qa-report.md)（内容确为 v1.0.0-pre4 独立 QA 报告）。文档按**真实存在**的文件名链接，避免悬空链接。
- **`cpp/README.md` 仍写「四个产品」与 pre3 的体积表**：不在本次写作用域（`cpp/` 禁止改动），已在发行说明第 7 节作为已知限制列出，并指向 [work/rel-cpp-report.md](rel-cpp-report.md) 第 6 节。建议后续单独派人同步。
- **README 的中英结构**：原 README 为纯英文且内容准确，本次**完整保留**为 `## English` 一节（标题整体降一级），中文为主文档放在前面，顶部加中英合一索引。未删除任何原有事实或链接。

## 5. 未做与不做

- 未执行 `git add/commit/push`，未触发任何 Release/资产变更；三个文件是否入库由 Lead 决定（[work/ghsync.mjs](ghsync.mjs) 已可同步）。
- 未改 `web/` 的下载页（其内容归 task-8/前端写作用域）；发行说明中的下载链接直接指向各应用仓库 Release。
- 未新增 `docs/release-notes-v1.0pre4.md`（见第 1 节说明）。
