# installers/packaging（v1.0pre5 打包输入与发行暂存）

本目录是 task-4（release-v105）产出的打包资产区，权威产物仍是 `cpp/release/v1.0pre5/`。

## 目录

- `icons/` —— 六个产品的多尺寸 ICO（16/24/32/48/64/128/256）+ `preview.png`，来源 `icons/`（未新造图标）。
- `icons.sha256` —— 上述文件的 SHA-256。
- `v1.0pre5/` —— 发行暂存目录，与 `cpp/release/v1.0pre5/` 逐字节相同：
  - 6 个 `<package>_1.0.0-pre5_win64_setup.exe`
  - `name.txt`、`release-assets.json`
  - `icons/`（6 个 .ico）
  - `SHA256SUMS.txt`（本目录所有文件的摘要）

## 复验

```powershell
# 逐个比对摘要（在 installers/packaging/v1.0pre5/ 下）
Get-Content .\SHA256SUMS.txt | ForEach-Object {
  $h,$f = $_ -split '  ',2
  $got = (Get-FileHash -Algorithm SHA256 -Path $f).Hash.ToLower()
  if ($got -ne $h) { Write-Host "MISMATCH $f"; exit 1 }
}
Write-Host 'OK'
```

## 说明

- 安装器图标接线在 `cpp/tools/package.mjs`（MUI_ICON/MUI_UNICON、载荷 `File "<app>.ico"`、快捷方式图标、卸载项 DisplayIcon）。
- ING 由另一个 Agent 负责：本目录仅包含其既有二进制打包出的安装器，未改其源码。
- 版本详情与 sha256 清单见 `work/release-v1.0pre5-report.md`。
