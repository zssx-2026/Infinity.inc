/*
 * main.js - the Infinity File Manager entry point.
 *
 * ifm                  the window
 * ifm mount            serve the cloud over WebDAV and map a drive letter
 * ifm unmount          stop that server and remove the mapping
 * ifm install          install for the current user
 * ifm repair           check every installed file against its recorded hash
 * ifm uninstall        remove it again
 *
 * A bare invocation opens the window, which is what a double click does and
 * what somebody who typed the name alone almost certainly wants.
 *
 * Infinity.Inc also ships the same program under six names, and then the
 * name decides before any argument is read:
 *
 *   ifm_cli  ifm_gui  ifm_launcher
 *   ifmx_cli ifmx_gui ifmx_launcher
 *
 * The launcher asks which face to open and hands over to a sibling; the
 * graphical face is a loopback server that stays alive on its own.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ensureDirs, PATHS, load } from './core/config.js';
import { GitHub, probeProxy } from './net/github.js';
import { Store } from './store/store.js';
import { DavServer } from './core/dav.js';
import { runInstaller, repair, uninstall } from './installer.js';
import { detect } from './core/mode.js';
import { runLauncher } from './core/launcher.js';
import { runGui } from './gui/server.js';

const VERSION = 'v1.0pre2';

/* Where a mount writes down what it started, so unmount can stop it. */
const MOUNT_FILE = path.join(PATHS.cache, 'mount.json');

function out(s) { process.stdout.write(s + String.fromCharCode(10)); }

function help() {
  out('Infinity File Manager [' + VERSION + ']  ·  Infinity.Inc');
  out('');
  out('  ifm                  open the file manager');
  out('  ifm mount            mount the cloud as a drive letter');
  out('  ifm unmount          remove that drive');
  out('  ifm install          install for the current user');
  out('  ifm repair           check every installed file');
  out('  ifm uninstall        remove it');
  out('  ifm --version        print the version');
}

function showPaths() {
  out(JSON.stringify({
    exe: process.execPath,
    cwd: process.cwd(),
    cache: PATHS.cache,
    trash: PATHS.trash,
    backup: PATHS.backup
  }, null, 2));
}

/*
 * Sign in the way the cloud client does: the token comes from the
 * environment first, so a script can drive a mount unattended, and only
 * then from the saved configuration.
 */
async function makeStore(cfg) {
  const token = process.env.IFM_TOKEN || process.env.INC_TOKEN ||
    process.env['gittoken_zssx-2026_1'] || process.env.EV_GH_TOKEN || process.env.GH_TOKEN || cfg.token || null;
  if (!token) throw new Error('no token: set IFM_TOKEN first');
  try { await probeProxy(); } catch (e) { }
  const gh = new GitHub(token);
  await gh.me();
  const store = new Store(gh, cfg, function () { });
  store.owner = gh.user.login;
  return store;
}

/* A size like 1TB, 500GB or 20MB, as bytes. */
function parseSize(text) {
  const m = /^([0-9.]+)\s*([a-zA-Z]*)$/.exec(String(text).trim());
  if (!m) return 1024 * 1024 * 1024 * 1024;
  const n = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  const table = { B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776, PB: 1125899906842624 };
  return Math.floor(n * (table[unit] || 1099511627776));
}

/* Read --name value and --name=value out of an argument list. */
function flag(args, name, fallback) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name && i + 1 < args.length) return args[i + 1];
    if (args[i].indexOf(name + '=') === 0) return args[i].slice(name.length + 1);
  }
  return fallback;
}

/*
 * Map a drive letter to a WebDAV URL.
 *
 * net use is the only way to do this without a driver. The server asks for
 * no credentials, so the connection is made as a guest and never prompts.
 */
async function mapDrive(letter, url) {
  if (process.platform !== 'win32') return { ok: false, error: 'drive letters are a Windows idea' };
  const { execFileSync } = await import('node:child_process');
  const target = letter.replace(':', '') + ':';
  try {
    execFileSync('net.exe', ['use', target, url, '/persistent:no'], { stdio: 'ignore', timeout: 30000 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message).slice(0, 120) };
  }
}

/*
 * mount.
 *
 * The WebDAV server runs inside this process and the process stays alive,
 * which is the simplest arrangement that works: Windows keeps the mapping
 * as long as the server answers. A detached daemon would need a service, a
 * log file and a way to be killed, and none of that buys anything here.
 */
async function mount(args) {
  const cfg = load('cli');
  const store = await makeStore(cfg);
  out('pulling manifest...');
  await store.pull();

  const port = parseInt(flag(args, '--port', '19780'), 10) || 19780;
  const letter = flag(args, '--drive', 'Z');
  const label = flag(args, '--label', 'Infinity Cloud');
  const size = parseSize(flag(args, '--size', '1TB'));

  const dav = new DavServer(store, { port: port, label: label, size: size });
  const url = await dav.start();
  out('serving ' + url);

  fs.writeFileSync(MOUNT_FILE, JSON.stringify({
    pid: process.pid, port: port, url: url, drive: letter
  }, null, 2), 'utf8');

  const map = await mapDrive(letter, url);
  if (map.ok) out('mapped ' + letter + ': to ' + url);
  else out('could not map ' + letter + ': ' + map.error);
  out('press ctrl+c to stop');

  const stop = async function () {
    try { await dav.stop(); } catch (e) { }
    try { fs.rmSync(MOUNT_FILE, { force: true }); } catch (e) { }
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

/* Stop the server a mount started, and drop the mapping it made. */
async function unmount() {
  if (!fs.existsSync(MOUNT_FILE)) { out('nothing is mounted'); return; }
  let info = {};
  try { info = JSON.parse(fs.readFileSync(MOUNT_FILE, 'utf8')); } catch (e) { }
  if (info.drive && process.platform === 'win32') {
    const { execFileSync } = await import('node:child_process');
    const letter = info.drive.replace(':', '') + ':';
    try {
      execFileSync('net.exe', ['use', letter, '/delete', '/y'], { stdio: 'ignore', timeout: 30000 });
      out('removed ' + letter);
    } catch (e) { out('could not remove ' + letter + ': ' + String(e.message).slice(0, 80)); }
  }
  if (info.pid) {
    try { process.kill(info.pid); out('stopped the server (pid ' + info.pid + ')'); }
    catch (e) { }
  }
  try { fs.rmSync(MOUNT_FILE, { force: true }); } catch (e) { }
}

async function main() {
  ensureDirs();
  const args = process.argv.slice(2);
  const first = args[0] || '';

  /*
   * --serve-ui belongs to the program rather than to any one face, so it is
   * answered before the executable's own name is consulted. It is what the
   * Electron shell asks for: the interface server and nothing else.
   */
  if (String(first).toLowerCase() === '--serve-ui') {
    const r = await runGui({});
    if (!r.ok) { process.stderr.write('cannot start the UI: ' + (r.error || 'unknown') + String.fromCharCode(10)); process.exitCode = 1; return; }
    return new Promise(function () { });
  }

  /* The executable's own name comes first: a copy called ifm_gui is the
   * graphical face no matter what it was handed on the command line. */
  const me = detect();
  if (me.admin) process.env.IFM_ADMIN = '1';

  if (me.mode === 'launcher') {
    const r = await runLauncher({ title: 'Infinity File Manager', prefix: me.prefix, admin: me.admin });
    if (!r.ok) process.stderr.write(r.error + String.fromCharCode(10));
    return;
  }
  if (me.mode === 'gui') {
    const r = await runGui({});
    if (!r.ok) { process.stderr.write('cannot start the UI: ' + (r.error || 'unknown') + String.fromCharCode(10)); process.exitCode = 1; return; }
    /* The server is what keeps the process alive; main() must not resolve,
     * or the promise chain below would turn a running UI into an exit. */
    return new Promise(function () { });
  }

  if (first === '--version' || first === '-v') { out('Infinity File Manager [' + VERSION + ']  ·  Infinity.Inc'); return; }
  if (first === '--paths') { showPaths(); return; }
  if (first === '--help' || first === '-h' || first === 'help') { help(); return; }

  if (first === 'install') { await runInstaller(); return; }
  if (first === 'repair') { await repair(args[1]); return; }
  if (first === 'uninstall') { await uninstall(); return; }
  if (first === 'mount') { await mount(args.slice(1)); return; }
  if (first === 'unmount') { await unmount(); return; }

  /*
   * The command-line face never opens a window: with nothing to do it prints
   * the usage, which is what a scripted caller wants.
   */
  if (me.mode === 'cli') { help(); return; }

  /* Anything else opens the window. */
  const r = await runGui({});
  if (!r.ok) { process.stderr.write('cannot start the UI: ' + (r.error || 'unknown') + String.fromCharCode(10)); process.exitCode = 1; return; }
  return new Promise(function () { });
}

main().catch(function (e) {
  process.stderr.write(String(e && e.message ? e.message : e) + String.fromCharCode(10));
  process.exit(1);
});

