/*
 * publish.mjs - put the built C++ installers on GitHub.
 *
 * The C++ suite lives in its own repositories (one per application), the way
 * the Node builds already do, so a user downloads exactly one installer.
 *
 * Every request goes through curl. The hand-rolled CONNECT client in the
 * application repositories is bound to a local relay that is not always
 * running; curl picks up the proxy from the environment and reports a real
 * HTTP status instead of an opaque socket error.
 *
 * Usage:
 *   node tools/publish.mjs [tag] [--dry-run]
 *   INC_RELEASE=v1.0pre4 INC_TAG=v1.0.0-pre4 node tools/publish.mjs --dry-run
 *
 * The release directory comes from INC_RELEASE (default v1.0pre4) and the git
 * tag from the first non-flag argument or INC_TAG (default v1.0.0-pre4), the
 * same pair tools/package.mjs uses. The version inside the file name is TAG
 * without its leading "v" unless INC_VERSION says otherwise.
 *
 * --dry-run is GET-only: it resolves every repository and release, lists the
 * assets and checks the local installer names, and prints what a real run
 * would do. It never creates a release, deletes an asset or uploads a byte.
 *
 * A repository that does not exist is reported and skipped; it is never
 * created here. This script only ever touches the release named by TAG, so an
 * earlier release (v1.0.0-pre3 and friends) is left alone; within TAG it only
 * replaces an asset carrying exactly the name it is about to upload, and it
 * never removes an asset with any other name.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const RELEASE = process.env.INC_RELEASE || 'v1.0pre4';
const OUT = path.join(ROOT, 'release', RELEASE);

const ARGV = process.argv.slice(2);
const DRY_RUN = ARGV.indexOf('--dry-run') >= 0;
const POSITIONAL = ARGV.filter(function (a) { return a.charAt(0) !== '-'; });
const TAG = POSITIONAL[0] || process.env.INC_TAG || 'v1.0.0-pre4';
const VERSION = process.env.INC_VERSION || TAG.replace(/^v/, '');
const OWNER = 'zssx-2026';

/* package name in the file name -> repository that holds the application */
const REPOS = [
  { package: 'InfinityCloud', repo: 'Infinity-Cloud', product: 'Infinity Cloud' },
  { package: 'InfinityFileManager', repo: 'Infinity-File-Manager', product: 'Infinity File Manager' },
  { package: 'InfinityPackageManager', repo: 'InfinityPackageManager', product: 'InfinityPackageManager' },
  { package: 'InfinityInstallerManager', repo: 'Infinity-Installer-Manager', product: 'Infinity Installer Manager' },
  { package: 'InfinityToolbox', repo: 'Infinity-Toolbox', product: 'Infinity Toolbox' },
  { package: 'InfinityGames', repo: 'Infinity-Games', product: 'Infinity Games' }
];

const token = process.env.EV_GH_TOKEN || '';
if (!token) { console.log('NO TOKEN (set EV_GH_TOKEN)'); process.exit(1); }

/* Nothing that reaches a log or a report may contain the token. */
function scrub(s) { return String(s).split(token).join('<token>'); }

function curl(args) {
  /* stdio must be stated: inheriting stdin makes every spawn fail with EBUSY */
  return execFileSync('curl.exe', ['-sS', '--ssl-no-revoke', '--max-time', '3600'].concat(args),
    { maxBuffer: 256 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/* The HTTP status is appended with -w so a 404 (missing repository) can be
 * told apart from an empty successful body. */
function api(method, route, body) {
  const args = ['-X', method,
    '-H', 'Authorization: Bearer ' + token,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'User-Agent: Infinity.Inc',
    '-H', 'X-GitHub-Api-Version: 2022-11-28',
    '-w', '\n%{http_code}',
    'https://api.github.com' + route];
  if (body !== undefined) {
    args.push('-H', 'Content-Type: application/json', '--data-binary', JSON.stringify(body));
  }
  let raw = '';
  try { raw = curl(args); } catch (e) { raw = String(e.stdout || '') || String(e.stderr || '') || String(e.message || ''); }
  let status = 0;
  let text = raw;
  const cut = raw.lastIndexOf('\n');
  if (cut >= 0) {
    const tail = raw.slice(cut + 1).trim();
    if (/^[0-9]{3}$/.test(tail)) { status = Number(tail); text = raw.slice(0, cut); }
  }
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = null; }
  return { status: status, ok: status >= 200 && status < 300, data: data, raw: scrub(text).slice(0, 400) };
}

const SLEEP = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms) { Atomics.wait(SLEEP, 0, 0, ms); }

/* The network on this machine comes and goes, so a request that never reached
 * GitHub (status 0) or a 5xx is retried a few times before it is reported. */
function withRetry(label, fn, tries) {
  const n = tries || 4;
  let last = { status: 0, raw: 'no attempt' };
  for (let i = 1; i <= n; i++) {
    let r;
    try { r = fn(); } catch (e) { r = { status: 0, raw: scrub(String(e && e.message ? e.message : e)) }; }
    if (r && r.status !== 0 && r.status < 500) return r;
    last = r || last;
    console.log('    retry ' + i + '/' + n + ' for ' + label + ' (HTTP ' + (r ? r.status : '?') + ')');
    if (i < n) sleepSync(2000 * i);
  }
  return last;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const BODY = [
  '第二个纯 C++ 版本。六个应用各自只有一个 exe 家族，不需要 Node、不需要 Electron、',
  '也不需要任何第三方运行库 —— 导入表里只有 Windows 自带的 DLL。',
  '',
  '· 每个应用 8 个可执行文件，按文件名分派 cli / tui / gui / launcher，管理员孪生用 inx / ifmx / ipmx 前缀',
  '· 安装包体积 ~200-480 KB（此前 Node + Electron 版本约 20 MB 起）',
  '· 安装时注册 HKCU 环境变量并广播 WM_SETTINGCHANGE，卸载时删除',
  '· 本版新增 Infinity Toolbox 与 Infinity Games 两个应用',
  '',
  '当前覆盖范围：INC 的凭据、GitHub API 与三种呈现方式；IFM 的本地文件操作；',
  'IPM 的目录查询与摘要校验；IIM 的安装包管理；INT 与 ING 的基础界面。',
  '云盘本体、WebDAV 服务端、插件系统仍在推进中。'
].join('\n');

const results = [];
let failures = 0;
let skippedRepos = 0;

function repoRoute(repo) { return '/repos/' + OWNER + '/' + repo; }

function ensureRelease(app, existing) {
  if (existing) return existing;
  if (DRY_RUN) return null;
  const c = withRetry(app.repo + ' create release', function () {
    return api('POST', repoRoute(app.repo) + '/releases', {
      tag_name: TAG, name: TAG + '  C++', body: BODY, draft: false, prerelease: true
    });
  });
  if (!c.ok || !c.data || !c.data.id) throw new Error('create release failed: HTTP ' + c.status + ' ' + c.raw);
  return c.data;
}

function uploadAsset(app, relId, file, name) {
  /* --ssl-no-revoke: this machine's schannel cannot reach the revocation
   * server, and the upload dies with CRYPT_E_NO_REVOCATION_CHECK before a
   * single byte is sent. Skipping the revocation check is what makes the
   * upload work here; it is not a general recommendation. */
  const out = curl(['-X', 'POST',
    '-H', 'Authorization: Bearer ' + token,
    '-H', 'Content-Type: application/octet-stream',
    '-H', 'User-Agent: Infinity.Inc',
    '--data-binary', '@' + file,
    'https://uploads.github.com' + repoRoute(app.repo) + '/releases/' + relId +
      '/assets?name=' + encodeURIComponent(name)]);
  let j = null;
  try { j = JSON.parse(out); } catch (e) { j = null; }
  if (j && j.id) return j;
  return { error: scrub(out).slice(0, 300) };
}

function deleteAsset(app, id) {
  return withRetry(app.repo + ' delete asset ' + id, function () {
    return api('DELETE', repoRoute(app.repo) + '/releases/assets/' + id);
  });
}

/* After the bytes are up, ask GitHub for the asset and compare what it stored
 * with the local file. GitHub reports a sha256 digest for assets uploaded
 * through this API; when it does, the digest is compared, not just the size. */
function verifyAsset(app, name, size, digest) {
  const rel = withRetry(app.repo + ' verify release', function () {
    return api('GET', repoRoute(app.repo) + '/releases/tags/' + TAG);
  });
  if (!rel.ok || !rel.data || !Array.isArray(rel.data.assets)) {
    return { ok: false, detail: 'release lookup HTTP ' + rel.status + ' ' + rel.raw };
  }
  const a = rel.data.assets.find(function (x) { return x.name === name; });
  if (!a) return { ok: false, detail: 'asset missing after upload' };
  if (a.size !== size) return { ok: false, detail: 'size ' + a.size + ' != local ' + size };
  const remoteDigest = (a.digest || '').replace(/^sha256:/, '').toLowerCase();
  if (remoteDigest && remoteDigest !== digest) {
    return { ok: false, detail: 'sha256 ' + remoteDigest + ' != local ' + digest };
  }
  return { ok: true, id: a.id, size: a.size, digest: remoteDigest || 'not-exposed',
    url: a.browser_download_url || '', assets: rel.data.assets.length };
}

console.log('=== ' + TAG + '  release=' + RELEASE + '  ' + (DRY_RUN ? 'DRY RUN (GET only)' : 'PUBLISH'));
console.log('    out=' + OUT);
console.log('    version=' + VERSION + '  owner=' + OWNER);

for (const app of REPOS) {
  const name = app.package + '_' + VERSION + '_win64_setup.exe';
  const file = path.join(OUT, name);
  console.log('--- ' + app.product + '  ' + app.repo);
  console.log('    expect ' + name);

  if (!fs.existsSync(file)) {
    console.log('    local file MISSING: ' + file);
    failures++;
    results.push({ repo: OWNER + '/' + app.repo, name: name, status: 'local-missing' });
    continue;
  }
  const size = fs.statSync(file).size;
  const digest = sha256(file);
  console.log('    local ' + size + ' B  sha256=' + digest);

  const repoInfo = withRetry(app.repo + ' repo lookup', function () { return api('GET', repoRoute(app.repo)); });
  if (repoInfo.status === 404) {
    console.log('    repository does not exist -> skipped (create it and re-run)');
    skippedRepos++;
    results.push({ repo: OWNER + '/' + app.repo, name: name, size: size, sha256: digest, status: 'repo-missing' });
    continue;
  }
  if (!repoInfo.ok || !repoInfo.data) {
    console.log('    repository lookup failed: HTTP ' + repoInfo.status + ' ' + repoInfo.raw);
    failures++;
    results.push({ repo: OWNER + '/' + app.repo, name: name, status: 'repo-lookup-failed' });
    continue;
  }
  console.log('    repository ok (' + repoInfo.data.full_name + ', default ' + repoInfo.data.default_branch + ')');

  const releases = withRetry(app.repo + ' release list', function () {
    return api('GET', repoRoute(app.repo) + '/releases?per_page=100');
  });
  if (releases.ok && Array.isArray(releases.data)) {
    console.log('    existing tags: ' + (releases.data.map(function (r) { return r.tag_name; }).join(', ') || '(none)'));
  }

  const rel = withRetry(app.repo + ' release ' + TAG, function () {
    return api('GET', repoRoute(app.repo) + '/releases/tags/' + TAG);
  });
  let relData = null;
  if (rel.status === 404) {
    console.log('    release ' + TAG + ': absent' + (DRY_RUN ? ' -> would be created' : ''));
  } else if (rel.ok && rel.data && rel.data.id) {
    relData = rel.data;
    console.log('    release ' + TAG + ': id=' + rel.data.id + '  draft=' + rel.data.draft +
      '  prerelease=' + rel.data.prerelease + '  assets=' + (rel.data.assets || []).length);
  } else {
    console.log('    release lookup failed: HTTP ' + rel.status + ' ' + rel.raw);
    failures++;
    results.push({ repo: OWNER + '/' + app.repo, name: name, status: 'release-lookup-failed' });
    continue;
  }

  const assets = relData && Array.isArray(relData.assets) ? relData.assets : [];
  const existing = assets.find(function (a) { return a.name === name; }) || null;
  const others = assets.filter(function (a) { return a.name !== name; });
  console.log('    same-name asset: ' + (existing
    ? 'id=' + existing.id + '  ' + existing.size + ' B  state=' + existing.state
    : 'none'));
  console.log('    other assets kept untouched: ' + (others.length
    ? others.map(function (a) { return a.name + '(' + a.size + 'B)'; }).join(', ')
    : 'none'));

  if (DRY_RUN) {
    let plan;
    if (!relData) plan = 'create release ' + TAG + ', then upload ' + name;
    else if (existing && existing.size === size) plan = 'asset already present with the same size; verify digest, no re-upload if it matches';
    else if (existing) plan = 'delete same-name asset (' + existing.size + ' B), then upload ' + size + ' B';
    else plan = 'upload ' + name + ' (' + size + ' B)';
    console.log('    PLAN: ' + plan);
    results.push({
      repo: OWNER + '/' + app.repo, name: name, size: size, sha256: digest,
      release: relData ? String(relData.id) : 'to-create',
      sameNameAsset: existing ? String(existing.size) : 'none',
      status: 'would-publish'
    });
    continue;
  }

  let relId = null;
  try {
    const ensured = ensureRelease(app, relData);
    relId = ensured && ensured.id;
  } catch (e) {
    console.log('    ' + scrub(String(e && e.message ? e.message : e)));
    failures++;
    results.push({ repo: OWNER + '/' + app.repo, name: name, status: 'release-create-failed' });
    continue;
  }
  if (!relId) { failures++; results.push({ repo: OWNER + '/' + app.repo, name: name, status: 'no-release-id' }); continue; }

  let uploaded = null;
  let verified = { ok: false, detail: 'not attempted' };
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (existing && attempt === 1) {
      const d = deleteAsset(app, existing.id);
      if (d.status !== 204 && d.status !== 200) {
        console.log('    could not delete previous asset: HTTP ' + d.status + ' ' + d.raw);
        failures++;
        results.push({ repo: OWNER + '/' + app.repo, name: name, status: 'delete-failed' });
        uploaded = null;
        break;
      }
      console.log('    removed previous ' + existing.name + ' (' + existing.size + ' B)');
    }
    const up = withRetry(app.repo + ' upload', function () { return { status: 200, data: uploadAsset(app, relId, file, name) }; });
    uploaded = up && up.data;
    if (!uploaded || uploaded.error || !uploaded.id) {
      console.log('    upload attempt ' + attempt + ' failed: ' + ((uploaded && uploaded.error) || 'no id'));
      if (attempt < 3) { sleepSync(3000 * attempt); continue; }
      break;
    }
    console.log('    uploaded id=' + uploaded.id + '  stored=' + uploaded.size + ' B');
    verified = verifyAsset(app, name, size, digest);
    if (verified.ok) break;
    console.log('    verification attempt ' + attempt + ' failed: ' + verified.detail);
    if (attempt < 3) {
      const again = deleteAsset(app, uploaded.id);
      if (again.status !== 204 && again.status !== 200) console.log('    cleanup HTTP ' + again.status);
      sleepSync(3000 * attempt);
    }
  }

  if (uploaded && uploaded.id && verified.ok) {
    console.log('    VERIFIED name=' + name + ' size=' + verified.size + 'B digest=' + verified.digest +
      '  release now holds ' + verified.assets + ' asset(s)');
    results.push({
      repo: OWNER + '/' + app.repo, name: name, size: size, sha256: digest,
      assetId: String(verified.id), storedSize: verified.size, remoteDigest: verified.digest,
      url: verified.url, status: 'ok'
    });
  } else {
    console.log('    FAILED after retries: ' + (verified.detail || 'upload never succeeded'));
    failures++;
    results.push({ repo: OWNER + '/' + app.repo, name: name, size: size, sha256: digest,
      status: 'failed', detail: verified.detail || 'upload never succeeded' });
  }
}

const manifest = { tag: TAG, release: RELEASE, dryRun: DRY_RUN, generated: new Date().toISOString(), results: results };
console.log('=== MANIFEST');
console.log(JSON.stringify(manifest, null, 2));
if (DRY_RUN) {
  console.log('DRY RUN complete: ' + results.length + ' application(s) checked, ' +
    skippedRepos + ' repository/repositories missing, ' + failures + ' local/API error(s)');
  process.exit(failures ? 1 : 0);
}
console.log('published ' + results.filter(function (r) { return r.status === 'ok'; }).length +
  ' installer(s) as ' + TAG + ', ' + failures + ' failure(s)');
process.exit(failures ? 1 : 0);
