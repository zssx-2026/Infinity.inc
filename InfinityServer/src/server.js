/*
 * server.js - the local HTTP surface, chapter 9.
 *
 * A single plain-Node server (no dependencies) that exposes the orchestration
 * API on 127.0.0.1 only. It exists for two callers: the Electron window,
 * which loads it directly, and the offline tests, which start it, hit every
 * route and shut it down again.
 *
 *   POST /v1/request            run one request through the pipeline
 *   POST /v1/cache/hint         prefetch a predicted key
 *   GET  /v1/cache/stats        tier table and live counters
 *   GET  /v1/billing/events     the hash chain
 *   GET  /v1/billing/summary    totals by tier and user
 *   GET  /v1/resource/pool      nodes, cores, utilisation
 *   POST /v1/resource/scale     scale the pool
 *   PUT  /v1/schedule/policy    change replicas / strategy
 *   POST /v1/turing/run         run a machine on the rack (chapter 12)
 *   GET  /v1/health             everything at once, for the dashboard
 *   GET  /v1/verify             the invariants
 *   GET  /v1/plugins/catalog    the plugins bundled with this server
 *   POST /v1/plugins/catalog/install  install a bundled plugin by id
 */

import http from 'node:http';
import { InfinityServer } from './core/pipeline.js';
import { tierTable, human, humanNs, TIERS } from './core/config.js';
import { binaryIncrementMachine, equalZeroOneMachine, verifyEmbedding } from './core/turing.js';
import { PluginStore, loadPlugins, validId } from './core/plugins.js';
import { LANGUAGES, STRINGS } from './i18n.js';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const MACHINES = {
  'binary-increment': binaryIncrementMachine,
  'equal-zero-one': equalZeroOneMachine
};

export function createServer(overrides) {
  const engine = new InfinityServer(overrides);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = url.pathname;
    send(res, 200, { skipped: true });
    void pathname;
  });
  return { engine: engine, server: server };
}

/* The real handler is installed here rather than in the factory above, so a
 * caller can hold the engine without a socket. */
export function attach(engine, plugins) {
  const pluginStore = plugins || new PluginStore(path.join(os.homedir(), '.infinity', 'server', 'plugins'));
  engine.plugins = pluginStore;
  /* The catalog ships with the server source; a packaged build can point
   * engine.catalogDir somewhere else without touching this file. */
  const catalogDir = engine.catalogDir || path.join(path.dirname(fileURLToPath(import.meta.url)), 'plugins-catalog');
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    /* Trailing slashes are trimmed, but the root must stay '/'. */
    const p = url.pathname.replace(/\/+$/, '') || '/';
    const method = (req.method || 'GET').toUpperCase();
    try {
      const body = await readBody(req);
      const json = body ? safeJson(body) : {};

      if (p === '/v1/health' && method === 'GET') {
        return send(res, 200, {
          ok: true,
          rack: engine.stats(),
          tiers: tierTable(engine.cfg),
          verify: engine.verify()
        });
      }
      if (p === '/v1/verify' && method === 'GET') {
        return send(res, 200, engine.verify());
      }
      if (p === '/v1/request' && method === 'POST') {
        return send(res, 200, engine.handle(json));
      }
      if (p === '/v1/cache/hint' && method === 'POST') {
        return send(res, 200, engine.hint(json.key, Number(json.probability) || 0, json.data == null ? '' : json.data, Number(json.bytes) || 0));
      }
      if (p === '/v1/cache/stats' && method === 'GET') {
        return send(res, 200, { tiers: tierTable(engine.cfg), live: engine.cache.stats() });
      }
      if (p === '/v1/billing/events' && method === 'GET') {
        const limit = Number(url.searchParams.get('limit') || 100);
        return send(res, 200, { events: engine.billing.list(limit), total: engine.billing.events.length });
      }
      if (p === '/v1/billing/summary' && method === 'GET') {
        return send(res, 200, engine.billing.summary());
      }
      if (p === '/v1/resource/pool' && method === 'GET') {
        return send(res, 200, engine.scheduler.pool.stats());
      }
      if (p === '/v1/resource/scale' && method === 'POST') {
        const d = Number(json.delta) || 0;
        const r = engine.scheduler.pool.scale(d);
        engine.scheduler.resync();
        return send(res, 200, { scaled: r, pool: engine.scheduler.pool.stats() });
      }
      if (p === '/v1/schedule/policy' && method === 'PUT') {
        return send(res, 200, { policy: engine.scheduler.setPolicy(json), pool: engine.scheduler.stats() });
      }
      /* Chapter 12 embedding: the same machine, once as a plain machine and
       * once with its tape in cache blocks. Both results come back so the UI
       * can show they agree. */
      if (p === '/v1/turing/run' && method === 'POST') {
        const name = json.machine || 'binary-increment';
        const make = MACHINES[name];
        if (!make) return send(res, 404, { error: 'unknown machine', machines: Object.keys(MACHINES) });
        const tape = json.tape == null ? '' : String(json.tape);
        const steps = Number(json.maxSteps) || 5000;
        const check = verifyEmbedding(engine.cache, make, tape, steps);
        return send(res, 200, {
          machine: name,
          tape: tape,
          ok: check.ok,
          plain: { tape: check.plain.tape, state: check.plain.state, result: check.plain.result, steps: check.plain.steps },
          rack: { tape: check.rack.tape, state: check.rack.state, result: check.rack.result, steps: check.rack.steps }
        });
      }
      /* ---- plugins: the surface InfinityStudio drives as a client ---- */
      /* A plugin's own routes are namespaced under /v1/plugins/<id>/<path>, so a
       * plugin can never shadow the rack's own API. */
      const pluginHit = await pluginRoute(pluginStore, engine, method, p, json, res);
      if (pluginHit) return undefined;

      if (p === '/v1/plugins' && method === 'GET') {
        return send(res, 200, { plugins: pluginStore.list(), loaded: pluginStore.loaded, rejected: pluginStore.rejected });
      }
      if (p === '/v1/plugins/verify' && method === 'GET') {
        return send(res, 200, { plugins: pluginStore.verify() });
      }
      if (p === '/v1/plugins/install' && method === 'POST') {
        const from = String(json.from || '').trim();
        if (!from) return send(res, 400, { error: 'from is required' });
        try {
          const rec = pluginStore.install(from, { overwrite: !!json.overwrite });
          const rl = await loadPlugins(pluginStore, { engine: engine });
          return send(res, 200, { installed: rec, loaded: rl.loaded, rejected: rl.rejected });
        } catch (e) {
          return send(res, 400, { error: String((e && e.message) || e) });
        }
      }
      /* ---- the bundled catalog: plugins that ship with the server ----
       * Installing from it is the same store.install() path as a normal
       * install - the catalog is just a directory the user does not have
       * to name first. overwrite is intentional: the catalog is the
       * source of truth for what its plugins should look like. */
      if (p === '/v1/plugins/catalog' && method === 'GET') {
        return send(res, 200, { catalog: catalogList(catalogDir, pluginStore), dir: catalogDir });
      }
      if (p === '/v1/plugins/catalog/install' && method === 'POST') {
        const id = String(json.id || '').trim();
        if (!validId(id)) return send(res, 400, { error: 'id is required' });
        const from = path.join(catalogDir, id);
        if (!fs.existsSync(path.join(from, 'plugin.json'))) {
          return send(res, 404, { error: 'not in catalog: ' + id });
        }
        try {
          const rec = pluginStore.install(from, { overwrite: true });
          const rl = await loadPlugins(pluginStore, { engine: engine });
          return send(res, 200, { installed: rec, loaded: rl.loaded, rejected: rl.rejected });
        } catch (e) {
          return send(res, 400, { error: String((e && e.message) || e) });
        }
      }
      const pm = p.match(/^\/v1\/plugins\/([a-z0-9-]{1,64})(?:\/(.*))?$/);
      if (pm && method === 'DELETE') {
        const id = pm[1];
        if (id === 'install') return send(res, 404, { error: 'not found', path: p });
        const gone = pluginStore.remove(id);
        const rl = await loadPlugins(pluginStore, { engine: engine });
        return send(res, 200, { removed: id, gone: gone, loaded: rl.loaded, rejected: rl.rejected });
      }
      if (pm && method === 'PUT') {
        const id = pm[1];
        if (id === 'install') return send(res, 404, { error: 'not found', path: p });
        const rec = pluginStore.setEnabled(id, json.enabled !== false);
        if (!rec) return send(res, 404, { error: 'no such plugin', id: id });
        const rl = await loadPlugins(pluginStore, { engine: engine });
        return send(res, 200, { plugin: rec, loaded: rl.loaded, rejected: rl.rejected });
      }

      if (p === '/' || p === '/index.html') {
        return send(res, 200, html(), 'text/html; charset=utf-8');
      }
      return send(res, 404, { error: 'not found', path: p });
    } catch (e) {
      return send(res, 500, { error: String((e && e.message) || e) });
    }
  });
}

/* A small dashboard. It is served by the same process, so the window has
 * nothing to install and nothing to fetch: no CDN, no external font, no
 * network request at all. */
export function html() {
  const languageOptions = LANGUAGES.map(([code, name]) =>
    '<option value="' + code + '">' + name + '</option>').join('');
  const localeData = JSON.stringify(STRINGS).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>InfinityServer · 机架控制台</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#0b1020; color:#e6edf3;
         font: 13px/1.5 "Segoe UI","Microsoft YaHei",system-ui,sans-serif; }
  header { padding:14px 20px; background:#111a33; border-bottom:1px solid #1e2a4d;
           display:flex; align-items:center; gap:16px; }
  header { flex-wrap:wrap; }
  .language { display:flex; align-items:center; gap:8px; color:#8fa3c8; font-size:12px; }
  .language select { background:#0b1020; color:#e6edf3; border:1px solid #2b3b66; border-radius:6px; padding:5px 8px; font:inherit; }
  header h1 { margin:0; font-size:16px; font-weight:600; letter-spacing:.5px; }
  header .sub { color:#8fa3c8; font-size:12px; }
  main { padding:16px 20px 40px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:12px; }
  .card { background:#111a33; border:1px solid #1e2a4d; border-radius:8px; padding:12px 14px; }
  .card h2 { margin:0 0 8px; font-size:12px; color:#8fa3c8; font-weight:600;
             text-transform:uppercase; letter-spacing:.6px; }
  .stat { display:flex; justify-content:space-between; padding:3px 0; }
  .stat b { font-weight:600; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th,td { text-align:left; padding:5px 6px; border-bottom:1px solid #1e2a4d; }
  th { color:#8fa3c8; font-weight:600; }
  .bar { height:6px; border-radius:3px; background:#1e2a4d; overflow:hidden; }
  .bar > i { display:block; height:100%; background:#4f8cff; }
  .ok { color:#3fb950; } .bad { color:#f85149; }
  button { background:#1e2a4d; color:#e6edf3; border:1px solid #2b3b66;
           border-radius:6px; padding:6px 12px; cursor:pointer; font:inherit; }
  button:hover { background:#26365f; }
  input { background:#0b1020; color:#e6edf3; border:1px solid #2b3b66;
          border-radius:6px; padding:5px 8px; font:inherit; }
  pre { background:#0a0f1e; border:1px solid #1e2a4d; border-radius:6px;
        padding:10px; max-height:280px; overflow:auto; font-size:11px; }
  .row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin:8px 0; }
  .wide { grid-column:1 / -1; }
  details.card { padding:10px 14px; }
  details.card > summary { cursor:pointer; color:#8fa3c8; font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:.6px; }
  details.card[open] > summary { margin-bottom:10px; }
  .hint { color:#8fa3c8; font-size:12px; margin:0 0 10px; }
</style></head>
<body>
<header>
  <div>
    <h1 data-i18n="title">InfinityServer · 机架控制台</h1>
    <div class="sub" id="sub">连接中…</div>
    <p class="hint" data-i18n="pageHint">核心指标在上方，细节面板可展开查看。</p>
  </div>
  <div style="margin-left:auto" class="row">
    <label class="language"><span data-i18n="language">界面语言</span>
      <select id="language" aria-label="Interface language">${languageOptions}</select>
    </label>
    <button id="refresh" data-i18n="refresh">刷新</button>
    <button id="run" data-i18n="simulateRequest">模拟一次请求</button>
  </div>
</header>
<main>
  <div class="grid" id="cards"></div>

  <details class="card wide" id="cachePanel" style="margin-top:12px">
    <summary data-i18n="sixTierCache">六级缓存 · T3 Cache</summary>
    <table id="tiers"><thead><tr>
      <th data-i18n="tier">层级</th><th data-i18n="medium">介质</th><th data-i18n="latency">延迟</th><th data-i18n="weight">权重</th><th data-i18n="capacity">容量</th>
      <th data-i18n="items">条数</th><th data-i18n="usage">用量</th><th data-i18n="waterline">水位</th>
    </tr></thead><tbody></tbody></table>
  </details>

  <details class="card wide" style="margin-top:12px">
    <summary data-i18n="turing">图灵机嵌入（第 12 章）</summary>
    <div class="row">
      <select id="machine" style="background:#0b1020;color:#e6edf3;border:1px solid #2b3b66;border-radius:6px;padding:5px 8px">
        <option value="binary-increment" data-i18n="binaryIncrement">二进制加一 binary-increment</option>
        <option value="equal-zero-one" data-i18n="equalZeroOne">0ⁿ1ⁿ 判定 equal-zero-one</option>
      </select>
      <input id="tape" value="1011" size="16">
      <button id="turing" data-i18n="runOnRack">在机架上运行</button>
      <span id="turingOut" class="sub"></span>
    </div>
    <pre id="turingPre" data-i18n="notRun">（未运行）</pre>
  </details>

  <details class="card wide" style="margin-top:12px">
    <summary data-i18n="billingChain">计费哈希链</summary>
    <div class="row">
      <span class="sub"><span data-i18n="events">事件</span> <b id="evCount">0</b> · <span data-i18n="total">合计</span> <b id="evTotal">0</b> · <span data-i18n="root">根</span> <span id="evRoot">-</span></span>
      <span id="chainState"></span>
    </div>
    <pre id="chain" data-i18n="noEvents">（无事件）</pre>
  </details>

  <details class="card wide" style="margin-top:12px">
    <summary data-i18n="invariantCheck">不变式校验（第 10 章）</summary>
    <pre id="verify">（未校验）</pre>
  </details>
</main>
<script>
const DICT = ${localeData};
const LANGUAGES = ${JSON.stringify(LANGUAGES.map(([code]) => code))};
const $ = (s) => document.querySelector(s);
let locale = 'zh-CN';
function t(key) {
  const active = DICT[locale] || DICT['en-US'];
  if (Object.prototype.hasOwnProperty.call(active, key)) return active[key];
  if (Object.prototype.hasOwnProperty.call(DICT['en-US'], key)) return DICT['en-US'][key];
  return DICT['zh-CN'][key] || key;
}
function setLanguage(value) {
  locale = LANGUAGES.includes(value) ? value : 'zh-CN';
  document.documentElement.lang = locale;
  document.documentElement.dir = ['ar', 'fa', 'he', 'ur'].includes(locale) ? 'rtl' : 'ltr';
  $('#language').value = locale;
  localStorage.setItem('infinityserver.language', locale);
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.title = t('title');
}
const fmt = (n) => { const v = Number(n)||0; if (v>=1099511627776) return (v/1099511627776).toFixed(1)+' TiB'; if (v>=1073741824) return (v/1073741824).toFixed(1)+' GiB'; if (v>=1048576) return (v/1048576).toFixed(1)+' MiB'; if (v>=1024) return (v/1024).toFixed(1)+' KiB'; return v+' B'; };
const ns = (v) => v<1000 ? v+' ns' : v<1e6 ? (v/1000).toFixed(0)+' µs' : (v/1e6).toFixed(0)+' ms';

async function get(u){ const r = await fetch(u); return r.json(); }
async function post(u,b){ const r = await fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})}); return r.json(); }

async function refresh(){
  const h = await get('/v1/health');
  const s = h.rack, tiers = h.tiers;
  $('#sub').textContent = t('rack') + ' ' + s.rack.id + ' · ' + s.rack.nodes + ' ' + t('nodes') + ' × ' + s.rack.coresPerNode + ' ' + t('cores') + ' · ' + s.rack.dpus + ' DPU · ' + t('uptime') + ' ' + s.rack.uptimeSec.toFixed(0) + 's';
  const cards = [
    [t('requests'), [[t('totalCount'), s.requests.total],[t('served'), s.requests.served],[t('refused'), s.requests.refused],[t('hitRate'), (s.requests.hitRate*100).toFixed(1)+'%'],['TPS', s.requests.tps.toFixed(2)]]],
    [t('cache'), [[t('blocks'), s.cache.blocks],[t('migrations'), s.cache.migrations],[t('evictions'), s.cache.evictions]]],
    [t('resourcePool'), [[t('nodes'), s.pool.nodes],[t('inflight'), s.pool.inflight],[t('utilization'), (s.pool.utilization*100).toFixed(2)+'%'],[t('policy'), s.pool.policy]]],
    [t('billing'), [[t('events'), s.billing.events],[t('total'), s.billing.total.toFixed(9)],[t('merkleRoot'), (s.billing.merkle_root||'').slice(0,10)+'…']]]
  ];
  $('#cards').innerHTML = cards.map(([title,rows]) =>
    '<div class="card"><h2>'+title+'</h2>' + rows.map(([k,v]) =>
      '<div class="stat"><span>'+k+'</span><b>'+v+'</b></div>').join('') + '</div>').join('');

  const live = s.cache.tiers;
  $('#tiers').querySelector('tbody').innerHTML = tiers.map((x,i) => {
    const L = live[i] || {items:0,usageBytes:0};
    const pct = Math.min(100, L.utilization*100);
    return '<tr><td><b>'+x.id+'</b></td><td>'+x.name+'</td><td>'+x.latencyText+'</td><td>w'+x.weight+'</td><td>'+fmt(x.capacityBytes)+'</td><td>'+L.items+'</td><td>'+fmt(L.usageBytes)+'</td><td><div class="bar"><i style="width:'+pct.toFixed(2)+'%"></i></div></td></tr>';
  }).join('');

  const b = await get('/v1/billing/summary');
  $('#evCount').textContent = b.events; $('#evTotal').textContent = b.total.toFixed(9);
  $('#evRoot').textContent = (b.merkle_root||'').slice(0,16)+'…';
  const ev = await get('/v1/billing/events?limit=8');
  $('#chain').textContent = ev.events.length ? ev.events.slice().reverse().map(e => e.req_id+'  '+e.tier_id+'  w'+e.weight+'  '+e.body_size+'B  fee='+e.fee.toFixed(9)+'  prev='+(e.prev_hash||'').slice(0,8)).join('\\n') : t('noEvents');

  const v = await get('/v1/verify');
  $('#chainState').innerHTML = v.chain && v.chain.ok ? '<span class="ok">' + t('complete') + ' '+v.chain.count+' ' + t('events') + '</span>' : '<span class="bad">' + t('broken') + '</span>';
  $('#verify').textContent = JSON.stringify(v, null, 2);
}

$('#refresh').onclick = refresh;
$('#language').addEventListener('change', (event) => {
  setLanguage(event.target.value);
  refresh();
});
$('#run').onclick = async () => { await post('/v1/request', { key:'demo:'+Math.random().toString(36).slice(2,7), body:'hello rack', userId:'operator', priority:'normal' }); refresh(); };
$('#turing').onclick = async () => {
  const r = await post('/v1/turing/run', { machine: $('#machine').value, tape: $('#tape').value, maxSteps: 5000 });
  $('#turingOut').innerHTML = r.ok ? '<span class="ok">' + t('executionMatch') + '</span>' : '<span class="bad">' + t('executionMismatch') + '</span>';
  $('#turingPre').textContent = t('plainMachine') + ': tape=' + r.plain.tape + '  state=' + r.plain.state + '  result=' + r.plain.result + '  steps=' + r.plain.steps +
    '\\n' + t('rackExecution') + ': tape=' + r.rack.tape + '  state=' + r.rack.state + '  result=' + r.rack.result + '  steps=' + r.rack.steps;
  refresh();
};
setLanguage(localStorage.getItem('infinityserver.language') || 'zh-CN');
refresh();
setInterval(refresh, 4000);
</script>
</body></html>`;
}

/* ---- cli ---- */
export async function start(opts) {
  const o = opts || {};
  const engine = new InfinityServer(o.config);
  if (o.catalogDir) engine.catalogDir = o.catalogDir;
  const store = o.plugins || new PluginStore(o.pluginDir || path.join(os.homedir(), '.infinity', 'server', 'plugins'));
  const server = attach(engine, store);
  // Load the plugins before the socket opens: a plugin that adds a route has
  // to be able to answer the first request that arrives.
  const pluginLoad = await loadPlugins(store, { engine: engine, server: server });
  return new Promise((resolve) => {
    server.listen(o.port || 0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ engine, server, port, plugins: store, pluginLoad: pluginLoad, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

/* List the plugins bundled with this server. installed/enabled come from
 * the live store, so the Studio renders the catalog without extra calls.
 * A directory without a readable plugin.json is skipped, not fatal. */
function catalogList(dir, store) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'plugin.json'))).sort();
  } catch { names = []; }
  return names.map((n) => {
    let m = {};
    try { m = JSON.parse(fs.readFileSync(path.join(dir, n, 'plugin.json'), 'utf8')); } catch { /* shell only */ }
    const rec = store.read(n);
    return {
      id: n,
      name: m.name || n,
      version: m.version || '',
      description: m.description || '',
      api: m.api == null ? 1 : Number(m.api),
      installed: store.has(n),
      enabled: rec ? !!rec.enabled : false
    };
  });
}

/* Dispatch a request into a plugin's own route, if one owns the path.
 * Returns true when the plugin answered (or refused), false when no plugin
 * claimed it - the caller then falls through to the rack's own routes.
 * A plugin that throws answers 500; it does not take the server with it. */
async function pluginRoute(store, engine, method, p, json, res) {
  const m = p.match(/^\/v1\/plugins\/([a-z0-9-]{1,64})\/(.+)$/);
  if (!m) return false;
  const id = m[1];
  const rest = m[2];
  const routes = store.routes.get(id) || [];
  if (!routes.length) return false;
  const hit = routes.find((r) => r.method === method && (r.path === rest || r.path === rest.replace(/\/$/, '')));
  if (!hit) return false;
  let out;
  try { out = await hit.handler({ engine: engine, id: id, path: rest, query: json, method: method }); }
  catch (e) { send(res, 500, { error: String((e && e.message) || e), plugin: id }); return true; }
  if (out === undefined) { send(res, 204, null); return true; }
  send(res, 200, out);
  return true;
}


function send(res, code, obj, type) {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(code, { 'content-type': type || 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve) => {
    let n = 0;
    const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      /* Chapter 8: a body larger than the configured limit is cut off here
       * rather than buffered - the limit is a protection, not a suggestion. */
      if (n > 8 * 1024 * 1024) { req.destroy(); resolve(null); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks).toString('utf8') : null));
    req.on('error', () => resolve(null));
  });
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return {}; }
}

export { TIERS, human, humanNs };
