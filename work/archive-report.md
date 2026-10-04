# rel-catalog 报告：版本归档 .zst 包（task-25）

- 完成时间：2026-10-04（Asia/Shanghai）；owner rel-catalog
- 归档仓库：**zssx-2026/Infinity-Archive**（本次新建，id 1404307388）——首选方案成功，未使用 applications 退化方案。
- 结果：**11 个 .zst 已上传并通过“回下载 sha256 一致”校验**（10 个现行版本 win64 + 1 个旧版本 Infinity-Cloud v0.1 mac-arm64）。
- 停止原因：大资产下行/上行速率实测约 40–45 KB/s，旧版本全集 4.19 GB 需约 29 h 下行 + 上行，超出本轮窗口；已把剩余队列与命令写进本报告。磁盘 D: 剩余 56.02 GB（未触发 <15 GB 停车）。

## 1. 做法与命令

每页一个 Release（tag `archive-<Product>-<version>-<platform>`），一个 `.zst` 资产。

```text
1) 逐个下载该 repo 该 tag 下属于该 platform 的全部资产（api.github.com asset 端点 + Accept: application/octet-stream + curl -L --ssl-no-revoke）
2) tar.exe -cf work/archive/work/<Product>_<version>_<platform>.tar -C <下载目录> <资产名...>
3) node -e "…z.zstdCompressSync(fs.readFileSync(in))…"   # Node v24.19.0，无 zstd CLI
4) 上传 https://uploads.github.com/repos/zssx-2026/Infinity-Archive/releases/<id>/assets?name=<file>
5) 回下载 api.github.com/repos/…/releases/assets/<id> → Get-FileHash SHA256 比对
```

实现为 `work/archive/make-bundle.ps1`（参数 -Repo -Tag -Platform）：
```powershell
& 'work/archive/make-bundle.ps1' -Repo 'Infinity-Cloud' -Tag 'v0.1' -Platform 'mac-arm64'
```
平台判定按资产名：winx86 / win-arm64 / win64 / linux-arm64 / linux / mac-arm64 / mac（sourcecode_* 也按同规则归入平台）。

## 2. 完整样例（先做 1 个再批量）

- InfinityToolbox v1.0.0-pre4 win64：下载 262,473 B（2.2 s）→ tar 内 1 个条目 `InfinityToolbox_1.0.0-pre4_win64_setup.exe` → zstd 249,181 B → 上传（1.6 s）→ 回下载 HTTP 200 / sha256 一致。
- 证明 tar+zstd 管线、上传、回下载三步都可用后才批量。

## 3. 已上传清单（全部回下载 sha256 一致）

| # | 产品 repo | 源 tag | 平台 | .zst | 字节 | sha256(前12) | 归档 Release tag |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Infinity-Toolbox | v1.0.0-pre4 | win64 | InfinityToolbox_1.0.0-pre4_win64_archive.zst | 249181 | dc01ee8876a8 | archive-InfinityToolbox-1.0.0-pre4-win64 |
| 2 | Infinity-Games | v1.0.0-pre4 | win64 | InfinityGames_1.0.0-pre4_win64_archive.zst | 249589 | d9f941c2c4b0 | archive-InfinityGames-1.0.0-pre4-win64 |
| 3 | Infinity-Installer-Manager | v1.0.0-pre4 | win64 | InfinityInstallerManager_1.0.0-pre4_win64_archive.zst | 289830 | 98df2217fe59 | archive-InfinityInstallerManager-1.0.0-pre4-win64 |
| 4 | Infinity-Installer-Manager | v1.0.0-pre3 | win64 | InfinityInstallerManager_1.0.0-pre3_win64_archive.zst | 249284 | a110b49b1a54 | archive-InfinityInstallerManager-1.0.0-pre3-win64 |
| 5 | Infinity-Cloud | v1.0.0-pre4 | win64 | InfinityCloud_1.0.0-pre4_win64_archive.zst | 465930 | f228466da6e8 | archive-InfinityCloud-1.0.0-pre4-win64 |
| 6 | Infinity-Cloud | v1.0.0-pre3 | win64 | InfinityCloud_1.0.0-pre3_win64_archive.zst | 428689 | 4e4bdfea6bee | archive-InfinityCloud-1.0.0-pre3-win64 |
| 7 | Infinity-File-Manager | v1.0.0-pre4 | win64 | InfinityFileManager_1.0.0-pre4_win64_archive.zst | 221139 | 12fe9cf45f45 | archive-InfinityFileManager-1.0.0-pre4-win64 |
| 8 | Infinity-File-Manager | v1.0.0-pre3 | win64 | InfinityFileManager_1.0.0-pre3_win64_archive.zst | 172331 | 66b4c6084402 | archive-InfinityFileManager-1.0.0-pre3-win64 |
| 9 | InfinityPackageManager | v1.0.0-pre4 | win64 | InfinityPackageManager_1.0.0-pre4_win64_archive.zst | 264738 | 73d648843866 | archive-InfinityPackageManager-1.0.0-pre4-win64 |
| 10 | InfinityPackageManager | v1.0.0-pre3 | win64 | InfinityPackageManager_1.0.0-pre3_win64_archive.zst | 227286 | 1c03ed5879f4 | archive-InfinityPackageManager-1.0.0-pre3-win64 |
| 11 | Infinity-Cloud | v0.1 | mac-arm64 | InfinityCloud_0.1_mac-arm64_archive.zst | 31481667 | 637fec75aeeb | archive-InfinityCloud-0.1-mac-arm64 |

旧版本样例 URL：https://github.com/zssx-2026/Infinity-Archive/releases/download/archive-InfinityCloud-0.1-mac-arm64/InfinityCloud_0.1_mac-arm64_archive.zst

`work/archive-bundles.json` 生成自上述记录（schema 按任务给定，`tag` 取**源版本 tag**，`url` 指向归档 Release 资产）：

```json
{
  "Infinity-Toolbox": [
    {
      "tag": "v1.0.0-pre4",
      "platform": "win64",
      "name": "InfinityToolbox_1.0.0-pre4_win64_archive.zst",
      "size": 249181,
      "url": "https://github.com/zssx-2026/Infinity-Archive/releases/download/archive-InfinityToolbox-1.0.0-pre4-win64/InfinityToolbox_1.0.0-pre4_win64_archive.zst",
      "sha256": "dc01ee8876a81b162f5d828dd7905bd9da627a328d29ad9d8056a5d26cd38ed5"
    }
  ],
  "Infinity-Cloud": [
    {
      "tag": "v0.1",
      "platform": "mac-arm64",
      "name": "InfinityCloud_0.1_mac-arm64_archive.zst",
      "size": 31481667,
      "url": "https://github.com/zssx-2026/Infinity-Archive/releases/download/archive-InfinityCloud-0.1-mac-arm64/InfinityCloud_0.1_mac-arm64_archive.zst",
      "sha256": "637fec75aeeb5a2d48aba5eef8b8d2b37d7d7822ab50e8acfac3076f9eb18bba"
    }
  ]
}
```

## 4. 覆盖率与剩余队列

| 类别 | 已完成 | 剩余 | 剩余体量 |
| --- | --- | --- | --- |
| 现行版本（v1.0.0-pre3/pre4）win64 | 10 / 10 | 0 | 0 |
| 旧版本（v1.0pre1 / v1.0pre2 / v0.1） | 1 / 37 | 36 | 4.16 GB |

旧版本剩余按产品：Infinity-Cloud 16 包，Infinity-File-Manager 10 包，InfinityPackageManager 10 包。最小剩余包约 32 MB（mac-arm64），最大约数百 MB（win64 含 setup.exe+msi+zip）。

续跑方式（逐个执行即可，脚本自带重试需人工；502 属瞬时可重跑）：
```powershell
& 'work/archive/make-bundle.ps1' -Repo 'Infinity-File-Manager' -Tag 'v1.0pre1' -Platform 'mac-arm64'   # 上轮 502，重跑
& 'work/archive/make-bundle.ps1' -Repo 'Infinity-Cloud' -Tag 'v1.0pre1' -Platform 'mac-arm64'
# 每完成一条会追加 work/archive/bundles-lines.jsonl，最后重新生成 archive-bundles.json
```

## 5. 风险与说明

1. **速率瓶颈**：小资产约 120–150 KB/s，>10 MB 资产实测约 40–45 KB/s（InfinityCloud_mac-arm64.zip 31.9 MB 耗时约 13 min）。旧版本全集 4.19 GB 在会话内无法完成，这是本轮只交付 1 个旧版本包的唯一原因。
2. **502 重试**：Infinity-File-Manager v1.0pre1 mac-arm64 下载阶段遇到 HTTP 502（远程网关），脚本抛错后队列继续；该包需重跑。
3. **.zst 体积**：源资产多为已压缩的 zip/NSIS，zstd 收益极小（249 KB→249 KB、31.9 MB→31.9 MB 级别），归档主要用于“一版本一平台一包”而非省空间。
4. **磁盘**：峰值占用为单个包解压前后，D: 由 59.6 GB → 56.02 GB；脚本在 <15 GB 时会停止并记录。
5. **未纳入**：work/archive/downloads/ 保留已下载源资产（可复用，避免重复下行）；work/archive/work/ 为空（tar 中间件已删除）。
