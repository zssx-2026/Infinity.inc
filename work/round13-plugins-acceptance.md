# 第 13 轮报告：插件子系统离线验收（InfinityServer + InfinityStudio 客户端）

生成：2026-10-18T11:35:17.584Z

## 交付物

| 文件 | 字节 | sha256 |
|---|---:|---|
| `work/infinityserver-plugins-test.mjs`（新） | 14,207 | `dcbf3e74522d…` |
| `work/final-acceptance.mjs`（改，+1 项） | 4,073 | 22 → **23 项** |
| `work/INDEX.md` | 13,489 | 158 行（gen-index 复算一致） |

## 验收结果：`INFINITYSERVER-PLUGINS-PASS 36/36`

真起进程、真 loopback HTTP、真临时目录；无 mock、无网络（fixture 只做合成语法与逻辑，边界以本文件真实句柄行为为准）。

### 桩面（store 层，无 HTTP）
- `validId` 小写 id 规则；`safeRel` 拒绝 `../`、绝对路径、盘符、空段、`.`
- 安装：复制、**无 staging 残留**、重写 `plugin.json` 带真实 files 映射、每个哈希与磁盘一致
- 篡改 `data/notes.txt` → `verify()` 捕获并**点名该文件**
- 覆盖安装：无 `overwrite` 拒、有 `overwrite` 成功且篡改字节消失
- 非法 id、无 `plugin.json`、声明 entry 不存在 → 全部拒绝

### 路由面（真 boot + HTTP）
- 启动即加载插件；`GET/POST /v1/plugins/<id>/ping|echo` 通
- `PUT enabled:false` → 该路由 **404**（这正是 `loadPlugins` 里 `store.routes.clear()` 修掉的回归）；再启用 → 复活
- HTTP 安装第二个插件；重复安装 400；`overwrite=true` 200；`DELETE` 后目录与路由双清
- 抛异常的插件路由 → 500 带 `plugin:id`，**服务器不崩**
- `api` 不匹配的插件：仍列出、不加载、记 `rejected:unsupported api 0.5`
- rack 原生路由在装了插件后仍正常

### Studio 客户端面
- 空 `base` → 400 不发起任何调用
- 不可达服务器 → 透传失败而非抛异常（502 语义由 `forward()` 承担，`/v1/server/status` 语义是 200+`reachable:false`——断言语义已按实际契约修正）

## 修的真实缺陷（测试自己的，不是产品的）
1. 测试曾把 `install()` 的返回当 `{installed}`，实际是记录本身；
2. `/v1/plugins` 与 `/v1/plugins/verify` 返回 `{plugins,loaded,rejected}` 包装，不是裸数组；
3. `safeRel` 用 `''` 而非 `null` 表示拒绝；
4. 导入了 Server 的 `start` 却去连 Studio，导致 3 个客户端断言打不中；
5. 某次 `const serverPort = 0` 后再赋值 → TypeError，改为 `const serverPort = booted.port`。

## 本轮顺带
- 清理临时探针 `work/_t.js`、`work/_probe.mjs`、`work/_plugins-fixture.mjs`；
- 宿主探测：空闲物理内存 2.16 GiB（14.0 GB 总量），前台有 java/Code/msedge/DSH Desktop —— 本轮全部用轻量 Node 子进程（windowsHide），未起编译/渲染/安装程序，无弹窗。

## 全量终验

    node work/final-acceptance.mjs  ->  FINAL-ACCEPTANCE PASS 27/27

（本轮新增 server-plugins 项，0.4 s；全量含 inc-preview 约 90–126 s）

## 未决（不变）
- 发布：仍缺 `EV_GH_TOKEN` + `work/_publish-approval.txt`；
- `temp/` 16.5 GiB 待你授权删除；
- `work/sea-out-prune.mjs --apply`（~1.36 GiB）可选；
- launcher 窗口面 stdout 真 bug；
- 定时任务已零窗口（`sync-history-hidden.vbs` + 重导入 XML），归档 299,587,813 B / 26,676 唯一路径 / verifyFailed 0。
