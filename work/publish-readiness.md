# 发布就绪报告（publish readiness）— v1.0.0-pre5

时间：2026-10-11（Asia/Shanghai）｜作者：Lead｜一键自检：`node work/publish-preflight.mjs`

## 1. 结论

**技术项全绿；发布被人工闸门 + 一个外部瞬时限流闸门阻塞（未执行任何写操作）。**

    PUBLISH-PREFLIGHT PASS  technical=7/7  ready=false  tag=v1.0.0-pre5
    GATE  EV_GH_TOKEN         Contents:Read+Write 的 GitHub token（环境变量）
    GATE  written-approval    work/_publish-approval.txt 内的书面批准
    GATE  github-api-quota    匿名 GitHub API 403（未登录配额 60 次/小时）：remaining=0，重置于 2026-10-11T05:01:42.000Z

## 2. 自检明细（work/publish-preflight.json）

| 检查 | 结果 | 耗时 |
|---|---|---:|
| release-set-parity（6 安装包两处逐字节一致） | PASS | 0.2s |
| sha256sums --check @ cpp/release/v1.0pre5 | PASS | 0.1s |
| sha256sums --check @ installers/packaging/v1.0pre5 | PASS | 0.1s |
| gen-releases-check（离线清单 6/6） | PASS | 0.1s |
| site-release-consistency（站点 ↔ 清单） | PASS | 0.1s |
| ghsync --dry-run --remote | **外部闸门**（见 §3） | 2.2s |
| docs-hash-coverage（14/14 哈希在 2 份发布文档中） | PASS | 0s |

## 3. 关于 ghsync 远程检查的 403（重要）

本轮验收曾出现 `FAILED publish-preflight :: PUBLISH-PREFLIGHT FAIL technical=6/7`。查明原因是**外部限额**，不是发布链回归：

    curl.exe --ssl-no-revoke -sS -i https://api.github.com/rate_limit
      HTTP/1.1 200 OK
      X-RateLimit-Limit: 60
      X-RateLimit-Remaining: 0
      X-RateLimit-Used: 60
      X-RateLimit-Reset: 1791694902   ->  2026-10-11T05:01:42Z

    curl.exe --ssl-no-revoke -sS -i https://api.github.com/repos/zssx-2026/Infinity.inc
      HTTP/1.1 403 rate limit exceeded
      {"message":"API rate limit exceeded for 117.185.182.162. ..."}

今天多次运行干跑（终验套件里跑了 4~5 次，每次 9 个 GET）耗尽了**未登录的 60 次/小时**配额。
处理方式（已落地）：

- `publish-preflight.mjs`：**仅在未提供 token 时**把 HTTP 403 归类为外部闸门 `github-api-quota`，并用 curl 探测 `x-ratelimit-*` 给出重置时间；**有 token 时的 403 仍按真错误处理**（那是权限问题）；
- 终验套件改用**本地干跑**（`node work/ghsync.mjs --dry-run`，不触网）+ `publish-preflight --skip-remote`，避免反复烧配额；
- 每轮的"发布就绪"报告仍会执行一次完整远程探测（配额恢复后即自动转绿）。

## 4. 待发布内容

- tag：`v1.0.0-pre5`（版本 `1.0.0-pre5`），6 个仓库各 1 个安装包：

| 安装包 | 字节 | sha256(前16) |
|---|---:|---|
| InfinityCloud_1.0.0-pre5_win64_setup.exe | 516,504 | `78dd21b814f86352` |
| InfinityFileManager_1.0.0-pre5_win64_setup.exe | 239,234 | `3f3f060a9a09dd6d` |
| InfinityPackageManager_1.0.0-pre5_win64_setup.exe | 289,595 | `c475055ca4803482` |
| InfinityInstallerManager_1.0.0-pre5_win64_setup.exe | 308,219 | `82b416c70ac0e123` |
| InfinityToolbox_1.0.0-pre5_win64_setup.exe | 297,534 | `af90acb311306acf` |
| InfinityGames_1.0.0-pre5_win64_setup.exe | 269,294 | `40b21389a3c5a487` |

- 本地干跑结论（不触网）：6 个 pre5 release 均 absent → 将创建并上传；pre4 目录资产保留；
  `name.txt` 判为 "same size but content not confirmed, would be rewritten"，且 "would delete only name.txt"。

## 5. 解锁方式（都需要你）

1. 提供 `EV_GH_TOKEN`（Contents: Read and write）；
2. 写入书面批准：`work/_publish-approval.txt`；
3. （可选）等匿名配额窗口过去——提供 token 后此闸门自然消失。

三项齐备后执行：

    node work/publish-preflight.mjs          # 期望 ready=true
    node work/ghsync.mjs --apply --remote

（Lead 不会自行执行带 `--apply` 的发布，也不会 push。）

## 6. 归档侧同期状态

- 定时任务每 15 分钟追加会话日志并重建 manifest；
- 还原验证已升级为**全量穷尽**：`sample=26637 exact=26637 mismatch=0`，比对 1.51 GiB（详见 `work/archive-duplicate-paths-report.md` §8）。

## 7. 发布工具本地校验器单元自测（无网络，2026-10-11）

新增 `work/ghsync-validator-test.mjs`：在 `cpp/release/` 下临时搭建夹具（名以 `_ghst-` 前缀或占用未用版本号，
`finally` 保证测试后全部清除、真实发布树零改动），用 `INC_RELEASE` 指向夹具运行 `node work/ghsync.mjs --dry-run`（本地模式、不上网）。

| 用例 | 期望 | 实测 |
|---|---|---|
| 阳性：冻结的 v1.0pre5 完整集合 | exit 0 / "DRY RUN complete: 0 errors" | ✅ |
| 安装包被追加 1 字节 | exit 1 / "asset size mismatch" + "asset sha256 mismatch" | ✅ |
| 安装包文件缺失 | exit 1 / "asset file missing"（含文件名） | ✅ |
| `name.txt` 出现清单外的幽灵行 | exit 1 / "name.txt line is not in release-assets.json" | ✅ |
| 目录名与清单 tag 不符（dir=v1.0pre6, tag=v1.0.0-pre5） | exit 1 / "does not match directory" | ✅ |

结论：`GHSYNC-VALIDATOR-PASS 5/5`。该自测已纳入终验套件（第 21 项）。
发布门禁由"每次跑一次端到端干跑"升级为"每次跑 5 组验收边界的单元用例"。
