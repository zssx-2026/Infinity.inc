// work/mirror-gitee.mjs — mirror local trees to Gitee through the contents API.
// Gitee has no git/blobs endpoint, so every file is one contents commit; the
// script is idempotent (it reads the remote sha first) and resumable (state file).
//
// usage: node work/mirror-gitee.mjs --site [--dry-run]
//        node work/mirror-gitee.mjs --dist [--dry-run]
//        node work/mirror-gitee.mjs --tree <dir> --repo <owner/name> --prefix <p> [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const TOKEN = process.env['gitee_zssx-1'];
const API = 'https://gitee.com/api/v5';
const OWNER = 'zssx2026';
const DRY = process.argv.includes('--dry-run');
const STATE = 'work/gitee-mirror-state.json';
if (!TOKEN) { console.error('NO GITEE TOKEN'); process.exit(1); }

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : dflt; };
let tree = null, repo = null, prefix = '';
if (process.argv.includes('--site')) { tree = 'web'; repo = OWNER + '/zssx-2026.github.io'; prefix = ''; }
else if (process.argv.includes('--dist')) { tree = 'dist'; repo = OWNER + '/applications'; prefix = ''; }
else { tree = arg('--tree'); repo = arg('--repo'); prefix = arg('--prefix', ''); }
if (!tree || !repo) { console.error('usage: --site | --dist | --tree <dir> --repo <owner/name> [--prefix p] [--dry-run]'); process.exit(2); }

let BRANCH = 'master';
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
state[repo] = state[repo] || { done: {}, bytes: 0 };
const S = state[repo];
const save = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 1));

async function api(method, p, body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(API + p + (p.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(TOKEN), {
      method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 || res.status >= 500) { await new Promise(r => setTimeout(r, 800 * (attempt + 1))); continue; }
    const t = await res.text(); let b; try { b = JSON.parse(t); } catch { b = t.slice(0, 120); }
    return { status: res.status, body: b };
  }
  return { status: 0, body: 'retries exhausted' };
}

function walk(dir, out = [], base = dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out, base);
    else out.push(full);
  }
  return out;
}
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const ensureRepo = async () => {
  const name = repo.split('/')[1];
  const got = await api('GET', '/repos/' + repo);
  if (got.status === 200) return 'exists';
  const made = await api('POST', '/user/repos', { name, description: 'Infinity.Inc mirror', private: false, auto_init: true });
  return made.status === 201 ? 'created' : 'FAILED ' + made.status + ' ' + JSON.stringify(made.body).slice(0, 140);
};

const main = async () => {
  console.log('repo=' + repo + ' tree=' + tree + ' prefix=' + prefix + ' dry=' + DRY);
  const status = DRY ? 'dry-run' : await ensureRepo();
  console.log('repo status: ' + status);
  if (!DRY) {
    const info = await api('GET', '/repos/' + repo);
    if (info.status === 200 && info.body.default_branch) BRANCH = info.body.default_branch;
    console.log('default branch: ' + BRANCH);
  }
  if (String(status).startsWith('FAILED')) process.exit(3);
  const files = walk(tree).filter(f => !/node_modules|[\\/]\.git[\\/]/.test(f));
  console.log('files to consider: ' + files.length);
  let pushed = 0, skipped = 0, failed = 0, bytes = 0;
  for (const f of files) {
    const rel = (prefix ? prefix.replace(/\/+$/, '') + '/' : '') + path.relative(tree, f).split(path.sep).join('/');
    const buf = fs.readFileSync(f);
    const digest = sha(buf);
    if (S.done[rel] === digest) { skipped++; continue; }
    if (DRY) { console.log('  would push ' + rel + '  ' + buf.length); pushed++; bytes += buf.length; continue; }
    const remote = await api('GET', '/repos/' + repo + '/contents/' + encodeURIComponent(rel));
    const remoteSha = remote.status === 200 && remote.body && remote.body.sha ? remote.body.sha : null;
    const r = await api('POST', '/repos/' + repo + '/contents/' + encodeURIComponent(rel), {
      content: buf.toString('base64'), message: 'mirror: ' + rel, branch: BRANCH,
    });
    if (r.status === 201 || r.status === 200) {
      pushed++; bytes += buf.length; S.done[rel] = digest; S.bytes += buf.length;
      if (pushed % 10 === 0) { save(); console.log('  pushed ' + pushed + ' (' + rel + ')'); }
    } else {
      failed++; console.log('  FAIL ' + rel + ' -> ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 120));
    }
    await new Promise(r2 => setTimeout(r2, 120));
  }
  save();
  console.log('--- pushed=' + pushed + ' skipped=' + skipped + ' failed=' + failed + ' bytes=' + bytes + ' ---');
};
main();
