// ui.hpp - the page Infinity Installer Manager's window renders.
//
// Electron is only a shell: it loads this page over loopback and draws it.
// The markup, the styles and the behaviour are owned here, in the C++
// program, which is why they are raw string literals rather than files - a
// page that ships inside the executable cannot be lost beside it, and the
// whole point of this suite is an application that needs nothing installed
// around it.
//
// The interface is direct manipulation, and that is a rule rather than a
// preference: a category is a tab, a filter box filters, a row selects, and a
// button acts on the selection. Nothing here builds a command line, because
// an installer that makes you type a package name has not been given an
// interface.
//
// Infinity Installer Manager is the suite's one installer, and it is the
// sibling of InfinityPackageManager: the same catalogue, the same digest rule,
// the same table - so the markup, the class names and the stylesheet are
// deliberately the same shape as ipm/ui.hpp. The three documents are served
// from `/`, `/app.css` and `/app.js`.
//
// The data on this page comes from GitHub: package names, versions, release
// tags. It is not trusted, so every value is inserted with textContent and
// createElement, never with innerHTML.

#pragma once

namespace inc {

// ---------------------------------------------------------------- markup

inline const char* uiHtml() {
  return R"HTML(<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Infinity Installer Manager</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<header class="bar">
  <div class="brand">
    <span class="name">Infinity Installer Manager</span>
    <span class="ver" id="version"></span>
  </div>
  <div class="summary" id="summary">loading…</div>
  <div class="who">
    <span class="acct" id="account">—</span>
    <span class="src" id="tokenSource"></span>
    <span class="plat" id="platform"></span>
  </div>
</header>

<nav class="tabs" id="tabs">
  <button class="tab on" type="button" data-view="product">Products</button>
  <button class="tab" type="button" data-view="plugin">Plugins</button>
  <button class="tab" type="button" data-view="resource">Resources</button>
  <button class="tab" type="button" data-view="installed">Installed</button>
</nav>

<div class="toolbar">
  <button id="refresh" class="btn" type="button">Refresh</button>
  <button id="install" class="btn primary" type="button" disabled>Install</button>
  <button id="download" class="btn" type="button" disabled>Download</button>
  <button id="remove" class="btn danger" type="button" disabled>Remove</button>
  <button id="folder" class="btn" type="button">Open folder</button>
  <label class="filter">
    <input id="filter" type="search" placeholder="Filter by name, version or platform"
           autocomplete="off" spellcheck="false">
  </label>
  <span class="hint" id="installHint"></span>
</div>

<main>
  <section class="list">
    <table id="packages">
      <thead>
        <tr id="headRow"></tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>
    <div class="state" id="state" hidden></div>
  </section>

  <aside class="detail">
    <h2 id="dTitle">No item selected</h2>
    <dl>
      <dt>Version</dt><dd id="dVersion">—</dd>
      <dt>Platform</dt><dd id="dPlatform">—</dd>
      <dt>Size</dt><dd id="dSize">—</dd>
      <dt>Kind</dt><dd id="dKind">—</dd>
      <dt>Category</dt><dd id="dCategory">—</dd>
      <dt>Installed at</dt><dd id="dInstalled">—</dd>
      <dt>Page tag</dt><dd id="dPage">—</dd>
      <dt>SHA-256</dt><dd id="dDigest" class="mono">—</dd>
      <dt>Source</dt><dd id="dSource" class="mono">—</dd>
    </dl>
  </aside>
</main>

<footer class="status">
  <span class="dot" id="dot"></span>
  <span id="status">Ready.</span>
</footer>

<div class="modal" id="modal" hidden>
  <div class="box">
    <h3 id="modalTitle">Remove</h3>
    <p class="note" id="modalNote"></p>
    <div class="row">
      <button class="btn" id="modalCancel" type="button">Cancel</button>
      <button class="btn danger" id="modalOk" type="button">Remove</button>
    </div>
  </div>
</div>

<script src="/app.js"></script>
</body>
</html>
)HTML";
}

// ---------------------------------------------------------------- styles

inline const char* uiCss() {
  return R"CSS(:root {
  --bg: #0e1116;
  --panel: #161b22;
  --ink: #e6edf3;
  --dim: #8b949e;
  --line: #2a3038;
  --line-soft: #eef1f7;
  --accent: #58a6ff;
  --accent-dark: #2559c8;
  --sel: #1f2a3d;
  --ok: #3fb950;
  --warn: #d29922;
  --bad: #f85149;
  --mono: ui-monospace, "Cascadia Mono", "Consolas", monospace;
}

* { box-sizing: border-box; }
html, body { height: 100%; }

body {
  margin: 0;
  display: flex;
  flex-direction: column;
  height: 100vh;
  color: var(--ink);
  background: var(--bg);
  font: 14px/1.45 -apple-system, "Segoe UI", system-ui, "Microsoft YaHei", sans-serif;
}

header.bar {
  display: flex;
  align-items: baseline;
  gap: 16px;
  padding: 14px 20px;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
}
header .brand { display: flex; align-items: baseline; gap: 8px; font-size: 16px; font-weight: 650; }
header .ver { color: var(--dim); font-size: 12px; font-weight: 400; }
header .summary { margin-left: auto; color: var(--dim); }
header .who {
  display: flex;
  gap: 12px;
  color: var(--dim);
  border-left: 1px solid var(--line);
  padding-left: 16px;
  white-space: nowrap;
}
header .who .acct { color: var(--ok); font-weight: 600; }
header .who .src { font-family: var(--mono); font-size: 12px; }

/* tabs: the three catalogues and what is already on the machine */
.tabs {
  display: flex;
  gap: 2px;
  padding: 0 20px;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
}
.tab {
  font: inherit;
  font-size: 13.5px;
  padding: 10px 16px;
  color: var(--dim);
  background: 0;
  border: 0;
  border-bottom: 2px solid transparent;
  cursor: pointer;
}
.tab:hover { color: var(--ink); }
.tab.on { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }

.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 20px;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
}

.btn {
  font: inherit;
  padding: 7px 14px;
  color: var(--ink);
  background: #fbfcfe;
  border: 1px solid var(--line);
  border-radius: 8px;
  cursor: pointer;
}
.btn:hover:not(:disabled) { background: #f2f5fb; border-color: #c9d4e6; }
.btn:disabled { opacity: .45; cursor: not-allowed; }
.btn.primary { color: #fff; background: var(--accent); border-color: var(--accent); }
.btn.primary:hover:not(:disabled) { background: var(--accent-dark); border-color: var(--accent-dark); }
.btn.danger { color: var(--bad); border-color: #ecc6c2; }
.btn.danger:hover:not(:disabled) { background: #fdf3f2; border-color: var(--bad); }

.filter { margin-left: auto; }
.filter input {
  font: inherit;
  width: 300px;
  padding: 7px 12px;
  color: var(--ink);
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 8px;
}
.filter input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(47, 111, 237, .15);
}

.hint { flex-basis: 100%; min-height: 0; color: var(--warn); font-size: 12px; }
.hint:empty { display: none; }

main { flex: 1; display: flex; min-height: 0; }
.list { flex: 1; overflow: auto; padding: 12px 20px; }

table {
  width: 100%;
  border-collapse: collapse;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
}
thead th {
  position: sticky;
  top: 0;
  padding: 9px 12px;
  text-align: left;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .04em;
  text-transform: uppercase;
  color: var(--dim);
  background: #f7f9fc;
  border-bottom: 1px solid var(--line);
}
tbody td { padding: 9px 12px; border-bottom: 1px solid var(--line-soft); }
tbody tr { cursor: pointer; }
tbody tr:hover { background: #f6f9ff; }
tbody tr.selected { background: var(--sel); }
tbody tr.selected td { border-bottom-color: #cfe0ff; }
tbody tr.dim { color: var(--dim); }
tbody td.name { font-weight: 600; }

/* the three states that are not a table: loading, empty, error. They are
   drawn differently on purpose - "nothing matches" and "could not reach the
   catalogue" must never be mistaken for one another. */
.state { padding: 44px 20px; text-align: center; color: var(--dim); }
.state .big { display: block; font-size: 26px; line-height: 1; margin-bottom: 12px; }
.state .txt { display: block; font-size: 13.5px; word-break: break-word; }
.state.loading { color: var(--dim); }
.state.loading .big { opacity: .55; }
.state.empty { color: var(--dim); }
.state.error { color: var(--bad); }
.state.error .txt { font-family: var(--mono); font-size: 12.5px; }

.detail {
  flex: 0 0 380px;
  width: 380px;
  padding: 18px 20px;
  overflow: auto;
  background: var(--panel);
  border-left: 1px solid var(--line);
}
.detail h2 { margin: 0 0 14px; font-size: 16px; }
.detail dl { display: grid; grid-template-columns: 96px 1fr; gap: 6px 12px; margin: 0; }
.detail dt { padding-top: 2px; color: var(--dim); font-size: 12px; }
.detail dd { margin: 0; word-break: break-all; }
.mono { font-family: var(--mono); font-size: 12px; }

footer.status {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 20px;
  color: var(--dim);
  background: var(--panel);
  border-top: 1px solid var(--line);
  font-size: 13px;
}
.dot { flex: 0 0 8px; width: 8px; height: 8px; border-radius: 50%; background: #b9c2d0; }
.dot.ok { background: var(--ok); }
.dot.bad { background: var(--bad); }
.dot.work { background: var(--accent); }

/* modal: the one place a removal is confirmed by naming what goes */
.modal {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(20, 26, 36, .45);
}
.modal[hidden] { display: none; }
.modal .box {
  width: min(460px, 92vw);
  padding: 20px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 18px 50px rgba(20, 26, 36, .25);
}
.modal h3 { margin: 0 0 12px; font-size: 15px; }
.modal .note { margin: 0 0 16px; color: var(--dim); font-size: 13px; white-space: pre-line; word-break: break-all; }
.modal .row { display: flex; gap: 8px; justify-content: flex-end; }

@media (max-width: 900px) { .detail { display: none; } }
)CSS";
}

// ---------------------------------------------------------------- script

inline const char* uiJs() {
  return R"JS('use strict';

const $ = (id) => document.getElementById(id);
const SHA256 = /^sha256:[0-9a-f]{64}$/;

let state = {
  view: 'product',
  filter: '',
  loading: true,
  error: '',
  items: [],
  selected: null,
  version: '',
  platform: '',
  login: '',
  tokenSource: '',
  summary: {},
  installedAll: [],
  installedLoaded: false
};
let busy = false;
let filterTimer = null;
let pendingRemove = null;

// ------------------------------------------------------------------ helpers

function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

async function api(path, options) {
  const response = await fetch(path, options);
  let body = null;
  try { body = await response.json(); } catch (error) { body = null; }
  if (!response.ok) {
    const message = (body && (body.error || body.message)) || ('HTTP ' + response.status);
    throw new Error(message);
  }
  return body;
}

function fmtSize(bytes) {
  let value = Number(bytes) || 0;
  if (value < 1024) return value + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let index = -1;
  do { value /= 1024; index++; } while (value >= 1024 && index < units.length - 1);
  return value.toFixed(value < 10 ? 1 : 0) + ' ' + units[index];
}

function cell(text, className) {
  const td = document.createElement('td');
  td.textContent = text == null ? '' : String(text);
  if (className) td.className = className;
  return td;
}

// The rule the server enforces, applied to the row so the button can say no
// before a request is made: a build with no well-formed SHA-256 digest is not
// installable, whatever its kind.
function installable(item) {
  return SHA256.test(String(item && item.digest || '').toLowerCase());
}

function installReason(item) {
  if (installable(item)) return '';
  return 'Install is disabled: this build has no valid SHA-256 digest.';
}

function isInstalledView() { return state.view === 'installed'; }

function chosen() {
  return state.selected !== null && state.selected < state.items.length ? state.items[state.selected] : null;
}

// ------------------------------------------------------------------- render

function renderHeader() {
  $('version').textContent = state.version ? 'v' + state.version : '';
  const summary = state.summary || {};
  $('summary').textContent = summary.loaded
    ? (summary.products + ' products · ' + summary.plugins + ' plugins · ' + summary.resources + ' resources')
    : (summary.error || 'catalogue not loaded');
  $('account').textContent = state.login || 'not signed in';
  $('tokenSource').textContent = state.tokenSource ? ('via ' + state.tokenSource) : '';
  $('platform').textContent = state.platform || '';
}

function renderHead() {
  const labels = isInstalledView()
    ? ['Name', 'Category', 'Version', 'Installed at']
    : ['Name', 'Version', 'Platform', 'Size', 'Kind'];
  const head = $('headRow');
  clear(head);
  labels.forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    head.appendChild(th);
  });
}

function renderRows() {
  const body = $('rows');
  clear(body);
  state.items.forEach((item, index) => {
    const row = document.createElement('tr');
    if (index === state.selected) row.classList.add('selected');
    if (!isInstalledView() && !installable(item)) row.classList.add('dim');
    const cells = isInstalledView()
      ? [item.name, item.category || '—', item.version, item.installedAt || '—']
      : [item.name, item.version, item.platform, fmtSize(item.size), item.kind || 'port'];
    cells.forEach((value, column) => row.appendChild(cell(value, column === 0 ? 'name' : '')));
    row.addEventListener('click', () => { state.selected = index; render(); });
    row.addEventListener('dblclick', () => { state.selected = index; quickAction(); });
    body.appendChild(row);
  });
}

function setStateBlock(kind, glyph, text) {
  const el = $('state');
  el.className = 'state ' + kind;
  clear(el);
  const big = document.createElement('span');
  big.className = 'big';
  big.textContent = glyph;
  const line = document.createElement('span');
  line.className = 'txt';
  line.textContent = text;
  el.appendChild(big);
  el.appendChild(line);
  el.hidden = false;
}

function renderState() {
  if (state.loading) { setStateBlock('loading', '\u23F3', 'Loading the catalogue…'); return; }
  if (state.error) { setStateBlock('error', '\u26A0', 'Could not load: ' + state.error); return; }
  if (state.items.length) { $('state').hidden = true; return; }
  if (isInstalledView()) {
    setStateBlock('empty', '\uD83D\uDCE6', 'Nothing is installed yet.');
  } else if (state.filter.trim()) {
    setStateBlock('empty', '\uD83D\uDD0D', 'No packages match “' + state.filter.trim() + '”.');
  } else {
    setStateBlock('empty', '\uD83D\uDCE6', 'This catalogue page is empty.');
  }
}

function renderDetail() {
  const item = chosen();
  const installed = isInstalledView();
  $('dTitle').textContent = item ? item.name : 'No item selected';
  $('dVersion').textContent = item ? (item.version || '—') : '—';
  $('dPlatform').textContent = item ? (item.platform || '—') : '—';
  $('dSize').textContent = item ? fmtSize(item.size) : '—';
  $('dKind').textContent = item ? (item.kind || (installed ? '—' : 'port')) : '—';
  $('dCategory').textContent = item ? (item.category || (installed ? '—' : state.view)) : '—';
  $('dInstalled').textContent = item ? (item.installedAt || '—') : '—';
  $('dPage').textContent = item ? (item.page || '—') : '—';
  $('dDigest').textContent = item ? (item.digest || 'none reported') : '—';
  $('dSource').textContent = item ? (installed ? (item.directory || '—') : (item.url || '—')) : '—';
}

function updateButtons() {
  const item = chosen();
  const installed = isInstalledView();
  const frozen = busy || state.loading;
  $('refresh').disabled = frozen;
  $('folder').disabled = frozen;
  $('install').disabled = frozen || installed || !item || !installable(item);
  $('download').disabled = frozen || installed || !item;
  $('remove').disabled = frozen || !installed || !item;   // Remove exists only in the Installed view
  const hint = (!installed && item && !installable(item)) ? installReason(item) : '';
  $('installHint').textContent = hint;
  $('install').title = hint;
}

function render() {
  if (state.selected !== null && state.selected >= state.items.length) state.selected = null;
  renderHeader();
  renderHead();
  renderRows();
  renderState();
  renderDetail();
  updateButtons();
}

function setStatus(text, kind) {
  $('status').textContent = text;
  $('dot').className = 'dot' + (kind ? ' ' + kind : '');
}

function readyLine() {
  if (isInstalledView()) return state.items.length + ' installed';
  return state.items.length + ' builds in this category';
}

// ------------------------------------------------------------------- loading

async function loadRows() {
  state.loading = true;
  state.error = '';
  render();
  setStatus('Loading…', 'work');
  try {
    if (isInstalledView()) {
      if (!state.installedLoaded) {
        const loaded = await api('/api/installed');
        state.installedAll = loaded.installed || [];
        state.installedLoaded = true;
      }
      const needle = state.filter.trim().toLowerCase();
      state.items = !needle ? state.installedAll.slice() : state.installedAll.filter((item) => {
        const haystack = (String(item.name) + ' ' + String(item.category) + ' ' +
                          String(item.version) + ' ' + String(item.platform)).toLowerCase();
        return haystack.indexOf(needle) >= 0;
      });
    } else {
      const query = state.filter.trim();
      const payload = query
        ? await api('/api/search?q=' + encodeURIComponent(query))
        : await api('/api/catalog?category=' + encodeURIComponent(state.view));
      state.items = (payload.packages || []).filter(
        (item) => (item.category || state.view) === state.view);
    }
    state.loading = false;
    state.selected = null;
    render();
    setStatus(readyLine(), '');
  } catch (error) {
    state.loading = false;
    state.error = error.message;
    state.items = [];
    state.selected = null;
    render();
    setStatus(error.message, 'bad');
  }
}

async function loadState() {
  const payload = await api('/api/state');
  state.version = payload.version || '';
  state.platform = payload.platform || '';
  state.login = payload.login || '';
  state.tokenSource = payload.tokenSource || '';
  state.summary = payload.summary || {};
}

// ------------------------------------------------------------------ actions

async function doRefresh() {
  if (busy) return;
  busy = true;
  updateButtons();
  setStatus('Refreshing the catalogue…', 'work');
  try {
    await api('/api/refresh', { method: 'POST' });
    await loadState();
    state.installedLoaded = false;
    busy = false;
    await loadRows();
    setStatus('Catalogue refreshed.', 'ok');
  } catch (error) {
    busy = false;
    setStatus(error.message, 'bad');
    render();
  }
}

async function doInstall() {
  const item = chosen();
  if (!item || busy || isInstalledView()) return;
  if (!installable(item)) { setStatus(installReason(item), 'bad'); return; }
  busy = true;
  updateButtons();
  setStatus('Downloading and verifying ' + item.name + ' ' + item.version + '…', 'work');
  try {
    const result = await api(
      '/api/install?name=' + encodeURIComponent(item.name) +
      '&platform=' + encodeURIComponent(item.platform),
      { method: 'POST' });
    state.installedLoaded = false;
    setStatus(result.message || 'Installed.', 'ok');
  } catch (error) {
    setStatus(error.message, 'bad');
  } finally {
    busy = false;
    updateButtons();
  }
}

async function doDownload() {
  const item = chosen();
  if (!item || busy || isInstalledView()) return;
  busy = true;
  updateButtons();
  setStatus('Downloading ' + item.name + ' ' + item.version + '…', 'work');
  try {
    const result = await api(
      '/api/download?name=' + encodeURIComponent(item.name) +
      '&platform=' + encodeURIComponent(item.platform),
      { method: 'POST' });
    setStatus(result.message || 'Downloaded.', 'ok');
  } catch (error) {
    setStatus(error.message, 'bad');
  } finally {
    busy = false;
    updateButtons();
  }
}

async function doRemove(item) {
  if (!item || busy) return;
  busy = true;
  updateButtons();
  setStatus('Removing ' + item.name + '…', 'work');
  try {
    const result = await api('/api/remove?name=' + encodeURIComponent(item.name), { method: 'POST' });
    state.installedLoaded = false;
    busy = false;
    await loadRows();
    setStatus(result.message || ('Removed ' + item.name + '.'), 'ok');
  } catch (error) {
    busy = false;
    setStatus(error.message, 'bad');
    render();
  }
}

async function doOpenFolder() {
  if (busy) return;
  const item = isInstalledView() ? chosen() : null;
  busy = true;
  updateButtons();
  try {
    const result = await api('/api/open-folder' + (item ? '?name=' + encodeURIComponent(item.name) : ''),
                             { method: 'POST' });
    setStatus(result.message || 'Opened the install folder.', 'ok');
  } catch (error) {
    setStatus(error.message, 'bad');
  } finally {
    busy = false;
    updateButtons();
  }
}

function quickAction() {
  if (isInstalledView()) { doOpenFolder(); return; }
  const item = chosen();
  if (item && installable(item)) doInstall();
  else doDownload();
}

// The filter filters. In a catalogue it asks the search route for the rows
// that match; in the Installed view it narrows the list already on screen. It
// never runs a command.
function applyFilter() {
  state.filter = $('filter').value;
  loadRows();
}

function switchView(view) {
  state.view = view;
  state.selected = null;
  document.querySelectorAll('.tabs .tab').forEach((tab) => {
    tab.classList.toggle('on', tab.getAttribute('data-view') === view);
  });
  loadRows();
}

// ------------------------------------------------------------------- modal

function openRemoveModal(item) {
  pendingRemove = item;
  $('modalTitle').textContent = 'Remove';
  $('modalNote').textContent =
    'Remove “' + item.name + '” from this machine?\n' + (item.directory || '');
  $('modal').hidden = false;
  setTimeout(() => $('modalOk').focus(), 0);
}

function closeModal() {
  $('modal').hidden = true;
  pendingRemove = null;
}

$('modalOk').addEventListener('click', () => {
  const item = pendingRemove;
  closeModal();
  if (item) doRemove(item);
});
$('modalCancel').addEventListener('click', closeModal);

// ------------------------------------------------------------------- wiring

$('refresh').addEventListener('click', doRefresh);
$('install').addEventListener('click', doInstall);
$('download').addEventListener('click', doDownload);
$('remove').addEventListener('click', () => {
  const item = chosen();
  if (!isInstalledView()) { setStatus('Switch to Installed to remove something.', 'bad'); return; }
  if (item) openRemoveModal(item);
  else setStatus('Select an installed item first.', 'bad');
});
$('folder').addEventListener('click', doOpenFolder);

$('filter').addEventListener('input', () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(applyFilter, 150);
});

document.querySelectorAll('.tabs .tab').forEach((tab) => {
  tab.addEventListener('click', () => switchView(tab.getAttribute('data-view')));
});

document.addEventListener('keydown', (event) => {
  if (!$('modal').hidden && event.key === 'Escape') { closeModal(); return; }
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'SELECT')) return;  // the caret owns the arrows there
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const count = state.items.length;
  if (!count) return;
  event.preventDefault();
  if (state.selected === null) state.selected = event.key === 'ArrowDown' ? 0 : count - 1;
  else state.selected = (state.selected + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
  render();
  const row = document.querySelector('tbody tr.selected');
  if (row) row.scrollIntoView({ block: 'nearest' });
});

(async function boot() {
  try {
    await loadState();
    await loadRows();
    setStatus('Ready.', '');
  } catch (error) {
    state.loading = false;
    state.error = error.message;
    render();
    setStatus(error.message, 'bad');
  }
})();
)JS";
}

}  // namespace inc
