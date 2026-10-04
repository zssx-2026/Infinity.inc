/*
 * release.mjs - assemble one version's release directory.
 *
 * Every artefact lands in release-files/<version>/<platform>/, and every
 * artefact gets a hash file beside it. The hash names follow one rule: take
 * the artefact name, drop the extension, append "_hash.txt" - except that
 * "setup.exe" and "setup.msi" keep their suffix, so the two installers in one
 * directory never end up naming the same hash file.
 *
 *   InfinityFileManager_win64.zip          InfinityFileManager_win64_zip_hash.txt
 *   InfinityFileManager_win64_setup.exe    InfinityFileManager_win64_setup-exe_hash.txt
 *   InfinityFileManager_win64_setup.msi    InfinityFileManager_win64_setup-msi_hash.txt
 *   sourcecode_win64.zip             sourcecode_hash.txt
 *
 * The portable zip is the application on its own: no installer, no registry
 * writes, no uninstaller. Someone who wants to run it from a USB stick should
 * not have to install anything first.
 *
 * The executable names inside that zip come from build-all.mjs, which is the
 * one place the naming convention lives. The old single
 * "InfinityFileManager.exe" is gone: the program ships as
 * <p>_cli / <p>_tui / <p>_launcher plus the administrator twins and the
 * Electron window, and every name is derived here rather than copied, so a
 * face added or renamed in the build shows up without an edit to this file.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { exeNames } from './build-all.mjs';
import { stageGui, hasGui } from '../../../shell/payload.mjs';

const NL = String.fromCharCode(10);
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PROJECT = path.resolve(ROOT, '..');
const BUILD = path.join(ROOT, 'build');
const STAGE = path.join(BUILD, 'stage');
const RELEASE = path.join(PROJECT, 'release-files');
const SEVEN = 'D:/temp/tools/7za.exe';

/* The executable names are not listed here: build-all.mjs derives them from
 * the target, and a name written down twice is a name that drifts. */
const PLATFORMS = [
  { id: 'win64',       target: 'win-x64',      kind: 'win'  },
  { id: 'winx86',      target: 'win-ia32',     kind: 'win'  },
  { id: 'win-arm64',   target: 'win-arm64',    kind: 'win'  },
  { id: 'linux',       target: 'linux-x64',    kind: 'unix' },
  { id: 'linux-arm64', target: 'linux-arm64',  kind: 'unix' },
  { id: 'mac',         target: 'darwin-x64',   kind: 'unix' },
  { id: 'mac-arm64',   target: 'darwin-arm64', kind: 'unix' }
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
  /* Both launchers point at the non-administrator launcher face, which is the
   * one a double click should get. */
  const launcher = p.kind === 'win' ? 'ifm_launcher.exe' : 'ifm_launcher';
  if (p.kind === 'win') {
    const cmd = [
      '@echo off', 'set NODE_OPTIONS=',
      'rem Infinity File Manager',
      'cd /d "%~dp0"',
      '"%~dp0' + launcher + '" %*',
      ''
    ].join(CRLF);
    fs.writeFileSync(path.join(dir, 'ifm.cmd'), cmd, 'utf8');
    return;
  }
  const sh = '#!/bin/sh' + NL + 'DIR=$(cd "$(dirname "$0")" && pwd)' + NL +
    'exec "$DIR/' + launcher + '" "$@"' + NL;
  const a = path.join(dir, 'ifm');
  fs.writeFileSync(a, sh, 'utf8');
  try { fs.chmodSync(a, 0o755); } catch (e) { }
}

/* The portable payload: the executable, both icons, launchers, a readme. */
function stagePortable(p, dest) {
  fs.mkdirSync(dest, { recursive: true });
  /* Every face the build made for this target, under the build's own names. */
  for (const name of exeNames({ id: p.target })) {
    const src = path.join(BUILD, 'out', p.target, name);
    if (!fs.existsSync(src)) throw new Error('the build is missing: ' + src);
    const exe = path.join(dest, name);
    fs.copyFileSync(src, exe);
    if (p.kind === 'unix') { try { fs.chmodSync(exe, 0o755); } catch (e) { } }
  }
  /* The window is an Electron directory, not a file; the shell helper knows
   * its shape, and a target without a window build is skipped quietly. */
  if (p.kind === 'win' && hasGui('ifm', p.target)) stageGui(dest, 'ifm', p.target);
  fs.copyFileSync(path.join(ROOT, 'assets', 'ifm.ico'), path.join(dest, 'ifm.ico'));
  writeLaunchers(dest, p);
  const readme = [
    'Infinity File Manager - portable',
    '',
    '  ifm                 open the two-pane window',
    '  ifm mount           mount the cloud as a drive letter',
    '  ifm unmount         remove that drive',
    '  ifm install         install for the current user',
    '  ifm repair          check every installed file',
    '  ifm uninstall       remove it',
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
  const version = process.argv[2] || 'v1.0pre2';
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
    const zip = path.join(dir, 'InfinityFileManager_' + p.id + '.zip');
    zipDir(portable, zip);
    hashFor(zip, 'InfinityFileManager_' + p.id + '_zip_hash.txt');
    const sz = path.join(dir, 'sourcecode_' + p.id + '.zip');
    zipDir(srcDir, sz);
    hashFor(sz, 'sourcecode_hash.txt');
    if (p.kind === 'win') {
      const setupSrc = path.join(BUILD, 'setup', p.id + '.exe');
      const setup = path.join(dir, 'InfinityFileManager_' + p.id + '_setup.exe');
      if (fs.existsSync(setupSrc)) {
        fs.copyFileSync(setupSrc, setup);
        hashFor(setup, 'InfinityFileManager_' + p.id + '_setup-exe_hash.txt');
      } else missing.push(p.id + ' setup.exe');
      const msiSrc = path.join(BUILD, 'msi', p.id + '.msi');
      const msi = path.join(dir, 'InfinityFileManager_' + p.id + '_setup.msi');
      if (fs.existsSync(msiSrc)) {
        fs.copyFileSync(msiSrc, msi);
        hashFor(msi, 'InfinityFileManager_' + p.id + '_setup-msi_hash.txt');
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
