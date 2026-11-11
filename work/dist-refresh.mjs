#!/usr/bin/env node
/*
 * dist-refresh.mjs - rebuild dist/url.json and dist/applist.json from the live
 * catalogue repository (zssx-2026/applications), without uploading anything.
 *
 * The InfinityPackageManager copy under dist/ is the mirror the Node-era IPM
 * reads; the C++ IPM talks to the GitHub catalogue itself. The mirror had not
 * been refreshed since 2026-10-06, so it still advertised v1.0.0-pre5 (and, for
 * the Infinity lines, a "version" of "Infinity.Inc": the catalogue line format
 * puts the company second, while the generic space splitter assumed a version
 * there). This script parses each name.txt line by its own format and falls
 * back to the file name for a release that has no name.txt.
 *
 *   node work/dist-refresh.mjs            rebuild dist/url.json + dist/applist.json
 *   node work/dist-refresh.mjs --dry      print the result, write nothing
 *
 * EV_GH_TOKEN is used when present (higher rate limit); the endpoints are public.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const OWNER = 'zssx-2026';
const CATALOGUE = 'applications';
const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const DRY = process.argv.includes('--dry');
const TOKEN = process.env.EV_GH_TOKEN || '';
const CURL = process.platform === 'win32' ? 'curl.exe' : 'curl';

function curl(args) {
  return execFileSync(CURL, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function api(route) {
  const args = ['-sS', '--ssl-no-revoke', '-H', 'Accept: application/vnd.github+json',
    '-H', 'User-Agent: Infinity.Inc', '-H', 'X-GitHub-Api-Version: 2022-11-28',
    '--max-time', '120', 'https://api.github.com' + route];
  if (TOKEN) args.splice(2, 0, '-H', 'Authorization: Bearer ' + TOKEN);
  try { return JSON.parse(curl(args)); } catch (e) { return null; }
}

function download(url) {
  const args = ['-sS', '-L', '--ssl-no-revoke', '-H', 'Accept: application/octet-stream',
    '-H', 'User-Agent: Infinity.Inc', '--max-time', '120', url];
  if (TOKEN) args.splice(2, 0, '-H', 'Authorization: Bearer ' + TOKEN);
  try { return curl(args); } catch (e) { return null; }
}

function fetchReleases() {
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const data = api('/repos/' + OWNER + '/' + CATALOGUE + '/releases?per_page=100&page=' + page);
    if (!Array.isArray(data) || !data.length) break;
    all.push.apply(all, data);
    if (data.length < 100) break;
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

/* <file> <version> <name> <type> <company> <platform>, whitespace separated.
 * The Infinity lines put the company where the version usually sits, so a
 * second field that does not start with a digit is not a version: the version
 * is then the one embedded in the file name (<name>_<version>_<platform>_...). */
function parseNameLine(line) {
  const tokens = String(line).trim().split(/\s+/);
  if (tokens.length < 3) return null;
  const fileName = tokens[0];
  const m = /^(.+?)_(\d[\w.\-]*)_(win64|winx86|win-arm64|windows|linux|mac)(?:_setup)?(?:\.exe|\.msi)?$/i.exec(fileName);
  let version = tokens[1];
  if (!/^\d/.test(version)) version = m ? m[2] : '';
  const name = tokens[2] || (m ? m[1] : fileName);
  const type = tokens[3] || assetKind(fileName);
  const company = tokens[4] && tokens[4] !== 'null' && tokens[4] !== 'none' ? tokens[4] : null;
  const platform = (tokens[5] || (m ? m[3] : 'win64')).toLowerCase();
  return { fileName: fileName, version: version, name: name, type: type, company: company, platform: platform };
}

function parseNameTxt(raw) {
  const entries = [];
  for (const line of String(raw).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const e = parseNameLine(line);
    if (e) entries.push(e);
  }
  return entries;
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
      const nameAsset = (r.assets || []).find(function (a) { return a.name === 'name.txt'; });
      const raw = nameAsset ? download(nameAsset.browser_download_url) : null;
      const out = {
        id: r.id, tag: r.tag_name, name: r.name, repo: OWNER + '/' + CATALOGUE,
        prerelease: !!r.prerelease, draft: !!r.draft,
        publishedAt: r.published_at, createdAt: r.created_at, htmlUrl: r.html_url,
        assets: (r.assets || []).map(function (a) {
          return {
            id: a.id, name: a.name, size: a.size,
            contentType: a.content_type, downloadCount: a.download_count || 0,
            createdAt: a.created_at, updatedAt: a.updated_at,
            type: assetKind(a.name), url: a.browser_download_url, digest: a.digest || null
          };
        }),
        kind: 'app'
      };
      if (raw) out.nameTxt = { raw: raw, entries: parseNameTxt(raw) };
      return out;
    })
  };
}

function buildApplist(urlJson) {
  const byName = new Map();
  function add(name, type, company, entry) {
    if (!name || !entry.version) return;
    if (!byName.has(name)) byName.set(name, { name: name, type: type || 'setup', company: company || 'Infinity.Inc', versions: [] });
    byName.get(name).versions.push(entry);
  }
  for (const rel of urlJson.releases) {
    const byFile = new Map();
    for (const a of rel.assets) byFile.set(a.name, a);
    if (rel.nameTxt && rel.nameTxt.entries.length) {
      for (const e of rel.nameTxt.entries) {
        const asset = byFile.get(e.fileName);
        if (!asset || e.type === 'other') continue;
        add(e.name, e.type, e.company, {
          version: e.version, tag: rel.tag, fileName: e.fileName, size: asset.size,
          url: asset.url, publishedAt: rel.publishedAt, platform: e.platform
        });
      }
      continue;
    }
    for (const a of rel.assets) {
      if (a.type === 'other' || a.name === 'name.txt') continue;
      const m = /^(.+?)_(\d[\w.\-]*)_(win64|winx86|win-arm64|windows|linux|mac)(?:_setup)?(?:\.exe|\.msi)?$/i.exec(a.name);
      if (!m) continue;
      add(m[1], a.type, null, {
        version: m[2], tag: rel.tag, fileName: a.name, size: a.size,
        url: a.url, publishedAt: rel.publishedAt, platform: m[3].toLowerCase()
      });
    }
  }
  const packages = [];
  for (const e of byName.values()) {
    e.versions.sort(function (a, b) { return String(b.publishedAt).localeCompare(String(a.publishedAt)); });
    e.latest = e.versions[0];
    packages.push(e);
  }
  packages.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  const fileCount = packages.reduce(function (n, p) { return n + p.versions.length; }, 0);
  const now = new Date().toISOString();
  return {
    version: 1, updatedAt: now, count: packages.length,
    stats: { pkgCount: packages.length, releaseCount: urlJson.releases.length, fileCount: fileCount, updatedAt: now },
    packages: packages
  };
}

const releases = fetchReleases();
if (!releases.length) { console.log('no releases fetched'); process.exit(1); }
const urlJson = buildUrlJson(releases);
const applist = buildApplist(urlJson);

console.log('releases=' + urlJson.releases.length + ' packages=' + applist.count + ' files=' + applist.stats.fileCount);
for (const rel of urlJson.releases) {
  console.log('  ' + rel.tag + ' assets=' + rel.assets.length + (rel.nameTxt ? ' nameTxt=' + rel.nameTxt.entries.length : ''));
}
for (const p of applist.packages) if (/^Infinity/.test(p.name)) {
  console.log('  linked: ' + p.name + ' ' + p.latest.version + ' (' + p.versions.length + ' builds, ' + p.latest.platform + ')');
}

if (DRY) { console.log('dry run: nothing written'); process.exit(0); }
fs.writeFileSync(path.join(DIST, 'url.json'), JSON.stringify(urlJson, null, 2), 'utf8');
fs.writeFileSync(path.join(DIST, 'applist.json'), JSON.stringify(applist, null, 2), 'utf8');
console.log('wrote dist/url.json and dist/applist.json');
