# Streaming preview

*A preview that draws the first screen of a huge file in milliseconds, and keeps reading as you scroll.*

Status: **implemented in the source trees of both product lines — INC (C++) and IFM (JS/SEA) — and
covered by tests** (audited 2026-10-11). The numbers quoted here are the ones the audit tool
produces, not estimates: run `node work/preview-integration-audit.mjs` to check them again.

## What it fixes

The files inside an installer or a resource repository are routinely large — install media, logs,
archives, binaries. A classic preview reads the whole file into memory before it renders anything,
which is slow and expensive; a streaming preview reads only "the first few bytes the first screen
needs", draws that, and keeps reading incrementally while the reader scrolls. The content is
visible within milliseconds, and memory stays flat no matter how large the file is.

## The interface

Both product lines expose the same HTTP endpoint:

    GET /api/preview?path=<relative path>&bytes=<upper bound>&offset=<offset>

- **Returns** a content slice (text / hex / image by type) plus the total length and whether the
  response was truncated;
- **Upper bound** is a hard per-request byte cap, so one enormous file cannot slow the service
  for everyone;
- **Cancellation-safe** — a client aborting the connection does not disturb later requests made
  by the service.

## Where it lives

| Product | Authoritative source | Notes |
|---|---|---|
| Infinity Cloud (INC) | `cpp/apps/inc/preview.hpp` (29,658 B, `b5004e1e93dc…`) | C++ backend; `main.cpp` registers the routes (5 places), `ui.hpp` calls them (6 places) |
| Infinity File Manager (IFM) | `Infinity File Manager/sourcecode/src/core/preview.js` (12,588 B, `4ffc402dd471…`) | JS core module; wired in by `src/gui/server.js` |

`preview.hpp` also exists as a build copy under `Infinity Cloud/preview/` and its `generated/`
subdirectory; the audit tool compares all three so the copies cannot drift from the authoritative
one.

## How to verify it

    # INC: 13 content / interface / boundary checks, including an 8-second stress pass
    powershell -NoProfile -File "Infinity Cloud\preview\tests\run-tests.ps1" -With8s

    # IFM: real HTTP behaviour — median first-screen latency for 256 KiB, zip directory
    # listing, 5,400-entry list, 60 aborts with the service surviving
    node "Infinity File Manager\bench\preview-http-check.mjs"

    # The fact audit for both lines, plus the single-source guard on the header
    node work/preview-integration-audit.mjs

## Known boundaries

- The site and the release notes did not describe this feature on their own; this document is the
  description, and the site hub links it. Everything else about it is in the code.
- The Electron/JS-SEA `Infinity Cloud/sourcecode` tree contains no preview implementation, and
  that is by design: the INC window UI is served by the C++ backend, so the preview belongs to the
  C++ line.

---

## 流式预览（中文摘要）

- **状态**：已在 INC（C++）与 IFM（JS/SEA）两条产品线的源码树内实现并通过测试（2026-10-11 审计）。
  本文所有数字均由 `node work/preview-integration-audit.mjs` 产出，可随时复核。
- **它解决什么**：安装介质、日志、归档、二进制这类大文件用传统预览需要整份读进内存后才开始渲染，
  既慢又占内存。流式预览只读入「首屏所需的前若干字节」就开始绘制，毫秒级可见，滚动时继续增量读取，
  内存占用与文件大小无关。
- **接口**（两条产品线同一个端点）：返回内容分片（按类型为文本/十六进制/图片）+ 总长度 + 是否被截断；
  单次请求有硬性字节上限保护；客户端主动断开（abort）不影响服务端后续请求。

      GET /api/preview?path=<相对路径>&bytes=<上限>&offset=<偏移>
- **实现位置**：INC 权威源码为 `cpp/apps/inc/preview.hpp`（29,658 B，`b5004e1e93dc…`），
  由 `main.cpp` 注册路由（5 处）、`ui.hpp` 调用（6 处）；IFM 权威源码为
  `Infinity File Manager/sourcecode/src/core/preview.js`（12,588 B，`4ffc402dd471…`），
  由 `src/gui/server.js` 接线。`preview.hpp` 在 `Infinity Cloud/preview/` 及其 `generated/`
  下另有构建副本，审计工具比对各处以防同源漂移。
- **验证入口**：INC 用 `Infinity Cloud\preview\tests\run-tests.ps1 -With8s`（13 项检查含 8 秒压测）；
  IFM 用 `Infinity File Manager\bench\preview-http-check.mjs`（真实 HTTP 行为：首屏 256 KiB 延迟中位数、
  zip 目录、5,400 条列表、60 次 abort 服务存活）；两侧事实与同源守卫用 `work/preview-integration-audit.mjs`。
- **已知边界**：站点与发布说明此前未单独介绍该特性，本文即其说明（站点 docs 中心已收录本页）。
  Electron/JS-SEA 的 `Infinity Cloud/sourcecode` 线不含预览实现——INC 窗口 UI 由 C++ 后端提供，预览自然归 C++ 线。
