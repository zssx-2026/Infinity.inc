// temp-inventory.mjs — temp/ 目录清理盘点（只读、永不删除）
// 输出 work/temp-inventory.json 与 Markdown 清单，供授权清理时对照执行。
import fs from 'node:fs';
import path from 'node:path';
const ROOT = process.cwd();
const TEMP = path.join(ROOT, 'temp');
function walkSize(p) {
  let t = 0;
  try { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const q = path.join(p, e.name); try { t += e.isDirectory() ? walkSize(q) : fs.statSync(q).size; } catch (e2) { } } } catch (e3) { }
  return t;
}
const rows = [];
if (fs.existsSync(TEMP)) {
  for (const e of fs.readdirSync(TEMP, { withFileTypes: true })) {
    const p = path.join(TEMP, e.name);
    rows.push({ name: e.name, dir: e.isDirectory(), bytes: e.isDirectory() ? walkSize(p) : fs.statSync(p).size });
  }
}
rows.sort((a, b) => b.bytes - a.bytes);
const cls = (r) => {
  if (r.name === 'apps') return 'A: 第三方安装包（winget 清单用，可从网络重下）';
  if (/^(ifm-bench|ifm-buildtest|heads|freearc|inc-verify|ifm-icon-audit|archive|backup)$/.test(r.name)) return 'B: 一次性测试产物';
  return 'C: 散点小稿/杂项';
};
const summary = {};
for (const r of rows) { const c = cls(r); r.class = c; summary[c] = (summary[c] || 0) + r.bytes; }
const total = rows.reduce((a, b) => a + b.bytes, 0);
const gib = (n) => (n / 1073741824).toFixed(2) + ' GiB';
let md = '| 名称 | 体积 | 分类 |\n|---|---:|---|\n';
for (const r of rows) md += '| ' + r.name + (r.dir ? '/' : '') + ' | ' + gib(r.bytes) + ' | ' + r.class + ' |\n';
const out = { at: new Date().toISOString(), temp: fs.existsSync(TEMP), totalBytes: total, byClass: summary, rows };
fs.writeFileSync(path.join(ROOT, 'work/temp-inventory.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(ROOT, 'work/temp-inventory.md'),
  '# temp/ 清理盘点（' + out.at + '，只读生成，未删任何文件）\n\n总计 **' + gib(total) + '**\n\n' + md);
console.log('temp/ total ' + gib(total));
for (const [c, n] of Object.entries(summary)) console.log('  ' + c + ' -> ' + gib(n));
console.log('temp-inventory.json/md written; nothing deleted (awaiting user authorization)');
