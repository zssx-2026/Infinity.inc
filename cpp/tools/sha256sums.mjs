// sha256sums.mjs — 生成/校验 SHA256SUMS.txt（GNU coreutils 格式 "<sha256>  <relpath>"）
// 用法: node cpp/tools/sha256sums.mjs [releaseDir] [--check]
// 顺序（与既有 installers/packaging/v1.0pre6/SHA256SUMS.txt 完全一致）:
//   1) release-assets.json 中的资产，按文件名字典序
//   2) 目录内其余顶层文件，字典序
//   3) 子目录递归，目录名与文件名字典序
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'cpp/release/v1.0pre7';
const check = process.argv.includes('--check');
const problems = [];
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const manPath = path.join(dir, 'release-assets.json');
const manifest = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, 'utf8')) : { assets: [] };

const ordered = [];
const seen = new Set();
const assetRels = [...new Set((manifest.assets || []).map((a) => String(a.name || '')).filter(Boolean))].sort();
for (const rel of assetRels) {
  const p = path.join(dir, rel);
  if (!fs.existsSync(p)) { problems.push('missing asset ' + rel); continue; }
  const buf = fs.readFileSync(p);
  const a = (manifest.assets || []).find((x) => String(x.name) === rel) || {};
  if (a.size !== undefined && buf.length !== Number(a.size)) problems.push('size mismatch ' + rel + ': ' + buf.length + ' != ' + a.size);
  if (a.sha256 && sha256(p) !== String(a.sha256)) problems.push('sha mismatch ' + rel);
  seen.add(rel); ordered.push(rel);
}
const top = fs.readdirSync(dir).filter((n) => n !== 'SHA256SUMS.txt').sort();
const dirs = [];
for (const n of top) {
  const st = fs.statSync(path.join(dir, n));
  if (st.isDirectory()) { dirs.push(n); continue; }
  if (!seen.has(n)) { seen.add(n); ordered.push(n); }
}
for (const d of dirs) {
  const recurse = (rel) => {
    for (const n of fs.readdirSync(path.join(dir, rel)).sort()) {
      const sub = rel + '/' + n;
      if (fs.statSync(path.join(dir, sub)).isDirectory()) recurse(sub);
      else if (!seen.has(sub)) { seen.add(sub); ordered.push(sub); }
    }
  };
  recurse(d);
}
const lines = ordered.map((rel) => sha256(path.join(dir, rel)) + '  ' + rel);
const text = lines.join('\n') + '\n';
const sumsPath = path.join(dir, 'SHA256SUMS.txt');
const existing = fs.existsSync(sumsPath) ? fs.readFileSync(sumsPath, 'utf8') : null;
const matchesExisting = existing === text;
let wrote = false;
if (!check) { if (!matchesExisting) { fs.writeFileSync(sumsPath, text); wrote = true; } }
else if (existing === null) problems.push('missing ' + sumsPath);
else if (!matchesExisting) problems.push(sumsPath + ' differs from recomputed content');
console.log(JSON.stringify({ dir, files: ordered.length, wrote, matchesExisting, sumsBytes: fs.existsSync(sumsPath) ? fs.statSync(sumsPath).size : 0, sumsSha: fs.existsSync(sumsPath) ? sha256(sumsPath) : null, problems }, null, 1));
if (problems.length) process.exit(1);
