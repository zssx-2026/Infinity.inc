# 历史归档独立验证报告

- 生成时间: 2026-10-04 15:47:56 +08:00
- 验证者: hist-verifier (独立实现 work/verify-history.ps1; 未调用 work/unpack-history.mjs)
- 结论: **PASS**
- 归档文件: D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\history\history.jsonl (276,969,754 字节)
- 归档 SHA-256: b136ec6f90bb355528bd32e1a8a31d71c93dcf9cb6854c9521ec2376fb7ce4cf
- 清单文件: D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\work\history-manifest.json (5,710,342 字节)
- 覆盖模式: FULL - 全部 entry 逐条哈希校验

## 1. chunk 层校验 (全量)

| 项目 | 值 |
|---|---|
| chunk 数 (实际 / header) | 85 / 85 |
| chunk 解压合计 (含跨包重复) | 1,420,779,453 |
| 按内容哈希去重唯一字节 | 1,343,363,336 |
| 唯一 blob 数 (按内容哈希) | 23012 |
| n 与实际长度不一致 | 0 |
| 解压异常 chunk | 0 |
| 非末尾 chunk == chunkBytes | WARN 非失败 (1/84 个非末尾 chunk 不等于 chunkBytes: #75=12453894) |
| 序号连续性 | PASS (0..84 连续) |

## 2. entry 层校验

| 项目 | 值 |
|---|---|
| entry 条目数 | 26354 |
| 条目声明总字节 sum(s) | 1,453,849,729 |
| 已哈希校验条目 | 26354 / 26354 |
| SHA-256 不一致 (mismatch) | 0 |
| 段长合计与 s 不一致 | 0 |
| 非法/越界段 | 0 |
| 路径重复条目 | 0 |
| 哈希校验通过条目 | 26354 |
| 拼装总字节 (已校验范围) | 1,453,849,729 |

## 3. history-manifest.json 交叉核对 (全量)

| 项目 | manifest | 归档实际 | 结果 |
|---|---|---|---|
| 条目数 | 26354 | 26354 | PASS |
| 总字节 | 1453849729 | 1453849729 | PASS |
| uniqueBytes | 1343363336 | 1343363336 | PASS |
| blobs | 23012 | 23012 | PASS |

- 路径匹配: 26354 / 26354; manifest 缺失: 0; manifest 多余: 0
- 大小不一致: 0; 哈希不一致: 0; manifest 内部重复路径: 0
- 根目录: header D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\history / manifest D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\history -> PASS

## 4. header 一致性

- files=26354 origBytes=1453849729 uniqueBytes=1343363336 blobs=23012 chunks=85 codec=brotli
- header 问题数: 0

## 5. 覆盖范围说明

- 全量: 85 个 chunk 全部解压校验; 26354 条 entry 全部逐条重建并计算 SHA-256; manifest 全部条目交叉核对。
- 未验证项: 不校验 entry 的 mtime 与磁盘原始文件 (约束要求不读取/不修改 history/ 原始数据), 不校验压缩率。
- uniqueBytes/blobs 口径: 与按内容 SHA-256 去重后的条目合计/数目比对; chunk 解压合计单独列出, 合并归档可因跨包重复而大于唯一字节。

## 6. 失败明细

无。全部检查通过。

## 7. 复现命令

    pwsh -File work/verify-history.ps1 -Archive history/history.jsonl -Manifest work/history-manifest.json -Report work/verify-report.md

## 8. 执行环境

- PowerShell: 7.4.6 (8.0.23, Core)
- Brotli 实现: System.IO.Compression.BrotliStream
- 宿主: C:\Program Files\dotnet\dotnet.exe
- 说明: 本机未安装系统级 pwsh 7, 验证通过便携版 PowerShell 7.4.6 (dotnet exec pwsh.dll) 执行; 脚本本身要求 PowerShell 7+ 与 .NET 5+。
