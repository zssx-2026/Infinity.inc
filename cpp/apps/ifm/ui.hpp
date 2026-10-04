// ui.hpp - the page Infinity File Manager's window renders.
//
// The window is Electron; it knows how to draw HTML and nothing else. What it
// draws is this file: one page, one stylesheet, one script, each a raw string
// literal so the C++ executable carries its own interface with no asset
// directory to lose beside it.
//
// The design rule for the whole suite is that the window is direct
// manipulation, not a command box. A folder is a row you double-click, a file
// is a row you select, and the toolbar acts on the selection. There is no
// field that runs a command and no screen of prose describing the features:
// the one place a name is typed is the modal that asks for it.
//
// Infinity File Manager is the local half of the suite - Infinity Cloud is the
// same table over GitHub, this is the same table over a disk - so the markup,
// the class names and the stylesheet are deliberately the same shape as
// inc/ui.hpp. The three literals are served from /, /app.css and /app.js.
//
// The data on this page is not trusted. A file name is bytes the user or a
// download chose, so it is inserted with textContent and createElement and
// never with innerHTML.

#pragma once

namespace inc {

// ---------------------------------------------------------------- markup

inline const char* uiHtml() {
  return R"HTML(<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Infinity File Manager</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<header class="top">
  <div class="brand"><span class="logo"></span><b>Infinity File Manager</b><span class="ver" id="version"></span></div>
  <div class="who">
    <span class="cwd" id="cwd">&hellip;</span>
    <span class="plat" id="platform"></span>
  </div>
</header>

<div class="pathbar">
  <select class="drives" id="drives" title="Drives"></select>
  <div class="crumbs" id="crumbs"></div>
</div>

<div class="toolbar" id="toolbar">
  <button class="btn" data-act="up" title="Up one level">Up</button>
  <button class="btn" data-act="mkdir">New folder</button>
  <button class="btn" data-act="rename">Rename</button>
  <button class="btn" data-act="copy">Copy to&hellip;</button>
  <button class="btn" data-act="move">Move to&hellip;</button>
  <button class="btn danger" data-act="delete">Delete</button>
  <button class="btn" data-act="refresh">Refresh</button>
  <button class="btn primary" data-act="upload">Upload</button>
  <input type="file" id="file" multiple hidden>
</div>

<div class="tablewrap">
  <table class="files">
    <thead>
      <tr><th class="c-name">Name</th><th class="c-size">Size</th><th class="c-type">Type</th><th class="c-mod">Modified</th><th class="c-act"></th></tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
  <div class="state" id="state" hidden></div>
</div>

<footer class="status"><span id="status">Ready</span></footer>

<div class="modal" id="modal" hidden>
  <div class="box">
    <h3 id="modalTitle">New folder</h3>
    <p class="note" id="modalNote" hidden></p>
    <input id="modalInput" placeholder="Name" autocomplete="off" spellcheck="false">
    <div class="row">
      <button class="btn" id="modalCancel">Cancel</button>
      <button class="btn primary" id="modalOk">OK</button>
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
  return R"CSS(:root{
  --bg:#0e1116;--panel:#161b22;--card:#1a2029;--line:#2a3038;
  --fg:#e6edf3;--dim:#8b949e;--acc:#58a6ff;--ok:#3fb950;--err:#f85149;
}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--fg);
  font:14px/1.5 -apple-system,"Segoe UI",system-ui,"Microsoft YaHei",sans-serif;
  display:flex;flex-direction:column}

/* header: the version and the folder the window is showing */
.top{display:flex;align-items:center;gap:14px;padding:12px 18px;
  background:var(--panel);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:10px}
.logo{width:22px;height:22px;border-radius:6px;
  background:linear-gradient(135deg,var(--acc),#7c3aed)}
.brand b{font-size:15px}
.ver{color:var(--dim);font-size:12px}
.who{margin-left:auto;display:flex;gap:14px;align-items:center;
  color:var(--dim);font-size:12.5px;white-space:nowrap;min-width:0}
.who .cwd{color:var(--fg);font-family:ui-monospace,Consolas,monospace;
  overflow:hidden;text-overflow:ellipsis;max-width:52vw}

/* path bar: a drive to switch volume, and a breadcrumb back to any ancestor */
.pathbar{display:flex;align-items:center;gap:12px;padding:10px 18px;
  background:var(--panel);border-bottom:1px solid var(--line)}
.drives{background:var(--card);color:var(--fg);border:1px solid var(--line);
  border-radius:7px;padding:6px 10px;font:13px inherit;cursor:pointer;min-width:92px}
.drives:hover{border-color:var(--acc)}
.drives:focus{outline:none;border-color:var(--acc)}
.crumbs{display:flex;align-items:center;gap:4px;flex:1;
  overflow:auto;white-space:nowrap}
.crumb{color:var(--dim);cursor:pointer;padding:3px 7px;border-radius:5px;white-space:nowrap}
.crumb:hover{background:var(--card);color:var(--fg)}
.crumb.last{color:var(--fg);font-weight:600;cursor:default}
.sep{color:var(--line)}

/* toolbar: the verbs that act on the current folder and the selection */
.toolbar{display:flex;align-items:center;gap:8px;padding:10px 18px;
  border-bottom:1px solid var(--line);flex-wrap:wrap}
.btn{background:var(--card);border:1px solid var(--line);color:var(--fg);
  border-radius:7px;padding:6px 13px;cursor:pointer;font-size:13px}
.btn:hover{border-color:var(--acc)}
.btn.primary{background:var(--acc);color:#08111c;border-color:var(--acc);font-weight:600}
.btn.danger{border-color:#5a2323;color:#ff9c96}
.btn.danger:hover{border-color:var(--err);color:var(--err)}

/* table: one row per local entry, folders first */
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
.c-size,.c-type,.c-mod{color:var(--dim);white-space:nowrap;font-size:12.5px}
.c-size{width:110px}
.c-type{width:110px}
.c-mod{width:170px}
.c-act{width:96px;text-align:right;white-space:nowrap}
.act{background:transparent;border:1px solid transparent;color:var(--dim);
  border-radius:5px;width:26px;height:26px;cursor:pointer;font-size:13px;line-height:1}
.act:hover{color:var(--fg);border-color:var(--acc);background:#0b1017}

/* the three states that are not a table: loading, empty, error. They are
   drawn differently on purpose - "nothing here" and "could not read this
   folder" must never be mistaken for one another. */
.state{padding:64px 20px;text-align:center;color:var(--dim)}
.state .big{display:block;font-size:26px;line-height:1;margin-bottom:12px}
.state .txt{display:block;font-size:13.5px;word-break:break-word}
.state.loading{color:var(--dim)}
.state.loading .big{opacity:.6}
.state.empty{color:var(--dim)}
.state.error{color:var(--err)}
.state.error .txt{font-family:ui-monospace,Consolas,monospace;font-size:12.5px}

/* status line: progress and errors */
.status{padding:8px 18px;border-top:1px solid var(--line);color:var(--dim);
  font-size:12px;display:flex;gap:16px;min-height:33px;align-items:center}
#status.ok{color:var(--ok)}
#status.err{color:var(--err)}

/* modal: the one place a name is typed, and the one place a delete is
   confirmed by naming exactly what goes */
.modal{position:fixed;inset:0;background:#000000b0;display:flex;
  align-items:center;justify-content:center;z-index:50}
.modal[hidden]{display:none}
.modal .box{background:var(--panel);border:1px solid var(--line);
  border-radius:12px;padding:20px;width:min(440px,92vw)}
.modal h3{margin:0 0 14px;font-size:15px}
.modal .note{margin:0 0 14px;color:var(--dim);font-size:13px;
  white-space:pre-line;word-break:break-all}
.modal .note[hidden]{display:none}
.modal input{width:100%;background:#0b0f14;color:var(--fg);
  border:1px solid var(--line);border-radius:7px;padding:9px 12px;
  outline:none;font:13px inherit}
.modal input[hidden]{display:none}
.modal input:focus{border-color:var(--acc)}
.modal .row{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
)CSS";
}

// ---------------------------------------------------------------- script

inline const char* uiJs() {
  return R"JS('use strict';
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var state = { path: '', entries: [], selected: null, drives: [] };

  // ---- small helpers -------------------------------------------------
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
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
  function isWindowsPath(p) { return /^[A-Za-z]:[\\/]/.test(String(p || '')); }
  function driveOf(p) { var m = /^([A-Za-z]:)[\\/]/.exec(String(p || '')); return m ? m[1].toLowerCase() : ''; }
  function parentOf(p) {
    p = String(p || '');
    if (/^[A-Za-z]:[\\/]?$/.test(p)) return p;          // a bare drive is its own root
    var trimmed = p.replace(/[\\/]+$/, '');
    var cut = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
    if (cut < 0) return p;
    var head = trimmed.slice(0, cut);
    if (/^[A-Za-z]:$/.test(head)) return head + '\\';   // "C:" -> "C:\"
    return head || '/';
  }
  function joinPath(dir, name) {
    dir = String(dir || '');
    if (!dir) return name;
    return dir.replace(/[\\/]+$/, '') + '\\' + name;
  }
  function baseName(p) {
    p = String(p || '');
    var cut = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
    return cut < 0 ? p : p.slice(cut + 1);
  }
  function typeOf(entry) {
    if (entry.directory) return 'Folder';
    var m = /\.([^./\\]{1,8})$/.exec(String(entry.name || ''));
    return m ? m[1].toUpperCase() : 'File';
  }
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
    var el = $('crumbs');
    clear(el);
    var text = String(path || '');
    var sep = isWindowsPath(text) ? '\\' : '/';
    var parts = text.split(/[\\/]+/).filter(function (s) { return s.length; });
    var segs = [], acc = '';
    if (/^[A-Za-z]:$/.test(parts[0])) {
      acc = parts[0] + '\\';
      segs.push({ name: parts[0] + '\\', path: acc });
      parts.slice(1).forEach(function (s) {
        acc = acc.replace(/[\\/]+$/, '') + '\\' + s;
        segs.push({ name: s, path: acc });
      });
    } else {
      segs.push({ name: sep, path: sep });
      parts.forEach(function (s) { acc += sep + s; segs.push({ name: s, path: acc }); });
    }
    segs.forEach(function (s, i) {
      if (i) { var sp = document.createElement('span'); sp.className = 'sep'; sp.textContent = sep; el.appendChild(sp); }
      var a = document.createElement('span');
      a.className = 'crumb' + (i === segs.length - 1 ? ' last' : '');
      a.textContent = s.name;
      if (i < segs.length - 1) a.onclick = function () { open(s.path); };
      el.appendChild(a);
    });
  }
  function actionButton(act, glyph, title) {
    var b = document.createElement('button');
    b.className = 'act';
    b.setAttribute('data-act', act);
    b.title = title;
    b.textContent = glyph;
    return b;
  }
  function renderRows(entries) {
    var body = $('rows');
    clear(body);
    entries.forEach(function (e) {
      var tr = document.createElement('tr');
      tr.className = 'row';
      tr.setAttribute('data-path', e.path);
      tr.setAttribute('data-name', e.name);
      tr.setAttribute('data-type', e.directory ? 'folder' : 'file');

      var tdName = document.createElement('td');
      tdName.className = 'c-name';
      var ic = document.createElement('span');
      ic.className = 'ic';
      ic.textContent = e.directory ? '\uD83D\uDCC1' : icon(e.name);
      var nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = e.name;
      tdName.appendChild(ic);
      tdName.appendChild(nm);

      var tdSize = document.createElement('td');
      tdSize.className = 'c-size';
      tdSize.textContent = e.directory ? '\u2014' : human(e.size);

      var tdType = document.createElement('td');
      tdType.className = 'c-type';
      tdType.textContent = typeOf(e);

      var tdMod = document.createElement('td');
      tdMod.className = 'c-mod';
      tdMod.textContent = when(e.modified);

      var tdAct = document.createElement('td');
      tdAct.className = 'c-act';
      if (e.directory) {
        tdAct.appendChild(actionButton('open', '\u2197', 'Open'));
        tdAct.appendChild(actionButton('delete', '\uD83D\uDDD1', 'Delete'));
      } else {
        tdAct.appendChild(actionButton('download', '\u2193', 'Download'));
        tdAct.appendChild(actionButton('delete', '\uD83D\uDDD1', 'Delete'));
      }

      tr.appendChild(tdName);
      tr.appendChild(tdSize);
      tr.appendChild(tdType);
      tr.appendChild(tdMod);
      tr.appendChild(tdAct);
      body.appendChild(tr);
    });
  }
  function showState(kind, glyph, text) {
    var el = $('state');
    el.className = 'state ' + kind;
    clear(el);
    var big = document.createElement('span');
    big.className = 'big';
    big.textContent = glyph;
    var line = document.createElement('span');
    line.className = 'txt';
    line.textContent = text;
    el.appendChild(big);
    el.appendChild(line);
    el.hidden = false;
  }
  function hideState() { $('state').hidden = true; }

  // ---- views ---------------------------------------------------------
  function sortEntries(entries) {
    entries.sort(function (a, b) {
      if (!!a.directory !== !!b.directory) return a.directory ? -1 : 1;
      var an = String(a.name).toLowerCase(), bn = String(b.name).toLowerCase();
      return an < bn ? -1 : (an > bn ? 1 : 0);
    });
    return entries;
  }
  function load() {
    var url = '/api/list' + (state.path ? '?path=' + encodeURIComponent(state.path) : '');
    showState('loading', '\u23F3', 'Loading\u2026');
    status('Loading\u2026');
    return api(url).then(function (j) {
      state.path = j.path || state.path;
      state.entries = sortEntries((j.entries || []).slice());
      renderCrumbs(state.path);
      syncDrive(state.path);
      $('cwd').textContent = state.path;
      renderRows(state.entries);
      if (state.entries.length) hideState();
      else showState('empty', '\uD83D\uDCC2', 'This folder is empty');
      status(state.entries.length + ' items \u00B7 ' + human(j.totalBytes));
    }).catch(function (e) {
      clear($('rows'));
      showState('error', '\u26A0', 'Could not read this folder: ' + e.message);
      status(e.message, 'err');
    });
  }
  function open(path) { state.path = path; state.selected = null; load(); }

  // ---- drive selector ------------------------------------------------
  function renderDrives(drives) {
    var sel = $('drives');
    clear(sel);
    var ph = document.createElement('option');
    ph.value = '';
    ph.textContent = 'Drives';
    sel.appendChild(ph);
    (drives || []).forEach(function (d) {
      var o = document.createElement('option');
      o.value = d.path;
      o.textContent = d.name;
      sel.appendChild(o);
    });
    sel.onchange = function () { if (sel.value) open(sel.value); };
  }
  function syncDrive(path) {
    var sel = $('drives');
    if (!sel) return;
    var want = driveOf(path);
    for (var i = 0; i < sel.options.length; i++) {
      if (driveOf(sel.options[i].value) === want && want) { sel.value = sel.options[i].value; return; }
    }
    sel.value = '';
  }

  // ---- actions -------------------------------------------------------
  function download(path, name) {
    var a = document.createElement('a');
    a.href = '/api/download?path=' + encodeURIComponent(path);
    a.download = name || '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    status('Downloading ' + name);
  }
  function selectedOr(action) {
    if (!state.selected) { status('Select an item first, then ' + action, 'err'); return null; }
    return state.selected;
  }
  function newFolder() {
    ask('New folder', '', function (name) {
      if (/[\\/]/.test(name)) { status('The name cannot contain a path separator', 'err'); return; }
      var full = joinPath(state.path, name);
      status('Creating ' + name + '\u2026');
      post('/api/mkdir?path=' + encodeURIComponent(full))
        .then(function () { status('Created ' + name, 'ok'); return load(); })
        .catch(function (e) { status(e.message, 'err'); });
    });
  }
  function rename() {
    var sel = selectedOr('rename');
    if (!sel) return;
    ask('Rename', sel.name, function (name) {
      if (/[\\/]/.test(name)) { status('The name cannot contain a path separator', 'err'); return; }
      status('Renaming ' + sel.name + '\u2026');
      post('/api/rename?path=' + encodeURIComponent(sel.path) + '&name=' + encodeURIComponent(name))
        .then(function () { status('Renamed to ' + name, 'ok'); return load(); })
        .catch(function (e) { status(e.message, 'err'); });
    });
  }
  function copyOrMove(kind) {
    var sel = selectedOr(kind === 'copy' ? 'copy' : 'move');
    if (!sel) return;
    var verb = kind === 'copy' ? 'Copy' : 'Move';
    ask(verb + ' to', state.path, function (dest) {
      if (!dest) return;
      status((kind === 'copy' ? 'Copying ' : 'Moving ') + sel.name + '\u2026');
      post('/api/' + kind + '?from=' + encodeURIComponent(sel.path) + '&to=' + encodeURIComponent(dest))
        .then(function () { status((kind === 'copy' ? 'Copied ' : 'Moved ') + sel.name, 'ok'); return load(); })
        .catch(function (e) { status(e.message, 'err'); });
    }, verb + ' “' + sel.name + '” to the folder below:');
  }
  function removePath(path, name) {
    confirmBox('Delete', 'Delete “' + name + '” and move it to the recycle bin:\n' + path, 'Delete', function () {
      status('Deleting ' + name + '\u2026');
      post('/api/delete?path=' + encodeURIComponent(path))
        .then(function () { status('Moved to the recycle bin: ' + name, 'ok'); return load(); })
        .catch(function (e) { status(e.message, 'err'); });
    });
  }
  function uploadAll(files) {
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
    else if (act === 'delete') removePath(p, n);
  }
  function select(tr) {
    var prev = document.querySelector('#rows tr.sel');
    if (prev) prev.classList.remove('sel');
    tr.classList.add('sel');
    state.selected = {
      path: tr.getAttribute('data-path'),
      name: tr.getAttribute('data-name'),
      directory: tr.getAttribute('data-type') === 'folder'
    };
  }

  // ---- modal: the single place a name is typed, and where a delete is
  // confirmed by naming exactly what goes -------------------------------
  var pendingOk = null;
  function openModal() { $('modal').hidden = false; }
  function closeModal() {
    $('modal').hidden = true;
    pendingOk = null;
    $('modalOk').textContent = 'OK';
    $('modalOk').className = 'btn primary';
  }
  function ask(title, value, ok, note) {
    $('modalTitle').textContent = title;
    var noteEl = $('modalNote');
    if (note) { noteEl.textContent = note; noteEl.hidden = false; } else { noteEl.hidden = true; }
    var input = $('modalInput');
    input.hidden = false;
    input.value = value || '';
    $('modalOk').textContent = 'OK';
    $('modalOk').className = 'btn primary';
    openModal();
    pendingOk = ok;
    setTimeout(function () { input.focus(); input.select(); }, 0);
  }
  function confirmBox(title, message, okLabel, ok) {
    $('modalTitle').textContent = title;
    var noteEl = $('modalNote');
    noteEl.textContent = message;
    noteEl.hidden = false;
    $('modalInput').hidden = true;
    $('modalOk').textContent = okLabel || 'OK';
    $('modalOk').className = 'btn danger';
    openModal();
    pendingOk = ok;
    setTimeout(function () { $('modalOk').focus(); }, 0);
  }
  $('modalOk').onclick = function () {
    var input = $('modalInput');
    var needsValue = !input.hidden;
    var v = input.value.trim();
    if (needsValue && !v) return;
    var fn = pendingOk;
    closeModal();
    if (fn) fn(v);
  };
  $('modalCancel').onclick = closeModal;
  $('modalInput').onkeydown = function (e) {
    if (e.key === 'Enter') $('modalOk').click();
    if (e.key === 'Escape') closeModal();
  };

  // ---- wiring --------------------------------------------------------
  Array.prototype.forEach.call(document.querySelectorAll('.toolbar [data-act]'), function (b) {
    b.onclick = function () {
      var act = b.getAttribute('data-act');
      if (act === 'up') { var parent = parentOf(state.path); if (parent && parent !== state.path) open(parent); }
      else if (act === 'mkdir') newFolder();
      else if (act === 'rename') rename();
      else if (act === 'copy') copyOrMove('copy');
      else if (act === 'move') copyOrMove('move');
      else if (act === 'delete') { var s = selectedOr('delete'); if (s) removePath(s.path, s.name); }
      else if (act === 'refresh') load();
      else if (act === 'upload') $('file').click();
    };
  });
  $('file').onchange = function () { var f = [].slice.call($('file').files); $('file').value = ''; uploadAll(f); };
  $('rows').addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr');
    if (!tr) return;
    var btn = ev.target.closest('button[data-act]');
    if (btn) { ev.stopPropagation(); doRow(btn.getAttribute('data-act'), tr); return; }
    select(tr);
  });
  $('rows').addEventListener('dblclick', function (ev) {
    var tr = ev.target.closest('tr');
    if (!tr) return;
    if (tr.getAttribute('data-type') === 'folder') open(tr.getAttribute('data-path'));
    else download(tr.getAttribute('data-path'), tr.getAttribute('data-name'));
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Delete') return;
    var active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'SELECT')) return;
    if ($('modal').hidden === false) return;
    var s = selectedOr('delete');
    if (s) removePath(s.path, s.name);
  });

  // ---- boot ----------------------------------------------------------
  api('/api/state').then(function (j) {
    $('version').textContent = j.version ? ('v' + j.version) : '';
    $('platform').textContent = j.platform || '';
    renderDrives(j.drives);
    state.path = j.path || j.home || '';
    $('cwd').textContent = state.path || 'This PC';
  }).catch(function (e) { status(e.message, 'err'); })
    .then(function () { load(); });
})();
)JS";
}

}  // namespace inc
