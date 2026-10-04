/*
 * package.mjs - build the C++ installers from the self-contained executables.
 *
 * The C++ program needs no runtime: the payload is only its eight names.
 * NSIS itself is used to make the installer and uninstaller, without a
 * plug-in or a DLL. No icons are assumed - they will be picked up when the
 * user supplies them, but they are not a build prerequisite.
 *
 * Build results live in cpp/release/<version>/ until the publication step
 * succeeds. Build/cache files remain under cpp/build and are not published.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BUILD = path.join(ROOT, 'build');
/* The release this run belongs to. The directory that holds the installers and
 * the version carried by their file names both come from here, so a new
 * pre-release is one edit rather than a search: v1.0pre4 -> 1.0.0-pre4.
 * Either value can be overridden from the environment for a one-off build. */
const RELEASE = process.env.INC_RELEASE || 'v1.0pre4';
const VERSION = process.env.INC_VERSION || '1.0.0-pre4';
const OUT = path.join(ROOT, 'release', RELEASE);
const MAKENSIS = 'C:/Program Files (x86)/NSIS/makensis.exe';

/* The faces are listed per application: the terminal interface was dropped
 * from every application, and Infinity Installer Manager ships without the
 * launcher as well. The name is the whole configuration, so the list differs
 * from one application to the next. */
const APPS = [
  { dir: 'inc', prefix: 'inc', admin: 'inx', product: 'Infinity Cloud', package: 'InfinityCloud', faces: ['cli', 'gui', 'launcher'] },
  { dir: 'ifm', prefix: 'ifm', admin: 'ifmx', product: 'Infinity File Manager', package: 'InfinityFileManager', faces: ['cli', 'gui', 'launcher'] },
  { dir: 'ipm', prefix: 'ipm', admin: 'ipmx', product: 'InfinityPackageManager', package: 'InfinityPackageManager', faces: ['cli', 'gui', 'launcher'] },
  { dir: 'iim', prefix: 'iim', admin: 'iimx', product: 'Infinity Installer Manager', package: 'InfinityInstallerManager', faces: ['cli', 'gui'] },
  { dir: 'int', prefix: 'int', admin: 'intx', product: 'Infinity Toolbox', package: 'InfinityToolbox', faces: ['cli', 'gui'] },
  { dir: 'ing', prefix: 'ing', admin: 'ingx', product: 'Infinity Games', package: 'InfinityGames', faces: ['cli', 'gui'] }
];

function run(exe, args, cwd) {
  return execFileSync(exe, args, {
    cwd: cwd || ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // makensis prints nothing at /V2, but a failing build can dump a lot, and
    // the 1 MB default surfaces as ENOBUFS instead of the real error.
    maxBuffer: 64 * 1024 * 1024
  });
}
function log(s) { process.stdout.write(s + '\n'); }

function nsiFor(app, payload, output) {
  const paths = [];
  for (const mode of app.faces) {
    paths.push({ env: app.prefix + mode, file: app.prefix + '_' + mode + '.exe' });
    paths.push({ env: app.admin + mode, file: app.admin + '_' + mode + '.exe' });
  }
  const copies = paths.map(function (x) { return '  File "' + x.file + '"'; }).join('\r\n');
  const regWrite = paths.map(function (x) {
    return '  WriteRegStr HKCU "Environment" "' + x.env + '" "$INSTDIR\\' + x.file + '"';
  }).join('\r\n');
  const regDelete = paths.map(function (x) {
    return '  DeleteRegValue HKCU "Environment" "' + x.env + '"';
  }).join('\r\n');
  const shortcut = app.prefix + '_' + (app.faces.indexOf('launcher') >= 0 ? 'launcher' : 'gui') + '.exe';
  const unkey = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Infinity.Inc.' + app.package;
  return [
    'Unicode true',
    '!include "MUI2.nsh"',
    '!include "LogicLib.nsh"',
    '!define PRODUCT "' + app.product + '"',
    '!define VERSION "' + VERSION + '"',
    '!define UNKEY "' + unkey + '"',
    '!define OUTFILE "' + output.replace(/\//g, '\\\\') + '"',
    'Name "${PRODUCT} ${VERSION}"',
    'OutFile "${OUTFILE}"',
    'InstallDir "$LOCALAPPDATA\\Programs\\Infinity.Inc\\${PRODUCT}"',
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
    copies,
    '  WriteUninstaller "$INSTDIR\\Uninstall.exe"',
    '  CreateDirectory "$SMPROGRAMS\\Infinity.Inc\\${PRODUCT}"',
    '  CreateShortCut "$SMPROGRAMS\\Infinity.Inc\\${PRODUCT}\\Open.lnk" "$INSTDIR\\' + shortcut + '"',
    '  CreateShortCut "$SMPROGRAMS\\Infinity.Inc\\${PRODUCT}\\Uninstall.lnk" "$INSTDIR\\Uninstall.exe"',
    regWrite,
    '  ReadRegStr $0 HKCU "Environment" "def_fm"',
    '  ${If} $0 == ""',
    '    WriteRegStr HKCU "Environment" "def_fm" "def"',
    '  ${EndIf}',
    '  ReadRegStr $0 HKCU "Environment" "proxy_ip"',
    '  ${If} $0 == ""',
    '    WriteRegStr HKCU "Environment" "proxy_ip" ""',
    '  ${EndIf}',
    '  WriteRegStr HKCU "${UNKEY}" "DisplayName" "${PRODUCT}"',
    '  WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "${VERSION}"',
    '  WriteRegStr HKCU "${UNKEY}" "InstallLocation" "$INSTDIR"',
    '  WriteRegStr HKCU "${UNKEY}" "UninstallString" "$INSTDIR\\Uninstall.exe"',
    '  WriteRegDWORD HKCU "${UNKEY}" "NoModify" 1',
    '  WriteRegDWORD HKCU "${UNKEY}" "NoRepair" 1',
    '  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000',
    'SectionEnd',
    '',
    'Section "Uninstall"',
    regDelete,
    '  DeleteRegKey HKCU "${UNKEY}"',
    '  Delete "$SMPROGRAMS\\Infinity.Inc\\${PRODUCT}\\Open.lnk"',
    '  Delete "$SMPROGRAMS\\Infinity.Inc\\${PRODUCT}\\Uninstall.lnk"',
    '  RMDir "$SMPROGRAMS\\Infinity.Inc\\${PRODUCT}"',
    '  RMDir /r "$INSTDIR"',
    '  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000',
    'SectionEnd',
    ''
  ].join('\r\n');
}

function stage(app) {
  const source = path.join(ROOT, 'out', app.dir);
  const dest = path.join(BUILD, 'installer-stage', app.dir);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const mode of app.faces) {
    for (const prefix of [app.prefix, app.admin]) {
      const name = prefix + '_' + mode + '.exe';
      const file = path.join(source, name);
      if (!fs.existsSync(file)) throw new Error('missing C++ output: ' + file);
      fs.copyFileSync(file, path.join(dest, name));
    }
  }
  return dest;
}

function main() {
  if (!fs.existsSync(MAKENSIS)) throw new Error('makensis is missing: ' + MAKENSIS);
  fs.mkdirSync(OUT, { recursive: true });
  const produced = [];

  for (const app of APPS) {
    const payload = stage(app);
    const output = path.join(OUT, app.package + '_' + VERSION + '_win64_setup.exe');
    const script = path.join(payload, 'setup.nsi');
    const text = nsiFor(app, payload, output);
    fs.writeFileSync(script, '\uFEFF' + text, 'utf8');
    try {
      run(MAKENSIS, ['/V2', '/INPUTCHARSET', 'UTF8', '/OUTPUTCHARSET', 'UTF8', script], payload);
    } catch (e) {
      throw new Error('makensis failed for ' + app.package + ': ' + String((e.stderr || '') + (e.stdout || '') + (e.message || '')).slice(0, 1200));
    }
    if (!fs.existsSync(output)) throw new Error('installer was not created: ' + output);
    const size = fs.statSync(output).size;
    log(app.package.padEnd(25) + size + ' B  ' + output);
    produced.push({ app: app.package, file: output, size: size, platform: 'win64' });
  }
  log('built ' + produced.length + ' self-contained installers');
  return produced;
}

export { main, APPS };

if (process.argv[1] && process.argv[1].indexOf('package.mjs') >= 0) {
  try { main(); } catch (e) { console.error(String(e && e.message ? e.message : e)); process.exit(1); }
}
