const base = 'http://127.0.0.1:7803';
const g = await fetch(base + '/v1/remote').then(r => r.json());
console.log('installed:', JSON.stringify(g.installed));
const r = await fetch(base + '/v1/remote/uninstall', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: ['cloud'] }) });
console.log('status', r.status);
console.log('body', JSON.stringify(await r.json()).slice(0, 600));
