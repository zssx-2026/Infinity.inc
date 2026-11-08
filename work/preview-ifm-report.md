# Infinity File Manager 本地文件流式预览报告（task-2）

- 执行者：prod-ifm（Team 队友）
- 日期：2026-10-05（Asia/Shanghai）
- 契约：本地随机读 256 KiB 分块；首屏 ≤800 ms；关闭立即释放句柄/取消；缓存 ≤64 MiB；文本 20k 行虚拟化；zip 只读末尾 64 KiB 找中央目录；大文件不整文件读入内存。
- 写作用域：`Infinity File Manager/`、`work/preview-ifm-report.md`。未改 ING / Infinity Games、未改 `history/` 与 `work/sync-history.mjs`、未改 `work/ghsync.mjs`；未弹窗、未起可见窗口；未使用网络与外部工具（只用内置 node v24.19.0 与 Windows PowerShell）。

## 0. 结论

1. 流式预览在 `sourcecode/src/core/preview.js`（新模块）、`sourcecode/src/gui/server.js`（API + 内嵌页面）、`sourcecode/src/core/localfs.js`（`listLocalFast`/`fillMeta`）中已成形，本轮核查未发现读取路径上的功能性缺陷，7 项契约均有可复现证据。
2. **本轮实际修掉一个真缺口：ESM→CJS 打包器不识别生成器导出**（`export async function* chunkStream`），导致 `tools/bundle.mjs` 产物残留顶层 `export`，`vm.Script` 报 `Unexpected token 'export'`，SEA bundle 无法运行。修复后 bundle 语法通过并能跑到 `--version`。
3. 现有 `build/bundle.cjs`、`build/sea-prep.blob` 仍是 2026-10-02 产物（不含 preview），完整 SEA 重建需要本机不存在的 node v22 runtime 与 postject，未重建 exe（见 §6 遗留）。

## 1. 现状盘点（本轮核查）

| 文件 | 行数 | 作用 |
|---|---|---|
| `sourcecode/src/core/preview.js` | 274 | `CHUNK=256*1024`、`TAIL=64*1024`；`readRange()` 每次 open→read→close；`chunkStream()` 异步生成器；`kindOf/kindPlan` 分型；`imageInfo/imageReadyAt` 图片头与可解码点；`zipEntries()` 尾读中央目录（含 zip64） |
| `sourcecode/src/gui/server.js` | 752 | `/api/preview`、`/api/preview/range`、`/api/preview/zip`、`/api/raw`（HTTP Range）；`withPreviewSlot`（`PREVIEW_MAX=4`）；内嵌预览页面（文本窗口化渲染、20k 行上限、64 MiB 字节上限、AbortController） |
| `sourcecode/src/core/localfs.js` | 317 | `listLocalFast()`（readdir only，首屏快）+ `fillMeta()`（后续逐文件 stat） |
| `bench/` 下 22 个脚本 | — | `preview-bench.mjs`（进程内读数）、`check-page.mjs`（页面静态检查）、`bundle-check.mjs`（打包检查）、其余为早期性能探针 |

代码事实（契约对应的实现位置）：

- 每次 range：`preview.js:107` `fs.promises.open(file,'r')` → `handle.read(...)` → `finally handle.close()`，请求之间不持有句柄。
- 页面关闭：`server.js:250-257` `pvClose()` 调 `AbortController.abort()`、`URL.revokeObjectURL()`、清空行缓冲与 DOM；播放/PDF 走 `server.js:632` `res.on('close',()=>stream.destroy())`。
- 文本上限：`server.js:246` `maxLines:20000, maxBytes:67108864`；`server.js:283-296` `pvTrim()` 截到 20000 行，`pvRender()` 只把可视窗口 ±6 行写进 DOM。
- zip：`preview.js:234-236` 只读最后 `min(size,64 KiB)`，再按 EOCD 里的 offset/size 读中央目录（上限 8 MiB）。

## 2. 发现的缺口与修复（本轮唯一源码缺陷）

### 2.1 症状

```
> node bench/bundle-check.mjs        # 修复前
"syntax": "FAIL Unexpected token 'export'"
"error": "Unexpected token 'export'"
BUNDLE_EXIT=1
```

原因：`tools/bundle.mjs` 的 `transform()` 只认 `export async function `/`export function ` 等前缀，遇到 `preview.js:122` 的 `export async function* chunkStream(...)`（第 14 位是 `*` 而不是空格）不匹配，原样透传，于是 `export` 落在打包器的工厂函数体内 → 非法。

### 2.2 修复

- `sourcecode/tools/bundle.mjs:118`：词表加入生成器形式
  `['async function* ', 'async function ', 'function* ', 'function ', 'class ', 'const ', 'let ', 'var ']`（`*` 形式必须排在非 `*` 形式之前）。
- `bench/bundle-check.mjs`：新增两条回归断言——`generatorExportTransformed`（产物中不再有顶层 `export async function*` 且含 `chunkStream`）、`generatorCallable`（把 `preview.js` 经 `transform()` 后在 CJS 包装里执行，`exports.chunkStream` 必须是 `AsyncGeneratorFunction`）。

### 2.3 修复后

```
> node bench/bundle-check.mjs
"bundleBytes": 142885, "modules": 12,
"previewModuleIncluded": true, "generatorExportTransformed": true, "generatorCallable": true,
"syntax": "ok", "version": "Infinity File Manager [v1.0pre2]  ·  Infinity.Inc", "error": null
BUNDLE_EXIT=0
```

## 3. 契约逐条对照

| 契约 | 实现 | 证据（实测） |
|---|---|---|
| 本地随机读 256 KiB 分块 | `preview.js:17` `CHUNK=262144`；`previewRange` 夹取 `length≤CHUNK` | HTTP：首块响应 262144 B，`x-eof=0`，`x-size=41943147`；读 3 MiB 文本只发 262144 B（占 8.33%） |
| 首屏 ≤800 ms | lite 列表 + 首块 | 首块中位 **15.99 ms**（5 次 25.927/7.816/15.99/12.618/16.041）；5400 项 lite 列表中位 **49.6 ms**；进程内首块 8.555 ms（2 MiB 文本）、0.89 ms（50 MiB 文本） |
| 关闭立即释放句柄/取消 | 每 range open/close；页面 abort；raw 流 close 销毁 | 代码如上；压测：连续 60 次“发起即 abort”后 `process._getActiveHandles()` **6 → 4**，服务器随后仍返回完整 262144 B |
| 缓存 ≤64 MiB | 页面 `maxBytes=67108864`；服务端不缓存整文件 | `check-page.mjs` 断言页面含 `67108864`；50 MiB 文本预览峰值读缓冲 **262144 B**，进程内大文件固定只留 20000 行 |
| 文本 20k 行虚拟化 | `maxLines=20000` + `pvTrim` + 窗口渲染（±6 行） | `check-page.mjs` 断言含 `20000`；进程内 50 MiB 文本 `maxLinesRetained=20000`，单块峰值 262144 B |
| zip 读末尾 64 KiB 中央目录 | `preview.js:234` `TAIL=65536` + EOCD→CD 定向读 | HTTP：12,667,100 B 压缩包列出 22 条，只读 **66,833 B = 65536(尾) + 1297(中央目录) = 0.528%**，16.1 ms；进程内 21 条，66776 B / 21,269,002 B = 0.314% |
| 大文件不整读进内存 | range 循环、逐块 yield；超 64 MiB 停止 | 50 MiB 文本按 201 块读完但峰值缓冲仅 262144 B；3 MiB 文本单次请求只发 1 块；`cancellation` 在 1048576 B（第 4 块）后停止循环 |

分型与不可流式类型的处理：`/api/preview` 对 `.log` 返回 `kind=text, mode=chunks, chunk=262144`；对 `.docx` 返回 `kind=null, mode=null` 且带 reason，由页面整取后再打开。音频/视频/PDF 走 `/api/raw` 的 HTTP Range（实测 206：`bytes 100-1099/12667100` 回 1000 B；`bytes=-2048` 回 2048 B；`accept-ranges: bytes`）。

## 4. 可复现命令

前置（测试数据都在 `D:/temp`，不写入仓库）：

```powershell
New-Item -ItemType Directory -Force 'D:\temp\ifm-bench' | Out-Null
cd 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\Infinity File Manager'
& 'D:\program\nodejs\node.exe' bench/mkdata.mjs          # 5400 项目录 D:/temp/ifm-bench/big
```

检查（均无窗口：HTTP 检查只绑 127.0.0.1 且 `open:false`，脚本结束 `process.exit`）：

```powershell
& 'D:\program\nodejs\node.exe' bench/check-page.mjs          # 退出码 0
& 'D:\program\nodejs\node.exe' bench/bundle-check.mjs        # 退出码 0
& 'D:\program\nodejs\node.exe' bench/preview-bench.mjs       # 退出码 0
& 'D:\program\nodejs\node.exe' bench/preview-http-check.mjs  # 退出码 0
```

实测输出摘要：

- `check-page.mjs`：`{"scriptLines":288,"ids":21,"failures":[],"PASS":true}`（21 个元素 id 全部存在、内联脚本可解析、5 条预览路由都在路由表、含 AbortController/abort/20000/67108864/PREVIEW_MAX=4/Range）。
- `preview-bench.mjs`：`failed checks: none`；文本首块 262144 B/2097200 B(12.50%) 8.555 ms；50 MiB 首块 262144 B(0.50%) 0.89 ms、201 块、峰值 262144 B；zip 66776 B/21269002 B(0.314%) 12.037 ms。
- `preview-http-check.mjs`：`failed checks: none`；见 §3 数字。脚本同时确认 5400 项 `/api/list?lite=1` 返回 5400 条。

## 5. 改动文件与 sha256

本轮由 prod-ifm 写入/修改：

| 文件 | 字节 | SHA256 |
|---|---:|---|
| `Infinity File Manager/sourcecode/tools/bundle.mjs` | 7287 | `B08477CF2DE38EDFB8B15932C453F6D52068408D71645DABB8B7221EA49CE63C` |
| `Infinity File Manager/bench/bundle-check.mjs` | 3024 | `BA2A323680D7112D0FE2E3B01E4907BCF9A9EA36684CD621F756EC7C571B39A3` |
| `Infinity File Manager/bench/preview-http-check.mjs` | 11831 | `E59A0094CCB47C5654DC1E60521BE0BE0F6116117014B4701CB9534A3B21BE0A` |

上一轮已存在、本轮核查未改（列出以便定位与复核）：

| 文件 | 字节 | SHA256 |
|---|---:|---|
| `Infinity File Manager/sourcecode/src/core/preview.js` | 12588 | `4FFC402DD47104B066B8CFAE7F2D48DFC6A7BF84ABF1E322EC62D4FDE65424B9` |
| `Infinity File Manager/sourcecode/src/gui/server.js` | 37077 | `58AC3ABBFFFE7A4FDC27C9D3644687AC6AAFC4F55A7269FF469A3E0D8B1AF92C` |
| `Infinity File Manager/sourcecode/src/core/localfs.js` | 10601 | `AFBDCFD43E602534B5F7B4F2179AEA30B7A183E88BEA577B8551395530FC4BCB` |
| `Infinity File Manager/bench/preview-bench.mjs` | 21759 | `ADBE5AB47366F49890DA2F41DA638199AA28811DFDFDAC2B9933872F7FA12468` |
| `Infinity File Manager/bench/check-page.mjs` | 2063 | `944B583B72C8DD3B7C888B26E7E97BE7E4A740D14356C347ABEA8D89A4126042` |

注意：`preview.js`、`bench/` 在 git 中是未跟踪文件；`server.js`、`localfs.js` 为已跟踪且已修改（`git diff --stat`：localfs.js +60、server.js +421）。

## 6. 证据文件与 sha256

| 文件 | 字节 | SHA256 |
|---|---:|---|
| `Infinity File Manager/work/_preview-shots/ifm/preview-bench.json` | 5406 | `6E5743E4D3835E2A81A46F36C10B243EAB65E2C0BFDA60A0AF96F20E9F9C696C` |
| `Infinity File Manager/work/_preview-shots/ifm/preview-bench.txt` | 799 | `C239289243637AB63B792D114B25632868234C64B9F1156C6BD4E1B7D31E5E4A` |
| `Infinity File Manager/work/_preview-shots/ifm/http-check.json` | 2092 | `A7FA6BCEB08A1CD0B70113EC43ECFEA46C125E038A17C2F9E2B6D7CB2DBBA714` |
| `Infinity File Manager/work/_preview-shots/ifm/http-check.txt` | 390 | `E6A9473CDBA1578B42723178B5431C6D9FF202641CBCBB1541855D4F21C502D4` |

## 7. 遗留与未验证

1. **未重建可执行文件**：`build/bundle.cjs`（129,237 B，2026-10-02 17:00）、`build/sea-prep.blob`（129,355 B）不含 preview；本机没有 `D:/temp/tools/node.exe`（v22.11.0 runtime）、seven-target runtimes 与 postject，无法跑 `tools/build-all.mjs`。构建路径只验证到“源码→bundle.cjs 语法与 `--version` 执行”。需要在有 v22 runtime 的机器上重跑 build-all 才产出新 exe。
2. **首屏是代理指标**：本机无浏览器/无头渲染，且硬性不允许起可见窗口，所以用“lite 列表响应 + 首块字节到达”代替真实 paint；真实 paint 时间未测。
3. **图片首屏**：首块即可从文件头给出占位尺寸；PNG/JPEG 必须等 `IDAT`/`EOI` 完整才可绘制（测试 PNG 1,204,771 B 处才 ready，约 100%）。这是格式特性，非实现缺陷。
4. **列表负载对比噪声大**：`preview-bench` 的 quiet 中位 52.11 ms vs 预览负载下 32.5 ms（`quietRuns` 167.73→37.09 波动），只能说明“预览读取没有把列表拖慢到契约之外”，不构成精确对比。
5. 未做真机磁盘故障注入（坏道/锁文件）下的 Zip64、超长中央目录（>8 MiB 截断）用例；`zipEntries` 有 `MAX_CD=8 MiB` 截断与 `listTruncated` 标记，但本轮未构造 >8 MiB 中央目录的样本。
