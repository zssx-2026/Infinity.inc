/* 卸载通道的端到端断言：装一个组件，再用 Studio 自己的接口把它卸掉。
 * 只跑无窗口服务面（node cli.js），不启动 Electron 窗口。 */
const port = Number(process.argv[2] || 7801);
const asset = String(process.argv[3] || 'InfinityCloud-setup');
const base = 'http://127.0.0.1:' + port;
const checks = [];
function ok(name, pass, detail) { checks.push({ name, pass, detail }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(p) {
  const r = await fetch(base + p);
  return { status: r.status, body: await r.json() };
}
async function postJson(p, body) {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  return { status: r.status, body: await r.json() };
}

const before = await getJson('/v1/remote');
ok('catalog reachable', before.status === 200 && before.body.catalog && before.body.catalog.products.length >= 2, before.status);
/* 安装器自己就在这个目录里，所以基线是 ['studio']，不是空。 */
ok('baseline is only the installer itself', (before.body.installed || []).map((x) => x.id).join(',') === 'studio', JSON.stringify((before.body.installed || []).map((x) => x.id)));

const start = await postJson('/v1/remote/install', { ids: [asset] });
ok('install accepted', start.status === 202, start.status);

let state = null;
const deadline = Date.now() + 600000;
while (Date.now() < deadline) {
  const r = await getJson('/v1/remote/state');
  state = r.body.state || r.body;
  if (state.phase === 'done' || state.phase === 'failed') break;
  await sleep(1000);
}
ok('install finished', state && state.phase === 'done', state && state.phase + ' ' + (state && state.error));

const after = await getJson('/v1/remote');
const installedIds = (after.body.installed || []).map((x) => x.id);
ok('installed list now names the component', installedIds.indexOf('inc') >= 0, JSON.stringify(installedIds));
const dir = (after.body.installed || []).filter((x) => x.id === 'inc')[0];
ok('installed entry carries a directory', !!(dir && dir.dir), dir && dir.dir);

const refusal = await postJson('/v1/remote/uninstall', { ids: ['InfinityStudio-setup'] });
ok('running installer refuses to remove itself', refusal.status === 409 && refusal.body.results[0].error.indexOf('refusing') === 0, JSON.stringify(refusal.body.results && refusal.body.results[0]));

const noIds = await postJson('/v1/remote/uninstall', { ids: [] });
ok('empty id list is a 400', noIds.status === 400, noIds.status);

const gone = await postJson('/v1/remote/uninstall', { ids: [asset] });
const first = (gone.body.results || [])[0];
ok('uninstall answered 200', gone.status === 200, gone.status + ' ' + JSON.stringify(gone.body).slice(0, 200));
ok('uninstaller really removed the directory', !!(first && first.removed === true), JSON.stringify(first));

const finalState = await getJson('/v1/remote');
const finalIds = (finalState.body.installed || []).map((x) => x.id);
ok('only the installer is left installed', finalIds.join(',') === 'studio', JSON.stringify(finalIds));

const failed = checks.filter((c) => !c.pass);
for (const c of checks) console.log((c.pass ? 'ok   ' : 'FAIL ') + c.name + (c.detail !== undefined ? '  [' + c.detail + ']' : ''));
console.log((failed.length ? 'STUDIO-UNINSTALL FAIL ' : 'STUDIO-UNINSTALL PASS ') + (checks.length - failed.length) + '/' + checks.length);
process.exit(failed.length ? 1 : 0);