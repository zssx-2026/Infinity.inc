/* audit-uistale.mjs - the packaged UI must be the UI in the tree.
 * shell/build.mjs copies work/webview2/ui into every built app dir. Editing the
 * source afterwards leaves a built tree (and an installer) with old chrome: this
 * happened twice while fixing shortcuts, so the drift is now checked, not hoped. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SRC = 'work/webview2/ui';
const BUILT = 'shell/build/inc_gui-win32-x64/resources/app/ui';

function walk(dir, base, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) { walk(full, rel, out); }
    else if (e.isFile()) { out.set(rel, crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')); }
  }
  return out;
}

if (!fs.existsSync(BUILT)) {
  console.log('UISTALE SKIP no built tree at ' + BUILT);
  process.exit(0);
}
const a = walk(SRC, '', new Map());
const b = walk(BUILT, '', new Map());
const drift = [];
for (const [rel, hash] of a) {
  if (!b.has(rel)) { drift.push('missing-in-build ' + rel); }
  else if (b.get(rel) !== hash) { drift.push('differs ' + rel); }
}
for (const rel of b.keys()) { if (!a.has(rel)) { drift.push('extra-in-build ' + rel); } }

console.log('UISTALE src=' + a.size + ' built=' + b.size + ' drift=' + drift.length);
drift.forEach(function (d) { console.log('  ' + d); });
console.log('UISTALE ' + (drift.length === 0 ? 'PASS' : 'FAIL'));
process.exit(drift.length === 0 ? 0 : 1);
