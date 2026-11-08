# 流式预览（streaming preview）双线状态核对

时间：2026-10-11（Asia/Shanghai）｜作者：Lead
起因：复核"INC 预览是否并入正式源码树"时发现 Infinity Cloud/sourcecode（Electron/JS-SEA 线）里没有 preview，
      进一步核对后确认两条产品线的预览实现在**各自的树**里，均已完成。

## 1. 结论

| 产品线 | 预览实现位置 | 是否已并入正式源码树 | 验证 |
|---|---|---|---|
| INC（Infinity Cloud，C++ 线） | `cpp/apps/inc/{main.cpp,ui.hpp,preview.hpp}` | 是 | `Infinity Cloud/preview/tests/run-tests.ps1 -With8s` → RESULT failures=0（13 项断言全 0） |
| IFM（Infinity File Manager，JS/SEA 线） | `Infinity File Manager/sourcecode/src/core/preview.js` + `src/gui/server.js` + `src/core/localfs.js` | 是 | 重建 bundle/SEA 内含 /`api/preview`；`bench/preview-http-check.mjs` exit 0（failed checks: none） |

**澄清**：`Infinity Cloud/sourcecode/build/bundle.cjs`（122,568 B，sha256 5b187e0b5a01b717…，preview 出现 0 次）
属于 Electron/JS-SEA 那条独立产品线产物，**不能**用来判断 INC 预览缺失；INC 预览的权威实现是 C++ 树。

## 2. INC（C++ 线）证据

| 文件 | 字节 | sha256(前16) | /`api/preview` 次数 |
|---|---:|---|---:|
| `cpp/apps/inc/main.cpp` | 50,781 | `943df724dc74392e` | 5 |
| `cpp/apps/inc/ui.hpp` | 38,082 | `47b696d8077e56e9` | 6 |
| `cpp/apps/inc/preview.hpp` | 29,658 | `b5004e1e93dc4965` | 0（84 处 preview 符号） |
| `Infinity Cloud/preview/build/inc-preview.exe` | 3,414,598 | `47cb9751c0f910ad…` | —（测试固件清单记录） |

测试实测（2026-10-11 11:38）：

    RESULT failures=0 verify-stored.txt=0 appCompile=0 verify-z64-big.bin=0 ui=0 harness=0
    verify-z64-hello.txt=0 verify-data.bin=0 harnessCompile=0 wire=0 verify-hello.txt=0
    verify-desc-stored.bin=0 apply=0 fixtures=0

即编译（app/harness）、wire、UI、apply、zip64/descriptor 回读等全部通过。

## 3. IFM（JS/SEA 线）证据

- `Infinity File Manager/sourcecode/src/core/preview.js` 12,588 B，sha256 4ffc402dd47104b0…；
- 重建后 `build/bundle.cjs` 144,956 B 含 /`api/preview`×6、preview 符号×15；stage `ifm_gui.exe` 80,788,480 B 同样计数；
- `bench/bundle-check.mjs` exit 0（generatorCallable: true）；
- `bench/preview-http-check.mjs` exit 0：256 KiB 首块中位 24.172 ms；zip 22 项/66,833 B 3.901 ms；目录 5,400 项中位 41.979 ms；
  abort×60 后服务仍应答（句柄 6→4），failed checks: none。

## 4. 后续（可选，非阻塞）

- 若将来 INC 的 Electron 线也需要流式预览，应按 IFM 的做法移植 `preview.js`+路由（另立任务，当前无需求）；
- IFM x86/arm64 的 C++ gui 对等实现仍为可选项。
