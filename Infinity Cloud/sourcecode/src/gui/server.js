/*
 * server.js - the graphical face of Infinity Cloud.
 *
 * The other two faces already exist: the CLI runs commands, the TUI draws the
 * same model in a terminal. Neither needs a window, so neither is the right
 * place to put one. This file adds the third face without touching them: a
 * loopback HTTP server that serves one page, and a small JSON API the page
 * drives.
 *
 * The page is a file browser, not a console. Folders open on click, files
 * download on click, the toolbar creates and uploads, rows carry their own
 * rename and delete, and the whole grid is a drop target. Nothing on it is a
 * command line, and no feature is explained in prose - the affordances are
 * the documentation.
 *
 * The server binds 127.0.0.1 only. This is a local control panel, not a
 * service; nothing about it should be reachable from the network.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GitHub, probeProxy } from '../net/github.js';
import { Store, normPath, parentOf } from '../store/store.js';
import { load } from '../core/config.js';
import { openBrowser } from '../core/mode.js';

const VERSION = 'v1.0pre1';
const PORT = 7621;

/* ------------------------------------------------------------------ state */

let store = null;
let gh = null;
let userName = null;
let lastError = null;

function tokenFromEnv() {
  return process.env.INC_TOKEN || process.env.EV_GH_TOKEN || process.env.GH_TOKEN || '';
}

async function attach(token) {
  const proxyOn = await probeProxy();
  gh = new GitHub(token, proxyOn);
  await gh.me();
  if (!await gh.verifyIdentity()) throw new Error('the token is not valid');
  const cfg = load('gui');
  store = new Store(gh, cfg, function () { });
  userName = gh.user.login;
  process.env.INC_TOKEN = token;
  process.env.INC_USER = userName;
  return userName;
}

async function ensureStore() {
  if (store) return store;
  const cfg = load('gui');
  const t = tokenFromEnv() || cfg.token || '';
  if (!t) { lastError = 'not-signed-in'; return null; }
  try { await attach(t); lastError = null; } catch (e) { lastError = String(e && e.message ? e.message : e); return null; }
  return store;
}

/* ------------------------------------------------------------------- util */

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let n = 0;
    req.on('data', function (d) {
      n += d.length;
      if (n > (limit || 2 * 1024 * 1024 * 1024)) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(d);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

function human(n) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = Number(n) || 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v : v.toFixed(1)) + ' ' + u[i];
}

function crumbsFor(p) {
  const parts = normPath(p).split('/').filter(Boolean);
  const out = [{ name: '我的云盘', path: '/' }];
  let acc = '';
  for (const s of parts) { acc += '/' + s; out.push({ name: s, path: acc }); }
  return out;
}

/* -------------------------------------------------------------------- api */

async function apiList(res, query) {
  const s = await ensureStore();
  if (!s) { json(res, 200, { ok: false, reason: lastError || 'not-signed-in' }); return; }
  await s.pull(function () { });
  const at = normPath(query.get('path') || '/');
  const items = s.list(at).map(function (e) {
    return {
      name: e.name, path: e.path, size: e.size || 0,
      sizeText: human(e.size || 0),
      type: e.type === 'folder' ? 'folder' : 'file',
      modified: e.modified || e.created || 0,
      modifiedText: new Date(e.modified || e.created || Date.now()).toLocaleString()
    };
  });
  json(res, 200, {
    ok: true, path: at, parent: parentOf(at), user: userName,
    items: items, total: human(s.totalBytes()), count: items.length,
    crumbs: crumbsFor(at)
  });
}

async function apiTrash(res) {
  const s = await ensureStore();
  if (!s) { json(res, 200, { ok: false, reason: lastError || 'not-signed-in' }); return; }
  const rows = s.listTrash().map(function (e) {
    return {
      name: e.name, path: e.path, sizeText: human(e.size || 0),
      type: e.type === 'folder' ? 'folder' : 'file',
      modifiedText: new Date(e.deleted || e.modified || Date.now()).toLocaleString()
    };
  });
  json(res, 200, { ok: true, items: rows, count: rows.length });
}

async function apiMkdir(res, body) {
  const s = await ensureStore();
  if (!s) { json(res, 200, { ok: false, reason: lastError }); return; }
  const at = normPath(body.path || '/');
  const name = String(body.name || '').trim();
  if (!name) { json(res, 400, { ok: false, error: 'no name' }); return; }
  s.mkdir(at === '/' ? '/' + name : at + '/' + name);
  await s.flush();
  json(res, 200, { ok: true });
}

async function apiDelete(res, body) {
  const s = await ensureStore();
  if (!s) { json(res, 200, { ok: false, reason: lastError }); return; }
  await s.rm(body.path);
  await s.flush();
  json(res, 200, { ok: true });
}

async function apiRestore(res, body) {
  const s = await ensureStore();
  if (!s) { json(res, 200, { ok: false, reason: lastError }); return; }
  s.restore(body.path);
  await s.flush();
  json(res, 200, { ok: true });
}

async function apiPurge(res, body) {
  const s = await ensureStore();
  if (!s) { json(res, 200, { ok: false, reason: lastError }); return; }
  await s.purge(body.path);
  await s.flush();
  json(res, 200, { ok: true });
}

async function apiRename(res, body) {
  const s = await ensureStore();
  if (!s) { json(res, 200, { ok: false, reason: lastError }); return; }
  const from = normPath(body.path);
  const name = String(body.name || '').trim();
  if (!name) { json(res, 400, { ok: false, error: 'no name' }); return; }
  const e = s.stat(from);
  if (!e) { json(res, 404, { ok: false, error: 'not found' }); return; }
  const par = parentOf(from);
  const to = (par === '/' ? '' : par) + '/' + name;
  s.mkdir(to);
  const dst = s.stat(to);
  Object.assign(dst, { size: e.size, hash: e.hash, type: e.type, parts: e.parts, created: e.created, modified: Date.now() });
  await s.rm(from, { keepParts: true });
  await s.flush();
  json(res, 200, { ok: true });
}

async function apiUpload(req, res, query) {
  const s = await ensureStore();
  if (!s) { json(res, 200, { ok: false, reason: lastError }); return; }
  const at = normPath(query.get('path') || '/');
  const name = String(query.get('name') || '').trim();
  if (!name) { json(res, 400, { ok: false, error: 'no name' }); return; }
  const buf = await readBody(req);
  const tmp = path.join(os.tmpdir(), 'inc-up-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  fs.writeFileSync(tmp, buf);
  try {
    const target = at === '/' ? '/' + name : at + '/' + name;
    await s.put(tmp, target, {}, function () { });
    await s.flush();
  } finally { try { fs.unlinkSync(tmp); } catch (e) { } }
  json(res, 200, { ok: true });
}

async function apiDownload(req, res, query) {
  const s = await ensureStore();
  if (!s) { json(res, 200, { ok: false, reason: lastError }); return; }
  const p = normPath(query.get('path'));
  const e = s.stat(p);
  if (!e || e.type === 'folder') { json(res, 404, { ok: false, error: 'not a file' }); return; }
  const tmp = path.join(os.tmpdir(), 'inc-dl-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  await s.get(p, tmp, {}, function () { });
  const stat = fs.statSync(tmp);
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': stat.size,
    'content-disposition': 'attachment; filename="' + encodeURIComponent(e.name) + '"'
  });
  const rs = fs.createReadStream(tmp);
  rs.pipe(res);
  rs.on('close', function () { try { fs.unlinkSync(tmp); } catch (err) { } });
}

/* ------------------------------------------------------------------- page */

const PAGE = String.raw`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Infinity Cloud</title><style>
:root{--bg:#0e1116;--panel:#161b22;--card:#1a2029;--line:#2a3038;--fg:#e6edf3;--dim:#8b949e;--acc:#58a6ff;--ok:#3fb950;--err:#f85149}
*{box-sizing:border-box}html,body{height:100%}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,"Segoe UI",system-ui,sans-serif;display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:14px;padding:12px 18px;background:var(--panel);border-bottom:1px solid var(--line)}
header .logo{width:22px;height:22px;border-radius:6px;background:linear-gradient(135deg,var(--acc),#7c3aed)}
header b{font-size:15px}header .v{color:var(--dim);font-size:12px}
header .sp{margin-left:auto;display:flex;gap:14px;align-items:center;color:var(--dim);font-size:12.5px}
header .who{color:var(--ok)}
.tabs{display:flex;gap:2px;padding:0 14px;background:var(--panel);border-bottom:1px solid var(--line)}
.tabs button{background:0;border:0;color:var(--dim);padding:10px 14px;cursor:pointer;font-size:13px;border-bottom:2px solid transparent}
.tabs button.on{color:var(--fg);border-bottom-color:var(--acc)}
.bar{display:flex;align-items:center;gap:10px;padding:10px 18px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.crumbs{display:flex;gap:4px;align-items:center;flex:1;min-width:220px;overflow:auto}
.crumbs a{color:var(--dim);cursor:pointer;padding:3px 6px;border-radius:5px;white-space:nowrap}
.crumbs a:hover{background:var(--card);color:var(--fg)}
.crumbs a.last{color:var(--fg);font-weight:600}
.crumbs .sep{color:var(--line)}
button.b{background:var(--card);border:1px solid var(--line);color:var(--fg);border-radius:7px;padding:7px 13px;cursor:pointer;font-size:13px}
button.b:hover{border-color:var(--acc)}
button.b.p{background:var(--acc);color:#08111c;border-color:var(--acc);font-weight:600}
.grid{flex:1;overflow:auto;padding:16px 18px;display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:12px;align-content:start}
.grid.drop{outline:2px dashed var(--acc);outline-offset:-10px;background:rgba(88,166,255,.05)}
.card{position:relative;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;cursor:pointer;display:flex;flex-direction:column;gap:8px;min-height:104px;transition:border-color .12s,transform .12s}
.card:hover{border-color:var(--acc);transform:translateY(-1px)}
.card .ic{width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:22px}
.card .nm{font-size:13px;word-break:break-all;line-height:1.35}
.card .mt{color:var(--dim);font-size:11.5px;margin-top:auto}
.card .act{position:absolute;top:6px;right:6px;display:none;gap:4px}
.card:hover .act{display:flex}
.card .act button{background:#0b1017cc;border:1px solid var(--line);color:var(--dim);border-radius:5px;width:24px;height:24px;cursor:pointer;font-size:12px;line-height:1}
.card .act button:hover{color:var(--fg);border-color:var(--acc)}
.empty{margin:auto;text-align:center;color:var(--dim);grid-column:1/-1;padding:60px 0}
footer{padding:8px 18px;border-top:1px solid var(--line);color:var(--dim);font-size:12px;display:flex;gap:16px}
.modal{position:fixed;inset:0;background:#000000b0;display:none;align-items:center;justify-content:center;z-index:50}
.modal.on{display:flex}
.modal .box{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:20px;width:min(420px,92vw)}
.modal h3{margin:0 0 14px;font-size:15px}
.modal input{width:100%;background:#0b0f14;color:var(--fg);border:1px solid var(--line);border-radius:7px;padding:9px 12px;outline:none;font:13px inherit}
.modal input:focus{border-color:var(--acc)}
.modal .row{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
.signin{margin:auto;text-align:center;max-width:420px;padding:40px}
.signin h2{margin:0 0 8px;font-size:17px}.signin p{color:var(--dim);font-size:13px;margin:0 0 18px}
.toast{position:fixed;bottom:18px;right:18px;background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--acc);padding:10px 16px;border-radius:8px;font-size:13px;display:none;z-index:60}
.toast.on{display:block}.toast.err{border-left-color:var(--err)}.toast.ok{border-left-color:var(--ok)}
</style></head><body>
<header><div class="logo"></div><b>Infinity Cloud</b><span class="v">` + VERSION + `</span>
<span class="sp"><span id="total">-</span><span class="who" id="who"></span></span></header>
<div class="tabs"><button id="t1" class="on">我的云盘</button><button id="t2">回收站</button></div>
<div class="bar">
  <div class="crumbs" id="crumbs"></div>
  <button class="b" id="up">上传</button>
  <button class="b" id="newdir">新建文件夹</button>
  <button class="b" id="refresh">刷新</button>
</div>
<div class="grid" id="grid"></div>
<footer><span id="stat">-</span><span id="hint">拖拽文件到此处上传</span></footer>
<input type="file" id="file" multiple hidden>
<div class="modal" id="modal"><div class="box"><h3 id="mtitle"></h3>
<input id="minput" placeholder="名称"><div class="row"><button class="b" id="mcancel">取消</button><button class="b p" id="mok">确定</button></div></div></div>
<div class="toast" id="toast"></div>
<script>
var $=function(s){return document.querySelector(s)};
var cwd='/', tab='files', pending=null;
function toast(m,k){var t=$('#toast');t.textContent=m;t.className='toast on '+(k||'');setTimeout(function(){t.className='toast'},2600);}
function api(u,o){return fetch(u,o).then(function(r){return r.json()});}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function icon(it){ if(it.type==='folder') return '\uD83D\uDCC1'; var n=it.name.toLowerCase();
  if(/\.(png|jpg|jpeg|gif|webp|bmp|svg)$/.test(n))return '\uD83D\uDDBC';
  if(/\.(mp4|mkv|mov|avi|webm)$/.test(n))return '\uD83C\uDFAC';
  if(/\.(mp3|wav|flac|ogg|m4a)$/.test(n))return '\uD83C\uDFB5';
  if(/\.(zip|7z|rar|tar|gz|arc)$/.test(n))return '\uD83D\uDDDC';
  if(/\.(js|mjs|ts|py|java|c|cpp|cs|go|rs|json|html|css)$/.test(n))return '\uD83D\uDCDC';
  if(/\.(exe|msi|dll)$/.test(n))return '\u2699';
  return '\uD83D\uDCC4'; }
function renderCrumbs(c){ var el=$('#crumbs'); el.innerHTML='';
  if(tab==='trash'){el.innerHTML='<a class="last">回收站</a>';return;}
  c.forEach(function(x,i){ if(i)el.insertAdjacentHTML('beforeend','<span class="sep">/</span>');
    var a=document.createElement('a'); a.textContent=x.name; a.className=i===c.length-1?'last':''; a.onclick=function(){cwd=x.path;load();}; el.appendChild(a); }); }
function card(it){
  var d=document.createElement('div'); d.className='card';
  d.innerHTML='<div class="ic">'+icon(it)+'</div><div class="nm">'+esc(it.name)+'</div><div class="mt">'+(it.type==='folder'?'文件夹':it.sizeText)+'</div>'+
   '<div class="act">'+(tab==='trash'
     ?'<button title="还原" data-a="restore">\u21A9</button><button title="彻底删除" data-a="purge">\u2715</button>'
     :'<button title="重命名" data-a="rename">\u270E</button><button title="删除" data-a="del">\uD83D\uDDD1</button>')+'</div>';
  d.onclick=function(e){ var a=e.target.getAttribute&&e.target.getAttribute('data-a');
    if(a){ e.stopPropagation(); return rowAction(a,it); }
    if(tab==='trash') return;
    if(it.type==='folder'){ cwd=it.path; load(); }
    else location.href='/api/download?path='+encodeURIComponent(it.path); };
  return d;
}
async function rowAction(a,it){
  if(a==='del'){ if(!confirm('删除「'+it.name+'」？会进入回收站。'))return; await api('/api/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:it.path})}); toast('已移入回收站','ok'); load(); }
  else if(a==='purge'){ if(!confirm('彻底删除「'+it.name+'」？不可恢复。'))return; await api('/api/purge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:it.path})}); toast('已彻底删除','ok'); load(); }
  else if(a==='restore'){ await api('/api/restore',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:it.path})}); toast('已还原','ok'); load(); }
  else if(a==='rename'){ ask('重命名',it.name,async function(v){ await api('/api/rename',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:it.path,name:v})}); toast('已重命名','ok'); load(); }); }
}
function ask(title,val,ok){ $('#mtitle').textContent=title; $('#minput').value=val||''; $('#modal').classList.add('on'); $('#minput').focus();
  pending=function(v){ $('#modal').classList.remove('on'); ok(v); }; }
$('#mok').onclick=function(){ var v=$('#minput').value.trim(); if(v&&pending)pending(v); };
$('#mcancel').onclick=function(){ $('#modal').classList.remove('on'); pending=null; };
$('#minput').onkeydown=function(e){ if(e.key==='Enter')$('#mok').click(); if(e.key==='Escape')$('#mcancel').click(); };
async function load(){
  var g=$('#grid'); g.innerHTML='<div class="empty">载入中…</div>';
  if(tab==='trash'){ var j=await api('/api/trash'); renderCrumbs([]); g.innerHTML='';
    if(!j.ok) return needSignIn(j.reason); (j.items||[]).forEach(function(it){g.appendChild(card(it))});
    if(!(j.items||[]).length)g.innerHTML='<div class="empty">回收站是空的</div>'; $('#stat').textContent=(j.count||0)+' 项'; return; }
  var j=await api('/api/list?path='+encodeURIComponent(cwd));
  if(!j.ok) return needSignIn(j.reason);
  cwd=j.path; $('#who').textContent=j.user||''; $('#total').textContent='共 '+j.total;
  renderCrumbs(j.crumbs); g.innerHTML='';
  (j.items||[]).forEach(function(it){g.appendChild(card(it))});
  if(!(j.items||[]).length)g.innerHTML='<div class="empty">这个文件夹是空的<br>把文件拖进来，或点「上传」</div>';
  $('#stat').textContent=j.count+' 项';
}
function needSignIn(reason){
  $('#grid').innerHTML='<div class="signin"><h2>登录 Infinity Cloud</h2><p>粘贴 GitHub token 即可开始。'+(reason?('（'+esc(reason)+'）'):'')+'</p>'+
   '<input id="tk" placeholder="ghp_… 或 github_pat_…" style="width:100%;background:#0b0f14;color:var(--fg);border:1px solid var(--line);border-radius:7px;padding:10px 12px;margin-bottom:12px"><button class="b p" id="sgo">登录</button></div>';
  $('#sgo').onclick=async function(){ var t=$('#tk').value.trim(); if(!t)return; var r=await api('/api/signin',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:t})}); if(r.ok){toast('已登录 '+r.user,'ok');load();}else toast(r.error||'登录失败','err'); };
}
$('#t1').onclick=function(){tab='files';$('#t1').classList.add('on');$('#t2').classList.remove('on');$('#up').style.display='';$('#newdir').style.display='';load();};
$('#t2').onclick=function(){tab='trash';$('#t2').classList.add('on');$('#t1').classList.remove('on');$('#up').style.display='none';$('#newdir').style.display='none';load();};
$('#refresh').onclick=load;
$('#newdir').onclick=function(){ask('新建文件夹','',async function(v){ await api('/api/mkdir',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:cwd,name:v})}); toast('已创建','ok'); load(); });};
$('#up').onclick=function(){$('#file').click();};
$('#file').onchange=function(){uploadAll([].slice.call($('#file').files));};
var g=$('#grid');
['dragenter','dragover'].forEach(function(ev){g.addEventListener(ev,function(e){e.preventDefault();g.classList.add('drop');});});
['dragleave','drop'].forEach(function(ev){g.addEventListener(ev,function(e){e.preventDefault();g.classList.remove('drop');});});
g.addEventListener('drop',function(e){ if(e.dataTransfer&&e.dataTransfer.files.length)uploadAll([].slice.call(e.dataTransfer.files)); });
async function uploadAll(files){
  if(tab==='trash'){toast('回收站不能上传','err');return;}
  var n=0;
  for(var i=0;i<files.length;i++){ var f=files[i];
    $('#stat').textContent='上传 '+f.name+' ('+(i+1)+'/'+files.length+')';
    var r=await fetch('/api/upload?path='+encodeURIComponent(cwd)+'&name='+encodeURIComponent(f.name),{method:'POST',body:f}).then(function(x){return x.json()});
    if(r.ok)n++; else toast('上传失败 '+f.name+(r.error?('：'+r.error):''),'err');
  }
  toast('上传完成 '+n+' 个','ok'); load();
}
load();
</script></body></html>`;

/* ----------------------------------------------------------------- router */

async function handle(req, res) {
  const u = new URL(req.url || '/', 'http://localhost');
  const q = u.searchParams;
  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
    return;
  }
  if (req.method === 'GET' && u.pathname === '/api/list') return apiList(res, q);
  if (req.method === 'GET' && u.pathname === '/api/trash') return apiTrash(res);
  if (req.method === 'GET' && u.pathname === '/api/download') return apiDownload(req, res, q);

  let body = {};
  if (req.method === 'POST' && u.pathname !== '/api/upload') {
    try { body = JSON.parse((await readBody(req, 1e6)).toString('utf8') || '{}'); } catch (e) { body = {}; }
  }
  if (req.method === 'POST' && u.pathname === '/api/signin') {
    try { const n = await attach(String(body.token || '').trim()); json(res, 200, { ok: true, user: n }); }
    catch (e) { json(res, 200, { ok: false, error: String(e && e.message ? e.message : e) }); }
    return;
  }
  if (req.method === 'POST' && u.pathname === '/api/mkdir') return apiMkdir(res, body);
  if (req.method === 'POST' && u.pathname === '/api/delete') return apiDelete(res, body);
  if (req.method === 'POST' && u.pathname === '/api/rename') return apiRename(res, body);
  if (req.method === 'POST' && u.pathname === '/api/restore') return apiRestore(res, body);
  if (req.method === 'POST' && u.pathname === '/api/purge') return apiPurge(res, body);
  if (req.method === 'POST' && u.pathname === '/api/upload') return apiUpload(req, res, q);

  json(res, 404, { ok: false, error: 'not found' });
}

export async function runGui(opts) {
  opts = opts || {};
  const port = parseInt(opts.port || process.env.INC_GUI_PORT || PORT, 10);
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
  console.log('Infinity Cloud UI  ' + url);
  /*
   * The server never opens anything by itself.
   *
   * A window is the shell's job, not the server's: when the GUI is packaged
   * as an Electron app the shell loads this URL into its own window, and when
   * it is run by hand the URL is simply printed. Opening a browser here would
   * put a tab in front of whatever the user was doing, which is exactly the
   * interruption this project is meant to avoid.
   */
  if (opts.open === true) openBrowser(url);
  return bound;
}

export { PAGE };
