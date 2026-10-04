// ipm2-dist.mjs - add the new catalogue pages to dist/url.json and dist/applist.json.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const DIR = 'D:/dev/DeepSeekHarnessWorkspace/Infinity.inc';
const TOKEN = process.env.EV_GH_TOKEN;
const OWNER = 'zssx-2026', REPO = 'applications';
function api(path) {
  return JSON.parse(execFileSync('curl', ['-sS', '--ssl-no-revoke', '-H', 'Authorization: Bearer ' + TOKEN,
    '-H', 'User-Agent: infinity-inc', 'https://api.github.com' + path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
}
const releases = api('/repos/' + OWNER + '/' + REPO + '/releases?per_page=100');
console.log('releases: ' + releases.map(r => r.tag + '=' + (r.assets || []).length).join(', '));
fs.mkdirSync(DIR + '/dist/backup-ipm2', { recursive: true });
for (const f of ['url.json', 'applist.json']) fs.copyFileSync(DIR + '/dist/' + f, DIR + '/dist/backup-ipm2/' + f);
const now = new Date().toISOString();
const url = JSON.parse(fs.readFileSync(DIR + '/dist/url.json', 'utf8'));
url.updatedAt = now;
url.releases = releases.map(r => ({
  id: r.id, tag: r.tag_name, name: r.name, repo: OWNER + '/' + REPO, prerelease: r.prerelease, draft: r.draft,
  publishedAt: r.published_at, createdAt: r.created_at, htmlUrl: r.html_url,
  assets: (r.assets || []).map(a => ({ id: a.id, name: a.name, size: a.size, contentType: a.content_type, downloadCount: a.download_count, createdAt: a.created_at, updatedAt: a.updated_at, url: a.browser_download_url })),
}));
fs.writeFileSync(DIR + '/dist/url.json', JSON.stringify(url), 'utf8');
const list = JSON.parse(fs.readFileSync(DIR + '/dist/applist.json', 'utf8'));
const byName = new Map(list.packages.map(p => [p.name.toLowerCase(), p]));
let added = [];
function versionOf(fileName, pkg) {
  const m = fileName.match(new RegExp('^' + pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_(.+?)_win(64|x86|arm64)', 'i'));
  if (m) return m[1];
  const m2 = fileName.match(/_(\d[\d.\-A-Za-z]*)_/);
  return m2 ? m2[1] : '1.0.0';
}
for (const r of releases) {
  const nt = (r.assets || []).find(a => a.name === 'name.txt');
  if (!nt) continue;
  const txt = execFileSync('curl', ['-sS', '--ssl-no-revoke', '-L', '-H', 'Authorization: Bearer ' + TOKEN,
    '-H', 'Accept: application/octet-stream', 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/releases/assets/' + nt.id],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  for (const line of txt.split(/\r?\n/).filter(Boolean)) {
    const p = line.trim().split(/\s+/);
    if (p.length < 6) continue;
    const asset = (r.assets || []).find(a => a.name === p[0]);
    if (!asset) { console.log('skip (asset missing): ' + line.slice(0, 80)); continue; }
    const pkg = p[2], kind = p[3], company = p[4];
    const version = versionOf(asset.name, pkg);
    const v = { version, tag: r.tag_name, fileName: asset.name, size: asset.size, url: asset.browser_download_url, publishedAt: r.published_at };
    const key = pkg.toLowerCase();
    if (byName.has(key)) {
      const e = byName.get(key);
      if (!e.versions.some(x => x.fileName === asset.name)) e.versions.push(v);
      e.latest = v; e.type = kind; e.company = company;
    } else {
      const e = { name: pkg, type: kind, company, latest: v, versions: [v] };
      list.packages.push(e); byName.set(key, e); added.push(pkg + ' ' + version + ' (' + kind + ', ' + asset.size + ' B)');
    }
  }
}
list.updatedAt = now;
list.count = list.packages.length;
list.stats = { pkgCount: list.packages.length, releaseCount: releases.length, fileCount: releases.reduce((n, r) => n + (r.assets || []).length, 0), updatedAt: now };
fs.writeFileSync(DIR + '/dist/applist.json', JSON.stringify(list), 'utf8');
console.log('added: ' + (added.join(', ') || 'none'));
console.log('count=' + list.count + ' releases=' + list.stats.releaseCount + ' files=' + list.stats.fileCount);
console.log('url.json releases=' + url.releases.length + ' bytes=' + fs.statSync(DIR + '/dist/url.json').size + ' applist bytes=' + fs.statSync(DIR + '/dist/applist.json').size);
const mirror = DIR + '/InfinityPackageManager/InfinityPackageManager/applist.json';
if (fs.existsSync(mirror)) { fs.copyFileSync(mirror, DIR + '/dist/backup-ipm2/applist.bundled.json'); fs.copyFileSync(DIR + '/dist/applist.json', mirror); console.log('bundled applist updated'); }
