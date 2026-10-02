/*
 * link-infinity.mjs - put the Infinity suite into InfinityPackageManager.
 *
 * IPM is a package manager, and the three applications it belongs to were the
 * one thing it could not install. This closes that loop: the nine installers
 * are published as a release on the catalogue repository, and the catalogue
 * IPM reads at startup - applist.json and url.json - is regenerated so the
 * three applications appear there like any other package.
 *
 * The catalogue repository is zssx-2026/applications, which is where every
 * other package in the list already lives. Nothing here writes to a source
 * repository: the applications' own repositories keep their source, and every
 * binary goes to a release.
 *
 * Existing entries are preserved. The catalogue is rebuilt from the API, so
 * whatever the repository holds wins, and the Infinity entries are then
 * merged in explicitly - if a release already carries them they are replaced
 * rather than duplicated.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import https from 'node:https';
import { execFileSync } from 'node:child_process';

const NL = String.fromCharCode(10);
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const APP = path.join(ROOT, 'InfinityPackageManager');
const REPO_ROOT = path.resolve(ROOT, '..');

const OWNER = 'zssx-2026';
const CATALOGUE = 'applications';
const TAG = process.argv[2] || 'infinity-v1.0pre2';
const VERSION = TAG.replace(/^infinity-/, '');
const TOKEN = process.env.EV_GH_TOKEN || '';

/* The nine installers, and the package name each one belongs to. */
const APPS = [
  { name: 'InfinityCloud', label: 'Infinity Cloud', company: 'Infinity.Inc', dir: REPO_ROOT + '/Infinity Cloud/sourcecode/build/setup' },
  { name: 'InfinityFileManager', label: 'Infinity File Manager', company: 'Infinity.Inc', dir: REPO_ROOT + '/Infinity File Manager/sourcecode/build/setup' },
  { name: 'InfinityPackageManager', label: 'InfinityPackageManager', company: 'Infinity.Inc', dir: REPO_ROOT + '/InfinityPackageManager/build/setup' }
];
const PLATFORMS = ['win64', 'winx86', 'win-arm64'];

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

function ensureRelease(tag) {
  return api('GET', '/repos/' + OWNER + '/' + CATALOGUE + '/releases/tags/' + tag).then(function (g) {
    if (g.status === 200 && g.data && g.data.id) { log('release ' + tag + ' exists'); return g.data; }
    return api('POST', '/repos/' + OWNER + '/' + CATALOGUE + '/releases', {
      tag_name: tag, name: 'Infinity.Inc ' + VERSION, draft: false, prerelease: true,
      body: 'Infinity.Inc suite ' + VERSION + ' - Infinity Cloud, Infinity File Manager, InfinityPackageManager.'
    }).then(function (c) {
      if (c.status !== 201) throw new Error('cannot create the release: ' + c.status + ' ' + scrub(c.error || ''));
      log('release ' + tag + ' created');
      return c.data;
    });
  });
}

function upload(releaseId, file, assetName) {
  const out = execFileSync('curl', [
    '-sS', '--ssl-no-revoke', '-X', 'POST',
    '-H', 'Authorization: Bearer ' + TOKEN,
    '-H', 'Content-Type: application/octet-stream',
    '--data-binary', '@' + file,
    'https://uploads.github.com/repos/' + OWNER + '/' + CATALOGUE + '/releases/' + releaseId + '/assets?name=' + encodeURIComponent(assetName)
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 });
  const j = JSON.parse(out);
  return { id: j.id, name: j.name, size: j.size, url: j.browser_download_url, state: j.state };
}

/* The catalogue is rebuilt from the repository, so a package added by anyone
 * else is picked up too. */
async function fetchReleases() {
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const r = await api('GET', '/repos/' + OWNER + '/' + CATALOGUE + '/releases?per_page=100&page=' + page);
    if (r.status !== 200 || !Array.isArray(r.data) || !r.data.length) break;
    all.push.apply(all, r.data);
    if (r.data.length < 100) break;
  }
  return all;
}

function assetKind(name) {
  const n = String(name).toLowerCase();
  if (n.indexOf('_setup') >= 0 || n.indexOf('-setup') >= 0 || n.endsWith('.msi')) return 'setup';
  if (n.indexOf('portable') >= 0 || n.indexOf('green') >= 0 || n.indexOf('noinstall') >= 0) return 'port';
  if (n.endsWith('.zip') || n.endsWith('.7z') || n.endsWith('.tar.gz')) return 'port';
  return 'other';
}

function buildUrlJson(releases) {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    source: {
      owner: OWNER, repo: CATALOGUE,
      api: 'https://api.github.com/repos/' + OWNER + '/' + CATALOGUE + '/releases',
      releases: 'https://github.com/' + OWNER + '/' + CATALOGUE + '/releases'
    },
    releases: releases.map(function (r) {
      return {
        id: r.id, tag: r.tag_name, name: r.name, repo: OWNER + '/' + CATALOGUE,
        prerelease: !!r.prerelease, draft: !!r.draft,
        publishedAt: r.published_at, createdAt: r.created_at, htmlUrl: r.html_url,
        assets: (r.assets || []).map(function (a) {
          return {
            id: a.id, name: a.name, size: a.size,
            contentType: a.content_type, downloadCount: a.download_count || 0,
            createdAt: a.created_at, updatedAt: a.updated_at,
            type: assetKind(a.name), url: a.browser_download_url
          };
        })
      };
    })
  };
}

/* An asset name carries everything the list needs: package, version and
 * platform, in the same order the other entries use. */
function parseAsset(asset, release) {
  const m = /^([A-Za-z0-9._-]+?)[_-]v?(\d[\w.]*?)[_-](win64|winx86|win-arm64|windows|linux|mac)(?:_setup)?(?:\.exe|\.msi)?$/i.exec(asset.name);
  if (!m) return null;
  return {
    name: m[1], version: m[2], platform: m[3].toLowerCase(),
    tag: release.tag, fileName: asset.name, size: asset.size,
    url: asset.url, publishedAt: release.publishedAt || release.published_at,
    type: assetKind(asset.name)
  };
}

function buildApplist(urlJson, previous) {
  const byName = new Map();
  for (const rel of urlJson.releases) {
    for (const a of rel.assets) {
      const p = parseAsset(a, rel);
      if (!p || p.type === 'other') continue;
      if (!byName.has(p.name)) byName.set(p.name, { name: p.name, type: p.type, company: 'Infinity.Inc', versions: [] });
      const e = byName.get(p.name);
      e.versions.push({ version: p.version, tag: p.tag, fileName: p.fileName, size: p.size, url: p.url, publishedAt: p.publishedAt, platform: p.platform });
    }
  }

  /* Anything the parser could not name keeps the entry it already had. */
  const packages = [];
  const seen = new Set();
  for (const p of (previous.packages || [])) {
    if (byName.has(p.name)) continue;
    packages.push(p); seen.add(p.name);
  }
  for (const e of byName.values()) {
    e.versions.sort(function (a, b) { return String(b.publishedAt).localeCompare(String(a.publishedAt)); });
    e.latest = e.versions[0];
    packages.push(e);
  }
  packages.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });

  const fileCount = packages.reduce(function (n, p) { return n + p.versions.length; }, 0);
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    count: packages.length,
    stats: { pkgCount: packages.length, releaseCount: urlJson.releases.length, fileCount: fileCount, updatedAt: new Date().toISOString() },
    packages: packages
  };
}

async function main() {
  if (!TOKEN) { log('NO TOKEN'); process.exit(1); }

  const rel = await ensureRelease(TAG);
  const have = new Set((rel.assets || []).map(function (a) { return a.name; }));

  log('');
  for (const app of APPS) {
    for (const plat of PLATFORMS) {
      const file = path.join(app.dir, plat + '.exe');
      if (!fs.existsSync(file)) { log('  missing ' + file); continue; }
      const assetName = app.name + '_' + VERSION + '_' + plat + '_setup.exe';
      if (have.has(assetName)) {
        const existing = rel.assets.find(function (a) { return a.name === assetName; });
        if (existing && existing.size === fs.statSync(file).size) { log('  ' + assetName + ' already current'); continue; }
        await api('DELETE', '/repos/' + OWNER + '/' + CATALOGUE + '/releases/assets/' + existing.id);
      }
      const up = upload(rel.id, file, assetName);
      log('  ' + assetName + '  ' + up.size + ' B  ' + up.state);
    }
  }

  log('');
  log('rebuilding the catalogue');
  const releases = await fetchReleases();
  const urlJson = buildUrlJson(releases);
  const applistPath = path.join(APP, 'applist.json');
  const previous = JSON.parse(fs.readFileSync(applistPath, 'utf8'));
  const applist = buildApplist(urlJson, previous);

  fs.writeFileSync(applistPath, JSON.stringify(applist, null, 2), 'utf8');
  fs.writeFileSync(path.join(APP, 'url.json'), JSON.stringify(urlJson, null, 2), 'utf8');

  log('  packages ' + applist.count + '  files ' + applist.stats.fileCount + '  releases ' + urlJson.releases.length);
  for (const p of applist.packages) if (/^Infinity/.test(p.name)) log('  linked: ' + p.name + ' ' + p.latest.version + ' (' + p.versions.length + ' builds)');
  log('');
  log('done');
}

main().catch(function (e) { console.error(scrub(String(e && e.message ? e.message : e))); process.exit(1); });
