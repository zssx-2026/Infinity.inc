# Infinity.Inc 夜间自主工作日志

目标（goal-aa1ae751）：在用户睡觉期间推进 v1.0pre4 六应用发布流水线 + 官网修复 + 归档验证 + 文档。

## 状态基线（2026-10-03 21:0x）
- 历史归档：history/history.jsonl = 264.14 MB（26354 entry / 85 chunk，原 1386.5 MB = 19.05%），全量还原 26354/26354 逐字节一致，原件已删（26355 文件 + 4769 空目录），sha256 8dd00da5…9ebb96。
- C++ 构建：cpp/build/*.exe 于 21:00:17 重新编译；cpp/out 下 6 应用 × (cli/gui/launcher) 均已就位（inc 1456128 B、ifm 514560 B、ipm/iim/int/ing 见 cpp/out）。
- 打包：cpp/tools/package.mjs 默认已是 INC_RELEASE=v1.0pre4 / INC_VERSION=1.0.0-pre4，APPS 六个；cpp/release/ 目前只有 v1.0pre3。
- 发布：cpp/tools/publish.mjs 仍写死 v1.0pre3 / tag v1.0.0-pre3 且只有 4 个仓库。
- 令牌：进程环境为空，用户注册表 `[Environment]::GetEnvironmentVariable("EV_GH_TOKEN","User")` 长度 93（可用于发布脚本，禁止打印）。
- 网站：proj-web 正在改 site.js/site.css（20:57），待落地下载卡片、语言切换（BASE 绝对 URL 根因）、404→zssx-2026.github.io/404。

## 今夜任务清单
1. [进行中] rel-cpp-build 产出 cpp/release/v1.0pre4/（6 个安装包 + name.txt + release-assets.json）
2. [待办] publish.mjs 参数化到 v1.0pre4 + 6 仓库，dry-run 后发布
3. [待办] applications/application-inc 目录刷新 + dist/*.json
4. [进行中] 官网三项修复并发布站点
5. [进行中] 归档独立验证（hist-verifier / hist-restorer 报告）
6. [待办] README + v1.0pre4 发布说明
7. [待办] 独立 QA：安装包与源码一致性校验

## 21:1x 进展
- rel-cpp-build 完成 task-6：cpp/release/v1.0pre4/ 6 个 NSIS 安装包 + name.txt + release-assets.json；7z 校验 Type=Nsis，30 个载荷导入表仅系统 DLL，--version=1.0.0-pre4。报告 work/rel-cpp-report.md。
- 安装包：Cloud 477846 / FileManager 235017 / PackageManager 278021 / InstallerManager 302978 / Toolbox 262473 / Games 262882 B。
- 发现并创建缺失仓库：zssx-2026/Infinity-Toolbox、zssx-2026/Infinity-Games（public，auto_init，default=main）——此前 404，v1.0pre4 六应用发布缺两个落点。
- 线上站点是旧的（最后提交 2026-10-03T00:30Z “publish the site (35 files)”）：/infinity/settings/ 200 但 /infinity/cn/settings/ 404、/404 404。本地 web/404.html 已存在；需重新发布站点才能修好 cn 页面。
- 令牌：发布脚本必须用 [Environment]::GetEnvironmentVariable("EV_GH_TOKEN","User") 自取（$env 里为空）；注意本机 pwsh 是 5.1，Set-Content -Encoding utf8 会写 BOM，JSON 请求体要用 Node 写文件或 [IO.File]::WriteAllText。