// ui.hpp - the page Infinity Cloud's window renders.
//
// The window is Electron; it knows how to draw HTML and nothing else. What it
// draws is this file: one page, one stylesheet, one script, each a raw string
// literal so the C++ executable carries its own interface with no asset
// directory to lose beside it.
//
// The design rule for the whole suite is that the window is direct
// manipulation, not a command box. There is a list of rows, a breadcrumb, a
// toolbar and per-row actions; there is no field that runs a command and no
// screen of prose describing the features. Infinity Cloud is a cloud drive, so
// what the rows show is the cloud: folders open, files download, and the
// recycle bin is a second view of the same table.
//
// The three literals are served from /, /app.css and /app.js by main.cpp. They
// are kept in one header because they are one artifact - splitting them would
// only make it harder to see that a class named in the script has a rule in
// the stylesheet.

#pragma once

namespace inc {

// ---------------------------------------------------------------- markup

inline const char* uiHtml() {
  return R"HTML(<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Infinity Cloud</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<header class="top">
  <div class="brand"><span class="logo"></span><b>Infinity Cloud</b><span class="ver" id="version"></span></div>
  <div class="who">
    <span class="acct" id="account">&hellip;</span>
    <span class="src" id="tokenSource"></span>
    <span class="plat" id="platform"></span>
  </div>
</header>

<nav class="tabs">
  <button class="tab on" id="tabFiles">My Cloud Drive</button>
  <button class="tab" id="tabTrash">Recycle Bin</button>
</nav>

<div class="toolbar" id="toolbar">
  <button class="btn" data-act="up" title="Up one level">Up</button>
  <button class="btn" data-act="mkdir">New folder</button>
  <button class="btn" data-act="refresh">Refresh</button>
  <button class="btn" data-act="delete">Delete</button>
  <button class="btn primary" data-act="upload">Upload</button>
  <input type="file" id="file" multiple hidden>
</div>
<div class="toolbar" id="trashbar" hidden>
  <button class="btn danger" data-act="purgeAll">Empty recycle bin</button>
  <button class="btn" data-act="refresh">Refresh</button>
</div>

<div class="crumbs" id="crumbs"></div>

<div class="tablewrap">
  <table class="files">
    <thead>
      <tr><th class="c-name">Name</th><th class="c-size">Size</th><th class="c-mod">Modified</th><th class="c-act"></th></tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
  <div class="empty" id="empty" hidden></div>
</div>

<footer class="status"><span id="status">Ready</span></footer>

<div class="modal" id="modal" hidden>
  <div class="box">
    <h3 id="modalTitle">New folder</h3>
    <input id="modalInput" placeholder="Folder name" autocomplete="off">
    <div class="row">
      <button class="btn" id="modalCancel">Cancel</button>
      <button class="btn primary" id="modalOk">OK</button>
    </div>
  </div>
</div>

<div class="preview" id="preview" hidden>
  <div class="pv-head">
    <b id="pvName">Preview</b>
    <span class="pv-meta" id="pvMeta"></span>
    <label class="pv-follow"><input type="checkbox" id="pvFollow" checked> Follow tail</label>
    <button class="btn" id="pvClose">Close</button>
  </div>
  <div class="pv-body" id="pvBody"></div>
  <div class="pv-note" id="pvNote"></div>
</div>
<script src="/app.js"></script>
</body>
</html>
)HTML";
}

// ---------------------------------------------------------------- styles

inline const char* uiCss() {
  return R"CSS(:root{
  --bg:#0e1116;--panel:#161b22;--card:#1a2029;--line:#2a3038;
  --fg:#e6edf3;--dim:#8b949e;--acc:#58a6ff;--ok:#3fb950;--err:#f85149;
}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--fg);
  font:14px/1.5 -apple-system,"Segoe UI",system-ui,"Microsoft YaHei",sans-serif;
  display:flex;flex-direction:column}

/* header: who is signed in, where the credential came from, the version */
.top{display:flex;align-items:center;gap:14px;padding:12px 18px;
  background:var(--panel);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:10px}
.logo{width:22px;height:22px;border-radius:6px;
  background:linear-gradient(135deg,var(--acc),#7c3aed)}
.brand b{font-size:15px}
.ver{color:var(--dim);font-size:12px}
.who{margin-left:auto;display:flex;gap:14px;align-items:center;
  color:var(--dim);font-size:12.5px;white-space:nowrap}
.who .acct{color:var(--ok);font-weight:600}
.who .src{font-family:ui-monospace,Consolas,monospace}

/* tabs: the cloud and the recycle bin are two views of the same table */
.tabs{display:flex;gap:2px;padding:0 14px;background:var(--panel);
  border-bottom:1px solid var(--line)}
.tab{background:0;border:0;color:var(--dim);padding:10px 14px;cursor:pointer;
  font-size:13px;border-bottom:2px solid transparent}
.tab:hover{color:var(--fg)}
.tab.on{color:var(--fg);border-bottom-color:var(--acc)}

/* toolbar: the verbs that act on the current folder */
.toolbar{display:flex;align-items:center;gap:8px;padding:10px 18px;
  border-bottom:1px solid var(--line);flex-wrap:wrap}
.btn{background:var(--card);border:1px solid var(--line);color:var(--fg);
  border-radius:7px;padding:6px 13px;cursor:pointer;font-size:13px}
.btn:hover{border-color:var(--acc)}
.btn.primary{background:var(--acc);color:#08111c;border-color:var(--acc);font-weight:600}
.btn.danger{border-color:#5a2323;color:#ff9c96}
.btn.danger:hover{border-color:var(--err);color:var(--err)}

/* breadcrumb: clickable path back to any ancestor */
.crumbs{display:flex;align-items:center;gap:4px;padding:10px 18px;
  overflow:auto;border-bottom:1px solid var(--line)}
.crumb{color:var(--dim);cursor:pointer;padding:3px 7px;border-radius:5px;white-space:nowrap}
.crumb:hover{background:var(--card);color:var(--fg)}
.crumb.last{color:var(--fg);font-weight:600;cursor:default}
.sep{color:var(--line)}

/* table: one row per cloud entry */
.tablewrap{flex:1;overflow:auto}
.files{width:100%;border-collapse:collapse}
.files th{position:sticky;top:0;background:var(--panel);text-align:left;
  color:var(--dim);font-weight:500;font-size:12px;padding:9px 14px;
  border-bottom:1px solid var(--line);z-index:1}
.files td{padding:8px 14px;border-bottom:1px solid #1f242c;vertical-align:middle}
.files tr.row{cursor:default}
.files tr.row:hover{background:#161c25}
.files tr.sel{background:#12233b}
.c-name .ic{display:inline-block;width:22px;font-size:16px;text-align:center}
.c-name .nm{word-break:break-all}
.c-size,.c-mod{color:var(--dim);white-space:nowrap;font-size:12.5px}
.c-size{width:110px}
.c-mod{width:170px}
.c-act{width:96px;text-align:right;white-space:nowrap}
.act{background:transparent;border:1px solid transparent;color:var(--dim);
  border-radius:5px;width:26px;height:26px;cursor:pointer;font-size:13px;line-height:1}
.act:hover{color:var(--fg);border-color:var(--acc);background:#0b1017}
.empty{padding:70px 20px;text-align:center;color:var(--dim)}

/* status line: progress and errors */
.status{padding:8px 18px;border-top:1px solid var(--line);color:var(--dim);
  font-size:12px;display:flex;gap:16px;min-height:33px;align-items:center}
.status .ok{color:var(--ok)}
.status .err{color:var(--err)}
#status.ok{color:var(--ok)}
#status.err{color:var(--err)}

/* modal: the one place a name is typed, for a new folder */
.modal{position:fixed;inset:0;background:#000000b0;display:flex;
  align-items:center;justify-content:center;z-index:50}
.modal[hidden]{display:none}
.modal .box{background:var(--panel);border:1px solid var(--line);
  border-radius:12px;padding:20px;width:min(420px,92vw)}
.modal h3{margin:0 0 14px;font-size:15px}
.modal input{width:100%;background:#0b0f14;color:var(--fg);
  border:1px solid var(--line);border-radius:7px;padding:9px 12px;
  outline:none;font:13px inherit}
.modal input:focus{border-color:var(--acc)}
.modal .row{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
.preview{position:fixed;inset:0;background:#0f1115;color:#e8ecf1;display:flex;flex-direction:column;z-index:50}
.preview .pv-head{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid #2a2f3a}
.preview .pv-meta{color:#9aa4b2;font-size:12px;margin-left:auto}
.preview .pv-body{flex:1;overflow:auto;padding:12px 14px;position:relative}
.preview pre{margin:0;font:12px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
.preview .pv-lines{position:relative;min-height:100%;font:12px/18px ui-monospace,Consolas,monospace}
.preview .pv-line{position:absolute;left:0;white-space:pre}
.preview img,.preview video{max-width:100%;max-height:80vh;display:block;margin:0 auto}
.preview iframe{border:0;width:100%;height:75vh;background:#fff}
.preview table{border-collapse:collapse;font-size:13px}
.preview td,.preview th{border-bottom:1px solid #2a2f3a;padding:4px 10px;text-align:left}
.preview tr.pv-entry{cursor:pointer}
.preview tr.pv-entry:hover td{background:#1a1f29}
.preview .pv-note{padding:6px 14px;border-top:1px solid #2a2f3a;color:#9aa4b2;font-size:12px}
.preview .pv-hex{font:12px/18px ui-monospace,Consolas,monospace;white-space:pre}
)CSS";
}

// ---------------------------------------------------------------- script

inline const char* uiJs() {
  return R"JS('use strict';
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var state = { path: '/', view: 'files', selected: null };

  // ---- small helpers -------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function human(n) {
    n = Number(n) || 0;
    var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n.toFixed(0) : n.toFixed(1)) + ' ' + u[i];
  }
  function when(ms) {
    ms = Number(ms) || 0;
    if (!ms) return '';
    var d = new Date(ms), p = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
           ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function status(msg, kind) { var el = $('status'); el.textContent = msg; el.className = kind || ''; }
  function parentOf(p) { p = String(p || '/'); if (p === '/') return '/'; var i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); }
  function icon(name) {
    var n = String(name || '').toLowerCase();
    if (/\.(png|jpg|jpeg|gif|webp|bmp|svg)$/.test(n)) return '\uD83D\uDDBC';
    if (/\.(mp4|mkv|mov|avi|webm)$/.test(n)) return '\uD83C\uDFAC';
    if (/\.(mp3|wav|flac|ogg|m4a)$/.test(n)) return '\uD83C\uDFB5';
    if (/\.(zip|7z|rar|tar|gz)$/.test(n)) return '\uD83D\uDDDC';
    if (/\.(js|mjs|ts|py|java|c|cpp|h|hpp|cs|go|rs|json|html|css|md|txt)$/.test(n)) return '\uD83D\uDCDC';
    if (/\.(exe|msi|dll)$/.test(n)) return '\u2699';
    return '\uD83D\uDCC4';
  }

  // ---- transport -----------------------------------------------------
  function api(url, opts) {
    return fetch(url, opts).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j && j.error ? j.error : ('HTTP ' + r.status));
        return j;
      });
    });
  }
  function post(url) { return api(url, { method: 'POST' }); }

  // ---- rendering -----------------------------------------------------
  function renderCrumbs(path) {
    var el = $('crumbs'); el.innerHTML = '';
    if (state.view === 'trash') {
      var only = document.createElement('span');
      only.className = 'crumb last'; only.textContent = 'Recycle Bin';
      el.appendChild(only); return;
    }
    var parts = String(path || '/').split('/').filter(Boolean);
    var segs = [{ name: 'My Cloud Drive', path: '/' }], acc = '';
    parts.forEach(function (s) { acc += '/' + s; segs.push({ name: s, path: acc }); });
    segs.forEach(function (s, i) {
      if (i) { var sp = document.createElement('span'); sp.className = 'sep'; sp.textContent = '/'; el.appendChild(sp); }
      var a = document.createElement('span');
      a.className = 'crumb' + (i === segs.length - 1 ? ' last' : '');
      a.textContent = s.name;
      if (i < segs.length - 1) a.onclick = function () { open(s.path); };
      el.appendChild(a);
    });
  }
  function rowHtml(e) {
    var isDir = e.type === 'folder';
    var size = isDir ? 'Folder' : human(e.size);
    var acts = isDir
      ? '<button class="act" data-act="open" title="Open">\u2197</button><button class="act" data-act="remove" title="Delete">\uD83D\uDDD1</button>'
      : '<button class="act" data-act="download" title="Download">\u2193</button><button class="act" data-act="remove" title="Delete">\uD83D\uDDD1</button>';
    return '<tr class="row" data-path="' + esc(e.path) + '" data-name="' + esc(e.name) + '" data-type="' + (isDir ? 'folder' : 'file') + '">' +
      '<td class="c-name"><span class="ic">' + (isDir ? '\uD83D\uDCC1' : icon(e.name)) + '</span><span class="nm">' + esc(e.name) + '</span></td>' +
      '<td class="c-size">' + size + '</td>' +
      '<td class="c-mod">' + when(e.modified) + '</td>' +
      '<td class="c-act">' + acts + '</td></tr>';
  }
  function trashRowHtml(e) {
    var isDir = e.type === 'folder';
    return '<tr class="row" data-path="' + esc(e.path) + '" data-name="' + esc(e.name) + '" data-type="' + (isDir ? 'folder' : 'file') + '">' +
      '<td class="c-name"><span class="ic">' + (isDir ? '\uD83D\uDCC1' : icon(e.name)) + '</span><span class="nm">' + esc(e.name) + '</span></td>' +
      '<td class="c-size">' + (isDir ? 'Folder' : human(e.size)) + '</td>' +
      '<td class="c-mod">' + when(e.deletedAt || e.modified) + '</td>' +
      '<td class="c-act"><button class="act" data-act="restore" title="Restore">\u21A9</button><button class="act" data-act="purge" title="Delete permanently">\u2715</button></td></tr>';
  }
  function paint(html, emptyText) {
    var rows = $('rows');
    rows.innerHTML = html;
    var empty = $('empty');
    if (html) { empty.hidden = true; }
    else { empty.hidden = false; empty.textContent = emptyText; }
  }

  // ---- views ---------------------------------------------------------
  function load() { return state.view === 'trash' ? loadTrash() : loadFiles(); }

  function loadFiles() {
    status('Loading\u2026');
    return api('/api/list?path=' + encodeURIComponent(state.path)).then(function (j) {
      state.path = j.path || state.path;
      renderCrumbs(state.path);
      var items = j.entries || [];
      paint(items.map(rowHtml).join(''), 'This folder is empty');
      status(items.length + ' items \u00B7 ' + human(j.totalBytes));
    }).catch(function (e) { status(e.message, 'err'); });
  }

  function loadTrash() {
    status('Loading\u2026');
    return api('/api/state').then(function (j) {
      renderCrumbs('/');
      var items = j.trash || [];
      paint(items.map(trashRowHtml).join(''), 'The recycle bin is empty');
      status(items.length + ' items');
    }).catch(function (e) { status(e.message, 'err'); });
  }

  function switchView(v) {
    state.view = v; state.selected = null;
    $('tabFiles').classList.toggle('on', v === 'files');
    $('tabTrash').classList.toggle('on', v === 'trash');
    $('toolbar').hidden = v === 'trash';
    $('trashbar').hidden = v !== 'trash';
    load();
  }

  // ---- actions -------------------------------------------------------
  function open(path) { state.path = path; state.selected = null; loadFiles(); }
  function download(path, name) {
    var a = document.createElement('a');
    a.href = '/api/download?path=' + encodeURIComponent(path);
    a.download = name || '';
    document.body.appendChild(a); a.click(); a.remove();
    status('Downloading ' + name);
  }
  function newFolder() {
    ask('New folder', '', function (name) {
      var full = (state.path === '/' ? '' : state.path) + '/' + name;
      status('Creating ' + name + '\u2026');
      post('/api/mkdir?path=' + encodeURIComponent(full))
        .then(function () { status('Created ' + name, 'ok'); return load(); })
        .catch(function (e) { status(e.message, 'err'); });
    });
  }
  function removePath(p, n) {
    if (!confirm('Delete “' + n + '”? It will be moved to the recycle bin.')) return;
    status('Deleting ' + n + '\u2026');
    post('/api/remove?path=' + encodeURIComponent(p))
      .then(function () { status('Moved to the recycle bin', 'ok'); return load(); })
      .catch(function (e) { status(e.message, 'err'); });
  }
  function restorePath(p, n) {
    status('Restoring ' + n + '\u2026');
    post('/api/trash/restore?path=' + encodeURIComponent(p))
      .then(function () { status('Restored ' + n, 'ok'); return load(); })
      .catch(function (e) { status(e.message, 'err'); });
  }
  function purgeAll() {
    if (!confirm('Empty the recycle bin? This cannot be undone.')) return;
    status('Emptying\u2026');
    post('/api/trash/purge')
      .then(function () { status('Recycle bin emptied', 'ok'); return load(); })
      .catch(function (e) { status(e.message, 'err'); });
  }
  function refresh() {
    status('Refreshing\u2026');
    post('/api/refresh')
      .then(function () { return load(); })
      .then(function () { status('Refreshed', 'ok'); })
      .catch(function (e) { status(e.message, 'err'); });
  }
  function uploadAll(files) {
    if (state.view === 'trash') { status('Cannot upload to the recycle bin', 'err'); return; }
    if (!files.length) return;
    var i = 0, done = 0;
    (function next() {
      if (i >= files.length) { status('Uploaded ' + done + '/' + files.length, 'ok'); load(); return; }
      var f = files[i++];
      status('Uploading ' + f.name + ' (' + i + '/' + files.length + ')\u2026');
      fetch('/api/upload?path=' + encodeURIComponent(state.path) + '&name=' + encodeURIComponent(f.name),
            { method: 'POST', body: f })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j && j.error ? j.error : ('HTTP ' + r.status)); done++; }); })
        .then(next, function (e) { status('Upload failed ' + f.name + ': ' + e.message, 'err'); next(); });
    })();
  }
  function doRow(act, tr) {
    var p = tr.getAttribute('data-path'), n = tr.getAttribute('data-name');
    if (act === 'open') open(p);
    else if (act === 'download') download(p, n);
    else if (act === 'remove') removePath(p, n);
    else if (act === 'restore') restorePath(p, n);
    else if (act === 'purge') purgeAll();
  }
  function select(tr) {
    var prev = document.querySelector('#rows tr.sel');
    if (prev) prev.classList.remove('sel');
    tr.classList.add('sel');
    state.selected = { path: tr.getAttribute('data-path'), name: tr.getAttribute('data-name'), type: tr.getAttribute('data-type') };
  }

  // ---- modal: the single place a name is typed ------------------------
  var pendingOk = null;
  function ask(title, value, ok) {
    $('modalTitle').textContent = title;
    $('modalInput').value = value || '';
    $('modal').hidden = false;
    pendingOk = ok;
    setTimeout(function () { $('modalInput').focus(); $('modalInput').select(); }, 0);
  }
  function closeModal() { $('modal').hidden = true; pendingOk = null; }
  $('modalOk').onclick = function () { var v = $('modalInput').value.trim(); if (!v || !pendingOk) return; var fn = pendingOk; closeModal(); fn(v); };
  $('modalCancel').onclick = closeModal;
  $('modalInput').onkeydown = function (e) { if (e.key === 'Enter') $('modalOk').click(); if (e.key === 'Escape') closeModal(); };

  // ---- wiring --------------------------------------------------------
  $('tabFiles').onclick = function () { switchView('files'); };
  $('tabTrash').onclick = function () { switchView('trash'); };
  Array.prototype.forEach.call(document.querySelectorAll('.toolbar [data-act]'), function (b) {
    b.onclick = function () {
      var act = b.getAttribute('data-act');
      if (act === 'up') { if (state.path !== '/') open(parentOf(state.path)); }
      else if (act === 'mkdir') newFolder();
      else if (act === 'refresh') refresh();
      else if (act === 'delete') { if (state.selected) removePath(state.selected.path, state.selected.name); else status('Select an item first', 'err'); }
      else if (act === 'upload') $('file').click();
      else if (act === 'purgeAll') purgeAll();
    };
  });
  $('file').onchange = function () { var f = [].slice.call($('file').files); $('file').value = ''; uploadAll(f); };
  $('rows').addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr'); if (!tr) return;
    var btn = ev.target.closest('button[data-act]');
    if (btn) { ev.stopPropagation(); doRow(btn.getAttribute('data-act'), tr); return; }
    select(tr);
  });
  $('rows').addEventListener('dblclick', function (ev) {
    var tr = ev.target.closest('tr'); if (!tr || state.view === 'trash') return;
    if (tr.getAttribute('data-type') === 'folder') open(tr.getAttribute('data-path'));
    else download(tr.getAttribute('data-path'), tr.getAttribute('data-name'));
  });

  // ---- boot ----------------------------------------------------------
  api('/api/state').then(function (j) {
    $('version').textContent = j.version || '';
    $('account').textContent = j.login ? j.login : 'not signed in';
    $('tokenSource').textContent = j.tokenSource ? ('via ' + j.tokenSource) : '';
    $('platform').textContent = j.platform || '';
    if (j.error) status(j.error, 'err');
  }).catch(function (e) { status(e.message, 'err'); })
    .then(function () { load(); });
// preview-math.js - the arithmetic behind the streaming preview, kept apart
// from the DOM so it can be exercised without a browser.
//
// It is inlined into the page by apply-preview.mjs and it also exports itself
// for node, which is how "Infinity Cloud/preview/tests/ui-preview.test.mjs"
// checks the windowing and the byte counts.
(function (root) {
  'use strict';

  var PV_CHUNK = 256 * 1024;                  // one Range window
  var PV_ROW = 18;                            // a fixed line box, in CSS pixels
  var PV_MAX_LINES = 20000;                   // the line ceiling of a preview
  var PV_MAX_BYTES = 64 * 1024 * 1024;        // the byte ceiling of a preview
  var PV_OVERSCAN = 8;                        // rows kept above and below

  // The slice of a long list worth putting in the document: what the viewport
  // shows, plus a little on each side. This is what keeps the DOM at a few
  // dozen nodes when the file has 20000 lines.
  function pvWindow(total, scrollTop, viewH, rowH, overscan) {
    rowH = rowH > 0 ? rowH : PV_ROW;
    overscan = overscan >= 0 ? overscan : PV_OVERSCAN;
    if (total <= 0) return { start: 0, end: 0, topPad: 0, bottomPad: 0, rows: 0 };
    var first = Math.floor((scrollTop > 0 ? scrollTop : 0) / rowH) - overscan;
    if (first < 0) first = 0;
    if (first > total) first = total;
    var visible = Math.ceil((viewH > 0 ? viewH : rowH) / rowH) + overscan * 2 + 1;
    var end = first + visible;
    if (end > total) end = total;
    return { start: first, end: end, topPad: first * rowH,
             bottomPad: (total - end) * rowH, rows: end - first };
  }

  // Where the compressed bytes of a zip entry begin: the offset of the local
  // file header plus the header itself plus the two lengths it carries.
  function pvDataOffset(headerOffset, nameLen, extraLen) {
    return Number(headerOffset) + 30 + Number(nameLen) + Number(extraLen);
  }

  // The next window to ask for: never past the end, never larger than a window.
  function pvChunk(offset, size, chunk) {
    chunk = chunk > 0 ? chunk : PV_CHUNK;
    offset = Number(offset) || 0;
    size = Number(size) || 0;
    if (offset < 0 || offset >= size) return 0;
    var left = size - offset;
    return left < chunk ? left : chunk;
  }

  // 20000 lines is the preview's line ceiling: the oldest line is dropped so a
  // vast log cannot grow the list without bound. Returns the kept list and the
  // index of its first line in the file.
  function pvRetain(lines, first, incoming, cap) {
    cap = cap > 0 ? cap : PV_MAX_LINES;
    var all = lines.concat(incoming);
    if (all.length <= cap) return { lines: all, first: first };
    var drop = all.length - cap;
    return { lines: all.slice(drop), first: first + drop };
  }

  root.PV = {
    PV_CHUNK: PV_CHUNK, PV_ROW: PV_ROW, PV_MAX_LINES: PV_MAX_LINES,
    PV_MAX_BYTES: PV_MAX_BYTES, PV_OVERSCAN: PV_OVERSCAN,
    pvWindow: pvWindow, pvDataOffset: pvDataOffset, pvChunk: pvChunk, pvRetain: pvRetain
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PV;
})(typeof globalThis !== 'undefined' ? globalThis : this);

  // ---- streaming preview ---------------------------------------------
  //
  // The file is read in 256 KiB windows over /api/preview/chunk, so the first
  // window can be on screen while the rest is still in the cloud. Text is kept
  // as a list of lines and only the rows the viewport shows are put in the
  // document: 20000 lines cost a few dozen nodes. Closing the preview aborts
  // the request and tells the reader, by epoch, to stop; nothing is kept.
  var PV_CHUNK = PV.PV_CHUNK;
  var PV_ROW = PV.PV_ROW;
  var PV_MAX_LINES = PV.PV_MAX_LINES;
  var PV_MAX_BYTES = PV.PV_MAX_BYTES;
  var PV_TEXT = /[.](txt|md|json|csv|tsv|log|xml|ya?ml|ini|conf|cfg|toml|sql|c|h|hpp|cpp|cc|cs|java|js|mjs|cjs|jsx|tsx?|py|rb|go|rs|php|sh|bash|ps1|bat|cmd|css|html?|srt|vtt)$/i;
  var PV_IMAGE = /[.](png|jpe?g|webp|gif|bmp)$/i;
  var PV_MEDIA = /[.](mp3|wav|ogg|m4a|flac|aac|mp4|webm|mkv|mov)$/i;
  var PV_PDF = /[.]pdf$/i;
  var PV_ZIP = /[.]zip$/i;
  var pv = null;

  function pvKind(name) {
    if (PV_ZIP.test(name)) return 'zip';
    if (PV_TEXT.test(name)) return 'text';
    if (PV_IMAGE.test(name)) return 'image';
    if (PV_MEDIA.test(name)) return 'media';
    if (PV_PDF.test(name)) return 'pdf';
    return null;
  }

  function pvNote(text) { $('pvNote').textContent = text || ''; }

  function pvClose() {
    if (!pv) return;
    var closing = pv;
    pv = null;
    closing.cancelled = true;
    if (closing.controller) { try { closing.controller.abort(); } catch (e) {} }
    if (closing.url) { try { URL.revokeObjectURL(closing.url); } catch (e) {} }
    $('preview').hidden = true;
    $('pvBody').innerHTML = '';
    // The reader is told to stop by epoch: a window in flight ends within its
    // own 8 s timeout, and no further window is asked for.
    fetch('/api/preview/cancel?epoch=' + encodeURIComponent(closing.epoch || 0),
          { method: 'POST' }).catch(function () {});
  }

  // ---- text: all the lines in an array, a window of rows in the document
  function pvStage() {
    $('pvBody').innerHTML = '<div class="pv-lines" id="pvLines"></div>';
    pv.stage = $('pvLines');
  }

  function pvRenderText() {
    if (!pv || !pv.stage) return;
    var body = $('pvBody');
    var w = PV.pvWindow(pv.lines.length, body.scrollTop, body.clientHeight, PV_ROW, PV.PV_OVERSCAN);
    var html = '';
    for (var i = w.start; i < w.end; i++) {
      html += '<div class="pv-line" style="top:' + (i * PV_ROW) + 'px">' + esc(pv.lines[i]) + '</div>';
    }
    pv.stage.style.height = (pv.lines.length * PV_ROW) + 'px';
    pv.stage.innerHTML = html;
    pv.rendered = w.rows;
  }

  function pvOnScroll() {
    if (!pv || pv.kind !== 'text' || pv.raf) return;
    pv.raf = requestAnimationFrame(function () { pv.raf = 0; pvRenderText(); });
  }

  function pvAppendText(bytes) {
    if (!bytes.length) return;
    var piece = pv.text ? pv.text.decode(bytes, { stream: true })
                        : String.fromCharCode.apply(null, bytes);
    pv.tail += piece;
    var cut = pv.tail.lastIndexOf('\n');
    if (cut < 0) return;
    var lines = pv.tail.slice(0, cut).split('\n');
    pv.tail = pv.tail.slice(cut + 1);
    var kept = PV.pvRetain(pv.lines, pv.lineFirst, lines, PV_MAX_LINES);
    pv.lines = kept.lines;
    pv.lineFirst = kept.first;
    pvRenderText();
    if ($('pvFollow').checked) $('pvBody').scrollTop = $('pvBody').scrollHeight;
  }

  // ---- binary: re-decode the bytes so far after every window
  function pvAppendBinary(bytes) {
    pv.parts.push(bytes);
    if (pv.url) { try { URL.revokeObjectURL(pv.url); } catch (e) {} pv.url = null; }
    pv.url = URL.createObjectURL(new Blob(pv.parts));
    var el = $('pvBody').firstChild;
    if (!el || el.tagName === 'DIV') {
      el = document.createElement(pv.kind === 'image' ? 'img' : (pv.kind === 'media' ? 'video' : 'iframe'));
      if (pv.kind === 'media') el.controls = true;
      $('pvBody').innerHTML = '';
      $('pvBody').appendChild(el);
    }
    el.onload = function () {
      pvNote('Decoded after ' + Math.round(pv.first) + ' ms, with ' + human(pv.bytes) + ' downloaded.');
    };
    el.onerror = function () {
      pvNote('Waiting for enough bytes to decode\u2026 ' + human(pv.bytes) + ' so far.');
    };
    el.src = pv.url;
  }

  function pvNext() {
    if (!pv || pv.done || pv.cancelled) return;
    var at = pv.offset;
    var want = PV.pvChunk(at, pv.total, PV_CHUNK);
    status('Loading\u2026 ' + human(pv.bytes));
    fetch('/api/preview/chunk?path=' + encodeURIComponent(pv.path) + '&offset=' + at +
          '&length=' + want + '&epoch=' + pv.epoch, { signal: pv.controller.signal })
      .then(function (r) {
        if (!r.ok) {
          return r.json().then(function (j) {
            throw new Error(j && j.error ? j.error : ('HTTP ' + r.status));
          });
        }
        var total = Number(r.headers.get('X-Preview-Total') || pv.total || 0);
        return r.arrayBuffer().then(function (buf) { return { buf: buf, total: total }; });
      })
      .then(function (chunk) {
        if (!pv) return;
        if (pv.first === null) pv.first = performance.now() - pv.started;
        var bytes = new Uint8Array(chunk.buf);
        pv.bytes += bytes.length;
        pv.offset = at + bytes.length;
        if (chunk.total) pv.total = chunk.total;
        if (pv.kind === 'text') pvAppendText(bytes); else pvAppendBinary(bytes);
        $('pvMeta').textContent = human(pv.bytes) + (pv.total ? (' of ' + human(pv.total)) : '') +
                                  ' \u00b7 first content ' + Math.round(pv.first) + ' ms' +
                                  (pv.kind === 'text' ? (' \u00b7 ' + pv.lines.length + ' lines') : '');
        if (bytes.length < want) {
          pv.done = true;
          pvNote('Complete: ' + human(pv.bytes) + ', first content after ' + Math.round(pv.first) + ' ms.');
          status('Ready');
          return;
        }
        if (pv.bytes >= PV_MAX_BYTES) {
          pv.done = true;
          pvNote('Stopped at the 64 MiB preview ceiling; Download gets the rest.');
          return;
        }
        pvNext();
      })
      .catch(function (e) {
        if (!pv || e.name === 'AbortError') return;
        pvNote(e.message);
        status(e.message, 'err');
      });
  }

  // ---- zip: the central directory first, one entry only when it is wanted
  function pvZip() {
    status('Reading the archive directory\u2026');
    fetch('/api/preview/zip?path=' + encodeURIComponent(pv.path) + '&epoch=' + pv.epoch,
          { signal: pv.controller.signal })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!pv) return;
        if (j && j.error) throw new Error(j.error);
        var list = (j && j.list) || [];
        var html = '<table><thead><tr><th>Name</th><th>Size</th><th>Stored</th><th>Method</th></tr></thead><tbody>';
        for (var i = 0; i < list.length; i++) {
          html += '<tr class="pv-entry" data-name="' + esc(list[i].name) + '"><td>' + esc(list[i].name) +
                  '</td><td>' + human(list[i].uncompressed) + '</td><td>' + human(list[i].compressed) +
                  '</td><td>' + (list[i].method === 0 ? 'stored' : 'deflate') + '</td></tr>';
        }
        html += '</tbody></table>';
        $('pvBody').innerHTML = html;
        $('pvMeta').textContent = list.length + ' entries \u00b7 central directory only \u00b7 ' +
                                  Math.round(performance.now() - pv.started) + ' ms';
        pvNote('Click an entry to pull just that entry.');
        status('Ready');
      })
      .catch(function (e) {
        if (!pv || e.name === 'AbortError') return;
        pvNote(e.message);
        status(e.message, 'err');
      });
  }

  function pvShowHex(bytes, name) {
    var out = '';
    var n = Math.min(bytes.length, 4096);
    for (var i = 0; i < n; i += 16) {
      var hex = '', ascii = '';
      for (var k = 0; k < 16; k++) {
        if (i + k < n) {
          var b = bytes[i + k];
          hex += (b < 16 ? '0' : '') + b.toString(16) + ' ';
          ascii += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
        } else { hex += '   '; }
      }
      out += hex + ' ' + ascii + '\n';
    }
    $('pvBody').innerHTML = '<div class="pv-hex">' + esc(out) + '</div>';
    pvNote(name + ': ' + human(bytes.length) + ' shown as hex' +
           (bytes.length > 4096 ? ' (first 4 KiB)' : '') + '.');
  }

  function pvShowEntry(name, method, bytes) {
    if (!pv) return;
    if (pvKind(name) === 'text') {
      pv.kind = 'text';
      pv.text = (typeof TextDecoder !== 'undefined') ? new TextDecoder('utf-8') : null;
      pv.tail = '';
      pv.lines = [];
      pv.lineFirst = 0;
      pvStage();
      pvAppendText(bytes);
      $('pvMeta').textContent = name + ' \u00b7 ' + human(bytes.length) + ' \u00b7 ' +
                                pv.lines.length + ' lines';
      pvNote('Entry pulled on demand' + (method === 0 ? ' (stored).' : ' and inflated in the page.'));
    } else if (pvKind(name) === 'image') {
      var url = URL.createObjectURL(new Blob([bytes]));
      $('pvBody').innerHTML = '';
      var img = document.createElement('img');
      img.src = url;
      $('pvBody').appendChild(img);
      pvNote(name + ': ' + human(bytes.length) + ' pulled on demand.');
    } else {
      pvShowHex(bytes, name);
    }
    status('Ready');
  }

  function pvOpenEntry(name) {
    if (!pv) return;
    pvNote('Pulling ' + name + '\u2026');
    var method = 0;
    fetch('/api/preview/zip/entry?path=' + encodeURIComponent(pv.path) +
          '&name=' + encodeURIComponent(name) + '&epoch=' + pv.epoch,
          { signal: pv.controller.signal })
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) {
            var message = t;
            try { var j = JSON.parse(t); if (j && j.error) message = j.error; } catch (e) {}
            throw new Error(message || ('HTTP ' + r.status));
          });
        }
        method = Number(r.headers.get('X-Zip-Method') || 0);
        return r.arrayBuffer();
      })
      .then(function (ab) {
        if (!pv) return null;
        if (method !== 0 && typeof DecompressionStream !== 'undefined') {
          // The bytes crossed the wire compressed; the page inflates them.
          var stream = new Blob([ab]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
          return new Response(stream).arrayBuffer();
        }
        return ab;
      })
      .then(function (out) {
        if (!pv || !out) return;
        pvShowEntry(name, method, new Uint8Array(out));
      })
      .catch(function (e) {
        if (!pv || e.name === 'AbortError') return;
        pvNote(e.message);
        status(e.message, 'err');
      });
  }

  function pvOpen(path, name) {
    pvClose();
    var kind = pvKind(name);
    pv = { path: path, name: name, kind: kind, epoch: 0, offset: 0, bytes: 0, total: 0,
           started: performance.now(), first: null, controller: new AbortController(),
           text: (typeof TextDecoder !== 'undefined') ? new TextDecoder('utf-8') : null,
           tail: '', lines: [], lineFirst: 0, parts: [], url: null, done: false,
           cancelled: false, stage: null, raf: 0, rendered: 0 };
    $('preview').hidden = false;
    $('pvName').textContent = name;
    $('pvMeta').textContent = 'Opening\u2026';
    $('pvBody').innerHTML = '';
    $('pvNote').textContent = '';
    $('pvFollow').parentNode.style.display = (kind === 'text') ? '' : 'none';
    if (!kind) {
      pvNote('This type is not read while it arrives; Download still works.');
      return;
    }
    if (kind === 'text') pvStage();
    api('/api/preview/meta?path=' + encodeURIComponent(path)).then(function (m) {
      if (!pv) return;
      pv.epoch = Number(m.epoch) || 0;
      pv.total = Number(m.size) || 0;
      if (kind !== 'text') pv.kind = kind;
      if (kind === 'zip') { pvZip(); return; }
      pvNext();
    }).catch(function (e) {
      if (!pv) return;
      pvNote(e.message);
      status(e.message, 'err');
    });
  }

  $('pvClose').onclick = pvClose;
  $('pvBody').addEventListener('scroll', pvOnScroll);
  $('pvBody').addEventListener('click', function (ev) {
    if (!pv || pv.kind !== 'zip') return;
    var tr = ev.target;
    while (tr && tr.tagName !== 'TR') tr = tr.parentNode;
    if (!tr || !tr.getAttribute('data-name')) return;
    ev.preventDefault();
    pvOpenEntry(tr.getAttribute('data-name'));
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && pv) pvClose();
  });
  // Double-clicking a previewable file opens it streaming. The capture listener
  // runs before the row handler, so it does not also start a download.
  $('rows').addEventListener('dblclick', function (ev) {
    var tr = ev.target;
    while (tr && tr.tagName !== 'TR') tr = tr.parentNode;
    if (!tr || tr.getAttribute('data-type') !== 'file') return;
    var name = tr.getAttribute('data-name');
    if (!pvKind(name)) return;
    ev.stopPropagation();
    ev.preventDefault();
    if (typeof select === 'function') select(tr);
    pvOpen(tr.getAttribute('data-path'), name);
  }, true);
})();
)JS";
}

}  // namespace inc
