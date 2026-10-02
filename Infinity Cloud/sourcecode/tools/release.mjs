/*
 * release.mjs - assemble one version's release directory.
 *
 * Every artefact lands in release-files/<version>/<platform>/, and every
 * artefact gets a hash file beside it. The hash names follow one rule: take
 * the artefact name, drop the extension, append "_hash.txt" - except that
 * "setup.exe" and "setup.msi" keep their suffix, so the two installers in one
 * directory never end up naming the same hash file.
 *
 *   InfinityCloud_win64.zip          InfinityCloud_win64_zip_hash.txt
 *   InfinityCloud_win64_setup.exe    InfinityCloud_win64_setup-exe_hash.txt
 *   InfinityCloud_win64_setup.msi    InfinityCloud_win64_setup-msi_hash.txt
 *   sourcecode_win64.zip             sourcecode_hash.txt
 *
 * The portable zip is the application on its own: no installer, no registry
 * writes, no uninstaller. Someone who wants to run it from a USB stick should
 * not have to install anything first.
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
const PROJECT = path.resolve(ROOT, '..');
const BUILD = path.join(ROOT, 'build');
const STAGE = path.join(BUILD, 'stage');
const RELEASE = path.join(PROJECT, 'release-files');
const SEVEN = 'D:/temp/tools/7za.exe';

const PLATFORMS = [
  { id: 'win64',       target: 'win-x64',      kind: 'win',  exe: 'InfinityCloud.exe' },
  { id: 'winx86',      target: 'win-ia32',     kind: 'win',  exe: 'InfinityCloud.exe' },
  { id: 'win-arm64',   target: 'win-arm64',    kind: 'win',  exe: 'InfinityCloud.exe' },
  { id: 'linux',       target: 'linux-x64',    kind: 'unix', exe: 'InfinityCloud' },
  { id: 'linux-arm64', target: 'linux-arm64',  kind: 'unix', exe: 'InfinityCloud' },
  { id: 'mac',         target: 'darwin-x64',   kind: 'unix', exe: 'InfinityCloud' },
  { id: 'mac-arm64',   target: 'darwin-arm64', kind: 'unix', exe: 'InfinityCloud' }
];

function log(m) { process.stdout.write(m + NL); }

function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function hashFor(target, hashName) {
  const out = path.join(path.dirname(target), hashName);
  fs.writeFileSync(out, sha256(target) + '  ' + path.basename(target) + NL, 'utf8');
  return out;
}

function zipDir(dir, outZip) {
  try { fs.rmSync(outZip, { force: true }); } catch (e) { }
  execFileSync(SEVEN, ['a', '-tzip', '-mx=9', outZip, '.'], { cwd: dir, stdio: 'ignore' });
}
/*
 * A launcher: a .cmd on Windows, a shell script elsewhere.
 */
function writeLaunchers(dir, p) {
  if (p.kind === 'win') {
    const cmd = [
      '@echo off', 'set NODE_OPTIONS=',
      'rem Infinity Cloud',
      'cd /d "%~dp0"',
      'if "%~1"=="" ( "%~dp0' + p.exe + '" tui ) else ( "%~dp0' + p.exe + '" %* )',
      ''
    ].join(CRLF);
    fs.writeFileSync(path.join(dir, 'inc.cmd'), cmd, 'utf8');
    fs.writeFileSync(path.join(dir, 'ifm.cmd'),
      '@echo off' + CRLF + 'set NODE_OPTIONS=' + CRLF + 'cd /d "%~dp0"' + CRLF + '"%~dp0' + p.exe + '" ifm' + CRLF, 'utf8');
    return;
  }
  const sh = '#!/bin/sh' + NL + 'DIR=$(cd "$(dirname "$0")" && pwd)' + NL +
    'if [ $# -eq 0 ]; then exec "$DIR/' + p.exe + '" tui; else exec "$DIR/' + p.exe + '" "$@"; fi' + NL;
  const a = path.join(dir, 'inc');
  fs.writeFileSync(a, sh, 'utf8');
  try { fs.chmodSync(a, 0o755); } catch (e) { }
  const b = path.join(dir, 'ifm');
  fs.writeFileSync(b, '#!/bin/sh' + NL + 'exec "$(dirname "$0")/' + p.exe + '" ifm' + NL, 'utf8');
  try { fs.chmodSync(b, 0o755); } catch (e) { }
}

/* The portable payload: the executable, both icons, launchers, a readme. */
function stagePortable(p, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const src = path.join(BUILD, 'out', p.target, p.exe);
  if (!fs.existsSync(src)) throw new Error('the build is missing: ' + src);
  const exe = path.join(dest, p.exe);
  fs.copyFileSync(src, exe);
  if (p.kind === 'unix') { try { fs.chmodSync(exe, 0o755); } catch (e) { } }
  fs.copyFileSync(path.join(ROOT, 'assets', 'inc.ico'), path.join(dest, 'inc.ico'));
  fs.copyFileSync(path.join(ROOT, 'assets', 'ifm.ico'), path.join(dest, 'ifm.ico'));
  writeLaunchers(dest, p);
  const readme = [
    'Infinity Cloud - portable',
    '',
    '  inc                 open the interface',
    '  inc cli             open the command line',
    '  inc ifm             open the file manager',
    '',
    '  install, repair and uninstall also work from here.',
    '',
    '  Infinity.Inc',
    ''
  ].join(NL);
  fs.writeFileSync(path.join(dest, 'README.txt'), readme, 'utf8');
}

/* The source payload, identical for every platform. */
function stageSource(dest, version) {
  fs.mkdirSync(dest, { recursive: true });
  const copy = (rel) => {
    const from = path.join(ROOT, rel);
    if (!fs.existsSync(from)) return;
    fs.cpSync(from, path.join(dest, rel), { recursive: true });
  };
  for (const rel of ['src', 'tools', 'bin', 'assets']) copy(rel);
  for (const rel of ['package.json', 'VERSIONS.md']) copy(rel);
  const nsi = path.join(PROJECT, 'installer.nsi');
  if (fs.existsSync(nsi)) fs.copyFileSync(nsi, path.join(dest, 'installer.nsi'));
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
      try { fs.rmSync(path.join(dir, f), { force: true }); } catch (e) { }
    }
    const portable = path.join(STAGE, 'portable-' + p.id);
    stagePortable(p, portable);
    const zip = path.join(dir, 'InfinityCloud_' + p.id + '.zip');
    zipDir(portable, zip);
    hashFor(zip, 'InfinityCloud_' + p.id + '_zip_hash.txt');
    const sz = path.join(dir, 'sourcecode_' + p.id + '.zip');
    zipDir(srcDir, sz);
    hashFor(sz, 'sourcecode_hash.txt');
    if (p.kind === 'win') {
      const setupSrc = path.join(BUILD, 'setup', p.id + '.exe');
      const setup = path.join(dir, 'InfinityCloud_' + p.id + '_setup.exe');
      if (fs.existsSync(setupSrc)) {
        fs.copyFileSync(setupSrc, setup);
        hashFor(setup, 'InfinityCloud_' + p.id + '_setup-exe_hash.txt');
      } else missing.push(p.id + ' setup.exe');
      const msiSrc = path.join(BUILD, 'msi', p.id + '.msi');
      const msi = path.join(dir, 'InfinityCloud_' + p.id + '_setup.msi');
      if (fs.existsSync(msiSrc)) {
        fs.copyFileSync(msiSrc, msi);
        hashFor(msi, 'InfinityCloud_' + p.id + '_setup-msi_hash.txt');
      } else missing.push(p.id + ' setup.msi');
    }
    const made = fs.readdirSync(dir).sort();
    log(p.id.padEnd(13) + String(made.length) + ' files');
    for (const f of made) {
      log('  ' + f.padEnd(46) + String(fs.statSync(path.join(dir, f)).size).padStart(12));
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
