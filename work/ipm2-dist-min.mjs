// ipm2-dist-min.mjs - append exactly the two new catalogue pages.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const DIR = 'D:/dev/DeepSeekHarnessWorkspace/Infinity.inc';
const TOKEN = process.env.EV_GH_TOKEN;
const OWNER = 'zssx-2026', REPO = 'applications';
const WANT = ['once-power', 'piik'];
const bk = DIR + '/dist/backup-ipm2';
// restore the pre-change snapshots first
for (const f of ['url.json', 'applist.json']) fs.copyFileSync(bk + '/' + f, DIR + '/dist/' + f);
if (fs.existsSync(bk + '/applist.bundled.json')) fs.copyFileSync(bk + '/applist.bundled.json', DIR + '/InfinityPackageManager/InfinityPackageManager/applist.json');
function api(path) {
  return JSON.parse(execFileSync('curl', ['-sS', '--ssl-no-revoke', '-H', 'Authorization: Bearer ' + TOKEN,
    '-H', 'User-Agent: infinity-inc', 'https://api.github.com' + path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
}
const all = api('/repos/' + OWNER + '/' + REPO + '/releases?per_page=100');
const now = new Date().toISOString();
const url = JSON.parse(fs.readFileSync(DIR + '/dist/url.json', 'utf8'));
const list = JSON.parse(fs.readFileSync(DIR + '/dist/applist.json', 'utf8'));
const haveTags = new Set(url.releases.map(r => r.tag));
const byName = new Map(list.packages.map(p => [p.name.toLowerCase(), p]));
let added = [];
for (const r of all) {
  if (!WANT.includes(r.tag_name)) continue;
  if (!haveTags.has(r.tag_name)) {
    url.releases.push({ id: r.id, tag: r.tag_name, name: r.name, repo: OWNER + '/' + REPO, prerelease: r.prerelease, draft: r.draft,
      publishedAt: r.published_at, createdAt: r.created_at, htmlUrl: r.html_url,
      assets: (r.assets || []).map(a => ({ id: a.id, name: a.name, size: a.size, contentType: a.content_type, downloadCount: a.download_count, createdAt: a.created_at, updatedAt: a.updated_at, url: a.browser_download_url })) });
  }
  const nt = (r.assets || []).find(a => a.name === 'name.txt');
  if (!nt) continue;
  const txt = execFileSync('curl', ['-sS', '--ssl-no-revoke', '-L', '-H', 'Authorization: Bearer ' + TOKEN,
    '-H', 'Accept: application/octet-stream', 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/releases/assets/' + nt.id],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  for (const line of txt.split(/\r?\n/).filter(Boolean)) {
    const p = line.trim().split(/\s+/);
    if (p.length < 6) continue;
    const asset = (r.assets || []).find(a => a.name === p[0]);
    if (!asset) continue;
    const pkg = p[2], kind = p[3], company = p[4];
    const m = asset.name.match(/_(\d[\d.\-A-Za-z]*)_win(64|x86|arm64)/i);
    const version = m ? m[1] : '1.0.0';
    const v = { version, tag: r.tag_name, fileName: asset.name, size: asset.size, url: asset.browser_download_url, publishedAt: r.published_at };
    if (byName.has(pkg.toLowerCase())) {
      const e = byName.get(pkg.toLowerCase());
      if (!e.versions.some(x => x.fileName === asset.name)) e.versions.push(v);
      e.latest = v;
    } else {
      const e = { name: pkg, type: kind, company, latest: v, versions: [v] };
      list.packages.push(e); byName.set(pkg.toLowerCase(), e); added.push(pkg + ' ' + version + ' (' + kind + ', ' + asset.size + ' B)');
    }
  }
}
url.updatedAt = now;
list.updatedAt = now;
list.count = list.packages.length;
list.stats = Object.assign({}, list.stats, {
  pkgCount: list.packages.length,
  releaseCount: url.releases.length,
  fileCount: url.releases.reduce((n, r) => n + (r.assets || []).length, 0),
  updatedAt: now,
});
fs.writeFileSync(DIR + '/dist/url.json', JSON.stringify(url), 'utf8');
fs.writeFileSync(DIR + '/dist/applist.json', JSON.stringify(list), 'utf8');
const mirror = DIR + '/InfinityPackageManager/InfinityPackageManager/applist.json';
if (fs.existsSync(mirror)) fs.copyFileSync(DIR + '/dist/applist.json', mirror);
console.log('added: ' + (added.join(', ') || 'none'));
console.log('count=' + list.count + ' releases=' + list.stats.releaseCount + ' files=' + list.stats.fileCount);
console.log('new packages in list: ' + list.packages.filter(p => /^(once_power|piik)$/i.test(p.name)).map(p => JSON.stringify({ name: p.name, type: p.type, company: p.company, latest: p.latest })).join(' | '));
