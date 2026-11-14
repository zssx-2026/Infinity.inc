/*
 * main.js - InfinityViewer, the Infinity.Inc browser window.
 *
 * One viewer, several applications. The window is the whole job: the program
 * already knows how to serve its own interface on loopback, so the shell
 * starts that server, waits for the port to answer, and points a window at
 * it. Nothing about the interface is duplicated here, which is what keeps
 * the window and the terminal showing the same program.
 *
 * The C++ program no longer draws a window. Every application serves its
 * interface over loopback HTTP from a `--serve-ui [--port=N]` mode - the
 * contract in cpp/core/include/inc/uiserver.hpp - and Electron is only the
 * frame around it. The sibling executable the window wraps is named by the
 * executable's own name, exactly as the command-line faces do it:
 *
 *   inc_gui.exe   inx_gui.exe   ->  Infinity Cloud             inc_cli.exe   7621
 *   ipm_gui.exe   ipmx_gui.exe  ->  InfinityPackageManager     ipm_cli.exe   7632
 *   int_gui.exe   intx_gui.exe  ->  Infinity Toolbox            int_cli.exe   7653
 *
 * The server executable is expected beside the shell, which is how the
 * installer lays the directory out. The window itself is always called
 * InfinityViewer: the product inside it is a tab, not the browser.
 */
const { app, BrowserWindow, Menu, ipcMain, shell, screen, protocol, session, webContents } = require('electron');
const { DownloadManager } = require('./downloads');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { spawn } = require('node:child_process');

/* Same rule as the other windows: no native error box, ever. Anything that
 * escapes lands in the log next to the settings, and the window stays up. */
function logCrash(what, detail) {
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    const text = (detail && (detail.stack || detail.message)) || String(detail || '');
    fs.appendFileSync(path.join(dir, 'crash.log'), new Date().toISOString() + ' ' + what + ' ' + text + '\n');
  } catch (ignored) { }
}
process.on('uncaughtException', (error) => logCrash('uncaughtException', error));
process.on('unhandledRejection', (error) => logCrash('unhandledRejection', error));

/* The chrome page is served from a scheme of its own, not from a loopback port.
 * A port is a fresh origin on every launch, so localStorage - the open tabs, the
 * theme, the playzone - would be thrown away each time the window started. A
 * registered scheme keeps one stable origin forever, and marking it standard and
 * secure lets it frame the application's http://127.0.0.1 page. */
const CHROME_SCHEME = 'infinity-shell';
const CHROME_ORIGIN = CHROME_SCHEME + '://ui/';
protocol.registerSchemesAsPrivileged([{
  scheme: CHROME_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
}]);

const APPS = {
  inc: { name: 'Infinity Cloud', port: 7621 },
  ipm: { name: 'InfinityPackageManager', port: 7632 },
  int: { name: 'Infinity Toolbox', port: 7653 }
};

/* The eight window names, each mapped to the application it opens. The
 * administrator's copy has its own prefix, so the name on disk is not the
 * application name and must be translated before the port or the title is
 * looked up. */
const ADMIN_TO_BASE = {
  inc: 'inc', inx: 'inc',
  ipm: 'ipm', ipmx: 'ipm',
  int: 'int', intx: 'int'
};

/* The administrator's executable is the same program built with elevation in
 * mind, so the window that opens it is the same window. One shell directory is
 * shipped per product instead of one per face: --admin picks the twin, which
 * halves both the payload and the number of windows a shortcut could point at. */
const ADMIN_OF = { inc: 'inx', ipm: 'ipmx', int: 'intx' };

/* The shell's own file name decides the application, so one binary can be
 * renamed into any of the eight names without a rebuild. */
function prefixFromName() {
  const base = path.basename(process.execPath).replace(/\.exe$/i, '').toLowerCase();
  /* inc's administrator twin is inx, not incx (cpp/tools/build.mjs owns the
   * administrator prefixes), so every name is listed. The capture is the name
   * on disk, which for an administrator copy is not the application name: it
   * is translated through the table, or the window would take the wrong title
   * and the wrong port. */
  /* The installer ships this shell as <prefix>_window.exe (the name the
   * Start Menu shortcut has always used), while a development run keeps the
   * build output's <prefix>_gui.exe, so both spellings are accepted. */
  const named = /^(inc|inx|ipm|ipmx|int|intx)_(gui|window)$/.exec(base);
  if (named && ADMIN_TO_BASE[named[1]]) return ADMIN_TO_BASE[named[1]];
  for (const a of Object.keys(APPS)) if (base.indexOf(a) === 0) return a;
  return 'inc';
}

/* Where the command-line faces live. The installer puts them in the same
 * directory as the shell; a development run keeps them under a sibling
 * build folder, so a few plausible places are tried in order. */
function findServer(prefix) {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const here = path.dirname(process.execPath);
  const candidates = [
    path.join(here, prefix + '_cli' + ext),
    path.join(here, 'payload', prefix + '_cli' + ext),
    path.join(here, '..', prefix + '_cli' + ext),
    path.join(process.resourcesPath || here, 'payload', prefix + '_cli' + ext)
  ];
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch (e) { } }
  return null;
}


/* 其它子产品。外壳只自带自己那一个 CLI（安装包一个产品一份），但用户装了
 * 整套时兄弟目录里还有别的产品。点应用卡片应该真的把那个产品跑起来，而不是
 * 打开一张写着「演示内容」的静态页——静态页在浏览器里没有任何意义。 */
const PRODUCTS = {
  inc: { name: 'Infinity Cloud', port: 7621, dir: 'Infinity Cloud' },
  ipm: { name: 'InfinityPackageManager', port: 7632, dir: 'InfinityPackageManager' },
  int: { name: 'Infinity Toolbox', port: 7653, dir: 'Infinity Toolbox' },
  ifm: { name: 'Infinity File Manager', port: 7623, dir: 'Infinity File Manager' }
};

const productProcs = {};
const productUrls = {};

/* 产品可能装在同目录（外壳自带的那一个）、兄弟产品目录（Studio 装出来的
 * 布局），或者开发树里的 cpp/out。按这个顺序找，找到第一个就用。 */
function productCliCandidates(prefix) {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const here = path.dirname(process.execPath);
  const name = prefix + '_cli' + ext;
  const meta = PRODUCTS[prefix];
  const out = [
    path.join(here, name),
    path.join(here, '..', name)
  ];
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const root = path.join(local, 'Programs', 'Infinity.Inc');
    if (meta) out.push(path.join(root, meta.dir, name));
    out.push(path.join(root, name));
  }
  /* 开发树：shell/build/<p>_gui-win32-x64/resources/app → 仓库根。 */
  out.push(path.join(here, '..', '..', '..', '..', 'cpp', 'out', prefix, name));
  out.push(path.join(here, '..', '..', '..', 'cpp', 'out', prefix, name));
  return out;
}

function findProductCli(prefix) {
  for (const c of productCliCandidates(prefix)) {
    try { if (fs.existsSync(c)) return c; } catch (e) { }
  }
  return null;
}

function productRunning(prefix) {
  return !!(productProcs[prefix] && productUrls[prefix]);
}

/* 起一个子产品并等它监听。返回 {url} 或 {error}，从不抛：调用方是页面的
 * 一次点击，失败要变成一张能读的卡片，而不是一个静默的空标签页。 */
async function ensureProduct(prefix) {
  if (!PRODUCTS[prefix]) return { error: 'unknown app: ' + prefix };
  if (productRunning(prefix)) return { url: productUrls[prefix], port: appPort };
  const exe = findProductCli(prefix);
  if (!exe) return { error: 'not installed' };
  const port = await pickPort(PRODUCTS[prefix].port);
  let proc;
  try {
    proc = spawn(exe, ['--serve-ui', '--port=' + port], {
      cwd: path.dirname(exe),
      stdio: 'ignore',
      windowsHide: true
    });
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
  productProcs[prefix] = proc;
  proc.on('exit', function () {
    delete productProcs[prefix];
    delete productUrls[prefix];
  });
  const up = await waitForPort(port, 20000, function () { return !!proc.exitCode === false; });
  if (!up) {
    try { proc.kill(); } catch (e) { }
    delete productProcs[prefix];
    return { error: 'server did not start' };
  }
  productUrls[prefix] = 'http://127.0.0.1:' + port + '/';
  return { url: productUrls[prefix], port: port };
}

/* A free loopback port at or after `base`. The preferred port is what the
 * installer's firewall rules and the user's muscle memory expect, so it is
 * tried first and only stepped over when something else already holds it -
 * a second copy of the suite, or a stale server that has not been reaped. */
function portFree(port) {
  return new Promise(function (resolve) {
    const s = net.createServer();
    s.once('error', function () { resolve(false); });
    s.once('listening', function () { s.close(function () { resolve(true); }); });
    s.listen(port, '127.0.0.1');
  });
}

async function pickPort(base) {
  for (let p = base; p < base + 64; p++) {
    if (await portFree(p)) return p;
  }
  return base;
}

/* Poll the port until the server answers. `alive` is consulted between
 * attempts so a server that has already exited fails fast instead of
 * burning the whole timeout. */
function waitForPort(port, timeoutMs, alive) {
  const deadline = Date.now() + timeoutMs;
  return new Promise(function (resolve) {
    const attempt = function () {
      if (alive && !alive()) { resolve(false); return; }
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', function () { s.destroy(); resolve(true); });
      s.once('error', function () {
        s.destroy();
        if (Date.now() > deadline) resolve(false);
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

let serverProc = null;
let win = null;
let appPort = 0;
let shellUrl = null;

function windowOptions(meta) {
  return {
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    title: 'InfinityViewer',
    backgroundColor: '#0e1116',
    autoHideMenuBar: true,
    /* A probe must not put a window on the user's screen: the renderer still
     * paints while hidden (paintWhenInitiallyHidden defaults to true), so the
     * capture and the DOM reads are unaffected. */
    show: !process.env.INFINITY_SHELL_PROBE,
    /* The chrome page draws its own title bar, tab strip and caption buttons
     * (shell.css keeps a drag region for them). A native frame on top of that
     * would show two title bars and two sets of window buttons. */
    frame: false,
    /* The chrome page reaches the window through preload.js and nothing else:
     * context isolation on, Node off, sandbox on. */
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      /* 外部网页装在 <webview> 里，chrome 页本身仍然只有 preload 这一条通路。 */
      webviewTag: true,
      preload: path.join(__dirname, 'preload.js')
    }
  };
}

/* The window talks to a local process that holds the user's GitHub token, so
 * it must never leave 127.0.0.1. `will-navigate` blocks a link or script that
 * tries to steer the window somewhere else, and the window-open handler keeps
 * a `target=_blank` link from opening a second, unguarded window. Both are
 * attached to every window, the served one and the error one alike. */
function guardWindow(w, ports) {
  const list = [CHROME_ORIGIN].concat([].concat(ports).filter(Boolean)
    .map(function (p) { return 'http://127.0.0.1:' + p + '/'; }));
  const local = function (target) {
    return list.some(function (prefix) { return target === prefix || target.indexOf(prefix) === 0; });
  };
  w.webContents.on('will-navigate', function (e, target) {
    if (!local(target)) e.preventDefault();
  });
  w.webContents.setWindowOpenHandler(function (d) {
    /* A real link is handed to the system browser; nothing remote is ever
     * loaded inside the shell. */
    if (/^https?:/i.test(d.url)) shell.openExternal(d.url);
    return { action: 'deny' };
  });
}

/* An error the user can read, drawn in the window itself. A blank white
 * page - or a window that never appears - is the worst possible failure:
 * it says nothing and looks like a hang. This says what went wrong and
 * what to do about it. */
function showFatal(meta, message) {
  const html =
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<title>InfinityViewer</title><style>' +
    'html,body{margin:0;height:100%}' +
    'body{background:#0e1116;color:#e6edf3;display:flex;align-items:center;' +
    'justify-content:center;font-family:"Microsoft YaHei",system-ui,-apple-system,sans-serif}' +
    '.box{max-width:640px;padding:40px 48px;text-align:center}' +
    'h1{font-size:20px;font-weight:600;margin:0 0 16px}' +
    'p{font-size:14px;line-height:1.7;color:#9da7b3;margin:0 0 10px;word-break:break-all}' +
    '.hint{color:#6b7684;font-size:13px;margin-top:20px}' +
    '</style></head><body><div class="box">' +
    '<h1>InfinityViewer 无法启动</h1><p>' + escapeHtml(meta.name) + '</p>' +
    '<p>' + escapeHtml(message) + '</p>' +
    '<p class="hint">请重新安装本程序，或确认安装目录中的命令行程序未被删除。</p>' +
    '</div></body></html>';

  Menu.setApplicationMenu(null);
  win = new BrowserWindow(windowOptions(meta));
  guardWindow(win, 0);
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  win.on('closed', function () { win = null; shutdown(); });
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------------ *
 * the chrome page (resources/app/ui)
 * ------------------------------------------------------------------ */

/* The chrome page, served from infinity-shell://ui/ out of resources/app/ui.
 * Nothing but static files leaves this handler, and every path is kept inside
 * the ui directory. A file:// document could not frame the application's
 * http://127.0.0.1 page; a registered scheme can. */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2'
};

function serveChrome() {
  const root = path.join(__dirname, 'ui');
  protocol.handle(CHROME_SCHEME, function (req) {
    let rel = '/';
    try { rel = new URL(req.url).pathname || '/'; } catch (e) { rel = '/'; }
    const name = path.normalize(decodeURIComponent(rel === '/' ? '/index.html' : rel)).replace(/^[\\/]+/, '');
    const file = path.join(root, name);
    if (file !== root && file.indexOf(root + path.sep) !== 0) {
      return new Response('forbidden', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    try {
      const buf = fs.readFileSync(file);
      return new Response(buf, {
        status: 200,
        headers: {
          'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'cache-control': 'no-store'
        }
      });
    } catch (e) {
      return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  });
}

/* ------------------------------------------------------------------ *
 * downloads - the built-in download manager
 * ------------------------------------------------------------------ */

let downloads = null;

function downloadManager() {
  if (downloads) return downloads;
  const dir = path.join(app.getPath('downloads'), 'InfinityViewer');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { }
  downloads = new DownloadManager({
    dir: dir,
    stateFile: path.join(app.getPath('userData'), 'downloads.json'),
    /* Eight range requests per file is the IDM default and what makes a
     * single slow connection stop holding the whole transfer back. */
    connections: 8,
    concurrency: 3,
    onEvent: function (snap) { replyShell('host.download', snap); }
  });
  return downloads;
}

/* Chromium's own download path is turned off on purpose: everything the page
 * starts is handed to the engine above, which is what "built-in" means. */
function watchDownloads() {
  try {
    session.defaultSession.on('will-download', function (_e, item) {
      const url = item.getURL();
      if (!/^https?:/i.test(url)) return;
      item.cancel();
      try { downloadManager().start(url, item.getFilename()); } catch (err) { }
    });
  } catch (e) { }
}

function downloadCommand(p) {
  const mgr = downloadManager();
  const action = String(p.action || 'list');
  try {
    if (action === 'start') mgr.start(String(p.url || ''), p.name ? String(p.name) : undefined);
    else if (action === 'pause') mgr.pause(String(p.id));
    else if (action === 'resume') mgr.resume(String(p.id));
    else if (action === 'cancel') mgr.cancel(String(p.id));
    else if (action === 'remove') mgr.remove(String(p.id));
    else if (action === 'clear') mgr.clearDone();
    else if (action === 'open') {
      const it = mgr.find(String(p.id));
      if (it && it.file) shell.showItemInFolder(it.file);
    } else if (action === 'folder') shell.openPath(mgr.dir);
  } catch (e) {
    replyShell('host.download', { dir: mgr.dir, error: String(e.message || e), items: mgr.snapshot().items });
    return;
  }
  replyShell('host.download', mgr.snapshot());
}

/* Frames from the chrome page. The page owns its tabs and embeds the
 * application itself, so the host answers the window commands and keeps the
 * session - page content never crosses this bridge. */
function shellFrame(frame) {
  if (!frame || frame.channel !== 'infinity-shell') return;
  const p = frame.payload || {};
  switch (frame.type) {
    case 'shell.ready':
      replyShell('host.info', {
        host: 'electron',
        engine: 'Electron ' + process.versions.electron,
        runtime: 'iframe',
        protocol: 'infinity-shell/1',
        shell: '1.0.0',
        ua: 'Chrome/' + process.versions.chrome
      });
      break;
    case 'shell.window':
      windowCommand(p.action);
      break;
    case 'shell.session-save':
      try {
        fs.mkdirSync(path.dirname(sessionFile()), { recursive: true });
        fs.writeFileSync(sessionFile(), JSON.stringify(p, null, 2), 'utf8');
      } catch (e) { }
      replyShell('host.ack', { of: frame.type });
      break;
    case 'viewer.download':
      downloadCommand(p);
      break;
    case 'viewer.app': {
      const which = String(p.app || '');
      ensureProduct(which).then(function (r) {
        replyShell('host.app', { app: which, url: r.url || '', port: r.port || 0, error: r.error || '' });
      }).catch(function (e) {
        replyShell('host.app', { app: which, url: '', port: 0, error: String((e && e.message) || e) });
      });
      break;
    }
    case 'viewer.apps': {
      const known = {};
      for (const k of Object.keys(PRODUCTS)) {
        known[k] = { name: PRODUCTS[k].name, url: productUrls[k] || '', installed: !!findProductCli(k) };
      }
      replyShell('host.apps', { apps: known });
      break;
    }
    case 'shell.devtools': {
      replyShell('host.devtools', openDevtools(p.open !== false, String(p.tab || '')));
      break;
    }
    case 'shell.content-rect':
      /* The page renders the application in its own iframe, so no native
       * content region has to be positioned for it. */
      break;
    default:
      replyShell('host.ack', { of: frame.type });
      break;
  }
}

/* F12 has to inspect the page the user is actually looking at. When the active
 * tab is a webview that is the guest's own devtools; otherwise it is the chrome
 * page's. Electron can open both, so the host opens the real inspector instead
 * of drawing a fake log panel. */
function openDevtools(open, which) {
  if (!win || win.isDestroyed()) return { open: false, target: 'none' };
  let target = null;
  let kind = 'shell';
  try {
    const guests = webContents.getAllWebContents().filter(function (c) {
      return c.getType() === 'webview' && !c.isDestroyed();
    });
    if (guests.length && which !== 'protocol') { target = guests[0]; kind = 'webview'; }
  } catch (e) { }
  if (!target) target = win.webContents;
  try {
    if (open) target.openDevTools({ mode: 'detach' });
    else target.closeDevTools();
    return { open: !!open, target: kind };
  } catch (e) {
    return { open: false, target: kind, error: String((e && e.message) || e) };
  }
}

function replyShell(type, payload) {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send('shell:host-frame', {
      channel: 'infinity-shell', v: 1, dir: 'to-shell', type: type,
      payload: payload || {}, ts: Date.now(), id: 'host-' + Date.now()
    });
  } catch (e) { }
}

/* The window buttons the chrome draws, done to the real window. */
function windowCommand(action) {
  if (!win || win.isDestroyed()) return;
  if (action === 'minimize') win.minimize();
  else if (action === 'maximize') { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
  else if (action === 'restore') { if (win.isMinimized()) win.restore(); else win.unmaximize(); }
  else if (action === 'close') win.close();
  else if (action === 'new' && shellUrl) {
    const other = new BrowserWindow(windowOptions({ name: win.getTitle() }));
    guardWindow(other, appPort);
    other.loadURL(shellUrl);
  }
}

function sessionFile() {
  return path.join(app.getPath('userData'), 'shell-session.json');
}

/* Drive the chrome's window buttons through the real bridge and record what
 * the window did after each one. Only the probe calls this. */
function probeWindowActions(done) {
  const steps = [];
  const fire = function (action) {
    const js = 'window.__INFINITY_HOST__.postMessage({channel:"infinity-shell",v:1,' +
      'dir:"to-host",type:"shell.window",payload:{action:"' + action + '"}}); true';
    return win.webContents.executeJavaScript(js).catch(function () { return null; });
  };
  const seq = [
    ['minimize', function () { return { minimized: win.isMinimized() }; }],
    ['restore', function () { return { minimized: win.isMinimized() }; }],
    ['maximize', function () { return { maximized: win.isMaximized() }; }],
    ['restore', function () { return { maximized: win.isMaximized() }; }],
    /* A new window must be a second window on the same chrome origin. */
    ['new', function () { return { windows: BrowserWindow.getAllWindows().length }; }]
  ];
  let i = 0;
  const next = function () {
    if (i >= seq.length) { done(steps); return; }
    const step = seq[i++];
    fire(step[0]).then(function () {
      setTimeout(function () {
        const rec = { action: step[0] };
        const state = step[1]();
        Object.keys(state).forEach(function (k) { rec[k] = state[k]; });
        steps.push(rec);
        next();
      }, 600);
    });
  };
  next();
}

/* INFINITY_SHELL_PROBE_WEB proves the browsing half of the shell: an http URL
 * opened in the chrome becomes a real <webview> guest (own renderer, own
 * network stack), not the iframe card the demo host draws. The page is served
 * from a loopback server so the check needs no network. */
function probeWebPage(done) {
  const http = require('node:http');
  const page = '<!doctype html><meta charset="utf-8"><title>Probe Web Page</title>' +
    '<style>body{font:16px sans-serif;background:#102030;color:#eee;padding:24px}</style>' +
    '<h1>probe web page</h1><p>rendered inside a webview guest</p>';
  const srv = http.createServer(function (req, res) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(page);
  });
  const fail = function (e) {
    try { srv.close(); } catch (err) { }
    done({ error: String((e && e.message) || e) });
  };
  srv.on('error', fail);
  srv.listen(0, '127.0.0.1', function () {
    const url = 'http://127.0.0.1:' + srv.address().port + '/probe.html';
    win.webContents.executeJavaScript(
      'window.__InfinityShell.open(' + JSON.stringify(url) + ',"current"); true'
    ).then(function () {
      setTimeout(function () {
        win.webContents.executeJavaScript(
          '(function(){var w=document.querySelector("webview");var st=window.__InfinityShell.state;' +
          'var t=st.tabs.filter(function(x){return x.id===st.activeTab;})[0]||{};' +
          'return {webviews:document.querySelectorAll("webview").length,' +
          'url:(w&&w.getURL)?w.getURL():"",title:(w&&w.getTitle)?w.getTitle():"",' +
          'kind:t.kind||"",tabUrl:t.url||"",body:((w&&w.executeJavaScript)?"guest":"none")};})()'
        ).then(function (state) {
          /* 地址栏里不是网址的输入必须变成真搜索，而不是一张"演示模式"卡片。 */
          win.webContents.executeJavaScript(
            'window.__InfinityShell.open("probe search query","current");' +
            '(function(){var st=window.__InfinityShell.state;' +
            'var t=st.tabs.filter(function(x){return x.id===st.activeTab;})[0]||{};' +
            'return {url:t.url||"",kind:t.kind||"",query:t.query||""};})()'
          ).then(function (search) {
            state.search = search;
            try { srv.close(); } catch (err) { }
            done(state);
          }).catch(function (e) {
            state.search = { error: String((e && e.message) || e) };
            try { srv.close(); } catch (err) { }
            done(state);
          });
        }).catch(fail);
      }, 2500);
    }).catch(fail);
  });
}

/* INFINITY_SHELL_PROBE_GUEST_DL answers the question a "built-in download
 * manager" has to answer: does a download started inside a real web page reach
 * our panel, or only the one typed into it by hand? The page is served from
 * loopback with Content-Disposition: attachment, the guest clicks its own link,
 * and the panel is read afterwards. */
function probeGuestDownload(done) {
  const http = require('node:http');
  const body = Buffer.alloc(2 * 1024 * 1024, 7);
  const page = '<!doctype html><meta charset="utf-8"><title>Guest Download</title>' +
    '<a id="dl" href="/file.bin">download the file</a>';
  const srv = http.createServer(function (req, res) {
    if (req.url.indexOf('/file.bin') === 0) {
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(body.length),
        'content-disposition': 'attachment; filename="guest.bin"'
      });
      res.end(body);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(page);
  });
  const fail = function (e) {
    try { srv.close(); } catch (err) { }
    done({ error: String((e && e.message) || e) });
  };
  srv.on('error', fail);
  srv.listen(0, '127.0.0.1', function () {
    const url = 'http://127.0.0.1:' + srv.address().port + '/page.html';
    /* 上一轮探针留下的队列项会让「刚点的这一下进了面板吗」这个断言失去意义，
     * 所以先把队列清空再点。 */
    win.webContents.executeJavaScript(
      '(function(){var st=window.__InfinityShell.downloads.state;' +
      '(st.items||[]).slice().forEach(function(i){window.__InfinityShell.downloads.command("remove",{id:i.id});});' +
      'return (st.items||[]).length;})()'
    ).then(function () {
      win.webContents.executeJavaScript(
        'window.__InfinityShell.open(' + JSON.stringify(url) + ',"current"); true'
      ).then(function () {
      setTimeout(function () {
        win.webContents.executeJavaScript(
          '(function(){var w=document.querySelector("webview");' +
          'if(!w||!w.executeJavaScript) return "no guest";' +
          'w.executeJavaScript("document.getElementById(\'dl\').click(); true");' +
          'return "clicked " + (w.getURL?w.getURL():"");})()'
        ).then(function (clicked) {
          setTimeout(function () {
            win.webContents.executeJavaScript(
              '(function(){var st=window.__InfinityShell.downloads.state;' +
              'var p=document.getElementById("dlpanel");' +
              'return {items:(st.items||[]).length,' +
              'names:(st.items||[]).map(function(i){return i.name;}),' +
              'bytes:(st.items||[]).map(function(i){return i.received;}),' +
              'text:p?String(p.textContent||"").slice(0,200):""};})()'
            ).then(function (state) {
              state.clicked = clicked;
              /* 面板说有，磁盘上也得真有，否则「下载完成」只是一行字。 */
              try {
                const fsx = require('node:fs');
                const target = path.join(app.getPath('downloads'), 'InfinityViewer', 'guest.bin');
                state.file = target;
                state.onDisk = fsx.existsSync(target) ? fsx.statSync(target).size : -1;
              } catch (err) { state.onDisk = -2; }
              try { srv.close(); } catch (err) { }
              done(state);
            }).catch(fail);
          }, 4000);
        }).catch(fail);
      }, 2500);
    }).catch(fail);
    }).catch(fail);
  });
}

/* INFINITY_SHELL_PROBE_APPS proves an app card opens the real product: the page
 * asks the host for the product, the host starts that product's own UI service,
 * and the tab ends up on http://127.0.0.1:<port>/ with a guest actually loading
 * it. A static sample page would pass none of these. */
function probeApps(done) {
  const app = 'int';
  const js = 'window.__InfinityShell.open("inc://toolbox","current"); true';
  win.webContents.executeJavaScript(js).then(function () {
    const deadline = Date.now() + 30000;
    const step = function () {
      const read = 'window.__InfinityShell.state.appUrls[' + JSON.stringify(app) + '] || ""';
      win.webContents.executeJavaScript(read).then(function (url) {
        if (!url && Date.now() < deadline) { setTimeout(step, 500); return; }
        win.webContents.executeJavaScript(
          '(function(){var s=window.__InfinityShell.state;' +
          'var t=s.tabs.filter(function(x){return x.id===s.activeTab;})[0]||{};' +
          'return {url:' + JSON.stringify(url) + ',' +
          'tabUrl:t.url||"",tabKind:t.kind||"",' +
          'pending:!!s.appPending[' + JSON.stringify(app) + '],' +
          'error:s.appErrors[' + JSON.stringify(app) + ']||"",' +
          'webviews:document.querySelectorAll("webview").length};})()'
        ).then(function (state) {
          state.app = app;
          state.hostUrl = productUrls[app] || '';
          state.procAlive = !!productProcs[app];
          done(state);
        }).catch(function (e) { done({ error: String((e && e.message) || e) }); });
      }).catch(function (e) { done({ error: String((e && e.message) || e) }); });
    };
    step();
  }).catch(function (e) { done({ error: String((e && e.message) || e) }); });
}

/* INFINITY_SHELL_PROBE_DEVTOOLS sends the real bridge message the F12 key
 * sends and waits for the host's answer, so "开发者工具" is proven wired rather
 * than assumed. It asks the host to close, not open. */
function probeDevtools(done) {
  const run = function (js) { return win.webContents.executeJavaScript(js); };
  const started = Date.now();
  run('window.__InfinityShell.send("shell.devtools",{open:false,tab:"shell"}); true')
    .then(function () {
      const poll = function () {
        return run('JSON.stringify(window.__InfinityShell.state.devtoolsHost || null)').then(function (raw) {
          let parsed = null;
          try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { parsed = null; }
          if (parsed || Date.now() - started > 6000) {
            done({ reply: parsed, open: !!((parsed || {}).open), target: (parsed || {}).target || '', error: (parsed || {}).error || '' });
            return;
          }
          return new Promise(function (r) { setTimeout(r, 250); }).then(poll);
        });
      };
      return poll();
    })
    .catch(function (e) { done({ error: String((e && e.message) || e) }); });
}

/* INFINITY_SHELL_PROBE_INTERNAL checks the three internal pages that used to be
 * fake menu entries: history has to have recorded the pages the probe really
 * opened, a favorite has to survive a toggle, and a collection has to hold the
 * window's tabs and restore them. The pages are read through the DOM, so this
 * fails if the markup stops rendering even when the stores are fine. */
function probeInternal(done) {
  const http = require('node:http');
  const srv = http.createServer(function (req, res) {
    const name = req.url.indexOf('/b.html') === 0 ? 'Second Page' : 'First Page';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end('<!doctype html><meta charset="utf-8"><title>' + name + '</title><h1>' + name + '</h1>');
  });
  const fail = function (e) {
    try { srv.close(); } catch (err) { }
    done({ error: String((e && e.message) || e) });
  };
  srv.on('error', fail);
  srv.listen(0, '127.0.0.1', function () {
    const base = 'http://127.0.0.1:' + srv.address().port;
    const a = base + '/a.html';
    const b = base + '/b.html';
    const run = function (js) { return win.webContents.executeJavaScript(js); };
    run('window.__InfinityShell.history.clear(); window.__InfinityShell.open(' + JSON.stringify(a) + ',"current"); true')
      .then(function () { return new Promise(function (r) { setTimeout(r, 1600); }); })
      .then(function () { return run('window.__InfinityShell.open(' + JSON.stringify(b) + ',"current"); true'); })
      .then(function () { return new Promise(function (r) { setTimeout(r, 1600); }); })
      .then(function () {
        return run(
          '(function(){var s=window.__InfinityShell;' +
          'var h=s.history.list();' +
          'var favBefore=s.favorites.list().length;' +
          's.favorites.toggle(' + JSON.stringify(a) + ');' +
          'var favAfter=s.favorites.list().length;' +
          'var col=s.collections.save("probe collection");' +
          's.open("about:history","current");' +
          'return {history:h.map(function(x){return x.url;}),' +
          'favBefore:favBefore,favAfter:favAfter,' +
          'colId:col?col.id:"",colTabs:col?col.tabs.length:0,' +
          'collections:s.collections.list().length};})()'
        );
      })
      .then(function (state) { return new Promise(function (r) { setTimeout(function () { r(state); }, 700); }); })
      .then(function (state) {
        return run(
          '(function(){var root=document.querySelector(".view:not([hidden]) .internal");' +
          'return {page:!!root,' +
          'title:root?String((root.querySelector("h1")||{}).textContent||""):"",' +
          'rows:root?root.querySelectorAll(".internal-row").length:0,' +
          'count:root?String((root.querySelector(".internal-count")||{}).textContent||""):"",' +
          'body:root?String(root.textContent||"").slice(0,240):""};})()'
        ).then(function (dom) {
          state.historyPage = dom;
          return run('window.__InfinityShell.open("about:favorites","current"); true')
            .then(function () { return new Promise(function (r) { setTimeout(r, 600); }); })
            .then(function () {
              return run(
                '(function(){var root=document.querySelector(".view:not([hidden]) .internal");' +
                'return {page:!!root,rows:root?root.querySelectorAll(".internal-row").length:0};})()'
              );
            })
            .then(function (favDom) {
              state.favoritesPage = favDom;
              return run('window.__InfinityShell.open("about:collections","current"); true')
                .then(function () { return new Promise(function (r) { setTimeout(r, 600); }); })
                .then(function () {
                  return run(
                    '(function(){var root=document.querySelector(".view:not([hidden]) .internal");' +
                    'return {page:!!root,rows:root?root.querySelectorAll(".internal-row").length:0};})()'
                  );
                });
            })
            .then(function (colDom) {
              state.collectionsPage = colDom;
              /* The profile page is the one place the user can write something
               * down, so the probe types a name, saves it, and reads it back
               * from the store - a page that renders but saves nothing would
               * still pass a DOM-only check. */
              return run('window.__InfinityShell.open("about:profile","current"); true')
                .then(function () { return new Promise(function (r) { setTimeout(r, 600); }); })
                .then(function () {
                  return run(
                    '(function(){var inp=document.querySelector("#pfName");' +
                    'var btn=document.querySelector("#pfSave");' +
                    'if(inp){inp.value="Probe User";}' +
                    'if(btn){btn.click();}' +
                    'var root=document.querySelector(".view:not([hidden]) .internal");' +
                    'return {page:!!root,' +
                    'title:root?String((root.querySelector("h1")||{}).textContent||""):"",' +
                    'hasName:!!inp,hasSave:!!btn,' +
                    'facts:root?root.querySelectorAll(".profile-fact").length:0,' +
                    'saved:((window.__InfinityShell.settings.profile||{}).name)||""};})()'
                  );
                })
                .then(function (pfDom) {
                  state.profilePage = pfDom;
                  return run('window.__InfinityShell.open("about:extensions","current"); true')
                    .then(function () { return new Promise(function (r) { setTimeout(r, 600); }); })
                    .then(function () {
                      return run(
                        '(function(){var root=document.querySelector(".view:not([hidden]) .internal");' +
                        'return {page:!!root,' +
                        'title:root?String((root.querySelector("h1")||{}).textContent||""):"",' +
                        'rows:root?root.querySelectorAll(".internal-row").length:0,' +
                        'note:root?String((root.querySelector(".internal-empty")||{}).textContent||""):""};})()'
                      );
                    });
                })
                .then(function (extDom) {
                  state.extensionsPage = extDom;
                  try { srv.close(); } catch (err) { }
                  done(state);
                });
            });
        });
      })
      .catch(fail);
  });
}

/* INFINITY_SHELL_PROBE_DL proves the built-in download manager end to end:
 * the page's own toolbar button and URL box drive it, the frame crosses the
 * bridge, main.js queues the transfer, and a real file lands on disk. A value
 * of "1" starts a local range-capable server, so the check needs no network. */
function probeDownloadServer(slow, cb) {
  const http = require('node:http');
  const payload = Buffer.alloc((slow ? 24 : 6) * 1024 * 1024, 0x5a);
  const total = payload.length;
  /* The slow server streams in chunks so the probe can photograph a transfer
   * in flight: speed, ETA and the segment count only exist mid-download. */
  const stream = function (res, buf) {
    let at = 0;
    const tick = function () {
      if (at >= buf.length) { res.end(); return; }
      const end = Math.min(at + 64 * 1024, buf.length);
      res.write(buf.subarray(at, end));
      at = end;
      setTimeout(tick, 200);
    };
    tick();
  };
  const srv = http.createServer(function (req, res) {
    /* A HEAD reply must carry its headers and stop: streaming a body for it
     * leaves the client waiting for headers that never flush. */
    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'accept-ranges': 'bytes',
        'content-type': 'application/octet-stream',
        'content-length': total
      });
      res.end();
      return;
    }
    const range = req.headers.range;
    res.setHeader('accept-ranges', 'bytes');
    res.setHeader('content-type', 'application/octet-stream');
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const start = Number(m[1]);
      const end = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
      res.writeHead(206, {
        'content-range': 'bytes ' + start + '-' + end + '/' + total,
        'content-length': end - start + 1
      });
      if (slow) { stream(res, payload.subarray(start, end + 1)); }
      else { res.end(payload.subarray(start, end + 1)); }
      return;
    }
    res.writeHead(200, { 'content-length': total });
    if (slow) { stream(res, payload); }
    else { res.end(payload); }
  });
  srv.listen(0, '127.0.0.1', function () {
    cb(srv, 'http://127.0.0.1:' + srv.address().port + '/probe.bin');
  });
}

function probeDownload(url, done) {
  const js = '(function(){' +
    'var b=document.getElementById("btn-downloads");if(b)b.click();' +
    'var i=document.getElementById("dlUrl");if(i)i.value=' + JSON.stringify(url) + ';' +
    'var a=document.getElementById("dlAdd");if(a)a.click();' +
    'return true;})()';
  win.webContents.executeJavaScript(js).catch(function () { });
  setTimeout(function () {
    win.webContents.executeJavaScript(
      '({open:(document.getElementById("dlpanel")||{}).hidden===false,' +
      'items:document.querySelectorAll(".dl-item").length,' +
      'text:((document.getElementById("dlList")||{}).innerText||"").slice(0,200),' +
      'dir:((document.getElementById("dlDir")||{}).textContent||""),' +
      'badge:((document.getElementById("dlBadge")||{}).textContent||"")})'
    ).then(function (state) { done(state); }).catch(function (e) {
      done({ error: String(e && e.message) });
    });
  }, 3000);
}

async function boot() {
  const base = prefixFromName();
  const wantsAdmin = process.argv.some(function (a) { return a === '--admin'; });
  const prefix = wantsAdmin ? (ADMIN_OF[base] || base) : base;
  const meta = APPS[base] || APPS.inc;

  const server = findServer(prefix);
  if (!server) {
    showFatal(meta, '找不到同目录下的 ' + prefix + '_cli.exe，无法启动界面服务。');
    return;
  }

  /* The preferred port, or the next free one if something already holds it.
   * The chosen port is passed through so the window knows where to look. */
  const port = await pickPort(meta.port);

  /* --serve-ui asks the program for its interface and nothing else. */
  serverProc = spawn(server, ['--serve-ui', '--port=' + port], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  const proc = serverProc;
  serverProc.stdout.on('data', function () { });
  serverProc.stderr.on('data', function () { });
  serverProc.on('exit', function () { if (serverProc === proc) serverProc = null; });

  const up = await waitForPort(port, 30000, function () { return serverProc === proc; });
  if (!up) {
    shutdown();
    showFatal(meta, '界面服务未能在 30 秒内就绪（端口 ' + port + '）。');
    return;
  }

  appPort = port;
  serveChrome();
  /* ?render=iframe tells the chrome to embed the application in a frame
   * instead of asking a native host to position a content region. */
  shellUrl = CHROME_ORIGIN + 'index.html?render=iframe&url=' +
    encodeURIComponent('http://127.0.0.1:' + port + '/');
  /* A probe may need the chrome in a particular state (the downloads panel
   * open, for instance) without any host support of its own. */
  if (process.env.INFINITY_SHELL_PROBE_QUERY) {
    shellUrl += '&' + String(process.env.INFINITY_SHELL_PROBE_QUERY).replace(/^[&?]/, '');
  }
  ipcMain.on('shell:frame', function (_e, frame) { shellFrame(frame); });
  watchDownloads();
  downloadManager();

  Menu.setApplicationMenu(null);
  win = new BrowserWindow(windowOptions(meta));
  guardWindow(win, port);
  win.loadURL(shellUrl);
  win.on('closed', function () { win = null; shutdown(); });
  /* INFINITY_SHELL_PROBE=1 prints what the display actually looks like and
   * exits, so a packaging check can prove the window renders at the monitor's
   * native scale (a 150% desktop must report devicePixelRatio 1.5) instead of
   * being bitmap-stretched. */
  if (process.env.INFINITY_SHELL_PROBE) {
    win.webContents.once('did-finish-load', function () {
      /* The shipped window boots on the local Infinity Cloud page, so the new
       * tab page is only ever one click away. INFINITY_SHELL_PROBE_NTP opens
       * it before the snapshot, otherwise the footer can never be verified
       * end to end (the snapshot would report an empty .ntp set). */
      const probeNtp = process.env.INFINITY_SHELL_PROBE_NTP ? '1' : '0';
      /* The menu prints accelerators, so the probe can press them: a printed
       * shortcut that no branch handles is a promise the chrome breaks. */
      const probeKeys = process.env.INFINITY_SHELL_PROBE_KEYS ? '1' : '0';
      win.webContents.executeJavaScript(
        /* The inventory comes back over the bridge, so the snapshot waits for
         * it instead of racing the host and reporting an empty object. */
        '(async function(){await new Promise(function(r){setTimeout(r,1500);});' +
        /* Keys first, then the new-tab page: Ctrl+H navigates the active tab,
         * and doing that after opening the NTP would leave no .ntp to read. */
        'var keyProbe={};' +
        'if ("' + probeKeys + '" === "1") {' +
        'var fire=function(k,ctrl){document.dispatchEvent(new KeyboardEvent("keydown",' +
        '{key:k,ctrlKey:!!ctrl,bubbles:true,cancelable:true}));};' +
        'var dlp=function(){return (document.getElementById("dlpanel")||{}).hidden===false;};' +
        'var activeKind=function(){var st=window.__InfinityShell.state,act=null;' +
        'for(var i=0;i<st.tabs.length;i++){if(st.tabs[i].id===st.activeTab){act=st.tabs[i];}}' +
        'return act?act.kind:"";};' +
        'fire("j",true);await new Promise(function(r){setTimeout(r,180);});' +
        'keyProbe.ctrlJOpens=dlp();' +
        'fire("j",true);await new Promise(function(r){setTimeout(r,180);});' +
        'keyProbe.ctrlJCloses=!dlp();' +
        'fire("h",true);await new Promise(function(r){setTimeout(r,250);});' +
        'keyProbe.ctrlHKind=activeKind();' +
        'keyProbe.ctrlHHistory=keyProbe.ctrlHKind==="history";' +
        '}' +
        'if ("' + probeNtp + '" === "1" && window.__InfinityShell && window.__InfinityShell.open) {' +
        'try{window.__InfinityShell.open("about:home","newTab");}catch(e){}' +
        'await new Promise(function(r){setTimeout(r,600);});}' +
        'return ' +
        '({dpr:window.devicePixelRatio,cssW:window.innerWidth,cssH:window.innerHeight,' +
        'screenW:screen.width,screenH:screen.height,availH:screen.availHeight,' +
        'title:document.title,origin:location.origin,' +
        'lsKeys:Object.keys(localStorage).sort().join(","),' +
        'hasSession:!!localStorage.getItem("infinity-shell-session"),' +
        'tabCount:document.querySelectorAll(".tab").length,' +
        'apps:(window.__InfinityShell&&window.__InfinityShell.state.apps)||{},' +
          'audioElements:document.querySelectorAll("audio").length,' +
        'frameSrc:(document.querySelector("iframe")||{}).src||"",' +
        'dlOpen:(document.getElementById("dlpanel")||{}).hidden===false,' +
        'dlItems:document.querySelectorAll(".dl-item").length,' +
        'dlText:((document.getElementById("dlList")||{}).innerText||"").slice(0,160),' +
        'dlBadge:((document.getElementById("dlBadge")||{}).textContent||""),' +
        /* The chrome has to tell the truth about itself: the menu prints its
         * version, the host pill prints a translated state, and the new-tab
         * footer used to call the shipped build a demo. */
        'menuVersion:((document.getElementById("menuVersion")||{}).textContent||""),' +
        'hostPill:((document.getElementById("menuHostPill")||{}).textContent||""),' +
        'ntpFooter:[].map.call(document.querySelectorAll(".ntp-foot-text"),function(e){return e.textContent;}).join("|"),' +
        'ntpNodes:document.querySelectorAll(".ntp").length,' +
        'ntpFootNodes:document.querySelectorAll(".ntp-foot").length,' +
        'viewClasses:[].map.call(document.querySelectorAll("#views > *"),function(e){return e.className;}).join("|"),' +
        'keyProbe:keyProbe,' +
        'bodyText:(document.body.innerText||"").slice(0,80)});})()'
      ).catch(function (err) {
        /* A probe that throws must still end: a hung hidden window is worse
         * than a failed assertion, and the caller only sees a timeout. */
        try {
          fs.writeFileSync((process.env.INFINITY_SHELL_PROBE_FILE || 'probe.err') + '.err',
            String((err && err.stack) || err), 'utf8');
        } catch (_) {}
        shutdown(); app.quit();
        return null;
      }).then(function (info) {
        if (!info) { return; }
        info.scaleFactor = screen.getPrimaryDisplay().scaleFactor;
        info.bounds = win.getBounds();
        info.contentSize = win.getContentSize();
        /* A GUI process on Windows has no console to print to, so the probe
         * lands in a file; the caller names it, and the default sits in temp. */
        const probeFile = process.env.INFINITY_SHELL_PROBE_FILE ||
          path.join(require('node:os').tmpdir(), 'infinity-shell-probe.json');
        const writeProbe = function () {
          fs.writeFileSync(probeFile, JSON.stringify(info, null, 2), 'utf8');
        };
        writeProbe();

        /* A screen grab proves what the window looks like; a rect grab of the
         * desktop proves only which window happened to be on top, so the page
         * is captured from inside the renderer. did-finish-load is not the
         * same moment as first paint: capturing here returns an empty image,
         * so the grab waits for a frame and retries rather than writing a
         * zero-byte file. */
        const finishProbe = function () {
          const png = process.env.INFINITY_SHELL_PROBE_PNG;
          if (!png) { shutdown(); app.quit(); return; }
          let attempt = 0;
          const grab = function () {
            attempt++;
            win.webContents.capturePage().then(function (image) {
              const buf = image.toPNG();
              if (buf.length > 0 || attempt >= 12) {
                fs.writeFileSync(png, buf);
                shutdown();
                app.quit();
                return;
              }
              setTimeout(grab, 400);
            }).catch(function () {
              if (attempt >= 12) { shutdown(); app.quit(); return; }
              setTimeout(grab, 400);
            });
          };
          /* A page that has just brought up its own HTTP server can paint a
           * little later than the load event; the grab waits and retries. */
          /* No win.show(): a probe window stays off the user's screen. */
          setTimeout(grab, 1500);
        };

        /* The title-bar buttons go through the real bridge - page, preload,
         * ipc, main, window - so this proves the wiring instead of assuming
         * it. The states are recorded after each command. */
        /* The download probe drives the real toolbar, so it also proves the
         * panel is wired to the host rather than only present in the markup. */
        if (process.env.INFINITY_SHELL_PROBE_APPS) {
          probeApps(function (state) {
            info.apps = state;
            writeProbe();
            finishProbe();
          });
          return;
        }

        /* The devtools probe only closes, never opens: a detached inspector is
         * a real window, and the one rule that never bends is that automation
         * must not put windows on the user's screen. Closing still crosses the
         * whole bridge, so it proves the wiring. */
        if (process.env.INFINITY_SHELL_PROBE_DEVTOOLS) {
          probeDevtools(function (state) {
            info.devtools = state;
            writeProbe();
            finishProbe();
          });
          return;
        }

        if (process.env.INFINITY_SHELL_PROBE_INTERNAL) {
          probeInternal(function (state) {
            info.internal = state;
            writeProbe();
            finishProbe();
          });
          return;
        }

        if (process.env.INFINITY_SHELL_PROBE_GUEST_DL) {
          probeGuestDownload(function (state) {
            info.guestDownload = state;
            writeProbe();
            finishProbe();
          });
          return;
        }

        if (process.env.INFINITY_SHELL_PROBE_WEB) {
          probeWebPage(function (state) {
            info.web = state;
            writeProbe();
            finishProbe();
          });
          return;
        }

        const dlTarget = process.env.INFINITY_SHELL_PROBE_DL;
        if (dlTarget) {
          const startWith = function (url) {
            probeDownload(url, function (state) {
              info.download = state;
              writeProbe();
              finishProbe();
            });
          };
          if (dlTarget === '1' || dlTarget === 'slow') {
            probeDownloadServer(dlTarget === 'slow', function (_srv, url) {
              info.downloadServer = url;
              startWith(url);
            });
          } else {
            startWith(dlTarget);
          }
          return;
        }

        if (process.env.INFINITY_SHELL_PROBE_ACTIONS) {
          probeWindowActions(function (steps) {
            info.windowActions = steps;
            writeProbe();
            finishProbe();
          });
          return;
        }
        finishProbe();
      }).catch(function (e) {
        const errFile = process.env.INFINITY_SHELL_PROBE_FILE ||
          path.join(require('node:os').tmpdir(), 'infinity-shell-probe.json');
        fs.writeFileSync(errFile, JSON.stringify({ error: String(e && e.message) }, null, 2), 'utf8');
        shutdown();
        app.quit();
      });
    });
  }
}

/* Stop the server. Called when the window closes and when the app quits, so
 * a closed window never leaves an orphaned _cli.exe holding a port. */
function shutdown() {
  if (serverProc) { try { serverProc.kill(); } catch (e) { } serverProc = null; }
  for (const k of Object.keys(productProcs)) {
    try { productProcs[k].kill(); } catch (e) { }
    delete productProcs[k];
    delete productUrls[k];
  }
}

app.on('window-all-closed', function () { shutdown(); app.quit(); });
app.on('before-quit', shutdown);
app.whenReady().then(boot);
