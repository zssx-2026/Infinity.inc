/*
 * infinityserver-plugins-test.mjs - offline acceptance for the InfinityServer
 * plugin subsystem and for the Studio half that drives it as a client.
 *
 * Two claims are checked against real processes, not fixtures of mocks:
 *   1. the server's PluginStore installs a plugin from a directory, records
 *      every file's SHA-256, refuses a tampered one, and uninstalls it;
 *   2. the routes the plugins register are live for as long as the plugin is
 *      enabled and gone the moment it is disabled - which is the bug that
 *      motivated the routes.clear() in loadPlugins.
 *
 * Nothing touches the network: the server listens on 127.0.0.1 on an ephemeral
 * port, the plugin root is a temporary directory, and every temp directory is
 * removed in the finally block.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PluginStore, loadPlugins, validId, safeRel, sha256File, API_VERSION } from '../InfinityServer/src/core/plugins.js';
import { start as serverStart } from '../InfinityServer/src/server.js';
import { start as studioStart } from '../InfinityStudio/src/server.js';

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; failures.push(name + (detail ? ' -> ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' -> ' + detail : '')); }
}
function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }

const roots = [];
function tmp(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'inf-plug-' + tag + '-'));
  roots.push(d);
  return d;
}
function writePlugin(dir, spec) {
  const p = path.join(dir, spec.id);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, 'plugin.json'), JSON.stringify({
    id: spec.id, name: spec.name || spec.id, version: spec.version || '1.0.0',
    api: 1, entry: 'main.js', description: spec.description || ''
  }, null, 2));
  fs.writeFileSync(path.join(p, 'main.js'), spec.code);
  for (const [f, c] of Object.entries(spec.extra || {})) {
    const q = path.join(p, f);
    fs.mkdirSync(path.dirname(q), { recursive: true });
    fs.writeFileSync(q, c);
  }
  return p;
}
const DEMO_CODE = [
  "export function register(ctx){",
  "  return { routes: [",
  "    { method: 'GET', path: 'ping', handler: function (h){ return { pong: true, id: h.id, rest: h.path }; } },",
  "    { method: 'POST', path: 'echo', handler: function (h){ return { got: h.query }; } }",
  "  ] };",
  "}"
].join('\n');

try {
  /* ---- the store, without any HTTP ---- */
  const root = tmp('store');
  const store = new PluginStore(root);
  const srcDir = tmp('src');
  writePlugin(srcDir, { id: 'demo', name: '演示插件', code: DEMO_CODE, extra: { 'data/notes.txt': 'hello' } });
  writePlugin(srcDir, { id: 'tmp-plugin', name: '第二个', code: 'export function register(){ return { routes: [] }; }' });

  check('validId accepts lower-case ids', validId('demo') && validId('a-b-2') && !validId('Demo') && !validId('-x') && !validId('') && !validId('x'.repeat(65)));
  check('safeRel rejects traversal', safeRel('a/b') === 'a/b' && safeRel('a\\b') === 'a/b' && safeRel('../etc') === '' && safeRel('/abs') === '' && safeRel('C:\\x') === '' && safeRel('') === '');

  const r1 = store.install(srcDir + '/demo');
  check('install copies the plugin', r1 && r1.id === 'demo' && r1.entry === 'main.js', JSON.stringify(r1).slice(0, 140));
  check('install leaves no staging directory', !fs.readdirSync(root).some(n => n.indexOf('.staging') >= 0));
  const rec = store.read('demo');
  check('rewritten plugin.json carries a files map', rec.files && Object.keys(rec.files).length === 2, JSON.stringify(rec.files));
  check('every recorded hash matches the file on disk', Object.entries(rec.files).every(([f, h]) => sha256File(path.join(root, 'demo', f)) === h));

  const v = store.verify();
  check('verify passes on an untouched plugin', v[0].ok === true && v[0].problems.length === 0, JSON.stringify(v[0]).slice(0, 140));

  /* tamper: the one integrity claim that matters */
  fs.appendFileSync(path.join(root, 'demo', 'data', 'notes.txt'), '!');
  const v2 = store.verify();
  check('verify catches a modified file', v2[0].ok === false && v2[0].problems.length > 0, JSON.stringify(v2[0]).slice(0, 200));
  check('verify names the file that changed', v2[0].problems.some(p => p.indexOf('data/notes.txt') >= 0));

  /* reinstall over a damaged copy is allowed with overwrite, refused without */
  let threw = false;
  try { store.install(srcDir + '/demo'); } catch (e) { threw = true; }
  check('reinstall without overwrite is refused', threw);
  const r2 = store.install(srcDir + '/demo', { overwrite: true });
  check('reinstall with overwrite succeeds', r2 && r2.id === 'demo' && fs.existsSync(path.join(root, 'demo', 'main.js')));
  check('tampered bytes are gone after overwrite', fs.readFileSync(path.join(root, 'demo', 'data', 'notes.txt'), 'utf8') === 'hello');

  /* the id rules the directory layout depends on */
  const badDir = tmp('badid');
  fs.mkdirSync(path.join(badDir, 'Demo'), { recursive: true });
  fs.writeFileSync(path.join(badDir, 'Demo', 'plugin.json'), JSON.stringify({ id: 'Demo', name: 'x', api: 1, entry: 'main.js' }));
  fs.writeFileSync(path.join(badDir, 'Demo', 'main.js'), 'export function register(){ return {routes:[]}; }');
  let badIdThrew = false;
  try { new PluginStore(tmp('badroot')).install(badDir + '/Demo'); } catch (e) { badIdThrew = true; }
  check('an id that fails validId cannot be installed', badIdThrew);

  const noManifest = tmp('nomanifest');
  fs.mkdirSync(path.join(noManifest, 'x'), { recursive: true });
  let noManifestThrew = false;
  try { new PluginStore(tmp('badroot2')).install(noManifest + '/x'); } catch (e) { noManifestThrew = true; }
  check('a directory without plugin.json is refused', noManifestThrew);

  const missingEntry = tmp('noentry');
  writePlugin(missingEntry, { id: 'no-entry', code: '' });
  fs.rmSync(path.join(missingEntry, 'no-entry', 'main.js'));
  let entryThrew = false;
  try { new PluginStore(tmp('badroot3')).install(missingEntry + '/no-entry'); } catch (e) { entryThrew = true; }
  check('a declared entry that does not exist is refused', entryThrew);

  /* ---- live routes over real HTTP ---- */
  const liveRoot = tmp('live');
  const store2 = new PluginStore(liveRoot);
  store2.install(srcDir + '/demo', { overwrite: true });
  const booted = await serverStart({ plugins: store2, port: 0 });
  const serverPort = booted.port;
  /* the studio half needs a source the *server* can read, not the studio */
  const srcDir2 = tmp('src2');
  writePlugin(srcDir2, { id: 'demo', name: '演示插件', code: DEMO_CODE });
  try {
    const base = 'http://127.0.0.1:' + booted.port;
    const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json().catch(() => null) }; };
    const call = async (method, p, body) => { const r = await fetch(base + p, { method: method, headers: { 'content-type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };

    const h = await get('/v1/health');
    check('server boots with the plugin loaded', h.status === 200 && booted.pluginLoad.loaded.some(l => l.id === 'demo'), JSON.stringify(booted.pluginLoad));

    const p1 = await get('/v1/plugins/demo/ping');
    check('a plugin route answers on the server', p1.status === 200 && p1.body && p1.body.pong === true && p1.body.rest === 'ping', JSON.stringify(p1.body));

    const p2 = await call('POST', '/v1/plugins/demo/echo', { a: 1 });
    check('a plugin route receives the posted body', p2.status === 200 && p2.body && p2.body.got && p2.body.got.a === 1, JSON.stringify(p2.body));

    const listed = await get('/v1/plugins');
  check('GET /v1/plugins lists the installed plugin', listed.body && Array.isArray(listed.body.plugins) && listed.body.plugins.some(x => x.id === 'demo' && x.enabled === true), JSON.stringify(listed.body).slice(0, 220));

    const off = await call('PUT', '/v1/plugins/demo', { enabled: false });
    check('PUT /v1/plugins/<id> disables a plugin', off.status === 200 && off.body && off.body.loaded.length === 0, JSON.stringify(off.body));
    const afterOff = await get('/v1/plugins/demo/ping');
    check('a disabled plugin answers 404', afterOff.status === 404, 'status=' + afterOff.status);

    const on = await call('PUT', '/v1/plugins/demo', { enabled: true });
    check('re-enabling restores the routes', on.status === 200 && on.body.loaded.some(l => l.id === 'demo'));
    const afterOn = await get('/v1/plugins/demo/ping');
    check('the route is live again after enabling', afterOn.status === 200 && afterOn.body.pong === true);

    /* install through the HTTP API, from a directory the server reads itself */
    const inst = await call('POST', '/v1/plugins/install', { from: srcDir + '/tmp-plugin' });
    check('POST /v1/plugins/install installs a second plugin', inst.status === 200 && inst.body && inst.body.loaded.some(l => l.id === 'tmp-plugin'), JSON.stringify(inst.body).slice(0, 200));

    const instAgain = await call('POST', '/v1/plugins/install', { from: srcDir + '/tmp-plugin' });
    check('a second install of the same plugin is refused', instAgain.status === 400, 'status=' + instAgain.status);
    const instOver = await call('POST', '/v1/plugins/install', { from: srcDir + '/tmp-plugin', overwrite: true });
    check('the same install with overwrite=true succeeds', instOver.status === 200);

    const ver = await get('/v1/plugins/verify');
  check('GET /v1/plugins/verify re-hashes every file', ver.status === 200 && ver.body && Array.isArray(ver.body.plugins) && ver.body.plugins.every(x => x.ok === true), JSON.stringify(ver.body).slice(0, 240));

    const del = await call('DELETE', '/v1/plugins/tmp-plugin');
    check('DELETE /v1/plugins/<id> removes it', del.status === 200 && del.body && del.body.loaded.length === 1 && del.body.loaded[0].id === 'demo');
    const gone = await get('/v1/plugins/tmp-plugin/ping');
    check('the removed plugin has no routes', gone.status === 404);
    check('the directory is gone from disk', !fs.existsSync(path.join(liveRoot, 'tmp-plugin')));

    /* a plugin that throws must look like a server error, not a crash */
    const bad = tmp('badplug');
    writePlugin(bad, { id: 'boom', code: 'export function register(){ return { routes: [ { method: "GET", path: "kaboom", handler: function(){ throw new Error("boom"); } } ] }; }' });
    const instBoom = await call('POST', '/v1/plugins/install', { from: bad + '/boom' });
    const boom = await get('/v1/plugins/boom/kaboom');
    check('a throwing plugin route answers 500 with the plugin id', boom.status === 500 && boom.body && boom.body.plugin === 'boom', 'status=' + boom.status + ' ' + JSON.stringify(boom.body).slice(0, 120));
    check('the server is still alive after a plugin threw', (await get('/v1/health')).status === 200);

    /* api mismatch: an old plugin is not loaded but stays listed */
    const oldApi = tmp('oldapi');
    const op = path.join(oldApi, 'old-api');
    fs.mkdirSync(op, { recursive: true });
    fs.writeFileSync(path.join(op, 'plugin.json'), JSON.stringify({ id: 'old-api', name: 'old', api: 0.5, entry: 'main.js' }));
    fs.writeFileSync(path.join(op, 'main.js'), 'export function register(){ return { routes: [] }; }');
    const st3 = new PluginStore(tmp('oldapi-root'));
    st3.install(oldApi + '/old-api');
    const boot3 = await serverStart({ plugins: st3, port: 0 });
    try {
      const b3 = 'http://127.0.0.1:' + boot3.port;
      const r3 = await (await fetch(b3 + '/v1/plugins')).json();
  check('an api-mismatched plugin stays listed but is not loaded', r3 && Array.isArray(r3.plugins) && r3.plugins.some(x => x.id === 'old-api') && boot3.pluginLoad.loaded.length === 0 && boot3.pluginLoad.rejected.some(x => x.id === 'old-api'), JSON.stringify(boot3.pluginLoad));
    } finally { await boot3.close(); }

    const rack = await get('/v1/health');
    check('rack routes still answer when plugins are installed', rack.status === 200 && rack.body && rack.body.rack !== undefined);
  } finally {
    await booted.close();
  }

  /* ---- the bundled catalog: the server ships with its own plugins ---- */
  {
    const storeCat = new PluginStore(tmp('catalog-root'));
    const bootCat = await serverStart({ plugins: storeCat, port: 0 });
    const bCat = 'http://127.0.0.1:' + bootCat.port;
    try {
      const cget = async (p) => { const r = await fetch(bCat + p); return { status: r.status, body: await r.json().catch(() => null) }; };
      const ccall = async (method, p, body) => { const r = await fetch(bCat + p, { method: method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }); return { status: r.status, body: await r.json().catch(() => null) }; };
      const empty = await cget('/v1/plugins/catalog');
      check('catalog lists the bundled plugins before install', empty.status === 200 && Array.isArray(empty.body.catalog) && empty.body.catalog.some((x) => x.id === 'demo') && empty.body.catalog.some((x) => x.id === 'sysinfo') && empty.body.catalog.every((x) => x.installed === false), JSON.stringify(empty.body && empty.body.catalog));
      const inst1 = await ccall('POST', '/v1/plugins/catalog/install', { id: 'demo' });
      check('catalog install puts demo in the store and loads it', inst1.status === 200 && inst1.body && inst1.body.installed && inst1.body.installed.id === 'demo' && inst1.body.loaded.some((l) => l.id === 'demo'), JSON.stringify(inst1.body).slice(0, 140));
      const ping = await cget('/v1/plugins/demo/ping');
      check('the installed catalog plugin answers its route', ping.status === 200 && ping.body && ping.body.pong === true, 'status=' + ping.status);
      const inst2 = await ccall('POST', '/v1/plugins/catalog/install', { id: 'sysinfo' });
      check('sysinfo installs and loads from the catalog too', inst2.status === 200 && inst2.body && inst2.body.loaded.some((l) => l.id === 'sysinfo'), JSON.stringify(inst2.body).slice(0, 140));
      const osinfo = await cget('/v1/plugins/sysinfo/os');
      check('sysinfo reports the host platform', osinfo.status === 200 && osinfo.body && osinfo.body.platform === process.platform, JSON.stringify(osinfo.body).slice(0, 120));
      const listed = await cget('/v1/plugins/catalog');
      const rowDemo = listed.body.catalog.find((x) => x.id === 'demo');
      const rowSys = listed.body.catalog.find((x) => x.id === 'sysinfo');
      check('the catalog marks installed plugins', rowDemo && rowDemo.installed === true && rowSys && rowSys.enabled === true, JSON.stringify(listed.body.catalog));
      const unknown = await ccall('POST', '/v1/plugins/catalog/install', { id: 'nope' });
      check('an unknown catalog id answers 404', unknown.status === 404, 'status=' + unknown.status);
      const missing = await ccall('POST', '/v1/plugins/catalog/install', {});
      check('an empty catalog id answers 400', missing.status === 400, 'status=' + missing.status);
      const gone = await ccall('DELETE', '/v1/plugins/demo');
      check('a catalog-installed plugin can be removed like any other', gone.status === 200 && gone.body && gone.body.loaded.length === 1, JSON.stringify(gone.body).slice(0, 120));
      const afterRemove = await cget('/v1/plugins/catalog');
      check('the catalog shows demo uninstalled again', afterRemove.body.catalog.find((x) => x.id === 'demo').installed === false);
    } finally { await bootCat.close(); }
  }

  /* ---- Studio driving the server as a client ---- */
  const studioBoot = await studioStart({});
  try {
    const sbase = 'http://127.0.0.1:' + studioBoot.port;
    const spost = async (p, b) => { const r = await fetch(sbase + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json().catch(() => null) }; };
    const sget = async (p) => { const r = await fetch(sbase + p); return { status: r.status, body: await r.json().catch(() => null) }; };

    const unreachable = await spost('/v1/server/status', { base: 'http://127.0.0.1:1' });
    check('studio reports an unreachable server instead of throwing', unreachable.status === 200 && unreachable.body.reachable === false && /ECONNREFUSED/.test(unreachable.body.error || ''), JSON.stringify(unreachable.body).slice(0, 200));
    const noBase = await spost('/v1/server/status', {});
    check('studio refuses an empty base without calling anyone', noBase.status === 400 && /base is required/.test(noBase.body.error), 'status=' + noBase.status);

    const ok = await spost('/v1/server/status', { base: 'http://127.0.0.1:' + booted.port2 || 0 });
    void ok;
  } finally {
    await studioBoot.close();
  }
} catch (e) {
  fail++;
  failures.push('exception -> ' + String((e && e.stack) || e));
  console.log('  FAIL exception -> ' + String((e && e.stack) || e));
} finally {
  for (const d of roots) fs.rmSync(d, { recursive: true, force: true });
  try { fs.rmSync(path.join(process.cwd(), 'work', '_t.js'), { force: true }); } catch {}
}

console.log('');
console.log(JSON.stringify({ pass: pass, fail: fail, failures: failures }, null, 1));
console.log(fail === 0 ? 'INFINITYSERVER-PLUGINS-PASS ' + pass + '/' + pass : 'INFINITYSERVER-PLUGINS-FAIL ' + fail + ' of ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
