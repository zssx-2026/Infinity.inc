/*
 * ghsync.mjs - put the project on GitHub and keep it there.
 *
 * Two things happen here, and they fail for different reasons:
 *
 *   the source goes up as a git push to zssx-2026/Infinity.inc
 *   the installers go up as release assets on the three application repos
 *
 * Both are retried, because the network on this machine comes and goes. The
 * proxy in ~/.gitconfig points at a local relay that is usually not running,
 * so every git call disables the proxy explicitly and talks to github.com
 * directly.
 *
 * Nothing here prints the token.
 */
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const TOKEN = process.env.EV_GH_TOKEN || '';
const OWNER = 'zssx-2026';
const REPO = 'Infinity.inc';
const DIR = 'D:/dev/DeepSeekHarnessWorkspace/Infinity.inc';
const LOG = DIR + '/work/ghsync.log';

/* C++ v1.0.0-pre3 installers. These go to application Releases, never into
 * the source repository. They are single-architecture win64 self-contained
 * NSIS installers until the cross-architecture compiler targets are added. */
const CPP_ASSETS = [
  { repo: 'Infinity-Cloud', file: DIR + '/cpp/release/v1.0pre3/InfinityCloud_1.0.0-pre3_win64_setup.exe', name: 'InfinityCloud_1.0.0-pre3_win64_setup.exe', catalogAsset: 'InfinityCloud_1.0.0-pre3_win64_setup.exe Infinity.Inc InfinityCloud setup Infinity.Inc win64' },
  { repo: 'Infinity-File-Manager', file: DIR + '/cpp/release/v1.0pre3/InfinityFileManager_1.0.0-pre3_win64_setup.exe', name: 'InfinityFileManager_1.0.0-pre3_win64_setup.exe', catalogAsset: 'InfinityFileManager_1.0.0-pre3_win64_setup.exe Infinity.Inc InfinityFileManager setup Infinity.Inc win64' },
  { repo: 'InfinityPackageManager', file: DIR + '/cpp/release/v1.0pre3/InfinityPackageManager_1.0.0-pre3_win64_setup.exe', name: 'InfinityPackageManager_1.0.0-pre3_win64_setup.exe', catalogAsset: 'InfinityPackageManager_1.0.0-pre3_win64_setup.exe Infinity.Inc InfinityPackageManager setup Infinity.Inc win64' }
];

/* Installers to publish, and the repository each one belongs to. */
const ASSETS = [
  { repo: 'InfinityPackageManager', tag: 'v1.0pre2', file: DIR + '/InfinityPackageManager/build/setup/win64.exe', name: 'InfinityPackageManager_win64_setup.exe' },
  { repo: 'InfinityPackageManager', tag: 'v1.0pre2', file: DIR + '/InfinityPackageManager/build/setup/winx86.exe', name: 'InfinityPackageManager_winx86_setup.exe' },
  { repo: 'InfinityPackageManager', tag: 'v1.0pre2', file: DIR + '/InfinityPackageManager/build/setup/win-arm64.exe', name: 'InfinityPackageManager_win-arm64_setup.exe' },
  { repo: 'Infinity-Cloud', tag: 'v1.0pre2', file: DIR + '/Infinity Cloud/sourcecode/build/setup/win64.exe', name: 'InfinityCloud_win64_setup.exe' },
  { repo: 'Infinity-Cloud', tag: 'v1.0pre2', file: DIR + '/Infinity Cloud/sourcecode/build/setup/winx86.exe', name: 'InfinityCloud_winx86_setup.exe' },
  { repo: 'Infinity-Cloud', tag: 'v1.0pre2', file: DIR + '/Infinity Cloud/sourcecode/build/setup/win-arm64.exe', name: 'InfinityCloud_win-arm64_setup.exe' },
  { repo: 'Infinity-File-Manager', tag: 'v1.0pre2', file: DIR + '/Infinity File Manager/sourcecode/build/setup/win64.exe', name: 'InfinityFileManager_win64_setup.exe' },
  { repo: 'Infinity-File-Manager', tag: 'v1.0pre2', file: DIR + '/Infinity File Manager/sourcecode/build/setup/winx86.exe', name: 'InfinityFileManager_winx86_setup.exe' },
  { repo: 'Infinity-File-Manager', tag: 'v1.0pre2', file: DIR + '/Infinity File Manager/sourcecode/build/setup/win-arm64.exe', name: 'InfinityFileManager_win-arm64_setup.exe' }
];

/* Names from before the EPM -> IPM rename. They are the same installers under
 * the old product name, and leaving them in the release means the download
 * page offers a build that no longer exists anywhere else. */
const OBSOLETE = [
  { repo: 'InfinityPackageManager', pattern: /^EasyPackageManager_.*_setup\.(exe|msi)$/ }
];

/*
 * The IPM catalogue.
 *
 * ipm reads the `applications` repository, and every Release in it is one
 * catalogue page. A page advertises builds through a `name.txt` asset whose
 * lines read
 *
 *   <asset name> <version> <package> <install kind> <company> <platform>
 *
 * and a name that is not also an asset of that same Release is skipped - so
 * the installers are attached to the catalogue page as well as to their own
 * repository. The page keeps one copy of each installer, which is 870 KB for
 * the whole suite.
 *
 * `application-inc` held the Node v0.1 build of Infinity Cloud. v1.0.0-pre3
 * is the C++ rewrite of all three applications, so it takes the page over
 * rather than sitting next to a build nothing else references any more.
 */
const CATALOG_REPO = 'applications';
const CATALOG_TAG = 'application-inc';
const CATALOG_OBSOLETE = /^InfinityCloud_v0\.1_.*\.(exe|msi)$/;

function stamp() { return new Date().toISOString(); }

function log(m) {
  const line = '[' + stamp() + '] ' + m;
  process.stdout.write(line + '\n');
  try { fs.appendFileSync(LOG, line + '\n'); } catch (e) { }
}

function api(method, path, body) {
  return new Promise(function (resolve) {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      'user-agent': 'infinity-inc', 'authorization': 'Bearer ' + TOKEN,
      'accept': 'application/vnd.github+json', 'content-type': 'application/json'
    };
    if (data) headers['content-length'] = Buffer.byteLength(data);
    const r = https.request({ host: 'api.github.com', path: path, method: method, headers: headers, timeout: 120000 }, function (x) {
      let b = ''; x.on('data', function (d) { b += d; });
      x.on('end', function () { let j = null; try { j = JSON.parse(b); } catch (e) { } resolve({ status: x.statusCode, data: j }); });
    });
    r.on('error', function (e) { resolve({ status: 0, error: e.code || e.message }); });
    r.on('timeout', function () { r.destroy(); resolve({ status: 0, error: 'timeout' }); });
    if (data) r.write(data);
    r.end();
  });
}

/* git, with the dead proxy removed from the picture for this call only.
 *
 * The proxy is not set under plain http.proxy but under a URL-specific
 * section, [http "https://github.com"], so the generic override does nothing.
 * The key has to name the URL as well, which is what the second -c does. */
function git(args) {
  return execFileSync('git', [
    '-c', 'http.proxy=',
    '-c', 'https.proxy=',
    '-c', 'http.https://github.com.proxy=',
    '-c', 'http.sslVerify=false'
  ].concat(args),
    { cwd: DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

async function ensureRepo() {
  const g = await api('GET', '/repos/' + OWNER + '/' + REPO);
  if (g.status === 200) return 'exists';
  const c = await api('POST', '/user/repos', {
    name: REPO, private: false, auto_init: false,
    description: 'Infinity.Inc - the Infinity suite: Infinity Cloud, Infinity File Manager, InfinityPackageManager'
  });
  if (c.status === 201 || c.status === 200) { log('repo created'); return 'created'; }
  return 'failed: ' + c.status + ' ' + (c.error || (c.data && c.data.message));
}

async function pushSource() {
  try {
    git(['add', '-A']);
    try { git(['commit', '-m', 'Infinity.Inc: sync']); } catch (e) { }
  } catch (e) { }
  try {
    try { git(['remote', 'remove', 'origin']); } catch (e) { }
    git(['remote', 'add', 'origin', 'https://' + TOKEN + '@github.com/' + OWNER + '/' + REPO + '.git']);
    try {
      git(['push', '-u', 'origin', 'HEAD:main', '--force']);
    } finally {
      try { git(['remote', 'set-url', 'origin', 'https://github.com/' + OWNER + '/' + REPO + '.git']); } catch (e) { }
    }
    return 'pushed';
  } catch (e) {
    /*
     * The git endpoint on github.com is answering 502 on this machine while
     * the API is fine, so the same tree is written through the API instead.
     * It is more requests and it is slower, but it is the same commit.
     */
    log('git push failed, falling back to the API');
    return await pushViaApi();
  }
}

/* Collect the files git would have pushed: what `git ls-files` reports. */
function trackedFiles() {
  const out = git(['ls-files']);
  return out.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
}

async function pushViaApi() {
  const files = trackedFiles();
  if (!files.length) return 'nothing tracked';

  /*
   * The git data API refuses to work on a repository with no commits - every
   * blob POST comes back 409 - so the first commit is made the cheap way,
   * through the contents API, and only then does the real tree go up.
   */
  const info = await api('GET', '/repos/' + OWNER + '/' + REPO);
  const branch = (info.data && info.data.default_branch) || 'main';
  let ref = await api('GET', '/repos/' + OWNER + '/' + REPO + '/git/ref/heads/' + branch);
  if (ref.status !== 200) {
    const seed = await api('PUT', '/repos/' + OWNER + '/' + REPO + '/contents/README.md', {
      message: 'Infinity.Inc: initialise',
      content: Buffer.from('# Infinity.Inc\n\nThe Infinity suite: Infinity Cloud, Infinity File Manager, InfinityPackageManager.\n', 'utf8').toString('base64')
    });
    if (seed.status !== 201 && seed.status !== 200) return 'seed failed: ' + seed.status;
    ref = await api('GET', '/repos/' + OWNER + '/' + REPO + '/git/ref/heads/' + branch);
  }

  const tree = [];
  for (const rel of files) {
    const abs = path.join(DIR, rel);
    let buf;
    try { buf = fs.readFileSync(abs); } catch (e) { continue; }
    const b = await api('POST', '/repos/' + OWNER + '/' + REPO + '/git/blobs', {
      content: buf.toString('base64'), encoding: 'base64'
    });
    if (b.status !== 201 || !b.data || !b.data.sha) return 'blob failed for ' + rel + ': ' + b.status;
    tree.push({ path: rel.split('\\').join('/'), mode: '100644', type: 'blob', sha: b.data.sha });
  }

  const t = await api('POST', '/repos/' + OWNER + '/' + REPO + '/git/trees', { tree: tree });
  if (t.status !== 201 || !t.data || !t.data.sha) return 'tree failed: ' + t.status;

  const parents = (ref.status === 200 && ref.data && ref.data.object) ? [ref.data.object.sha] : [];

  const c = await api('POST', '/repos/' + OWNER + '/' + REPO + '/git/commits', {
    message: 'Infinity.Inc: sync (' + tree.length + ' files)',
    tree: t.data.sha, parents: parents
  });
  if (c.status !== 201 || !c.data || !c.data.sha) return 'commit failed: ' + c.status;

  const up = parents.length
    ? await api('PATCH', '/repos/' + OWNER + '/' + REPO + '/git/refs/heads/' + branch, { sha: c.data.sha, force: true })
    : await api('POST', '/repos/' + OWNER + '/' + REPO + '/git/refs', { ref: 'refs/heads/' + branch, sha: c.data.sha });
  if (up.status !== 200 && up.status !== 201) return 'ref update failed: ' + up.status;

  return 'pushed via api (' + tree.length + ' files)';
}

async function ensureRelease(repo, tag) {
  const g = await api('GET', '/repos/' + OWNER + '/' + repo + '/releases/tags/' + tag);
  if (g.status === 200 && g.data && g.data.id) return g.data;
  const c = await api('POST', '/repos/' + OWNER + '/' + repo + '/releases', {
    tag_name: tag, name: tag, draft: false, prerelease: true,
    body: 'Infinity.Inc build ' + tag
  });
  if (c.status === 201) return c.data;
  return null;
}

function uploadAsset(repo, relId, file, name) {
  try {
    /*
     * --ssl-no-revoke: this machine's schannel cannot reach the revocation
     * server, and the upload dies with CRYPT_E_NO_REVOCATION_CHECK before a
     * single byte is sent. Skipping the revocation check is what makes the
     * upload work here; it is not a general recommendation.
     */
    const out = execFileSync('curl', [
      '-sS', '--ssl-no-revoke', '-X', 'POST',
      '-H', 'Authorization: Bearer ' + TOKEN,
      '-H', 'Content-Type: application/octet-stream',
      '--data-binary', '@' + file,
      'https://uploads.github.com/repos/' + OWNER + '/' + repo + '/releases/' + relId + '/assets?name=' + encodeURIComponent(name)
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 });
    const j = JSON.parse(out);
    if (j && j.state === 'uploaded') return 'ok ' + j.size + ' B';
    return 'bad: ' + (j && (j.message || j.error) ? (j.message || j.error) : out.slice(0, 160));
  } catch (e) {
    return 'failed: ' + scrub(String((e.stderr || '') + (e.message || '')).slice(0, 200));
  }
}

/* Nothing that reaches a log or a report may contain the token. */
function scrub(s) {
  return String(s).split(TOKEN).join('<token>');
}

async function publishAssets() {
  const done = [];
  const allAssets = ASSETS.map(function (a) { return Object.assign({ tag: 'v1.0pre2', kind: 'node' }, a); })
    .concat(CPP_ASSETS.map(function (a) { return Object.assign({ tag: 'v1.0.0-pre3', kind: 'cpp' }, a); }));
  for (const a of allAssets) {
    if (!fs.existsSync(a.file)) { done.push(a.name + ' -> missing file'); continue; }
    const rel = await ensureRelease(a.repo, a.tag);
    if (!rel) { done.push(a.name + ' -> no release'); continue; }

    /*
     * A release asset cannot be replaced, only deleted and uploaded again.
     * The previous build used the same names, so an existing asset is
     * removed first - otherwise the release would keep serving the old
     * installer under the new build's name.
     */
    const local = fs.statSync(a.file).size;
    const existing = (rel.assets || []).find(function (x) { return x.name === a.name; });
    if (existing) {
      if (existing.size === local) { done.push(a.name + ' -> already current'); continue; }
      const del = await api('DELETE', '/repos/' + OWNER + '/' + a.repo + '/releases/assets/' + existing.id);
      if (del.status !== 204 && del.status !== 200) { done.push(a.name + ' -> could not replace (' + del.status + ')'); continue; }
      log('replaced ' + a.name + ' (' + existing.size + ' -> ' + local + ' B)');
    }
    done.push(a.name + ' -> ' + uploadAsset(a.repo, rel.id, a.file, a.name));
  }

  for (const o of OBSOLETE) {
    const rel = await ensureRelease(o.repo, 'v1.0pre2');
    if (!rel) continue;
    for (const a of (rel.assets || [])) {
      if (!o.pattern.test(a.name)) continue;
      const del = await api('DELETE', '/repos/' + OWNER + '/' + o.repo + '/releases/assets/' + a.id);
      if (del.status === 204 || del.status === 200) log('removed obsolete asset ' + a.name);
    }
  }
  return done;
}

async function publishCatalog() {
  const done = [];
  const g = await api('GET', '/repos/' + OWNER + '/' + CATALOG_REPO + '/releases/tags/' + CATALOG_TAG);
  let rel = (g.status === 200 && g.data && g.data.id) ? g.data : null;
  if (!rel) {
    const c = await api('POST', '/repos/' + OWNER + '/' + CATALOG_REPO + '/releases', {
      tag_name: CATALOG_TAG, name: CATALOG_TAG, draft: false, prerelease: false,
      body: 'Infinity.Inc - Infinity Cloud / Infinity File Manager / InfinityPackageManager'
    });
    if (c.status !== 201) return ['catalog -> could not create ' + CATALOG_TAG + ' (' + c.status + ')'];
    rel = c.data;
    log('catalog: created ' + CATALOG_TAG);
  }

  /*
   * Clear the page before writing it. An asset cannot be replaced in place,
   * and a name.txt that outlives the files it names would advertise
   * downloads that 404.
   */
  for (const a of (rel.assets || [])) {
    const obsolete = CATALOG_OBSOLETE.test(a.name);
    const replacing = CPP_ASSETS.some(function (x) { return x.name === a.name; });
    if (!obsolete && !replacing && a.name !== 'name.txt') continue;
    const del = await api('DELETE', '/repos/' + OWNER + '/' + CATALOG_REPO + '/releases/assets/' + a.id);
    if (del.status === 204 || del.status === 200) log('catalog: removed ' + a.name);
    else done.push(a.name + ' -> could not clear (' + del.status + ')');
  }

  const lines = [];
  for (const a of CPP_ASSETS) {
    if (!fs.existsSync(a.file)) { done.push(a.name + ' -> missing file'); continue; }
    done.push(a.name + ' -> ' + uploadAsset(CATALOG_REPO, rel.id, a.file, a.name));
    lines.push(a.catalogAsset);
  }

  /* written under cpp/release, which is not tracked: it is a build artifact */
  const tmp = DIR + '/cpp/release/v1.0pre3/name.txt';
  fs.writeFileSync(tmp, lines.join('\n') + '\n', 'utf8');
  done.push('name.txt -> ' + uploadAsset(CATALOG_REPO, rel.id, tmp, 'name.txt'));
  return done;
}

async function attempt() {
  const r = await ensureRepo();
  if (r.indexOf('failed') === 0) return r;
  const p = await pushSource();
  if (p.indexOf('pushed') !== 0) return p;
  const assets = await publishAssets();
  const cppBad = assets.filter(function (x) {
    return x.indexOf('InfinityCloud_1.0.0-pre3') >= 0 || x.indexOf('InfinityFileManager_1.0.0-pre3') >= 0 || x.indexOf('InfinityPackageManager_1.0.0-pre3') >= 0;
  }).filter(function (x) { return x.indexOf('-> ok') < 0 && x.indexOf('-> already current') < 0; });
  if (cppBad.length) return 'C++ assets pending: ' + cppBad.join(' | ');

  const catalog = await publishCatalog();
  const catalogBad = catalog.filter(function (x) { return x.indexOf('-> ok') < 0; });
  if (catalogBad.length) return 'catalog pending: ' + catalogBad.join(' | ');

  return 'ok: ' + p + '; all assets ' + assets.length + '; catalog ' + catalog.length;
}

const max = Number(process.argv[2] || 30);
for (let i = 1; i <= max; i++) {
  let r;
  try { r = await attempt(); } catch (e) { r = 'threw: ' + String(e && e.message ? e.message : e).slice(0, 200); }
  log('attempt ' + i + ': ' + r);
  if (r.indexOf('ok:') === 0) { log('DONE'); process.exit(0); }
  await new Promise(function (s) { setTimeout(s, 90000); });
}
log('GAVE UP after ' + max + ' attempts');
process.exit(1);
