/*
 * release-docs-pre8.mjs - fill the v1.0pre8 release notes with the bytes that
 * were actually built, then derive the in-repo copy from the same text.
 *
 *   node work/release-docs-pre8.mjs
 *
 * The GitHub body (docs/RELEASE-v1.0pre8-body.md) keeps placeholders until the
 * installers exist; this script refuses to run while any installer is missing
 * or empty, so a half-built release never gets a published-looking note.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIR = path.join(ROOT, 'cpp', 'release', 'v1.0pre8');
const BODY = path.join(ROOT, 'docs', 'RELEASE-v1.0pre8-body.md');
const COPY = path.join(ROOT, 'docs', 'RELEASE-v1.0pre8.md');

const APPS = [
  { key: 'INC', name: 'InfinityCloud' },
  { key: 'IPM', name: 'InfinityPackageManager' },
  { key: 'INT', name: 'InfinityToolbox' }
];

const facts = {};
let total = 0;
for (const app of APPS) {
  const file = fs.readdirSync(DIR).find((n) => n.startsWith(app.name + '_') && n.endsWith('_setup.exe'));
  if (!file) { console.error('missing installer for ' + app.name + ' in ' + DIR); process.exit(2); }
  const full = path.join(DIR, file);
  const buf = fs.readFileSync(full);
  if (buf.length === 0) { console.error('empty installer ' + file); process.exit(2); }
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  facts[app.key] = { file, size: buf.length, sha };
  total += buf.length;
}

let body = fs.readFileSync(BODY, 'utf8');
const fill = (t) => t
  .split('__SIZE_INC__').join(facts.INC.size.toLocaleString('en-US'))
  .split('__SIZE_IPM__').join(facts.IPM.size.toLocaleString('en-US'))
  .split('__SIZE_INT__').join(facts.INT.size.toLocaleString('en-US'))
  .split('__SIZE_TOTAL__').join(total.toLocaleString('en-US'))
  .split('__SHA_INC__').join(facts.INC.sha)
  .split('__SHA_IPM__').join(facts.IPM.sha)
  .split('__SHA_INT__').join(facts.INT.sha);
body = fill(body);
fs.writeFileSync(BODY, body, 'utf8');

const tail = `
## 七、IPM 目录与 name.txt

IPM 目录页读取 \`zssx-2026/applications\` 仓库 \`application-inc\` 标签上的 \`name.txt\`，每行格式：

    <包名>_<版本>_win64_setup.exe Infinity.Inc <包名> setup Infinity.Inc win64

pre8 之后该文件是跨版本六行（Cloud / PackageManager / Toolbox 为 1.0.0-pre8，FileManager / InstallerManager / Games 沿用 1.0.0-pre4）。合并逻辑固化在 \`work/nametxt-cross.mjs\`（当前版本行优先，缺失的用 pre4 行补齐）：

    node work/nametxt-cross.mjs cpp/release/v1.0pre8 1.0.0-pre4

目录页刷新用 \`work/catalog-pre8.mjs\`（上传三个 pre8 安装包、删三个 pre7 安装包、name.txt 先删后传，上传后校验尺寸）。端到端复核：

    cpp/out/ipm/ipm_cli.exe search Infinity   # 应返回六条，inc/ipm/int 指向 pre8

## 八、相关文件

- [docs/RELEASE-v1.0pre8-body.md](RELEASE-v1.0pre8-body.md) —— GitHub Release 正文原文
- [docs/ENGINEERING-RULES.md](ENGINEERING-RULES.md) —— 语言选择、界面原则、安静运行、验收与发布纪律
- \`shell/main.js\` —— Electron 外壳主进程：起 \`<prefix>_cli.exe --serve-ui\`（隐藏窗口）、注册 \`infinity-shell://\`、窗口命令桥、会话落盘
- \`shell/preload.js\` —— 唯一桥：\`__INFINITY_HOST__.postMessage\` → ipc → 主进程
- \`shell/verify-contract.mjs\` —— 外壳契约自检（当前 42 条断言全绿，含 7 条安静性检查）
- \`work/shell-probe.ps1\` —— 窗口探针：dpr / origin / tabCount / frameSrc / audioElements / 窗口命令 / 截图
- \`work/qa-pre8-install.ps1\` —— 静默安装 + 窗口探针 + 卸载清理，成功打印 \`PRE8-INSTALL-QA PASS 3/3\`
- \`work/package-pre8.ps1\` —— 打包 + Authenticode 签名（含重试）
- \`work/catalog-pre8.mjs\`、\`work/nametxt-cross.mjs\` —— 目录页刷新与跨版本清单合并
`;

const head = '# Infinity.Inc 1.0.0-pre8\n\n> 本文件是仓库内的发行说明副本；GitHub Release 正文见 [docs/RELEASE-v1.0pre8-body.md](RELEASE-v1.0pre8-body.md)。\n\n';
fs.writeFileSync(COPY, head + body + tail, 'utf8');

for (const app of APPS) {
  const f = facts[app.key];
  console.log(f.file + ' ' + f.size + ' ' + f.sha);
}
console.log('total ' + total);
console.log('body ' + Buffer.byteLength(body) + ' B / ' + [...body].length + ' chars');
console.log('copy ' + Buffer.byteLength(fs.readFileSync(COPY, 'utf8')) + ' B');
