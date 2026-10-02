#!/usr/bin/env node
/*
 * main.js - the entry point.
 *
 *   inc                 open the TUI
 *   inc cli             open the CLI
 *   inc tui             open the TUI
 *   inc <command> ...   run one CLI command and exit
 *
 * Infinity.Inc also ships the same program under eight names, and then the
 * name decides before any argument is read:
 *
 *   inc_cli  inc_tui  inc_gui  inc_launcher
 *   inx_cli  inx_tui  inx_gui  inx_launcher
 *
 * Both routes keep their own settings file so a CLI session and a TUI
 * session never overwrite each other's idea of how things should look.
 */
import { runCli } from './cli.js';
import { runTui } from './tui/tui.js';
import { runIfm } from './tui/ifm.js';
import { ensureDirs, PATHS } from './core/config.js';
import { ensureTools } from './net/bootstrap.js';
import { runInstaller, repair, uninstall } from './installer.js';
import { detect } from './core/mode.js';
import { runLauncher } from './core/launcher.js';
import { runGui } from './gui/server.js';

const VERSION = 'v1.0pre2';

async function main() {
  ensureDirs();
  const args = process.argv.slice(2);
  const first = (args[0] || '').toLowerCase();

  /*
   * A few flags belong to the program rather than to any one face, so they
   * are answered before the executable's own name is consulted. --serve-ui is
   * the one the Electron shell uses: it starts the local UI and nothing else,
   * whatever the file is called.
   */
  if (first === '--version' || first === '-v') { console.log('Infinity Cloud [' + VERSION + ']'); return; }
  if (first === 'help' || first === '--help' || first === '-h') { await runCli(['help']); return; }
  if (first === '--paths') { console.log(JSON.stringify(PATHS, null, 2)); return; }
  if (first === '--serve-ui') {
    const r = await runGui({});
    if (!r.ok) { console.error('cannot start the UI: ' + (r.error || 'unknown')); process.exitCode = 1; return; }
    return new Promise(function () { });
  }

  /* Otherwise the executable's own name comes first: a copy called inc_gui
   * is the graphical face no matter what it was handed on the command line. */
  const me = detect();
  if (me.admin) process.env.INC_ADMIN = '1';

  if (me.mode === 'launcher') {
    const r = await runLauncher({ title: 'Infinity Cloud', prefix: me.prefix });
    if (!r.ok) console.error(r.error);
    return;
  }
  if (me.mode === 'gui') {
    const r = await runGui({});
    if (!r.ok) { console.error('cannot start the UI: ' + (r.error || 'unknown')); process.exitCode = 1; return; }
    /* The server is what keeps the process alive; main() must not resolve,
     * because the exit handler below turns a resolved main into exit(0). */
    return new Promise(function () { });
  }
  if (me.mode === 'tui') { await runTui(); return; }
  if (me.mode === 'cli') { await runCli(args); return; }

  if (first === 'ifm') { await runIfm(null); return; }
  if (first === 'cli') { await runCli(); return; }
  if (first === 'tui') { await runTui(); return; }
  if (first === 'gui') {
    const r = await runGui({});
    if (!r.ok) { process.exitCode = 1; return; }
    return new Promise(function () { });
  }

  if (first === 'setup') { await ensureTools(process.cwd()); return; }
  if (first === 'install') { await runInstaller(); return; }
  if (first === 'repair') {
    const r = repair(process.cwd());
    console.log(r.ok ? 'All files match their recorded hashes.' : 'Damaged: ' + r.bad.join(', '));
    return;
  }
  if (first === 'uninstall') {
    console.log('Removed ' + uninstall(process.cwd()) + ' files.');
    return;
  }

  if (args.length > 0) { await runCli(args); return; }
  await runTui();
}

main().then(function () { process.exit(0); }, function (e) {
  console.error(e && e.stack ? e.stack : String(e));
  process.exit(1);
});
