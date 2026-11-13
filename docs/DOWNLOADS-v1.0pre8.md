# 下载面说明 · v1.0pre8（Infinity Studio / Infinity Server）

本文记录 2026-11-13 落地的下载链路：页面拆到多个域名、人机验证单独成页、下载统一经
Cloudflare 302 跳转、Studio 在应用内在线安装。

## 一、三个域名各管一件事

| 域名 | 角色 | 内容 |
|---|---|---|
| https://infinity-studio-craft.github.io/ | 落地页（GitHub Pages） | 只有 Infinity Studio 与 Infinity Server 两张卡；不列子应用、不给源码/仓库链接 |
| https://infinity-verify.pages.dev/ | 人机验证页（Cloudflare Pages） | 读 `/api/catalog` 显示真实版本与大小；Turnstile 为主路径，受限网络走本地验证 |
| https://infinity-downloads.pages.dev/ | 下载门（Cloudflare Pages Functions） | `/api/catalog` 产品清单、`/dl/<asset>` 验票后 302 到安装包 |

`infinity-downloads.pages.dev` 根页是「下载入口」，两张卡都指向验证页，不再自带遮罩。
另有一个只用于验收的副本项目 `infinity-downloads-qa.pages.dev`。

## 二、下载链路

```
落地页点「下载」
  -> https://infinity-verify.pages.dev/?asset=<asset>
     通过 Turnstile（或本地验证）拿到票据
  -> https://infinity-downloads.pages.dev/dl/<asset>?token=<turnstile>|lt=<local>
     票据校验通过
  -> 302  https://github.com/zssx-2026/<repo>/releases/download/v1.0.0-pre8/<file>
```

- 下载地址从不写死在页面里：页面上只有 `/dl/<asset>`，真实资产地址由函数侧决定，换版本不用改页面。
- 票据一次性、短时效：Turnstile 票据 300 s，本地票据 120 s；换 asset 用同一张票会被拒（`local_ticket_invalid`）。
- 没有票：`Accept: text/html` 得到验证页（200），JSON 客户端得到 `403 {"error":"turnstile_required"}`；票无效 `403 turnstile_failed`；未知资产 `404 unknown_asset`。

## 三、Turnstile 在受限网络下的真实情况

实测（本机，2026-11-12）：

- `challenges.cloudflare.com/turnstile/v0/api.js` → 302，可达；
- `hagen.challenges.cloudflare.com`（真正跑挑战的 iframe 主机）→ **直连 15 s 超时、换 104.18.8.208 / 104.18.9.208 也是超时**；
- 浏览器里该 iframe 是 `net::ERR_ABORTED`，控制台报 postMessage origin 不匹配。

结论：只挂 Turnstile 会让这类网络下**所有下载都不可用**。所以下载门同时提供「本地验证」：

- `GET /api/verify` 返回 `{challenge, image, expiresIn:180}`，`image` 是服务端现画的 5 字符 PNG（点阵字库 + 抖动 + 噪点 + 斜线）；
- `challenge` 只带验证码的 HMAC，**不含明文**；
- `POST /api/verify {challenge,answer,asset}` 校验通过后发 `{ticket}`（HMAC 签名，绑定 asset，120 s）；
- 验证页在 Turnstile 6 s 内没给出结果、或 onerror 时，自动切到本地验证面板（也可以 `?local=1` 直接进）。

端到端验收脚本 `work/qa-local-gate.mjs`：自己解码 PNG 反解验证码 → 换票据 → 请求下载门 → 断言 302 落在 GitHub 资产上，并断言跨资产、伪造票据都是 403，最后打印 `LOCAL-GATE PASS`。

**定位**：本地验证是 Turnstile 不可达时的回退，不是替代。它挡脚本化批量下载，但挡不住针对性 OCR（点阵字库是确定的）；要更强需要加服务端图像扭曲。

## 四、Studio 应用内在线安装

Studio 的「在线安装」页不经过浏览器验证：桌面程序直接读目录、直接下资产。

- 目录：`GET /api/catalog`（Studio 侧 `InfinityStudio/src/remote.js` 的 `fetchCatalog`），**两个主机按序尝试**——`https://infinity-downloads.pages.dev` 优先，`https://infinity-account-auth-worker.zssx2026.workers.dev` 兜底（`*.workers.dev` 在部分网络被 SNI 阻断，单主机等于单点故障）；
- 下载：按目录里的 `url` 直连 GitHub 资产，落 `%LOCALAPPDATA%\Infinity\Studio\downloads\`，**先算 sha256 与目录比对**，不一致就删掉重下；
- 文件名取资产名（`InfinityStudio_1.0.0-pre8_win64_setup.exe`），必须是 `.exe`——`spawn()` 对没有扩展名的 PE 会报 `ENOENT`（曾真实踩到）；
- 安装：`/S` + `windowsHide`，串行一次一个，退出码 0 才算成功；页面 700 ms 轮询 `/v1/remote/state` 显示阶段、进度与日志。

验收（2026-11-13）：装好的 Studio 起自己的服务后 `GET /v1/remote` 返回 `base=https://infinity-downloads.pages.dev`、两条产品（Studio 83,742,472 B / Server 83,745,744 B），点「安装」后 **Server 真装上**（91 文件 / 281,229,558 B，setup exit 0）。

## 五、已知问题

- GitHub 资产下载在本机被限速（实测 10 s 内 0 字节、Node 侧约 16 KiB/s），80 MB 的安装包可能很久；页面与 Studio 都显示进度，但没有镜像。
- 本地验证码可被点阵模板匹配破解（验收脚本自己就是这么过的）。
- 落地页/验证页/下载门三个域名都在 Cloudflare 与 GitHub 免费层上，没有自定义域名。

## 六、相关文件

- `work/_org-pages/index.html`（落地页，publish.mjs 推 GitHub Pages）
- `work/verify-gate/index.html`（验证页，部署到 infinity-verify）
- `work/pages-gate/index.html` + `work/pages-gate/functions/{api/catalog.js,api/verify.js,dl/[asset].js,_lib/{ticket.js,captcha.js}}`（下载门）
- `InfinityStudio/src/remote.js`、`InfinityStudio/src/page.js`、`InfinityStudio/src/server.js`（Studio 侧目录/下载/安装）
- `tools/publish-electron.mjs`（GitHub Release 上传，node:https 流式 + 显式 content-length）
- `work/qa-local-gate.mjs`、`work/qa-studio-remote.{mjs,ps1}`、`work/qa-studio-probe.ps1`、`work/qa-studio-uninstall.ps1`（验收）
