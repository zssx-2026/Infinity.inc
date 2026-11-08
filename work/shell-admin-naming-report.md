# Shell 管理员窗口命名修复（inc → inx，不是 incx）

时间：2026-10-11（Asia/Shanghai）｜作者：Lead

## 1. 缺陷

`shell/build.mjs` 在生成每个应用的"管理员孪生"窗口时，自己用 `t.prefix + 'x_gui'` 推导名字：

    for (const name of [t.prefix + '_gui', t.prefix + 'x_gui']) {   // 旧代码

对 inc 得到 **incx_gui**。但项目约定（`shell/payload.mjs` 注释明确写着"inx（把 c 换成 x，不是 incx）"、
`shell/main.js` 的 `ADMIN_TO_BASE`、各产品 mode.js 的 PREFIX、`cpp/tools/package.mjs` 的 admin 字段）是 **inx**。

后果：`shell/build/` 里出现 3 个 `incx_gui-win32-{x64,ia32,arm64}` 目录（每个 160–189 MB），
而 `guiDir()/stageGui()` 只消费 `<prefix>_gui-win32-<arch>`（用户窗口目录）并按 `adminGuiName()` 另存管理员
exe，因此这 3 个目录**没有任何消费方**（全仓库 grep 无引用）——纯死重量，且与文档约定矛盾。

监督缺口：`shell/verify-contract.mjs` 当时只校验 `main.js` 的 `ADMIN_TO_BASE` 映射，没有校验 `build.mjs` 的输出命名。

## 2. 修复

1. `shell/build.mjs` 改为导入并复用唯一命名源：

       import { adminGuiName } from './payload.mjs';
       const admin = adminGuiName(t.prefix).replace(/\.exe$/, '');
       for (const name of [t.prefix + '_gui', admin]) { ... }

2. 新增 `node shell/build.mjs --check`（不需要 Electron、不联网、不编译）：
   校验 5 应用 × 3 架构 × 2 名字 = 30 个目录与 exe 是否与命名源一致，并报告多余目录。

3. 存量产物按名迁移（仅重命名，字节不变）：

| 架构 | 迁移 | exe 字节 | sha256(前16) | 迁移前后一致 |
|---|---|---:|---|---|
| x64 | incx_gui-win32-x64 → inx_gui-win32-x64 | 188,784,128 | `1925f358e7f0e967` | 是 |
| ia32 | incx_gui-win32-ia32 → inx_gui-win32-ia32 | 159,897,088 | `e8edd3f41ef6ebf9` | 是 |
| arm64 | incx_gui-win32-arm64 → inx_gui-win32-arm64 | 175,995,904 | `85fe6b93274854cc` | 是 |

4. `shell/verify-contract.mjs` 增补 5 项检查（源码级 + 磁盘级）：
   `adminGuiName(inc) === 'inx_gui.exe'`、`build.mjs` 使用 `adminGuiName(`、不再出现 `t.prefix + 'x_gui'`、
   磁盘 30 个目录齐全、无多余目录。

## 3. 验证

    node shell/build.mjs --check
    { "shells": 30, "dirs": 30, "onDisk": 30, "problems": [] }
    SHELL-NAME-CHECK PASS 30 names in 30 dirs          (exit 0)

    node shell/verify-contract.mjs
    SELFTEST PASS  pass=48 fail=0                      (原 43 项 → 48 项，新增 5 项全过)

## 4. 影响范围

- 只影响 `shell/build/` 产物命名与下次 shell 构建；**已冻结的 v1.0pre5 安装包不受影响**（它们早已按 `inx_gui.exe` 打包，
  见 work/release-checksums-report.md）；
- 无消费方引用旧 `incx_gui-win32-*` 目录，删除/改名不影响打包链路；
- 复现：`node shell/build.mjs --check`、`node shell/verify-contract.mjs`、`node work/final-acceptance.mjs`。
