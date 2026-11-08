// ui.hpp - the page InfinityPackageManager's window renders.
//
// Electron is only a shell: it loads this page over loopback and draws it.
// The markup, the styles and the behaviour are owned here, in the C++
// program, which is why they are raw string literals rather than files - a
// page that ships inside the executable cannot be lost beside it, and the
// whole point of this suite is an application that needs nothing installed
// around it.
//
// The interface is direct manipulation, and that is a rule rather than a
// preference: a filter box filters, a row selects, and a button acts on the
// selection. Nothing here builds a command line, because a package manager
// that makes you type a package name has not been given an interface.
//
// The three documents are served from `/`, `/app.css` and `/app.js`. They
// share nothing but the ids in the markup, so they are kept in one file: a
// change to the structure almost always implies a change to the stylesheet.

#pragma once

namespace inc {

inline const char* uiHtml() {
  return R"HTML(<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>InfinityPackageManager</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<header class="bar">
  <div class="brand">
    <span class="name">InfinityPackageManager</span>
    <span class="ver" id="version"></span>
  </div>
  <div class="summary" id="summary">loading…</div>
  <div class="who" id="who"></div>
</header>

<div class="toolbar">
  <label class="filter">
    <input id="filter" type="search" placeholder="搜索软件包" autocomplete="off" spellcheck="false">
  </label>
  <button id="install" class="btn primary" type="button" disabled>安装</button>
  <button id="download" class="btn" type="button" disabled>下载</button>
  <button id="refresh" class="btn" type="button">刷新</button>
  <button id="folder" class="btn" type="button">打开目录</button>
  <span class="hint" id="installHint"></span>
</div>

<main>
  <section class="list">
    <table id="packages">
      <thead>
        <tr>
          <th>软件包</th><th>版本</th><th>平台</th><th>大小</th><th>类型</th>
        </tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>
    <div class="empty" id="empty" hidden>没有匹配的软件包。</div>
  </section>

  <aside class="detail">
    <h2 id="dTitle">未选择软件包</h2>
    <p class="tip">在上方列表中选中一行，再点「安装」。</p>
    <dl>
      <dt>版本</dt><dd id="dVersion">—</dd>
      <dt>平台</dt><dd id="dPlatform">—</dd>
      <dt>大小</dt><dd id="dSize">—</dd>
      <dt>类型</dt><dd id="dKind">—</dd>
    </dl>
    <details>
      <summary>技术信息</summary>
      <dl>
        <dt>Page tag</dt><dd id="dPage">—</dd>
        <dt>SHA-256</dt><dd id="dDigest" class="mono">—</dd>
        <dt>Source</dt><dd id="dUrl" class="mono">—</dd>
      </dl>
    </details>
  </aside>
</main>

<footer class="status">
  <span class="dot" id="dot"></span>
  <span id="status">就绪。</span>
</footer>

<script src="/app.js"></script>
</body>
</html>
</html>
)HTML";
}

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
header .who { color: var(--dim); border-left: 1px solid var(--line); padding-left: 16px; }

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

.filter { margin-left: auto; }
.filter input {
  font: inherit;
  width: 280px;
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
.tip { margin: 0 0 10px; color: var(--dim); font-size: 12px; }
aside.detail details { margin-top: 12px; border-top: 1px solid var(--line); padding-top: 10px; }
aside.detail details > summary { cursor: pointer; color: var(--dim); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
aside.detail details[open] > summary { margin-bottom: 8px; }
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
tbody td.pkg { font-weight: 600; }

.empty { padding: 40px; text-align: center; color: var(--dim); }

.detail {
  flex: 0 0 380px;
  width: 380px;
  padding: 18px 20px;
  overflow: auto;
  background: var(--panel);
  border-left: 1px solid var(--line);
}
.detail h2 { margin: 0 0 14px; font-size: 16px; }
.detail dl { display: grid; grid-template-columns: 88px 1fr; gap: 6px 12px; margin: 0; }
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

@media (max-width: 900px) { .detail { display: none; } }
)CSS";
}

inline const char* uiJs() {
  return R"JS('use strict';

const $ = (id) => document.getElementById(id);
const SHA256 = /^sha256:[0-9a-f]{64}$/;

let state = { packages: [] };
let selected = null;
let busy = false;
let filterTimer = null;

// ------------------------------------------------------------------ helpers

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

// Why Install is off, in words. The rule is the server's `installable`, and
// the reason is derived from the same two facts the server used: a digest
// that parses as SHA-256, and a setup kind.
function installReason(pkg) {
  if (pkg.installable) return '';
  if (!SHA256.test(String(pkg.digest || '').toLowerCase())) {
    return '无法安装：此构建没有有效的 SHA-256 校验值。';
  }
  return '无法安装：此构建不是安装包（类型：' + (pkg.kind || 'port') + '）。';
}

function cell(text, className) {
  const td = document.createElement('td');
  td.textContent = text == null ? '' : String(text);
  if (className) td.className = className;
  return td;
}

function chosenPackage() {
  const packages = state.packages || [];
  return selected !== null && selected < packages.length ? packages[selected] : null;
}

// ------------------------------------------------------------------- render

function updateButtons() {
  const chosen = chosenPackage();
  $('refresh').disabled = busy;
  $('folder').disabled = busy;
  $('download').disabled = busy || !chosen;
  $('install').disabled = busy || !chosen || !chosen.installable;
  const reason = chosen ? installReason(chosen) : '';
  $('installHint').textContent = reason;
  $('install').title = reason;
}

function renderDetail(pkg) {
  $('dTitle').textContent = pkg ? pkg.package : '未选择软件包';
  $('dVersion').textContent = pkg ? (pkg.version || '—') : '—';
  $('dPlatform').textContent = pkg ? (pkg.platform || '—') : '—';
  $('dSize').textContent = pkg ? fmtSize(pkg.size) : '—';
  $('dKind').textContent = pkg ? (pkg.kind || 'port') : '—';
  $('dPage').textContent = pkg ? (pkg.page || '—') : '—';
  $('dDigest').textContent = pkg ? (pkg.digest || '无') : '—';
  $('dUrl').textContent = pkg ? (pkg.url || '—') : '—';
}

function render() {
  const packages = state.packages || [];
  if (selected !== null && selected >= packages.length) selected = null;

  const summary = state.summary || {};
  $('version').textContent = state.version ? 'v' + state.version : '';
  $('summary').textContent = summary.loaded
    ? (summary.builds + ' builds · ' + summary.installable + ' installable')
    : (summary.error || 'not loaded');
  $('who').textContent = state.login
    ? (state.login + (state.tokenSource ? ' · ' + state.tokenSource : ''))
    : 'not signed in';

  const body = $('rows');
  body.innerHTML = '';
  packages.forEach((pkg, index) => {
    const row = document.createElement('tr');
    if (index === selected) row.classList.add('selected');
    if (!pkg.installable) row.classList.add('dim');
    row.appendChild(cell(pkg.package, 'pkg'));
    row.appendChild(cell(pkg.version));
    row.appendChild(cell(pkg.platform));
    row.appendChild(cell(fmtSize(pkg.size)));
    row.appendChild(cell(pkg.kind || 'port'));
    row.addEventListener('click', () => select(index));
    row.addEventListener('dblclick', () => quickAction(index));
    body.appendChild(row);
  });
  $('empty').hidden = packages.length !== 0;

  renderDetail(chosenPackage());
  updateButtons();
}

function setStatus(text, kind) {
  $('status').textContent = text;
  $('dot').className = 'dot' + (kind ? ' ' + kind : '');
}

function setBusy(value) {
  busy = value;
  updateButtons();
}

function select(index) {
  selected = index;
  render();
}

// ------------------------------------------------------------------ actions

async function doRefresh() {
  if (busy) return;
  setBusy(true);
  setStatus('Refreshing the catalogue…', 'work');
  try {
    state = await api('/api/refresh', { method: 'POST' });
    selected = null;
    render();
    setStatus('Catalogue refreshed.', 'ok');
  } catch (error) {
    setStatus(error.message, 'bad');
  } finally {
    setBusy(false);
  }
}

async function doInstall() {
  const pkg = chosenPackage();
  if (!pkg || busy) return;
  if (!pkg.installable) { setStatus(installReason(pkg), 'bad'); return; }
  setBusy(true);
  setStatus('Downloading and verifying ' + pkg.package + ' ' + pkg.version + '…', 'work');
  try {
    const result = await api(
      '/api/install?package=' + encodeURIComponent(pkg.package) +
      '&platform=' + encodeURIComponent(pkg.platform),
      { method: 'POST' });
    setStatus(result.message || 'Installed.', 'ok');
  } catch (error) {
    setStatus(error.message, 'bad');
  } finally {
    setBusy(false);
  }
}

async function doDownload() {
  const pkg = chosenPackage();
  if (!pkg || busy) return;
  setBusy(true);
  setStatus('Downloading ' + pkg.package + ' ' + pkg.version + '…', 'work');
  try {
    const result = await api(
      '/api/download?package=' + encodeURIComponent(pkg.package) +
      '&platform=' + encodeURIComponent(pkg.platform),
      { method: 'POST' });
    setStatus(result.message || 'Downloaded.', 'ok');
  } catch (error) {
    setStatus(error.message, 'bad');
  } finally {
    setBusy(false);
  }
}

async function doOpenFolder() {
  if (busy) return;
  setBusy(true);
  try {
    const result = await api('/api/open-folder', { method: 'POST' });
    setStatus(result.message || 'Opened the download folder.', 'ok');
  } catch (error) {
    setStatus(error.message, 'bad');
  } finally {
    setBusy(false);
  }
}

function quickAction(index) {
  select(index);
  const pkg = chosenPackage();
  if (pkg && pkg.installable) doInstall();
  else doDownload();
}

// The filter filters. It asks the catalogue route for the rows that match and
// leaves the catalogue itself alone - it never runs a command.
async function applyFilter() {
  const query = $('filter').value.trim();
  const keep = chosenPackage();
  try {
    state = await api('/api/search?q=' + encodeURIComponent(query));
    selected = null;
    if (keep) {
      const at = (state.packages || []).findIndex(
        (p) => p.package === keep.package && p.platform === keep.platform && p.version === keep.version);
      if (at >= 0) selected = at;
    }
    render();
    setStatus(query ? 'Filter: ' + query : 'Filter cleared.', '');
  } catch (error) {
    setStatus(error.message, 'bad');
  }
}

// ------------------------------------------------------------------- wiring

$('refresh').addEventListener('click', doRefresh);
$('install').addEventListener('click', doInstall);
$('download').addEventListener('click', doDownload);
$('folder').addEventListener('click', doOpenFolder);
$('filter').addEventListener('input', () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(applyFilter, 150);
});

document.addEventListener('keydown', (event) => {
  const active = document.activeElement;
  if (active && active.id === 'filter') return;   // the caret owns the arrows there
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const count = (state.packages || []).length;
  if (!count) return;
  event.preventDefault();
  if (selected === null) selected = event.key === 'ArrowDown' ? 0 : count - 1;
  else selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
  render();
  const row = document.querySelector('tbody tr.selected');
  if (row) row.scrollIntoView({ block: 'nearest' });
});

(async function boot() {
  try {
    state = await api('/api/state');
    render();
    setStatus('Ready.', '');
  } catch (error) {
    setStatus(error.message, 'bad');
  }
})();
)JS";
}

}  // namespace inc
