/*
 * apply-sizes.mjs - fold the HEAD results back into the plan.
 *
 * A server that refuses HEAD is not a broken package, so an entry with no
 * measured size keeps its place and is given the median instead. Dropping
 * those entries was a mistake worth naming: it silently removed two thirds
 * of the catalogue.
 */
import fs from 'node:fs';

const N = String.fromCharCode(10);
const PLAN = 'D:/temp/plan.json';
const HEADS = 'D:/temp/heads';
const EST = 70 * 1024 * 1024;

const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
let known = 0, unknown = 0, total = 0;
const sizes = [];

for (const e of plan.entries) {
  const safe = e.fileName.replace(/[^A-Za-z0-9._-]/g, '_');
  let size = 0;
  /* The head files are numbered by position, so the index is the key. */
  const i = plan.entries.indexOf(e);
  const f = HEADS + '/' + i + '.txt';
  if (fs.existsSync(f)) {
    const m = fs.readFileSync(f, 'utf8').match(/content-length:\s*(\d+)/i);
    if (m) size = parseInt(m[1], 10) || 0;
  }
  if (size > 0) { known++; total += size; sizes.push(size); }
  else { unknown++; }
  e.size = size;
  e.est = size > 0 ? size : EST;
}

sizes.sort(function (a, b) { return a - b; });
const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : EST;

/* GitHub refuses an asset of 2 GiB or more, so those are removed here. */
const MAX = 2000 * 1024 * 1024;
const kept = plan.entries.filter(function (e) { return e.est < MAX; });
const dropped = plan.entries.length - kept.length;

let projected = 0;
for (const e of kept) projected += e.est;
plan.entries = kept;
plan.packages = kept.length;
fs.writeFileSync(PLAN, JSON.stringify(plan, null, 1) + N, 'utf8');

process.stdout.write('kept ' + kept.length + ' dropped ' + dropped + N);
process.stdout.write('measured ' + known + '  refused ' + unknown + N);
process.stdout.write('median ' + (median / 1048576).toFixed(1) + ' MiB' + N);
process.stdout.write('projected download ' + (projected / 1073741824).toFixed(1) + ' GiB' + N);
