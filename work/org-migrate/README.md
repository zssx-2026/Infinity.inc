# Infinity 组织迁移工具（publish-org.mjs）

> 子任务 A 交付物。目标：把 Infinity 产品线编译产物从本机工作区发布到 GitHub 组织 `Infinity` 下的仓库。
> 本目录只交付**工具 + 试跑证据**；真实迁移尚未执行（被组织权限阻塞，见「当前阻塞」）。

## 1. 文件清单

| 文件 | 说明 |
| --- | --- |
| `work/org-migrate/publish-org.mjs` | 迁移工具，Node ESM，单文件，无第三方依赖（只用 `node:` 内置模块 + `fetch`） |
| `work/org-migrate/README.md` | 本文件 |
| `work/org-migrate/out/dry-run.log` | 本 README 第 5 节所贴 dry-run 输出的原始落盘副本（8386 字节） |
| `work/org-migrate/out/SHA256SUMS.txt` | `--write-sums` 用**实测字节**重算出的校验和（见第 8 节） |

## 2. 目标仓库与内容映射

| 目标仓库 | 可见性 | 内容 |
| --- | --- | --- |
| `Infinity/Infinity-Studio` | public | 三个 pre5 安装器（InfinityCloud / InfinityPackageManager / InfinityToolbox）、`name.txt`、`release-assets.json`、`SHA256SUMS.txt`；仓库根目录再写 `release-assets.json`、`SHA256SUMS.txt`、`icons/inc.ico`、`icons/ipm.ico`；大文件 `infinitystudio_gui.exe`(180MB) 需 `--include-heavy` |
| `Infinity/Infinity-Server` | public | `infinityserver_gui.exe`(180MB，heavy) |
| `Infinity/Infinity-Resources` | **private** | 大体积安装包/运行时：`ipm.exe`(89MB)、`aria2c.exe`(5.4MB)、`InfinityCloud.exe`(77MB) |

Release tag 统一为 `v1.0.0-pre5`（固定单一 release，后续同版本重跑按同名资产先删再传覆盖，不新建 tag）。

## 3. 用法

```bat
node work/org-migrate/publish-org.mjs                  :: 默认 DRY-RUN：只读探测 + 打印计划表
node work/org-migrate/publish-org.mjs --apply          :: 真正调用 API 执行
```

| 参数 | 作用 |
| --- | --- |
| （无） | 默认 dry-run：只做 GET 探测与计划渲染，零写入 |
| `--apply` | 真正执行写操作（建库 / 建 release / 传资产 / 写文件） |
| `--dry-run` | 显式声明 dry-run（与默认相同，便于脚本内自文档化） |
| `--offline` | 完全离线：跳过所有网络探测，只渲染本地计划（退出码 0，用于无网自检） |
| `--probe-org` | 只跑组织权限探测并打印结果，不做计划 |
| `--include-heavy` | 放行 4 个 `heavy` 大文件（≥64MB）的上传闸门 |
| `--only=studio\|server\|resources` | 只处理指定仓库的动作 |
| `--write-sums` | 用磁盘实测字节重算校验和，写入 `work/org-migrate/out/SHA256SUMS.txt` |
| `--sha-all` | 对全部资产计算 SHA256（默认只对参与校验和比对的文件算） |
| `--self-test` | 在个人仓库 `zssx-2026/infinity-api-probe` 上验证四条写入链路 |
| `--token-file=<路径>` | 指定 token 文件，默认 `temp/ghtoken2.txt` |

### 安全约定（已落实在实现里）

- **默认 dry-run**：不加 `--apply` 绝不写远端。
- **先探测权限**：`--apply` 时若无组织建库权限，所有写动作短路为「HTTP 403 阻塞：未发起请求」，**零写请求**，退出码 2，**不重试、不降级到个人账号**。
- **token 不落日志**：只打印 `github_pat_****CPZZ (len=93)` 形式的脱敏尾巴；curl 上传走 `-K -` 从 stdin 读配置，token 不出现在命令行参数里。
- **失败可诊断**：任何 API 失败都打印 HTTP 状态码 + 响应体前 300 字符。
- **网络直连**：不依赖代理（旧的 `Infinity Cloud/release/gh-client.mjs` 假设本地 CONNECT 代理 `127.0.0.1:13799`，实测已 ECONNREFUSED）。

## 4. 能力（四个原语）

| 函数 | 行为 |
| --- | --- |
| `ensureRepo` | `GET /repos/:o/:r` → 404 则 `POST /orgs/Infinity/repos`（`Infinity-Resources` 带 `private:true`）；已存在则跳过 |
| `ensureRelease` | `GET /repos/:o/:r/releases/tags/:tag` → 404 则 `POST .../releases`；已存在则复用，不重复建 |
| `uploadAsset` | 先查 release → `GET assets?per_page=100` → 同名先 `DELETE /releases/assets/:id` → `POST uploads.github.com`（`Content-Type: application/octet-stream`）；优先 curl，失败回退 `node:https` 流式；传完比对远端 size 与本地一致 |
| `putFile` | `GET /repos/:o/:r/contents/:path` 取 `sha` → `PUT` base64（带 `sha` 即更新）；422 时回退 `default_branch` 重试一次 |

### 退出码约定

| 退出码 | 含义 |
| --- | --- |
| **0** | 全部成功；或 `--offline` / `--help` 正常结束 |
| **2** | 被组织权限阻塞（预期负向输出，**不是故障**）；或 `--probe-org` 探测到无权限 |
| **3** | 参数错误，或未找到令牌（`temp/ghtoken2.txt` 缺失且无 `GH_TOKEN`/`GITHUB_TOKEN`） |
| **1** | `--self-test` 自检中某条写入链路失败 |

## 5. 当前阻塞

### 5.1 一句话

**当前令牌账号 `zssx-2026` 不是组织 `Infinity` 的成员，没有 admin 权限，`POST /orgs/Infinity/repos` 返回 403，三个目标仓库一个都建不了；其余写操作随之全部无法执行。**

### 5.2 实测证据（状态码）

| 探测 | 结果 |
| --- | --- |
| `GET /user` | **200**，账号 `zssx-2026` |
| `GET /orgs/Infinity` | **200**，组织存在（公开可见） |
| `GET /user/memberships/orgs` | **200**，空数组 → 当前账号**不是** `Infinity` 成员 |
| `POST /orgs/Infinity/repos`（空 body 试探） | **403** `You need admin access to the organization before adding a repository to it.` |
| `GET /repos/Infinity/Iris`、`/Kali` | **200**（public，master）→ 组织现有仓库仅此两个 |
| `GET /repos/Infinity/Infinity-Studio`、`Infinity-Server`、`Infinity-Resources` | **404** → 三个目标仓库均不存在 |

> 空 body 试探法的判定规则：`403` = 无建库权限；`400/422` = 有权限（只是 body 不合法）。因此该探测**安全**，不会误建仓库。

### 5.3 dry-run 真实输出（完整粘贴）

> 采集时间 `2026-11-01T06:29Z`。其中「耗时」与文件大小会随安装器重建而变化，属正常。

命令：`node work/org-migrate/publish-org.mjs`　退出码：**2**

```text
==============================================================
 Infinity 组织迁移工具 publish-org.mjs
==============================================================
工作区   : D:\dev\DeepSeekHarnessWorkspace\Infinity.inc
模式     : DRY-RUN（只读探测，零写入）
目标组织 : Infinity   目标 tag: v1.0.0-pre5
令牌     : github_pat_****CPZZ (len=93)  来源: file temp/ghtoken2.txt

--- 组织权限探测 ---
  GET /user                                    HTTP  200  账号 zssx-2026
  GET /orgs/Infinity                           HTTP  200  组织存在
  GET /user/memberships/orgs                   HTTP  200  当前账号不是 Infinity 成员
  POST /orgs/Infinity/repos (空 body 试探)     HTTP  403  无组织建库权限：You need admin access to the organization before adding a repository to it.

--- 迁移计划（DRY-RUN）---
  序  动作        仓库                          目标                                                本地文件                                            大小        现状
--------------------------------------------------------------------------------------------------------------------------------------------------------------------------
   1  建仓库      Infinity/Infinity-Studio      Infinity-Studio [public]                            -                                                   -           HTTP 403 阻塞：无组织建库权限，未发起请求
   2  建仓库      Infinity/Infinity-Server      Infinity-Server [public]                            -                                                   -           HTTP 403 阻塞：无组织建库权限，未发起请求
   3  建仓库      Infinity/Infinity-Resources   Infinity-Resources [private]                        -                                                   -           HTTP 403 阻塞：无组织建库权限，未发起请求
   4  建Release   Infinity/Infinity-Studio      v1.0.0-pre5                                         -                                                   -           HTTP 403 阻塞：无组织建库权限，未发起请求
   5  建Release   Infinity/Infinity-Server      v1.0.0-pre5                                         -                                                   -           HTTP 403 阻塞：无组织建库权限，未发起请求
   6  建Release   Infinity/Infinity-Resources   v1.0.0-pre5                                         -                                                   -           HTTP 403 阻塞：无组织建库权限，未发起请求
   7  传资产      Infinity/Infinity-Studio      InfinityCloud_1.0.0-pre5_win64_setup.exe            cpp/release/v1.0pre5/InfinityCloud_1.0.0-pre5_win64_setup.exe  512.0 KB    HTTP 403 阻塞：无组织建库权限，未发起请求
   8  传资产      Infinity/Infinity-Studio      InfinityPackageManager_1.0.0-pre5_win64_setup.exe   cpp/release/v1.0pre5/InfinityPackageManager_1.0.0-pre5_win64_setup.exe  290.1 KB    HTTP 403 阻塞：无组织建库权限，未发起请求
   9  传资产      Infinity/Infinity-Studio      InfinityToolbox_1.0.0-pre5_win64_setup.exe          cpp/release/v1.0pre5/InfinityToolbox_1.0.0-pre5_win64_setup.exe  297.6 KB    HTTP 403 阻塞：无组织建库权限，未发起请求
  10  传资产      Infinity/Infinity-Studio      name.txt                                            cpp/release/v1.0pre5/name.txt                       301 B       HTTP 403 阻塞：无组织建库权限，未发起请求
  11  传资产      Infinity/Infinity-Studio      release-assets.json                                 cpp/release/v1.0pre5/release-assets.json            1.3 KB      HTTP 403 阻塞：无组织建库权限，未发起请求
  12  传资产      Infinity/Infinity-Studio      SHA256SUMS.txt                                      cpp/release/v1.0pre5/SHA256SUMS.txt                 493 B       HTTP 403 阻塞：无组织建库权限，未发起请求
  13  传资产      Infinity/Infinity-Studio      infinitystudio_gui.exe                              InfinityStudio/build/win-x64/infinitystudio_gui.exe  180.0 MB    HTTP - 大文件：需 --include-heavy，本次跳过
  14  传资产      Infinity/Infinity-Server      infinityserver_gui.exe                              InfinityServer/build/win-x64/infinityserver_gui.exe  180.0 MB    HTTP - 大文件：需 --include-heavy，本次跳过
  15  传资产      Infinity/Infinity-Resources   ipm.exe                                             dist/ipm.exe                                        89.0 MB     HTTP - 大文件：需 --include-heavy，本次跳过
  16  传资产      Infinity/Infinity-Resources   aria2c.exe                                          dist/aria2c.exe                                     5.4 MB      HTTP 403 阻塞：无组织建库权限，未发起请求
  17  传资产      Infinity/Infinity-Resources   InfinityCloud.exe                                   Infinity Cloud/release/InfinityCloud.exe            88.8 MB     HTTP - 大文件：需 --include-heavy，本次跳过
  18  写文件      Infinity/Infinity-Studio      release-assets.json                                 installers/packaging/v1.0pre5/release-assets.json   901 B       HTTP 403 阻塞：无组织建库权限，未发起请求
  19  写文件      Infinity/Infinity-Studio      SHA256SUMS.txt                                      installers/packaging/v1.0pre5/SHA256SUMS.txt        624 B       HTTP 403 阻塞：无组织建库权限，未发起请求
  20  写文件      Infinity/Infinity-Studio      icons/inc.ico                                       installers/packaging/v1.0pre5/icons/inc.ico         8.2 KB      HTTP 403 阻塞：无组织建库权限，未发起请求
  21  写文件      Infinity/Infinity-Studio      icons/ipm.ico                                       installers/packaging/v1.0pre5/icons/ipm.ico         9.2 KB      HTTP 403 阻塞：无组织建库权限，未发起请求
--------------------------------------------------------------------------------------------------------------------------------------------------------------------------

--- 本地 SHA256 与 cpp/release/v1.0pre5/SHA256SUMS.txt 记录比对 ---
  不一致   InfinityCloud_1.0.0-pre5_win64_setup.exe             实测 842c322ed0835eeb  记录 78dd21b814f86352  <== 需重算
  不一致   InfinityPackageManager_1.0.0-pre5_win64_setup.exe    实测 35b8cb6f42acd181  记录 c475055ca4803482  <== 需重算
  不一致   InfinityToolbox_1.0.0-pre5_win64_setup.exe           实测 e728451891704970  记录 af90acb311306acf  <== 需重算
  一致     name.txt                                             实测 7d42adcbbf22cba1  记录 7d42adcbbf22cba1
  一致     release-assets.json                                  实测 1ef37597a2af70a8  记录 1ef37597a2af70a8
  无记录   SHA256SUMS.txt                                       实测 7a89457218eccfdb  记录 -
  [警告] 3 个文件的实际字节与 SHA256SUMS.txt 记录不一致；直接上传会让线上校验和对不上。
         先跑 --write-sums 用实测字节重算，再上传。

--- 汇总 ---
  动作总数   : 21
  可执行     : 21
  待创建     : 0（目标侧 404）
  跳过       : 4
  失败       : 0
  大文件闸门 : 4 个资产标 heavy，本次未放行（--include-heavy 才传）
  耗时       : 3.2 s
--------------------------------------------------------------
[阻塞] 无法在组织 Infinity 下创建仓库，迁移写操作全部无法执行。
--------------------------------------------------------------
原因  : 当前令牌账号对组织 Infinity 没有 admin 权限，无法创建组织仓库（HTTP 403）
GitHub: You need admin access to the organization before adding a repository to it.

需要你做的事（二选一）：
  A. 在 https://github.com/orgs/Infinity/people 把账号 zssx-2026 邀请为成员，
     角色设为 Owner（组织仓库创建必须 admin）。接受邀请后重跑本脚本。
  B. 手工在组织下建好三个仓库（Infinity-Studio 公开、Infinity-Server 公开、Infinity-Resources 私有），
     再把令牌账号加为这三个仓库的 admin，然后重跑。

本脚本不会重试写操作，也不会降级到个人账号建库。


结论: 计划已生成，但写操作被组织权限阻塞（退出码 2）。未对远端做任何修改。
```

### 5.4 `--apply` 在无权限下的行为（已验证零写入）

命令：`node work/org-migrate/publish-org.mjs --apply`　退出码：**2**

21 行动作中，**17 行**显示 `HTTP 403 阻塞：无组织建库权限，未发起请求`，另 4 行是 heavy 大文件闸门跳过（`HTTP - 大文件：需 --include-heavy，本次跳过`）——**没有任何一行真正发出写请求**。复查三个目标仓库仍为 `404`，远端零变更。这证明工具在无权限时不会写、也不会反复重试。

## 6. 需要你做什么（二选一）

### 方案 A（推荐）：把 `zssx-2026` 拉进组织并给 Owner

1. 用组织 Owner 账号打开 <https://github.com/orgs/Infinity/people>
2. `Invite member` → 填 `zssx-2026` → 角色选 **Owner**（建组织仓库必须有 admin 权限，普通 Member 不够）
3. 用 `zssx-2026` 登录接受邀请
4. 重跑 `node work/org-migrate/publish-org.mjs --probe-org` 确认第 4 行变成 `HTTP 422`（= 有权限）
5. 再跑 `node work/org-migrate/publish-org.mjs --apply`

### 方案 B：手工建三个仓库，再给令牌账号授权

1. 在 <https://github.com/organizations/Infinity/repositories/new> 手工创建：
   - `Infinity-Studio`（Public）
   - `Infinity-Server`（Public）
   - `Infinity-Resources`（**Private**）
2. 三个仓库的 `Settings → Collaborators and teams` 里把 `zssx-2026` 加为 **Admin**
3. 重跑 `node work/org-migrate/publish-org.mjs --apply`（脚本会 `GET` 到 200 后自动跳过建库，直接建 release 与传资产）

> 注意：方案 B 下若只给了这三个仓库的 admin 而未给组织 admin，`ensureRepo` 会因 404→403 失败但**不影响**已有仓库的 release/资产/文件写入。脚本对每个动作独立判定，不会因为一个动作失败而中止其余动作。

## 7. 有权限后的一键命令

```bat
cd /d D:\dev\DeepSeekHarnessWorkspace\Infinity.inc

:: 0) 先确认权限已生效（第 4 行应为 HTTP 422）
node work/org-migrate\publish-org.mjs --probe-org

:: 1) 重算校验和（必须先做，见第 8 节）
node work/org-migrate\publish-org.mjs --write-sums

:: 2) 小文件全量发布（三个安装器 + 元数据 + icons，约 1.5 MB）
node work/org-migrate\publish-org.mjs --apply

:: 3) 放行大文件（180MB ×2 + 89MB + 77MB，共约 530MB，耗时取决于上行带宽）
node work/org-migrate\publish-org.mjs --apply --include-heavy
```

只发某一个仓库：`node work/org-migrate\publish-org.mjs --apply --only=resources --include-heavy`

## 8. ⚠ 校验和与实际字节不一致（上传前必须处理）

`cpp/release/v1.0pre5/SHA256SUMS.txt` 里三个安装器的记录哈希与磁盘实际字节**全部对不上**。

**根因已查明**：`SHA256SUMS.txt` 的 mtime 是 `2026-10-24T06:14:25Z`，而三个安装器在 **`2026-11-01T06:28`（约 22 秒前）刚被并行任务重新构建**（`InfinityCloud` 与 `InfinityPackageManager` 的 mtime 分别为 `06:28:34Z` / `06:28:35Z`，`InfinityToolbox` 为 `06:06:05Z`）。文件内容变了，校验和文件没跟着更新。

| 文件 | 磁盘实测（前 16） | 文件内记录（前 16） | 判定 |
| --- | --- | --- | --- |
| `InfinityCloud_1.0.0-pre5_win64_setup.exe` | `842c322ed0835eeb` | `78dd21b814f86352` | 不一致 |
| `InfinityPackageManager_1.0.0-pre5_win64_setup.exe` | `35b8cb6f42acd181` | `c475055ca4803482` | 不一致 |
| `InfinityToolbox_1.0.0-pre5_win64_setup.exe` | `e728451891704970` | `af90acb311306acf` | 不一致 |
| `name.txt` | `7d42adcbbf22cba1` | `7d42adcbbf22cba1` | 一致 |
| `release-assets.json` | `1ef37597a2af70a8` | `1ef37597a2af70a8` | 一致 |

**后果**：直接上传，线上 `SHA256SUMS.txt` 与线上安装器对不上，下载方校验必然失败。

**处理**：

1. 先确认构建已停止（本次观测：12 秒内文件大小与 mtime 无变化，且无 `ISCC`/`makensis`/`msbuild` 进程在跑）。
2. 跑 `node work/org-migrate/publish-org.mjs --write-sums` 生成 `work/org-migrate/out/SHA256SUMS.txt`（本次已生成，内容见下）。
3. 用它替换 `cpp/release/v1.0pre5/SHA256SUMS.txt` 与 `installers/packaging/v1.0pre5/SHA256SUMS.txt` 后再上传。

> ⚠ **时序警告**：只要安装器还在被重建，校验和就是移动目标。**先等构建冻结，再跑 `--write-sums`，再 `--apply`**，三步之间不要插入新的构建。是否替换原 `SHA256SUMS.txt` 属于产品决策，工具**不擅自改写**。

```text
842c322ed0835eebb7919da9d34989ec4779ca7e4aa8894dacae5bd48d6084dc  InfinityCloud_1.0.0-pre5_win64_setup.exe
35b8cb6f42acd18114216d98fd32923c77de9f812a0d901ad02e12eb695321a6  InfinityPackageManager_1.0.0-pre5_win64_setup.exe
e7284518917049703c4e402f6df69eceba28d15e77a04cd4ef6582d35f987d04  InfinityToolbox_1.0.0-pre5_win64_setup.exe
7d42adcbbf22cba1f70e4f8b3818e32a32bbb0935ba38b0387fadef35981a121  name.txt
1ef37597a2af70a82fe5d83f2c5d1cb7b22dd7f5bb5e725c0e6d186a3123093d  release-assets.json
7a89457218eccfdbae65d1ce932ce2410852a7bc6b1330d6b45c3e1e4733f085  SHA256SUMS.txt
```

## 9. 顺带清理：`zssx-2026/infinity-api-probe` 已删除

之前探测 API 时创建的个人仓库 `zssx-2026/infinity-api-probe`（`private`，`2026-11-01T05:59:10Z` 创建，含 `README.md`、`probe.txt` 与 release `probe-v1`）**已清理完毕**：

| 步骤 | 结果 |
| --- | --- |
| 自检产生的临时 release 与临时文件 | `DELETE release` → **204**，`DELETE contents` → **200**，仓库恢复原始状态 |
| 仓库本体 | `DELETE /repos/zssx-2026/infinity-api-probe` → **204**，复查 `GET` → **404**（已不存在） |
| 其他遗留探测仓库复查 | `GET /user/repos?affiliation=owner` → **200**，19 个仓库，**无**其他 probe/selftest 类残留 |

> 更正一条早前的错误假设：原先以为细粒度 token 不含 `delete_repo` 会 403，**实测删除返回 204**，说明该 token 具备仓库删除权限。README 早前版本记录的「需人工删除」已作废，无需任何人工操作。
## 10. 自检结果（`--self-test`，已在个人仓库验证写入链路）

命令：`node work/org-migrate/publish-org.mjs --apply --self-test`　退出码：2（组织仍阻塞，但自检独立执行）

```text
  ensureRepo   HTTP 200  已存在（私有）
  ensureRelease HTTP 201  已创建 id=430401288
  uploadAsset  HTTP 201  已上传 id=697519978 远端 493 B
  putFile      HTTP 201  已写入 commit 6c5e8786c9
  自检结论     : uploadAsset 与 putFile 均可用
```

四条写入链路**全部真实打通**，并做了字节级往返校验：release 资产下载 493 B、contents 读取 493 B，`sha256` 均与本地一致（`7a89457218eccfdb…`）。也就是说：**工具本身没问题，唯一缺的就是组织权限。**

## 11. 已知限制

- 大文件（≥64MB）走 curl 上传，超时 30s 只覆盖 API 调用；`--include-heavy` 传 180MB 资产时耗时较长，脚本按单文件流式上传，无断点续传。
- `putFile` 的 contents API 单文件上限 50MB（`CONTENT_API_MAX`）；超过走 release 资产，不走 contents。
- 无组织权限时 `--apply` 固定退出码 2；这是**预期负向输出**，不是故障。
- 未实现批量回滚（如一次性撤销整个 release）。单条 `DELETE /releases/assets/:id` 与 `DELETE /repos/:o/:r` 在本 token 下均可用（实测 204），需要时按 id 手工调用即可。
- 本机 `github.com:443` 不通（clone/push 超时），因此**全部**仓库操作只能走 REST API；工具不含任何 `git` 命令路径。
- 目标仓库当前均不存在（404）；`Infinity` 组织下现仅有 `Iris`、`Kali` 两个仓库。
