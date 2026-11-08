/*
 * verify-contract.mjs - re-run the shell / Infinity File Manager contract
 * checks without building anything.
 *
 * This is the light verification for the shell fixes: it reads the sources and
 * the artifacts already on disk, and never starts a window, a server or a
 * compiler. Run it from anywhere:
 *
 *   node shell/verify-contract.mjs
 *
 * It exits non-zero if any check fails, and prints one line per check.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* --- 3. shell/main.js is the --serve-ui shell, and its port table matches cpp --- */
const main = read('shell/main.js');
ok(main.indexOf('--serve-ui') >= 0, 'main.js spawns --serve-ui');
ok(main.indexOf('--ipc') < 0, 'main.js has no --ipc');
ok(main.indexOf("path.join(__dirname, 'app'") < 0, 'main.js loads no local app/ page');
ok(main.indexOf('preload') < 0, 'main.js needs no preload');

const ap = {};
for (const m of main.matchAll(/^\s*(inc|ipm):\s*\{ name: '([^']+)', port: (\d+) \}/gm)) ap[m[1]] = Number(m[3]);
const cppPorts = {};
for (const app of ['inc', 'ipm']) {
  const m = /int uiPort = (\d+);/.exec(read('cpp/apps/' + app + '/main.cpp'));
  cppPorts[app] = m ? Number(m[1]) : null;
}
ok(Object.keys(ap).length === 2, 'shell knows ' + Object.keys(ap).length + ' applications: ' + Object.keys(ap).join(','));
for (const k of Object.keys(cppPorts)) ok(ap[k] === cppPorts[k], 'port ' + k + ' shell=' + ap[k] + ' cpp=' + cppPorts[k]);

const expected = { inc_gui: 'inc', inx_gui: 'inc', ipm_gui: 'ipm', ipmx_gui: 'ipm' };
const tbl = {};
const blk = /const ADMIN_TO_BASE = \{([\s\S]*?)\};/.exec(main);
if (blk) for (const m of blk[1].matchAll(/(\w+):\s*'(\w+)'/g)) tbl[m[1]] = m[2];
ok(Object.keys(tbl).length === 4, 'ADMIN_TO_BASE has 6 entries');
const line = main.split('\n').find((s) => s.indexOf('_gui$') >= 0) || '';
const lit = /(\/[^/]+\/)/.exec(line);
let rx = null;
try { rx = lit ? new RegExp(lit[1].slice(1, -1)) : null; } catch (e) { rx = null; }
ok(rx !== null, 'prefixFromName regex is readable: ' + (lit ? lit[1] : 'not found'));
if (rx) {
  for (const n of Object.keys(expected)) {
    const m = rx.exec(n);
    const app = m ? tbl[m[1]] : null;
    ok(app === expected[n], 'name -> app ' + n + ' -> ' + app);
  }
  ok(rx.exec('inc_launcher.exe') === null, 'launcher name is not mistaken for a window name');
}

/* --- 4. payload.mjs architecture mapping and the gui-name collision guard --- */
const pl = await import(url.pathToFileURL(path.join(ROOT, 'shell', 'payload.mjs')).href);
ok(pl.electronArch('win-x64') === 'x64' && pl.electronArch('win-ia32') === 'ia32' && pl.electronArch('win-arm64') === 'arm64', 'electronArch windows');
ok(pl.electronArch('linux-x64') === null && pl.electronArch('darwin-arm64') === null, 'electronArch non-windows is null');
ok(pl.hasGui('ipm', 'linux-x64') === false, 'hasGui false for linux');
ok(pl.hasGui('ipm', 'win-x64') === true, 'hasGui true for built win-x64');
let threw = false;
try { pl.stageGui(path.join(HERE, '_no_such_dest'), 'ipm', 'linux-x64'); } catch (e) { threw = true; }
ok(threw, 'stageGui refuses a non-windows target');
const tmp = path.join(HERE, '_selftest_tmp');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, 'ipm_gui.exe'), 'the C++ face, not Electron');
let refused = false;
try { pl.stageGui(tmp, 'ipm', 'win-x64'); } catch (e) { refused = true; }
ok(refused, 'stageGui refuses to overwrite an existing C++ gui face');
fs.rmSync(tmp, { recursive: true, force: true });

/* --- 5. shell/build.mjs names the administrator twin exactly like payload.mjs ---
 * A local <prefix>x_gui derivation silently produced incx_gui-win32-* trees that
 * nothing in the project consumes; inc's admin name is inx (c -> x, not incx). */
const buildSrc = read('shell/build.mjs');
ok(pl.adminGuiName('inc') === 'inx_gui.exe', 'adminGuiName(inc) is inx_gui.exe, not incx_gui.exe');
ok(buildSrc.indexOf('adminGuiName(') >= 0, 'build.mjs derives the admin gui name from payload.adminGuiName');
ok(buildSrc.indexOf("t.prefix + 'x_gui'") < 0, 'build.mjs no longer derives <prefix>x_gui locally');
const shellOut = path.join(ROOT, 'shell', 'build');
if (fs.existsSync(shellOut)) {
  const dirs = fs.readdirSync(shellOut, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name)
    .filter((n) => /-win32-(x64|ia32|arm64)$/.test(n));
  const want = [];
  for (const arch of ['x64', 'ia32', 'arm64']) {
    for (const p of ['inc', 'ipm']) {
      want.push(p + '_gui-win32-' + arch);
      want.push(pl.adminGuiName(p).replace(/\.exe$/, '') + '-win32-' + arch);
    }
  }
  const missing = want.filter((n) => dirs.indexOf(n) < 0);
  const extra = dirs.filter((n) => want.indexOf(n) < 0 && !n.startsWith('.retired-'));
  ok(missing.length === 0, 'shell/build holds all 12 expected shell dirs' + (missing.length ? ' missing=' + missing.join(',') : ''));
  ok(extra.length === 0, 'shell/build has no unexpected shell dirs' + (extra.length ? ' extra=' + extra.join(',') : ''));
} else {
  console.log('  note shell/build is absent; on-disk shell-name check skipped');
}

console.log('');
console.log((fail === 0 ? 'SELFTEST PASS' : 'SELFTEST FAIL') + '  pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
