// gen-releases-json.mjs - the static release list the download pages read first.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const TOKEN = process.env.EV_GH_TOKEN;
const OWNER = 'zssx-2026';
const REPOS = ['Infinity-Cloud', 'Infinity-File-Manager', 'InfinityPackageManager', 'Infinity-Installer-Manager', 'Infinity-Toolbox', 'Infinity-Games'];
function api(path) {
  const out = execFileSync('curl', ['-sS', '--ssl-no-revoke', '--max-time', '60',
    '-H', 'Authorization: Bearer ' + TOKEN, '-H', 'User-Agent: infinity-inc',
    '-H', 'Accept: application/vnd.github+json', 'https://api.github.com' + path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out);
}
const data = { version: 1, generatedAt: new Date().toISOString(), owner: OWNER, repos: {} };
let assetCount = 0;
for (const repo of REPOS) {
  const rels = api('/repos/' + OWNER + '/' + repo + '/releases?per_page=30');
  if (!Array.isArray(rels)) { console.log(repo + ' -> ' + JSON.stringify(rels).slice(0, 120)); continue; }
  data.repos[repo] = rels.map(r => ({
    tag_name: r.tag_name, name: r.name, prerelease: r.prerelease, draft: r.draft,
    published_at: r.published_at, html_url: r.html_url,
    assets: (r.assets || []).map(a => ({ name: a.name, size: a.size, created_at: a.created_at, browser_download_url: a.browser_download_url, digest: a.digest || '' })),
  }));
  assetCount += data.repos[repo].reduce((n, r) => n + r.assets.length, 0);
  console.log(repo + ' releases=' + data.repos[repo].length + ' assets=' + data.repos[repo].reduce((n, r) => n + r.assets.length, 0));
}
try {
  data.bundles = JSON.parse(fs.readFileSync('work/archive-bundles.json', 'utf8'));
  console.log('bundles: ' + Object.keys(data.bundles).length + ' repos / ' + Object.values(data.bundles).reduce((n, l) => n + l.length, 0) + ' archives');
} catch (e) { data.bundles = {}; console.log('no archive-bundles.json yet'); }
fs.writeFileSync('web/infinity/assets/releases.json', JSON.stringify(data));
console.log('releases.json bytes=' + fs.statSync('web/infinity/assets/releases.json').size + ' assets=' + assetCount);
