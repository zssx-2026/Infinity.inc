/*
 * backup-publish.mjs - archive the project and put it in the backup repository.
 *
 * Two different things are kept on GitHub, and they are kept separately on
 * purpose:
 *
 *   the source repositories hold the source, and nothing else
 *   the release assets hold everything built from it
 *   this repository holds an archive of the whole working tree, so a machine
 *     that is lost can be rebuilt from one download
 *
 * The archive is a single 7z at maximum compression. It carries the source,
 * the work log, the conversation log and the raw session history - the things
 * that exist nowhere else - and deliberately leaves out anything that is
 * either reproducible (build output) or enormous (Electron runtimes).
 *
 * The backup repository is private, so this is the one place the full record
 * can live without becoming public.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import https from 'node:https';
import { execFileSync } from 'node:child_process';

const NL = String.fromCharCode(10);
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const DIR = path.resolve(HERE, '..');
const STAGE = path.join(DIR, 'work', 'archive-stage');

const OWNER = 'zssx-2026';
const REPO = 'backup';
const TAG = process.argv[2] || 'infinity-v1.0pre2';
const TOKEN = process.env.EV_GH_TOKEN || '';
const SEVEN = 'D:/temp/tools/7za.exe';

/* Never archived: reproducible, enormous, or simply not ours to copy. */
const EXCLUDE_DIRS = [
  'build', 'out', 'setup-stage', 'release-files', 'node_modules', '.git',
  'temp', 'dist', 'InfinityPackageManager - 副本', 'usertest', 'archive-stage'
];
const EXCLUDE_EXT = ['.exe', '.msi', '.blob', '.zip', '.7z', '.arc', '.dll', '.node', '.log'];

function log(m) { process.stdout.write(m + NL); }
function scrub(s) { return String(s).split(TOKEN).join('<token>'); }

function api(method, p, body) {
  return new Promise(function (resolve) {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      'user-agent': 'infinity-inc', 'authorization': 'Bearer ' + TOKEN,
      'accept': 'application/vnd.github+json', 'content-type': 'application/json'
    };
    if (data) headers['content-length'] = Buffer.byteLength(data);
    const r = https.request({ host: 'api.github.com', path: p, method: method, headers: headers, timeout: 120000 }, function (x) {
      let b = ''; x.on('data', function (d) { b += d; });
      x.on('end', function () { let j = null; try { j = JSON.parse(b); } catch (e) { } resolve({ status: x.statusCode, data: j }); });
    });
    r.on('error', function (e) { resolve({ status: 0, error: e.code || e.message }); });
    r.on('timeout', function () { r.destroy(); resolve({ status: 0, error: 'timeout' }); });
    if (data) r.write(data);
    r.end();
  });
}

function wanted(rel) {
  const parts = rel.split('/');
  for (const p of parts) if (EXCLUDE_DIRS.indexOf(p) >= 0) return false;
  const ext = path.extname(rel).toLowerCase();
  if (EXCLUDE_EXT.indexOf(ext) >= 0) return false;
  return true;
}

/* Copy the tree that should survive, flattening nothing: the archive has the
 * same shape as the project so it can be unpacked straight over it. */
function stage() {
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });
  let n = 0;
  let bytes = 0;
  const walk = function (dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const r = rel ? rel + '/' + e.name : e.name;
      if (!wanted(r)) continue;
      if (e.isDirectory()) { fs.mkdirSync(path.join(STAGE, r), { recursive: true }); walk(full, r); continue; }
      if (!e.isFile()) continue;
      fs.copyFileSync(full, path.join(STAGE, r));
      n++;
      bytes += fs.statSync(full).size;
    }
  };
  walk(DIR, '');
  log('staged ' + n + ' files, ' + (bytes / 1048576).toFixed(1) + ' MiB');
  return n;
}

function archive() {
  const out = path.join(DIR, 'work', 'Infinity.Inc_' + TAG + '.7z');
  try { fs.rmSync(out, { force: true }); } catch (e) { }
  log('compressing at the highest level');
  execFileSync(SEVEN, ['a', '-t7z', '-mx=9', '-m0=lzma2', '-md=256m', '-ms=on', '-mmt=10', out, STAGE + '/*'],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  const size = fs.statSync(out).size;
  log('archive ' + out + '  ' + (size / 1048576).toFixed(1) + ' MiB');
  return { file: out, size: size };
}

async function ensureRelease(tag) {
  const g = await api('GET', '/repos/' + OWNER + '/' + REPO + '/releases/tags/' + tag);
  if (g.status === 200 && g.data && g.data.id) return g.data;
  const c = await api('POST', '/repos/' + OWNER + '/' + REPO + '/releases', {
    tag_name: tag, name: 'Infinity.Inc backup ' + tag, draft: false, prerelease: true,
    body: 'Full working-tree archive of Infinity.Inc ' + tag + ' (source, work log, conversation log, session history).'
  });
  if (c.status !== 201) throw new Error('cannot create the release: ' + c.status + ' ' + scrub(c.error || ''));
  return c.data;
}

function upload(releaseId, file, assetName) {
  const out = execFileSync('curl', [
    '-sS', '--ssl-no-revoke', '-X', 'POST',
    '-H', 'Authorization: Bearer ' + TOKEN,
    '-H', 'Content-Type: application/octet-stream',
    '--data-binary', '@' + file,
    'https://uploads.github.com/repos/' + OWNER + '/' + REPO + '/releases/' + releaseId + '/assets?name=' + encodeURIComponent(assetName)
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 });
  const j = JSON.parse(out);
  return { state: j.state, size: j.size, url: j.browser_download_url };
}

async function main() {
  if (!TOKEN) { log('NO TOKEN'); process.exit(1); }
  if (!fs.existsSync(SEVEN)) throw new Error('7za is missing: ' + SEVEN);

  stage();
  const arc = archive();
  const rel = await ensureRelease(TAG);

  const name = 'Infinity.Inc_' + TAG + '_worktree.7z';
  const existing = (rel.assets || []).find(function (a) { return a.name === name; });
  if (existing) {
    if (existing.size === arc.size) { log('already current: ' + name); return; }
    await api('DELETE', '/repos/' + OWNER + '/' + REPO + '/releases/assets/' + existing.id);
    log('replaced ' + name + ' (' + existing.size + ' -> ' + arc.size + ' B)');
  }
  const up = upload(rel.id, arc.file, name);
  log('uploaded ' + name + '  ' + up.state + '  ' + up.size + ' B');
  log('done');
}

main().catch(function (e) { console.error(scrub(String(e && e.message ? e.message : e))); process.exit(1); });
