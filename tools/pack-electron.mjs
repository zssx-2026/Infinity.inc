#!/usr/bin/env node
/*
 * pack-electron.mjs - turn one of the Electron products into an NSIS setup,
 * without touching the C++ packager.
 *
 * The C++ suite has its own packager (cpp/tools/package.mjs) because those
 * products are a set of executables plus one shared shell folder. The two
 * Electron products - Infinity Studio and Infinity Server - are the other
 * shape: a single build tree (Chromium runtime, resources/app, one branded
 * executable) that has to land in the install directory exactly as built.
 *
 * Everything here is measured, not assumed: the payload is copied from the
 * product's build output, the executable is renamed in the copy, the setup is
 * compiled with the same NSIS profile the C++ installers use (per-user install
 * under %LOCALAPPDATA%, Unicode, solid LZMA, MUI2, SimpChinese), and the
 * finished file's size and sha256 are printed so the release notes and the
 * directory page can quote real numbers.
 *
 * Usage:
 *   node tools/pack-electron.mjs studio|server [--version 1.0.0-pre8]
 *                                             [--release v1.0pre8]
 *                                             [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WORK = path.join(ROOT, 'work', '_pack-electron');

/* One row per product. `exe` is the name the product's own build.mjs gives the
 * renamed electron.exe; `window` is the name the setup installs and the
 * shortcut points at. The two differ on purpose: the build output keeps the
 * historical *_gui name so existing scripts keep working, while what the user
 * sees in the install directory is the product's own name. */
const PRODUCTS = {
  studio: {
    dir: 'InfinityStudio',
    product: 'Infinity Studio',
    package: 'InfinityStudio',
    prefix: 'ist',
    icon: 'ist.ico',
    exe: 'infinitystudio_gui.exe',
    window: 'InfinityStudio.exe',
    out: 'InfinityStudio_<version>_win64_setup.exe',
    port: 7721
  },
  server: {
    dir: 'InfinityServer',
    product: 'Infinity Server',
    package: 'InfinityServer',
    prefix: 'isv',
    icon: 'isv.ico',
    exe: 'infinityserver_gui.exe',
    window: 'InfinityServer.exe',
    out: 'InfinityServer_<version>_win64_setup.exe',
    port: 7711
  }
};

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : fallback;
}

const which = process.argv[2];
if (!PRODUCTS[which]) {
  console.error('usage: node tools/pack-electron.mjs studio|server [--version X] [--release Y] [--dry-run]');
  process.exit(2);
}
const app = PRODUCTS[which];
const version = arg('version', process.env.INC_VERSION || '1.0.0-pre8');
const release = arg('release', process.env.INC_RELEASE || 'v1.0pre8');
const dry = process.argv.includes('--dry-run');

/* NSIS wants four numeric fields in VIProductVersion; the suite's versions are
 * semver with a -preN suffix, so the suffix becomes the fourth field. */
function versionQuad(v) {
  const main = (v.split('-')[0] || '1.0.0').split('.').map(function (n) { return parseInt(n, 10) || 0; });
  const pre = /pre(\d+)/i.exec(v);
  return [main[0] || 1, main[1] || 0, main[2] || 0, pre ? parseInt(pre[1], 10) : 0];
}

function sha256Of(file) {
  const h = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1024 * 1024);
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      h.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

function human(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(1)) + ' ' + units[i];
}

const buildDir = path.join(ROOT, app.dir, 'build', 'win-x64');
const srcExe = path.join(buildDir, app.exe);
if (!fs.existsSync(srcExe)) {
  console.error('missing build output: ' + srcExe + ' (run node ' + app.dir + '/build.mjs)');
  process.exit(3);
}
const iconPath = path.join(ROOT, 'icons', app.icon);
if (!fs.existsSync(iconPath)) {
  console.error('missing icon: ' + iconPath);
  process.exit(3);
}

const stage = path.join(WORK, app.prefix);
const payload = path.join(stage, 'payload');
const outDir = path.join(ROOT, 'cpp', 'release', release);
const outName = app.out.split('<version>').join(version);
const outFile = path.join(outDir, outName);
const nsiFile = path.join(stage, 'setup.nsi');

console.log('product  ' + app.product);
console.log('version  ' + version + '  (release ' + release + ')');
console.log('payload  ' + buildDir);
console.log('out      ' + outFile);

if (dry) {
  console.log('dry-run: nothing staged, nothing compiled');
  process.exit(0);
}

/* Stage a copy, never the build tree itself: the executable is renamed here,
 * and a build output that changed under the packager would otherwise make the
 * setup and the tree disagree. */
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(payload, { recursive: true });
const started = Date.now();
fs.cpSync(buildDir, payload, { recursive: true });
fs.renameSync(path.join(payload, app.exe), path.join(payload, app.window));
fs.copyFileSync(iconPath, path.join(payload, app.icon));
console.log('staged   ' + human(fs.statSync(path.join(payload, app.window)).size) + ' executable');

fs.mkdirSync(outDir, { recursive: true });

const quad = versionQuad(version).join('.');
const ico = iconPath.split('/').join(String.fromCharCode(92));
const unkey = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Infinity.Inc.' + app.package;
const smFolder = '$SMPROGRAMS\\Infinity.Inc\\' + app.product;
const payloadEsc = payload.split('/').join(String.fromCharCode(92));
const outEsc = outFile.split('/').join(String.fromCharCode(92));

/* The setup carries the product's own VERSIONINFO so Explorer, the Add/Remove
 * entry and the digital-signature tab all describe the same thing. The
 * uninstaller removes the whole install directory - it is the product's own
 * folder, created by this setup - together with the shortcuts and the
 * Add/Remove key. */
const nsi = [
  'Unicode true',
  '!include "MUI2.nsh"',
  '!include "LogicLib.nsh"',
  '!define PRODUCT "' + app.product + '"',
  '!define VERSION "' + version + '"',
  '!define MUI_ICON "' + ico + '"',
  '!define MUI_UNICON "' + ico + '"',
  '!define UNKEY "' + unkey + '"',
  'VIProductVersion "' + quad + '"',
  'VIAddVersionKey /LANG=2052 "ProductName" "' + app.product + '"',
  'VIAddVersionKey /LANG=2052 "CompanyName" "Infinity.Inc"',
  'VIAddVersionKey /LANG=2052 "FileDescription" "' + app.product + ' Setup"',
  'VIAddVersionKey /LANG=2052 "FileVersion" "' + version + '"',
  'VIAddVersionKey /LANG=2052 "ProductVersion" "' + version + '"',
  'VIAddVersionKey /LANG=2052 "LegalCopyright" "Copyright (C) Infinity.Inc"',
  'Name "\${PRODUCT} \${VERSION}"',
  'OutFile "' + outEsc + '"',
  'InstallDir "$LOCALAPPDATA\\Programs\\Infinity.Inc\\\${PRODUCT}"',
  'RequestExecutionLevel user',
  'SetCompressor /SOLID lzma',
  'ShowInstDetails nevershow',
  'ShowUninstDetails nevershow',
  '!insertmacro MUI_PAGE_DIRECTORY',
  '!insertmacro MUI_PAGE_INSTFILES',
  '!insertmacro MUI_UNPAGE_CONFIRM',
  '!insertmacro MUI_UNPAGE_INSTFILES',
  '!insertmacro MUI_LANGUAGE "SimpChinese"',
  '',
  'Section "Install" SEC_INSTALL',
  '  SetShellVarContext current',
  '  SetOutPath "$INSTDIR"',
  '  File /r "' + payloadEsc + '\\*.*"',
  '  WriteUninstaller "$INSTDIR\\Uninstall.exe"',
  '  CreateDirectory "' + smFolder + '"',
  '  CreateShortCut "' + smFolder + '\\Open.lnk" "$INSTDIR\\' + app.window + '" "" "$INSTDIR\\' + app.icon + '" 0',
  '  CreateShortCut "' + smFolder + '\\Uninstall.lnk" "$INSTDIR\\Uninstall.exe" "" "$INSTDIR\\' + app.icon + '" 0',
  '  WriteRegStr HKCU "\${UNKEY}" "DisplayName" "\${PRODUCT}"',
  '  WriteRegStr HKCU "\${UNKEY}" "DisplayVersion" "\${VERSION}"',
  '  WriteRegStr HKCU "\${UNKEY}" "DisplayIcon" "$INSTDIR\\' + app.icon + '"',
  '  WriteRegStr HKCU "\${UNKEY}" "InstallLocation" "$INSTDIR"',
  '  WriteRegStr HKCU "\${UNKEY}" "UninstallString" "$INSTDIR\\Uninstall.exe"',
  '  WriteRegStr HKCU "\${UNKEY}" "Publisher" "Infinity.Inc"',
  '  WriteRegDWORD HKCU "\${UNKEY}" "NoModify" 1',
  '  WriteRegDWORD HKCU "\${UNKEY}" "NoRepair" 1',
  'SectionEnd',
  '',
  'Section "Uninstall"',
  '  DeleteRegKey HKCU "\${UNKEY}"',
  '  Delete "' + smFolder + '\\Open.lnk"',
  '  Delete "' + smFolder + '\\Uninstall.lnk"',
  '  RMDir "' + smFolder + '"',
  '  RMDir "$SMPROGRAMS\\Infinity.Inc"',
  '  RMDir /r "$INSTDIR"',
  'SectionEnd',
  ''
].join('\r\n');

fs.writeFileSync(nsiFile, nsi, 'utf8');
console.log('nsi      ' + nsiFile + ' (' + Buffer.byteLength(nsi) + ' B)');

/* makensis is a wrapper on this machine; calling it by name lets PATH decide
 * which build is used, the same way the C++ packager does. */
console.log('compiling with solid LZMA ...');
const t0 = Date.now();
const out = execFileSync('makensis', [nsiFile], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const tail = out.trim().split(/\r?\n/).slice(-3).join(' | ');
console.log('makensis ' + tail);

const st = fs.statSync(outFile);
const sha = sha256Of(outFile);
console.log('');
console.log('PACK-OK ' + outName);
console.log('  bytes  ' + st.size + ' (' + human(st.size) + ')');
console.log('  sha256 ' + sha);
console.log('  elapsed ' + human(Date.now() - started) + ' staging+compile, compile ' + human(Date.now() - t0));
