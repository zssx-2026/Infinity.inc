// work/cleanup.mjs — deep cleanup with an explicit junk allowlist. Never touches deliverables.
// usage: node work/cleanup.mjs            (dry-run, prints what it would free)
//        node work/cleanup.mjs --apply
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const apply = process.argv.includes('--apply');

// Junk patterns: browser profiles, build scratch, logs, crash dumps, temp stages.
const JUNK_DIRS = [
  'work/_account-shots', 'work/_token-shots', 'work/_preview-shots',
  'work/_pubtmp', 'work/_ghstate', 'work/_ipm2',
  'work/chromium-trim/tmp', 'work/chromium-trim/out-tmp',
  'cpp/apps/inc/perf/_build', 'cpp/apps/inc/perf/_bench',
  'cpp/apps/ipm/perf/_build', 'cpp/apps/iim/bench/tmp',
  'work/archive/tmp', 'work/archive/.stage',
];
const JUNK_FILE_GLOBS = [/\.tmp$/i, /\.bak$/i, /\.orig$/i, /~$/, /\.dmp$/i, /-crash\.log$/i];
const PROTECT = [
  'web/', 'docs/', 'README.md', 'Chormium/', 'ITB Tools/', 'cpp/apps/', 'cpp/core/', 'cpp/common/',
  'cpp/tools/', 'work/itbt/out', 'work/archive-bundles.json', 'work/run-queue/', 'work/proxy',
  '.git/',
];
const protectedPath = (rel) => PROTECT.some(p => rel === p.replace(/\/$/, '') || rel.startsWith(p));

function sizeOf(p) {
  const st = fs.statSync(p, { throwIfNoEntry: false });
  if (!st) return 0;
  if (st.isFile()) return st.size;
  let sum = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const c = path.join(p, e.name);
    sum += e.isDirectory() ? sizeOf(c) : (fs.statSync(c, { throwIfNoEntry: false })?.size || 0);
  }
  return sum;
}
function walk(dir, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(ROOT, full).replace(/\\/g, '/');
    if (protectedPath(rel)) { if (e.isDirectory()) walk(full, out); continue; }
    if (e.isDirectory()) walk(full, out);
    else if (JUNK_FILE_GLOBS.some(r => r.test(e.name))) out.push(full);
  }
  return out;
}

const targets = [];
for (const d of JUNK_DIRS) {
  const full = path.join(ROOT, d);
  const rel = d.replace(/\\/g, '/');
  if (protectedPath(rel)) { console.log('SKIP protected: ' + rel); continue; }
  if (fs.existsSync(full)) targets.push({ full, rel, kind: 'dir' });
}
for (const f of walk(ROOT, [])) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  if (!protectedPath(rel)) targets.push({ full: f, rel, kind: 'file' });
}

let total = 0;
const rows = [];
for (const t of targets) {
  const bytes = sizeOf(t.full);
  total += bytes;
  rows.push([t.kind, t.rel, bytes]);
}
rows.sort((a, b) => b[2] - a[2]);
for (const [kind, rel, bytes] of rows) console.log((kind === 'dir' ? 'DIR  ' : 'FILE ') + rel.padEnd(52) + bytes.toLocaleString() + ' B');
console.log('--- targets=' + rows.length + ' totalBytes=' + total + ' (' + (total / 1048576).toFixed(2) + ' MiB) apply=' + apply);
if (apply) {
  for (const t of targets) { try { fs.rmSync(t.full, { recursive: true, force: true }); } catch (e) { console.log('FAILED ' + t.rel + ' ' + e.message); } }
  console.log('deleted ' + targets.length + ' targets');
}
