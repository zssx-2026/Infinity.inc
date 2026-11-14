/*
 * main.js - the Electron window for InfinityServer.
 *
 * It is deliberately a shell and nothing more: it starts the local service in
 * this process, waits for the port to answer, and points a window at it. All
 * of the machine - cache, billing, scheduler - lives in src/core and
 * src/server.js, so the window can be closed, reopened, or replaced without
 * anything being recomputed differently.
 *
 * Nothing here touches the network, and every child is spawned with
 * windowsHide so no console window appears.
 */

import { app, BrowserWindow } from 'electron';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { start } from './server.js';

const PORT_BASE = 7711;

/* A thrown error must never become a native dialog. Electron's default handler
 * for an uncaught exception or an unhandled rejection is a modal error box, and
 * a window that pops up to say the program failed is worse than a silent line
 * in a log: nobody is at the machine, and the dialog blocks the process. */
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
let held = null;
let win = null;

function isAlive(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port: port });
    sock.setTimeout(600);
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
  });
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

async function pickPort(base) {
  for (let p = base; p < base + 64; p++) {
    if (!(await isAlive(p)) && (await portFree(p))) return p;
  }
  return 0;
}

async function waitForPort(port, ms) {
  const deadline = Date.now() + (ms || 30000);
  while (Date.now() < deadline) {
    if (await isAlive(port)) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function boot() {
  const port = await pickPort(PORT_BASE);
  if (!port) throw new Error('no free port in range');
  held = await start({ port: port });
  if (!(await waitForPort(held.port, 30000))) {
    throw new Error('service did not answer on port ' + held.port);
  }
  return held.port;
}

app.whenReady().then(async () => {
  try {
    const port = await boot();
    win = new BrowserWindow({
      width: 1180,
      height: 820,
      minWidth: 900,
      minHeight: 600,
      show: false,
      backgroundColor: '#0b1020',
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    });
    win.once('ready-to-show', () => win.show());
    await win.loadURL('http://127.0.0.1:' + port + '/');
  } catch (e) {
    console.error('InfinityServer failed to start: ' + ((e && e.message) || e));
    app.quit();
  }
});

app.on('window-all-closed', async () => {
  if (held && held.close) await held.close();
  app.quit();
});
