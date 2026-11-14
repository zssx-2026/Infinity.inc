const base = 'http://127.0.0.1:7721';

async function get(p) {
  const r = await fetch(base + p, { signal: AbortSignal.timeout(20000) });
  return { status: r.status, body: await r.json() };
}

const before = await get('/v1/remote');
console.log('catalog_base=' + before.body.base);
const server = (before.body.catalog.products || []).find((p) => p.asset === 'InfinityServer-setup');
console.log('server_asset=' + server.size + ' ' + server.sha256.slice(0, 12));

const post = await fetch(base + '/v1/remote/install', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ ids: ['InfinityServer-setup'] }),
  signal: AbortSignal.timeout(20000)
});
console.log('install_http=' + post.status + ' ' + (await post.text()));

const t0 = Date.now();
let last = '';
for (;;) {
  await new Promise((r) => setTimeout(r, 700));
  const s = (await get('/v1/remote/state')).body;
  const line = s.phase + ' ' + s.received + '/' + s.expected + ' ' + (s.current || '');
  if (line !== last) { console.log('  [' + ((Date.now() - t0) / 1000).toFixed(1) + 's] ' + line); last = line; }
  if (s.phase === 'done' || s.phase === 'failed') {
    console.log('phase=' + s.phase + ' results=' + JSON.stringify(s.results) + ' error=' + JSON.stringify(s.error));
    for (const l of s.log || []) console.log('  log: ' + l);
    console.log('elapsed=' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
    console.log(s.phase === 'done' && s.results.every((r) => r.ok) ? 'STUDIO-PARALLEL-INSTALL PASS' : 'STUDIO-PARALLEL-INSTALL FAIL');
    process.exit(s.phase === 'done' ? 0 : 1);
  }
  if (Date.now() - t0 > 420000) { console.log('TIMEOUT'); process.exit(1); }
}
