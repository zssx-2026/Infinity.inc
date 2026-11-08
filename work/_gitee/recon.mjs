// work/_gitee/recon.mjs — read-only Gitee API reconnaissance. Never prints the token.
const TOKEN = process.env['gitee_zssx-1'];
const API = 'https://gitee.com/api/v5';
const out = [];
async function probe(label, url, method = 'GET') {
  try {
    const res = await fetch(url, { method, headers: { 'User-Agent': 'infinity-inc-mirror/1.0' } });
    let body = '';
    try { body = await res.text(); } catch {}
    out.push({ label, status: res.status, sample: body.slice(0, 260).replace(/\s+/g, ' ') });
  } catch (e) { out.push({ label, status: 'ERR', sample: String(e).slice(0, 200) }); }
}
if (!TOKEN) { console.log(JSON.stringify({ error: 'no token in env' })); process.exit(1); }
const q = '?access_token=' + encodeURIComponent(TOKEN);
await probe('user', API + '/user' + q);
await probe('user-repos', API + '/user/repos' + q + '&per_page=100&sort=updated');
const login = (() => { const u = out.find(o => o.label === 'user'); try { return JSON.parse('{}') && (JSON.parse(u.sample) || {}).login; } catch { return undefined; } })();
// derive login from full body separately
try {
  const r = await fetch(API + '/user' + q); const j = await r.json(); out.push({ label: 'login', status: r.status, login: j.login, name: j.name, type: j.type });
} catch (e) { out.push({ label: 'login', status: 'ERR', sample: String(e).slice(0, 120) }); }
const who = out.find(o => o.label === 'login');
const owner = who && who.login ? who.login : 'unknown';
for (const name of ['infinity', 'infinity-inc', 'Infinity.inc', 'cn', 'site', 'pages', 'zssx-2026']) {
  await probe('repo:' + name, API + '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(name) + q);
}
// route existence probes (read-only; a 404/405 vs 401/403 tells us if the route exists)
await probe('route:import-GET', API + '/repos/' + encodeURIComponent(owner) + '/import' + q);
await probe('route:import-post-dry', API + '/repos/' + encodeURIComponent(owner) + '/import' + q, 'POST');
await probe('route:pages', API + '/repos/' + encodeURIComponent(owner) + '/infinity/pages' + q);
console.log(JSON.stringify(out, null, 1));
