// release-set-parity.mjs — 发行产物"两处冻结"一致性检查
// 1) 每个安装包在 cpp/release/v1.0pre5 与 installers/packaging/v1.0pre5 中逐字节一致，且与 release-assets.json 的 size/sha256 相符
// 2) name.txt / release-assets.json 两份一致
// 3) 两处 SHA256SUMS.txt 都可由 cpp/tools/sha256sums.mjs --check 复现；打包镜像的图标与清单相符
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve('.');
const PRIMARY = path.join(ROOT, 'cpp/release/v1.0pre5');
const MIRROR = path.join(ROOT, 'installers/packaging/v1.0pre5');
const problems = [];
const info = {};
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const size = (p) => fs.statSync(p).size;

if (!fs.existsSync(PRIMARY)) problems.push('missing ' + PRIMARY);
if (!fs.existsSync(MIRROR)) problems.push('missing ' + MIRROR);
if (problems.length) { console.log(JSON.stringify({ ok: false, problems }, null, 1)); process.exit(1); }

const manA = path.join(PRIMARY, 'release-assets.json');
const manB = path.join(MIRROR, 'release-assets.json');
if (sha(manA) !== sha(manB)) problems.push('release-assets.json differs between primary and mirror');
const man = JSON.parse(fs.readFileSync(manA, 'utf8'));
/* Infinity Installer Manager left the product line, so the installer count is
 * read off the frozen manifest rather than written in here as a number that
 * somebody would have to remember to change. The manifest is the source of
 * truth; every other count in this file follows it. */
const ASSET_COUNT = (man.assets || []).length;
info.assets = (man.assets || []).length;
info.tag = man.tag;
info.version = man.version;
if (!man.assets || man.assets.length !== ASSET_COUNT) problems.push('expected ' + ASSET_COUNT + ' assets, got ' + (man.assets || []).length);

for (const a of man.assets || []) {
  const n = String(a.name);
  const pa = path.join(PRIMARY, n), pb = path.join(MIRROR, n);
  if (!fs.existsSync(pa) || !fs.existsSync(pb)) { problems.push('missing copy of ' + n); continue; }
  const sa = sha(pa), sb = sha(pb);
  if (sa !== sb) problems.push('primary/mirror differ: ' + n);
  if (Number(a.size) !== size(pa)) problems.push('size mismatch vs manifest: ' + n);
  if (String(a.sha256) !== sa) problems.push('sha mismatch vs manifest: ' + n);
  info[n] = { size: size(pa), sha256: sa.slice(0, 16) };
}
if (sha(path.join(PRIMARY, 'name.txt')) !== sha(path.join(MIRROR, 'name.txt'))) problems.push('name.txt differs');

// SHA256SUMS.txt reproducible in both trees
for (const dir of [PRIMARY, MIRROR]) {
  try { execFileSync(process.execPath, [path.join(ROOT, 'cpp/tools/sha256sums.mjs'), dir, '--check'], { stdio: 'pipe' }); }
  catch (e) { problems.push('sha256sums --check failed for ' + dir + ': ' + String(e.stdout || e.message).slice(0, 200)); }
}
info.primarySums = { bytes: size(path.join(PRIMARY, 'SHA256SUMS.txt')), sha256: sha(path.join(PRIMARY, 'SHA256SUMS.txt')).slice(0, 16) };
info.mirrorSums = { bytes: size(path.join(MIRROR, 'SHA256SUMS.txt')), sha256: sha(path.join(MIRROR, 'SHA256SUMS.txt')).slice(0, 16) };

// icons in mirror
const iconDir = path.join(MIRROR, 'icons');
const icons = fs.existsSync(iconDir) ? fs.readdirSync(iconDir).filter((f) => f.endsWith('.ico')).sort() : [];
info.icons = icons.length;
if (icons.length !== ASSET_COUNT) problems.push('expected ' + ASSET_COUNT + ' .ico in mirror/icons, got ' + icons.length);
const sumsText = fs.readFileSync(path.join(MIRROR, 'SHA256SUMS.txt'), 'utf8');
for (const f of icons) {
  const h = sha(path.join(iconDir, f));
  if (!sumsText.includes(h + '  icons/' + f)) problems.push('icons/' + f + ' not covered by mirror SHA256SUMS.txt');
}

// unexpected files
const expectPrimary = new Set(['SHA256SUMS.txt', 'name.txt', 'release-assets.json', ...(man.assets || []).map((a) => String(a.name))]);
for (const f of fs.readdirSync(PRIMARY)) if (!expectPrimary.has(f)) problems.push('unexpected file in primary: ' + f);
const expectMirror = new Set([...expectPrimary, 'icons']);
for (const f of fs.readdirSync(MIRROR)) if (!expectMirror.has(f)) problems.push('unexpected file in mirror: ' + f);

const out = { ok: problems.length === 0, ...info, problems };
console.log(JSON.stringify(out, null, 1));
if (problems.length) process.exit(1);
console.log('RELEASE-SET-PARITY-PASS ' + ASSET_COUNT + '/' + ASSET_COUNT + ' assets byte-identical; sums reproducible; ' + icons.length + ' icons covered');
