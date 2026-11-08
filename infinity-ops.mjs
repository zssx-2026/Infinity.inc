#!/usr/bin/env node
/* infinity-ops.mjs — Infinity 工作区一体化运维脚本(单文件/零依赖/Node>=22)
   子命令:
     report   工作区体积扫描(只读)
     clean    工作区最小化: 默认 dry-run; --apply 同盘 rename 为 *.retired-<stamp>, 永不删除
     wire     生成 web/infinity/assets/auth-client.js (login/signup 页已退役, 注册/验证走 Worker API)
     backup   增量备份到 GitHub backup 仓库 Release; --watch 每15s 实时增量
     all      report + wire + clean(dry) + backup(once)
   token: 环境变量 gittoken_zssx-2026_1 (请经 pwsh 运行以继承机器级环境变量; 本脚本绝不打印 token)
   规则详见 需求.md */
'use strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';

const ROOT = path.resolve(import.meta.dirname || process.cwd());
const TOKEN_ENV = 'gittoken_zssx-2026_1';
const API = 'https://api.github.com';
const UPLOADS = 'https://uploads.github.com';
const STATE_FILE = path.join(ROOT, '.backup-state.json');
const RELEASE_TAG = 'workspace-backup';
const BIG_FILE = 64 * 1024 * 1024;
const EXCLUDE = ['.git', 'history', 'temp', 'node_modules', 'build', 'dist', 'installers', 'Chormium', 'undefined', 'work/archive', 'Infinity Cloud/sourcecode', 'Infinity Cloud/build', 'Infinity Cloud/setup-stage'];
const SKIP_BASE = new Set(['.git', 'node_modules']);
const CLEAN_SAFE = ['temp', 'work/archive'];

const arg = { cmd: 'help' };
(function parse() {
  const a = process.argv.slice(2);
  if (a.length) arg.cmd = a[0];
  for (let i = 1; i < a.length; i++) {
    const t = a[i];
    if (t === '--apply') arg.apply = true;
    else if (t === '--watch') arg.watch = true;
    else if (t === '--no-prune') arg.noPrune = true;
    else if (t === '--repo') arg.repo = a[++i];
    else if (t === '--retire') { arg.retire = arg.retire || []; arg.retire.push(a[++i]); }
  }
})();

function fmt(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}
function isExcluded(rel) {
  const r = rel.split(path.sep).join('/');
  if (r === '.backup-state.json') return true;
  if (r.indexOf('.retired-') >= 0) return true;
  const segs = r.split('/');
  for (const s of segs) if (SKIP_BASE.has(s)) return true;
  for (const ex of EXCLUDE) { if (r === ex || r.startsWith(ex + '/')) return true; }
  return false;
}
function walk(dir, base, out, noEx) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    const rel = base ? base + '/' + ent.name : ent.name;
    if (!noEx && isExcluded(rel)) continue;
    if (ent.isDirectory()) walk(abs, rel, out, noEx);
    else if (ent.isFile()) {
      let st; try { st = fs.statSync(abs); } catch (e) { continue; }
      if (st.isFile()) out.push({ rel, abs, size: st.size });
    }
  }
}
function sizeOf(p) {
  let st; try { st = fs.statSync(p); } catch (e) { return 0; }
  if (st.isFile()) return st.size;
  const out = []; walk(p, '', out, true);
  let t = 0; for (const f of out) t += f.size; return t;
}
function sha256File(abs) {
  return new Promise((res, rej) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(abs);
    s.on('data', d => h.update(d));
    s.on('end', () => res(h.digest('hex')));
    s.on('error', rej);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- report ---------- */
function cmdReport() {
  const all = []; walk(ROOT, '', all, true);
  const byTop = new Map(); let total = 0;
  for (const f of all) {
    const top = f.rel.split('/')[0];
    const t = byTop.get(top) || { b: 0, n: 0 };
    t.b += f.size; t.n++; byTop.set(top, t); total += f.size;
  }
  console.log('[report] 工作区: ' + ROOT);
  for (const [top, t] of [...byTop.entries()].sort((a, b) => b[1].b - a[1].b))
    console.log('  ' + top.padEnd(30) + fmt(t.b).padStart(10) + '  ' + t.n + ' files');
  console.log('  ' + 'TOTAL'.padEnd(30) + fmt(total).padStart(10) + '  ' + all.length + ' files');
  const inc = []; walk(ROOT, '', inc, false);
  let incB = 0; const big = [];
  for (const f of inc) { if (f.size > BIG_FILE) big.push(f); else incB += f.size; }
  console.log('[report] 备份范围(排除表外,<64MB): ' + (inc.length - big.length) + ' files, ' + fmt(incB) + '; 跳过大文件 ' + big.length);
  big.sort((a, b) => b.size - a.size).slice(0, 10).forEach(f => console.log('    big: ' + f.rel + ' (' + fmt(f.size) + ')'));
}

/* ---------- clean ---------- */
function cmdClean() {
  const targets = [];
  for (const dir of CLEAN_SAFE) {
    const absDir = path.join(ROOT, dir);
    let ents; try { ents = fs.readdirSync(absDir, { withFileTypes: true }); } catch (e) { continue; }
    for (const ent of ents) {
      if (ent.name.indexOf('.retired-') >= 0) continue;
      targets.push({ rel: dir + '/' + ent.name, abs: path.join(absDir, ent.name) });
    }
  }
  for (const p of arg.retire || []) {
    const rel = p.split('\\').join('/');
    const abs = path.resolve(ROOT, rel);
    if (!abs.startsWith(ROOT + path.sep) && abs !== ROOT) { console.log('[clean] 拒绝越界: ' + p); continue; }
    if (fs.existsSync(abs)) targets.push({ rel, abs });
    else console.log('[clean] 不存在: ' + rel);
  }
  if (!targets.length) { console.log('[clean] 无可退役目标'); return; }
  const d = new Date(); const p2 = n => String(n).padStart(2, '0');
  const stamp = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  let freed = 0;
  targets.sort((a, b) => 0);
  for (const t of targets) {
    const sz = sizeOf(t.abs);
    const dest = t.abs + '.retired-' + stamp;
    if (arg.apply) {
      try { fs.renameSync(t.abs, dest); console.log('  retired: ' + t.rel + ' (' + fmt(sz) + ')'); freed += sz; }
      catch (e) { console.log('  FAILED: ' + t.rel + ' — ' + e.message); }
    } else { console.log('  将退役: ' + t.rel + ' (' + fmt(sz) + ')'); freed += sz; }
  }
  console.log(arg.apply ? '[clean] 完成, 同盘重命名保恢复, 释放 ' + fmt(freed) : '[clean] dry-run 未改动; 加 --apply 执行; 恢复: 去掉 .retired-' + stamp + ' 后缀');
}

/* ---------- wire ---------- */
function authClientMain() {
  'use strict';
  var page = (document.body.getAttribute('data-account-page') || '').toLowerCase();
  if (page !== 'login' && page !== 'signup') return;
  var qs = new URLSearchParams(location.search);
  var WORKER = qs.get('worker') || 'https://infinity-account-auth-worker.zssx2026.workers.dev';
  var ZH = location.pathname.indexOf('/cn/') >= 0 || (document.documentElement.getAttribute('lang') || '').indexOf('zh') === 0;
  var T = ZH ? {
    github: '使用 GitHub 登录', emailPh: 'you@example.com', reg: '注册并获取验证邮件', check: '查询账户状态',
    needEmail: '请输入有效邮箱', solving: '人机验证计算中…(约几秒, 请勿关闭页面)', working: '处理中…',
    regOk: '注册请求已提交, 验证邮件已发送; 请到邮箱点击链接完成激活。',
    stActive: '该邮箱已激活, 可直接使用 GitHub 登录。', stPending: '该邮箱待激活, 请查收验证邮件并点击链接。',
    stNone: '该邮箱尚未注册。', tokenSaved: 'GitHub 登录成功: 令牌已存入本会话(sessionStorage, 关闭标签页即失效)。',
    verifyOk: '邮箱验证成功, 账户已激活!', verifyFail: '验证失败', fail: '失败', netErr: '网络错误: 无法连接认证服务'
  } : {
    github: 'Sign in with GitHub', emailPh: 'you@example.com', reg: 'Register & get verification email', check: 'Check account status',
    needEmail: 'Please enter a valid email', solving: 'Solving human verification… (a few seconds)', working: 'Working…',
    regOk: 'Registration submitted, a verification email has been sent. Open the link inside to activate.',
    stActive: 'This email is active — sign in with GitHub.', stPending: 'This email is pending — check your inbox for the verification link.',
    stNone: 'This email is not registered.', tokenSaved: 'GitHub sign-in OK: token stored in this session (sessionStorage).',
    verifyOk: 'Email verified — account activated!', verifyFail: 'Verification failed', fail: 'Failed', netErr: 'Network error: auth service unreachable'
  };
  var box = document.createElement('section');
  box.id = 'infx-cloud-auth';
  box.style.cssText = 'margin:28px auto 0;max-width:600px;padding:20px 22px;border:1px solid rgba(128,128,128,.4);border-radius:14px;font:15px/1.6 system-ui,sans-serif';
  var title = document.createElement('h2');
  title.textContent = ZH ? '云端账户' : 'Cloud Account';
  title.style.cssText = 'margin:0 0 6px;font-size:17px';
  var status = document.createElement('p');
  status.style.cssText = 'margin:8px 0 12px;min-height:1.6em;white-space:pre-wrap';
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center';
  var input = document.createElement('input');
  input.type = 'email'; input.placeholder = T.emailPh;
  input.style.cssText = 'flex:1 1 200px;padding:9px 12px;border:1px solid rgba(128,128,128,.5);border-radius:8px;background:transparent;color:inherit;font:inherit';
  var btnCss = 'padding:9px 14px;border-radius:8px;border:1px solid rgba(128,128,128,.5);background:transparent;color:inherit;cursor:pointer;font:inherit';
  var bReg = document.createElement('button'); bReg.textContent = T.reg; bReg.style.cssText = btnCss;
  var bChk = document.createElement('button'); bChk.textContent = T.check; bChk.style.cssText = btnCss;
  var gh = document.createElement('a'); gh.textContent = T.github;
  gh.href = WORKER + '/api/auth/github';
  gh.style.cssText = btnCss + ';text-decoration:none;display:inline-block';
  row.appendChild(input); row.appendChild(bReg); row.appendChild(bChk);
  box.appendChild(title); box.appendChild(status); box.appendChild(row); box.appendChild(gh);
  function say(msg, tone) {
    status.textContent = msg;
    status.style.color = tone === 'ok' ? '#2e9e5b' : tone === 'err' ? '#d64545' : 'inherit';
  }
  function api(method, p, body) {
    return fetch(WORKER + p, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; });
    }, function () { throw new Error(T.netErr); });
  }
  function solve(prefix, target) {
    return new Promise(function (res, rej) {
      var w;
      try { w = new Worker('/infinity/assets/verify-worker.js'); } catch (e) { rej(e); return; }
      w.onmessage = function (ev) {
        var d = ev.data || {};
        if (d.type === 'progress' || d.type === 'bench') return;
        if (d.nonce !== undefined && d.nonce !== null) { w.terminate(); res(d.nonce); return; }
        if (d.type === 'error' || d.type === 'failed') { w.terminate(); rej(new Error(d.message || 'solver')); }
      };
      w.onerror = function () { w.terminate(); rej(new Error('solver unavailable')); };
      w.postMessage({ cmd: 'start', prefix: prefix, target: target });
    });
  }
  function register() {
    var email = (input.value || '').trim().toLowerCase();
    if (!email || email.indexOf('@') < 1) { say(T.needEmail, 'err'); return; }
    say(T.working);
    api('GET', '/api/challenge?email=' + encodeURIComponent(email)).then(function (r) {
      if (r.s !== 200 || !r.j.prefix) throw new Error((r.j && r.j.message) || ('HTTP ' + r.s));
      say(T.solving);
      return solve(r.j.prefix, r.j.target).then(function (nonce) {
        return api('POST', '/api/register', { email: email, proof: { prefix: r.j.prefix, bits: r.j.bits, nonce: nonce, expires: r.j.expires, sig: r.j.sig } });
      });
    }).then(function (r) {
      if (r.s === 200 && r.j && r.j.ok) say(T.regOk, 'ok');
      else throw new Error((r.j && r.j.message) || ('HTTP ' + r.s));
    }).catch(function (e) { say(T.fail + ': ' + (e && e.message ? e.message : e), 'err'); });
  }
  function check() {
    var email = (input.value || '').trim().toLowerCase();
    if (!email || email.indexOf('@') < 1) { say(T.needEmail, 'err'); return; }
    say(T.working);
    api('GET', '/api/status?email=' + encodeURIComponent(email)).then(function (r) {
      var st = r.j && r.j.state;
      if (st === 'active') say(T.stActive, 'ok');
      else if (st === 'pending') say(T.stPending);
      else say(T.stNone);
    }).catch(function (e) { say(T.fail + ': ' + (e && e.message ? e.message : e), 'err'); });
  }
  bReg.addEventListener('click', register);
  bChk.addEventListener('click', check);
  input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); register(); } });
  function fragment() {
    var hs = location.hash || '';
    if (hs.indexOf('#token=') === 0) {
      try { sessionStorage.setItem('infx_gh_token', decodeURIComponent(hs.slice(7))); } catch (e) {}
      history.replaceState(null, '', location.pathname + location.search);
      say(T.tokenSaved, 'ok'); return true;
    }
    if (hs.indexOf('#verify=') === 0) {
      var q = new URLSearchParams(hs.slice(8));
      history.replaceState(null, '', location.pathname + location.search);
      say(T.working);
      api('POST', '/api/verify', { pr: Number(q.get('verify')) || 0, email: q.get('e') || '', token: q.get('t') || '' })
        .then(function (r) {
          if (r.s === 200 && r.j && r.j.ok) say(T.verifyOk, 'ok');
          else say(T.verifyFail + ': ' + ((r.j && r.j.message) || ('HTTP ' + r.s)), 'err');
        }).catch(function (e) { say(T.verifyFail + ': ' + (e && e.message ? e.message : e), 'err'); });
      return true;
    }
    if (hs.indexOf('#error=') === 0) {
      history.replaceState(null, '', location.pathname + location.search);
      say(T.fail + ': ' + decodeURIComponent(hs.slice(7)), 'err'); return true;
    }
    return false;
  }
  var host = document.getElementById('app') || document.body;
  host.appendChild(box);
  fragment();
}

const AUTH_CLIENT = '/* auth-client.js — 由 infinity-ops.mjs wire 生成, 勿手改; 改 infinity-ops.mjs 后重跑 wire */\n(' + authClientMain.toString() + ')();\n';

function cmdWire() {
  const assetDir = path.join(ROOT, 'web', 'infinity', 'assets');
  const dst = path.join(assetDir, 'auth-client.js');
  fs.mkdirSync(assetDir, { recursive: true });
  let wstat = 'written';
  if (fs.existsSync(dst)) {
    if (fs.readFileSync(dst, 'utf8') === AUTH_CLIENT) wstat = 'unchanged';
    else { fs.writeFileSync(dst, AUTH_CLIENT); wstat = 'updated'; }
  } else fs.writeFileSync(dst, AUTH_CLIENT);
  console.log('[wire] assets/auth-client.js: ' + wstat + ' (' + fmt(Buffer.byteLength(AUTH_CLIENT)) + ')');
  const pages = ['web/infinity/login/index.html', 'web/infinity/signup/index.html', 'web/infinity/cn/login/index.html', 'web/infinity/cn/signup/index.html'];
  const re = /(<script[^>]*account\.js[^>]*>\s*<\/script>)/;
  for (const rel of pages) {
    const abs = path.join(ROOT, rel.split('/').join(path.sep));
    if (!fs.existsSync(abs)) { console.log('[wire] MISS: ' + rel); continue; }
    let html = fs.readFileSync(abs, 'utf8');
    if (html.indexOf('auth-client.js') >= 0) { console.log('[wire] ok(已接线): ' + rel); continue; }
    const m = html.match(re);
    if (!m) { console.log('[wire] WARN: 未找到 account.js 标签: ' + rel); continue; }
    html = html.replace(re, s => s + '\n  <script src="../../assets/auth-client.js" defer></script>');
    fs.writeFileSync(abs, html);
    console.log('[wire] patched: ' + rel);
  }
}

/* ---------- backup ---------- */
let TOKEN = null;
function ghHeaders(extra) {
  return Object.assign({
    'User-Agent': 'infinity-ops',
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Authorization': 'Bearer ' + TOKEN
  }, extra || {});
}
async function gh(method, url, body, opts) {
  opts = opts || {};
  const headers = ghHeaders(opts.json ? { 'Content-Type': 'application/json' } : {});
  const init = { method, headers };
  if (opts.json) init.body = JSON.stringify(body);
  if (opts.body) init.body = opts.body;
  const r = await fetch(url, init);
  const rem = r.headers.get('x-ratelimit-remaining');
  if (rem !== null && Number(rem) < 30) console.log('[backup] 警告: 接近速率上限 remaining=' + rem);
  if (!r.ok) {
    let msg = '';
    try { msg = (await r.json()).message || ''; } catch (e) {}
    const err = new Error('GitHub ' + r.status + ' ' + method + ' ' + url.replace('https://api.github.com', '') + ' ' + msg);
    err.status = r.status; throw err;
  }
  if (opts.raw) return r;
  return r.json().catch(() => ({}));
}
async function uploadAsset(repo, relId, name, f) {
  const url = UPLOADS + '/repos/' + repo + '/releases/' + relId + '/assets?name=' + encodeURIComponent(name);
  let body;
  if (f.size <= 32 * 1048576) body = fs.readFileSync(f.abs);
  else body = Readable.toWeb(fs.createReadStream(f.abs));
  const r = await fetch(url, { method: 'POST', headers: ghHeaders({ 'Content-Type': 'application/octet-stream' }), body });
  if (!r.ok) {
    let msg = ''; try { msg = (await r.json()).message || ''; } catch (e) {}
    throw new Error('upload ' + name + ' -> HTTP ' + r.status + ' ' + msg);
  }
  return r.json();
}
function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return { repo: null, files: {} }; } }
function saveState(s) {
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s));
  fs.renameSync(tmp, STATE_FILE);
}
function assetName(rel, sha) {
  const enc = rel.split('/').join('__');
  const safe = enc.replace(/[^A-Za-z0-9._\- ()]/g, '_');
  let n = (safe !== enc) ? safe + '__' + sha.slice(0, 8) : enc;
  if (n.length > 200) n = n.slice(0, 190) + '__' + sha.slice(0, 8);
  return n;
}

async function ensureRepo(repo) {
  try { await gh('GET', API + '/repos/' + repo); return; }
  catch (e) {
    if (e.status !== 404) throw e;
    const name = repo.split('/')[1];
    await gh('POST', API + '/user/repos', { name, private: true, description: 'Infinity workspace backup (auto by infinity-ops.mjs)' }, { json: true });
    console.log('[backup] 已创建私有仓库 ' + repo);
  }
}
async function ensureRelease(repo) {
  try { return await gh('GET', API + '/repos/' + repo + '/releases/tags/' + RELEASE_TAG); }
  catch (e) {
    if (e.status !== 404) throw e;
    const mk = () => gh('POST', API + '/repos/' + repo + '/releases', { tag_name: RELEASE_TAG, name: 'Infinity workspace backup', body: 'Rolling backup by infinity-ops.mjs. 资产名 = 相对路径(/→__)。清单: _manifest.json', prerelease: false }, { json: true });
    try { return await mk(); }
    catch (e2) {
      if (e2.status !== 422) throw e2;
      try { await gh('PUT', API + '/repos/' + repo + '/contents/.backup-seed.md', { message: 'seed', content: Buffer.from('Infinity workspace backup\n').toString('base64') }, { json: true }); } catch (e3) {}
      try { return await mk(); } catch (e4) {
        if (e4.status === 422) return await gh('GET', API + '/repos/' + repo + '/releases/tags/' + RELEASE_TAG);
        throw e4;
      }
    }
  }
}

async function backupOnce(repo) {
  const t0 = Date.now();
  const release = await ensureRelease(repo);
  const relId = release.id;
  const assets = new Map();
  for (let pg = 1; ; pg++) {
    const list = await gh('GET', API + '/repos/' + repo + '/releases/' + relId + '/assets?per_page=100&page=' + pg);
    if (!Array.isArray(list) || !list.length) break;
    for (const a of list) assets.set(a.name, a.id);
    if (list.length < 100) break;
  }
  const state = loadState(); state.repo = repo; state.files = state.files || {};
  const files = []; walk(ROOT, '', files, false);
  const inc = files.filter(f => f.size <= BIG_FILE);
  const big = files.filter(f => f.size > BIG_FILE);
  const cur = new Map(); for (const f of inc) cur.set(f.rel, f);
  let up = 0, dels = 0, same = 0, fail = 0;
  for (const f of inc) {
    let sha;
    try { sha = await sha256File(f.abs); } catch (e) { console.log('  sha FAIL ' + f.rel + ': ' + e.message); fail++; continue; }
    const prev = state.files[f.rel];
    const name = assetName(f.rel, sha);
    if (prev && prev.sha === sha && assets.has(prev.asset)) { same++; continue; }
    for (const nm of [prev && prev.asset, name]) {
      if (nm && assets.has(nm)) {
        try { await gh('DELETE', API + '/repos/' + repo + '/releases/assets/' + assets.get(nm)); } catch (e) {}
        assets.delete(nm); dels++;
      }
    }
    try { await uploadAsset(repo, relId, name, f); state.files[f.rel] = { sha, asset: name, at: new Date().toISOString() }; up++; }
    catch (e) { console.log('  upload FAIL ' + f.rel + ': ' + e.message); fail++; }
  }
  if (!arg.noPrune) {
    for (const rel of Object.keys(state.files)) {
      if (cur.has(rel)) continue;
      const a = state.files[rel];
      if (a.asset && assets.has(a.asset)) {
        try { await gh('DELETE', API + '/repos/' + repo + '/releases/assets/' + assets.get(a.asset)); assets.delete(a.asset); dels++; } catch (e) {}
      }
      delete state.files[rel];
      console.log('  清理失效资产: ' + rel);
    }
  }
  const manifest = {
    repo, tag: RELEASE_TAG, generatedAt: new Date().toISOString(),
    counts: { files: inc.length, skippedBig: big.length },
    bigSkipped: big.map(f => f.rel + ' (' + fmt(f.size) + ')'),
    files: state.files,
    restore: '资产名=相对路径中 / 替换为 __ (特殊字符再替换为 _ 并加 __sha8 后缀); 本清单 files 键即原始相对路径'
  };
  const mName = '_manifest.json';
  if (assets.has(mName)) { try { await gh('DELETE', API + '/repos/' + repo + '/releases/assets/' + assets.get(mName)); } catch (e) {} }
  await gh('POST', UPLOADS + '/repos/' + repo + '/releases/' + relId + '/assets?name=' + mName,
    Buffer.from(JSON.stringify(manifest)), { body: true, json: false, raw: false });
  saveState(state);
  console.log('[backup] ' + repo + '#' + RELEASE_TAG + ' — 上传 ' + up + '(删除旧 ' + dels + '), 未变 ' + same + ', 失败 ' + fail + ', 在册 ' + inc.length + ', 跳过大文件 ' + big.length + ', 用时 ' + Math.round((Date.now() - t0) / 1000) + 's');
  return fail === 0;
}

async function cmdBackup() {
  TOKEN = process.env[TOKEN_ENV];
  if (!TOKEN) {
    console.log('[backup] 缺少环境变量 ' + TOKEN_ENV + ' — 请经 pwsh 运行(机器级环境变量可注入子进程)');
    process.exit(2);
  }
  const me = await gh('GET', API + '/user');
  const repo = arg.repo || (me.login + '/backup');
  console.log('[backup] repo=' + repo + ' mode=' + (arg.watch ? 'watch(15s)' : 'once'));
  await ensureRepo(repo);
  let ok = await backupOnce(repo);
  if (arg.watch) {
    console.log('[backup] watch 模式启动, 每 15s 增量扫描, Ctrl+C 退出');
    for (;;) { await sleep(15000); try { ok = await backupOnce(repo); } catch (e) { console.log('[backup] 轮次失败: ' + e.message); } }
  }
  if (!ok) process.exit(1);
}

/* ---------- main ---------- */
(async function main() {
  try {
    if (arg.cmd === 'report') cmdReport();
    else if (arg.cmd === 'clean') cmdClean();
    else if (arg.cmd === 'wire') cmdWire();
    else if (arg.cmd === 'backup') await cmdBackup();
    else if (arg.cmd === 'all') {
      cmdReport(); cmdWire(); cmdClean();
      TOKEN = process.env[TOKEN_ENV];
      if (!TOKEN) { console.log('[all] 缺 token, 跳过 backup (请经 pwsh 运行)'); return; }
      const me = await gh('GET', API + '/user');
      const repo = arg.repo || (me.login + '/backup');
      await ensureRepo(repo); await backupOnce(repo);
    }
    else console.log('用法: node infinity-ops.mjs report|clean|wire|backup|all [--apply] [--watch] [--repo owner/repo] [--retire path] [--no-prune]');
  } catch (e) {
    console.error('[FATAL] ' + (e && e.message ? e.message : e));
    process.exit(1);
  }
})();
