# IPM 安装包重编：/SOLID lzma 收益实测（2026-10-17）

## 一、结论

给 `InfinityPackageManager\nsis.nsi` 补上 `SetCompressor /SOLID lzma` 之后重编三个平台，
安装包总体积 **431,550,424 B → 305,019,862 B，省 120.7 MiB（-29.3%）**，
且 win64 重跑两次字节与 sha256 完全一致（可复现）。

| 安装包 | 重编前 | 重编后 | 节省 | 降幅 | sha256(前16) |
| --- | ---: | ---: | ---: | ---: | --- |
| win64.exe | 148,603,675 | **106,752,699** | 41.9 MiB | 28.2% | 09f615400ce8237e |
| winx86.exe | 137,945,458 | **100,276,639** | 37.7 MiB | 27.3% | 181716251245e00e |
| win-arm64.exe | 145,001,291 | **97,990,524** | 44.8 MiB | 32.4% | b15196f699ef7dbb |
| 合计 | 431,550,424 | **305,019,862** | 120.7 MiB | 29.3% | |

对照另外两个产品的 win64：`Infinity Cloud\sourcecode\build\setup\win64.exe` 40,881,185、
`Infinity File Manager\sourcecode\build\setup\win64.exe` 21,178,225。IPM 仍比它们大，
因为载荷里**装了两份 Electron 壳**（ipm_gui.exe / ipmx_gui.exe 各 188,784,128 B）而 INC 只有一份
（窗口面 Electron 保留，命令行面换成 49,152 B 启动器）——这是产品结构决定的，不是压缩器问题。

## 二、根因回顾

INC 与 IFM 的 `installer.nsi` 都有 `SetCompressor /SOLID lzma`，IPM 的 `nsis.nsi` 从来没有，
于是 NSIS 退回默认 zlib 且不做 solid 折叠；载荷里两份几乎相同的 188 MB Electron 壳无法被去重。
补丁写在第 37 行（占位符化时一并补上）。详见 `work\ipm-setup-align-report.md`。

## 三、为可复现重编加的构建开关

`InfinityPackageManager\tools\make-setup.mjs`（7,537 → **7,960 B**）新增 `--only=<id>`：

```js
const onlyArg = process.argv.find(function (a) { return a.indexOf('--only=') === 0; });
const only = onlyArg ? onlyArg.slice('--only='.length) : '';
...
for (const p of SETUPS) {
  if (only && p.id !== only) { log('skip      ' + p.id + ' (--only=' + only + ')'); continue; }
  const payload = stage(p);
```

不传该开关时行为与改动前完全一致（仍编全部三个平台）。

## 四、并行冲突（真坑，已按串行执行）

`main()` 一进来就 `fs.rmSync(STAGE, { recursive: true, force: true })`，
同时跑两个 `--only=` 实例时后者会在前者写载荷的过程中把整棵 `setup-stage` 删掉：

```
Error: ENOTEMPTY, Directory not empty: ...\InfinityPackageManager\build\setup-stage
    at main (.../tools/make-setup.mjs:172:6)
{ errno: 41, code: 'ENOTEMPTY', syscall: 'rm' }
```

结论：**make-setup 必须串行跑**，一次一个平台。本次 arm64 的第一次启动正是撞在这个错误上（exit 1），
随后串行重跑成功。

## 五、可复现性验证

win64 编了两次（第一次 10:18、第二次 10:34，中间另编了 winx86 与 win-arm64），两次结果：

```
106752699 B  sha256 前16 = 09f615400ce8237e   （两次相同）
```

字节数与 sha 完全一致，说明压缩器设置与载荷是确定性的。

## 六、副作用与收尾

- `setup-stage` 在每次 `main()` 开头被整体重建，只保留最后一次 `--only=` 的载荷目录
  （本次结束时是 win64）。依赖该目录的检查（`work\ipm-nsi-check.mjs`）**必须在重编之后跑**，
  否则会以 `missing payload ...\setup-stage\win64 (run make-setup.mjs first)` 退出 2。本次已重跑，
  `IPM-NSI-CHECK PASS`，`OK: 0 error, 0 warning`。
- `work\release-set-parity.mjs` 仍 PASS：`RELEASE-SET-PARITY-PASS 6/6 assets byte-identical; 
  sums reproducible; 6 icons covered`。发布目录 `cpp/release/v1.0pre5` 与 `installers/packaging/v1.0pre5`
  未被本次重编影响（二者存的是签名后的正式 setup，不是 `build/setup` 下的新产物）。