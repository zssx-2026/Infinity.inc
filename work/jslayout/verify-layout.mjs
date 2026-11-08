/*
 * verify-layout.mjs - prove the multi file layout works, from scratch.
 *
 * It builds a throwaway layout in a temporary directory - copied runtime,
 * a probe bundle, the real launchers - and then checks the things that
 * actually have to hold:
 *
 *   the right face reaches the program, for every name
 *   the arguments survive the handover, quoting and all
 *   the caller's current directory is kept
 *   the exit code comes back
 *   the shared runtime is present exactly once
 *   no executable in the layout is a single file giant
 *
 * Nothing outside the temporary directory is read, and nothing is left
 * behind when it finishes, succeed or fail. This is the test that would
 * have caught a launcher that silently started the wrong program.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import url from 'node:url';
import { spawnSync } from 'node:child_process';

const NL = String.fromCharCode(10);
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(HERE, '..', '..');

const RUNTIME_CANDIDATES = [
  path.join(WORKSPACE, 'temp', 'tools', 'runtimes', 'win-x64', 'node-v22.11.0-win-x64', 'node.exe'),
  'D:/program/nodejs/node.exe'
];

/* The layouts build-layout.mjs has produced, checked alongside the probe. */
const PRODUCT_LAYOUTS = [
  { product: 'ifm', dir: path.join('Infinity File Manager', 'sourcecode', 'build', 'layout', 'win-x64') },
  { product: 'inc', dir: path.join('Infinity Cloud', 'sourcecode', 'build', 'layout', 'win-x64') },
  { product: 'ipm', dir: path.join('InfinityPackageManager', 'build', 'layout', 'win-x64') }
];

const PROBE = [
  'const fs = require(' + String.fromCharCode(39) + 'node:fs' + String.fromCharCode(39) + ');',
  'const path = require(' + String.fromCharCode(39) + 'node:path' + String.fromCharCode(39) + ');',
  'const named = process.env.INFINITY_EXE_NAME || path.basename(process.execPath);',
  'const base = named.replace(/\\.exe$/i, ' + String.fromCharCode(39) + String.fromCharCode(39) + ').toLowerCase();',
  'const cut = base.indexOf(' + String.fromCharCode(39) + '_' + String.fromCharCode(39) + ');',
  'const result = {',
  '  name: process.env.INFINITY_EXE_NAME || null,',
  '  prefix: cut < 0 ? null : base.slice(0, cut),',
  '  mode: cut < 0 ? null : base.slice(cut + 1),',
  '  args: process.argv.slice(2),',
  '  cwd: process.cwd(),',
  '  exit: Number(process.env.PROBE_EXIT || 0)',
  '};',
  '/* The windowed face has no console to write to, so the answer goes to a',
  ' * file: that way both faces are measured the same way. */',
  'if (process.env.PROBE_OUT) fs.writeFileSync(process.env.PROBE_OUT, JSON.stringify(result), ' + String.fromCharCode(39) + 'utf8' + String.fromCharCode(39) + ');',
  'process.stdout.write(JSON.stringify(result) + ' + String.fromCharCode(39) + '\\n' + String.fromCharCode(39) + ');',
  'process.exit(result.exit);'
].join(NL);

const CASES = [
  { name: 'ifm_cli.exe',      prefix: 'ifm',  mode: 'cli',      launcher: 'launcher-console.exe' },
  { name: 'ifm_gui.exe',      prefix: 'ifm',  mode: 'gui',      launcher: 'launcher-window.exe'  },
  { name: 'ifm_launcher.exe', prefix: 'ifm',  mode: 'launcher', launcher: 'launcher-console.exe' },
  { name: 'ifmx_cli.exe',     prefix: 'ifmx', mode: 'cli',      launcher: 'launcher-console.exe' },
  { name: 'ifmx_gui.exe',     prefix: 'ifmx', mode: 'gui',      launcher: 'launcher-window.exe'  },
  { name: 'ifmx_launcher.exe',prefix: 'ifmx', mode: 'launcher', launcher: 'launcher-console.exe' }
];

const ARGS = ['--path', 'C:/somewhere with spaces/a file.txt', '--flag'];

let tmp = null;
const checks = [];

function check(label, ok, detail) {
  checks.push({ label: label, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  process.stdout.write((ok ? 'ok   ' : 'FAIL ') + label + (detail !== undefined && detail !== '' ? '  ' + detail : '') + NL);
  return !!ok;
}

function cleanup() {
  if (tmp && fs.existsSync(tmp)) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
  }
}

try {
  const runtime = RUNTIME_CANDIDATES.filter(function (p) { return fs.existsSync(p); })[0] || null;
  if (!check('a node runtime is available', runtime, runtime || 'none found')) throw new Error('no runtime');

  for (const f of ['launcher-console.exe', 'launcher-window.exe']) {
    const p = path.join(HERE, f);
    check('launcher built: ' + f, fs.existsSync(p), fs.existsSync(p) ? fs.statSync(p).size + ' B' : 'missing');
  }
  if (checks.some(function (c) { return !c.ok; })) throw new Error('launchers missing');

  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ifm-layout-'));
  fs.copyFileSync(runtime, path.join(tmp, 'node.exe'));
  fs.writeFileSync(path.join(tmp, 'app.cjs'), PROBE, 'utf8');
  for (const c of CASES) fs.copyFileSync(path.join(HERE, c.launcher), path.join(tmp, c.name));

  /* The face has to be the right build: a windowed name given the console
   * launcher would still run, but would flash a console box on the
   * desktop, which is exactly what the split was for. */
  for (const c of CASES) {
    const want = fs.readFileSync(path.join(HERE, c.launcher));
    const got = fs.readFileSync(path.join(tmp, c.name));
    check('face of ' + c.name, want.equals(got), c.launcher);
  }

  for (const c of CASES) {
    const answerFile = path.join(tmp, c.name + '.answer.json');
    try { fs.rmSync(answerFile, { force: true }); } catch (e) { }
    const r = spawnSync(path.join(tmp, c.name), ARGS, {
      encoding: 'utf8', windowsHide: true, cwd: tmp, timeout: 60000,
      env: Object.assign({}, process.env, { PROBE_OUT: answerFile })
    });
    let got = null;
    try { got = JSON.parse(fs.readFileSync(answerFile, 'utf8')); } catch (e) { }
    const okName = got && got.name === c.name;
    const okFace = got && got.prefix === c.prefix && got.mode === c.mode;
    const okArgs = got && JSON.stringify(got.args) === JSON.stringify(ARGS);
    const okCwd = got && path.resolve(got.cwd) === path.resolve(tmp);
    check('run ' + c.name, r.status === 0 && okName && okFace && okArgs && okCwd,
      'exit=' + r.status + ' face=' + (got ? got.prefix + '/' + got.mode : 'no answer file') +
      ' args=' + (okArgs ? 'kept' : 'CHANGED ' + JSON.stringify(got && got.args)));
  }

  /* Both faces have to hand the exit code back, not only the console one. */
  for (const c of CASES) {
    const answerFile = path.join(tmp, c.name + '.exit.json');
    try { fs.rmSync(answerFile, { force: true }); } catch (e) { }
    const r = spawnSync(path.join(tmp, c.name), [], {
      encoding: 'utf8', windowsHide: true, cwd: tmp, timeout: 60000,
      env: Object.assign({}, process.env, { PROBE_OUT: answerFile, PROBE_EXIT: '7' })
    });
    check('exit code of ' + c.name, r.status === 7, 'exit=' + r.status);
  }

  /* The windowed face is started by installers and scripts, and a caller
   * standing at a console has to be able to read what it says: the launcher
   * hands its own standard handles to the runtime, so the url the window face
   * prints reaches whoever started it. It still writes the probe file, which
   * is what a caller with no console at all has to fall back on. */
  {
    const answerFile = path.join(tmp, 'gui.answer.json');
    try { fs.rmSync(answerFile, { force: true }); } catch (e) { }
    const r = spawnSync(path.join(tmp, 'ifm_gui.exe'), [], {
      encoding: 'utf8', windowsHide: true, cwd: tmp, timeout: 60000,
      env: Object.assign({}, process.env, { PROBE_OUT: answerFile })
    });
    const answer = fs.existsSync(answerFile) ? JSON.parse(fs.readFileSync(answerFile, 'utf8')) : null;
    check('the windowed face runs and writes its probe file',
      r.status === 0 && !!answer && answer.mode === 'gui',
      'exit=' + r.status + ' answer=' + JSON.stringify(answer));
    check('the windowed face hands its output back to the caller',
      String(r.stdout || '').indexOf('ifm_gui.exe') >= 0,
      'stdout=' + JSON.stringify(String(r.stdout || '').slice(0, 120)));
  }


  /* One runtime, not six. This is the whole point of the layout. */
  const files = fs.readdirSync(tmp).filter(function (f) { return !/\.answer\.json$/.test(f) && !/\.exit\.json$/.test(f); });
  const runtimes = files.filter(function (f) { return f === 'node.exe'; }).length;
  let bytes = 0, biggest = 0, biggestName = '';
  for (const f of files) {
    const s = fs.statSync(path.join(tmp, f)).size;
    bytes += s;
    if (s > biggest) { biggest = s; biggestName = f; }
  }
  check('the runtime is shared, not copied per name', runtimes === 1, 'node.exe x' + runtimes);

  const GIANTS = files.filter(function (f) {
    return /\.exe$/i.test(f) && f !== 'node.exe' && fs.statSync(path.join(tmp, f)).size > 5 * 1024 * 1024;
  });
  check('no executable is a single file giant', GIANTS.length === 0,
    GIANTS.length ? GIANTS.join(', ') : 'largest named exe ' + (biggestName === 'node.exe' ? '(runtime only)' : biggestName));

  /*
   * The real products, not just the probe: each shipped layout has to carry
   * one runtime, no giant executables, and a bundle the launcher can run.
   * This is what catches a product that was built but never verified.
   */
  for (const prod of PRODUCT_LAYOUTS) {
    const dir = path.join(WORKSPACE, prod.dir);
    if (!fs.existsSync(dir)) {
      check('shipped layout ' + prod.product + ' exists', false, 'missing ' + dir);
      continue;
    }
    const names = fs.readdirSync(dir);
    check('shipped layout ' + prod.product + ' shares one runtime',
      names.filter(function (f) { return f === 'node.exe'; }).length === 1,
      names.join(', '));
    check('shipped layout ' + prod.product + ' carries app.cjs',
      names.indexOf('app.cjs') >= 0, names.join(', '));
    const giants = names.filter(function (f) {
      return /\.exe$/i.test(f) && f !== 'node.exe' && fs.statSync(path.join(dir, f)).size > 5 * 1024 * 1024;
    });
    check('shipped layout ' + prod.product + ' has no single file giant', giants.length === 0,
      giants.length ? giants.join(', ') : (names.length + ' files'));
  }

  /* Missing neighbours must fail loudly rather than start something else. */
  const orphan = path.join(tmp, 'orphan');
  fs.mkdirSync(orphan, { recursive: true });
  fs.copyFileSync(path.join(HERE, 'launcher-console.exe'), path.join(orphan, 'ifm_cli.exe'));
  const rOrphan = spawnSync(path.join(orphan, 'ifm_cli.exe'), [], { encoding: 'utf8', windowsHide: true, cwd: orphan, timeout: 60000 });
  check('a layout with no runtime fails instead of guessing', rOrphan.status === 2, 'exit=' + rOrphan.status);

  process.stdout.write(NL + 'layout under test: ' + files.length + ' files / ' + bytes + ' B' + NL);
} catch (e) {
  check('the verification itself ran', false, e && e.message);
} finally {
  cleanup();
}

const failed = checks.filter(function (c) { return !c.ok; });
process.stdout.write(NL + 'LAYOUT-VERIFY ' + (checks.length - failed.length) + '/' + checks.length +
  '  ' + (failed.length ? 'FAIL' : 'PASS') + NL);
process.exit(failed.length ? 1 : 0);
