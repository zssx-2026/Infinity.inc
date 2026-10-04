/*
 * preload.js - the only bridge between the window and the machine.
 *
 * The renderer is sandboxed and has no Node. It gets exactly three things:
 * a way to ask the engine a question, the application identity, and nothing
 * else. There is no general-purpose invoke, no module loader and no path
 * access, so a mistake in the interface cannot become a mistake in the
 * program.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('infinity', {
  /*
   * Ask the engine something. The method names are the ones the command
   * line uses, so the window and the terminal are the same program and
   * neither can drift from the other.
   */
  call: function (method, params) {
    return ipcRenderer.invoke('infinity:call', { method: String(method), params: params || {} });
  },

  /* Who this window is: the product, the version, where the engine sits. */
  info: function () { return ipcRenderer.invoke('infinity:info'); },

  /*
   * Subscribe to a stream. Only three channels exist, and the whitelist is
   * deliberate: a renderer that can name any channel can listen to traffic
   * meant for another window.
   */
  on: function (channel, handler) {
    const allowed = ['progress', 'log', 'task'];
    if (allowed.indexOf(channel) < 0) return function () { };
    const wrap = function (ev, payload) { handler(payload); };
    ipcRenderer.on('infinity:' + channel, wrap);
    return function () { ipcRenderer.removeListener('infinity:' + channel, wrap); };
  }
});
