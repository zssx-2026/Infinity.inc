const base = 'http://127.0.0.1:7799';
const get = async (p) => (await fetch(base + p)).json();
const post = async (p, b) => (await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) })).json();

let r = await get('/v1/remote');
console.log('initial base=' + r.base + ' error=' + (r.error || 'none') + ' products=' + ((r.catalog && r.catalog.products) || []).length);

r = await post('/v1/remote/refresh', {});
const prods = (r.catalog && r.catalog.products) || [];
console.log('refresh base=' + r.base + ' version=' + (r.catalog && r.catalog.version) + ' error=' + (r.error || 'none'));
for (const p of prods) console.log('  ' + p.id + ' ' + p.asset + ' size=' + p.size + ' sha=' + String(p.sha256).slice(0, 12) + ' url=' + (p.url ? 'yes' : 'no'));

const start = await post('/v1/remote/install', { ids: ['InfinityServer-setup'] });
console.log('install start chosen=' + JSON.stringify(start.chosen) + ' ok=' + start.ok);

let last = '';
const t0 = Date.now();
for (;;) {
  await new Promise((res) => setTimeout(res, 1500));
  const s = await get('/v1/remote/state');
  const line = s.phase + ' ' + s.received + '/' + s.expected + ' idx=' + s.index + '/' + s.total + ' current=' + s.current;
  if (line !== last) { console.log('  ' + line); last = line; }
  if (!s.running) {
    console.log('final phase=' + s.phase + ' error=' + (s.error || 'none') + ' elapsed=' + Math.round((Date.now() - t0) / 1000) + 's');
    console.log('results=' + JSON.stringify(s.results));
    for (const l of s.log.slice(-8)) console.log('  log ' + l.text);
    break;
  }
  if (Date.now() - t0 > 480000) { console.log('TIMEOUT'); break; }
}
