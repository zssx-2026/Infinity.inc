/*
 * package.mjs - the shared helpers the release build uses.
 *
 * stageProgram  puts one executable, the two icons, the launchers and a short
 *               readme into a directory ready to be zipped or installed.
 * stageSource   copies the source tree into a directory for the source zip.
 * zipDir        makes a zip of a directory with 7-Zip.
 * hashFileFor   writes "<sha256>  <name>" beside a file, which is the format
 *               sha256sum -c reads on Linux and macOS and certutil produces on
 *               Windows. One shape, all three platforms.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const NL = String.fromCharCode(10);
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'build', 'out');
const SEVEN = 'D:/temp/tools/7za.exe';

/*
 * One entry per published platform.
 *
 * win64 and winx86 are the two Windows architectures people actually have.
 * The ARM builds are there because Windows on ARM and Apple silicon are no
 * longer curiosities, and a cloud drive that will not start on a new laptop
 * is not much of a cloud drive.
 */
export const PLATFORMS = [
  { id: 'win64',       target: 'win-x64',      kind: 'win',  exe: 'InfinityCloud.exe' },
  { id: 'winx86',      target: 'win-ia32',     kind: 'win',  exe: 'InfinityCloud.exe' },
  { id: 'win-arm64',   target: 'win-arm64',    kind: 'win',  exe: 'InfinityCloud.exe' },
  { id: 'linux',       target: 'linux-x64',    kind: 'unix', exe: 'InfinityCloud' },
  { id: 'linux-arm64', target: 'linux-arm64',  kind: 'unix', exe: 'InfinityCloud' },
  { id: 'mac',         target: 'darwin-x64',   kind: 'unix', exe: 'InfinityCloud' },
  { id: 'mac-arm64',   target: 'darwin-arm64', kind: 'unix', exe: 'InfinityCloud' }
];

function run(exe, args, cwd) {
  try {
    return execFileSync(exe, args, { cwd: cwd || ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) || '';
  } catch (e) {
    const msg = String((e.stderr || '') + (e.stdout || '') + (e.message || ''));
    throw new Error(path.basename(exe) + ' failed:' + NL + msg.slice(0, 900));
  }
}

export function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/* "<hash>  <name>" beside the file, named after it. */
export function hashFileFor(file) {
  const base = path.basename(file);
  const stem = base.replace(/\.(exe|msi|zip|sh|run|gz|tar)$/i, '');
  const out = path.join(path.dirname(file), stem + '_hash.txt');
  fs.writeFileSync(out, sha256(file) + '  ' + base + NL, 'utf8');
  return out;
}

export function zipDir(dir, outZip) {
  fs.mkdirSync(path.dirname(outZip), { recursive: true });
  try { fs.rmSync(outZip, { force: true }); } catch (e) { }
  run(SEVEN, ['a', '-tzip', '-mx=9', outZip, '.'], dir);
}

/*
 * The launcher.
 *
 * On Windows a .cmd shim, because that is what a double click runs. On Unix a
 * shell script with the executable bit set, because that is what a terminal
 * runs. Both do the same two things: find their own directory, hand the
 * arguments to the real binary.
 */
export function writeLauncher(dir, platform) {
  if (platform.kind === 'win') {
    const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
    const inc = [
      '@echo off',
      'rem Infinity Cloud',
      'cd /d "%~dp0"',
      'if "%~1"=="" ( "%~dp0InfinityCloud.exe" tui ) else ( "%~dp0InfinityCloud.exe" %* )',
      ''
    ].join(CRLF);
    fs.writeFileSync(path.join(dir, 'inc.cmd'), inc, 'utf8');
    fs.writeFileSync(path.join(dir, 'ifm.cmd'),
      '@echo off' + CRLF + 'cd /d "%~dp0"' + CRLF + '"%~dp0InfinityCloud.exe" ifm' + CRLF, 'utf8');
    return;
  }

  const inc = [
    '#!/bin/sh',
    '# Infinity Cloud',
    'DIR=$(cd "$(dirname "$0")" && pwd)',
    'if [ $# -eq 0 ]; then',
    '  exec "$DIR/InfinityCloud" tui',
    'else',
    '  exec "$DIR/InfinityCloud" "$@"',
    'fi',
    ''
  ].join(NL);
  const p1 = path.join(dir, 'inc');
  fs.writeFileSync(p1, inc, 'utf8');
  try { fs.chmodSync(p1, 0o755); } catch (e) { }

  const p2 = path.join(dir, 'ifm');
  fs.writeFileSync(p2, '#!/bin/sh' + NL + 'DIR=$(cd "$(dirname "$0")" && pwd)' + NL +
    'exec "$DIR/InfinityCloud" ifm' + NL, 'utf8');
  try { fs.chmodSync(p2, 0o755); } catch (e) { }
}

export function stageProgram(platform, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const src = path.join(OUT, platform.target, platform.exe);
  if (!fs.existsSync(src)) throw new Error('missing build: ' + src);
  const exe = path.join(dest, platform.exe);
  fs.copyFileSync(src, exe);
  if (platform.kind === 'unix') { try { fs.chmodSync(exe, 0o755); } catch (e) { } }

  fs.copyFileSync(path.join(ROOT, 'assets', 'inc.ico'), path.join(dest, 'inc.ico'));
  fs.copyFileSync(path.join(ROOT, 'assets', 'ifm.ico'), path.join(dest, 'ifm.ico'));
  writeLauncher(dest, platform);

  fs.writeFileSync(path.join(dest, 'README.txt'),
    'Infinity Cloud' + NL + NL +
    '  inc              the interface' + NL +
    '  inc cli          the command line' + NL +
    '  inc ifm          the file manager' + NL + NL +
    '  InfinityCloud --version' + NL +
    '  InfinityCloud install     install for this user' + NL +
    '  InfinityCloud repair      check every file against its hash' + NL +
    '  InfinityCloud uninstall' + NL, 'utf8');
}

export function stageSource(dest) {
  fs.mkdirSync(dest, { recursive: true });
  const copy = (rel) => {
    const from = path.join(ROOT, rel);
    if (!fs.existsSync(from)) return;
    fs.cpSync(from, path.join(dest, rel), { recursive: true });
  };
  for (const rel of ['src', 'tools', 'bin', 'assets']) copy(rel);
  for (const rel of ['package.json', 'VERSIONS.md']) copy(rel);
}

export { run };
