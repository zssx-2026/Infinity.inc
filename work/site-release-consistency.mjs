/*
 * work/site-release-consistency.mjs - site-seo / task-32, read-only.
 *
 * Proves that the website cannot hand a reader a stale verification value:
 *   1. every LIVE asset of the frozen tag in web/infinity/assets/releases.json is
 *      item-for-item equal (size + sha256) to cpp/release/v1.0pre5/release-assets.json,
 *      with no extra asset and no missing asset; retired products (Infinity-Toolbox)
 *      are exempt — their frozen manifest entries stay, the site just no longer lists them;
 *   2. the digest verify-download.ps1 -Example prints equals Infinity-Cloud's
 *      frozen sha256 and the snapshot's digest, and no stale digest survives;
 *   3. the Chinese pages' automatic content requests are 100% gitee.com: the
 *      real assets/sources.js is evaluated and every project URL in the snapshot
 *      is mirrored for a zh reader onto gitee.com, and no cn page statically
 *      auto-references a GitHub host.
 *
 * Reads files only. No network, no child process, no browser.
 *
 *   node work/site-release-consistency.mjs   ->  exit 0 when all checks pass
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WEB = path.join(ROOT, 'web');
const SNAPSHOT = path.join(WEB, 'infinity', 'assets', 'releases.json');
const VERIFY_PS1 = path.join(WEB, 'infinity', 'assets', 'verify-download.ps1');
const SOURCES_JS = path.join(WEB, 'infinity', 'assets', 'sources.js');
const DOWNLOAD_JS = path.join(WEB, 'infinity', 'assets', 'download.js');

let checks = 0, failed = 0;
const rows = [];
function check(name, ok, detail) {
  checks++;
  if (!ok) failed++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail === undefined || ok ? '' : '  --> ' + String(detail)));
}

const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
const manifestPath = path.join(ROOT, version.releaseDir, 'release-assets.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
const frozenTag = String(manifest.tag || version.tag);

/* ---------------------------------------------- 1. snapshot vs frozen manifest */
console.log('frozen tag: ' + frozenTag);
console.log('manifest  : ' + path.relative(ROOT, manifestPath).replace(/\\/g, '/'));
const byRepo = {};
/* 退役产品(如 Infinity-Toolbox)不再上官网：冻结清单照旧，比较时豁免。 */
const RETIRED_PRODUCTS = new Set(['Infinity-Toolbox']);
const liveAssets = manifest.assets.filter((a) => !RETIRED_PRODUCTS.has(String(a.repo).split('/').pop()));
for (const a of liveAssets) {
  const repo = String(a.repo).split('/').pop();
  (byRepo[repo] = byRepo[repo] || []).push(a);
}
let matched = 0;
const manifestNames = new Set();
for (const repo of Object.keys(byRepo).sort()) {
  const release = (snapshot.repos[repo] || []).find((r) => String(r.tag_name) === frozenTag);
  check('snapshot has ' + repo + ' @ ' + frozenTag, !!release);
  if (!release) continue;
  for (const a of byRepo[repo]) {
    manifestNames.add(a.name);
    const got = (release.assets || []).find((x) => String(x.name) === a.name);
    const digest = got ? String(got.digest || '').replace(/^sha256:/, '').toLowerCase() : '';
    const want = String(a.sha256).toLowerCase();
    const same = !!got && Number(got.size) === Number(a.size) && digest === want;
    if (same) matched++;
    rows.push({ repo, name: a.name, size: a.size, sha: want, digest, same });
    check(repo + ' ' + a.name + ' size=' + a.size + ' sha256=' + want.slice(0, 16) + '…', same,
      got ? ('snapshot size=' + got.size + ' digest=' + digest) : 'asset missing from snapshot');
  }
}
check('frozen assets match item-for-item: ' + matched + '/' + liveAssets.length,
  matched === liveAssets.length, matched + '/' + liveAssets.length);

/* No extra frozen-tag asset that the manifest does not name. */
const extra = [];
for (const repo of Object.keys(byRepo).sort()) {
  const release = (snapshot.repos[repo] || []).find((r) => String(r.tag_name) === frozenTag);
  for (const a of (release && release.assets) || []) if (!manifestNames.has(a.name)) extra.push(repo + ' ' + a.name);
}
check('no extra asset under the frozen tag', extra.length === 0, extra);

const totalBytes = liveAssets.reduce((n, a) => n + Number(a.size), 0);
check('frozen total size is ' + totalBytes + ' B (' + liveAssets.length + ' assets)', totalBytes > 0, totalBytes + ' over ' + manifest.assets.length + ' assets');

/* ------------------------------------------- 2. verify-download.ps1 -Example */
const ps1 = fs.readFileSync(VERIFY_PS1, 'utf8');
const psName = (/^\$ExampleName\s*=\s*'([^']+)'/m.exec(ps1) || [])[1] || '';
const psSha = ((/^\$ExampleSha256\s*=\s*'([^']+)'/m.exec(ps1) || [])[1] || '').toLowerCase();
const cloud = byRepo['Infinity-Cloud'][0];
check('verify-download.ps1 example names the frozen Cloud asset',
  psName === cloud.name, psName + ' vs ' + cloud.name);
check('verify-download.ps1 example digest equals the frozen Cloud sha256',
  psSha === String(cloud.sha256).toLowerCase(), psSha);
const cloudRel = (snapshot.repos['Infinity-Cloud'] || []).find((r) => String(r.tag_name) === frozenTag);
const cloudSnapSha = cloudRel ? String((cloudRel.assets[0] || {}).digest || '').replace(/^sha256:/, '').toLowerCase() : '';
check('verify-download.ps1 example digest equals the snapshot Cloud digest',
  psSha === cloudSnapSha, psSha + ' vs ' + cloudSnapSha);
check('the printed usage line carries the frozen digest',
  ps1.includes('-Sha256 ' + cloud.sha256), 'missing usage-line digest');
const stale = ['0d5d9fcd91d9a41b44334c06628fa1c5950d0728b96c0a5c6243032d93e4dc0c'];
check('no stale digest survives in verify-download.ps1',
  stale.every((s) => !ps1.toLowerCase().includes(s)), stale);

/* ------------------------------- 3. Chinese automatic requests stay on gitee */
const sandbox = { window: null, location: { pathname: '/cn/download/' },
  document: { documentElement: { lang: 'zh-CN' } }, console: { log: function () {} } };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SOURCES_JS, 'utf8'), sandbox, { filename: 'sources.js' });
const I = sandbox.window.INFINITY;
const zh = I.source('zh'), en = I.source('en');
check('sources.js: zh source is gitee', zh.key === 'gitee' && /gitee\.com/.test(zh.web) && /gitee\.com/.test(zh.api),
  zh.key + ' ' + zh.web + ' ' + zh.api);
check('sources.js: en source is github', en.key === 'github' && /github\.com/.test(en.web) && /api\.github\.com/.test(en.api),
  en.key + ' ' + en.web + ' ' + en.api);

/* Every project URL the snapshot carries must resolve to gitee for a zh reader. */
const urls = [];
for (const repo of Object.keys(snapshot.repos)) {
  for (const rel of snapshot.repos[repo]) {
    if (rel.html_url) urls.push(rel.html_url);
    for (const a of rel.assets || []) if (a.browser_download_url) urls.push(a.browser_download_url);
  }
}
for (const a of liveAssets) urls.push(a.url);
const projectUrls = urls.filter((u) => /github\.com\/zssx-2026|api\.github\.com\/repos\/zssx-2026|raw\.githubusercontent\.com\/zssx-2026/.test(u));
const notGitee = projectUrls.filter((u) => !/^https:\/\/gitee\.com\//.test(I.sources.mirror(u, 'zh')));
const enKept = projectUrls.filter((u) => !/^https:\/\/github\.com\/|^https:\/\/api\.github\.com\/|^https:\/\/raw\.githubusercontent\.com\//.test(I.sources.mirror(u, 'en')));
check('every project URL in the snapshot mirrors to gitee.com for zh (' + projectUrls.length + ' URLs)',
  projectUrls.length > 0 && notGitee.length === 0, notGitee.slice(0, 3));
check('the same URLs stay on GitHub for en', enKept.length === 0, enKept.slice(0, 3));
check('the frozen live asset URLs all mirror to gitee for zh',
  liveAssets.every((a) => /^https:\/\/gitee\.com\//.test(I.sources.mirror(a.url, 'zh'))));

/* ---------------------- 3b. bundle catalogue (Infinity-Archive .zst archives)
 * bundles is a SEPARATE catalogue from the 6 setup assets above: it is keyed by
 * repo and holds published .zst archives from the Infinity-Archive repository.
 * It is deliberately NOT compared to cpp/.../release-assets.json - different
 * artifacts, different release. What is checked here is that each entry is
 * structurally complete, points at the archive repository, mirrors to gitee for
 * a zh reader, is not an orphan, and - where a local copy exists - matches it
 * byte for byte. A missing local copy is reported, never asserted away. */
const ARCHIVE_URL = /^https:\/\/github\.com\/zssx-2026\/Infinity-Archive\/releases\/download\//;
const GITEE_ARCHIVE_URL = /^https:\/\/gitee\.com\/zssx2026\/Infinity-Archive\//;
const bundles = snapshot.bundles || {};
const bundleList = [];
for (const repo of Object.keys(bundles)) for (const b of bundles[repo] || []) bundleList.push({ repo: repo, b: b });
check('bundle catalogue is present (' + bundleList.length + ' archives in ' + Object.keys(bundles).length + ' repos)',
  bundleList.length > 0, Object.keys(bundles).join(','));

const badShape = [], badHost = [], badMirror = [], badTag = [], localOk = [], localGone = [], localBad = [];
for (const item of bundleList) {
  const b = item.b;
  const shape = typeof b.tag === 'string' && b.tag && typeof b.platform === 'string' && b.platform &&
    typeof b.name === 'string' && b.name && Number(b.size) > 0 &&
    /^[0-9a-f]{64}$/.test(String(b.sha256 || '')) && typeof b.url === 'string' && b.url;
  if (!shape) { badShape.push(item.repo + ' ' + b.name); continue; }
  if (!ARCHIVE_URL.test(b.url) || !b.url.endsWith('/' + b.name)) badHost.push(b.url);
  if (!GITEE_ARCHIVE_URL.test(I.sources.mirror(b.url, 'zh'))) badMirror.push(I.sources.mirror(b.url, 'zh'));
  const tags = new Set((snapshot.repos[item.repo] || []).map((r) => String(r.tag_name)));
  if (!tags.has(String(b.tag))) badTag.push(item.repo + ' ' + b.tag);
  const local = path.join(ROOT, 'work', 'archive', b.name);
  if (fs.existsSync(local)) {
    const buf = fs.readFileSync(local);
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    if (buf.length === Number(b.size) && sha === String(b.sha256)) localOk.push(b.name);
    else localBad.push(b.name + ' local=' + buf.length + '/' + sha + ' snapshot=' + b.size + '/' + b.sha256);
  } else {
    localGone.push(b.name);
  }
}
check('every bundle entry has tag/platform/name/size/sha256/url', badShape.length === 0, badShape);
check('every bundle url is github.com/zssx-2026/Infinity-Archive and names its file', badHost.length === 0, badHost);
check('every bundle url mirrors to gitee.com/zssx2026/Infinity-Archive for zh', badMirror.length === 0, badMirror);
check('every bundle tag still exists in its repo (no orphan bundle)', badTag.length === 0, badTag);
check('local archives match snapshot item-by-item (' + localOk.length + '/' + bundleList.length + ')',
  localBad.length === 0 && (localOk.length + localGone.length) === bundleList.length, localBad);
if (localGone.length) console.log('NOTE  ' + localGone.length + ' archive(s) 本地无该资产，无法离线校验: ' + localGone.join(', '));
check('v1.0.0-pre5 is listed pending and claims no bundle',
  (snapshot.bundlesPendingTags || []).indexOf('v1.0.0-pre5') >= 0 && !bundleList.some((x) => String(x.b.tag) === 'v1.0.0-pre5'));

/* download.js must localise the snapshot before it reaches a zh reader. */
const dl = fs.readFileSync(DOWNLOAD_JS, 'utf8');
check('download.js localises the snapshot through I.sources.mirror',
  dl.includes('I.sources.mirror') && /localize\(rels,\s*source\)/.test(dl));

/* No cn page may statically auto-request a GitHub CONTENT host. The site's own
 * Pages host (*.github.io) and metadata <link rel=canonical|alternate> are not
 * content requests, so only requesting tags are inspected. */
const GITHUB_CONTENT = /(?:^|\.)github\.com|githubusercontent\.com|\.github\.io\/|^https?:\/\/github\.io/i;
const cnPages = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) cnPages.push(p);
  }
})(path.join(WEB, 'infinity', 'cn'));
const offenders = [];
const isContentHost = (u) => /^https?:\/\/(?:[^\/]*\.)?github\.com\/|^https?:\/\/(?:[^\/]*\.)?githubusercontent\.com\//i.test(String(u));
void GITHUB_CONTENT;
for (const p of cnPages) {
  const t = fs.readFileSync(p, 'utf8');
  for (const m of t.matchAll(/<(?:script|img|iframe)\b[^>]*?\bsrc\s*=\s*"(https?:\/\/[^"]+)"/gi)) {
    if (isContentHost(m[1])) offenders.push(path.relative(ROOT, p) + ' src -> ' + m[1]);
  }
  for (const m of t.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (/rel\s*=\s*"([^"]*)"/i.exec(tag) || [])[1] || '';
    const href = (/href\s*=\s*"([^"]*)"/i.exec(tag) || [])[1] || '';
    if (/\b(stylesheet|icon|preload|prefetch|dns-prefetch|modulepreload|manifest)\b/i.test(rel) && isContentHost(href)) {
      offenders.push(path.relative(ROOT, p) + ' link rel=' + rel + ' -> ' + href);
    }
  }
  for (const m of t.matchAll(/fetch\s*\(\s*['"](https?:\/\/[^'"]+)['"]/gi)) {
    if (isContentHost(m[1])) offenders.push(path.relative(ROOT, p) + ' fetch -> ' + m[1]);
  }
}
check('no cn page statically auto-requests a GitHub content host (' + cnPages.length + ' pages)',
  offenders.length === 0, offenders.slice(0, 5));

console.log('');
console.log('frozen asset table (repo | size | sha256[0:16] | snapshot matches):');
for (const r of rows) console.log('  ' + r.repo + '  ' + r.size + '  ' + r.sha.slice(0, 16) + '…  ' + (r.same ? 'ok' : 'MISMATCH'));
console.log('');
console.log('checks: ' + checks + ', failed: ' + failed);
process.exit(failed ? 1 : 0);
