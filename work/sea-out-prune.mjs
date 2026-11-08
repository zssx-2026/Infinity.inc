// sea-out-prune.mjs - plan (and optionally perform) the removal of stale SEA
// single-file builds under */build/out.
//
// Why this is a plan-first script and not an rm -rf:
//
//   make-setup.mjs for all three products stages its payload from
//   build/layout/<target>, and FALLS BACK to build/out/<target> when a platform
//   has no layout yet. Layouts exist for win-x64 only, so the six remaining
//   build/out/<target> directories are still the live payload source for
//   win-ia32, win-arm64, linux-x64, linux-arm64, darwin-x64 and darwin-arm64.
//   Deleting them would not break today's win-x64 build, but it would silently
//   turn every other platform's setup into an empty installer the next time
//   someone runs make-setup without a layout.
//
// Therefore the default action is PLAN: it lists what is there, marks what is
// still needed (no layout for that target) and what is genuinely dead
// (build/out/win-x64 - every product has a win-x64 layout now), and writes
// work/sea-out-prune-plan.json. Nothing is deleted without --apply, and even
// with --apply only the targets listed as dead are removed.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const APPLY = process.argv.indexOf('--apply') >= 0;
const PLAN = path.join(ROOT, 'work', 'sea-out-prune-plan.json');

const PRODUCTS = [
  { id: 'ifm', build: path.join(ROOT, 'Infinity File Manager', 'sourcecode', 'build') },
  { id: 'inc', build: path.join(ROOT, 'Infinity Cloud', 'sourcecode', 'build') },
  { id: 'ipm', build: path.join(ROOT, 'InfinityPackageManager', 'build')
  }
];

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

const rows = [];
let deadBytes = 0, keepBytes = 0, removed = [], failed = [];

for (const pr of PRODUCTS) {
  const out = path.join(pr.build, 'out');
  const layout = path.join(pr.build, 'layout');
  if (!fs.existsSync(out)) { rows.push({ product: pr.id, target: '(no build/out)', bytes: 0, dead: false, reason: 'absent' }); continue; }
  const hasLayoutFor = (t) => fs.existsSync(path.join(layout, t, 'node.exe')) && fs.existsSync(path.join(layout, t, 'app.cjs'));
  for (const e of fs.readdirSync(out, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(out, e.name);
    const bytes = sizeOf(p);
    const dead = hasLayoutFor(e.name);
    const row = {
      product: pr.id,
      target: e.name,
      bytes: bytes,
      dead: dead,
      reason: dead ? 'a layout exists for this target; build/out copy is stale' : 'no layout for this target; still the live payload fallback'
    };
    if (dead) deadBytes += bytes; else keepBytes += bytes;
    rows.push(row);
    if (APPLY && dead) {
      try {
        fs.rmSync(p, { recursive: true, force: true });
        removed.push({ product: pr.id, target: e.name, gone: !fs.existsSync(p) });
      } catch (err) {
        failed.push({ product: pr.id, target: e.name, error: String((err && err.message) || err) });
      }
    }
  }
}

const plan = {
  at: new Date().toISOString(),
  apply: APPLY,
  rows: rows,
  deadBytes: deadBytes,
  keepBytes: keepBytes,
  deadText: (deadBytes / 1073741824).toFixed(2) + ' GiB',
  keepText: (keepBytes / 1073741824).toFixed(2) + ' GiB'
};
if (APPLY) { plan.removed = removed; plan.failed = failed; }

fs.writeFileSync(PLAN, JSON.stringify(plan, null, 2) + '\n');

console.log(APPLY ? 'APPLY' : 'PLAN (pass --apply to delete the stale ones)');
for (const r of rows) {
  console.log('  ' + r.product + '  ' + r.target.padEnd(14) + String(r.bytes).padStart(12) + ' B  ' + (r.dead ? 'DEAD  ' : 'keep  ') + r.reason);
}
console.log('dead ' + plan.deadText + ' / keep ' + plan.keepText);
if (APPLY) console.log('removed ' + removed.length + ', failed ' + failed.length);
console.log('plan -> ' + PLAN);
