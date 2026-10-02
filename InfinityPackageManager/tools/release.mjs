/*
 * release.mjs - assemble one version of InfinityPackageManager for publication.
 *
 * The layout matches Infinity Cloud and the older EasyVideo releases, so a
 * user who knows one tree knows all of them:
 *
 *   release-files/<version>/<platform>/
 *     InfinityPackageManager_<platform>.zip              portable, no installer
 *     InfinityPackageManager_<platform>_zip_hash.txt
 *     InfinityPackageManager_<platform>_setup.exe        NSIS installer
 *     InfinityPackageManager_<platform>_setup-exe_hash.txt
 *     InfinityPackageManager_<platform>_setup.msi        MSI installer
 *     InfinityPackageManager_<platform>_setup-msi_hash.txt
 *     sourcecode_<platform>.zip                     the data files
 *     sourcecode_hash.txt
 *
 * The portable zip is not just the executable: the catalogue, the release
 * index and the language files are read from disk at startup, so a zip
 * holding only ipm.exe would start and find nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const NL = String.fromCharCode(10);
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const APP = path.join(ROOT, 'InfinityPackageManager');
const BUILD = path.join(ROOT, 'build');
const STAGE = path.join(BUILD, 'stage');
const RELEASE = path.join(ROOT, 'release-files');
const SEVEN = 'D:/temp/tools/7za.exe';

/*
 * The published platforms.
 *
 * The Windows rows carry installers; the rest are portable only, because an
 * MSI and an NSIS setup are Windows formats by definition.
 */
const PLATFORMS = [
  { id: 'win64',       target: 'win-x64',      kind: 'win',  exe: 'ipm.exe' },
  { id: 'winx86',      target: 'win-ia32',     kind: 'win',  exe: 'ipm.exe' },
  { id: 'win-arm64',   target: 'win-arm64',    kind: 'win',  exe: 'ipm.exe' },
  { id: 'linux',       target: 'linux-x64',    kind: 'unix', exe: 'ipm' },
  { id: 'linux-arm64', target: 'linux-arm64',  kind: 'unix', exe: 'ipm' },
  { id: 'mac',         target: 'darwin-x64',   kind: 'unix', exe: 'ipm' },
  { id: 'mac-arm64',   target: 'darwin-arm64', kind: 'unix', exe: 'ipm' }
];

/*
 * Everything the program reads at startup. Left out on purpose:
 *
 *   registry.json.old   a backup the app makes for itself
 *   *.zip, *_Setup.exe  distribution artefacts, not payload
 *   history.txt         a transcript, not part of the program
 */
const PAYLOAD = [
  'applist.json','url.json','registry.json','settings.json',
  'pak.json','.ipm-versions.json','update.js','aria2c.exe'
];

function log(m) { process.stdout.write(m + NL); }

function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

/* "<hash>  <name>", the shape sha256sum -c and certutil both accept. */
function hashFor(target, hashName) {
  fs.writeFileSync(path.join(path.dirname(target), hashName),
    sha256(target) + '  ' + path.basename(target) + NL, 'utf8');
}

function zipDir(dir, outZip) {
  try { fs.rmSync(outZip, { force: true }); } catch (e) { }
  execFileSync(SEVEN, ['a', '-tzip', '-mx=9', outZip, '.'], { cwd: dir, stdio: 'ignore' });
}

/* A launcher, so a double click starts the program rather than a zip viewer. */
function writeLaunchers(dir, p) {
  if (p.kind === 'win') {
    const cmd = [
      '@echo off',
      'rem InfinityPackageManager',
      'cd /d "%~dp0"',
      '"%~dp0ipm.exe" %*',
      ''
    ].join(CRLF);
    fs.writeFileSync(path.join(dir, 'ipm.cmd'), cmd, 'utf8');
    return;
  }
  /*
   * No launcher on Unix. The executable is already named ipm and already has
   * the execute bit, so a shell script of the same name would replace the
   * 117 MB program with a two-line shim - which is exactly what happened
   * once, and why the portable zip for Linux was 2.4 MB instead of 40.
   */
}

/*
 * The portable payload.
 *
 * The executable is not enough on its own: applist.json, url.json and the
 * lang directory are read from beside it. A zip with only ipm.exe starts
 * and reports an empty catalogue.
 */
function stagePortable(p, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const src = path.join(BUILD, 'out', p.target, p.exe);
  if (!fs.existsSync(src)) throw new Error('the build is missing: ' + src);
  const exe = path.join(dest, p.exe);
  fs.copyFileSync(src, exe);
  if (p.kind === 'unix') { try { fs.chmodSync(exe, 0o755); } catch (e) { } }
  for (const f of PAYLOAD) {
    const from = path.join(APP, f);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dest, f));
  }
  const lang = path.join(APP, 'lang');
  if (fs.existsSync(lang)) fs.cpSync(lang, path.join(dest, 'lang'), { recursive: true });
  writeLaunchers(dest, p);
  fs.writeFileSync(path.join(dest, 'README.txt'), [
    'InfinityPackageManager - portable',
    '',
    '  ipm list             list every available package',
    '  ipm search <word>    search the catalogue',
    '  ipm install <name>   install a package',
    '  ipm cli              the interactive shell',
    '  ipm help             everything else',
    ''
  ].join(NL), 'utf8');
}

/* The data-only payload, identical on every platform. */
function stageSource(dest, version) {
  fs.mkdirSync(dest, { recursive: true });
  for (const f of PAYLOAD) {
    const from = path.join(APP, f);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dest, f));
  }
  const lang = path.join(APP, 'lang');
  if (fs.existsSync(lang)) fs.cpSync(lang, path.join(dest, 'lang'), { recursive: true });
  const nsi = path.join(ROOT, 'nsis.nsi');
  if (fs.existsSync(nsi)) fs.copyFileSync(nsi, path.join(dest, 'nsis.nsi'));
  fs.writeFileSync(path.join(dest, 'VERSION.txt'), version + NL, 'utf8');
}

function main() {
  const version = process.argv[2] || 'v1.0pre1';
  const outDir = path.join(RELEASE, version);
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  log('version ' + version);
  log('');

  const srcDir = path.join(STAGE, 'source');
  stageSource(srcDir, version);
  const missing = [];

  for (const p of PLATFORMS) {
    const dir = path.join(outDir, p.id);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) {
      try { fs.rmSync(path.join(dir, f), { force: true, recursive: true }); } catch (e) { }
    }

    // 1. the portable zip
    const portable = path.join(STAGE, 'portable-' + p.id);
    stagePortable(p, portable);
    const zip = path.join(dir, 'InfinityPackageManager_' + p.id + '.zip');
    zipDir(portable, zip);
    hashFor(zip, 'InfinityPackageManager_' + p.id + '_zip_hash.txt');

    // 2. the data-only source zip, the same bytes on every platform
    const sz = path.join(dir, 'sourcecode_' + p.id + '.zip');
    zipDir(srcDir, sz);
    hashFor(sz, 'sourcecode_hash.txt');

    // 3. the two installers, Windows only
    if (p.kind === 'win') {
      const setupSrc = path.join(BUILD, 'setup', p.id + '.exe');
      const setup = path.join(dir, 'InfinityPackageManager_' + p.id + '_setup.exe');
      if (fs.existsSync(setupSrc)) {
        fs.copyFileSync(setupSrc, setup);
        hashFor(setup, 'InfinityPackageManager_' + p.id + '_setup-exe_hash.txt');
      } else missing.push(p.id + ' setup.exe');

      const msiSrc = path.join(BUILD, 'msi', p.id + '.msi');
      const msi = path.join(dir, 'InfinityPackageManager_' + p.id + '_setup.msi');
      if (fs.existsSync(msiSrc)) {
        fs.copyFileSync(msiSrc, msi);
        hashFor(msi, 'InfinityPackageManager_' + p.id + '_setup-msi_hash.txt');
      } else missing.push(p.id + ' setup.msi');
    }

    const made = fs.readdirSync(dir).sort();
    log(p.id.padEnd(13) + String(made.length) + ' files');
    for (const f of made) {
      log('  ' + f.padEnd(48) + String(fs.statSync(path.join(dir, f)).size).padStart(12));
    }
  }

  fs.rmSync(STAGE, { recursive: true, force: true });
  log('');
  if (missing.length) log('MISSING: ' + missing.join(', '));
  log('release written to ' + outDir);
}

export { main };

if (process.argv[1] && process.argv[1].indexOf('release.mjs') >= 0) {
  main();
}

