/*
 * head-all.mjs - ask every planned URL how big it is.
 *
 * winget manifests carry the hash but not the size, so the size has to come
 * from the server. A HEAD request is enough for most CDNs, and the ones that
 * refuse it are reported rather than guessed at.
 *
 * The answer decides whether the whole plan is feasible: a thousand packages
 * at a few megabytes each is a different project from a thousand at a hundred.
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const NL = String.fromCharCode(10);
const QUOTE2 = String.fromCharCode(34);
const PLAN = 'D:/temp/plan.json';
const HEADS = 'D:/temp/heads';

const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
fs.rmSync(HEADS, { recursive: true, force: true });
fs.mkdirSync(HEADS, { recursive: true });

const cfg = [];
plan.entries.forEach(function (e, i) {
  cfg.push('url = ' + QUOTE2 + e.url + QUOTE2);
  cfg.push('output = ' + QUOTE2 + HEADS + '/' + i + '.txt' + QUOTE2);
});
fs.writeFileSync(HEADS + '/curl.cfg', cfg.join(NL) + NL, 'utf8');

process.stdout.write('probing ' + plan.entries.length + ' urls' + NL);
try {
  execFileSync('curl.exe', ['-sS', '-I', '--parallel', '--parallel-max', '16', '--ssl-no-revoke',
    '--max-time', '600', '-K', HEADS + '/curl.cfg'], { stdio: 'ignore', maxBuffer: 67108864 });
} catch (e) {
  process.stdout.write('curl reported ' + String(e.message).slice(0, 120) + NL);
}

let total = 0;
let known = 0;
let unknown = 0;
let biggest = 0;
const sizes = [];

for (let i = 0; i < plan.entries.length; i++) {
  const f = HEADS + '/' + i + '.txt';
  let size = 0;
  if (fs.existsSync(f)) {
    const text = fs.readFileSync(f, 'utf8');
    const m = text.match(/content-length:\s*(\d+)/i);
    if (m) size = parseInt(m[1], 10) || 0;
  }
  plan.entries[i].size = size;
  if (size > 0) { known++; total += size; sizes.push(size); if (size > biggest) biggest = size; }
  else unknown++;
}

sizes.sort(function (a, b) { return a - b; });
const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;

/* A release cannot hold an asset of 2 GB or more, so those are dropped. */
const OVER = 2 * 1024 * 1024 * 1024;
const tooBig = plan.entries.filter(function (e) { return e.size >= OVER; });
const usable = plan.entries.filter(function (e) { return e.size > 0 && e.size < OVER; });

plan.packages = usable.length;
plan.entries = usable;
fs.writeFileSync(PLAN, JSON.stringify(plan, null, 1) + NL, 'utf8');

process.stdout.write('sizes known ' + known + '  unknown ' + unknown + NL);
process.stdout.write('median ' + (median / 1048576).toFixed(1) + ' MiB  biggest ' +
  (biggest / 1048576).toFixed(1) + ' MiB' + NL);
process.stdout.write('total ' + (total / 1073741824).toFixed(1) + ' GiB' + NL);
process.stdout.write('usable ' + usable.length + '  over 2 GiB ' + tooBig.length + NL);

/* The smallest third is what a first pass can realistically move. */
const small = usable.filter(function (e) { return e.size < 20 * 1048576; });
let smallTotal = 0;
for (const s of small) smallTotal += s.size;
process.stdout.write('under 20 MiB: ' + small.length + ' packages, ' +
  (smallTotal / 1073741824).toFixed(1) + ' GiB' + NL);

const under100 = usable.filter(function (e) { return e.size < 100 * 1048576; });
let u100 = 0;
for (const s of under100) u100 += s.size;
process.stdout.write('under 100 MiB: ' + under100.length + ' packages, ' +
  (u100 / 1073741824).toFixed(1) + ' GiB' + NL);
