/*
 * publish-site.mjs - put the website on GitHub Pages.
 *
 * The site is the `infinity/` directory of zssx-2026.github.io, which is a
 * repository of its own. It is written here, under web/infinity, and pushed
 * there, because keeping the site next to the code it documents is the only
 * way the two stay in step.
 *
 * The push goes through the Git Data API rather than git. On this machine
 * `git push` to github.com fails - the git endpoint answers 502 while the API
 * answers normally - and the API also lets the commit be built from a
 * `base_tree`, so the rest of the Pages repository is carried over untouched
 * instead of being replaced by whatever happens to be in this directory.
 *
 * Nothing here prints the token.
 *
 * Usage:  NODE_OPTIONS= node work/publish-site.mjs [--dry-run]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WEB = path.join(ROOT, 'web');
const OWNER = 'zssx-2026';
const REPO = 'zssx-2026.github.io';
const PREFIX = 'infinity';

const TOKEN = process.env.EV_GH_TOKEN || '';
const DRY = process.argv.indexOf('--dry-run') >= 0;

if (!TOKEN) { console.error('NO TOKEN'); process.exit(1); }

/* curl rather than a hand-assembled body: GitHub counts the bytes itself, and
 * a body built in JavaScript has produced a wrong Content-Length here before.
 * stdio has to be stated or every spawn fails with EBUSY.
 *
 * The body goes in a file rather than on the command line. Windows caps a
 * command line at 32767 characters and the base64 of even one page is longer,
 * so passing it as an argument fails with ENAMETOOLONG - which is a confusing
 * error for what is simply "too big to shout". */
const BODY = path.join(os.tmpdir(), 'infinity-site-body.json');

function curl(args) {
  return execFileSync('curl.exe', ['-sS', '--ssl-no-revoke', '--max-time', '600'].concat(args),
    { maxBuffer: 256 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function api(method, route, body) {
  const args = ['-X', method,
    '-H', 'Authorization: Bearer ' + TOKEN,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'User-Agent: Infinity.Inc-site',
    '-H', 'X-GitHub-Api-Version: 2022-11-28',
    'https://api.github.com' + route];
  if (body !== undefined) {
    fs.writeFileSync(BODY, JSON.stringify(body));
    args.push('-H', 'Content-Type: application/json', '--data-binary', '@' + BODY);
  }
  let raw = '';
  try { raw = curl(args); } catch (e) { raw = String(e.stdout || '') || String(e.message || ''); }
  try { return { ok: true, data: JSON.parse(raw) }; }
  catch (err) { return { ok: false, raw: raw.slice(0, 400) }; }
}

/*
 * What goes where.
 *
 * Two things are published, and the difference matters.
 *
 *   web/index.html     ->  index.html        the root of the Pages site
 *   web/404.html       ->  404.html          the Pages 404 handler
 *   web/infinity/**    ->  infinity/**       the suite's own pages
 *
 * The root page is written deliberately, not left to whatever the repository
 * happened to hold: zssx-2026.github.io/ is the address people arrive at, and
 * it should say what this is rather than show a directory listing. Pushing it
 * overwrites the file that was there.
 */
function collect(dir, prefix, into, base) {
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const rel = base ? base + '/' + name : name;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) collect(full, prefix, into, rel);
    else into.push({ file: full, path: (prefix ? prefix + '/' : '') + rel, size: stat.size });
  }
  return into;
}

const files = [];
collect(path.join(WEB, 'infinity'), PREFIX, files, '');
files.push({
  file: path.join(WEB, 'index.html'),
  path: 'index.html',
  size: fs.statSync(path.join(WEB, 'index.html')).size
});
/* The 404 handler has to sit at the repository root: a user Pages site only
 * honours /404.html from there. web/infinity/404.html is published too, so
 * the copy under the suite keeps working for local previews. */
files.push({
  file: path.join(WEB, '404.html'),
  path: '404.html',
  size: fs.statSync(path.join(WEB, '404.html')).size
});
console.log('site files: ' + files.length);
for (const f of files) console.log('  ' + f.path.padEnd(48) + f.size + ' B');

if (DRY) { console.log('dry run; nothing pushed'); process.exit(0); }

/* ---------------------------------------------------------------- push */

const info = api('GET', '/repos/' + OWNER + '/' + REPO);
if (!info.ok || !info.data || !info.data.id) {
  console.error('cannot read the Pages repository: ' + JSON.stringify(info).slice(0, 300));
  process.exit(1);
}
const branch = info.data.default_branch || 'main';

const ref = api('GET', '/repos/' + OWNER + '/' + REPO + '/git/ref/heads/' + branch);
const parent = (ref.ok && ref.data && ref.data.object) ? ref.data.object.sha : null;
console.log('branch ' + branch + ' at ' + (parent ? parent.slice(0, 12) : '(no commits yet)'));

const tree = [];
for (const f of files) {
  const content = fs.readFileSync(f.file).toString('base64');
  const blob = api('POST', '/repos/' + OWNER + '/' + REPO + '/git/blobs', {
    content: content, encoding: 'base64'
  });
  if (!blob.ok || !blob.data || !blob.data.sha) {
    console.error('blob failed for ' + f.path + ': ' + JSON.stringify(blob).slice(0, 200));
    process.exit(1);
  }
  tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.data.sha });
}
console.log('uploaded ' + tree.length + ' blobs');

/* base_tree carries the rest of the Pages repository over unchanged. Without
 * it this commit would delete every other page on the site. */
const treeBody = { tree: tree };
if (parent) treeBody.base_tree = parent;

const made = api('POST', '/repos/' + OWNER + '/' + REPO + '/git/trees', treeBody);
if (!made.ok || !made.data || !made.data.sha) {
  console.error('tree failed: ' + JSON.stringify(made).slice(0, 300));
  process.exit(1);
}

const commit = api('POST', '/repos/' + OWNER + '/' + REPO + '/git/commits', {
  message: 'infinity: publish the site (' + tree.length + ' files)',
  tree: made.data.sha,
  parents: parent ? [parent] : []
});
if (!commit.ok || !commit.data || !commit.data.sha) {
  console.error('commit failed: ' + JSON.stringify(commit).slice(0, 300));
  process.exit(1);
}

const moved = parent
  ? api('PATCH', '/repos/' + OWNER + '/' + REPO + '/git/refs/heads/' + branch, {
      sha: commit.data.sha, force: true
    })
  : api('POST', '/repos/' + OWNER + '/' + REPO + '/git/refs', {
      ref: 'refs/heads/' + branch, sha: commit.data.sha
    });
if (!moved.ok || (moved.data && moved.data.status !== undefined && moved.data.status >= 400)) {
  console.error('ref update failed: ' + JSON.stringify(moved).slice(0, 300));
  process.exit(1);
}

console.log('pushed ' + commit.data.sha.slice(0, 12) + ' to ' + branch);
console.log('site: https://zssx-2026.github.io/' + PREFIX + '/');
console.log('(GitHub Pages needs a minute or two to rebuild after a push)');
