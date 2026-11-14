# 无窗口规则（硬约束）

用户指令（2026-11-13）：**真正做到什么窗口都不要弹，CMD 和报错窗口都不要弹。**

这不是偏好，是验收条件：一次控制台闪烁、一个原生崩溃对话框、一个安装向导，
都算缺陷，和算错哈希同级。

## 规则

1. **自动化验收不启动 GUI**。要验证界面，起无窗口的服务面：
   `node InfinityStudio/src/cli.js <port>`、`node InfinityServer/src/cli.js <port>`、
   `<prefix>_cli.exe --serve-ui --port=<n>`，然后用 HTTP 取页面与状态。
   需要像素证据时用 `PrintWindow(PW_RENDERFULLCONTENT)` 后台抓已存在窗口，
   不新开窗口、不抢焦点。
2. **子进程一律 `windowsHide: true`**（`spawn` / `spawnSync` / `execFile`）。
   安装程序用 `/S` 静默参数，并配合 `windowsHide`。
3. **PowerShell 启动进程一律 `-WindowStyle Hidden`**（或 `-NoNewWindow`）；
   嵌套调用 PowerShell 用 `powershell.exe -WindowStyle Hidden -NoProfile -File ...`。
4. **应用自身不得弹崩溃框**。Electron 的默认行为是未捕获异常/未处理拒绝弹原生
   `App threw an error` 模态框并阻塞进程，因此每个 Electron 主进程都要装：
   `process.on('uncaughtException')` 与 `process.on('unhandledRejection')`，
   只写日志（`app.getPath('userData')/crash.log`）不退出、不弹框。
5. **并发下载的失败要收口**：分片任务在 `Promise.all` 已经 reject 之后再 reject
   就是 unhandledRejection，会变成崩溃框。首个失败即 abort 其余分片，每个任务自己
   catch，`Promise.all` 结束后再抛第一个错误。

## 守卫

`node work/check-hidden-windows.mjs` 扫描
`InfinityStudio/src`、`InfinityServer/src`、`shell`、`tools` 的 JS 与
`work`、`InfinityStudio`、`InfinityServer` 的 .ps1，打印

```
HIDDEN-WINDOWS PASS files=149 problems=0
```

有违规时 exit 1 并逐条列出 `文件:行号`。修补遗留脚本：
`node work/patch-windowstyle.mjs work/patchlist.txt`（PowerShell 5.1 没有 `<` 重定向，
必须用 argv 传清单文件）。

## 已知的窗口来源（已处理）

- `InfinityStudio/src/apps/codecraft.js` 三处 `spawnSync`（probeCompiler / readVersion / compile）→ 已补 `windowsHide`。
- `InfinityStudio/src/remote.js` 安装器 spawn → `windowsHide: true, stdio: 'ignore'`。
- `InfinityStudio/src/main.js` → 加 uncaughtException / unhandledRejection / render-process-gone 日志，不弹框。
- `InfinityServer/src/main.js`、`shell/main.js` → 同样的崩溃日志守卫。
- 19 个历史探针脚本的 `Start-Process` → 补 `-WindowStyle Hidden`。
