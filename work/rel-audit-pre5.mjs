import { execFileSync } from 'node:child_process';
const token = process.env.EV_GH_TOKEN;
const REPOS = ['Infinity-Cloud', 'InfinityPackageManager', 'Infinity-Toolbox'];
function api(route) {
  const out = execFileSync('curl.exe', ['-sS', '--ssl-no-revoke', '-H', 'Authorization: Bearer ' + token,
    '-H', 'Accept: application/vnd.github+json', '-H', 'User-Agent: Infinity.Inc',
    'https://api.github.com' + route], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out);
}
for (const repo of REPOS) {
  const r = api('/repos/zssx-2026/' + repo + '/releases/tags/v1.0.0-pre5');
  console.log(repo + ': tag=' + r.tag_name + ' prerelease=' + r.prerelease + ' draft=' + r.draft + ' bodyChars=' + (r.body || '').length);
  for (const a of r.assets) console.log('   asset ' + a.name + ' ' + a.size + 'B state=' + a.state + ' digest=' + (a.digest || 'none'));
}
const cat = api('/repos/zssx-2026/applications/releases/tags/application-inc');
console.log('\nCATALOG applications/application-inc: assets=' + cat.assets.length);
for (const a of cat.assets) console.log('   ' + a.name + ' ' + a.size + 'B');
