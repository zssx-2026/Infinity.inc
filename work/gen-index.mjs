// gen-index.mjs — 重新生成 work/INDEX.md（交付物 + 验证脚本索引，含字节数/sha256/最后修改）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve('.');
const WORK = path.join(ROOT, 'work');
const OUT = path.join(WORK, 'INDEX.md');
const EXCLUDE = /^_/;
const KEEP_EXT = /\.(md|mjs|ps1|json|jsonl|cmd|txt|patch|css|html|js)$/i;

const rows = [];
for (const name of fs.readdirSync(WORK)) {
  if (EXCLUDE.test(name)) continue;
  const p = path.join(WORK, name);
  const st = fs.statSync(p);
  if (!st.isFile() || !KEEP_EXT.test(name)) continue;
  if (name === 'INDEX.md') continue;
  rows.push({ rel: 'work/' + name, bytes: st.size, sha: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16), mtime: st.mtimeMs });
}
rows.sort((a, b) => b.mtime - a.mtime || a.rel.localeCompare(b.rel));
const fmt = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); };
const body = [
  '# 交付物与验证脚本索引（自动生成）',
  '',
  '更新时间：' + fmt(Date.now()) + '　｜　生成器：`node work/gen-index.mjs`（work/ 顶层交付物，排除 `_` 前缀临时文件）',
  '',
  '| 文件 | 字节 | sha256(前16) | 最后修改 |',
  '|---|---:|---|---|',
  ...rows.map(r => '| `' + r.rel + '` | ' + r.bytes + ' | `' + r.sha + '` | ' + fmt(r.mtime) + ' |'),
  '',
  '## 未完成/阻塞',
  '',
  '- 发布：6 个 release 在 GitHub 均 absent（ghsync --dry-run errors 0）；缺 `EV_GH_TOKEN` 与书面批准',
  '- Gitee 镜像：owner `zssx2026` 仅有 applications/Sink；六应用 + Infinity.inc + Infinity-Archive 无公开镜像（403 为 WAF 限流；CORS 已确认 `Access-Control-Allow-Origin: *`）',
  '- pre5 归档未发布 → `bundlesPendingTags` 降级显示',
  '',
].join('\n');
fs.writeFileSync(OUT, body);
console.log(JSON.stringify({ out: OUT, rows: rows.length, bytes: fs.statSync(OUT).size }));
