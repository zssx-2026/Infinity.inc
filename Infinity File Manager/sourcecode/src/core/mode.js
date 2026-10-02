/*
 * mode.js - which face of the program am I?
 *
 * Infinity.Inc ships one program under several names, and the name is the
 * whole configuration:
 *
 *   ifm_cli  ifm_tui  ifm_gui  ifm_launcher        the user's copies
 *   ifmx_cli ifmx_tui ifmx_gui ifmx_launcher       the administrator's copies
 *
 * The eight files are identical; only the file name carries meaning. Reading
 * it here means the build stays a single artifact and the behaviour lives in
 * one place instead of eight.
 *
 * When the program is started some other way - `node src/main.js`, or a name
 * that matches nothing - mode is null and the caller keeps its old default.
 */
import path from 'node:path';

const PREFIX = {
  ifm: { app: 'ifm', admin: false },
  ifmx: { app: 'ifm', admin: true }
};
const MODES = ['cli', 'tui', 'gui', 'launcher'];

export function detect() {
  const base = path.basename(process.execPath).replace(/\.exe$/i, '').toLowerCase();
  const cut = base.indexOf('_');
  if (cut < 0) return { mode: null, admin: false, app: null, prefix: null };
  const prefix = base.slice(0, cut);
  const mode = base.slice(cut + 1);
  const p = PREFIX[prefix];
  if (!p || MODES.indexOf(mode) < 0) return { mode: null, admin: false, app: null, prefix: null };
  return { mode, admin: p.admin, app: p.app, prefix };
}

/* Start a URL in whatever the desktop uses to open links. Failure is
 * deliberately silent: a headless machine still has a working server. */
export function openBrowser(url) {
  const cmd = process.platform === 'win32' ? 'cmd'
    : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  import('node:child_process').then(function (cp) {
    try { cp.execFile(cmd, args, { windowsHide: true }); } catch (e) { /* headless */ }
  });
}

export { MODES, PREFIX };
