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
 * the installer stages as <prefix>_gui.exe. The six names are the same
 * directory; only the executable at its root is renamed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { execFileSync } from 'node:child_process';

const NL = String.fromCharCode(10);
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'build');

export const TARGETS = [
  { prefix: 'inc', app: 'Infinity Cloud' },
  { prefix: 'ifm', app: 'Infinity File Manager' },
  { prefix: 'ipm', app: 'InfinityPackageManager' }
];

function log(m) { process.stdout.write(m + NL); }

function electronVersion() {
  try {
    const p = path.join(HERE, 'node_modules', 'electron', 'package.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')).version;
  } catch (e) { return null; }
}

/* The cached runtime. @electron/get stores it under a hash-named folder, so
 * the file is found by name rather than by path. */
function findRuntimeZip(version) {
  const roots = [
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'electron', 'Cache'),
    path.join(os.homedir(), '.cache', 'electron'),
    path.join(os.homedir(), 'AppData', 'Local', 'electron', 'Cache')
  ];
  const want = 'electron-v' + version + '-win32-x64.zip';
  for (const root of roots) {
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

function copyAs(srcDir, srcExe, newName) {
  const dstDir = path.join(OUT, newName + '-win32-x64');
  fs.rmSync(dstDir, { recursive: true, force: true });
  fs.cpSync(srcDir, dstDir, { recursive: true });
  const oldExe = path.join(dstDir, srcExe + '.exe');
  const newExe = path.join(dstDir, newName + '.exe');
  if (fs.existsSync(oldExe)) fs.renameSync(oldExe, newExe);
  else throw new Error('the copied shell has no ' + srcExe + '.exe: ' + dstDir);
  return dstDir;
}

function main() {
  const version = electronVersion();
  if (!version) throw new Error('electron is not installed: run npm install in ' + HERE);
  log('electron ' + version);

  const zip = findRuntimeZip(version);
  if (!zip) throw new Error('the Electron runtime is not cached: run npm install in ' + HERE);
  log('runtime  ' + zip);

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const first = 'inc_gui';
  const base = path.join(OUT, first + '-win32-x64');
  fs.mkdirSync(base, { recursive: true });
  execFileSync('unzip', ['-q', '-o', zip, '-d', base], { stdio: ['ignore', 'pipe', 'pipe'] });
  fs.renameSync(path.join(base, 'electron.exe'), path.join(base, first + '.exe'));
  writeApp(base, TARGETS[0].app);
  log('unpacked ' + base);

  const made = [];
  for (const t of TARGETS) {
    for (const name of [t.prefix + '_gui', t.prefix + 'x_gui']) {
      const dir = name === first ? base : copyAs(base, first, name);
      const exe = path.join(dir, name + '.exe');
      const size = fs.existsSync(exe) ? fs.statSync(exe).size : 0;
      log(name.padEnd(12) + size + ' B  ' + dir);
      made.push({ name: name, dir: dir, exe: exe, app: t.app });
    }
  }
  log('');
  log('packaged ' + made.length + ' shells');
  return made;
}

export { main };

if (process.argv[1] && process.argv[1].indexOf('build.mjs') >= 0) {
  main();
}
