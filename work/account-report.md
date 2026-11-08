# task-30 报告：不依赖后端的账户、邮箱验证与 2FA

日期：2026-10-05　作者：proj-web　状态：静态交付完成（截图项 N/A，见 §8）

一句话结论：账户资料用口令派生密钥（PBKDF2-SHA256 250,000 次 + AES-GCM 256）加密后只存在本浏览器；邮箱验证给出**真实验证**（GitHub）与**本地自证**（mailto + Ed25519 签名）两条路且信任等级显式区分；2FA 是离线 RFC 6238 TOTP，恢复码只存 SHA-256，5 次失败锁 5 分钟；整条断网流程不产生任何网络请求，唯一的第三方永远是 api.github.com（或用户自己的 github.com 设备码入口，但它在浏览器里会被 CORS 拦下，已实测）。

## 1. 交付物（字节数 + sha256 前 16 位）

| 文件 | 字节 | sha256(16) |
| --- | ---: | --- |
| `web/infinity/assets/account.js` | 70346 | `91a155b82c02dbd5` |
| `web/infinity/assets/account.css` | 1019 | `3f4874fd2cb1544d` |
| `web/infinity/signup/index.html` | 896 | `8a1749fd9a8932e2` |
| `web/infinity/login/index.html` | 845 | `4c7e46e38c87888f` |
| `web/infinity/cn/signup/index.html` | 894 | `479ccc6d4016da99` |
| `web/infinity/cn/login/index.html` | 848 | `dbeb668f84bc30c5` |
| `work/account-tests.mjs`（node 单测，不 spawn 任何进程） | 15554 | `369fdd030c9a4c35` |
| `work/account-static-check.mjs`（页面/模块静态自检） | 4743 | `199ead4e98c89b1e` |

四个页面都按站点约定引 `site.css`、`account.css`、`guard.js`、**绝对路径**的 `/infinity/assets/verify.css` 与 `/infinity/assets/verify.js`，页尾加载 `site.js` + `account.js`，`<body data-account-page="signup|login">` 决定渲染哪个流程。

## 2. 数据模型与加密参数

存储键：`localStorage['inc.account.v1']`（纯本地；没有 IndexedDB 也不影响功能）。

```json
{
  "v": 1,
  "kdf":    { "name": "PBKDF2", "hash": "SHA-256", "iterations": 250000, "salt": "<base64 16B 随机>" },
  "cipher": { "name": "AES-GCM", "length": 256, "iv": "<base64 12B 随机>", "ct": "<base64 密文+tag>" },
  "updatedAt": "<ISO>"
}
```

密文里的明文结构（解密后）：

```json
{
  "v": 1,
  "profile": { "email": "…", "displayName": "…", "createdAt": "…", "updatedAt": "…" },
  "prefs":   { "lang": "zh", "theme": "system" },
  "tokens":  [], "apps": {},
  "email":   { "address": "…", "level": "unverified|self-attested|github-verified",
               "method": "mailto|github-pat", "verifiedAt": "…", "evidence": {…},
               "selfAttest": { "payload": { "email": "…", "code": "123456", "ts": 0 },
                               "alg": "Ed25519", "spki": "…", "sig": "…" } },
  "keys":    { "alg": "Ed25519", "priv": "<pkcs8 b64>", "pub": "<spki b64>" },
  "totp":    { "enabled": true, "secretB32": "…", "digits": 6, "period": 30,
               "algorithm": "SHA1", "issuer": "Infinity.Inc", "uri": "otpauth://…" },
  "recovery":{ "hashes": ["<sha256 hex> ×10"], "used": [null|ISO ×10] },
  "lock":    { "failures": 0, "lockedUntil": 0 },
  "audit":   [ { "ts": "…", "event": "account.created" } ]
}
```

参数要点：口令 → PBKDF2-SHA256（250,000 次，随机 16 B salt）→ AES-GCM 256 密钥；每次保存换新 12 B IV；口令错误时 GCM 认证失败（不回退、不泄漏）；解锁后只在内存缓存 `CryptoKey`，不落盘。`salt`/`iv` 每次新建都会重新随机，测试里逐项断言了长度（16/12）与迭代次数 ≥ 200k。

## 3. A) 本地账户库、导出/导入、可选 GitHub 同步

- 创建：邮箱格式与口令长度（≥8）校验；已存在账户时拒绝静默覆盖。
- 解锁/登录：`unlock(passphrase)`；改了 2FA 后 `login(passphrase, code)` 需要第二因子，失败时**不保留已解锁会话**。
- 导出：`exportBlob()` → `infinity-account.encrypted.json`（就是上面的密文 JSON，可离线带走）。导入：`importBlob(text)` 校验结构（`v/kdf/cipher`）后写入并要求口令解锁。
- 产品文件：`exportProductFile()` → `account.json`（见 §5）。
- **可选同步（默认关闭）**：`syncPush(pat)` / `syncPull(pat)` 用**用户自己的** GitHub 令牌写/读一个私有 Gist；上去的只有密文（`files['infinity-account.encrypted.json'].content` = 上面的密文 JSON），Gist id 记在 `localStorage['inc.account.gist']`。不填令牌就完全本地、零请求。测试断言：请求只发往 `https://api.github.com/gists…`，请求体里没有明文邮箱。

## 4. B) 邮箱验证：真实验证 vs 本地自证（显式区分）

信任等级有序：`LEVELS = { unverified: 0, 'self-attested': 1, 'github-verified': 2 }`，页面用不同颜色的 pill 展示，产品文件里写进 `email.trust` 字段。

### B1 真实验证（第三方只有 GitHub）

- 实测路线：`b1Pat(token)` 调 `GET https://api.github.com/user/emails`，取 `primary && verified`（若读者填的地址在列表里也取该条），命中即 `github-verified`，`evidence.source = 'api.github.com/user/emails'`。api.github.com 的 CORS 允许浏览器直连（已在 Edge 里实测 200/401 都能读到响应体）。
- Device Flow：`b1DeviceStart(clientId)` 按规范 `POST https://github.com/login/device/code`（`scope=user:email`），`b1DevicePoll()` 对应 `POST https://github.com/login/oauth/access_token`。**但浏览器里做不成**：2026-10-04 在 Edge 154 上实测这两个 github.com 端点均抛 `TypeError: Failed to fetch`（无 CORS 头），即静态站无法完成设备码轮询。因此页面把 Device Flow 作为“如实告知失败原因”的按钮：失败时显示 `cors-or-network` 并指向令牌路线，绝不假装成功。要真正走设备码，需要在用户机器上跑一个小脚本（不经本站）或给站点配后端——后者与“不得依赖自有后端”冲突，故不采用。

### B2 无 GitHub 时的自助验证（明确标注 self-attested）

- `b2Start()` 生成 6 位码 + `mailto:` 草稿（主题/正文预填地址、码、签发时间），并对 `canonical({email,code,ts})` 做 **Ed25519 签名**（密钥在账户创建时就生成，私钥只存在加密库内）。
- `b2Confirm(code)` 常数时间比较 + 15 分钟有效期；通过后 `level = 'self-attested'`，`email.selfAttest` 里带 `payload / alg / spki / sig / note`，页面上写清“服务器无法核验，仅为本地自证；产品可离线用公钥验证”。
- 说明：账户本身在验证之前就已创建（保险库需要先存在），验证只**提升信任等级**；登录页、账户面板与产品文件都会显示当前等级。这里没有任何服务端会话或后端签发的凭证，页面文案也不会暗示有。

## 5. C) 产品侧离线读取

页面提供 `account.json` 下载，目标位置写在 UI 与文件里：**`%LOCALAPPDATA%\Infinity.Inc\account.json`**。内容含：`profile`、`email.{address,trust,method,verifiedAt,selfAttest}`、`totp.enabled`、`tokens`、`apps`、`publicKey.{alg,spki}`，以及对该快照（去掉 `signature`/`canonical` 后按 key 排序的确定性 JSON）的 `signature.{alg,spki,value}`。

离线校验（任何语言都能实现，Node 示例）：

```js
// 1) 去掉 signature/canonical，按 key 递归排序得到 canonical 文本
// 2) 用 signature.spki（Ed25519 SPKI base64）验证 signature.value
const ok = (await core.verifyProductFile(json)).ok;   // account.js 里就是这个逻辑
```

说明：这个签名证明“文件未被改动”，是设备自签（自签名不提供第三方身份担保）；身份可信度由 `email.trust`（github-verified ＞ self-attested ＞ unverified）承载。

## 6. 2FA（离线 TOTP）

- 参数：RFC 6238 / HMAC-SHA1 / 30 s / 6 位 / 校验窗口 ±1 步；比较用常数时间（逐字符 XOR 累积）。
- 二维码：`account.js` 里自带 QR 编码器（字节模式、ECC M、固定 mask 0），在 `<canvas>` 上本地绘制；**没有任何二维码服务或 CDN**。手动录入密钥（Base32）与完整 otpauth URI 也一并显示。
- 恢复码：10 个 `XXXX-XXXX-XXXX-XXXX`（去易混淆字符），库内**只存 SHA-256**（`recovery.hashes`），使用时常数时间比较并标记 `used`；已用过的码立即失效。
- 锁定：连续 5 次第二因子失败 → 锁 5 分钟（`lock.lockedUntil = now + 300000`），锁定期内即使 TOTP 正确也拒绝；成功一次即清零。
- 注册流程会展示 otpauth URI + 二维码 + 10 个恢复码（只显示这一次），并要求输入当前 6 位码确认后才 `totp.enabled = true`。

### RFC 6238 / RFC 4226 向量（模块自测，逐条断言）

| T (s) / counter | 期望 | 实测 | 结果 |
| --- | --- | --- | --- |
| 59 | 94287082 | 94287082 | PASS |
| 1111111109 | 07081804 | 07081804 | PASS |
| 1111111111 | 14050471 | 14050471 | PASS |
| 1234567890 | 89005924 | 89005924 | PASS |
| 2000000000 | 69279037 | 69279037 | PASS |
| 20000000000 | 65353130 | 65353130 | PASS |
| HOTP c=0…9 | 755224, 287082, 359152, 969429, 338314, 254676, 287922, 162583, 399871, 520489 | 全部一致 | PASS |

（密钥为 RFC 的 ASCII `12345678901234567890`；TOTP 向量取 8 位，HOTP 取 6 位。）

## 7. 证据

### 7.1 node 单测：`node work/account-tests.mjs` → **ALL 56 ACCOUNT CHECKS PASS**（exit 0）

覆盖：QR 编码器与独立实现（harness 自带的 `qrcode` 包，非站点依赖）逐模块比对（5 种长度，v1/v5/v8/v9/v10 全等）；RFC 向量；Base32 往返；常数时间比较；创建/校验/拒绝重复；存储 schema 与密文不含明文；口令错误被拒；导出→导入→解锁；B2 全流程（含 15 分钟过期）；TOTP 启用/确认/恢复码只用一次/已用失效；**5 次失败锁 5 分钟且锁定期正确 TOTP 也拒绝**；产品文件验签与篡改拒绝；可选 Gist 同步只传密文且只连 api.github.com；**整条离线流程 `requests.length === 0` 且 `netlog` 为空**。

原始输出：`work/_account-shots/account-tests-output.txt`（tests=0）。

### 7.2 静态自检：`node work/account-static-check.mjs` → **ALL 24 STATIC CHECKS PASS**（exit 0）

- 四个页面：`data-account-page`、语言属性、assets 引用齐全（含绝对路径 verify 门）、无外部主机/CDN。
- 网络请求清单（可复核）：`account.js` 里 `fetch(` **只有 1 处**——`gh()` 助手（第 489 行）；`XMLHttpRequest` / `sendBeacon` / `WebSocket` / `EventSource` / `importScripts` / `eval` 各 **0 处**；字面 URL 只有 3 个：`https://api.github.com/user/emails`、`https://github.com/login/device/code`、`https://github.com/login/oauth/access_token`（外加运行期拼出的 `https://api.github.com/gists…`）。
- 控件齐全、二维码走本地 canvas、信任等级文案区分、产品路径出现在 UI、PBKDF2=250000、AES-GCM 256、TOTP SHA-1/30/6/±1、恢复码 SHA-256。

原始输出：`work/_account-shots/account-static-output.txt`（static=0）。复核命令：`grep -n "fetch(" web/infinity/assets/account.js`。

### 7.3 断网全流程

在无浏览器可用的前提下，断网证据由单测提供：测试把 `global.fetch` 换成“一律抛错并记账”的桩，然后跑完注册 → 自证 → 启用 2FA → 锁定 → TOTP 登录 → 恢复码登录 → 恢复码失效 → 导出 → 导入 的完整路径，断言 `requests.length === 0`、`netlog.length === 0`；随后单独用桩验证 B1/PAT 与 Gist 同步的**唯一**外部目标。

## 8. 截图：N/A

按 Lead 2026-10-05 的批复：**headless Edge 截图不批**（此前按进程名批量清理误杀了用户浏览器，禁止再启动任何 exe/浏览器/宿主/服务）。因此本任务不产出 `work/_account-shots/*.png`；页面的“运行证据”改由 §7 的 node 单测 + 静态自检承担，页面外观类证据缺失已在验收中标注为 N/A 而非 PASS。

## 9. 残留与限制

1. Device Flow 在浏览器里因 github.com 无 CORS 头而不可用（已实测），只能走“PAT 真验证”或本地脚本；这与“不得有自有后端”共同决定了现状。
2. 没有服务端，就无法做服务端吊销/在线校验；口令强度与浏览器安全是唯一防线。
3. `account.json` 是设备自签（完整性），不提供第三方身份担保；跨设备可信度靠 `email.trust` 与用户自己保管的公钥。
4. PBKDF2 250k 在 Edge 154 实测约 47 ms（本机），如需对抗更强的离线爆破可提高到 600k，但会牺牲解锁手感。
5. 页面尚未接入站内 `myself` 面板的导航入口（nav 里已有 Sign in / Sign up，未改 site.js）。
6. 未做浏览器端的真实点击回归（禁起浏览器），交互正确性目前由静态引用检查 + 纯逻辑单测覆盖。

## 10. 复现命令（全部为纯 node 脚本，不 spawn 任何 exe）

```powershell
node --check web/infinity/assets/account.js
node work/account-tests.mjs
node work/account-static-check.mjs
Select-String -Path web/infinity/assets/account.js -Pattern 'fetch\('
```
