import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const token = process.env.EV_GH_TOKEN;
const OWNER = 'zssx-2026';
const REPO = 'applications';
const TAG = 'application-inc';
const DIR = 'cpp/release/v1.0pre5';
const UPLOAD = ['InfinityCloud_1.0.0-pre5_win64_setup.exe', 'InfinityPackageManager_1.0.0-pre5_win64_setup.exe', 'InfinityToolbox_1.0.0-pre5_win64_setup.exe'];
const DROP = ['InfinityCloud_1.0.0-pre4_win64_setup.exe', 'InfinityPackageManager_1.0.0-pre4_win64_setup.exe', 'InfinityToolbox_1.0.0-pre4_win64_setup.exe'];

function api(method, route, json) {
  const args = ['-sS', '--ssl-no-revoke', '-X', method,
    '-H', 'Authorization: Bearer ' + token, '-H', 'Accept: application/vnd.github+json',
    '-H', 'User-Agent: Infinity.Inc', '-H', 'X-GitHub-Api-Version: 2022-11-28',
    '-w', '\n%{http_code}', 'https://api.github.com' + route];
  if (json !== undefined) args.push('-H', 'Content-Type: application/json', '--data-binary', JSON.stringify(json));
  let raw = '';
  try { raw = execFileSync('curl.exe', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { raw = String(e.stdout || '') || String(e.message || ''); }
  const cut = raw.lastIndexOf('\n');
  const status = Number(raw.slice(cut + 1).trim()) || 0;
  let data = null;
  try { data = JSON.parse(raw.slice(0, cut)); } catch (e) { data = null; }
  return { status: status, data: data };
}

function upload(url, file, mime) {
  const out = execFileSync('curl.exe', ['-sS', '--ssl-no-revoke', '-X', 'POST',
    '-H', 'Authorization: Bearer ' + token, '-H', 'Content-Type: ' + mime,
    '-H', 'Accept: application/vnd.github+json', '-H', 'User-Agent: Infinity.Inc',
    '--data-binary', '@' + file, '-w', '\n%{http_code}', url],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const cut = out.lastIndexOf('\n');
  return { status: Number(out.slice(cut + 1).trim()) || 0, data: JSON.parse(out.slice(0, cut) || 'null') };
}

const rel = api('GET', '/repos/' + OWNER + '/' + REPO + '/releases/tags/' + TAG);
if (!rel.data) throw new Error('catalog release not found');
const releaseId = rel.data.id;
const byName = new Map(rel.data.assets.map(function (a) { return [a.name, a]; }));
console.log('release ' + TAG + ' id=' + releaseId + ' assets=' + rel.data.assets.length);

const base = 'https://uploads.github.com/repos/' + OWNER + '/' + REPO + '/releases/' + releaseId + '/assets?name=';
for (const name of UPLOAD) {
  const file = DIR + '/' + name;
  const size = statSync(file).size;
  if (byName.has(name)) { console.log('   skip existing ' + name); continue; }
  const up = upload(base + encodeURIComponent(name), file, 'application/octet-stream');
  console.log('   upload ' + name + ' ' + size + 'B -> HTTP ' + up.status + ' state=' + (up.data && up.data.state));
}

/* name.txt: delete then re-upload so the page never references a missing asset */
const oldName = byName.get('name.txt');
if (oldName) {
  const del = api('DELETE', '/repos/' + OWNER + '/' + REPO + '/releases/assets/' + oldName.id);
  console.log('   delete old name.txt -> HTTP ' + del.status);
}
const txt = upload(base + 'name.txt', DIR + '/name.txt', 'text/plain');
console.log('   upload name.txt ' + statSync(DIR + '/name.txt').size + 'B -> HTTP ' + txt.status);

for (const name of DROP) {
  const a = byName.get(name);
  if (!a) { console.log('   absent ' + name); continue; }
  const del = api('DELETE', '/repos/' + OWNER + '/' + REPO + '/releases/assets/' + a.id);
  console.log('   delete ' + name + ' -> HTTP ' + del.status);
}

const after = api('GET', '/repos/' + OWNER + '/' + REPO + '/releases/tags/' + TAG);
console.log('\nFINAL assets=' + after.data.assets.length);
for (const a of after.data.assets) console.log('   ' + a.name + ' ' + a.size + 'B');
