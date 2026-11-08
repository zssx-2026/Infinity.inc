# task-29 · 每个应用一份自己的 Chromium（Chormium/<应用名>）

## 0. 状态与硬约束

| 项 | 状态 |
| --- | --- |
| 六份独立副本 | **已完成**（静态产出） |
| app.json / prefs.json / resources 覆盖 / 图标 / 每份 README | **已完成** |
| 每份 patches/ 三个真实补丁 | **已完成**，18/18 `git apply --check` 通过 |
| manifest-<app>.json（sha256）与体积核算 | **已完成** |
| 真实启动验证（exit=0 / 渲染本地页） | **未执行 —— 待 Lead 批准**（运行禁令；脚本与清单已就绪） |

Lead 20:31 与 20:45 令：禁止启动任何 .exe / 浏览器 / WebView2 / CEF 宿主 / 编译 / smoke；
因此本任务的全部证据都是**静态**的（文件、哈希、补丁可应用性），运行证据见 `Chormium/RUN-VERIFICATION.md`。

## 1. 满足用户三条要求

1. **每个 Chromium 放在 /Chormium/应用名** → `Chormium/inc` `Chormium/ifm` `Chormium/ipm` `Chormium/iim` `Chormium/int` `Chormium/ing`；
2. **六个应用全部用 Chromium** → 六个应用各有一份完整 CEF/Chromium 运行时（libcef.dll + resources.pak + icudtl.dat + locales + SwiftShader/D3D），配 app.json 绑定协议/端口/标题/图标；
3. **允许自己改 Chromium 适配应用** → 每份自带 `patches/`（针对 Chromium 141.0.7340.2 源码的真实补丁）+ 独立可替换的 DLL，改任意一份不影响其它五份。

## 2. 六份副本与来源

| 应用 | 产品名 | 协议 | UI 端口 | 文件 | 字节 | MiB |
| --- | --- | --- | --- | --- | --- | --- |
| inc | Infinity Cloud | `inc://` | 7621 | 28 | 340,671,917 | 324.89 |
| ifm | Infinity File Manager | `ifm://` | 7623 | 28 | 340,671,695 | 324.89 |
| ipm | InfinityPackageManager | `ipm://` | 7632 | 28 | 340,673,194 | 324.89 |
| iim | Infinity Installer Manager | `iim://` | 7643 | 28 | 340,671,577 | 324.89 |
| int | Infinity Toolbox | `int://` | 7653 | 28 | 340,671,771 | 324.89 |
| ing | Infinity Games | `ing://` | 7664 | 28 | 340,671,805 | 324.89 |

| 应用 | 来源 | 生成方式 |
| --- | --- | --- |
| inc / int / iim / ifm | `work/chromium-trim/out/<app>`（已裁剪并验证过的内核） | 独立文件复制（fs.copyFileSync，逐字节） |
| ipm / ing | `work/chromium-trim/src/cef/cef_binary_154.0.33+ga03e714+chromium-154.0.8037.94_windows64_minimal` | 用与 `trim.mjs` 相同的 KEEP 策略现场裁剪（逐个成员与 `origin-files.json` 的 tar 尺寸校验后才复制） |

CEF 154.0.33 / Chromium 154.0.8037.94 运行时；CEF minimal 归档 sha1 `fced8a0428b7ef68d0df5e288281c673798d3071`。
生成脚本：`Chormium/_tools/build-app.mjs`（`--force` 重跑，纯文件复制，不启动任何进程）。

## 3. 每份副本的内容（28 个清单文件 + manifest 自身）

- **13 个 CEF 运行时成员**：libcef.dll、chrome_elf.dll、v8_context_snapshot.bin、icudtl.dat、resources.pak、chrome_100_percent.pak、LICENSE.txt、d3dcompiler_47.dll、vk_swiftshader.dll、vk_swiftshader_icd.json、vulkan-1.dll、locales/en-US.pak、locales/zh-CN.pak；
- **3 个运行件**：kernel-host.exe（CEF C-API 宿主）、smoke.html、app-profile.json（本副本的裁剪策略/来源）；
- **7 个应用化配置**：app.json、prefs.json、assets/app.ico（来自 `icons/<app>.ico`）、resources/branding.json、resources/default-settings.json、resources/newtab.html、README.md；
- **5 个补丁件**：patches/01-branding.patch、02-product-name.patch、03-startup-local-ui.patch、patches/README.md、patches/apply-check.txt。

### 3.1 app.json（应用绑定）

含 `appId`、`productName`、`scheme`（inc://、ifm://、ipm://、iim://、int://、ing://）、
`ui`（127.0.0.1 + 端口 7621/7623/7632/7643/7653/7664）、`window`（标题、图标 assets/app.ico、1280×800）、
`runtime`（CEF/Chromium 版本、libcef.dll、扁平布局）、startPage=resources/newtab.html、patchesDir、manifest 文件名。

### 3.2 prefs.json（首开与特性）

- 关闭首次运行向导/默认浏览器询问：`kernel_flags` 含 `--no-first-run --no-default-browser-check --disable-component-update --disable-background-networking`，`chromium_user_prefs` 里 `first_run_flow.completed=true`、`browser.check_default_browser=false`、`browser.has_seen_welcome_page=true`；
- 主题跟随系统：`theme.mode="system"`（深色回退），默认 `color_scheme="system"`；
- 只允许本地/loopback：`network.allow_external=false`、`loopback_origin_only=http://127.0.0.1:<port>/`，并关闭 Translate/MediaRouter/OptimizationHints 等无关特性；
- 遥测关闭：`telemetry.enabled=false`。

### 3.3 resources 覆盖（品牌 / 默认设置 / 首开新标签页）

| 文件 | 作用 |
| --- | --- |
| `resources/branding.json` | Infinity.inc 公司名、应用全/短名、安装器名、bundleId `<app>.infinity.inc`、协议、图标路径 |
| `resources/default-settings.json` | 首开页、是否恢复会话、配色、loopback 网络策略、语言 zh-CN、本地搜索 |
| `resources/newtab.html` | 本地渲染的首开页（无外部请求），带校验标记 `NEWTAB RENDERED OK <app>` |

## 4. 适配性修改：每份 patches/ 三个真实补丁

目标源码：`D:\dev\Chormium\src141\chromium-141.0.7340.2`（Chromium **141.0.7340.2**，已核对 chrome/VERSION：MAJOR=141 MINOR=0 BUILD=7340 PATCH=2）。

| 补丁 | 目标文件 | 改动 | hunks |
| --- | --- | --- | --- |
| 01-branding.patch | `chrome/app/theme/chromium/BRANDING` | COMPANY_*/PRODUCT_*/INSTALLER_* 改为 Infinity.inc 与各应用名，MAC_BUNDLE_ID 改为 `<app>.infinity.inc` | 1 |
| 02-product-name.patch | `chrome/app/chromium_strings.grd` | IDS_PRODUCT_NAME / IDS_SHORT_PRODUCT_NAME 的 Chromium 改为应用名/短名 | 1 |
| 03-startup-local-ui.patch | `chrome/browser/ui/startup/startup_browser_creator_impl.cc` | 首个窗口由默认新标签页改为本应用 loopback UI：`GURL("http://127.0.0.1:<port>/")` | 1 |

验证命令与输出（每份 `patches/apply-check.txt`，git 2.55.0.windows.4，在 src141 目录内执行）：

```
$ git apply --check --verbose 01-branding.patch
(no output; exit 0)
=> ok
$ git apply --stat 01-branding.patch
 chrome/app/theme/chromium/BRANDING | 15 ++++++++-------
 1 file changed, 8 insertions(+), 7 deletions(-)
```

结果：**6 应用 × 3 补丁 = 18/18 全部 `git apply --check` 通过**（汇总见 `Chormium/_tools/patch-summary.json`）。
补丁正文由目标文件的真实内容生成（上下文取自磁盘上的原文件），因此 hunks 精确可应用；
`git apply --stat` 的逐文件增删行数也一并写入各副本的 apply-check.txt。

### 4.1 为什么只交付补丁、不交付编译产物

整份 Chromium/CEF 在本机编译不了，这是硬约束（也是 lead 复述的实际约束）：

- **内存不足**：链接 chrome/libcef 需要 ≥ 64 GB 内存（中间产物 100+ GB 量级），本机远低于此，链接阶段会被 OOM 终止；
- **磁盘**：需要 ≥ 100 GB 空闲（ninja 目标文件 + PDB），本机可用空间不足；
- **工具链**：需要 depot_tools + gclient sync + Visual Studio 2022（ATL/Windows SDK）+ autoninja，本机没有 MSVC；
- 因此交付“**官方 CEF 运行时副本 + 可应用源码补丁**”：拿到编译机后 `git apply` 补丁再 `autoninja -C out/Release_GN_x64 cef` 即可产出各应用自己的定制内核。

所需机器：**≥64 GB 内存、≥100 GB 空闲磁盘、Windows 10/11 x64、VS2022、depot_tools（已 gclient sync）**。

## 5. 独立性证明（不是符号链接/硬链接）

| 指标 | 结果 |
| --- | --- |
| 符号链接 | **0** |
| 硬链接（nlink > 1）的文件 | **0** |
| 每份文件数 | 28（含 patch 与 manifest） |
| 六份合计 | 168 文件 / 1,949.34 MiB（1.904 GiB） |
| 预算 | ≤ 2,500 MiB → **通过**（余量 550.66 MiB） |
| 验证时磁盘可用 | 42.99 GiB（> 15 GiB 停车线） |

说明：`sha256` 显示六份的 libcef.dll 目前完全相同（`e73aeafb…e6b6`），kernel-host.exe 亦相同（`2792993a…a92b`）——
因为今天六份都裁自同一份官方 CEF；**独立性是文件层面的**（每份都是真实独立文件、可单独替换），
完成后任一份的 DLL/配置/补丁都可以独立演进，互不影响。逐文件哈希见各副本 `manifest-<app>.json`。

## 6. 体积表（逐份）

| 应用 | 文件 | 字节 | MiB | 符号链接 | 硬链接文件 | 补丁 |
| --- | --- | --- | --- | --- | --- | --- |
| inc | 28 | 340,671,917 | 324.89 | 0 | 0 | 3 |
| ifm | 28 | 340,671,695 | 324.89 | 0 | 0 | 3 |
| ipm | 28 | 340,673,194 | 324.89 | 0 | 0 | 3 |
| iim | 28 | 340,671,577 | 324.89 | 0 | 0 | 3 |
| int | 28 | 340,671,771 | 324.89 | 0 | 0 | 3 |
| ing | 28 | 340,671,805 | 324.89 | 0 | 0 | 3 |
| **合计** | **168** | **2,044,031,959** | **1,949.34** | **0** | **0** | **18** |

注：表中 28 个文件是每个副本**受清单管理**的全部文件；目录里另有 `manifest-<app>.json` 自身（不计入自身清单），故磁盘上每份目录实际是 29 个文件。

## 7. 静态验证清单（本次实际执行，未启动任何进程）

| # | 检查 | 方式 | 结果 |
| --- | --- | --- | --- |
| 1 | 六份副本存在且文件数一致 | `Chormium/_tools/finalize.mjs`（纯 node 读写/哈希） | 28 文件 × 6 |
| 2 | 逐文件 sha256 | 同上 | 写入 manifest-<app>.json |
| 3 | 无符号链接 / 无硬链接 | `lstat`/`stat.nlink` | 0 / 0 |
| 4 | 体积与预算 | 同上 | 1,949.34 MiB ≤ 2,500 MiB |
| 5 | 补丁可应用 | `git apply --check`（只读 git，20:45 修正令前执行） | 18/18 ok |
| 6 | CEF 成员尺寸与 tar 台账一致 | `build-app.mjs` 内校验 | 全部一致 |
| 7 | app.json/prefs.json 可解析 | 生成时 JSON.parse 回读 | 通过 |
| 8 | **manifest 自校验**（纯 node，未 spawn） | Chormium/_tools/verify-static.mjs：重读 manifest-<app>.json 后重新遍历、重算 sha256/字节/nlink | 6/6 verified；0 缺失/0 多余/0 哈希不符/0 尺寸不符/0 符号链接/0 硬链接 |

## 8. 待真实运行（已交 Lead，未执行）

见 `Chormium/RUN-VERIFICATION.md`：

- 12 次启动（6 应用 × {resources/newtab.html, smoke.html}），入口 `node Chormium/_tools/smoke-app.mjs`；
- 窗口隐藏三重保证：宿主 `--hidden`（无 WS_VISIBLE + SW_HIDE）、`spawn({windowsHide:true})`、profile/日志重定向到副本之外；
- 进程收尾：`taskkill /PID <pid> /T /F`（含 renderer/gpu 子进程），结束后断言 kernel-host-hidden.exe 残留为 0；只按自身 pid 精确清理；
- 证据：Chormium/smoke/<app>.json（exit=0、DOM 校验串、load_end http=200、clean shutdown、副本未变）、smoke/summary.json。

## 9. 未完成项 / 风险

1. **真实启动未验证**：全部运行证据待 Lead 批准后由 smoke-app.mjs 产出（唯一未闭环项）；
2. 源代码补丁只是“可应用”，**未编译**（编译需要 ≥64 GB 内存机器）；因此补丁对最终二进制的影响尚未实测；
3. 六份当前 DLL 字节相同，尚未做“只改一份”的差异化实测（差异化由 patches 与 app.json/prefs.json 体现，但需编译机才会进入二进制）；
4. 协议 scheme（inc:// 等）在 app.json 中声明，尚未在 Windows 注册表注册为系统 URI 处理器（安装器阶段的工作）；
5. 每份的 `resources.pak` 未重打包，品牌信息以 resources/ 覆盖 + 补丁形式提供，而不是改写 .pak。

## 10. 复现命令（全部为静态/生成步骤）

```
node Chormium/_tools/build-app.mjs --force     # 生成/刷新六份副本（纯文件复制）
node Chormium/_tools/make-patches.mjs          # 生成补丁 + git apply --check（需 git，只读）
node Chormium/_tools/finalize.mjs              # 生成 manifest-<app>.json 与体积核算
```

（运行验证命令与禁令见 `Chormium/RUN-VERIFICATION.md`，未获批准不得执行。）
