/*
 * main.js - the Electron window for the studio installer.
 *
 * Same shape as every other shell in this workspace: start the local service,
 * wait for the port, point a window at it, and never show a console. The
 * installer logic lives in src/planner.js and src/server.js so it can be
 * tested without a window at all.
 */

import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from './server.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PORT_BASE = 7721;

let held = null;

function isAlive(port) {
  return new Promise((resolve) => {
    const net = require('node:net');
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
    const win = new BrowserWindow({
      width: 1080, height: 720, minWidth: 900, minHeight: 600,
      show: false, backgroundColor: '#1b1b1f', autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    });
    win.once('ready-to-show', () => win.show());
    await win.loadURL('http://127.0.0.1:' + held.port + '/');
  } catch (e) {
    console.error('InfinityStudio failed to start: ' + ((e && e.message) || e));
    app.quit();
  }
});

app.on('window-all-closed', async () => {
  if (held && held.close) await held.close();
  app.quit();
});
