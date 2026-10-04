import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function opt(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith('--')) return true;
  return v;
}
const ROOT = path.resolve(String(opt('root', 'D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/history')));
const KEEP = path.resolve(String(opt('keep', path.join(ROOT, 'history.jsonl'))));
const SHAFILE = opt('sha256', null) ? path.resolve(String(opt('sha256', null))) : null;
const APPLY = !!opt('apply', false);

if (!fs.existsSync(KEEP)) { console.error('KEEP file missing: ' + KEEP); process.exit(2); }
if (SHAFILE) {
  const want = fs.readFileSync(SHAFILE, 'utf8').trim().split(/\s+/)[0];
  const h = crypto.createHash('sha256').update(fs.readFileSync(KEEP)).digest('hex');
  console.log('sha256 check: want=' + want.slice(0, 16) + '... got=' + h.slice(0, 16) + '... ' + (want === h ? 'OK' : 'FAIL'));
  if (want !== h) process.exit(3);
}

const doomed = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.isFile()) { if (path.resolve(p) !== KEEP) doomed.push(p); }
  }
}
walk(ROOT);
let bytes = 0;
for (const p of doomed) { try { bytes += fs.statSync(p).size; } catch {} }
console.log('mode=' + (APPLY ? 'APPLY' : 'dry-run') + ' root=' + ROOT);
console.log('files to delete=' + doomed.length + '  bytes=' + (bytes / 1048576).toFixed(1) + ' MB');
if (!APPLY) {
  const sample = doomed.slice(0, 5).map(p => path.relative(ROOT, p));
  console.log('sample: ' + JSON.stringify(sample));
  const keepSize = fs.statSync(KEEP).size;
  console.log('kept: ' + path.relative(ROOT, KEEP) + ' (' + (keepSize / 1048576).toFixed(2) + ' MB)');
  process.exit(0);
}
let deleted = 0, failed = [];
for (const p of doomed) {
  try { fs.unlinkSync(p); deleted++; } catch (e) { failed.push(path.relative(ROOT, p) + ' :: ' + e.code); }
}
// prune empty dirs bottom-up
let dirsRemoved = 0;
(function pruneDirs(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) pruneDirs(path.join(dir, e.name));
  }
  if (path.resolve(dir) === ROOT) return;
  try { if (fs.readdirSync(dir).length === 0) { fs.rmdirSync(dir); dirsRemoved++; } } catch {}
})(ROOT);
console.log('deleted=' + deleted + '/' + doomed.length + '  dirsRemoved=' + dirsRemoved + '  failed=' + failed.length);
if (failed.length) console.log('FAILED SAMPLE: ' + JSON.stringify(failed.slice(0, 10)));
console.log('remaining under root: ' + JSON.stringify(fs.readdirSync(ROOT)));
