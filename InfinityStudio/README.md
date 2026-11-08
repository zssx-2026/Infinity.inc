# InfinityStudio

把 Infinity.Inc 六个产品整合成一个安装器 —— 心智模型取自 Visual Studio：**勾选工作负载，而不是勾选单个文件**。

安装逻辑全部在 `src/planner.js` 与 `src/server.js`，Electron 窗口只是它的一个视图。因此整套逻辑可以不开窗、不联网地验收。

## 目录

| 路径 | 作用 |
| --- | --- |
| `src/catalog.js` | 产品表、工作负载表、形态命名（base / admin）、工作负载展开成具体文件名 |
| `src/planner.js` | 把勾选解析成文件清单（真实字节 + SHA-256），并把清单落到目标目录后逐文件复核 |
| `src/server.js` | loopback 服务 + 安装器页面（零外链） |
| `src/main.js` | Electron 外壳（端口 7721 起） |
| `src/cli.js` | 无窗口启动：`node src/cli.js 7721` |
| `build.mjs` | 打包：把本地 Electron 拷到 `build/win-x64`，改名为 `infinitystudio_gui.exe` |

## 工作负载

| id | 名称 | 内容 | 推荐 |
| --- | --- | --- | --- |
| `core` | 核心运行时 | Infinity Cloud 窗口面 + 命令行面 | 是 |
| `desktop` | 桌面全套 | 五个产品的窗口面（Infinity Server 为独立产品，不随桌面套件安装） | 是 |
| `developer` | 开发者 | inc cli+tui、ifm cli+gui、ipm cli+tui、int cli（含管理员面） | 否 |
| `minimal` | 最小安装 | 仅 Infinity Cloud 窗口面 | 否 |

同一个文件被多个工作负载点名时只安装一次（按来源路径去重），所以总体积始终是诚实值。

## 三条不变式

1. **计划即事实**：每个条目都是工作区里真实存在的文件，实测字节与 SHA-256；不存在的记为 `missing: true`，不作为已存在参与体积累加。
2. **缺件先报**：必装产品（Infinity Cloud）缺件时 `POST /v1/install` 返回 409，安装根本不会开始 —— 不做装到一半才发现少东西的事。
3. **装完必验**：`install()` 逐个 `copyFileSync` 后重算目标文件 SHA-256 并与计划比对，任何一项不符即 `ok: false`。

## HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/v1/health` | 产品清单与可用形态 |
| GET | `/v1/workloads` | 工作负载 + 产品清单 |
| POST | `/v1/plan` | `{workloads:[id]}` → 文件清单、总体积、缺失项 |
| POST | `/v1/install` | `{workloads:[id], dest}` → 安装并逐文件复核；`dest` 必填 |
| GET | `/` | 安装器页面 |

## 自建

```
node build.mjs          # 需要 shell/node_modules/electron/dist 存在，缺则报错退出 2（不下载）
node src/cli.js 7721    # 无窗口启动，浏览器打开 http://127.0.0.1:7721/
```

## 验收

`node work/infinitystudio-test.mjs` → `INFINITYSTUDIO-TEST-PASS`

## 界面语言

页面提供 51 个语言/地区选项，切换偏好保存在本机浏览器存储中；阿拉伯语、波斯语、希伯来语和乌尔都语会切换为从右向左布局。随包提供简体中文、繁体中文、英语、西班牙语、法语、日语、德语、意大利语、巴西葡萄牙语、俄语、阿拉伯语和韩语完整文案，其余选项暂以英语显示。语言资源位于 `src/i18n.js`，无需联网。
