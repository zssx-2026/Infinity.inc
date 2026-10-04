/*
 * build.mjs - build the C++ suite and give each executable its eight names.
 *
 * The compiler produces one executable per application. The names are made
 * afterwards, by copying, because the program reads its own file name to
 * decide which face to be - so a copy is genuinely a different program from
 * the user's point of view, and the build stays a single artifact.
 *
 * Copies rather than hard links this time. A hard link is cheaper, but these
 * binaries are a few hundred kilobytes each now instead of eighty megabytes,
 * and a real file survives being copied to a USB stick or into an installer
 * without any question about whether the link came along.
 *
 * The result is checked for external dependencies before it is accepted: the
 * whole point of the port is that the executable needs nothing but Windows.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execFileSync } from 'node:child_process';

const NL = String.fromCharCode(10);
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BUILD = path.join(ROOT, 'build');
const OUT = path.join(ROOT, 'out');

const MINGW = 'C:/Users/REDMI/AppData/Local/Microsoft/WinGet/Packages/' +
  'BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin';

/* The C++ build makes every face the C++ program itself can serve: `cli` is
 * the command line, `launcher` the menu that starts one of the other faces,
 * and `gui` the loopback UI server the Electron window draws. The list per
 * application has to match core/include/inc/mode.hpp, which rejects a face an
 * application does not have - Infinity Installer Manager, Infinity Toolbox and
 * Infinity Games have exactly two faces (cli, gui) and no launcher.
 *
 * Every name is a real copy of the one C++ artifact. The Electron shell in
 * shell/build.mjs is a separate deliverable - a directory tree, not a single
 * executable - and is not what these names wrap. */
export const APPS = [
  { app: 'inc', prefix: 'inc', admin: 'inx', label: 'Infinity Cloud', modes: ['cli', 'gui', 'launcher'] },
  { app: 'ifm', prefix: 'ifm', admin: 'ifmx', label: 'Infinity File Manager', modes: ['cli', 'gui', 'launcher'] },
  { app: 'ipm', prefix: 'ipm', admin: 'ipmx', label: 'InfinityPackageManager', modes: ['cli', 'gui', 'launcher'] },
  { app: 'iim', prefix: 'iim', admin: 'iimx', label: 'Infinity Installer Manager', modes: ['cli', 'gui'] },
  { app: 'int', prefix: 'int', admin: 'intx', label: 'Infinity Toolbox', modes: ['cli', 'gui'] },
  { app: 'ing', prefix: 'ing', admin: 'ingx', label: 'Infinity Games', modes: ['cli', 'gui'] }
];
export const MODES = ['cli', 'gui', 'launcher'];

/* Windows itself. Anything else in the import table is a dependency the user
 * would have to install, which is exactly what this build exists to avoid. */
const SYSTEM_DLLS = new Set([
  'kernel32.dll', 'user32.dll', 'gdi32.dll', 'winhttp.dll', 'advapi32.dll',
  'shell32.dll', 'ole32.dll', 'comdlg32.dll', 'ws2_32.dll', 'crypt32.dll',
  'bcrypt.dll', 'shlwapi.dll', 'comctl32.dll', 'uxtheme.dll', 'ntdll.dll', 'kernelbase.dll'
]);

function log(m) { process.stdout.write(m + NL); }

function run(exe, args, cwd) {
  return execFileSync(exe, args, {
    cwd: cwd || ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // objdump -p on a statically linked binary prints more than the 1 MB
    // default, and the default failure is ENOBUFS - which the caller used to
    // swallow, leaving the dependency audit reported as "skipped" while the
    // summary line still claimed the dependencies were Windows only.
    maxBuffer: 256 * 1024 * 1024,
    env: Object.assign({}, process.env, { PATH: MINGW + ';' + (process.env.PATH || '') })
  }) || '';
}

function haveCmake() {
  try { run('cmake', ['--version']); return true; } catch (e) { return false; }
}

function compile() {
  fs.mkdirSync(BUILD, { recursive: true });
  log('configuring');
  run('cmake', ['-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', '..'], BUILD);
  log('compiling');
  const out = run('ninja', [], BUILD);
  for (const line of out.split(NL)) if (line.indexOf('warning') >= 0) log('  ' + line);
  return path.join(BUILD, 'inc.exe');
}

/* The import table, as objdump reports it. */
function imports(exe) {
  let text = '';
  try { text = run('objdump', ['-p', exe], BUILD); } catch (e) { return null; }
  const out = [];
  for (const m of text.matchAll(/DLL Name:\s*(\S+)/g)) out.push(m[1]);
  return Array.from(new Set(out));
}

/* The import table, as objdump reports it. null means the table could not be
 * read at all, which is different from an empty list and has to stay
 * different - the callers refuse to call a build audited when it was not. */
function audit(exe) {
  const dlls = imports(exe);
  if (!dlls) return null;
  return dlls.filter(function (d) {
    if (SYSTEM_DLLS.has(String(d).toLowerCase())) return false;
    // The UCRT forwarders are part of Windows 10 and later; they are not
    // something a user installs.
    if (d.toLowerCase().indexOf('api-ms-win-crt-') === 0) return false;
    if (d.toLowerCase().indexOf('api-ms-win-core-') === 0) return false;
    return true;
  });
}

function emitNames(app, exe) {
  const dir = path.join(OUT, app.app);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const made = [];
  for (const mode of app.modes) {
    for (const prefix of [app.prefix, app.admin]) {
      const name = prefix + '_' + mode + '.exe';
      const dst = path.join(dir, name);
      fs.copyFileSync(exe, dst);
      made.push(dst);
    }
  }
  return made;
}

function main() {
  if (!haveCmake()) throw new Error('cmake is not on PATH; add ' + MINGW);

  const exe = compile();
  const size = fs.statSync(exe).size;
  log('');
  log('built ' + exe + '  ' + size + ' B');

  const foreign = audit(exe);
  if (foreign === null) log('  WARNING the import table could not be read; dependencies were NOT checked');
  else if (foreign.length) log('  WARNING external dependencies: ' + foreign.join(', '));
  else log('  dependencies: Windows only');

  log('');
  const only = process.argv[2];
  const built = [];
  for (const app of APPS) {
    if (only && only !== app.app) continue;
    const src = path.join(BUILD, app.app + '.exe');
    const from = fs.existsSync(src) ? src : exe;
    const foreign = audit(from);
    if (foreign === null) throw new Error(app.app + ': the import table could not be read, so the dependency audit did not run');
    if (foreign.length) throw new Error(app.app + ' has external dependencies: ' + foreign.join(', '));
    const made = emitNames(app, from);
    log(app.app.padEnd(5) + app.label.padEnd(26) + made.length + ' names  ' + fs.statSync(from).size + ' B  Windows dependencies only');
    built.push({ app: app.app, exe: from, names: made });
  }
  log('');
  log('done.  ' + path.join(OUT, '<app>'));
  return built;
}

export { main };

if (process.argv[1] && process.argv[1].indexOf('build.mjs') >= 0) {
  try { main(); }
  catch (e) { console.error(String(e && e.message ? e.message : e)); process.exit(1); }
}
