/*
 * build-all.mjs - produce the InfinityPackageManager executables for every platform.
 *
 * The source tree is gone; what survives is bundle.js, which is already the
 * exact CommonJS entry a SEA needs. So the build is one preparation blob and
 * one injection per platform - and then the naming layer.
 *
 * Infinity.Inc ships each application as a family of executables that differ
 * only by name. The program reads its own file name to decide what to do:
 *
 *   ipm_cli        command line        ipmx_cli        elevated command line
 *   ipm_tui        terminal UI         ipmx_tui        elevated terminal UI
 *   ipm_gui        graphical UI        ipmx_gui        elevated graphical UI
 *   ipm_launcher   launcher            ipmx_launcher   elevated launcher
 *
 * The eight are byte identical, so seven of them are hard links to the first.
 * That keeps a full platform at one executable's worth of disk instead of
 * eight, while still giving each name a real file on the system.
 *
 * Targets, and why these seven:
 *
 *   win-x64     the ordinary Windows desktop
 *   win-ia32    32-bit Windows, still common in schools and offices
 *   win-arm64   Windows on ARM, the Surface and Snapdragon laptops
 *   linux-x64   the default Linux server and desktop
 *   linux-arm64 Raspberry Pi and ARM servers
 *   darwin-x64  Intel Macs
 *   darwin-arm64 Apple silicon
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execFileSync } from 'node:child_process';

const NL = String.fromCharCode(10);
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const APP = path.join(ROOT, 'InfinityPackageManager');
const WORK = path.join(ROOT, 'build');
const OUT = path.join(WORK, 'out');
const RUNTIMES = 'D:/temp/tools/runtimes';

const POSTJECT = [
  'C:/Users/REDMI/AppData/Roaming/npm/node_modules/postject/dist/cli.js',
  'C:/Users/REDMI/AppData/Roaming/npm/node_modules/postject/cli.js'
].filter(function (p) { return fs.existsSync(p); })[0] || null;

export const TARGETS = [
  { id: 'win-x64',     runtime: 'win-x64/node-v22.11.0-win-x64/node.exe',         exe: 'ipm.exe' },
  { id: 'win-ia32',    runtime: 'win-ia32/node-v22.11.0-win-x86/node.exe',        exe: 'ipm.exe' },
  { id: 'win-arm64',   runtime: 'win-arm64/node-v22.11.0-win-arm64/node.exe',     exe: 'ipm.exe' },
  { id: 'linux-x64',   runtime: 'linux-x64/node-v22.11.0-linux-x64/bin/node',     exe: 'ipm' },
  { id: 'linux-arm64', runtime: 'linux-arm64/node-v22.11.0-linux-arm64/bin/node', exe: 'ipm' },
  { id: 'darwin-x64',  runtime: 'darwin-x64/node-v22.11.0-darwin-x64/bin/node',   exe: 'ipm' },
  { id: 'darwin-arm64',runtime: 'darwin-arm64/node-v22.11.0-darwin-arm64/bin/node', exe: 'ipm' }
];

/* The naming layer. Two prefixes - the plain one and the elevated one - and
 * four modes each, in the order the launcher lists them. */
export const PREFIXES = [
  { prefix: 'ipm',  admin: false },
  { prefix: 'ipmx', admin: true }
];
export const MODES = ['cli', 'tui', 'launcher'];

export function exeNames(target) {
  const ext = target.id.indexOf('win') === 0 ? '.exe' : '';
  const out = [];
  for (const p of PREFIXES) for (const m of MODES) out.push(p.prefix + '_' + m + ext);
  return out;
}

function log(m) { process.stdout.write(m + NL); }

function run(exe, args, label) {
  try {
    return execFileSync(exe, args, {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 67108864,
      stdio: ['ignore', 'pipe', 'pipe']
    }) || '';
  } catch (e) {
    const msg = String((e.stderr || '') + (e.stdout || '') + (e.message || ''));
    throw new Error(label + ' failed:' + NL + msg.slice(0, 900));
  }
}

/*
 * The blob is built once and injected per platform. It is architecture
 * independent, which is the whole reason seven targets cost one bundle plus
 * seven copies rather than seven bundles.
 */
function makeBlob() {
  fs.mkdirSync(WORK, { recursive: true });
  const entry = path.join(APP, 'bundle.js');
  if (!fs.existsSync(entry)) throw new Error('the bundle is missing: ' + entry);

  const cfg = path.join(WORK, 'sea-config.json');
  fs.writeFileSync(cfg, JSON.stringify({
    main: entry,
    output: path.join(WORK, 'ipm.blob'),
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false
  }, null, 2), 'utf8');

  run('D:/temp/tools/node.exe', ['--experimental-sea-config', cfg], 'sea-config');
  const blob = path.join(WORK, 'ipm.blob');
  if (!fs.existsSync(blob)) throw new Error('the blob was not produced');
  log('blob    ' + fs.statSync(blob).size + ' B');
  return blob;
}

/* One real executable, then hard links for the other names. A hard link is
 * the same file under a second name, so the eight cost one file; if the
 * filesystem refuses (a non-NTFS share, say) a copy is made instead. */
function inject(target, blob) {
  const src = path.join(RUNTIMES, target.runtime);
  if (!fs.existsSync(src)) throw new Error('runtime missing: ' + src);
  const dir = path.join(OUT, target.id);
  fs.mkdirSync(dir, { recursive: true });

  const unix = target.id.indexOf('linux') === 0 || target.id.indexOf('darwin') === 0;
  const names = exeNames(target);
  const primary = path.join(dir, names[0]);
  fs.copyFileSync(src, primary);
  if (unix) { try { fs.chmodSync(primary, 0o755); } catch (e) { } }

  if (!POSTJECT) throw new Error('postject is not installed');
  run(process.execPath, [POSTJECT, primary, 'NODE_SEA_BLOB', blob,
    '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'], 'postject ' + target.id);

  const made = [primary];
  for (const name of names.slice(1)) {
    const dst = path.join(dir, name);
    try { fs.rmSync(dst, { force: true }); } catch (e) { }
    try { fs.linkSync(primary, dst); }
    catch (e) {
      fs.copyFileSync(primary, dst);
      if (unix) { try { fs.chmodSync(dst, 0o755); } catch (e2) { } }
    }
    made.push(dst);
  }
  return made;
}

function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const blob = makeBlob();
  log('');
  const built = [];
  for (const t of TARGETS) {
    const exes = inject(t, blob);
    const size = fs.statSync(exes[0]).size;
    log(t.id.padEnd(13) + size + ' B  x' + exes.length);
    built.push({ target: t, exes: exes, size: size });
  }
  log('');
  log('built ' + built.length + ' of ' + TARGETS.length);
  return built;
}

export { main, makeBlob, inject };

if (process.argv[1] && process.argv[1].indexOf('build-all') >= 0) {
  main();
}
