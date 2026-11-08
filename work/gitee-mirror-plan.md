# Gitee 镜像落地计划（需要你来按清单执行 —— Lead 需要你授权/建库后再代为操作）

生成：2026-10-11（Asia/Shanghai）

## 背景

- 中文官网（`web/infinity/cn/**`）严格只引用 `gitee.com/zssx2026`，英文官网严格只引用 `github.com/zssx-2026`（`work/cn-gitee-verify.mjs` 守门）；
- Gitee 上 `zssx2026` 目前只有 `applications` 与 `Sink` 两个仓库，
  中文站的文档阅读器/下载清单因目录不存在而显示"待镜像 + 手动 GitHub 出口"。

## 需要创建的仓库（6 个产品 + 1 个目录 + 1 个聚合 = 与 GitHub 一一对齐）

| Gitee 仓库 | 镜像自 GitHub | 用途 |
|---|---|---|
| `zssx2026/infinity-inc` | `zssx-2026/Infinity.inc` | 主仓（站点文档源） |
| `zssx2026/infinity-cloud` | `zssx-2026/Infinity-Cloud` | INC |
| `zssx2026/infinity-file-manager` | `zssx-2026/Infinity-File-Manager` | IFM |
| `zssx2026/infinity-package-manager` | `zssx-2026/InfinityPackageManager` | IPM |
| `zssx2026/infinity-installer-manager` | `zssx-2026/Infinity-Installer-Manager` | IIM |
| `zssx2026/infinity-toolbox` | `zssx-2026/Infinity-Toolbox` | INT |
| `zssx2026/infinity-games` | `zssx-2026/Infinity-Games` | ING |

（沿用你 Gitee 现有 `applications`、`Sink` 两个仓库；上面的命名按现有风格推定，建库前请与我确认最终命名。）

## 建好之后 Lead 可以立即完成的事

1. 中文站点的文档阅读器自动恢复（`I.gh()` 指向 Gitee 内容接口）；
2. 若有需要，把"手动 GitHub 出口"提示弱化为次要链接；
3. 全量验收（含 `cn-gitee-verify` 76 项）跑一遍回归。

## 需要你做的最少动作

1. 在 Gitee 上创建上表 7 个公开仓库（仅 README/占位即可，内容同步我可以代做但需要你给 Gitee 的 token）；
2. 若要 Lead 代推内容：给一个 Gitee token（repo 写权限）+ 书面批准，写入 `work/_gitee-token.txt`。
