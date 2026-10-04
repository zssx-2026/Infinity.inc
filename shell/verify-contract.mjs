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

/* --- 1. build-all.mjs is the single source of exe names --- */
const ba = await import(url.pathToFileURL(path.join(ROOT, 'Infinity File Manager', 'sourcecode', 'tools', 'build-all.mjs')).href);
ok(Array.isArray(ba.TARGETS) && ba.TARGETS.length === 7, 'build-all: 7 targets');
for (const t of ba.TARGETS) {
  const names = ba.exeNames(t);
  const ext = t.id.indexOf('win') === 0 ? '.exe' : '';
  const want = ['ifm_cli', 'ifm_launcher', 'ifmx_cli', 'ifmx_launcher'].map((n) => n + ext);
  ok(JSON.stringify(names) === JSON.stringify(want), 'exeNames ' + t.id + ' -> ' + names.join(','));
}

/* --- 2. release.mjs no longer hardcodes the old name, and derives from the build --- */
const rel = read('Infinity File Manager/sourcecode/tools/release.mjs');
ok(!/exe:\s*'InfinityFileManager/.test(rel), 'release.mjs has no old exe field');
ok(!/\bp\.exe\b/.test(rel), 'release.mjs has no bare p.exe reference');
ok(rel.indexOf('import { exeNames }') >= 0, 'release.mjs imports exeNames');
ok(rel.indexOf('ifm_launcher') >= 0, 'release launcher points at ifm_launcher');
ok(rel.indexOf('for (const name of exeNames') >= 0, 'release stages every built face');
ok(rel.indexOf("hasGui('ifm', p.target)") >= 0, 'release reuses the shell gui helper on Windows');

/* --- 3. shell/main.js is the --serve-ui shell, and its port table matches cpp --- */
const main = read('shell/main.js');
ok(main.indexOf('--serve-ui') >= 0, 'main.js spawns --serve-ui');
ok(main.indexOf('--ipc') < 0, 'main.js has no --ipc');
ok(main.indexOf("path.join(__dirname, 'app'") < 0, 'main.js loads no local app/ page');
ok(main.indexOf('preload') < 0, 'main.js needs no preload');

const ap = {};
for (const m of main.matchAll(/^\s*(inc|ifm|ipm|iim|int):\s*\{ name: '([^']+)', port: (\d+) \}/gm)) ap[m[1]] = Number(m[3]);
const cppPorts = {};
for (const app of ['inc', 'ifm', 'ipm', 'iim']) {
  const m = /int uiPort = (\d+);/.exec(read('cpp/apps/' + app + '/main.cpp'));
  cppPorts[app] = m ? Number(m[1]) : null;
}
const intM = /const int kDefaultUiPort = (\d+);/.exec(read('cpp/apps/int/main.cpp'));
cppPorts.int = intM ? Number(intM[1]) : null;
ok(Object.keys(ap).length === 5, 'shell knows 5 applications: ' + Object.keys(ap).join(','));
for (const k of Object.keys(cppPorts)) ok(ap[k] === cppPorts[k], 'port ' + k + ' shell=' + ap[k] + ' cpp=' + cppPorts[k]);

const expected = { inc_gui: 'inc', inx_gui: 'inc', ifm_gui: 'ifm', ifmx_gui: 'ifm', ipm_gui: 'ipm', ipmx_gui: 'ipm', iim_gui: 'iim', iimx_gui: 'iim', int_gui: 'int', intx_gui: 'int' };
const tbl = {};
const blk = /const ADMIN_TO_BASE = \{([\s\S]*?)\};/.exec(main);
if (blk) for (const m of blk[1].matchAll(/(\w+):\s*'(\w+)'/g)) tbl[m[1]] = m[2];
ok(Object.keys(tbl).length === 10, 'ADMIN_TO_BASE has 10 entries');
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
  ok(rx.exec('ifm_launcher.exe') === null, 'launcher name is not mistaken for a window name');
}

/* --- 4. payload.mjs architecture mapping and the gui-name collision guard --- */
const pl = await import(url.pathToFileURL(path.join(ROOT, 'shell', 'payload.mjs')).href);
ok(pl.electronArch('win-x64') === 'x64' && pl.electronArch('win-ia32') === 'ia32' && pl.electronArch('win-arm64') === 'arm64', 'electronArch windows');
ok(pl.electronArch('linux-x64') === null && pl.electronArch('darwin-arm64') === null, 'electronArch non-windows is null');
ok(pl.hasGui('ifm', 'linux-x64') === false, 'hasGui false for linux');
ok(pl.hasGui('ifm', 'win-x64') === true, 'hasGui true for built win-x64');
let threw = false;
try { pl.stageGui(path.join(HERE, '_no_such_dest'), 'ifm', 'linux-x64'); } catch (e) { threw = true; }
ok(threw, 'stageGui refuses a non-windows target');
const tmp = path.join(HERE, '_selftest_tmp');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, 'ifm_gui.exe'), 'the C++ face, not Electron');
let refused = false;
try { pl.stageGui(tmp, 'ifm', 'win-x64'); } catch (e) { refused = true; }
ok(refused, 'stageGui refuses to overwrite an existing C++ gui face');
fs.rmSync(tmp, { recursive: true, force: true });

console.log('');
console.log((fail === 0 ? 'SELFTEST PASS' : 'SELFTEST FAIL') + '  pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
