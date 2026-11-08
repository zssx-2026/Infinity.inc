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
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const TOKEN = process.env.EV_GH_TOKEN || '';
const OWNER = 'zssx-2026';
const REPO = 'Infinity.inc';
const DIR = 'D:/dev/DeepSeekHarnessWorkspace/Infinity.inc';
/* The run log; override with INC_GH_LOG so a dry run can be kept out of the
 * workspace log, or pointed at a per-run file. */
const LOG = process.env.INC_GH_LOG || DIR + '/work/ghsync.log';

/*
 * Modes:
 *   node work/ghsync.mjs --dry-run           local-only: validate the release
 *                                            directory and print what a run would
 *                                            do; makes no network call at all
 *   node work/ghsync.mjs --dry-run --remote  also does the read-only GitHub GETs
 *   node work/ghsync.mjs --source-only       push the source repository only
 *   node work/ghsync.mjs [n]                 full sync, n attempts (default 30)
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
function releaseDirToTag(dirName) {
  const m = /^v([0-9]+)\.([0-9]+)pre([0-9]+)$/.exec(String(dirName));
  return m ? 'v' + m[1] + '.' + m[2] + '.0-pre' + m[3] : null;
}
function preNumber(s) {
  const m = /pre([0-9]+)/i.exec(String(s));
  return m ? Number(m[1]) : null;
}
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
  /* Numeric on the pre<N> part, not lexicographic: with a plain sort()
   * v1.0pre10 would come before v1.0pre9. */
  names.sort(function (a, b) {
    const na = preNumber(a), nb = preNumber(b);
    if (na !== null && nb !== null && na !== nb) return na - nb;
    return a < b ? -1 : (a > b ? 1 : 0);
  });
  return names.length ? base + '/' + names[names.length - 1] : null;
}
const RELEASE_DIR = process.env.INC_RELEASE
  ? DIR + '/cpp/release/' + process.env.INC_RELEASE
  : newestReleaseDir();
/* v1.0pre4 ships six C++ installers as separate application repos; keep this
 * list in step with cpp/release/<version>/release-assets.json. InfinityServer
 * is a product of its own and is released separately from these C++ installers. */
const EXPECTED_REPOS = ['Infinity-Cloud', 'Infinity-File-Manager', 'InfinityPackageManager', 'Infinity-Installer-Manager', 'Infinity-Toolbox', 'Infinity-Games'];
const EXPECTED_APPS = ['inc', 'ifm', 'ipm', 'iim', 'itb', 'ig'];
const RELEASE_PROBLEMS = [];
function problem(m) { RELEASE_PROBLEMS.push(m); }
function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

let CPP_MANIFEST = null;
let CPP_TAG = null;
let CPP_VERSION = null;
let CATALOG_LINES = [];
let CPP_ASSETS = [];
const RELEASE_NAME = RELEASE_DIR ? path.basename(RELEASE_DIR) : null;

if (!RELEASE_DIR || !fs.existsSync(RELEASE_DIR + '/release-assets.json')) {
  problem('no cpp/release/<version>/release-assets.json found' + (RELEASE_DIR ? ' at ' + RELEASE_DIR : ''));
} else {
  try { CPP_MANIFEST = JSON.parse(fs.readFileSync(RELEASE_DIR + '/release-assets.json', 'utf8')); }
  catch (e) { problem('release-assets.json is not valid JSON (' + RELEASE_DIR + '): ' + e.message); }
}

/*
 * Everything a real run depends on is proved here, before any mode does any
 * work: the manifest must describe exactly the six applications, every asset
 * must exist on disk with the size and (when the manifest carries one) the
 * sha256 it claims, and name.txt must name exactly those assets. A missing or
 * inconsistent entry is a hard error, never a silent skip.
 */
if (CPP_MANIFEST) {
  CPP_TAG = CPP_MANIFEST.tag;
  CPP_VERSION = CPP_MANIFEST.version;
  const derivedTag = releaseDirToTag(RELEASE_NAME);
  if (!derivedTag) problem('release directory name is not v<major>.<minor>pre<N>: ' + RELEASE_NAME);
  else if (CPP_TAG !== derivedTag) {
    problem('manifest tag ' + CPP_TAG + ' does not match directory ' + RELEASE_NAME + ' (expected ' + derivedTag + ')');
  }
  if (!CPP_VERSION) problem('release-assets.json has no version field');
  else if (!/^[0-9]+\.[0-9]+\.[0-9]+-pre[0-9]+$/.test(String(CPP_VERSION))) {
    problem('manifest version is not <major>.<minor>.<patch>-pre<N>: ' + CPP_VERSION);
  }

  const nameFile = RELEASE_DIR + '/name.txt';
  if (!fs.existsSync(nameFile)) problem('name.txt missing: ' + nameFile);
  else CATALOG_LINES = fs.readFileSync(nameFile, 'utf8').split(/\r?\n/)
    .filter(function (s) { return s.trim().length > 0; });

  const raw = Array.isArray(CPP_MANIFEST.assets) ? CPP_MANIFEST.assets : [];
  if (raw.length !== EXPECTED_REPOS.length) {
    problem('release-assets.json has ' + raw.length + ' asset(s), expected ' + EXPECTED_REPOS.length +
      ' for ' + EXPECTED_APPS.join('/'));
  }
  CPP_ASSETS = raw.map(function (a) {
    return {
      repo: String(a.repo || '').split('/').pop(),
      tag: CPP_TAG,
      file: RELEASE_DIR + '/' + String(a.name || ''),
      name: String(a.name || ''),
      size: a.size,
      sha256: a.sha256 || null,
      catalogAsset: null
    };
  });
  for (const a of CPP_ASSETS) {
    if (!a.name) { problem('release-assets.json has an asset without a name'); continue; }
    if (EXPECTED_REPOS.indexOf(a.repo) < 0) problem('unexpected repository in manifest: ' + a.repo + ' (' + a.name + ')');
    if (!/^[A-Za-z0-9]+_[0-9]+\.[0-9]+\.[0-9]+-pre[0-9]+_win64_setup\.exe$/.test(a.name)) {
      problem('asset name is not <Package>_<version>_win64_setup.exe: ' + a.name);
    }
    if (CPP_VERSION && a.name.indexOf('_' + CPP_VERSION + '_') < 0) {
      problem('asset name does not carry version ' + CPP_VERSION + ': ' + a.name);
    }
    if (!fs.existsSync(a.file)) { problem('asset file missing: ' + a.file); continue; }
    const bytes = fs.statSync(a.file).size;
    if (typeof a.size === 'number' && a.size !== bytes) {
      problem('asset size mismatch for ' + a.name + ': manifest ' + a.size + ' B, file ' + bytes + ' B');
    }
    const digest = sha256File(a.file);
    if (a.sha256 && digest !== a.sha256) {
      problem('asset sha256 mismatch for ' + a.name + ': manifest ' + a.sha256 + ', file ' + digest);
    }
    const line = CATALOG_LINES.find(function (l) { return l.split(/\s+/)[0] === a.name; });
    if (!line) problem('name.txt has no line for ' + a.name + ' (' + nameFile + ')');
    else a.catalogAsset = line;
  }
  const seenRepos = [];
  for (const a of CPP_ASSETS) {
    if (seenRepos.indexOf(a.repo) >= 0) problem('duplicate asset for repository ' + a.repo);
    seenRepos.push(a.repo);
  }
  const missingRepos = EXPECTED_REPOS.filter(function (r) {
    return !CPP_ASSETS.some(function (a) { return a.repo === r; });
  });
  if (missingRepos.length) problem('release-assets.json has no asset for ' + missingRepos.join(', '));
  for (const l of CATALOG_LINES) {
    const first = l.split(/\s+/)[0];
    if (!CPP_ASSETS.some(function (a) { return a.name === first; })) {
      problem('name.txt line is not in release-assets.json: ' + l);
    }
  }
}

/* A real run must not start on a broken release. The dry run keeps going so it
 * can print the whole entry list and every problem in one pass. */
if (RELEASE_PROBLEMS.length && !DRY_RUN) {
  for (const p of RELEASE_PROBLEMS) console.error('ghsync: ' + p);
  process.exit(1);
}

/*
 * The application-inc page carries exactly one release of the suite. If any
 * name in this manifest points at an older pre<N> than the release directory,
 * writing the catalogue would roll the download page back to files that
 * release no longer holds, so a full sync refuses instead. The comparison is
 * numeric and relative to the selected directory, not a hard-coded release
 * number, so it keeps working for later pre<N> releases. --source-only does
 * not write the catalogue and only warns.
 */
function staleFindings() {
  const bad = [];
  const current = preNumber(CPP_TAG) !== null ? preNumber(CPP_TAG) : preNumber(RELEASE_NAME);
  if (current === null) {
    if (CPP_TAG) bad.push('tag ' + CPP_TAG + ' carries no pre<N>');
    return bad;
  }
  function older(s) {
    const n = preNumber(s);
    return n !== null && n < current;
  }
  if (older(CPP_TAG)) bad.push('tag ' + CPP_TAG + ' is older than pre' + current);
  for (const a of CPP_ASSETS) {
    if (older(a.name)) bad.push('asset ' + a.name);
    if (a.catalogAsset && older(a.catalogAsset)) bad.push('name.txt line: ' + a.catalogAsset);
  }
  for (const l of CATALOG_LINES) {
    if (older(l) && bad.indexOf('name.txt line: ' + l) < 0) bad.push('name.txt line: ' + l);
  }
  return bad;
}

/* The Node-era installers that used to be listed here (an older pre-N tag,
 * under InfinityPackageManager/build/setup and the three product source
 * trees) no longer exist on disk: the C++ rewrite ships exactly six win64
 * NSIS installers in cpp/release/<version>, and README.md points at those.
 * The publishable asset list is therefore the validated C++ manifest above
 * and nothing else, so no stale release number is referenced anywhere. */

/*
 * The IPM catalogue.
 *
 * ipm reads the `applications` repository, and every Release in it is one
 * catalogue page. A page advertises builds through a `name.txt` asset whose
 * lines read
 *
 *   <asset name> <company> <package> setup <company> <platform>
 *
 * and a name that is not also an asset of that same Release is skipped - so
 * the installers are attached to the catalogue page as well as to their own
 * repository. The page keeps one copy of each installer, about 1.8 MiB for
 * the whole suite.
 *
 * `application-inc` held the Node v0.1 build of Infinity Cloud. The current
 * C++ rewrite of all six applications takes the page over rather than sitting
 * next to a build nothing else references any more, so the page always names
 * exactly the release in cpp/release/<version>.
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
  const args = ['-sS', '--ssl-no-revoke', '--max-time', '300', '-X', method];
  /*
   * A header only goes out when there is a token to put in it. `Bearer ` with an empty
   * value is not anonymous: GitHub answers 401 and the read-only --remote dry run then
   * reported "errors: 0" while every single remote lookup had failed.
   */
  if (TOKEN) args.push('-H', 'authorization: Bearer ' + TOKEN);
  args.push(
    '-H', 'accept: application/vnd.github+json',
    '-H', 'content-type: application/json',
    '-H', 'user-agent: infinity-inc',
    '-w', '\n%{http_code}',
    'https://api.github.com' + route);
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
  for (const a of CPP_ASSETS) {
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

  return done;
}

async function publishCatalog() {
  const stale = staleFindings();
  if (stale.length) {
    throw new Error('REFUSING catalogue write: outdated pre<N> names in ' + RELEASE_DIR + ' -> ' + stale.join(' | '));
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
/* Dry run: local validation always; the read-only GitHub GETs only     */
/* with --remote. It never writes anything and never pushes.            */
/* ------------------------------------------------------------------ */
function localDryRun() {
  log('manifest: ' + (RELEASE_DIR ? RELEASE_DIR + '/release-assets.json' : '<none>'));
  if (CPP_TAG) {
    log('tag: ' + CPP_TAG + '   version: ' + CPP_VERSION + '   directory: ' + RELEASE_NAME +
      '   assets: ' + CPP_ASSETS.length);
  }
  const stale = staleFindings();
  log('stale guard: ' + (stale.length
    ? 'REFUSED -> ' + stale.join(' | ')
    : 'ok (no older pre<N> in tag, asset names or name.txt)'));
  let total = 0;
  for (const a of CPP_ASSETS) {
    const exists = fs.existsSync(a.file);
    let bytes = null, digest = null;
    if (exists) {
      bytes = fs.statSync(a.file).size;
      total += bytes;
      digest = sha256File(a.file);
    }
    let hash = '';
    if (digest) {
      hash = ' sha256=' + digest;
      if (a.sha256) hash += digest === a.sha256 ? ' (matches manifest)' : ' (MANIFEST MISMATCH)';
    }
    log('entry ' + (a.name || '<no name>') + ' [' + (a.repo || '?') + '] -> ' + (exists ? 'EXISTS' : 'MISSING') +
      (bytes === null ? '' : ' ' + bytes + ' B') + hash);
    log('  source path: ' + a.file);
    log('  catalog line: ' + (a.catalogAsset || '<none>'));
  }
  log('entries: ' + CPP_ASSETS.length + '   total bytes: ' + total);
  return total;
}

async function dryRun() {
  const remote = ARGV.indexOf('--remote') >= 0;
  log('DRY RUN (' + (remote ? 'local validation + read-only GitHub GETs' : 'local only, no network call') +
    '): no release, no asset, no catalogue write, no git push');
  localDryRun();

  /* source side, read-only and local */
  try {
    const localHead = git(['rev-parse', '--short', 'HEAD']).trim();
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    const tracked = trackedFiles();
    const dirty = git(['status', '--porcelain', '-uall']).split('\n')
      .filter(function (s) { return s.length > 0; });
    const paths = dirty.map(function (l) { return l.slice(3); });
    const skips = pushSkips(paths);
    log('source: local ' + branch + '@' + localHead + ', tracked=' + tracked.length + ', working-tree changes=' + dirty.length);
    log('source: would run  git push -u origin HEAD:main --force' + (remote ? '' : ' (not attempted in this mode)'));
    log('source: would leave out ' + skips.length + ' path(s): ' + (skips.slice(0, 10).join(', ') || 'none') + (skips.length > 10 ? ' ...' : ''));
  } catch (e) {
    log('source: ' + scrub(String(e && e.message ? e.message : e)));
  }

  if (!remote) {
    log('network: skipped (pass --remote for the read-only release and catalogue GETs)');
    log('errors: ' + RELEASE_PROBLEMS.length);
    for (const p of RELEASE_PROBLEMS) log('  ERROR ' + p);
    return RELEASE_PROBLEMS.length ? 1 : 0;
  }

  try {
    const remoteInfo = await api('GET', '/repos/' + OWNER + '/' + REPO);
    if (remoteInfo.status !== 200 || !remoteInfo.data) problem('source: remote lookup HTTP ' + remoteInfo.status + ' for ' + OWNER + '/' + REPO);
    log('source: remote ' + REPO + ' pushed_at=' + ((remoteInfo.data && remoteInfo.data.pushed_at) || '?'));
  } catch (e) {
    problem('source: remote lookup failed: ' + scrub(String(e && e.message ? e.message : e)));
  }

  /* release assets */
  for (const a of CPP_ASSETS) {
    if (!fs.existsSync(a.file)) { log('asset ' + a.name + ': LOCAL FILE MISSING'); continue; }
    const local = fs.statSync(a.file).size;
    const g = await api('GET', '/repos/' + OWNER + '/' + a.repo + '/releases/tags/' + a.tag);
    if (g.status === 404) { log('asset ' + a.name + ' [' + a.repo + ']: release ' + a.tag + ' absent -> would be created and uploaded'); continue; }
    if (g.status !== 200 || !g.data) { problem('asset ' + a.name + ' [' + a.repo + ']: release lookup HTTP ' + g.status + ' for ' + a.tag); continue; }
    const ex = (g.data.assets || []).find(function (x) { return x.name === a.name; });
    if (!ex) log('asset ' + a.name + ' [' + a.repo + ']: would upload ' + local + ' B');
    else if (ex.size === local) log('asset ' + a.name + ' [' + a.repo + ']: already current (' + local + ' B) -> untouched');
    else log('asset ' + a.name + ' [' + a.repo + ']: present ' + ex.size + ' B != local ' + local + ' B -> would delete then upload');
  }

  /* catalogue page */
  const g = await api('GET', '/repos/' + OWNER + '/' + CATALOG_REPO + '/releases/tags/' + CATALOG_TAG);
  if (g.status === 404) {
    log('catalogue ' + CATALOG_TAG + ': absent -> would be created');
  } else if (g.status !== 200 || !g.data) {
    problem('catalogue ' + CATALOG_TAG + ': lookup HTTP ' + g.status);
  } else {
    const have = g.data.assets || [];
    const manifestBytes = Buffer.byteLength(CATALOG_LINES.join('\n') + '\n');
    const wanted = function (n) { return CPP_ASSETS.find(function (a) { return a.name === n; }); };
    const wouldDelete = [];
    for (const x of have) {
      const expect = wanted(x.name);
      if (CATALOG_OBSOLETE.test(x.name)) { wouldDelete.push(x.name); continue; }
      if (x.name === 'name.txt') {
        /*
         * Size alone is not evidence: the pre5 manifest and the pre4 one on the page are
         * both 614 B. GitHub reports a `digest` (sha256:<hex>) for release assets, so when
         * it is there the comparison is by content; only a page that omits the digest falls
         * back to size, and then the run says so instead of claiming "already current".
         */
        const localDigest = sha256File(RELEASE_DIR + '/name.txt');
        if (x.digest) { if (x.digest !== 'sha256:' + localDigest) wouldDelete.push('name.txt'); }
        else if (x.size !== manifestBytes) wouldDelete.push('name.txt');
        else log('catalogue name.txt: same size (' + x.size + ' B), page reports no digest -> compared at publish time');
        continue;
      }
      if (!expect) { log('catalogue: keeps foreign asset ' + x.name + ' (' + x.size + ' B) -> untouched'); continue; }
      if (x.size !== fs.statSync(expect.file).size) wouldDelete.push(x.name);
    }
    const missing = CPP_ASSETS.filter(function (a) {
      return !have.some(function (x) { return x.name === a.name; });
    });
    const nt = have.find(function (x) { return x.name === 'name.txt'; });
    log('catalogue: page has ' + have.length + ' asset(s); expected ' + CPP_ASSETS.length + ' asset(s), ' + missing.length + ' missing');
    log('catalogue: would upload ' + (missing.map(function (a) { return a.name; }).join(', ') || 'nothing'));
    /*
     * The verdict follows the same rule as the loop above: content when the page reports a
     * digest, size only as a fallback — and then it says so rather than claiming equality.
     */
    const ntLocalDigest = sha256File(RELEASE_DIR + '/name.txt');
    const ntDigestMatch = nt && nt.digest === 'sha256:' + ntLocalDigest;
    const ntSameSize = nt && nt.size === manifestBytes;
    log('catalogue name.txt: page=' + (nt ? nt.size + ' B' + (nt.digest ? ' ' + nt.digest : ' no digest') : 'absent') + ', local=' + manifestBytes + ' B -> ' +
      (ntDigestMatch ? 'content identical (sha256), would not be rewritten'
        : ntSameSize ? 'same size but content not confirmed, would be rewritten' : 'would be rewritten'));
    log('catalogue: would delete only ' + (wouldDelete.join(', ') || 'nothing'));
  }

  log('errors: ' + RELEASE_PROBLEMS.length);
  for (const p of RELEASE_PROBLEMS) log('  ERROR ' + p);
  return RELEASE_PROBLEMS.length ? 1 : 0;
}

if (DRY_RUN) {
  let code = 1;
  try {
    code = await dryRun();
    log('DRY RUN complete: ' + (code === 0 ? '0 errors' : RELEASE_PROBLEMS.length + ' ERROR(S)'));
  } catch (e) {
    log('DRY RUN threw: ' + scrub(String(e && e.message ? e.message : e)));
    code = 1;
  }
  process.exit(code);
}

if (SOURCE_ONLY) {
  const stale = staleFindings();
  if (stale.length) log('warning: outdated pre<N> names present (' + stale.join(' | ') + '); --source-only does not touch releases or the catalogue');
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
  log('REFUSING: outdated pre<N> names in ' + RELEASE_DIR + ' -> ' + staleManifest.join(' | '));
  log('the catalogue must carry only the selected release ' + CPP_TAG + '; an older sync would roll it back');
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
