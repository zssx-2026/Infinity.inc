/*
 * server.js - the graphical face of Infinity File Manager.
 *
 * The other faces already exist: the two-pane terminal UI draws the file
 * system in a console, the command line drives the same operations. Neither
 * needs a window. This file adds the third face without touching them: a
 * loopback HTTP server that serves one page and a small JSON API over the
 * very same core modules.
 *
 * The page is a real file browser, not a command box. Rows are clickable,
 * the path bar is clickable, the toolbar makes folders and uploads, and a
 * file dropped on the list is written to the folder on screen. Every file
 * operation is delegated to core/localfs.js (list, mkdir, rename, remove,
 * unique names) so there is no second implementation to drift, and the
 * download content type comes from core/dav.js. Nothing here opens, reads
 * or deletes a file itself.
 *
 * The server binds 127.0.0.1 only. This is a local control panel, not a
 * service; nothing about it should be reachable from the network.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { listLocal, sortEntries, mkdirLocal, renameLocal, removeTree, uniqueName, drives, homeDir, iconFor, fmtSize, fmtDate } from '../core/localfs.js';
import { guessType } from '../core/dav.js';
import { openBrowser } from '../core/mode.js';

const VERSION = 'v1.0pre1';

/* The glyph a row carries, by the class core/localfs.js gives it. */
const ICON = {
  dir: '\uD83D\uDCC1', app: '\u2699\uFE0F', arc: '\uD83D\uDDDC\uFE0F',
  img: '\uD83D\uDDBC\uFE0F', aud: '\uD83C\uDFB5', vid: '\uD83C\uDFAC',
  code: '\u2328\uFE0F', text: '\uD83D\uDCC4', doc: '\uD83D\uDCD5',
  file: '\uD83D\uDCC4'
};

/* An absolute, normalised path. An empty path means the user's home. */
function safePath(p) {
  const s = String(p || '').trim();
  if (!s) return homeDir();
  try { return path.resolve(s); } catch (e) { return homeDir(); }
}

/* The parent of a directory, or null when it is a drive or filesystem root. */
function parentOfDir(dir) {
  const root = path.parse(dir).root;
  if (dir === root) return null;
  const up = path.dirname(dir);
  return up === dir ? null : up;
}

/* The breadcrumb trail: the root, then one crumb per path segment. */
function crumbsOf(dir) {
  const root = path.parse(dir).root;
  const out = [{ name: root, path: root }];
  let acc = root;
  for (const seg of dir.slice(root.length).split(path.sep)) {
    if (!seg) continue;
    acc = path.join(acc, seg);
    out.push({ name: seg, path: acc });
  }
  return out;
}

const PAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Infinity File Manager</title><style>
:root{--bg:#0e1116;--panel:#161b22;--line:#2a3038;--fg:#e6edf3;--dim:#8b949e;--acc:#58a6ff;--ok:#3fb950;--err:#f85149}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 -apple-system,"Segoe UI",system-ui,sans-serif;height:100vh;display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid var(--line);background:var(--panel)}
header b{font-size:16px}header .v{color:var(--dim);font-size:12px}header .sp{margin-left:auto}
.bar{display:flex;align-items:center;gap:8px;padding:10px 20px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.crumbs{flex:1;min-width:220px;display:flex;flex-wrap:wrap;align-items:center;gap:2px;background:#0b0f14;border:1px solid var(--line);border-radius:6px;padding:6px 10px;font:12.5px ui-monospace,Consolas,monospace}
.crumbs a{color:var(--acc);text-decoration:none;cursor:pointer;padding:1px 3px;border-radius:4px}
.crumbs a:hover{background:#1f2630}.crumbs i{color:var(--dim);font-style:normal}
button{background:var(--acc);color:#08111c;border:0;border-radius:6px;padding:8px 14px;font-weight:600;cursor:pointer}
button.ghost{background:var(--line);color:var(--fg);font-weight:400}
button:hover{filter:brightness(1.1)}
main{flex:1;overflow:auto;padding:0 20px 20px}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);font-size:13.5px}
th{position:sticky;top:0;background:var(--bg);color:var(--dim);font-weight:500;z-index:1}
tbody tr{cursor:pointer}tbody tr:hover{background:#141a22}
.nm{display:flex;align-items:center;gap:8px}
.ic{width:20px;text-align:center;font-size:16px}
.sz,.dt{color:var(--dim);white-space:nowrap}
.ac{text-align:right;white-space:nowrap}
.mini{background:transparent;color:var(--dim);border:1px solid var(--line);border-radius:5px;padding:3px 9px;font-weight:400;font-size:12px;margin-left:4px}
.mini:hover{color:var(--fg);border-color:var(--acc)}
.mini.danger:hover{color:var(--err);border-color:var(--err)}
.drop{margin:14px 20px;padding:16px;border:1.5px dashed var(--line);border-radius:8px;text-align:center;color:var(--dim);display:none}
.drop.on{display:block;border-color:var(--acc);color:var(--acc);background:#0d1420}
.hint{color:var(--dim);font-size:12px}
</style></head><body>
<header><b>Infinity File Manager</b><span class="v">${VERSION}</span>
<span class="sp"></span><span id="status" class="hint"></span></header>
<div class="bar"><div id="crumbs" class="crumbs"></div>
<button id="btnNew" class="ghost">新建文件夹</button>
<button id="btnUp" class="ghost">上传</button>
<button id="btnRefresh" class="ghost">刷新</button>
<input id="file" type="file" multiple hidden></div>
<div id="drop" class="drop">松开即上传到当前目录</div>
<main><table><thead><tr><th>名称</th><th class="sz">大小</th><th class="dt">修改时间</th><th class="ac">操作</th></tr></thead>
<tbody id="rows"></tbody></table></main>
<script>
var $=function(id){return document.getElementById(id)};
var ICON=${JSON.stringify(ICON)};
var cur="";
function setStatus(s){$("status").textContent=s||""}
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
async function api(u,o){var r=await fetch(u,o||{});return r.json()}
async function load(p){
  var j=await api("/api/list?path="+encodeURIComponent(p||""));
  if(!j.ok){setStatus("无法打开："+(j.error||p));return}
  cur=j.path;
  renderCrumbs(j.crumbs);
  renderRows(j.entries);
  setStatus(j.entries.length+" 项");
}
function renderCrumbs(c){
  var h="";
  for(var i=0;i<c.length;i++){
    if(i)h+='<i>/</i>';
    h+='<a data-path="'+esc(c[i].path)+'">'+esc(c[i].name)+'</a>';
  }
  $("crumbs").innerHTML=h;
}
function renderRows(rows){
  var h="";
  for(var i=0;i<rows.length;i++){
    var e=rows[i];
    var acts=e.type==="folder"
      ? '<button class="mini" data-act="rename">重命名</button><button class="mini danger" data-act="delete">删除</button>'
      : '<button class="mini" data-act="download">下载</button><button class="mini" data-act="rename">重命名</button><button class="mini danger" data-act="delete">删除</button>';
    h+='<tr data-path="'+esc(e.path)+'" data-type="'+e.type+'">'
      +'<td><div class="nm"><span class="ic">'+(ICON[e.icon]||ICON.file)+'</span>'+esc(e.name)+'</div></td>'
      +'<td class="sz">'+(e.type==="folder"?"":esc(e.sizeText))+'</td>'
      +'<td class="dt">'+esc(e.dateText)+'</td>'
      +'<td class="ac">'+acts+'</td></tr>';
  }
  $("rows").innerHTML=h;
}
async function mkdir(){
  var name=prompt("新建文件夹名称");
  if(!name)return;
  var j=await api("/api/mkdir",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({dir:cur,name:name})});
  if(!j.ok)setStatus("失败："+(j.error||""));else load(cur);
}
async function doRename(p){
  var name=prompt("新名称",p.split(/[\\\\/]/).pop());
  if(!name)return;
  var j=await api("/api/rename",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({path:p,name:name})});
  if(!j.ok)setStatus("失败："+(j.error||""));else load(cur);
}
async function doDelete(p){
  if(!confirm("删除 "+p+" ？此操作不可撤销。"))return;
  var j=await api("/api/delete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({path:p})});
  if(!j.ok)setStatus("失败："+(j.error||""));else load(cur);
}
async function upload(f){
  setStatus("上传 "+f.name+" …");
  var r=await fetch("/api/upload?dir="+encodeURIComponent(cur)+"&name="+encodeURIComponent(f.name),{method:"POST",body:f});
  var j=await r.json();
  if(!j.ok)setStatus("失败："+f.name+" "+(j.error||""));
}
$("crumbs").addEventListener("click",function(ev){
  var a=ev.target.closest("a[data-path]");
  if(a)load(a.getAttribute("data-path"));
});
$("rows").addEventListener("click",function(ev){
  var tr=ev.target.closest("tr");
  if(!tr)return;
  var p=tr.getAttribute("data-path"),t=tr.getAttribute("data-type");
  var btn=ev.target.closest("button[data-act]");
  if(btn){
    var a=btn.getAttribute("data-act");
    if(a==="download")location.href="/api/download?path="+encodeURIComponent(p);
    else if(a==="rename")doRename(p);
    else if(a==="delete")doDelete(p);
    return;
  }
  if(t==="folder")load(p);
  else location.href="/api/download?path="+encodeURIComponent(p);
});
$("btnNew").addEventListener("click",mkdir);
$("btnRefresh").addEventListener("click",function(){load(cur)});
$("btnUp").addEventListener("click",function(){$("file").click()});
$("file").addEventListener("change",async function(){
  for(var i=0;i<this.files.length;i++)await upload(this.files[i]);
  this.value="";load(cur);
});
var main=document.querySelector("main");
["dragenter","dragover"].forEach(function(t){main.addEventListener(t,function(e){e.preventDefault();$("drop").classList.add("on")})});
["dragleave","drop"].forEach(function(t){main.addEventListener(t,function(e){e.preventDefault();$("drop").classList.remove("on")})});
main.addEventListener("drop",async function(e){
  var fs=e.dataTransfer.files;
  for(var i=0;i<fs.length;i++)await upload(fs[i]);
  load(cur);
});
load("");
</script></body></html>`;

function html(res, body) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise(function (resolve) {
    let raw = '';
    req.on('data', function (d) { raw += d; if (raw.length > 1e6) req.destroy(); });
    req.on('end', function () { resolve(raw); });
    req.on('error', function () { resolve(''); });
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  try { return JSON.parse(raw || '{}') || {}; } catch (e) { return {}; }
}

/* One directory listing, shaped for the page and sorted by core/localfs.js. */
function listDir(res, rawPath) {
  const dir = safePath(rawPath);
  let st;
  try { st = fs.statSync(dir); } catch (e) { json(res, 200, { ok: false, error: 'no such folder', path: dir }); return; }
  if (!st.isDirectory()) { json(res, 200, { ok: false, error: 'not a folder', path: dir }); return; }
  const entries = sortEntries(listLocal(dir, {}), 'name', 1).map(function (e) {
    return {
      name: e.name, path: e.path, type: e.type, size: e.size,
      mtime: e.mtime, ctime: e.ctime, hidden: !!e.hidden,
      icon: iconFor(e),
      sizeText: e.type === 'folder' ? '' : fmtSize(e.size),
      dateText: fmtDate(e.mtime)
    };
  });
  json(res, 200, {
    ok: true, path: dir, parent: parentOfDir(dir),
    crumbs: crumbsOf(dir), roots: drives(), entries: entries
  });
}

function download(res, rawPath) {
  const file = safePath(rawPath);
  let st;
  try { st = fs.statSync(file); } catch (e) { res.writeHead(404); res.end('not found'); return; }
  if (st.isDirectory()) { res.writeHead(400); res.end('that is a folder'); return; }
  res.writeHead(200, {
    'content-type': guessType(file),
    'content-length': st.size,
    'content-disposition': 'attachment; filename="' + encodeURIComponent(path.basename(file)) + '"'
  });
  fs.createReadStream(file).pipe(res);
}

/* The body arrives raw, so a multi-gigabyte upload never enters memory. */
async function upload(req, res, dirRaw, nameRaw) {
  const dir = safePath(dirRaw);
  const name = path.basename(String(nameRaw || '').trim());
  if (!name) { json(res, 400, { ok: false, error: 'no name' }); return; }
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { }
  const target = uniqueName(dir, name);
  const out = fs.createWriteStream(target);
  const done = new Promise(function (resolve, reject) {
    req.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    req.on('error', reject);
  });
  try {
    await done;
    json(res, 200, { ok: true, path: target });
  } catch (e) {
    json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) });
  }
}

async function handle(req, res) {
  const u = new URL(req.url || '/', 'http://127.0.0.1');
  const p = u.pathname;
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'GET' && (p === '/' || p === '/index.html')) { html(res, PAGE); return; }
  if (method === 'GET' && p === '/api/info') {
    json(res, 200, {
      app: 'Infinity File Manager', version: VERSION, mode: 'gui',
      platform: process.platform + '/' + process.arch,
      home: homeDir(), roots: drives()
    });
    return;
  }
  if (method === 'GET' && p === '/api/list') { listDir(res, u.searchParams.get('path')); return; }
  if (method === 'GET' && p === '/api/download') { download(res, u.searchParams.get('path')); return; }

  if (method === 'POST' && p === '/api/mkdir') {
    const b = await readJson(req);
    try {
      const made = mkdirLocal(path.join(safePath(b.dir), path.basename(String(b.name || '').trim())));
      json(res, 200, { ok: true, path: made });
    } catch (e) { json(res, 500, { ok: false, error: String(e.message) }); }
    return;
  }
  if (method === 'POST' && p === '/api/rename') {
    const b = await readJson(req);
    try {
      const from = safePath(b.path);
      const to = path.join(path.dirname(from), path.basename(String(b.name || '').trim()));
      renameLocal(from, to);
      json(res, 200, { ok: true, path: to });
    } catch (e) { json(res, 500, { ok: false, error: String(e.message) }); }
    return;
  }
  if (method === 'POST' && p === '/api/delete') {
    const b = await readJson(req);
    try {
      const n = removeTree(safePath(b.path));
      json(res, 200, { ok: true, removed: n });
    } catch (e) { json(res, 500, { ok: false, error: String(e.message) }); }
    return;
  }
  if (method === 'POST' && p === '/api/upload') {
    await upload(req, res, u.searchParams.get('dir'), u.searchParams.get('name'));
    return;
  }

  json(res, 404, { ok: false, error: 'not found' });
}

export async function runGui(opts) {
  opts = opts || {};
  const port = parseInt(opts.port || process.env.IFM_GUI_PORT || 7623, 10);
  const host = opts.host || '127.0.0.1';
  const server = http.createServer(function (req, res) {
    handle(req, res).catch(function (e) {
      try { json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) }); } catch (e2) { }
    });
  });
  const bound = await new Promise(function (resolve) {
    server.on('error', function (err) { resolve({ ok: false, error: err.code || err.message }); });
    server.listen(port, host, function () { resolve({ ok: true, port: port, host: host }); });
  });
  if (!bound.ok) return bound;
  const url = 'http://localhost:' + port + '/';
  console.log('Infinity File Manager UI  ' + url);
  if (opts.open === true) openBrowser(url);
  return bound;
}

export { PAGE, listDir, crumbsOf };
