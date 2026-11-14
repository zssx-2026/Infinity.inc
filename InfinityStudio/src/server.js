/*
 * server.js - the studio's local service and the installer window.
 *
 * A Visual Studio installer is, from this side, three things: a list of
 * workloads with real byte counts, a plan you can inspect before committing,
 * and an install that proves what it wrote. All three are served from here on
 * loopback; the Electron window is only a view onto it.
 *
 * The page carries no external resource - no CDN, no web font, no remote
 * image - so the installer works on a machine with no network at all.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Planner, install, human } from './planner.js';
import { WORKLOADS, PRODUCTS } from './catalog.js';
import { LANGUAGES, STRINGS } from './i18n.js';
import { suiteTree, findComponent, COMPONENTS } from './suite.js';
import { probeHosts } from './hosts.js';
import { writeProject, readProject } from './project.js';
import { createWorkspace, loadWorkspace } from './workspace.js';
import { planAssociations, applyAssociations } from './associate.js';
import { renderPage } from './page.js';
import { list as listApps, call as callApp, load as loadApp } from './apps/index.js';
import { fetchCatalog, createRemoteInstaller, downloadDir, dlBase } from './remote.js';
import { listInstalled, uninstallProduct } from './uninstall.js';
import os from 'node:os';

export function studioHome() {
  const fromEnv = process.env.INFINITYSTUDIO_HOME;
  const home = fromEnv && fromEnv.trim() ? fromEnv.trim() : path.join(os.homedir(), '.infinitystudio');
  fs.mkdirSync(home, { recursive: true });
  return home;
}

export function createStudio(root, target) {
  const planner = new Planner(root, target);
  planner.root = root;

  /* The online installer. The catalog is fetched once per process and cached;
   * the runner is a single serial job whose state the page polls, so a second
   * click cannot start a second install over the first one's registry keys. */
  const remote = createRemoteInstaller();
  let catalog = null;
  let catalogError = null;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const p = url.pathname.replace(/\/+$/, '') || '/';
    const method = (req.method || 'GET').toUpperCase();
    try {
      const body = await readBody(req);
      const json = body ? safeJson(body) : {};

      if (p === '/v1/workloads' && method === 'GET') {
        return send(res, 200, { workloads: WORKLOADS, products: planner.inventory() });
      }
      if (p === '/v1/plan' && method === 'POST') {
        const ids = Array.isArray(json.workloads) ? json.workloads : [];
        if (json.target) planner.target = json.target;
        const plan = planner.plan(ids);
        plan.root = root;
        return send(res, 200, plan);
      }
      if (p === '/v1/install' && method === 'POST') {
        const ids = Array.isArray(json.workloads) ? json.workloads : [];
        const dest = json.dest;
        if (!dest) return send(res, 400, { error: 'dest is required' });
        if (json.target) planner.target = json.target;
        const plan = planner.plan(ids);
        plan.root = root;
        if (plan.blocking.length) {
          return send(res, 409, { error: 'required artefact missing', missing: plan.blocking });
        }
        const r = install(plan, dest);
        return send(res, 200, r);
      }
      if (p === '/v1/server/status' && method === 'POST') {
        const base = String(json.base || '').trim().replace(/\/+$/, '');
        if (!base) return send(res, 400, { error: 'base is required' });
        return send(res, 200, await probeServer(base));
      }

      /* ---- Infinity Server plugins, driven from here as a client ----
       * The server owns the plugin directory and the loader; the studio is the
       * window onto it. Nothing here installs or verifies anything itself -
       * every route is one HTTP call to the server the user named, so the
       * plugin state has exactly one home. */
      if (p === '/v1/server/plugins' && method === 'GET') {
        const base = String(url.searchParams.get('base') || '').trim().replace(/\/+$/, '');
        if (!base) return send(res, 400, { error: 'base is required' });
        return forward(res, await callServer(base, 'GET', '/v1/plugins', null));
      }
      if (p === '/v1/server/plugins/install' && method === 'POST') {
        const base = String(json.base || '').trim().replace(/\/+$/, '');
        const from = String(json.from || '').trim();
        if (!base) return send(res, 400, { error: 'base is required' });
        if (!from) return send(res, 400, { error: 'from is required' });
        return forward(res, await callServer(base, 'POST', '/v1/plugins/install', { from: from, overwrite: !!json.overwrite }));
      }
      if (p === '/v1/server/plugins/remove' && method === 'POST') {
        const base = String(json.base || '').trim().replace(/\/+$/, '');
        const id = String(json.id || '').trim();
        if (!base) return send(res, 400, { error: 'base is required' });
        if (!id) return send(res, 400, { error: 'id is required' });
        return forward(res, await callServer(base, 'DELETE', '/v1/plugins/' + encodeURIComponent(id), null));
      }
      if (p === '/v1/server/plugins/enable' && method === 'POST') {
        const base = String(json.base || '').trim().replace(/\/+$/, '');
        const id = String(json.id || '').trim();
        if (!base) return send(res, 400, { error: 'base is required' });
        if (!id) return send(res, 400, { error: 'id is required' });
        return forward(res, await callServer(base, 'PUT', '/v1/plugins/' + encodeURIComponent(id), { enabled: !!json.enabled }));
      }
      if (p === '/v1/server/plugins/verify' && method === 'POST') {
        const base = String(json.base || '').trim().replace(/\/+$/, '');
        if (!base) return send(res, 400, { error: 'base is required' });
        return forward(res, await callServer(base, 'GET', '/v1/plugins/verify', null));
      }

      /* ---- the suite: the tree from the product specification ---- */
      if (p === '/v1/suite' && method === 'GET') {
        return send(res, 200, { branches: suiteTree(), components: COMPONENTS, version: root });
      }
      if (p === '/v1/suite/install' && method === 'POST') {
        const id = String(json.id || '').trim();
        if (!id) return send(res, 400, { error: 'id is required' });
        const component = findComponent(id);
        if (!component) return send(res, 404, { error: 'unknown component', id: id });
        const parts = (component.parts || []).map((part) => {
          const from = path.join(root, String((part && part.from) || part || ''));
          const present = fs.existsSync(from);
          return { from: (part && part.from) || part, to: (part && part.to) || null,
            optional: !!(part && part.optional), present: present, path: from };
        });
        const required = parts.filter((part) => !part.optional);
        const ok = required.every((part) => part.present);
        return send(res, 200, { ok: ok, id: component.id, name: component.name, parts: parts,
          missing: required.filter((part) => !part.present).map((part) => part.from) });
      }
      if (p === '/v1/suite/remove' && method === 'POST') {
        const id = String(json.id || '').trim();
        if (!id) return send(res, 400, { error: 'id is required' });
        const component = findComponent(id);
        if (!component) return send(res, 404, { error: 'unknown component', id: id });
        return send(res, 200, { ok: true, id: component.id, removed: false, note: 'not installed yet' });
      }

      /* ---- hosts: probed, never assumed ---- */
      if (p === '/v1/hosts' && method === 'GET') {
        return send(res, 200, { hosts: await probeHosts() });
      }

      /* ---- a project is a container with a header and a payload ---- */
      if (p === '/v1/project/create' && method === 'POST') {
        const name = String(json.name || 'project').trim() || 'project';
        const component = String(json.component || 'craft.code').trim();
        const files = Array.isArray(json.files) ? json.files : [];
        const dir = json.dir ? String(json.dir) : studioHome();
        const ext = json.compressed ? '.is-ccpx' : '.is-ccp';
        const file = path.join(dir, name + ext);
        const project = {
          component: component,
          version: Number(json.version || 1),
          files: files.map((f) => ({ path: String(f.path || f.name || 'untitled'),
            bytes: Buffer.from(String(f.content == null ? '' : f.content), 'utf8') })),
          compressed: !!json.compressed
        };
        fs.mkdirSync(dir, { recursive: true });
        const written = writeProject(file, project);
        if (!written.ok) return send(res, 200, written);
        return send(res, 200, { ok: true, path: file, bytes: written.bytes });
      }
      if (p === '/v1/project/open' && method === 'POST') {
        const file = String(json.path || '').trim();
        if (!file) return send(res, 400, { error: 'path is required' });
        const opened = readProject(file);
        if (!opened.ok) return send(res, 200, opened);
        return send(res, 200, { ok: true, path: file, header: opened.header,
          files: (opened.files || []).map((f) => ({ path: f.path, bytes: f.bytes.length,
            content: f.bytes.toString('utf8') })) });
      }

      /* ---- a workspace remembers what it holds ---- */
      if (p === '/v1/workspace/create' && method === 'POST') {
        const name = String(json.name || 'workspace').trim() || 'workspace';
        const file = json.path ? String(json.path) : path.join(studioHome(), name + '.is-ws');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const made = createWorkspace({ name: name, path: file });
        if (!made.ok) return send(res, 200, made);
        return send(res, 200, { ok: true, path: file, workspace: made.workspace });
      }
      if (p === '/v1/workspace/load' && method === 'POST') {
        const file = String(json.path || '').trim();
        if (!file) return send(res, 400, { error: 'path is required' });
        const loaded = loadWorkspace(file);
        if (!loaded.ok) return send(res, 200, loaded);
        return send(res, 200, { ok: true, path: file, workspace: loaded.workspace });
      }

      /* ---- file associations: planned first, written only on request ---- */
      if (p === '/v1/associate' && method === 'POST') {
        const exe = String(json.exe || path.join(root, 'InfinityStudio', 'build', 'win-x64', 'infinitystudio_gui.exe'));
        const codecs = COMPONENTS.reduce((all, c) => all.concat(c.codecs || []), []);
        const ops = planAssociations(codecs, { exe: exe });
        const result = applyAssociations(ops, { apply: json.apply === true });
        return send(res, 200, { ok: result.ok !== false, applied: result.applied === true,
          dryRun: result.dryRun === true, ops: ops, exe: exe });
      }

      /* ---- the sub-products: one module per craft application ---- */
      if (p === '/v1/apps' && method === 'GET') {
        return send(res, 200, { apps: await listApps() });
      }
      if (p === '/v1/apps/call' && method === 'POST') {
        const id = String(json.id || '').trim();
        if (!id) return send(res, 400, { error: 'id is required' });
        const action = String(json.action || 'capabilities').trim();
        const answered = await callApp(id, action, json.input || {});
        return send(res, 200, answered);
      }

      /* ---- the released setups: what exists, and install it ---- */
      if (p === '/v1/remote' && method === 'GET') {
        if (!catalog) {
          try { catalog = await fetchCatalog(); catalogError = null; }
          catch (error) { catalogError = String((error && error.message) || error); }
        }
        return send(res, 200, {
          base: dlBase(),
          dir: downloadDir(),
          catalog: catalog,
          error: catalogError,
          /* What is already on this machine, so the table can offer 卸载 instead
           * of pretending every row is a fresh install. */
          installed: listInstalled((catalog && catalog.products) || []),
          state: remote.snapshot()
        });
      }
      if (p === '/v1/remote/refresh' && method === 'POST') {
        try { catalog = await fetchCatalog(json.base || undefined); catalogError = null; }
        catch (error) { catalogError = String((error && error.message) || error); }
        return send(res, 200, { base: dlBase(), catalog: catalog, error: catalogError, state: remote.snapshot() });
      }
      if (p === '/v1/remote/install' && method === 'POST') {
        const ids = Array.isArray(json.ids) ? json.ids.map(String) : [];
        if (!catalog) {
          try { catalog = await fetchCatalog(); catalogError = null; }
          catch (error) { catalogError = String((error && error.message) || error); }
        }
        const known = (catalog && catalog.products) || [];
        const chosen = ids.length ? known.filter((x) => ids.indexOf(x.id) >= 0 || ids.indexOf(x.asset) >= 0) : known;
        if (!chosen.length) return send(res, 409, { error: 'no matching product in catalog', ids: ids, catalogError: catalogError });
        const started = remote.start(chosen);
        return send(res, started.ok ? 202 : 409, Object.assign({ chosen: chosen.map((x) => x.asset) }, started));
      }
      if (p === '/v1/remote/uninstall' && method === 'POST') {
        const ids = Array.isArray(json.ids) ? json.ids.map(String) : [];
        if (!ids.length) return send(res, 400, { error: 'ids is required' });
        if (!catalog) {
          try { catalog = await fetchCatalog(); catalogError = null; }
          catch (error) { catalogError = String((error && error.message) || error); }
        }
        const known = (catalog && catalog.products) || [];
        /* 用户/脚本可能按 id（inc）、资产名（InfinityCloud-setup）或显示名
         * （Infinity Cloud）来指同一个产品，三者都认。 */
        const chosen = known.filter((x) => ids.indexOf(x.id) >= 0 || ids.indexOf(x.asset) >= 0 || ids.indexOf(x.name) >= 0);
        if (!chosen.length) return send(res, 409, { error: 'no matching product in catalog', ids: ids, results: [], catalogError: catalogError });
        const results = [];
        for (const product of chosen) results.push(await uninstallProduct(product));
        const ok = results.every((r) => r.ok);
        return send(res, ok ? 200 : 409, { ok: ok, results: results });
      }
      if (p === '/v1/remote/state' && method === 'GET') {
        return send(res, 200, remote.snapshot());
      }

      if (p === '/v1/health' && method === 'GET') {
        return send(res, 200, { ok: true, root: root, products: planner.inventory() });
      }
      if (p === '/' || p === '/index.html') {
        return send(res, 200, renderPage({ strings: STRINGS, languages: LANGUAGES }), 'text/html; charset=utf-8');
      }
      return send(res, 404, { error: 'not found', path: p });
    } catch (e) {
      return send(res, 500, { error: String((e && e.message) || e) });
    }
  });

  return { planner, server };
}

export function start(opts) {
  const o = opts || {};
  const root = o.root || process.cwd();
  const { server } = createStudio(root);
  return new Promise((resolve) => {
    server.listen(o.port || 0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

export function html() {
  const languageOptions = LANGUAGES.map(([code, name]) =>
    '<option value="' + code + '">' + name + '</option>').join('');
  const localeData = JSON.stringify(STRINGS).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>InfinityStudio 安装程序</title>
<style>
  :root { color-scheme: dark; --line:#33343a; --panel:#202024; --ink:#f3f3f3; --dim:#a5a5ad; --accent:#0e639c; }
  * { box-sizing: border-box; }
  body { margin:0; height:100vh; display:flex; flex-direction:column; background:#1b1b1f; color:var(--ink); font:13px/1.5 "Segoe UI","Microsoft YaHei",system-ui,sans-serif; }
  header { padding:14px 22px; border-bottom:1px solid var(--line); background:var(--panel); display:flex; align-items:center; gap:18px; }
  header .heading { flex:1; }
  header h1 { margin:0; font-size:17px; font-weight:600; }
  header .sub { color:var(--dim); font-size:12px; margin-top:2px; }
  .language { display:flex; align-items:center; gap:8px; color:var(--dim); font-size:12px; }
  .language select { background:#242428; color:var(--ink); border:1px solid #4a4b52; border-radius:4px; padding:5px 8px; font:inherit; }
  main { flex:1; display:flex; min-height:0; }
  aside { width:290px; border-right:1px solid var(--line); padding:14px; overflow:auto; }
  section { flex:1; padding:14px 20px; overflow:auto; }
  h2 { font-size:12px; margin:16px 0 8px; color:#c9c9d1; text-transform:uppercase; letter-spacing:.6px; }
  h2:first-child { margin-top:0; }
  .step { display:flex; align-items:center; gap:8px; margin:0 0 8px; color:#d8d8de; font-size:12px; }
  .step b { display:inline-flex; width:18px; height:18px; border-radius:9px; background:var(--accent); color:#fff; font-size:11px; align-items:center; justify-content:center; }
  .wl { display:flex; gap:10px; padding:9px 10px; border:1px solid var(--line); border-radius:6px; margin-bottom:8px; cursor:pointer; background:#242428; }
  .wl:hover { border-color:#4a6cf7; }
  .wl.on { background:#22304f; border-color:#4a6cf7; }
  .wl .n { font-weight:600; }
  .wl .d { color:var(--dim); font-size:11px; }
  .wl .sz { margin-left:auto; color:#8fb8ff; font-size:11px; white-space:nowrap; }
  .prod { padding:8px 10px; border:1px solid #2c2d33; border-radius:6px; margin-bottom:6px; background:var(--panel); }
  .prod .row1 { display:flex; justify-content:space-between; }
  .face { display:inline-block; margin-right:6px; padding:1px 7px; border-radius:10px; font-size:11px; border:1px solid #3a3b42; color:var(--dim); }
  .face.has { color:#7ee08a; border-color:#2e6b3c; }
  .face.no  { color:#7a7a82; text-decoration:line-through; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th,td { text-align:left; padding:4px 6px; border-bottom:1px solid #2c2d33; }
  th { color:var(--dim); font-weight:600; }
  footer { padding:12px 22px; border-top:1px solid var(--line); background:var(--panel); display:flex; align-items:center; gap:14px; }
  button { background:var(--accent); color:#fff; border:none; border-radius:4px; padding:8px 18px; cursor:pointer; font:inherit; font-weight:600; }
  button:disabled { background:#3a3b42; color:#8a8a92; cursor:default; }
  button.ghost { background:transparent; border:1px solid #4a4b52; color:#d8d8de; font-weight:400; }
  input[type=text] { flex:1; background:#1b1b1f; color:var(--ink); border:1px solid #4a4b52; border-radius:4px; padding:6px 8px; font:inherit; }
  .row { display:flex; gap:8px; align-items:center; }
  .total { margin-left:auto; font-weight:600; }
  pre { background:#161618; border:1px solid #2c2d33; border-radius:6px; padding:10px; max-height:240px; overflow:auto; font-size:11px; }
  .ok { color:#7ee08a; } .bad { color:#ff7b72; } .warn { color:#e2b341; }
  .bar { height:8px; background:#2c2d33; border-radius:4px; overflow:hidden; margin-top:6px; }
  .bar > i { display:block; height:100%; background:var(--accent); width:0%; transition:width .15s; }
  details { border:1px solid #2c2d33; border-radius:6px; background:var(--panel); padding:8px 10px; margin-top:10px; }
  details > summary { cursor:pointer; color:#c9c9d1; font-size:12px; }
  details[open] > summary { margin-bottom:8px; }
</style></head>
<body>
<header>
  <div class="heading">
    <h1 data-i18n="title">InfinityStudio 安装程序</h1>
    <div class="sub" data-i18n="subtitle">三步装好：选组件 → 选位置 → 点安装。</div>
  </div>
  <label class="language"><span data-i18n="language">界面语言</span>
    <select id="language" aria-label="Interface language">${languageOptions}</select>
  </label>
</header>
<main>
  <aside>
    <h2 data-i18n="stepOne">1 选择组件</h2>
    <div id="workloads"></div>
    <h2 data-i18n="stepTwo">2 安装位置</h2>
    <input type="text" id="dest" value="D:\\program\\InfinityStudio" style="width:100%">
    <div class="sub" id="destHint" data-i18n="destHint" style="margin-top:6px">默认位置即可，无需修改。</div>
  </aside>
  <section>
    <h2 data-i18n="stepThree">3 安装计划</h2>
    <div id="planHead" class="sub"></div>
    <div class="bar"><i id="bar"></i></div>
    <pre id="plan" data-i18n="notCalculated">（尚未计算）</pre>
    <div id="result"></div>
    <details id="advanced">
      <summary data-i18n="advanced">高级：组件清单与 Infinity Server 连接</summary>
      <h2 data-i18n="components">可用组件</h2>
      <div id="products"></div>
      <h2 data-i18n="serverClient">Infinity Server 客户端</h2>
      <div class="row">
        <input type="text" id="srvBase" value="http://127.0.0.1:7711" style="width:260px">
        <button id="srvBtn" class="ghost" data-i18n="connect">连接</button>
        <span id="srvState" class="sub" data-i18n="serverIndependent">服务器是独立产品，此处仅连接。</span>
      </div>
      <div id="srvInfo" class="sub"></div>
      <div id="plug"></div>
    </details>
  </section>
</main>
<footer>
  <button id="planBtn" class="ghost" data-i18n="calculatePlan">重新计算</button>
  <button id="installBtn" data-i18n="install">安装</button>
  <span class="total" id="total">0 B</span>
</footer>
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
  localStorage.setItem('infinitystudio.language', locale);
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.title = t('title');
}
let state = { workloads: [], products: [], plan: null };

async function get(u){ return (await fetch(u)).json(); }
async function post(u,b){ const r = await fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})}); return r.json(); }

function renderWorkloads(){
  const w = state.workloads;
  $('#workloads').innerHTML = w.map(x =>
    '<div class="wl' + (x.picked ? ' on' : '') + '" data-id="' + x.id + '">' +
      '<div><div class="n">' + x.name + (x.recommended ? ' <span class="sub">' + t('recommended') + '</span>' : '') + '</div>' +
      '<div class="d">' + x.desc + '</div></div>' +
      '<div class="sz">' + (x.bytes ? fmt(x.bytes) : '—') + '</div>' +
    '</div>').join('');
  document.querySelectorAll('.wl').forEach(el => el.onclick = async () => {
    const id = el.dataset.id;
    state.workloads.forEach(w => { if (w.id === id) w.picked = !w.picked; });
    renderWorkloads();
    await plan();
  });
}

function renderProducts(){
  $('#products').innerHTML = state.products.map(p =>
    '<div class="prod"><div class="row1"><b>' + p.name + '</b><span class="sub">' + p.tagline + ' · 端口 ' + p.port + '</span></div>' +
    '<div>' + Object.keys(p.faces).map(f =>
      '<span class="face ' + (p.faces[f] ? 'has' : 'no') + '">' + f + (p.faces[f] ? ' ' + fmt(p.faces[f]) : ' 缺失') + '</span>').join('') +
    '</div></div>').join('');
}

async function plan(){
  const ids = state.workloads.filter(w => w.picked).map(w => w.id);
  if (!ids.length) { $('#plan').textContent = t('noWorkload'); $('#total').textContent = '0 B'; state.plan = null; return; }
  const r = await post('/v1/plan', { workloads: ids });
  state.plan = r;
  $('#planHead').textContent = r.counts.present + ' ' + t('filesInstallable') + (r.counts.missing ? ' · ' + r.counts.missing + ' ' + t('missing') + ' (' + t('missingWorkspace') + ')' : '') + ' · ' + t('target') + ' ' + r.target;
  $('#plan').textContent = r.files.slice(0, 60).map(f =>
    (f.missing ? t('missing') + '  ' : (f.shared ? t('shared') + '  ' : '      ')) + f.from + '  ' + (f.missing ? '' : fmt(f.bytes))).join('\\n') +
    (r.files.length > 60 ? '\\n… ' + t('moreFiles') + ' ' + (r.files.length - 60) : '');
  $('#total').textContent = r.totalText;
  $('#bar').style.width = '100%';
}

function fmt(n){ const v=Number(n)||0; if(v>=1073741824) return (v/1073741824).toFixed(1)+' GiB'; if(v>=1048576) return (v/1048576).toFixed(1)+' MiB'; if(v>=1024) return (v/1024).toFixed(1)+' KiB'; return v+' B'; }

/* The plugin manager. It is a view onto the Infinity Server the user named:
 * every button is one call through /v1/server/plugins/*, which forwards to the
 * server. The studio never holds a plugin itself, so there is no second copy
 * of the plugin state to disagree with. */
let plugins = [];

function esc(s){
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function loadPlugins(){
  const base = $('#srvBase').value.trim();
  if (!base) return;
  const r = await post('/v1/server/plugins', { base: base });
  plugins = (r && Array.isArray(r.plugins)) ? r.plugins : [];
  renderPlugins();
}

function renderPlugins(){
  const host = $('#plug');
  if (!host) return;
  if (!plugins.length) {
    host.innerHTML = '<div class="sub" style="margin-top:6px">' + t('emptyPlugins') + '</div>';
    return;
  }
  host.innerHTML =
    '<div class="sub" style="margin:8px 0 4px">' + t('plugins') + ' ' + plugins.length + ' ' + t('pluginCount') + '</div>' +
    '<table><tr><th>' + t('name') + '</th><th>' + t('version') + '</th><th>' + t('status') + '</th><th>' + t('files') + '</th><th></th></tr>' +
    plugins.map(function (p) {
      const n = Object.keys(p.files || {}).length;
      return '<tr><td>' + esc(p.name) + ' <span class="sub">' + esc(p.id) + '</span>' +
        (p.description ? '<div class="sub">' + esc(p.description) + '</div>' : '') + '</td>' +
        '<td>' + esc(p.version || '—') + '</td>' +
        '<td>' + (p.enabled ? '<span class="ok">' + t('enabled') + '</span>' : '<span class="warn">' + t('disabled') + '</span>') + '</td>' +
        '<td>' + n + '</td>' +
        '<td>' +
          '<button class="ghost" data-act="toggle" data-enabled="' + (p.enabled ? 'true' : 'false') + '" data-id="' + esc(p.id) + '">' + (p.enabled ? t('disable') : t('enable')) + '</button> ' +
          '<button class="ghost" data-act="remove" data-id="' + esc(p.id) + '">' + t('uninstall') + '</button>' +
        '</td></tr>';
    }).join('') + '</table>' +
    '<div class="row" style="margin-top:6px">' +
      '<input id="plugFrom" placeholder="' + t('pluginSource') + '" style="flex:1;min-width:260px">' +
      '<button id="plugInstall">' + t('installPlugin') + '</button>' +
      '<button class="ghost" id="plugVerify">' + t('verify') + '</button>' +
      '<button class="ghost" id="plugRefresh">' + t('refresh') + '</button>' +
      '<span id="plugMsg" class="sub"></span>' +
    '</div>' +
    '<pre id="plugOut"></pre>';
  host.querySelectorAll('button[data-act]').forEach(function (b) {
    b.onclick = async () => {
      const id = b.dataset.id;
      const base = $('#srvBase').value.trim();
      if (b.dataset.act === 'remove') {
        $('#plugMsg').textContent = t('uninstalling');
        const r = await post('/v1/server/plugins/remove', { base: base, id: id });
        $('#plugMsg').textContent = r.reachable === false ? (t('unreachable') + ': ' + (r.error || '')) : (t('uninstall') + ' ' + id);
        await loadPlugins();
      } else {
        const on = b.dataset.enabled !== 'true';
        $('#plugMsg').textContent = (on ? t('enabling') : t('disabling'));
        const r = await post('/v1/server/plugins/enable', { base: base, id: id, enabled: on });
        $('#plugMsg').textContent = r.reachable === false ? (t('unreachable') + ': ' + (r.error || '')) : (on ? t('enabled') : t('disabled'));
        await loadPlugins();
      }
    };
  });
  const ins = $('#plugInstall');
  if (ins) ins.onclick = async () => {
    const from = $('#plugFrom').value.trim();
    const base = $('#srvBase').value.trim();
    if (!from) { $('#plugMsg').textContent = t('pluginSourceRequired'); return; }
    $('#plugMsg').textContent = t('installing');
    const r = await post('/v1/server/plugins/install', { base: base, from: from });
    if (r.reachable === false) { $('#plugMsg').textContent = t('unreachable') + ': ' + (r.error || ''); return; }
    if (r.error) { $('#plugMsg').innerHTML = '<span class="bad">' + esc(r.error) + '</span>'; return; }
    $('#plugMsg').textContent = '已安装 ' + (r.installed && r.installed.id);
    await loadPlugins();
  };
  const vf = $('#plugVerify');
  if (vf) vf.onclick = async () => {
    const base = $('#srvBase').value.trim();
    $('#plugOut').textContent = t('verifying');
    const r = await post('/v1/server/plugins/verify', { base: base });
    $('#plugOut').textContent = r.reachable === false ? ('不可达：' + (r.error || '')) : JSON.stringify(r, null, 1);
  };
  const rf = $('#plugRefresh');
  if (rf) rf.onclick = loadPlugins;
}

async function serverStatus(){
  const base = $('#srvBase').value.trim();
  if (!base) return;
  $('#srvBtn').disabled = true;
  $('#srvState').textContent = t('connecting');
  const r = await post('/v1/server/status', { base: base });
  $('#srvBtn').disabled = false;
  if (!r.reachable) {
    $('#srvState').innerHTML = '<span class="bad">' + t('unreachable') + '</span>';
    $('#srvInfo').textContent = (r.error || '') + (r.base ? '  ·  ' + r.base : '');
    return;
  }
  /* The health payload is nested: /v1/health answers { ok, rack, tiers,
   * verify }, and the live counters live under rack.requests / rack.cache.tiers
   * - the top-level 'tiers' array is the configured tier table, not the usage.
   * Reading flat names that are not there showed zeros forever, so the shape is
   * written out here. */
  const h = r.health || {};
  const rack = h.rack || {};
  const rq = rack.requests || {};
  const live = (rack.cache && Array.isArray(rack.cache.tiers)) ? rack.cache.tiers : [];
  const shape = Array.isArray(h.tiers) ? h.tiers : [];
  const byId = {};
  shape.forEach(function (t) { byId[t.id] = t; });
  $('#srvState').innerHTML = '<span class="ok">' + t('connected') + '</span> <span class="sub">HTTP ' + r.status + ' · ' + r.base + '</span>';
  $('#srvInfo').innerHTML =
    '<div class="sub">' + t('request') + ' ' + (rq.total || 0) + ' · ' + t('hit') + ' ' + (rq.hits || 0) + ' · ' + t('refused') + ' ' + (rq.refused || 0) +
      ' · ' + t('billingEvents') + ' ' + (rack.events || 0) + ' · ' + t('nodes') + ' ' + ((rack.rack && rack.rack.nodes) || 0) + ' · ' + t('uptime') + ' ' + Math.round((rack.rack && rack.rack.uptimeSec) || 0) + 's</div>' +
    (live.length ? '<table><tr><th>' + t('level') + '</th><th>' + t('medium') + '</th><th>' + t('used') + '</th><th>' + t('capacity') + '</th><th>' + t('utilization') + '</th></tr>' +
      live.map(function (t) {
        return '<tr><td>' + t.id + '</td><td>' + ((byId[t.id] && byId[t.id].name) || t.kind || '') + '</td><td>' +
          fmt(t.usageBytes) + '</td><td>' + fmt(t.capacityBytes) + '</td><td>' + Math.round((t.utilization || 0) * 100) + '%</td></tr>';
      }).join('') + '</table>' : '');
  renderPlugins();
}

$('#srvBtn').onclick = serverStatus;
$('#planBtn').onclick = plan;
$('#installBtn').onclick = async () => {
  const ids = state.workloads.filter(w => w.picked).map(w => w.id);
  if (!ids.length) { $('#result').innerHTML = '<span class="warn">' + t('emptyWorkloads') + '</span>'; return; }
  $('#installBtn').disabled = true;
  $('#result').textContent = t('installing');
  const r = await post('/v1/install', { workloads: ids, dest: $('#dest').value });
  $('#installBtn').disabled = false;
  if (r.error) { $('#result').innerHTML = '<span class="bad">' + r.error + '</span>'; return; }
  $('#result').innerHTML = '<span class="' + (r.ok ? 'ok' : 'bad') + '">' +
    (r.ok ? t('installComplete') : t('installIncomplete')) + r.copied + '/' + r.total + ' ' + t('fileCount') + ' · ' + fmt(r.bytes) +
    ' · ' + t('shaCheck') + '</span>' +
    (r.failures && r.failures.length ? '<pre>' + JSON.stringify(r.failures, null, 2) + '</pre>' : '');
};

(async () => {
  $('#language').addEventListener('change', (event) => {
    setLanguage(event.target.value);
    renderWorkloads();
    renderProducts();
    renderPlugins();
    if (state.workloads.some((w) => w.picked)) plan();
  });
  setLanguage(localStorage.getItem('infinitystudio.language') || 'zh-CN');
  const d = await get('/v1/workloads');
  state.workloads = d.workloads.map(w => Object.assign({ picked: w.recommended }, w));
  state.products = d.products;
  renderWorkloads(); renderProducts(); await plan();
  loadPlugins();
})();
</script>
</body></html>`;
}

/* One call against the Infinity Server the user named. The server is a plain
 * HTTP service on loopback, so the client is a plain HTTP call: a timeout that
 * is generous for a local server and short enough that the window never hangs,
 * and an unreachable server reported as a fact rather than an exception. */
function callServer(base, method, p, body) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(p, base); } catch { resolve({ reachable: false, error: 'not a url' }); return; }
    const text = body == null ? null : JSON.stringify(body);
    const req = http.request({ host: u.hostname, port: u.port || 80, path: u.pathname, method: method,
      timeout: 5000, headers: text ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) } : {} },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let j = null;
          try { j = JSON.parse(raw); } catch { /* not json */ }
          resolve({ reachable: true, status: res.statusCode, json: j });
        });
      });
    req.on('timeout', () => { req.destroy(); resolve({ reachable: false, error: 'timeout' }); });
    req.on('error', (e) => resolve({ reachable: false, error: String((e && e.message) || e) }));
    if (text) req.write(text);
    req.end();
  });
}

/* Pass the server's answer through: its JSON body, its status code. Wrapping it
 * would mean the studio's API has a different shape from the server's for no
 * reason, and a client would have to know which layer it is talking to. A
 * server that cannot be reached answers 502 with the reason, so the window
 * can show 'server not running' instead of an empty success. */
function forward(res, r) {
  if (!r || r.reachable === false) return send(res, 502, { error: 'server unreachable', reason: (r && r.error) || 'unknown' });
  const body = r.json == null ? {} : r.json;
  return send(res, r.status || 200, body);
}

/* Ask a running Infinity Server who it is. The server answers on
 * /v1/health with its own statistics, so a client that can read that one
 * route can show the whole console state; a connection failure is a fact
 * about the network, not an error in the studio. */
function probeServer(base) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(base + '/v1/health'); } catch { resolve({ reachable: false, error: 'not a url' }); return; }
    const req = http.request({ host: u.hostname, port: u.port || 80, path: u.pathname, method: 'GET', timeout: 2500 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let j = null;
        try { j = JSON.parse(raw); } catch { /* not json */ }
        resolve({ reachable: true, base: base, status: res.statusCode, health: j });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ reachable: false, base: base, error: 'timeout' }); });
    req.on('error', (e) => resolve({ reachable: false, base: base, error: String(e.message || e) }));
    req.end();
  });
}

function send(res, code, obj, type) {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(code, { 'content-type': type || 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks).toString('utf8') : null));
    req.on('error', () => resolve(null));
  });
}
function safeJson(text) { try { return JSON.parse(text); } catch { return {}; } }

export { human };
