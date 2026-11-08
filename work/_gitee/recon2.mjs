// work/_gitee/recon2.mjs — list Gitee repos and probe Git Data API support (read-only, never prints token)
const T = process.env['gitee_zssx-1'];
const API = 'https://gitee.com/api/v5';
const q = '?access_token=' + encodeURIComponent(T);
const j = async (url, opt) => { const r = await fetch(url, opt); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t.slice(0, 200); } return { status: r.status, body: b }; };

const repos = [];
for (let page = 1; page <= 5; page++) {
  const r = await j(API + '/user/repos' + q + '&per_page=100&page=' + page + '&sort=updated');
  if (r.status !== 200 || !Array.isArray(r.body)) { console.log('repos page ' + page + ' status=' + r.status); break; }
  repos.push(...r.body.map(x => ({ full: x.full_name, private: x.private, fork: x.fork, desc: (x.description || '').slice(0, 40) })));
  if (r.body.length < 100) break;
}
console.log('repos total=' + repos.length);
for (const r of repos.slice(0, 60)) console.log('  ' + r.full + (r.private ? ' [private]' : '') + (r.fork ? ' [fork]' : '') + '  ' + r.desc);

const probe = repos.find(r => r.full.endsWith('/Sink')) || repos[0];
if (probe) {
  const owner = probe.full.split('/')[0], name = probe.full.split('/')[1];
  for (const p of ['/git/trees/master?recursive=1', '/branches', '/releases', '/git/blobs', '/contents/']) {
    const r = await j(API + '/repos/' + owner + '/' + name + p + (p.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(T));
    const shape = Array.isArray(r.body) ? ('array len=' + r.body.length) : (typeof r.body === 'object' ? Object.keys(r.body).slice(0, 6).join(',') : String(r.body).slice(0, 60));
    console.log('probe ' + probe.full + p + ' -> ' + r.status + '  ' + shape);
  }
}
console.log('--- whoami ---');
const me = await j(API + '/user' + q);
console.log('login=' + (me.body.login || '?'));
