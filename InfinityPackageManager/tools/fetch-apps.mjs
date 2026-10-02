/*
 * fetch-apps.mjs - download every package in the plan.
 *
 * The plan came from the winget index: a real URL and a real SHA256 per
 * package. This stage moves the bytes.
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const NL = String.fromCharCode(10);
const QUOTE = String.fromCharCode(34);

const PLAN = 'D:/temp/plan.json';
const DIR = 'D:/temp/apps';
const PROG = 'D:/temp/apps-progress.json';
const RELAY = 'https://gh-proxy.com/';
const MAX_ASSET = 2000 * 1024 * 1024;
const WAVE = 24;
const EST = 70 * 1024 * 1024;

fs.mkdirSync(DIR, { recursive: true });
const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));

const items = plan.entries
  .filter(function (e) { return (e.size || 0) < MAX_ASSET; })
  .map(function (e) { return Object.assign({}, e, { est: e.size > 0 ? e.size : EST }); })
  .sort(function (x, y) { return x.est - y.est; });

process.stdout.write('planned ' + items.length + ' packages' + NL);

function landed(name) {
  try { return fs.statSync(DIR + '/' + name).size; } catch (e) { return 0; }
}

function wave(batch) {
  const cfg = [];
  cfg.push('--ssl-no-revoke');
  cfg.push('--location');
  cfg.push('--silent');
  cfg.push('--show-error');
  cfg.push('--max-time 900');
  cfg.push('--speed-limit 16384');
  cfg.push('--speed-time 45');
  cfg.push('--retry 2');
  cfg.push('--parallel');
  cfg.push('--parallel-max ' + WAVE);
  for (const it of batch) {
    const url = it.url.indexOf('github.com') >= 0 ? RELAY + it.url : it.url;
    cfg.push('url = ' + QUOTE + url + QUOTE);
    cfg.push('output = ' + QUOTE + DIR + '/' + it.fileName + QUOTE);
  }
  const file = DIR + '/wave.cfg';
  fs.writeFileSync(file, cfg.join(NL) + NL, 'utf8');
  try {
    execFileSync('curl.exe', ['-K', file], { stdio: 'ignore', maxBuffer: 67108864 });
  } catch (e) {
  }
}

const done = [];
let bytes = 0;
for (const it of items) {
  const have = landed(it.fileName);
  if (!have) continue;
  it.got = have;
  bytes += have;
  done.push(it);
}
if (done.length) {
  process.stdout.write('resuming: ' + done.length + ' present, ' +
    (bytes / 1073741824).toFixed(1) + ' GiB' + NL);
}
const pending = items.filter(function (it) { return !it.got; });
process.stdout.write('to fetch ' + pending.length + ' packages' + NL);

for (let i = 0; i < pending.length; i += WAVE) {
  const batch = pending.slice(i, i + WAVE);
  wave(batch);
  let got = 0;
  for (const it of batch) {
    const have = landed(it.fileName);
    if (!have) continue;
    it.got = have;
    bytes += have;
    done.push(it);
    got++;
  }
  fs.writeFileSync(PROG, JSON.stringify({
    updatedAt: new Date().toISOString(),
    packages: done.length,
    bytes: bytes,
    entries: done
  }, null, 1) + NL, 'utf8');
  process.stdout.write(String(done.length).padStart(5) + '  ' +
    (bytes / 1073741824).toFixed(2).padStart(7) + ' GiB  +' + got + '/' + batch.length + NL);
}
process.stdout.write('DONE ' + done.length + ' packages, ' +
  (bytes / 1073741824).toFixed(2) + ' GiB' + NL);
