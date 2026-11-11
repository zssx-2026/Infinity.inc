/*
 * build.mjs - turn the shell into one executable per application.
 *
 * Electron is not packaged by a packaging tool here, and deliberately so.
 * The only things a packager does that matter are: lay the Electron runtime
 * down, rename its executable, and drop the application into resources/app.
 * Each of those is a single step, so they are done directly - which also
 * means the run does not touch the network. The runtime comes from the
 * download cache npm already filled.
 *
 * Electron ships as a directory, not a lone file, and that directory is what
 * the installer stages as <prefix>_gui.exe. The ten names are the same
 * directory; only the executable at its root is renamed. The C++ build no
 * longer emits any _gui name, so this shell owns all ten.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { execFileSync } from 'node:child_process';
/* The administrator twin's name is defined once, in payload.mjs (inc -> inx,
 * not incx). build.mjs used to derive it locally as <prefix>x_gui, which made
 * an incx_gui-win32-* tree nothing else in the project ever looks for. */
import { adminGuiName } from './payload.mjs';

const NL = String.fromCharCode(10);
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'build');

export const TARGETS = [
  { prefix: 'inc', app: 'Infinity Cloud' },
  { prefix: 'ipm', app: 'InfinityPackageManager' },
  { prefix: 'int', app: 'Infinity Toolbox' }
];

function log(m) { process.stdout.write(m + NL); }

function electronVersion() {
  try {
    const p = path.join(HERE, 'node_modules', 'electron', 'package.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')).version;
  } catch (e) { return null; }
}

/* The cached runtime. @electron/get stores it under a hash-named folder, so
 * the file is found by name rather than by path. The shared runtime cache
 * under D:/temp/tools/runtimes is consulted first: on this machine it is
 * where runtimes are meant to be staged, and the npm cache is only a
 * fallback for a machine that has none. */
function runtimeRoots(arch) {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const tools = process.env.INFINITY_RUNTIMES || 'D:/temp/tools/runtimes';
  return [
    path.join(tools, 'win-' + arch),
    tools,
    path.join(local, 'electron', 'Cache'),
    path.join(os.homedir(), '.cache', 'electron'),
    path.join(os.homedir(), 'AppData', 'Local', 'electron', 'Cache')
  ];
}

function findRuntimeZip(version, arch) {
  const want = 'electron-v' + version + '-win32-' + arch + '.zip';
  for (const root of runtimeRoots(arch)) {
    let entries = [];
    try { entries = fs.readdirSync(root); } catch (e) { continue; }
    for (const e of entries) {
      const direct = path.join(root, e);
      if (e === want && fs.existsSync(direct)) return direct;
      const nested = path.join(root, e, want);
      if (fs.existsSync(nested)) return nested;
    }
  }
  return null;
}

/*
 * The runtime for an architecture, downloaded if it is not cached.
 *
 * github.com/electron/electron/releases answers 502 on this machine, so the
 * npmmirror copy is used instead - it serves the same file, and npm already
 * pointed at it when the package was installed.
 */
function ensureRuntime(version, arch) {
  const found = findRuntimeZip(version, arch);
  if (found) return found;

  const cacheRoot = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'electron', 'Cache', 'infinity');
  fs.mkdirSync(cacheRoot, { recursive: true });
  const dest = path.join(cacheRoot, 'electron-v' + version + '-win32-' + arch + '.zip');
  const url = 'https://registry.npmmirror.com/-/binary/electron/v' + version + '/electron-v' + version + '-win32-' + arch + '.zip';
  log('downloading ' + arch + ' runtime');
  execFileSync('curl', ['-sSL', '--fail', '-o', dest, url], { stdio: ['ignore', 'pipe', 'pipe'] });
  const size = fs.statSync(dest).size;
  if (size < 50 * 1024 * 1024) throw new Error('the downloaded runtime looks wrong: ' + size + ' B');
  log('  ' + size + ' B');
  return dest;
}

/* resources/app is the unpacked form Electron accepts, so no asar step is
 * needed: the shell is two files and copying them is the whole install. */
function writeApp(dir, app) {
  const appDir = path.join(dir, 'resources', 'app');
  fs.mkdirSync(appDir, { recursive: true });
  fs.copyFileSync(path.join(HERE, 'main.js'), path.join(appDir, 'main.js'));
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
    name: 'infinity-shell',
    version: '1.0.0',
    description: app,
    main: 'main.js',
    author: 'Infinity.Inc',
    license: 'MIT'
  }, null, 2), 'utf8');
}

function copyAs(srcDir, srcExe, newName, arch) {
  const dstDir = path.join(OUT, newName + '-win32-' + arch);
  fs.rmSync(dstDir, { recursive: true, force: true });
  fs.cpSync(srcDir, dstDir, { recursive: true });
  const oldExe = path.join(dstDir, srcExe + '.exe');
  const newExe = path.join(dstDir, newName + '.exe');
  if (fs.existsSync(oldExe)) fs.renameSync(oldExe, newExe);
  else throw new Error('the copied shell has no ' + srcExe + '.exe: ' + dstDir);
  return dstDir;
}

/* Windows on three architectures, the same three the installers target.
 * INC_SHELL_ARCHES narrows a run (for example x64) so a single-architecture
 * release does not spend 600 MB of I/O staging shells nobody installs. */
export const ARCHES = String(process.env.INC_SHELL_ARCHES || 'x64,ia32,arm64')
  .split(',').map(function (s) { return s.trim(); }).filter(Boolean);

function main() {
  const version = electronVersion();
  if (!version) throw new Error('electron is not installed: run npm install in ' + HERE);
  log('electron ' + version);

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const made = [];
  for (const arch of ARCHES) {
    const zip = ensureRuntime(version, arch);
    log('runtime  ' + arch + '  ' + zip);

    const first = 'inc_gui';
    const base = path.join(OUT, first + '-win32-' + arch);
    fs.mkdirSync(base, { recursive: true });
    /* Windows has no unzip, but it does ship bsdtar, which reads the zip the
     * Electron runtime comes in. */
    execFileSync('tar', ['-xf', zip, '-C', base], { stdio: ['ignore', 'pipe', 'pipe'] });
    fs.renameSync(path.join(base, 'electron.exe'), path.join(base, first + '.exe'));
    writeApp(base, TARGETS[0].app);

    for (const t of TARGETS) {
      const admin = adminGuiName(t.prefix).replace(/\.exe$/, '');
      for (const name of [t.prefix + '_gui', admin]) {
        const dir = name === first ? base : copyAs(base, first, name, arch);
        const exe = path.join(dir, name + '.exe');
        const size = fs.existsSync(exe) ? fs.statSync(exe).size : 0;
        log(name.padEnd(12) + arch.padEnd(6) + size + ' B');
        made.push({ name: name, arch: arch, dir: dir, exe: exe, app: t.app });
      }
    }
    log('');
  }
  log('packaged ' + made.length + ' shells');
  return made;
}

export { main };

/* --check: verify the packaged shells already on disk carry exactly the names
 * the rest of the project expects (no Electron download, no compiler). */
export function check() {
  const problems = [];
  const expectedNames = [];
  for (const arch of ARCHES) {
    for (const t of TARGETS) {
      expectedNames.push([t.prefix + '_gui', arch]);
      expectedNames.push([adminGuiName(t.prefix).replace(/\.exe$/, ''), arch]);
    }
  }
  const expectedDirs = new Set(expectedNames.map((p) => p[0] + '-win32-' + p[1]));
  for (const [name, arch] of expectedNames) {
    const exe = path.join(OUT, name + '-win32-' + arch, name + '.exe');
    if (!fs.existsSync(exe)) problems.push('missing ' + path.relative(HERE, exe));
  }
  const actual = fs.existsSync(OUT)
    ? fs.readdirSync(OUT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    : [];
  for (const d of actual) {
    if (/-win32-(x64|ia32|arm64)$/.test(d) && !expectedDirs.has(d)) problems.push('unexpected shell dir ' + d);
  }
  for (const d of expectedDirs) if (!actual.includes(d)) problems.push('missing shell dir ' + d);
  console.log(JSON.stringify({ out: path.relative(path.resolve(HERE, '..'), OUT), shells: expectedNames.length, dirs: expectedDirs.size, onDisk: actual.length, problems }, null, 1));
  if (problems.length) { console.log('SHELL-NAME-CHECK FAIL ' + problems.length); return 1; }
  console.log('SHELL-NAME-CHECK PASS ' + expectedNames.length + ' names in ' + expectedDirs.size + ' dirs');
  return 0;
}

if (process.argv[1] && process.argv[1].indexOf('build.mjs') >= 0) {
  if (process.argv.indexOf('--check') >= 0) process.exit(check());
  main();
}
