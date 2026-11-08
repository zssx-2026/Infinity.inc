// work/_gitee/create-mirrors.mjs — create Gitee mirror repos (import by URL) and probe write APIs.
const T = process.env['gitee_zssx-1'];
const API = 'https://gitee.com/api/v5';
const OWNER = 'zssx2026';
const q = 'access_token=' + encodeURIComponent(T);
const call = async (method, path, body) => {
  const res = await fetch(API + path + (path.includes('?') ? '&' : '?') + q, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await res.text(); let b; try { b = JSON.parse(t); } catch { b = t.slice(0, 200); }
  return { status: res.status, body: b };
};

const MIRRORS = [
  { name: 'infinity-inc', gh: 'zssx-2026/Infinity-Inc', desc: 'Infinity Inc' },
  { name: 'infinity-filemanager', gh: 'zssx-2026/Infinity-FileManager', desc: 'Infinity File Manager' },
  { name: 'infinitypackagemanager', gh: 'zssx-2026/InfinityPackageManager', desc: 'Infinity Package Manager' },
  { name: 'infinityinstallermanager', gh: 'zssx-2026/InfinityInstallerManager', desc: 'Infinity Installer Manager' },
  { name: 'infinitytoolbox', gh: 'zssx-2026/InfinityToolbox', desc: 'Infinity Toolbox' },
  { name: 'infinitygames', gh: 'zssx-2026/InfinityGames', desc: 'Infinity Games' },
  { name: 'Infinity.inc', gh: 'zssx-2026/Infinity.inc', desc: 'Infinity.Inc source' },
];
for (const m of MIRRORS) {
  const existing = await call('GET', '/repos/' + OWNER + '/' + encodeURIComponent(m.name));
  if (existing.status === 200) { console.log('EXISTS ' + m.name + ' -> ' + existing.body.html_url); continue; }
  const created = await call('POST', '/user/repos', {
    name: m.name, description: m.desc, private: false, auto_init: false,
    has_issues: false, has_wiki: false, can_comment: true,
  });
  console.log('CREATE ' + m.name + ' status=' + created.status + ' -> ' + (created.body.html_url || JSON.stringify(created.body).slice(0, 120)));
}
const probeRepo = await call('GET', '/repos/' + OWNER + '/infinity-inc');
console.log('--- write-API probes on ' + (probeRepo.body.full_name || 'infinity-inc') + ' ---');
if (probeRepo.status === 200) {
  const blob = await call('POST', '/repos/' + OWNER + '/infinity-inc/git/blobs', { content: Buffer.from('hello').toString('base64'), encoding: 'base64' });
  console.log('POST git/blobs -> ' + blob.status + ' ' + JSON.stringify(blob.body).slice(0, 120));
  const contents = await call('POST', '/repos/' + OWNER + '/infinity-inc/contents/.mirror-probe.txt', { content: Buffer.from('probe').toString('base64'), message: 'probe' });
  console.log('POST contents -> ' + contents.status + ' ' + JSON.stringify(contents.body).slice(0, 160));
}
