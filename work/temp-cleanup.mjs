// temp-cleanup.mjs - delete the temp/ scratch tree, with a written plan first.
//
// Nothing is removed until --apply is passed. Without --apply the script only
// writes work/temp-cleanup-plan.json and prints what it would do.
//
// What is deliberately kept:
//   temp/tools/runtimes/win-x64/node-v22.11.0-win-x64/node.exe is the ONLY
//   surviving copy of the v22.11.0 build runtime (80,511,640 B, sha256
//   7447c4ece014aa41fb2ff866c993c708e5a8213a00913cc2ac5049ea3ffc230d). Every
//   other platform directory under runtimes is already an empty shell. Deleting
//   that file would leave the workspace unable to build any layout, so the whole
//   temp/tools tree is pinned, whatever its size.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TEMP = path.join(ROOT, 'temp');
const PLAN = path.join(ROOT, 'work', 'temp-cleanup-plan.json');
const APPLY = process.argv.indexOf('--apply') >= 0;

const PINNED = ['tools'];

function sizeOf(p) {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const q = path.join(d, e.name);
      if (e.isDirectory()) walk(q);
      else { try { n += fs.statSync(q).size; } catch {} }
    }
  };
  try { walk(p); } catch {}
  return n;
}

if (!fs.existsSync(TEMP)) { console.log('temp/ is already gone'); process.exit(0); }

const entries = fs.readdirSync(TEMP, { withFileTypes: true }).map(function (e) {
  const p = path.join(TEMP, e.name);
  const bytes = e.isDirectory() ? sizeOf(p) : fs.statSync(p).size;
  return { name: e.name, dir: e.isDirectory(), bytes: bytes, keep: PINNED.indexOf(e.name) >= 0 };
});
entries.sort(function (a, b) { return b.bytes - a.bytes; });

const del = entries.filter(function (e) { return !e.keep; });
const keep = entries.filter(function (e) { return e.keep; });
const delBytes = del.reduce(function (a, e) { return a + e.bytes; }, 0);
const keepBytes = keep.reduce(function (a, e) { return a + e.bytes; }, 0);

const plan = {
  at: new Date().toISOString(),
  temp: TEMP,
  apply: APPLY,
  pinned: PINNED,
  delete: del,
  keep: keep,
  deleteBytes: delBytes,
  keepBytes: keepBytes,
  deleteText: (delBytes / 1073741824).toFixed(2) + ' GiB',
  keepText: (keepBytes / 1048576).toFixed(1) + ' MiB'
};

let removed = [], failed = [];
if (APPLY) {
  for (const e of del) {
    const p = path.join(TEMP, e.name);
    try {
      fs.rmSync(p, { recursive: true, force: true });
      removed.push({ name: e.name, gone: !fs.existsSync(p) });
    } catch (err) {
      failed.push({ name: e.name, error: String(err && err.message || err) });
    }
  }
  plan.removed = removed;
  plan.failed = failed;
  // safety: the pinned runtime must still be there afterwards
  plan.runtimeAfter = fs.existsSync(path.join(TEMP, 'tools', 'runtimes', 'win-x64', 'node-v22.11.0-win-x64', 'node.exe'));
}

fs.writeFileSync(PLAN, JSON.stringify(plan, null, 2) + '\n');

console.log(APPLY ? 'APPLY' : 'PLAN (pass --apply to delete)');
for (const e of entries.slice(0, 25)) {
  console.log('  ' + (e.keep ? 'keep ' : 'DEL  ') + e.name.padEnd(28) + String(e.bytes).padStart(14) + ' B');
}
console.log('delete ' + plan.deleteText + ' in ' + del.length + ' entries; keep ' + plan.keepText + ' in ' + keep.length);
if (APPLY) console.log('removed ' + removed.length + ', failed ' + failed.length + ', runtime still present = ' + plan.runtimeAfter);
console.log('plan -> ' + PLAN);
