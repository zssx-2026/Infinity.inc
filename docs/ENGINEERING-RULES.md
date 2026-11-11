# 工程与实现选择 / Engineering and implementation choices

本文件记录本套件的语言选择、界面原则与交付纪律。它不是建议，而是评审时用来否决改动的依据。

## 1. 语言选择

按「性能需求」而不是「个人偏好」选语言，优先级从高到低：

| 场景 | 语言 | 理由 |
| --- | --- | --- |
| 默认实现（应用本体、核心库、宿主外壳） | **C++** 或 **Rust** | 零运行时依赖、可控内存、能静态链接成单文件 |
| 极限热点（已用探针证明是瓶颈的内层循环、SIMD 密集路径） | **汇编**（x86-64 / ARM64 内联或独立 .S/.asm） | 只有在 C++/Rust 版本已被测量证明不够快时才允许；必须同时保留等价的可移植实现与对照基准 |
| 简单且不需要速度的部分（一次性转换、数据整理、辅助校验） | **Python** | 写得快、读得懂，运行时长不影响用户 |
| 构建、打包、发布、同步脚本 | **Node.js（ESM）** | 属于基础设施，不是产品载荷；沿用既有脚本链，不为了「统一语言」重写 |

判定规则：

- 热点先用探针量出来（基准脚本 + 前后对比数据），没有测量数据不许上汇编。
- 任何新模块都不得引入需要用户安装的运行时；产品载荷只能是 C++/Rust 可执行文件 + 随包资源。
- 语言边界写在构建里：C++ 侧由 `cpp/tools/build.mjs` 审计导入表（出现 Windows 之外的 DLL 即构建失败）。

## 2. 界面原则：「页面不是回答」

产品窗口里只放产品本身。

- 不做：把提示词、功能清单、版本亮点、发行说明、架构自述、「AI 生成」声明塞进产品页。
- 首次运行页、错误页、空状态页一律最小化：一个目的、最少字段、一句中文说明。
  例：未登录时只有一个令牌输入框 + 一个「继续」按钮 + 一行「令牌只用于访问你自己的仓库，只保存在本机」。
- 说明性长文属于 `docs/` 与 Release 正文，不属于窗口。
- 页面不得替用户做决定，也不得要求用户先去配环境变量才能启动程序：
  第一次启动由程序自己弹输入界面，凭据加密存本机（DPAPI，`%LOCALAPPDATA%\Infinity\<app>\token.bin`），
  环境变量只是回退路径。

## 3. 自包含交付

- 安装后即可运行：不需要 Node、不需要系统浏览器内核、不需要 VC++ 运行库。
- GUI 面孔由随包 Electron 外壳承载（`shell/`，`<prefix>_shell/<prefix>_window.exe`），
  外壳按自身文件名判定产品，起同目录的 `<prefix>_cli.exe --serve-ui --port=<port>` 并只允许 127.0.0.1 导航。
- 卸载要能删干净：静默安装/卸载都必须 exit 0 且目录消失。

## 4. 验收：真跑，不看报告

一个改动算完成，必须同时满足：

1. `node --check`（脚本）或编译零错误（C++），且导入表审计通过；
2. 真跑冒烟脚本，输出 `...-PASS n/n` 且 exit 0；
3. 涉及界面的改动：静默安装 → 起窗口 → 探针读 `devicePixelRatio`（150% 缩放下必须为 1.5）→ 抓帧 OCR 复核页面文字；
4. 涉及发布的改动：公开下载地址回验字节数与 SHA-256；
5. 失败项写进报告，不用「应该可以」替代证据。

## 5. 发布纪律

- 重建即改字节：任何源码改动都会改变安装包的 SHA-256，因此**已发布版本的字节不可污染**。
  宿主/界面改动一律进入下一个 `v1.0preN` 周期（重编 → 重打包 → 重签名 → 静默安装探针 → 发布 → 刷新目录页与官网卡片 → 更新发行说明）。
- 发布前先 `--dry-run`；发布后逐字符比对远端 digest 与本地 `sha256`。
- 目录页（IPM `name.txt`）保留跨版本清单：当前版本三条 + 仍在售的旧版本条目。

## English summary

- **Language**: C++ or Rust by default; assembly only for measured hot spots (keep a portable fallback and a
  benchmark); Python for simple, non-latency-critical helpers; Node.js ESM for build/release scripts
  (infrastructure, not product payload). The build enforces zero non-Windows imports.
- **UI**: the window shows the product only — never prompts, feature lists, release notes or architecture
  prose. First-run, error and empty states stay minimal (one purpose, fewest fields, one short sentence).
  The app asks for its own token on first launch and stores it encrypted (DPAPI); environment variables are
  only a fallback.
- **Self-contained**: nothing to install but the app; the GUI face runs inside the bundled Electron shell.
- **Acceptance**: real runs only — import-table audit, smoke scripts ending in `...-PASS n/n` with exit 0,
  silent install + window probe (`devicePixelRatio` 1.5 under 150% scaling) + OCR of a captured frame,
  and byte/SHA-256 verification through the public download URL.
- **Release discipline**: rebuilding changes bytes, so a published version is never edited in place; any host
  or UI change goes into the next `v1.0preN` cycle.
