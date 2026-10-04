/*
 * main.js - the Infinity.Inc Electron shell.
 *
 * One shell, five applications. The window is the whole job: the program
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
 *   ifm_gui.exe   ifmx_gui.exe  ->  Infinity File Manager      ifm_cli.exe   7623
 *   ipm_gui.exe   ipmx_gui.exe  ->  InfinityPackageManager     ipm_cli.exe   7632
 *   iim_gui.exe   iimx_gui.exe  ->  Infinity Installer Manager iim_cli.exe   7643
 *   int_gui.exe   intx_gui.exe  ->  Infinity Toolbox           int_cli.exe   7653
 *
 * The server executable is expected beside the shell, which is how the
 * installer lays the directory out.
 */
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { spawn } = require('node:child_process');

const APPS = {
  inc: { name: 'Infinity Cloud', port: 7621 },
  ifm: { name: 'Infinity File Manager', port: 7623 },
  ipm: { name: 'InfinityPackageManager', port: 7632 },
  iim: { name: 'Infinity Installer Manager', port: 7643 },
  int: { name: 'Infinity Toolbox', port: 7653 }
};

/* The ten window names, each mapped to the application it opens. The
 * administrator's copy has its own prefix, so the name on disk is not the
 * application name and must be translated before the port or the title is
 * looked up. */
const ADMIN_TO_BASE = {
  inc: 'inc', inx: 'inc',
  ifm: 'ifm', ifmx: 'ifm',
  ipm: 'ipm', ipmx: 'ipm',
  iim: 'iim', iimx: 'iim',
  int: 'int', intx: 'int'
};

/* The shell's own file name decides the application, so one binary can be
 * renamed into any of the ten names without a rebuild. */
function prefixFromName() {
  const base = path.basename(process.execPath).replace(/\.exe$/i, '').toLowerCase();
  /* inc's administrator twin is inx, not incx (cpp/tools/build.mjs owns the
   * administrator prefixes), so every name is listed. The capture is the name
   * on disk, which for an administrator copy is not the application name: it
   * is translated through the table, or the window would take the wrong title
   * and the wrong port. */
  const named = /^(inc|inx|ifm|ifmx|ipm|ipmx|iim|iimx|int|intx)_gui$/.exec(base);
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

function windowOptions(meta) {
  return {
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    title: meta.name,
    backgroundColor: '#0e1116',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  };
}

/* The window talks to a local process that holds the user's GitHub token, so
 * it must never leave 127.0.0.1. `will-navigate` blocks a link or script that
 * tries to steer the window somewhere else, and the window-open handler keeps
 * a `target=_blank` link from opening a second, unguarded window. Both are
 * attached to every window, the served one and the error one alike. */
function guardWindow(w, port) {
  const prefix = 'http://127.0.0.1:' + port + '/';
  w.webContents.on('will-navigate', function (e, target) {
    const local = target === prefix || target.indexOf(prefix) === 0;
    if (!local) e.preventDefault();
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
    '<title>' + escapeHtml(meta.name) + '</title><style>' +
    'html,body{margin:0;height:100%}' +
    'body{background:#0e1116;color:#e6edf3;display:flex;align-items:center;' +
    'justify-content:center;font-family:"Microsoft YaHei",system-ui,-apple-system,sans-serif}' +
    '.box{max-width:640px;padding:40px 48px;text-align:center}' +
    'h1{font-size:20px;font-weight:600;margin:0 0 16px}' +
    'p{font-size:14px;line-height:1.7;color:#9da7b3;margin:0 0 10px;word-break:break-all}' +
    '.hint{color:#6b7684;font-size:13px;margin-top:20px}' +
    '</style></head><body><div class="box">' +
    '<h1>' + escapeHtml(meta.name) + ' 无法启动</h1>' +
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

async function boot() {
  const prefix = prefixFromName();
  const meta = APPS[prefix] || APPS.inc;

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

  Menu.setApplicationMenu(null);
  win = new BrowserWindow(windowOptions(meta));
  guardWindow(win, port);
  win.loadURL('http://127.0.0.1:' + port + '/');
  win.on('closed', function () { win = null; shutdown(); });
}

/* Stop the server. Called when the window closes and when the app quits, so
 * a closed window never leaves an orphaned _cli.exe holding a port. */
function shutdown() {
  if (serverProc) { try { serverProc.kill(); } catch (e) { } serverProc = null; }
}

app.on('window-all-closed', function () { shutdown(); app.quit(); });
app.on('before-quit', shutdown);
app.whenReady().then(boot);
