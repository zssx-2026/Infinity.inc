# v1.0pre5 发行产物：校验清单与"两处冻结"一致性

时间：2026-10-11（Asia/Shanghai）｜作者：Lead

## 1. 本轮发现与修正

1. **主目录缺校验清单**：`cpp/release/v1.0pre5/`（ghsync 默认上传源，取 `cpp/release/` 下最新版本目录）
   只有 6 个安装包 + name.txt + release-assets.json，没有 `SHA256SUMS.txt`；
   而打包镜像 `installers/packaging/v1.0pre5/` 有（1,311 B）。→ 已补齐（见 §3）。
2. **自我纠错**：上一轮我把 `installers/packaging/v1.0pre5/icons` 描述为"空目录"，是错的——
   Windows 上目录的 `Length` 恒为 0；该目录实际含 6 个图标
   （ifm 8,112 / iim 7,905 / inc 8,425 / ing 8,242 / int 8,241 / ipm 9,467 字节），
   且镜像 SHA256SUMS.txt 的 14 行里正好包含这 6 个 `icons/*.ico`。

## 2. 新增 `cpp/tools/sha256sums.mjs`（确定性生成 + 校验）

- 排序规则（与既有镜像文件完全一致）：清单资产按文件名字典序 → 目录内其余顶层文件 → 子目录递归；
- `--check` 模式只校验不改写，退出码非 0 表示清单与目录内容不符；
- **强证据：对已发布镜像执行 `--check`，可直接逐字节复现其 SHA256SUMS.txt**：

      node cpp/tools/sha256sums.mjs installers/packaging/v1.0pre5 --check
      { "dir": "installers/packaging/v1.0pre5", "files": 14, "wrote": false,
        "matchesExisting": true, "sumsBytes": 1311,
        "sumsSha": "ae658e2f9a34d4f2fd4b3ba54418be15329a56c29488ad5a86e1e5b4c656a6b2",
        "problems": [] }

## 3. 主目录补齐 `cpp/release/v1.0pre5/SHA256SUMS.txt`

    8 行 / 831 B / sha256 f9da3a94ec6dc959893962281aba8a51d3cbf763371942fd8939531d14309d5c
    （6 个 setup.exe + name.txt + release-assets.json）

## 4. 新增 `work/release-set-parity.mjs`（一致性检查，纳入终验）

校验项：

- 6 个安装包在 `cpp/release/v1.0pre5` 与 `installers/packaging/v1.0pre5` **逐字节一致**，且与 release-assets.json 的 size/sha256 相符；
- 两处 `release-assets.json`、`name.txt` 一致；
- 两处 `SHA256SUMS.txt` 均可由 `cpp/tools/sha256sums.mjs --check` 复现；
- 镜像 `icons/` 的 6 个 .ico 均被镜像清单覆盖；
- 两处目录无多余文件（主目录白名单：6 exe + name.txt + release-assets.json + SHA256SUMS.txt；镜像另加 icons/）。

实测：

    RELEASE-SET-PARITY-PASS 6/6 assets byte-identical; sums reproducible; 6 icons covered
    primary SHA256SUMS: 831 B f9da3a94ec6dc959
    mirror  SHA256SUMS: 1311 B ae658e2f9a34d4f2

| 安装包 | 字节 | sha256(前16) |
|---|---:|---|
| InfinityCloud_1.0.0-pre5_win64_setup.exe | 516,504 | `78dd21b814f86352` |
| InfinityFileManager_1.0.0-pre5_win64_setup.exe | 239,234 | `3f3f060a9a09dd6d` |
| InfinityPackageManager_1.0.0-pre5_win64_setup.exe | 289,595 | `c475055ca4803482` |
| InfinityInstallerManager_1.0.0-pre5_win64_setup.exe | 308,219 | `82b416c70ac0e123` |
| InfinityToolbox_1.0.0-pre5_win64_setup.exe | 297,534 | `af90acb311306acf` |
| InfinityGames_1.0.0-pre5_win64_setup.exe | 269,294 | `40b21389a3c5a487` |

## 5. 发布侧说明（仍被阻塞，未改发布链路）

- `work/ghsync.mjs` 只上传 release-assets.json 中列出的 6 个资产，**不**上传 SHA256SUMS.txt；
  若希望 GitHub Release 附校验文件，需要把 `SHA256SUMS.txt` 加入上传清单——这属于发布链路改动，
  当前发布本身被 `EV_GH_TOKEN` + 书面批准阻塞，故留作批准后一并处理（可一键加白名单）。
- 复现命令：

      node cpp/tools/sha256sums.mjs cpp/release/v1.0pre5
      node work/release-set-parity.mjs
      node work/final-acceptance.mjs   # 17 项，含 release-set-parity
