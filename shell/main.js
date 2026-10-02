/*
 * main.js - the Infinity.Inc Electron shell.
 *
 * One shell, three applications. The window is the whole job: the program
 * already knows how to serve its own interface on loopback, so the shell
 * starts that server, waits for the port to answer, and points a window at
 * it. Nothing about the interface is duplicated here, which is what keeps
 * the window and the terminal showing the same program.
 *
 * Which application to open is read from the executable's own name, exactly
 * as the command-line faces do it:
 *
 *   inc_gui.exe   inx_gui.exe   ->  Infinity Cloud
 *   ifm_gui.exe   ifmx_gui.exe  ->  Infinity File Manager
 *   ipm_gui.exe   ipmx_gui.exe  ->  InfinityPackageManager
 *
 * The server executable is expected beside the shell, which is how the
 * installer lays the directory out.
 */
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { spawn } = require('node:child_process');

const APPS = {
  inc: { name: 'Infinity Cloud', port: 7621 },
  ifm: { name: 'Infinity File Manager', port: 7623 },
  ipm: { name: 'InfinityPackageManager', port: 7632 }
};

/* The shell's own file name decides the application, so one binary can be
 * renamed into any of the three without a rebuild. */
function prefixFromName() {
  const base = path.basename(process.execPath).replace(/\.exe$/i, '').toLowerCase();
  const m = /^(inc|ifm|ipm)x?_gui$/.exec(base);
  if (m) return m[1];
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

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise(function (resolve) {
    const attempt = function () {
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

async function boot() {
  const prefix = prefixFromName();
  const meta = APPS[prefix] || APPS.inc;

  const server = findServer(prefix);
  if (!server) {
    dialog.showErrorBox(meta.name, '找不到 ' + prefix + '_cli，无法启动界面。请重新安装。');
    app.quit();
    return;
  }

  /* --serve-ui asks the program for its interface and nothing else, which is
   * the same server the inc_gui face would have started on its own. */
  serverProc = spawn(server, ['--serve-ui'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  serverProc.stdout.on('data', function () { });
  serverProc.stderr.on('data', function () { });
  serverProc.on('exit', function () { serverProc = null; });

  const up = await waitForPort(meta.port, 30000);
  if (!up) {
    dialog.showErrorBox(meta.name, '界面服务未能在 30 秒内就绪。');
    app.quit();
    return;
  }

  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    title: meta.name,
    backgroundColor: '#0e1116',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadURL('http://127.0.0.1:' + meta.port + '/');

  /* Links that leave the app open in the real browser rather than inside the
   * window, so the shell never becomes a browser with no address bar. */
  win.webContents.setWindowOpenHandler(function (d) { shell.openExternal(d.url); return { action: 'deny' }; });
  win.on('closed', function () { win = null; });
}

function shutdown() {
  if (serverProc) { try { serverProc.kill(); } catch (e) { } serverProc = null; }
}

app.on('window-all-closed', function () { shutdown(); app.quit(); });
app.on('before-quit', shutdown);
app.whenReady().then(boot);
