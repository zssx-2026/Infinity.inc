/*
 * ghsync.mjs - put the project on GitHub and keep it there.
 *
 * Two things happen here, and they fail for different reasons:
 *
 *   the source goes up as a git push to zssx-2026/Infinity.inc
 *   the installers go up as release assets on the application repos
 *
 * Both are retried, because the network on this machine comes and goes. The
 * proxy in ~/.gitconfig points at a local relay that is usually not running,
 * so every git call disables the proxy explicitly and talks to github.com
 * directly.
 *
 * Nothing here prints the token.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const TOKEN = process.env.EV_GH_TOKEN || '';
const OWNER = 'zssx-2026';
const REPO = 'Infinity.inc';
const DIR = 'D:/dev/DeepSeekHarnessWorkspace/Infinity.inc';
const LOG = DIR + '/work/ghsync.log';

/*
 * Modes:
 *   node work/ghsync.mjs --dry-run      read-only: print what a run would do
 *   node work/ghsync.mjs --source-only  push the source repository only
 *   node work/ghsync.mjs [n]            full sync, n attempts (default 30)
 *
 * --source-only exists because the C++ releases and the application-inc
 * catalogue may already be correct; a source push must not be able to
 * disturb them.
 */
const ARGV = process.argv.slice(2);
const DRY_RUN = ARGV.indexOf('--dry-run') >= 0;
const SOURCE_ONLY = ARGV.indexOf('--source-only') >= 0;
const MAX_ATTEMPTS = Number(ARGV.find(function (a) { return /^[0-9]+$/.test(a); }) || 30);

/*
 * What must never be pushed to the public source repository: session
 * transcripts are private data, restore samples and bundles are scratch, and
 * multi-megabyte blobs are what the Git Data API refuses anyway. Everything
 * matching these rules is unstaged again and reported instead of published.
 */
const PUSH_EXCLUDE_PREFIXES = [
  'work/restore-sample/',
  'work/session-history/',
  'work/chromium-trim/',
  'work/_pubcheck/',
  'IPM Applications/',
  'ITB Tools/'
];
const PUSH_EXCLUDE_FILES = [
  'work/_restorecheck-summary.json',
  'work/history-manifest.json'
];
const PUSH_EXCLUDE_PATTERNS = [/(^|\/)session\.v4\.jsonl$/];
const PUSH_MAX_BYTES = 8 * 1024 * 1024;

/* C++ installers. These go to application Releases, never into the source
 * repository. They are single-architecture win64 self-contained NSIS
 * installers until the cross-architecture compiler targets are added.
 *
 * Nothing below is hand-copied from the build. The release directory is the
 * one cpp/tools/package.mjs wrote last (pin it with INC_RELEASE when
 * re-publishing an older build); the tag, asset names and repositories come
 * from that directory's release-assets.json, and the catalogue lines come
 * from its name.txt character for character, so the application-inc page and
 * the files it advertises cannot drift apart.
 */
function newestReleaseDir() {
  const base = DIR + '/cpp/release';
  let names = [];
  try {
    names = fs.readdirSync(base).filter(function (d) {
      try {
        return fs.statSync(base + '/' + d).isDirectory() &&
          fs.existsSync(base + '/' + d + '/release-assets.json');
      } catch (e) { return false; }
    });
  } catch (e) { names = []; }
  names.sort();
  return names.length ? base + '/' + names[names.length - 1] : null;
}
const RELEASE_DIR = process.env.INC_RELEASE
  ? DIR + '/cpp/release/' + process.env.INC_RELEASE
  : newestReleaseDir();
if (!RELEASE_DIR || !fs.existsSync(RELEASE_DIR + '/release-assets.json')) {
  console.error('ghsync: no cpp/release/<version>/release-assets.json found');
  process.exit(1);
}
const CPP_MANIFEST = JSON.parse(fs.readFileSync(RELEASE_DIR + '/release-assets.json', 'utf8'));
const CPP_TAG = CPP_MANIFEST.tag;
const CATALOG_LINES = fs.readFileSync(RELEASE_DIR + '/name.txt', 'utf8')
  .split(/\r?\n/).filter(function (s) { return s.trim().length > 0; });
const CPP_ASSETS = (CPP_MANIFEST.assets || []).map(function (a) {
  return {
    repo: String(a.repo || '').split('/').pop(),
    tag: CPP_TAG,
    file: RELEASE_DIR + '/' + a.name,
    name: a.name,
    catalogAsset: null
  };
});
for (const a of CPP_ASSETS) {
  const line = CATALOG_LINES.find(function (l) { return l.split(/\s+/)[0] === a.name; });
  if (!line) {
    console.error('ghsync: name.txt has no line for ' + a.name + ' (' + RELEASE_DIR + '/name.txt)');
    process.exit(1);
  }
  a.catalogAsset = line;
}
const EXPECTED_REPOS = ['Infinity-Cloud', 'Infinity-File-Manager', 'InfinityPackageManager',
  'Infinity-Installer-Manager', 'Infinity-Toolbox', 'Infinity-Games'];
const MISSING_REPOS = EXPECTED_REPOS.filter(function (r) {
  return !CPP_ASSETS.some(function (a) { return a.repo === r; });
});
if (MISSING_REPOS.length) {
  console.error('ghsync: release-assets.json has no asset for ' + MISSING_REPOS.join(', '));
  process.exit(1);
}

/*
 * The application-inc page was moved to v1.0.0-pre4 by the catalogue step.
 * If any name in this manifest still says pre3, writing the catalogue would
 * roll the download page back to files that release no longer holds, so a
 * full sync refuses instead. --source-only does not write the catalogue and
 * only warns.
 */
function staleFindings() {
  const bad = [];
  if (/pre3/i.test(String(CPP_TAG))) bad.push('tag ' + CPP_TAG);
  for (const a of CPP_ASSETS) {
    if (/pre3/i.test(a.name)) bad.push('asset ' + a.name);
    if (a.catalogAsset && /pre3/i.test(a.catalogAsset)) bad.push('name.txt line: ' + a.catalogAsset);
  }
  for (const l of CATALOG_LINES) {
    if (/pre3/i.test(l) && bad.indexOf('name.txt line: ' + l) < 0) bad.push('name.txt line: ' + l);
  }
  return bad;
}

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
 * is the C++ rewrite of all four applications, so it takes the page over
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

/*
 * Every API request goes through curl.exe, the way cpp/tools/publish.mjs does.
 * On this machine node's own https cannot verify the TLS certificate that
 * terminates the connection (UNABLE_TO_VERIFY_LEAF_SIGNATURE) and the
 * URL-specific proxy in ~/.gitconfig points at a relay that is not running,
 * while curl reaches github.com directly and reports a real HTTP status. The
 * resolved Promise keeps every existing await api(...) call site unchanged.
 */
function api(method, route, body) {
  const args = ['-sS', '--ssl-no-revoke', '--max-time', '300', '-X', method,
    '-H', 'authorization: Bearer ' + TOKEN,
    '-H', 'accept: application/vnd.github+json',
    '-H', 'content-type: application/json',
    '-H', 'user-agent: infinity-inc',
    '-w', '\n%{http_code}',
    'https://api.github.com' + route];
  /*
   * The JSON body goes through stdin, never as an argument: a blob payload is
   * several hundred kilobytes of base64 and Windows caps a command line at
   * about 32 KB, which is what turned a file upload into "status 0".
   */
  const opts = { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 };
  if (body !== undefined) {
    args.push('--data-binary', '@-');
    opts.input = JSON.stringify(body);
  }
  let raw = '';
  try {
    raw = execFileSync('curl.exe', args, opts);
  } catch (e) {
    raw = String(e.stdout || '') + String(e.stderr || '') + String(e.message || '');
  }
  let status = 0;
  let text = raw;
  const cut = raw.lastIndexOf('\n');
  if (cut >= 0) {
    const tail = raw.slice(cut + 1).trim();
    if (/^[0-9]{3}$/.test(tail)) { status = Number(tail); text = raw.slice(0, cut); }
  }
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = null; }
  return Promise.resolve({
    status: status,
    data: data,
    error: status === 0 ? scrub(text).slice(0, 200) : undefined
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
    '-c', 'http.sslVerify=false',
    '-c', 'core.quotepath=false'
  ].concat(args),
    { cwd: DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

async function ensureRepo() {
  const g = await api('GET', '/repos/' + OWNER + '/' + REPO);
  if (g.status === 200) return 'exists';
  const c = await api('POST', '/user/repos', {
    name: REPO, private: false, auto_init: false,
    description: 'Infinity.Inc - the Infinity suite: Infinity Cloud, Infinity File Manager, InfinityPackageManager, Infinity Installer Manager, Infinity Toolbox and Infinity Games'
  });
  if (c.status === 201 || c.status === 200) { log('repo created'); return 'created'; }
  return 'failed: ' + c.status + ' ' + (c.error || (c.data && c.data.message));
}

async function pushSource() {
  try {
    git(['add', '-A']);
    /*
     * Stage everything, then unstage the paths that must not be published
     * (session transcripts, restore samples, oversized blobs). Unstaging
     * touches no working-tree file; it only decides what the commit holds.
     */
    const staged = git(['diff', '--cached', '--name-only']).split('\n')
      .map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
    const skips = pushSkips(staged);
    /* One git call per path would be ~1,400 processes; 60 paths per call keeps
     * the reset fast without hitting the Windows command-line limit. */
    const paths = skips.map(function (s) { return s.replace(/ \[[^\]]*\]$/, ''); });
    for (let i = 0; i < paths.length; i += 60) {
      git(['reset', '-q', '--'].concat(paths.slice(i, i + 60)));
    }
    if (skips.length) {
      log('source: left ' + skips.length + ' path(s) out of the push: ' +
        skips.slice(0, 12).join(', ') + (skips.length > 12 ? ' ...' : ''));
    }
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
      content: Buffer.from('# Infinity.Inc\n\nThe Infinity suite: Infinity Cloud, Infinity File Manager, InfinityPackageManager and Infinity Installer Manager.\n', 'utf8').toString('base64')
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
    .concat(CPP_ASSETS.map(function (a) { return Object.assign({ tag: CPP_TAG, kind: 'cpp' }, a); }));
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
  const stale = staleFindings();
  if (stale.length) {
    throw new Error('REFUSING catalogue write: pre3 names in ' + RELEASE_DIR + ' -> ' + stale.join(' | '));
  }
  const done = [];
  const g = await api('GET', '/repos/' + OWNER + '/' + CATALOG_REPO + '/releases/tags/' + CATALOG_TAG);
  let rel = (g.status === 200 && g.data && g.data.id) ? g.data : null;
  if (!rel) {
    const c = await api('POST', '/repos/' + OWNER + '/' + CATALOG_REPO + '/releases', {
      tag_name: CATALOG_TAG, name: CATALOG_TAG, draft: false, prerelease: false,
      body: 'Infinity.Inc - Infinity Cloud / Infinity File Manager / InfinityPackageManager / Infinity Installer Manager / Infinity Toolbox / Infinity Games'
    });
    if (c.status !== 201) return ['catalog -> could not create ' + CATALOG_TAG + ' (' + c.status + ')'];
    rel = c.data;
    log('catalog: created ' + CATALOG_TAG);
  }

  const lines = [];
  const expected = [];
  let missing = false;
  for (const a of CPP_ASSETS) {
    if (!fs.existsSync(a.file)) { done.push(a.name + ' -> missing file'); missing = true; continue; }
    lines.push(a.catalogAsset);
    expected.push({ name: a.name, size: fs.statSync(a.file).size });
  }
  const manifest = lines.join('\n') + '\n';

  /*
   * The page is rewritten only when it is not already the page we would write.
   * Clearing it every sync would take the catalogue down for as long as the
   * uploads take, and hand every asset a new id for no reason.
   */
  const have = rel.assets || [];
  const same = !missing && expected.every(function (e) {
    const a = have.find(function (x) { return x.name === e.name; });
    return a && a.size === e.size;
  }) && have.some(function (x) { return x.name === 'name.txt' && x.size === Buffer.byteLength(manifest); });
  if (same) return ['catalogue -> already current'];

  /*
   * Clear the page before writing it. An asset cannot be replaced in place,
   * and a name.txt that outlives the files it names would advertise
   * downloads that 404.
   */
  for (const a of have) {
    const obsolete = CATALOG_OBSOLETE.test(a.name);
    const replacing = CPP_ASSETS.some(function (x) { return x.name === a.name; });
    if (!obsolete && !replacing && a.name !== 'name.txt') continue;
    const del = await api('DELETE', '/repos/' + OWNER + '/' + CATALOG_REPO + '/releases/assets/' + a.id);
    if (del.status === 204 || del.status === 200) log('catalog: removed ' + a.name);
    else done.push(a.name + ' -> could not clear (' + del.status + ')');
  }

  for (const e of expected) {
    const a = CPP_ASSETS.find(function (x) { return x.name === e.name; });
    done.push(a.name + ' -> ' + uploadAsset(CATALOG_REPO, rel.id, a.file, a.name));
  }

  /* The file the page is generated from. It already holds exactly these
   * lines, so it is only rewritten when something changed; cpp/release is not
   * tracked: it is a build artifact. */
  const tmp = RELEASE_DIR + '/name.txt';
  if (fs.readFileSync(tmp, 'utf8') !== manifest) fs.writeFileSync(tmp, manifest, 'utf8');
  done.push('name.txt -> ' + uploadAsset(CATALOG_REPO, rel.id, tmp, 'name.txt'));
  return done;
}

async function attempt() {
  const r = await ensureRepo();
  if (r.indexOf('failed') === 0) return r;
  const p = await pushSource();
  if (p.indexOf('pushed') !== 0) return p;
  const assets = await publishAssets();
  const cppNames = CPP_ASSETS.map(function (a) { return a.name; });
  const cppBad = assets.filter(function (x) {
    return cppNames.some(function (n) { return x.indexOf(n) >= 0; });
  }).filter(function (x) { return x.indexOf('-> ok') < 0 && x.indexOf('-> already current') < 0; });
  if (cppBad.length) return 'C++ assets pending: ' + cppBad.join(' | ');

  const catalog = await publishCatalog();
  const catalogBad = catalog.filter(function (x) {
    return x.indexOf('-> ok') < 0 && x.indexOf('-> already current') < 0;
  });
  if (catalogBad.length) return 'catalog pending: ' + catalogBad.join(' | ');

  return 'ok: ' + p + '; all assets ' + assets.length + '; catalog ' + catalog.length;
}

/* Which paths a push would leave behind, so the dry run and the real run
 * agree on what goes up. */
function pushSkips(paths) {
  const out = [];
  for (const raw of paths) {
    const rel = String(raw).replace(/^"|"$/g, '');
    const p = rel.split('\\').join('/');
    let why = null;
    if (PUSH_EXCLUDE_PREFIXES.some(function (x) { return p.indexOf(x) === 0; })) why = 'scratch/private prefix';
    else if (PUSH_EXCLUDE_FILES.indexOf(p) >= 0) why = 'scratch/private file';
    else if (PUSH_EXCLUDE_PATTERNS.some(function (re) { return re.test(p); })) why = 'session transcript';
    else {
      try { if (fs.statSync(DIR + '/' + rel).size > PUSH_MAX_BYTES) why = 'over ' + PUSH_MAX_BYTES + ' B'; } catch (e) { }
    }
    if (why) out.push(p + ' [' + why + ']');
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Dry run: every GET a real run would make, and no write of any kind. */
/* ------------------------------------------------------------------ */
async function dryRun() {
  log('DRY RUN: no release, no asset, no catalogue write, no git push');
  log('manifest: ' + RELEASE_DIR + '/release-assets.json');
  log('manifest tag: ' + CPP_TAG + '   assets: ' + CPP_ASSETS.length + '   repositories: ' + CPP_ASSETS.map(function (a) { return a.repo; }).join(', '));
  const stale = staleFindings();
  log('pre3 guard: ' + (stale.length ? 'REFUSED -> ' + stale.join(' | ') : 'ok (no pre3 name in tag, asset names or name.txt)'));
  for (const a of CPP_ASSETS) log('  catalog line: ' + a.catalogAsset);

  /* source side, read-only */
  try {
    const localHead = git(['rev-parse', '--short', 'HEAD']).trim();
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    const tracked = trackedFiles();
    const dirty = git(['status', '--porcelain', '-uall']).split('\n')
      .filter(function (s) { return s.length > 0; });
    const paths = dirty.map(function (l) { return l.slice(3); });
    const skips = pushSkips(paths);
    const remote = await api('GET', '/repos/' + OWNER + '/' + REPO);
    log('source: local ' + branch + '@' + localHead + ', tracked=' + tracked.length + ', working-tree changes=' + dirty.length);
    log('source: remote ' + REPO + ' pushed_at=' + ((remote.data && remote.data.pushed_at) || '?'));
    log('source: would run  git push -u origin HEAD:main --force');
    log('source: would leave out ' + skips.length + ' path(s): ' + (skips.slice(0, 10).join(', ') || 'none') + (skips.length > 10 ? ' ...' : ''));
  } catch (e) {
    log('source: ' + scrub(String(e && e.message ? e.message : e)));
  }

  /* release assets */
  for (const a of CPP_ASSETS) {
    if (!fs.existsSync(a.file)) { log('asset ' + a.name + ': LOCAL FILE MISSING'); continue; }
    const local = fs.statSync(a.file).size;
    const g = await api('GET', '/repos/' + OWNER + '/' + a.repo + '/releases/tags/' + a.tag);
    if (g.status === 404) { log('asset ' + a.name + ' [' + a.repo + ']: release ' + a.tag + ' absent -> would be created and uploaded'); continue; }
    if (g.status !== 200 || !g.data) { log('asset ' + a.name + ' [' + a.repo + ']: release lookup HTTP ' + g.status); continue; }
    const ex = (g.data.assets || []).find(function (x) { return x.name === a.name; });
    if (!ex) log('asset ' + a.name + ' [' + a.repo + ']: would upload ' + local + ' B');
    else if (ex.size === local) log('asset ' + a.name + ' [' + a.repo + ']: already current (' + local + ' B) -> untouched');
    else log('asset ' + a.name + ' [' + a.repo + ']: present ' + ex.size + ' B != local ' + local + ' B -> would delete then upload');
  }

  /* catalogue page */
  const g = await api('GET', '/repos/' + OWNER + '/' + CATALOG_REPO + '/releases/tags/' + CATALOG_TAG);
  if (g.status === 404) { log('catalogue ' + CATALOG_TAG + ': absent -> would be created'); return; }
  if (g.status !== 200 || !g.data) { log('catalogue ' + CATALOG_TAG + ': lookup HTTP ' + g.status); return; }
  const have = g.data.assets || [];
  const manifestBytes = Buffer.byteLength(CATALOG_LINES.join('\n') + '\n');
  const wanted = function (n) { return CPP_ASSETS.find(function (a) { return a.name === n; }); };
  const wouldDelete = [];
  for (const x of have) {
    const expect = wanted(x.name);
    if (CATALOG_OBSOLETE.test(x.name)) { wouldDelete.push(x.name); continue; }
    if (x.name === 'name.txt') { if (x.size !== manifestBytes) wouldDelete.push('name.txt'); continue; }
    if (!expect) { log('catalogue: keeps foreign asset ' + x.name + ' (' + x.size + ' B) -> untouched'); continue; }
    if (x.size !== fs.statSync(expect.file).size) wouldDelete.push(x.name);
  }
  const missing = CPP_ASSETS.filter(function (a) {
    return !have.some(function (x) { return x.name === a.name; });
  });
  const nt = have.find(function (x) { return x.name === 'name.txt'; });
  log('catalogue: page has ' + have.length + ' asset(s); expected ' + CPP_ASSETS.length + ' pre4 asset(s), ' + missing.length + ' missing');
  log('catalogue: would upload ' + (missing.map(function (a) { return a.name; }).join(', ') || 'nothing'));
  log('catalogue name.txt: page=' + (nt ? nt.size + ' B' : 'absent') + ', local=' + manifestBytes + ' B -> ' +
    (nt && nt.size === manifestBytes ? 'already current, would not be rewritten' : 'would be rewritten'));
  log('catalogue: would delete only ' + (wouldDelete.join(', ') || 'nothing'));
}

if (DRY_RUN) {
  try { await dryRun(); log('DRY RUN complete'); process.exit(0); }
  catch (e) { log('DRY RUN threw: ' + scrub(String(e && e.message ? e.message : e))); process.exit(1); }
}

if (SOURCE_ONLY) {
  const stale = staleFindings();
  if (stale.length) log('warning: pre3 names present (' + stale.join(' | ') + '); --source-only does not touch releases or the catalogue');
  const r0 = await ensureRepo();
  log('repo: ' + r0);
  if (String(r0).indexOf('failed') === 0) { log('GAVE UP'); process.exit(1); }
  let p0;
  try { p0 = await pushSource(); } catch (e) { p0 = 'threw: ' + scrub(String(e && e.message ? e.message : e)); }
  log('source: ' + p0);
  log(String(p0).indexOf('pushed') === 0 ? 'DONE' : 'GAVE UP');
  process.exit(String(p0).indexOf('pushed') === 0 ? 0 : 1);
}

const staleManifest = staleFindings();
if (staleManifest.length) {
  log('REFUSING: pre3 names in ' + RELEASE_DIR + ' -> ' + staleManifest.join(' | '));
  log('the application-inc page is on v1.0.0-pre4; a pre3 sync would roll it back');
  process.exit(2);
}

for (let i = 1; i <= MAX_ATTEMPTS; i++) {
  let r;
  try { r = await attempt(); } catch (e) { r = 'threw: ' + String(e && e.message ? e.message : e).slice(0, 200); }
  log('attempt ' + i + ': ' + r);
  if (r.indexOf('ok:') === 0) { log('DONE'); process.exit(0); }
  await new Promise(function (s) { setTimeout(s, 90000); });
}
log('GAVE UP after ' + MAX_ATTEMPTS + ' attempts');
process.exit(1);
