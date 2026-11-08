# IPM 安装器体积与脚本契约对齐（2026-10-17）

## 一、现象：三个产品的 win64 安装包差一个量级

| 产品 | setup win64 | 载荷来源 | 载荷体积 |
| --- | ---: | --- | ---: |
| Infinity Cloud | 40,881,185 B | layout | 85 文件 / 525.2 MiB |
| Infinity File Manager | 21,178,225 B | layout | 10 文件 / 77.4 MiB |
| InfinityPackageManager | **148,603,675 B** | layout | 101 文件 / 530.9 MiB |

IPM 与 INC 的载荷几乎一样大（525 MiB 对 531 MiB），安装包却大 3.6 倍——体积差异不可能来自载荷内容。

## 二、根因：IPM 的 nsis.nsi 从来没设过压缩器

- `Infinity Cloud\installer.nsi:37` → `SetCompressor /SOLID lzma`
- `Infinity File Manager\installer.nsi:30` → `SetCompressor /SOLID lzma`
- `InfinityPackageManager\nsis.nsi` → **原本没有这一行**，NSIS 退回默认 zlib

IPM 载荷里有两份字节数完全相同的 Electron 壳（`ipm_gui.exe` 与 `ipmx_gui.exe` 各 188,784,128 B，
合计 377.6 MiB，占载荷 71%）。`/SOLID` 让 NSIS 把整个载荷当一个连续流压缩，两份高度相似的壳能折叠；
zlib 分文件独立压缩做不到。这就是 148 MB 与 40 MB 的差别。

已修：在 `CRCCheck off` / `RequestExecutionLevel admin` 之后插入中文注释块 + `SetCompressor /SOLID lzma`
（现 nsis.nsi 第 37 行）。

## 三、载荷实测（InfinityPackageManager\build\setup-stage\win64）

101 文件 / 530.9 MiB：

- 两个 Electron 壳 188,784,128 ×2 = 377.6 MiB（IPM 的 gui 是 Electron，与 INC 同构，必须保留）
- `node.exe` 80,511,640（共享运行时，只此一份）
- `locales/` 55 文件 40.3 MiB、`icudtl.dat` 10,468,208、`LICENSES.chromium.html` 9,170,910、`libGLESv2.dll` 8,417,792
- `resources.pak` 5,756,465、`aria2c.exe` 5,649,408、`app.cjs` 331,970
- 命令行面六份启动器各 49,152 B；`ipm.ico` 9,467 B

## 四、模板占位符化（nsis.nsi 11,181 → 11,680 B，343 行）

原来脚本里写死了本机路径（第 221 行 `File /r "D:\丁陈子豪\InfinityPackageManager\*.*"`）与固定版本号，
无法被检查器与构建脚本复用。改为 INC/IFM 同款四占位符：

| 行 | 改动 |
| ---: | --- |
| 21 | `!define PRODUCT_VERSION "@@VERSION@@"` |
| 25 | `OutFile "@@OUTFILE@@"` |
| 221 | `File /r "@@APP_DIR@@\\*.*"` |
| 232 | `DisplayIcon` 由 `$INSTDIR\ipm_launcher.exe` 改为 `$INSTDIR\ipm.ico` |
| 242/243/247 | 三条 `CreateShortCut` 各补第四个参数 `"" "$INSTDIR\ipm.ico" 0` |
| 36/37 | 新增 `!define MUI_ICON` / `MUI_UNICON` 指向 `@@APP_DIR@@\ipm.ico` 与压缩器 |

## 五、make-setup.mjs 对齐（6,773 → 7,537 B）

- `stage()`：Electron 壳暂存之后硬校验并拷 `icons\ipm.ico` 到载荷（缺图标直接抛错，与 INC 同款语义）
- `compile()`：删掉只替换两条路径的旧正则，改为四占位符整体填充，并在写盘前断言无 `@@` 残留：

```js
const left = ['@@VERSION@@','@@OUTFILE@@','@@APP_DIR@@','@@EXE@@']
  .filter(function (p) { return filled.indexOf(p) >= 0; });
if (left.length) throw new Error('the template still holds: ' + left.join(', '));
```

- BOM 契约不变：`fs.writeFileSync(nsi, '\uFEFF' + template, 'utf8')`

## 六、work/ipm-nsi-check.mjs（3,413 B）

IPM 没有 `sourcecode/` 目录，`nsi-check.mjs` 的 `findPayloadRoots()` 扫不到它的载荷；而模板态脚本
（仍含 `@@`）又会被按「共存家族」误判出 un.onInit、$HASH_KEY_THIS 等一堆 error。该脚本自己完成
与 make-setup 相同的占位符填充，把**实例**交给 nsi-check，让老家族专属断言降级为 INFO。

实测：exit 0，`bytes=11849 lines=343 sections=8 functions=5 regWrites=21 shortcuts=3`，
`OK: 0 error, 0 warning`，`IPM-NSI-CHECK PASS`。已接入终验第 26 项。

## 七、顺带发现（未改，仅记录）

- `Infinity File Manager\sourcecode\build\setup-stage\win64` 里有 `inc.ico`（102,134 B），
  但 `Infinity File Manager\installer.nsi` 全文没有引用它，`make-setup.mjs:123` 是主动拷的。
  属无害冗余，不是错误，本轮不动。
- IPM 三平台 setup 仍是压缩器修复**之前**的产物（win64 148,603,675 / winx86 137,945,458 /
  win-arm64 145,001,291，均 2026-10-16）。重编需 makensis，属重型构建。

## 八、待办

- 主机 free RAM 1.6 GiB / 13.69 GiB 处于低谷，按「资源不足时暂停构建」准则本轮**未**跑 makensis。
  待资源回升后重编 IPM 三平台 setup，实测 /SOLID lzma 的收益（预期 win64 从 148 MB 降到 40 MB 量级）。
- 恢复其余 5 个平台 runtime 主副本（禁止下载，需本地同源副本或用户授权）。