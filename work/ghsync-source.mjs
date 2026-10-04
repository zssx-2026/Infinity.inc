#!/usr/bin/env node
/*
 * ghsync-source.mjs - snapshot the working tree into zssx-2026/Infinity.inc
 * through the GitHub Git Data API only.
 *
 * There is no git push here. On this machine the git transport allocates
 * ~1.9 GB and dies with "Out of memory, malloc failed", so the snapshot is
 * written the way the API allows: one blob per changed file, one tree based on
 * the remote HEAD's tree, one commit, then the ref is moved.
 *
 *   node work/ghsync-source.mjs --plan    GET only: print what would change
 *   node work/ghsync-source.mjs --push    upload the changes (batches of <=300)
 *
 * Rules: the snapshot is the set of files git sees (tracked + untracked, minus
 * .gitignore), minus build output, scratch/private prefixes, stray sessions and
 * files above MAX_BYTES. Files the remote has and the local tree does not are
 * reported, never deleted - this script only adds and replaces.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const OWNER = 'zssx-2026';
const REPO = 'Infinity.inc';
const BRANCH = 'main';
const BATCH_FILES = 300;
const MAX_BYTES = 8 * 1024 * 1024;
const ROOT = process.cwd();
const ARGV = process.argv.slice(2);
const PUSH = ARGV.includes('--push');
const CURL = process.platform === 'win32' ? 'curl.exe' : 'curl';

const TOKEN = process.env.EV_GH_TOKEN || '';
if (!TOKEN) {
  console.error('EV_GH_TOKEN is not set. Set it for this command only; never echo it.');
  process.exit(1);
}
function scrub(s) { return String(s).split(TOKEN).join('<token>'); }

/* Directory names that are build output or vendored runtimes, never snapshot. */
const SEG_SKIP = ['node_modules', 'build', '_build', 'out', 'bench', '_bench', 'tmp', 'CMakeFiles', 'dist', 'target'];
/* Scratch and private trees; the last two are the ghsync list plus this run's findings. */
const PREFIX_SKIP = [
  'work/restore-sample/', 'work/session-history/', 'work/chromium-trim/', 'work/_pubcheck/',
  'work/_account-shots/', 'work/_token-shots/', 'work/_dl-shots/', 'work/_verify-shots/',
  'work/_pubtmp/', 'work/_ghstate/', 'work/_ipm2/', 'work/archive/', 'work/webview2/',
  'work/screenshots/', 'work/edge-ui/', 'work/itbt/', 'workitbt_sandbox/', 'Chormium/',
  'IPM Applications/', 'ITB Tools/'
];
const FILE_SKIP = ['work/_restorecheck-summary.json', 'work/history-manifest.json'];

function skipReason(rel) {
  const p = rel.split('\\').join('/');
  for (const s of p.split('/')) if (SEG_SKIP.includes(s)) return 'artifact:' + s;
  for (const pre of PREFIX_SKIP) if (p.startsWith(pre)) return 'scratch:' + pre;
  if (FILE_SKIP.includes(p)) return 'ghsync-skip:' + p;
  if (/(^|\/)session\.v4\.jsonl$/.test(p)) return 'session-transcript';
  return null;
}

function gitFileList() {
  const out = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const other = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const seen = new Set();
  for (const chunk of [out, other]) for (const p of chunk.split('\0')) if (p) seen.add(p);
  return [...seen].sort();
}

function blobSha(buf) {
  const h = crypto.createHash('sha1');
  h.update('blob ' + buf.length + '\0');
  h.update(buf);
  return h.digest('hex');
}

function collect() {
  const files = [];
  const skipped = {};
  for (const rel of gitFileList()) {
    const p = rel.split('\\').join('/');
    const why = skipReason(p);
    if (why) { skipped[why] = (skipped[why] || 0) + 1; continue; }
    let st;
    try { st = fs.statSync(path.join(ROOT, p)); } catch { continue; }
    if (!st.isFile()) continue;
    if (st.size > MAX_BYTES) { skipped['oversize:' + p] = st.size; continue; }
    files.push({ rel: p, size: st.size });
  }
  for (const f of files) f.sha = blobSha(fs.readFileSync(path.join(ROOT, f.rel)));
  return { files, skipped };
}

function api(method, route, body, tries = 3) {
  const args = ['-sS', '--ssl-no-revoke', '--max-time', '120', '-X', method,
    '-H', 'Authorization: Bearer ' + TOKEN,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'User-Agent: Infinity.Inc',
    '-w', '\n%{http_code}',
    'https://api.github.com' + route];
  const opts = { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 };
  if (body !== undefined) { args.splice(args.length - 1, 0, '--data-binary', '@-', '-H', 'Content-Type: application/json'); opts.input = JSON.stringify(body); }
  let last = { status: 0, data: null, error: 'not attempted' };
  for (let i = 1; i <= tries; i++) {
    try {
      const out = execFileSync(CURL, args, opts);
      const cut = out.lastIndexOf('\n');
      const status = parseInt(out.slice(cut + 1).trim(), 10);
      const text = out.slice(0, cut);
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      last = { status, data, error: status >= 200 && status < 300 ? null : scrub(text.slice(0, 300)) };
      if (!last.error || status === 404 || status === 409) return last;
    } catch (e) {
      last = { status: 0, data: null, error: scrub(String((e.stderr || '') + (e.message || '')).slice(0, 300)) };
    }
    if (i < tries) execFileSync(process.platform === 'win32' ? 'powershell' : 'sleep',
      process.platform === 'win32' ? ['-NoProfile', '-Command', 'Start-Sleep -Seconds ' + (2 * i)] : [String(2 * i)], { stdio: 'ignore' });
  }
  return last;
}

function stats(files, skipped) {
  const byTop = {};
  let bytes = 0;
  for (const f of files) {
    const top = f.rel.split('/')[0];
    byTop[top] = byTop[top] || { files: 0, bytes: 0 };
    byTop[top].files++;
    byTop[top].bytes += f.size;
    bytes += f.size;
  }
  const totalSkipped = Object.entries(skipped).reduce((s, [k, v]) => s + (k.startsWith('oversize:') ? 1 : v), 0);
  return { count: files.length, bytes, byTop, skipped, totalSkipped };
}

function iso() { return new Date().toISOString().replace(/\.\d+Z$/, 'Z'); }

async function main() {
  const t0 = Date.now();
  const { files, skipped } = collect();
  const s = stats(files, skipped);

  const ref = api('GET', '/repos/' + OWNER + '/' + REPO + '/git/ref/heads/' + BRANCH);
  if (ref.status !== 200) { console.error('cannot read ref: ' + ref.status + ' ' + ref.error); process.exit(2); }
  const oldHead = ref.data.object.sha;
  const baseCommit = api('GET', '/repos/' + OWNER + '/' + REPO + '/git/commits/' + oldHead);
  const baseTree = baseCommit.data.tree.sha;
  const base = api('GET', '/repos/' + OWNER + '/' + REPO + '/git/trees/' + baseTree + '?recursive=1');
  const remote = {};
  for (const e of (base.data.tree || [])) if (e.type === 'blob') remote[e.path] = e.sha;

  const changed = files.filter((f) => remote[f.rel] !== f.sha);
  const unchanged = files.length - changed.length;
  const localSet = new Set(files.map((f) => f.rel));
  const removed = Object.keys(remote).filter((p) => !localSet.has(p) && !skipReason(p));

  console.log('SNAPSHOT files=' + s.count + ' bytes=' + s.bytes + ' (' + (s.bytes / 1048576).toFixed(1) + ' MiB)');
  console.log('EXCLUDED paths=' + s.totalSkipped);
  for (const [k, v] of Object.entries(skipped).sort((a, b) => b[1] - a[1])) console.log('   ' + k + ' -> ' + v);
  console.log('COMPOSITION');
  for (const [k, v] of Object.entries(s.byTop).sort((a, b) => b[1].bytes - a[1].bytes)) console.log('   ' + k + ' files=' + v.files + ' bytes=' + v.bytes);
  console.log('REMOTE old_head=' + oldHead + ' tree=' + baseTree + ' blobs=' + Object.keys(remote).length + ' truncated=' + base.data.truncated);
  console.log('DELTA changed=' + changed.length + ' unchanged=' + unchanged + ' remove_candidates=' + removed.length);
  if (ARGV.includes('--list')) for (const f of changed) console.log('   changed ' + f.rel + ' (' + f.size + ' B)');
  for (const p of removed) console.log('   would-not-delete ' + p);

  if (!PUSH) { console.log('PLAN ONLY (no writes). elapsed_ms=' + (Date.now() - t0)); return; }
  if (!changed.length) { console.log('nothing to push'); return; }

  const stamp = iso();
  const batches = [];
  let curTree = baseTree;
  let curCommit = oldHead;
  const chunks = [];
  for (let i = 0; i < changed.length; i += BATCH_FILES) chunks.push(changed.slice(i, i + BATCH_FILES));

  for (let bi = 0; bi < chunks.length; bi++) {
    const chunk = chunks[bi];
    const entries = [];
    for (const f of chunk) {
      const buf = fs.readFileSync(path.join(ROOT, f.rel));
      if (blobSha(buf) !== f.sha) { console.error('local file changed under us: ' + f.rel); process.exit(4); }
      const b = api('POST', '/repos/' + OWNER + '/' + REPO + '/git/blobs', { content: buf.toString('base64'), encoding: 'base64' });
      if (b.status !== 201 || !b.data || !b.data.sha) { console.error('blob failed for ' + f.rel + ': ' + b.status + ' ' + b.error); process.exit(5); }
      entries.push({ path: f.rel, mode: '100644', type: 'blob', sha: b.data.sha });
    }
    const t = api('POST', '/repos/' + OWNER + '/' + REPO + '/git/trees', { base_tree: curTree, tree: entries });
    if (t.status !== 201 || !t.data || !t.data.sha) { console.error('tree failed: ' + t.status + ' ' + t.error); process.exit(6); }
    const msg = 'worktree snapshot ' + stamp + ' [' + (bi + 1) + '/' + chunks.length + '] ' + chunk.length + ' file(s)';
    const c = api('POST', '/repos/' + OWNER + '/' + REPO + '/git/commits', { message: msg, tree: t.data.sha, parents: [curCommit] });
    if (c.status !== 201 || !c.data || !c.data.sha) { console.error('commit failed: ' + c.status + ' ' + c.error); process.exit(7); }
    const up = api('PATCH', '/repos/' + OWNER + '/' + REPO + '/git/refs/heads/' + BRANCH, { sha: c.data.sha, force: true });
    if (up.status !== 200 && up.status !== 201) { console.error('ref update failed: ' + up.status + ' ' + up.error); process.exit(8); }
    batches.push({ index: bi + 1, of: chunks.length, files: chunk.length, commit: c.data.sha, tree: t.data.sha, parent: curCommit, message: msg });
    console.log('BATCH ' + (bi + 1) + '/' + chunks.length + ' files=' + chunk.length + ' commit=' + c.data.sha + ' tree=' + t.data.sha);
    curTree = t.data.sha;
    curCommit = c.data.sha;
  }

  const verify = api('GET', '/repos/' + OWNER + '/' + REPO + '/git/trees/' + curTree + '?recursive=1');
  const vmap = {};
  for (const e of (verify.data.tree || [])) if (e.type === 'blob') vmap[e.path] = e.sha;
  const keys = ['README.md', 'docs/RELEASE-v1.0pre4.md', 'cpp/common/unblock.cpp', 'cpp/common/unblock.hpp',
    'cpp/apps/inc/main.cpp', 'cpp/apps/ifm/main.cpp', 'cpp/apps/ipm/main.cpp', 'cpp/apps/iim/main.cpp',
    'cpp/apps/int/main.cpp', 'cpp/apps/ing/main.cpp', 'work/ITBT-FORMAT.md', 'work/ghsync-source.mjs'];
  const keyCheck = keys.map((k) => {
    const local = files.find((f) => f.rel === k);
    return { path: k, remote: vmap[k] || null, local: local ? local.sha : null, match: !!local && vmap[k] === local.sha };
  });
  console.log('VERIFY remote_blobs=' + Object.keys(vmap).length + ' truncated=' + verify.data.truncated);
  for (const k of keyCheck) console.log('   ' + (k.match ? 'MATCH ' : 'MISMATCH ') + k.path + ' remote=' + (k.remote || '-') + ' local=' + (k.local || '-'));

  console.log('RESULT ' + JSON.stringify({ old_head: oldHead, new_head: curCommit, base_tree: baseTree, new_tree: curTree,
    snapshot_files: s.count, snapshot_bytes: s.bytes, changed: changed.length, unchanged, remove_candidates: removed.length,
    batches, verify_blobs: Object.keys(vmap).length, verify_truncated: !!verify.data.truncated, key_check: keyCheck,
    excluded_total: s.totalSkipped, excluded: skipped, composition: s.byTop, elapsed_ms: Date.now() - t0 }));
}

main().catch((e) => { console.error(scrub(e && e.stack ? e.stack : e)); process.exit(9); });
