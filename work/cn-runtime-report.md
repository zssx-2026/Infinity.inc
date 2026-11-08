# 官网中文站运行时文案汉化报告（task-14，Lead 代收）

- 时间：2026-10-06（Asia/Shanghai）
- 执行：`cn-runtime` 负责 `web/infinity/assets/*.js` 的双语改造；该成员在补检查器与报告前中断，Lead 复核后按现有产物验收并代收。
- 独立验收器：[work/cn-lead-verify.mjs](work/cn-lead-verify.mjs)（Lead 编写，与执行者无关）

## 1. 机制

`assets/i18n.js`（新增，3,984 B）是站点唯一决定语言的地方：

- `window.INFINITY.i18n` 暴露 `lang / zh / t / pick / register / setLang / detect / dict`；
- 判定规则：路径含 `/cn/` 段即中文；否则 `<html lang>` 以 `zh` 开头也算中文（两条今天一致，第二条让只声明 lang 的页面仍可读）；其余为英文；
- 不碰 DOM、不要求页面新增 `<script>` 标签：各资源脚本自行按上述规则取语言。

## 2. 改动文件（字节 + sha256 前 16 位）

| 文件 | 字节 | sha256(前16) |
| --- | ---: | --- |
| `assets/i18n.js` | 3984 | `630700f69ee6c582…` |
| `assets/site.js` | 56021 | `ca4f4927166d4599…` |
| `assets/download.js` | 13249 | `1bd731229f1e028f…` |
| `assets/archive.js` | 7273 | `c4e5a482499f21aa…` |
| `assets/token.js` | 20079 | `d2a5bb7a116622ef…` |
| `assets/verify.js` | 9451 | `db3cfa0c8828f90b…` |
| `assets/product.js` | 2879 | `37d11fa71d03b326…` |
| `assets/account.js` | 72052 | `2443875f04623a5a…` |
| `assets/guard.js` | 3681 | `242bdd36dde97cbc…` |

## 3. 独立验证（Lead 执行，可复算）

1. **语言规则实测**：在 Node `vm` 中注入最小 stub 加载 `i18n.js`，直接调用 `INFINITY.i18n`：`/infinity/cn/download/`（lang=zh-CN）→ `lang=zh, zh=true`；`/infinity/download/`（lang=en）→ `lang=en, zh=false`；`/infinity/cn/`（lang=en，故意冲突）→ `lang=zh`（路径优先，与文档一致）；字典 `en=11 / zh=11` 键。
2. **文本表键位对齐**：`download.js` en=6/zh=6、`archive.js` en=5/zh=5、`site.js` en=47/zh=47，无缺键；`zh` 值全部含中文（仅 `kindMsi: 'Windows msi'`、算法名等格式名保留英文，属允许项）；`token.js`（zh 三元 3 处、中文字符 510）、`verify.js`（1 处、24 字符）、`product.js`（经 `I.t()` 取词）均已接入。
3. **页面级验收**：`node work\cn-lead-verify.mjs web` → `{"cnPages":19,"missingPages":[],"problems":0}` + `PASS 中文站完全汉化`，退出码 0；19/19 页 `lang=zh-CN`、`<title>` 含中文、可见 HTML 无残留英文 UI 文案。

## 4. 遗留

- 原计划的独立检查器 `work/cn-i18n-check.mjs` 未产出；其职责已由 Lead 的 `work/cn-lead-verify.mjs` 覆盖（页面 + 文本表键位 + 语言规则三路检查），并已纳入验收命令。
- `assets/i18n.js` 目前只登记了站点级 11 键；各页面脚本的表在运行时 `register()` 合并，属设计如此。
- 英文站未改动，英文文案保持英文；`InfinityGames`（ING）相关文案沿用既有资产，本轮未改其源码/资源。
