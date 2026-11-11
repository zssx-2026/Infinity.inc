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

/* The resource section: one product icon and one VERSIONINFO block per
 * executable. The icons live outside cpp/ - the installer packaging tree first,
 * the repository root as the fallback - so a checkout that carries either one
 * still builds. The .rc itself is generated into the build directory before
 * CMake configures; it is a build artifact and never lands in the source tree,
 * which is what keeps this change revertible to a single source edit. */
const ICON_DIRS = [
  path.resolve(ROOT, '..', 'installers', 'packaging', 'icons'),
  path.resolve(ROOT, '..', 'icons')
];
const RC_DIR = path.join(BUILD, 'rc');
const VERSION = process.env.INC_VERSION || '1.0.0-pre6';
const COMPANY = process.env.INC_COMPANY || 'Infinity.Inc';

const MINGW = 'C:/Users/REDMI/AppData/Local/Microsoft/WinGet/Packages/' +
  'BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin';

/* The C++ build makes every face the C++ program itself can serve: `cli` is
 * the command line, `launcher` the menu that starts one of the other faces,
 * and `gui` the loopback UI server the Electron window draws. The list per
 * application has to match core/include/inc/mode.hpp, which rejects a face an
 * application does not have - Infinity Toolbox has exactly two faces
 * (cli, gui) and no launcher.
 *
 * Every name is a real copy of the one C++ artifact. The Electron shell in
 * shell/build.mjs is a separate deliverable - a directory tree, not a single
 * executable - and is not what these names wrap. */
export const APPS = [
  { app: 'inc', prefix: 'inc', admin: 'inx', label: 'Infinity Cloud', modes: ['cli', 'gui', 'launcher'] },
  { app: 'ipm', prefix: 'ipm', admin: 'ipmx', label: 'InfinityPackageManager', modes: ['cli', 'gui', 'launcher'] },
  { app: 'int', prefix: 'int', admin: 'intx', label: 'Infinity Toolbox', modes: ['cli', 'gui'] }
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
  for (const r of writeResources()) {
    log('resource ' + path.basename(r.rc) + '  ' + (r.changed ? 'written' : 'unchanged') + '  ' + r.icon);
  }
  log('configuring');
  run('cmake', ['-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', '..'], BUILD);
  log('resource compiler: ' + assertRCCompiler());
  log('compiling');
  // Two jobs by default: this machine builds a six-application suite quickly
  // enough at -j 2, and a bounded fan-out keeps the rest of the workspace
  // responsive while other work is running beside it.
  const out = run('ninja', ['-j', process.env.INC_JOBS || '2'], BUILD);
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

/* The icon for one application, from the first directory that has it. */
function findIcon(name) {
  const tried = [];
  for (const dir of ICON_DIRS) {
    const file = path.join(dir, name + '.ico');
    tried.push(file);
    if (fs.existsSync(file)) return file;
  }
  throw new Error('no product icon for ' + name + '; looked for ' + tried.join(', '));
}

/* FILEVERSION and PRODUCTVERSION are four numbers. "1.0.0-pre6" is the fifth
 * pre-release of 1.0.0, so the fourth number is 5; a plain "1.2.3" gets 0. */
function versionQuad(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-pre(\d+))?$/.exec(String(v));
  if (!m) return [1, 0, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? Number(m[4]) : 0];
}

/* The .rc text: resource id 1 is both the icon group and the VERSIONINFO block,
 * which is the usual layout Explorer and the shell read. The ICON path is
 * written with forward slashes because windres resolves it from the directory
 * it runs in (the build directory), not from the .rc file's own location. */
function rcText(app, icon) {
  const q = versionQuad(VERSION);
  const file = icon.split(path.sep).join('/');
  return [
    '/* generated by tools/build.mjs - do not edit; run build.mjs to regenerate */',
    '',
    '1 ICON "' + file + '"',
    '',
    '1 VERSIONINFO',
    'FILEVERSION ' + q.join(','),
    'PRODUCTVERSION ' + q.join(','),
    'FILEFLAGSMASK 0x3fL',
    'FILEFLAGS 0x0L',
    'FILEOS 0x40004L',
    'FILETYPE 0x1L',
    'FILESUBTYPE 0x0L',
    'BEGIN',
    '  BLOCK "StringFileInfo"',
    '  BEGIN',
    '    BLOCK "040904b0"',
    '    BEGIN',
    '      VALUE "CompanyName", "' + COMPANY + '"',
    '      VALUE "FileDescription", "' + app.label + '"',
    '      VALUE "FileVersion", "' + VERSION + '"',
    '      VALUE "InternalName", "' + app.app + '"',
    '      VALUE "OriginalFilename", "' + app.app + '.exe"',
    '      VALUE "ProductName", "' + app.label + '"',
    '      VALUE "ProductVersion", "' + VERSION + '"',
    '      VALUE "LegalCopyright", "Copyright (C) Infinity.Inc"',
    '    END',
    '  END',
    '  BLOCK "VarFileInfo"',
    '  BEGIN',
    '    VALUE "Translation", 0x409, 1200',
    '  END',
    'END',
    ''
  ].join('\n');
}

/* One .rc per application, written only when its bytes change. Rewriting an
 * identical file would move its mtime, and Ninja would then recompile the
 * resource and relink the executable on every run - the opposite of the
 * idempotence this step exists to keep. */
function writeResources() {
  fs.mkdirSync(RC_DIR, { recursive: true });
  const made = [];
  for (const app of APPS) {
    const icon = findIcon(app.app);
    const file = path.join(RC_DIR, app.app + '.rc');
    const text = rcText(app, icon);
    let same = false;
    try { same = fs.readFileSync(file, 'utf8') === text; } catch (e) { same = false; }
    if (!same) fs.writeFileSync(file, text, 'utf8');
    made.push({ app: app.app, rc: file, icon: icon, changed: !same });
  }
  return made;
}

/* CMake records the resource compiler it chose in the cache. Reading it back is
 * what makes "windres compiled this" a checked fact rather than an assumption:
 * a C compiler in the RC slot would ignore the .rc and every executable would
 * come out without an icon. */
function assertRCCompiler() {
  const cache = fs.readFileSync(path.join(BUILD, 'CMakeCache.txt'), 'utf8');
  const m = /^CMAKE_RC_COMPILER:FILEPATH=(.+)$/m.exec(cache);
  if (!m) throw new Error('CMake recorded no resource compiler (CMAKE_RC_COMPILER); the .rc files would be ignored');
  const compiler = m[1].trim();
  if (!/^windres(\.exe)?$/i.test(path.basename(compiler))) {
    throw new Error('CMake is not using windres for .rc files: ' + compiler);
  }
  if (!fs.existsSync(compiler)) throw new Error('the resource compiler recorded by CMake does not exist: ' + compiler);
  return compiler;
}

/* The resource types in an executable's resource directory, as numeric ids, or
 * null when the directory cannot be read. A .rsrc section on its own proves
 * nothing: CMake's default manifest already creates one, so the executables
 * built before the icon was wired in had a section too. RT_ICON (3) and
 * RT_GROUP_ICON (14) are what prove the generated .rc reached the link. The
 * walk is done here rather than through an external tool so that a broken
 * resource directory is a build failure, not a build that silently skips the
 * check. */
function resourceTypes(exe) {
  let b = null;
  try { b = fs.readFileSync(exe); } catch (e) { return null; }
  if (b.length < 0x40) return null;
  const u16 = function (o) { return b.readUInt16LE(o); };
  const u32 = function (o) { return b.readUInt32LE(o); };
  const pe = u32(0x3c);
  if (pe + 24 > b.length || u32(pe) !== 0x00004550) return null;
  const nsec = u16(pe + 6);
  const optsz = u16(pe + 20);
  const opt = pe + 24;
  const magic = u16(opt);
  const rs = opt + (magic === 0x20b ? 112 : 96) + 2 * 8; // data directory 2
  if (rs + 8 > b.length) return null;
  const rva = u32(rs);
  if (rva === 0) return [];
  const secs = [];
  for (let i = 0; i < nsec; i++) {
    const o = opt + optsz + i * 40;
    if (o + 40 > b.length) return null;
    secs.push({ va: u32(o + 12), vs: u32(o + 8), raw: u32(o + 20) });
  }
  let base = -1;
  for (const s of secs) {
    if (rva >= s.va && rva < s.va + Math.max(s.vs, 1)) { base = s.raw + (rva - s.va); break; }
  }
  if (base < 0 || base + 16 > b.length) return null;
  const count = u16(base + 12) + u16(base + 14);
  const types = [];
  for (let i = 0; i < count; i++) {
    const e = base + 16 + i * 8;
    if (e + 8 > b.length) return null;
    const id = u32(e);
    // A named type resource has the top bit set and no number to compare.
    types.push((id & 0x80000000) !== 0 ? -1 : id);
  }
  return types;
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
    const types = resourceTypes(from);
    if (types === null) throw new Error(app.app + ': the resource directory could not be read, so the icon was NOT verified');
    if (types.indexOf(3) < 0 || types.indexOf(14) < 0) {
      throw new Error(app.app + ': no RT_ICON/RT_GROUP_ICON resource in ' + from +
        ' (resource types: ' + (types.join(',') || 'none') + '); the icon did not reach the link');
    }
    const made = emitNames(app, from);
    log(app.app.padEnd(5) + app.label.padEnd(26) + made.length + ' names  ' + fs.statSync(from).size + ' B  Windows dependencies only  icon+VERSIONINFO');
    built.push({ app: app.app, exe: from, names: made });
  }
  log('');
  log('done.  ' + path.join(OUT, '<app>'));
  return built;
}

export { main, resourceTypes };

if (process.argv[1] && process.argv[1].indexOf('build.mjs') >= 0) {
  try { main(); }
  catch (e) { console.error(String(e && e.message ? e.message : e)); process.exit(1); }
}
