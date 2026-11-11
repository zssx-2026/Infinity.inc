import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const token = process.env.EV_GH_TOKEN;
const OWNER = 'zssx-2026';
const REPO = 'applications';
const TAG = 'application-inc';
const DIR = 'cpp/release/v1.0pre7';
const UPLOAD = ['InfinityCloud_1.0.0-pre7_win64_setup.exe', 'InfinityPackageManager_1.0.0-pre7_win64_setup.exe', 'InfinityToolbox_1.0.0-pre7_win64_setup.exe'];
const DROP = ['InfinityCloud_1.0.0-pre6_win64_setup.exe', 'InfinityPackageManager_1.0.0-pre6_win64_setup.exe', 'InfinityToolbox_1.0.0-pre6_win64_setup.exe'];

function api(method, route, json) {
  const args = ['-sS', '--ssl-no-revoke', '-X', method,
    '-H', 'Authorization: Bearer ' + token, '-H', 'Accept: application/vnd.github+json',
    '-H', 'User-Agent: Infinity.Inc', '-H', 'X-GitHub-Api-Version: 2022-11-28',
    '-w', '\n%{http_code}', 'https://api.github.com' + route];
  if (json !== undefined) args.push('-H', 'Content-Type: application/json', '--data-binary', JSON.stringify(json));
  let raw = '';
  try { raw = execFileSync('curl.exe', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
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
    '--max-time', '3600', '--data-binary', '@' + file, '-w', '\n%{http_code}', url],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const cut = out.lastIndexOf('\n');
  let data = null;
  try { data = JSON.parse(out.slice(0, cut) || 'null'); } catch (e) { data = null; }
  return { status: Number(out.slice(cut + 1).trim()) || 0, data: data };
}

/* The relay in front of github.com drops long connections now and then, so an
 * upload is retried and, once it lands, checked against the local byte count.
 * A same-name asset of the wrong size is removed first: the directory page
 * serves whatever is attached, and a half file would be offered to users. */
function uploadVerified(base, name, file, mime) {
  const size = statSync(file).size;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const up = upload(base + encodeURIComponent(name), file, mime);
    const got = up.data && up.data.size;
    if (up.status >= 200 && up.status < 300 && got === size) {
      return { ok: true, id: up.data.id, size: got, attempt: attempt };
    }
    console.log('   attempt ' + attempt + ' ' + name + ' -> HTTP ' + up.status + ' size=' + got + ' (want ' + size + ')');
    if (up.data && up.data.id) api('DELETE', '/repos/' + OWNER + '/' + REPO + '/releases/assets/' + up.data.id);
  }
  return { ok: false, size: size };
}

const rel = api('GET', '/repos/' + OWNER + '/' + REPO + '/releases/tags/' + TAG);
if (!rel.data) throw new Error('catalog release not found');
const releaseId = rel.data.id;
const byName = new Map(rel.data.assets.map(function (a) { return [a.name, a]; }));
console.log('release ' + TAG + ' id=' + releaseId + ' assets=' + rel.data.assets.length);

const base = 'https://uploads.github.com/repos/' + OWNER + '/' + REPO + '/releases/' + releaseId + '/assets?name=';
let failed = 0;
for (const name of UPLOAD) {
  const file = DIR + '/' + name;
  const size = statSync(file).size;
  const have = byName.get(name);
  if (have && have.size === size) { console.log('   keep existing ' + name + ' ' + have.size + 'B'); continue; }
  if (have) {
    const del = api('DELETE', '/repos/' + OWNER + '/' + REPO + '/releases/assets/' + have.id);
    console.log('   delete stale ' + name + ' (' + have.size + 'B) -> HTTP ' + del.status);
  }
  const up = uploadVerified(base, name, file, 'application/octet-stream');
  if (up.ok) console.log('   upload ' + name + ' ' + up.size + 'B -> id=' + up.id);
  else { failed++; console.log('   FAILED ' + name + ' after retries'); }
}

/* name.txt: delete then re-upload so the page never references a missing asset */
const oldName = byName.get('name.txt');
if (oldName) {
  const del = api('DELETE', '/repos/' + OWNER + '/' + REPO + '/releases/assets/' + oldName.id);
  console.log('   delete old name.txt -> HTTP ' + del.status);
}
const txt = uploadVerified(base, 'name.txt', DIR + '/name.txt', 'text/plain');
console.log('   upload name.txt ' + statSync(DIR + '/name.txt').size + 'B -> ' + (txt.ok ? 'ok id=' + txt.id : 'FAILED'));

for (const name of DROP) {
  const a = byName.get(name);
  if (!a) { console.log('   absent ' + name); continue; }
  const del = api('DELETE', '/repos/' + OWNER + '/' + REPO + '/releases/assets/' + a.id);
  console.log('   delete ' + name + ' -> HTTP ' + del.status);
}

const after = api('GET', '/repos/' + OWNER + '/' + REPO + '/releases/tags/' + TAG);
console.log('\nFINAL assets=' + after.data.assets.length);
for (const a of after.data.assets) console.log('   ' + a.name + ' ' + a.size + 'B');
console.log('\nfailed=' + failed);