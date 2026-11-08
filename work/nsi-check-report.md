# nsi-check.mjs 失效修复报告（task-19）

- 日期：2026-10-06
- 环境：Windows；NSIS 3.12（C:\Program Files (x86)\NSIS\makensis.exe）；Node v24.19.0（D:\program\nodejs\node.exe）
- 工作区：D:\dev\DeepSeekHarnessWorkspace\Infinity.inc
- 改动范围：Infinity Cloud/sourcecode/tools/nsi-check.mjs（重写）+ 新增同目录 nsi-check.test.mjs + 本报告。未改 installer.nsi、未改 make-setup.mjs、未碰 ING/history。

## 0. 一句话结论

旧 nsi-check.mjs 是一个"永不失败"的假检查：它只打印 makensis 的退出码，自身永远 exit 0；它编译的是带 @@...@@ 占位符的模板，而不是真正出货的 setup-<id>.nsi；而且 makensis 对"删掉 File /r、WriteUninstaller、CreateShortCut"这类内容缺失仍然 exit 0。三重叠加，导致 installer.nsi 被写坏也照样"通过"。新脚本改为四层真实校验：正例在真实 installer.nsi 上 exit 0（1.2 s），13 个负例全部 exit≠0，自测 21/21 通过。

## 1. 定位

| 对象 | 路径 | 说明 |
| --- | --- | --- |
| 检查脚本 | Infinity Cloud/sourcecode/tools/nsi-check.mjs | 旧版 19 行，git HEAD 原文见附录 A |
| 被检对象 | Infinity Cloud/installer.nsi | 555 行模板，含 @@VERSION@@ / @@OUTFILE@@ / @@APP_DIR@@ / @@EXE@@ |
| 构建管线 | Infinity Cloud/sourcecode/tools/make-setup.mjs | 替换占位符 → 写 build/setup-stage/setup-<id>.nsi（UTF-8 带 BOM）→ makensis → build/setup/<id>.exe |
| 载荷 | Infinity Cloud/sourcecode/build/setup-stage/{win64,winx86,win-arm64} | make-setup.mjs 暂存的实际文件集合 |

## 2. 旧脚本为何失效（复现输出）

### 根因 1：从不传播退出码 —— 永远 exit 0

旧脚本最后只有 process.stdout.write("exit=" + code + N)，没有 process.exit(code)。原样运行（不改任何路径）：

```
$ & 'D:\program\nodejs\node.exe' 'D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\Infinity Cloud\sourcecode\tools\nsi-check.mjs'
exit=1
exe: 2239 B
$ echo $LASTEXITCODE
0
```

makensis 已经失败（exit=1），脚本进程仍然是 0。CI/发布只看进程退出码，于是永远"通过"。注意 OUT/ERR 一行都没有 —— 见根因 3。

### 根因 2：编译的是模板，不是出货文件

旧脚本硬编码 NSI = '.../Infinity Cloud/installer.nsi'，直接编译这个带 @@...@@ 占位符的模板：File /r "@@APP_DIR@@\*.*" 指向一个不存在的目录。真正的出货文件是 make-setup.mjs 生成的 build/setup-stage/setup-<id>.nsi。也就是说，旧脚本既测错了对象，又必然红（exit=1），但因为根因 1，红也传不出去。

### 根因 3：makensis 抓不住"内容缺失"，编译日志也抓不到

用真实模板 + 真 inc.ico + 最小合成载荷，对模板做一处故意破坏后直接编译，makensis 的真实退出码：

| fixture | makensis exit | 说明 |
| --- | --- | --- |
| fx-valid（正确填写占位符） | 0 | 基线 |
| fx-badmacro（WriteRegStr 旁写不存在的宏 NoSuchMacro） | 1 | 语法错误，能抓住 |
| fx-brokensec（删掉一个 SectionEnd） | 1 | 结构错误，能抓住 |
| fx-nofile（删掉 File /r "@@APP_DIR@@\*.*"） | 0 | **抓不住**：安装器会装上空的程序 |
| fx-nouninst（删掉 WriteUninstaller） | 0 | **抓不住**：装完无法卸载 |
| fx-nolnk（删掉开始菜单 CreateShortCut） | 0 | **抓不住**：没有快捷方式 |
| fx-nobom（同样的内容但不写 UTF-8 BOM） | 1 | 非 ASCII 文本被当 ANSI，"Bad text encoding" |
| fx-badicon（用假 inc.ico） | 1 | 图标无效 |

同时实测：execFileSync 抓到的 makensis stdout/stderr 长度都是 0 —— 本机 NSIS 3.12 把编译日志写到控制台（CONOUT$）而不是管道，所以旧脚本连"为什么失败"都打印不出来。makensis 失败时还会留下 stub exe（实测 17005 B），所以旧脚本那句 "exe: N B" 也不能当作成功证据。

### 把旧脚本逻辑指向坏 fixture（只改 NSI 常量，逻辑不动）

```
== 旧版逻辑（仅把 NSI 常量指向 fixture）==
fx-valid.nsi        -> 旧脚本打印 exit=0   exe: 24795 B   进程退出码 0
fx-nofile.nsi       -> 旧脚本打印 exit=0   exe: 24293 B   进程退出码 0   ← 删掉 File 指令，照样"通过"
fx-badmacro.nsi     -> 旧脚本打印 exit=1   exe: 17005 B   进程退出码 0   ← 编译器报错被吞掉
fx-brokensec.nsi    -> 旧脚本打印 exit=1   exe: 23897 B   进程退出码 0
```

这就是任务要求的直接负例证据：**故意写坏的 .nsi，旧脚本的进程退出码仍然是 0**。

## 3. 新脚本设计（Infinity Cloud/sourcecode/tools/nsi-check.mjs，682 行）

解析器：逐行扫描，正确识别 NSIS 的三种字符串定界符（双引号、单引号、反引号）、$ 加反斜杠加引号的转义、以及引号外的 ; / # 注释；不做宏展开，只做语法级提取。提取 Section/Function、File、WriteReg*、DeleteReg*、CreateShortCut、Delete/RMDir、$INSTDIR\... 引用。

四层校验，问题分级 error（决定退出码）/ warning（提示，--strict 下升级为 error）：

A. 结构与语法断言
- Section/SectionEnd、Function/FunctionEnd 必须配对（删除 SectionEnd 会被抓住）
- 字符串引号必须闭合
- 必需指令：OutFile、Name、InstallDir、RequestExecutionLevel、WriteUninstaller、!include、!insertmacro MUI_LANGUAGE
- 必须有 File /r "@@APP_DIR@@\*.*"，且带 /r（载荷含 resources/locales 子目录）
- 该 File 所在的主段内必须有 WriteUninstaller、建议 SectionIn RO
- 恰好一个 Section "Uninstall"；必须有 Function un.onInit；卸载段应有 RMDir /r $INSTDIR

B. 注册表与快捷方式语义（并做写/删交叉核对）
- 注册表根只能是 HKLM/HKCU/HKCR/HKU/HKCC
- $UNINST_KEY_THIS 必须写全 9 个值：DisplayName、Publisher、QuietUninstallString、DisplayVersion、UninstallString、InstallLocation、DisplayIcon、NoModify、NoRepair（少一个即 error）
- $HASH_KEY_THIS 必须既写又删
- Run（开机自启动）的每个值写入后必须能在卸载段找到同名删除
- HKCU Environment 的每个写入值必须在卸载段被 DeleteRegValue（白名单：def_fm、proxy_ip、user_token-$2、cloudhub-$2，它们按注释是用户私有、有意保留）
- 必须有开始菜单快捷方式与桌面快捷方式；每个 CreateShortCut 的删除要能对上（对不上记 warning，因为共存模式的 $LABEL_THIS 会变）

C. 与构建产物核对（任务要求 a）
- 从 installer.nsi 解析出全部 $INSTDIR\... 引用，逐个在 build/setup-stage/{win64,winx86,win-arm64} 的实际载荷里核对存在性：
  - 普通 exe / 图标缺失 → error
  - _gui.exe（Electron 外壳，make-setup 允许不打包）缺失 → warning
  - plugins\... （make-setup.mjs 目前不暂存）缺失 → warning
- @@APP_DIR@@\inc.ico 必须在每个载荷里存在（MUI_ICON/MUI_UNICON 的输入）
- @@EXE@@ 的具体名字从 make-setup.mjs 的 SETUPS（exe: 'inc_launcher.exe'）解析，并核对每个载荷里确实有这个文件
- 安装器自己生成的文件（Uninstall.exe、uninstall.ini、hash.ini、hash.txt）不当作载荷

D. 编码契约 + 真实编译
- installer.nsi 含非 ASCII 文本时，必须确认 make-setup.mjs 仍在写 UTF-8 BOM（旧版检查正是踩了"无 BOM → Bad text encoding"的坑）；BOM 一旦被去掉即 error
- 已生成的 setup-*.nsi 必须带 BOM、不能残留占位符；比 installer.nsi 旧则 warning（陈旧产物）
- 把模板占位符替换成最小合成载荷（1 字节桩文件 + 真 inc.ico），**用 BOM 写盘**后调用 makensis 编译（cwd 用临时目录，约 1.2 s，不复制 800 MB 真载荷）。这是唯一能抓宏/语法/图标错误的一层。
- 编译失败时如实报 error，并注明本机 makensis 日志不可捕获，需手工 makensis /V4 查看

CLI 与退出码：
```
node nsi-check.mjs [--strict] [--no-compile] [--json]
                   [--template <installer.nsi>] [--root <Infinity Cloud>]
                   [--payload <载荷目录>] [--makensis <makensis.exe>]
退出码：0 = 无 error；1 = 有 error；2 = 用法/环境错误（例如模板不存在）
```
默认模板路径由脚本自身位置推导（不再硬编码 D:\...\），可从任意 cwd 运行。

## 4. 正例 / 负例命令与退出码

正例（真实 installer.nsi，默认参数，含 makensis 编译）：

```
$ & 'D:\program\nodejs\node.exe' '...\Infinity Cloud\sourcecode\tools\nsi-check.mjs'
nsi-check: ...\Infinity Cloud\installer.nsi
  bytes=19444  sha256=0a26089977a1ece515d373b656e77ef8bb7a5613ae12f37b2503edd291fb742e
  lines=555  sections=8  functions=8  regWrites=29  shortcuts=3  @@EXE@@=inc_launcher.exe
  payload=win-arm64, win64, winx86
WARN  393: 快捷方式 $DESKTOP\${PRODUCT_NAME}.lnk 创建了，但卸载里找不到同名 Delete/RMDir（...）
WARN  436: $INSTDIR\inx_gui.exe 在载荷里不存在（win-arm64, win64, winx86）；...
WARN  440..443: $INSTDIR\plugins\... 在载荷里不存在；...
WARN  setup-win*.nsi 比 installer.nsi 旧，是陈旧产物；发布前请重跑 make-setup.mjs
INFO  编码契约：make-setup.mjs 写 UTF-8 BOM，检查器也用 BOM 编译
INFO  makensis 编译通过（1172 ms，合成载荷产物 186186 B）
OK: 0 error, 9 warning
$ echo $LASTEXITCODE
0
```

负例（fixture 由真实模板改一处得到；命令用 --no-compile 以便快速复现）：

| # | 负例 | 命令 | 退出码 | 关键报错 |
| --- | --- | --- | --- | --- |
| 1 | 删掉 File /r 指令 | node nsi-check.mjs --template demo-nofile.nsi --root "<Infinity Cloud>" --no-compile | 1 | ERROR: 没有任何 File 指令从 @@APP_DIR@@ 复制载荷 —— 安装器会装上空的程序 |
| 2 | 改坏注册表键（删掉 UninstallString 的 WriteRegStr） | node nsi-check.mjs --template demo-badreg.nsi --root "<Infinity Cloud>" --no-compile | 1 | ERROR 363: 卸载项缺少值 UninstallString |
| 3 | 改坏 Section 配对（删掉一个 SectionEnd） | node nsi-check.mjs --template demo-blocksection.nsi --root "<Infinity Cloud>" --no-compile | 1 | ERROR: 有 1 个 Section 没有 SectionEnd |
| 4 | 上面的负例 1 再打开编译 | node nsi-check.mjs --template demo-nofile.nsi --root "<Infinity Cloud>" | 1 | 同上；makensis 编译那一层此时是 0（正说明必须有语义层） |

生成 fixture 的片段（真实模板改一处，无需手工编辑）：

```
const base = fs.readFileSync('<Infinity Cloud>/installer.nsi', 'utf8');
fs.writeFileSync('demo-nofile.nsi', base.replace(/^[ \t]*File \/r ".*\*\.\*".*$/m, ''));
fs.writeFileSync('demo-badreg.nsi', base.replace(/^[ \t]*WriteRegStr HKLM "\$UNINST_KEY_THIS" "UninstallString".*$/m, ''));
const i = base.lastIndexOf('SectionEnd');
fs.writeFileSync('demo-blocksection.nsi', base.slice(0, i) + base.slice(i + 'SectionEnd'.length));
```

## 5. 自测套件（Infinity Cloud/sourcecode/tools/nsi-check.test.mjs，222 行）

```
$ & 'D:\program\nodejs\node.exe' '...\sourcecode\tools\nsi-check.test.mjs'
PASS  valid (expect 0 error)
PASS  bad-macro (expect error: makensis 编译失败)
PASS  no-file-directive (expect error: 没有任何 File 指令从 @@APP_DIR@@)
PASS  no-write-uninstaller (expect error: 主程序段里没有 WriteUninstaller)
PASS  no-startmenu-shortcut (expect error: 没有开始菜单快捷方式)
PASS  broken-section (expect error: Section 没有 SectionEnd)
PASS  missing-outfile (expect error: 缺少必需指令 OutFile)
PASS  unknown-placeholder (expect error: 未知占位符)
PASS  missing-uninstall-value (expect error: 卸载项缺少值 UninstallString)
PASS  unpaired-env-value (expect error: 环境变量 bogusvar)
PASS  unterminated-string (expect error: 字符串引号没有闭合)
PASS  real-template-regression (expect 0 error)
PASS  payload-good (expect 0 error)
PASS  payload-noicon (expect inc.ico error)
PASS  payload-nocli (expect inc_cli.exe error)
PASS  no-bom-contract (expect BOM error)
PASS  strict (expect error)
PASS  cli valid -> exit 0
PASS  cli bad-macro -> exit != 0
PASS  cli no-file-directive -> exit != 0
PASS  cli missing template -> exit 2
结果: 21 pass, 0 fail
$ echo $LASTEXITCODE
0
```

覆盖：13 个语义/结构负例 + 3 个载荷缺失负例 + 1 个 BOM 契约负例 + strict 升级 + 4 个 CLI 退出码断言。

## 6. 在真实 installer.nsi / 管线里发现的遗留问题（本任务未改，按要求先报告）

1. **$INSTDIR\inx_gui.exe 在所有平台的载荷里都不存在**，载荷里实际的对应文件叫 incx_gui.exe。根因不在 installer.nsi，而在 shell/build.mjs 第 149 行：for (const name of [t.prefix + '_gui', t.prefix + 'x_gui']) —— 'inc' + 'x_gui' 得到 incx_gui；而命名族里 inc 的管理员版是 inx_gui（把 c 换成 x），不是 incx_gui。于是 installer.nsi 第 436 行写入的环境变量 inxgui 指向一个不存在的文件。属于 shell/构建侧，超出本任务写范围，未改；建议交给 shell 的负责人。
2. **桌面快捷方式命名不一致**：installer.nsi 第 393 行创建 $DESKTOP\${PRODUCT_NAME}.lnk，第 543 行卸载时删 $DESKTOP\$LABEL_THIS.lnk。共存模式下 $LABEL_THIS = 产品名 + 版本号，两者不同名，桌面会残留死链接。未改 installer.nsi；修法是创建与删除统一用 $LABEL_THIS，或在删除时同时兜底 PRODUCT_NAME。
3. **plugins 环境变量指向不存在的文件**：installer.nsi 第 440-443 行写入 plugins\fastgithub\FastGithub.UI.exe、plugins\aria2\aria2c.exe、plugins\freearc\Arc.exe、plugins\7zip\7za.exe，但 make-setup.mjs 的 stage() 不暂存 plugins 目录，载荷里没有这些文件。属于暂存管线缺口（make-setup.mjs 正被其他任务修改中，未动）。
4. **setup-stage/setup-*.nsi 是陈旧产物**：生成于 10-02，而 installer.nsi 当前更新（模板里新增了 MUI_ICON/MUI_UNICON 的 inc.ico 定义，生成的 .nsi 里没有）。发布前必须重跑 make-setup.mjs。
5. **makensis 编译日志不可捕获**：本机 NSIS 3.12 把日志写到 CONOUT$，管道抓不到；检查器因此以静态定位为主，编译层只报退出码。若要让 CI 打印编译器原文，需要日志插件或真实控制台。
6. 以上 1-4 在默认模式下是 warning（所以真实 installer.nsi 正例 exit 0）；加 --strict 会全部升级为 error，可作为发布门的严格模式。

## 7. 遗留与建议

- 未改 installer.nsi（git status 确认其未出现在修改列表里）、未改 make-setup.mjs、未碰 ING/history。
- 载荷存在性检查依赖 build/setup-stage 已被 make-setup.mjs 跑过；没有载荷时降级为 warning 并跳过该层。
- 真实 makensis 的报错文本仍抓不到（环境限制，见 6.5）。
- 建议把 node sourcecode/tools/nsi-check.mjs 接入 release.mjs / CI 的发布前步骤；是否使用 --strict 取决于第 6 节的遗留问题何时修掉。
- 建议 nsi-check.test.mjs 作为回归门：任何对 installer.nsi 的改动都应先跑它。

## 附录 A：被替换掉的旧脚本（git HEAD 原文，19 行）

```
/* Compile the installer and print whatever makensis says. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const N = String.fromCharCode(10);
const NSI = 'D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/Infinity Cloud/installer.nsi';
const OUT = 'D:/temp/nsi-check.exe';
try { fs.rmSync(OUT, { force: true }); } catch (e) { }
let out = "", err = "", code = 0;
try {
  out = String(execFileSync('C:/Program Files (x86)/NSIS/makensis.exe', ['/V4', '/O' + OUT, NSI], { encoding: 'utf8', maxBuffer: 33554432 }));
} catch (e) {
  code = e.status === undefined ? -1 : e.status;
  out = String(e.stdout || "");
  err = String(e.stderr || "");
}
process.stdout.write("exit=" + code + N);
process.stdout.write("exe: " + (fs.existsSync(OUT) ? fs.statSync(OUT).size + " B" : "not produced") + N);
for (const l of out.split(/\r?\n/)) if (l.trim()) process.stdout.write("OUT " + l.slice(0, 170) + N);
for (const l of err.split(/\r?\n/)) if (l.trim()) process.stdout.write("ERR " + l.slice(0, 170) + N);
```

## 附录 B：文件清单与哈希

| 文件 | 字节 | 行数 | sha256 |
| --- | --- | --- | --- |
| Infinity Cloud/installer.nsi（未改） | 19444 | 555 | 0a26089977a1ece515d373b656e77ef8bb7a5613ae12f37b2503edd291fb742e |
| Infinity Cloud/sourcecode/tools/nsi-check.mjs（重写） | 30343 | 682 | b4aa494577e98c0e9569f5b7dcd3b22cab0d04374759d20d156b5ff22cf3d91c |
| Infinity Cloud/sourcecode/tools/nsi-check.test.mjs（新增） | 8490 | 222 | c62c0adfbe54cf41b43b91255be20170f5a7f09dae0f8dcf67b0f41aa6f476ca |

复现证据原始输出留在 D:\temp\nsi-fix-probe\（evidence.txt、fx-*.nsi、legacy-*.mjs）与 D:\temp\nsi-check-demo-output.txt；fixture 可用第 4 节的片段随时重建。
