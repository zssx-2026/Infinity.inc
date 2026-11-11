/*
 * preload.js - the only bridge between the chrome page and the window.
 *
 * The page in resources/app/ui is the Edge-like shell: tabs, address bar,
 * animations, session restore, the play zone. It speaks exactly one
 * protocol - infinity-shell frames - and this file is the only thing it can
 * reach. No Node, no ipcRenderer handle, no file system: a mistake in the
 * interface cannot become a mistake in the program.
 *
 * The renderer is sandboxed, so the page cannot frame the application's
 * http:// page from a file:// document; the chrome is served over loopback
 * by main.js for that reason, and both origins stay on 127.0.0.1.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__INFINITY_HOST__', {
  /* One function, one direction: the page posts a frame, main.js answers. */
  postMessage: function (frame) { ipcRenderer.send('shell:frame', frame); }
});

/* Host frames come back the way the page's built-in demo host delivers them:
 * a window message, which shell.js already listens for. */
ipcRenderer.on('shell:host-frame', function (_event, frame) {
  try { window.postMessage(frame, '*'); } catch (e) { }
});
