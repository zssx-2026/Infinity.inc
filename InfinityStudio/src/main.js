/*
 * main.js - the Electron window for the studio installer.
 *
 * Same shape as every other shell in this workspace: start the local service,
 * wait for the port, point a window at it, and never show a console. The
 * installer logic lives in src/planner.js and src/server.js so it can be
 * tested without a window at all.
 *
 * Nothing in here is allowed to raise a native dialog. An unhandled rejection
 * in the main process used to take the whole app down mid-download, and the
 * crash reporter's dialog is exactly the window this product must never show,
 * so rejections and uncaught exceptions are written to a log and the app stays
 * up. The renderer going away is logged the same way instead of being allowed
 * to close the window and quit while an install is still running.
 */

import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from './server.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PORT_BASE = 7721;

let held = null;
let win = null;

function logLine(what, detail) {
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'studio.log'), new Date().toISOString() + ' ' + what + ' ' + detail + '\n', 'utf8');
  } catch (error) {
    /* A log that cannot be written must not become the next failure. */
  }
}

process.on('unhandledRejection', (reason) => {
  logLine('unhandledRejection', String((reason && reason.stack) || reason));
});

process.on('uncaughtException', (error) => {
  logLine('uncaughtException', String((error && error.stack) || error));
});

function isAlive(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port: port });
    s.setTimeout(600);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    s.once('timeout', () => { s.destroy(); resolve(false); });
  });
}

app.whenReady().then(async () => {
  try {
    let port = 0;
    for (let p = PORT_BASE; p < PORT_BASE + 64; p++) {
      if (!(await isAlive(p))) { port = p; break; }
    }
    held = await start({ root: ROOT, port: port });
    win = new BrowserWindow({
      width: 1080, height: 720, minWidth: 900, minHeight: 600,
      show: false, backgroundColor: '#1b1b1f', autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    });
    win.webContents.on('render-process-gone', (event, details) => {
      logLine('render-process-gone', JSON.stringify(details));
    });
    win.once('ready-to-show', () => win.show());
    await win.loadURL('http://127.0.0.1:' + held.port + '/');
  } catch (e) {
    logLine('boot-failed', String((e && e.stack) || e));
    app.quit();
  }
});

app.on('window-all-closed', async () => {
  if (held && held.close) await held.close();
  app.quit();
});
