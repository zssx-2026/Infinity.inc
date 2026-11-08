/*
 * data-consistency.test.mjs - offline consistency check of the IPM data files.
 *
 * Reads InfinityPackageManager/InfinityPackageManager/*.json (the data the app
 * ships and reads) and proves the invariants that tie them together:
 *   - applist.json's count/stats agree with the array it carries
 *   - every version URL is a real download URL under the declared repo and its
 *     final path segment is the declared fileName
 *   - every applist version URL appears as an asset in url.json (the download
 *     view cannot offer a build the release snapshot does not have)
 *   - url.json's asset count equals stats.fileCount and its release count
 *     equals stats.releaseCount
 *   - registry.json and .ipm-versions.json describe the same packages with the
 *     same versions, and each is a real applist package at that version
 *
 * No network, no process, no install. Exit 0 = consistent, 1 = regression.
 *
 * Usage: node InfinityPackageManager/tools/data-consistency.test.mjs [dataDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const DIR = process.argv[2] || path.resolve(HERE, '..', 'InfinityPackageManager');
const REPO = 'zssx-2026/applications';
const DOWNLOAD = 'https://github.com/' + REPO + '/releases/download/';
const ALLOWED_TYPES = new Set(['setup', 'port', 'plugin', 'resource', 'pack']);

let checks = 0, failures = 0;
function ok(name, cond, detail) {
  checks++;
  if (!cond) { failures++; console.log('FAIL ' + name + (detail === undefined ? '' : '  >> ' + JSON.stringify(detail))); }
  else console.log('PASS ' + name);
}
function load(file) {
  const p = path.join(DIR, file);
  if (!fs.existsSync(p)) { ok(file + ' exists', false, p); return null; }
  try { const v = JSON.parse(fs.readFileSync(p, 'utf8')); ok(file + ' parses as JSON', true); return v; }
  catch (e) { ok(file + ' parses as JSON', false, String(e.message)); return null; }
}

const applist = load('applist.json');
const snapshot = load('url.json');
const registry = load('registry.json');
const versions = load('.ipm-versions.json');
const pak = load('pak.json');
const settings = load('settings.json');
if (!applist || !snapshot || !registry || !versions) {
  console.log('\nRESULT: FAIL (data files unreadable); ' + (checks - failures) + '/' + checks + ' checks');
  process.exit(1);
}

ok('applist version is 1', applist.version === 1, applist.version);
ok('applist count matches packages.length', applist.count === applist.packages.length, { count: applist.count, len: applist.packages.length });
ok('applist stats.pkgCount matches packages.length', !!applist.stats && applist.stats.pkgCount === applist.packages.length, applist.stats);
ok('applist package names are unique', new Set(applist.packages.map(p => p.name)).size === applist.packages.length);

ok('every package type is known', applist.packages.every(p => ALLOWED_TYPES.has(p.type)), applist.packages.filter(p => !ALLOWED_TYPES.has(p.type)).map(p => p.name + ':' + p.type));
ok('every package has name, latest and versions[]', applist.packages.every(p => p.name && p.latest && Array.isArray(p.versions) && p.versions.length > 0));
ok('every latest has version/fileName/url/size', applist.packages.every(p => p.latest && p.latest.version && p.latest.fileName && p.latest.url && p.latest.size > 0));

const badUrl = [], badName = [], badTag = [], badSize = [];
for (const p of applist.packages) for (const v of p.versions) {
  if (typeof v.url !== 'string' || !v.url.startsWith(DOWNLOAD)) badUrl.push(p.name + ' ' + v.url);
  else {
    if (v.url.split('/').pop() !== v.fileName) badName.push(p.name + ' ' + v.fileName);
    if (!v.url.includes('/releases/download/' + v.tag + '/')) badTag.push(p.name + ' ' + v.tag);
  }
  if (!(v.size > 0)) badSize.push(p.name + ' ' + v.version);
}
ok('every version URL is under ' + DOWNLOAD, badUrl.length === 0, badUrl.slice(0, 5));
ok('every version fileName is the URL final segment', badName.length === 0, badName.slice(0, 5));
ok('every version tag appears in its URL', badTag.length === 0, badTag.slice(0, 5));
ok('every version size is positive', badSize.length === 0, badSize.slice(0, 5));

ok('url.json version is 1', snapshot.version === 1, snapshot.version);
ok('url.json source points at ' + REPO, !!snapshot.source && (snapshot.source.owner + '/' + snapshot.source.repo) === REPO, snapshot.source);
ok('url.json release count matches stats.releaseCount', snapshot.releases.length === applist.stats.releaseCount, { releases: snapshot.releases.length, stat: applist.stats.releaseCount });

const assetUrls = new Set();
const badRepo = [], badAsset = [];
for (const rel of snapshot.releases) {
  if (rel.repo !== REPO) badRepo.push('repo ' + rel.repo);
  for (const a of rel.assets) {
    assetUrls.add(a.url);
    if (!a.url.startsWith(DOWNLOAD + rel.tag + '/')) badAsset.push(rel.tag + ' ' + a.name);
    if (!(a.size > 0)) badAsset.push('size ' + a.name);
  }
}
ok('every release belongs to ' + REPO, badRepo.length === 0, badRepo);
ok('every asset URL is under its release tag with a positive size', badAsset.length === 0, badAsset.slice(0, 5));
ok('snapshot asset count matches stats.fileCount', assetUrls.size === applist.stats.fileCount, { assets: assetUrls.size, stat: applist.stats.fileCount });

const missing = [];
for (const p of applist.packages) for (const v of p.versions) if (!assetUrls.has(v.url)) missing.push(p.name + ' ' + v.fileName);
ok('every applist version URL has a snapshot asset', missing.length === 0, missing.slice(0, 5));

const regNames = Object.keys(registry.packages || {});
const verNames = Object.keys(versions.packages || {});
ok('registry.json and .ipm-versions.json cover the same packages', JSON.stringify([...regNames].sort()) === JSON.stringify([...verNames].sort()), { registry: regNames, versions: verNames });
const regBad = [], verBad = [], appBad = [];
for (const n of regNames) {
  const r = registry.packages[n];
  if (!r.name || !r.version || !r.type || !r.fileName || !r.installedAt) regBad.push(n);
  if (!versions.packages[n] || versions.packages[n].version !== r.version) verBad.push(n);
  const app = applist.packages.find(p => p.name === n);
  if (!app || !app.latest || app.latest.version !== r.version) appBad.push(n + ' applist=' + (app && app.latest && app.latest.version) + ' registry=' + r.version);
}
ok('every registry record has name/version/type/fileName/installedAt', regBad.length === 0, regBad);
ok('every registry version matches .ipm-versions.json', verBad.length === 0, verBad);
ok('every registry version is a real applist build', appBad.length === 0, appBad);

ok('pak.json carries a packages object', !!pak && typeof pak.packages === 'object' && !Array.isArray(pak.packages));
ok('settings.json has sane network limits', !!settings && !!settings.network && settings.network.retries > 0 && settings.network.timeoutMs > 0, settings && settings.network);
const langDir = path.join(DIR, 'lang');
const langs = fs.existsSync(langDir) ? fs.readdirSync(langDir).filter(n => n.endsWith('.lang')) : [];
ok('lang/ ships at least one .lang file', langs.length > 0, langs);

console.log('\n' + (failures ? 'RESULT: FAIL ' : 'RESULT: PASS ') + (checks - failures) + '/' + checks + ' checks');
process.exit(failures ? 1 : 0);
