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
/* Product icons live outside cpp/, at the repository root. The packaging step
 * copies icons/<app>.ico into the payload and wires it into NSIS; a missing
 * icon is an error rather than a silent default. */
const ICONS = path.resolve(ROOT, '..', 'icons');
/* The release this run belongs to. The directory that holds the installers and
 * the version carried by their file names both come from here, so a new
 * pre-release is one edit rather than a search: v1.0pre5 -> 1.0.0-pre5.
 * Either value can be overridden from the environment for a one-off build. */
const RELEASE = process.env.INC_RELEASE || 'v1.0pre5';
const VERSION = process.env.INC_VERSION || '1.0.0-pre5';
const OUT = path.join(ROOT, 'release', RELEASE);
const MAKENSIS = 'C:/Program Files (x86)/NSIS/makensis.exe';

/* The faces are listed per application: the terminal interface was dropped
 * from every application, and Infinity Toolbox ships without the launcher
 * as well. The name is the whole configuration, so the list differs
 * from one application to the next. */
const APPS = [
  { dir: 'inc', prefix: 'inc', admin: 'inx', product: 'Infinity Cloud', package: 'InfinityCloud', faces: ['cli', 'gui', 'launcher'] },
  { dir: 'ipm', prefix: 'ipm', admin: 'ipmx', product: 'InfinityPackageManager', package: 'InfinityPackageManager', faces: ['cli', 'gui', 'launcher'] },
  { dir: 'int', prefix: 'int', admin: 'intx', product: 'Infinity Toolbox', package: 'InfinityToolbox', faces: ['cli', 'gui'] }
];

/* INC_APPS limits a run to a comma-separated list of application directories
 * (for example INC_APPS=inc,ifm,ipm,int). Empty means every application. */
const ONLY = String(process.env.INC_APPS || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
function selected() {
  return ONLY.length ? APPS.filter(function (a) { return ONLY.indexOf(a.dir) >= 0; }) : APPS;
}

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

/* NSIS needs a four-number VIProductVersion. "1.0.0-pre5" is the fifth
 * pre-release of 1.0.0, so the fourth number is 5 - the same mapping
 * build.mjs uses for the payload FILEVERSION, so the installer's version
 * resource and the executables it carries agree. */
function versionQuad(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-pre(\d+))?$/.exec(String(v));
  if (!m) return [1, 0, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? Number(m[4]) : 0];
}

function nsiFor(app, payload, output) {
  const paths = [];
  for (const mode of app.faces) {
    paths.push({ env: app.prefix + mode, file: app.prefix + '_' + mode + '.exe' });
    paths.push({ env: app.admin + mode, file: app.admin + '_' + mode + '.exe' });
  }
  /* The product icon, when icons/<app>.ico is present: it is installed beside
   * the executables, so the shortcuts and the Add/Remove entry can point at it. */
  const iconName = app.dir + '.ico';
  const iconPath = path.join(payload, iconName);
  const hasIcon = fs.existsSync(iconPath);
  const iconAbs = iconPath.split('/').join(String.fromCharCode(92));
  const iconArgs = hasIcon ? ' "" "$INSTDIR' + String.fromCharCode(92) + iconName + '" 0' : '';
  const displayIcon = hasIcon
    ? '  WriteRegStr HKCU "${UNKEY}" "DisplayIcon" "$INSTDIR' + String.fromCharCode(92) + iconName + '"'
    : '';
  const iconFile = hasIcon ? '  File "' + iconName + '"' : '';
  const copies = paths.map(function (x) { return '  File "' + x.file + '"'; }).join('\r\n');
  /* A setup downloaded from a browser carries a Zone.Identifier stream, and a
   * file the setup drops can carry one too. NSIS's own Delete cannot remove a
   * named stream - it asks the filesystem about the path and an ADS path reads
   * as absent - so the call goes straight to kernel32::DeleteFileW through
   * System::Call. System.dll is part of NSIS itself: no file is carried beside
   * the installer and nothing is downloaded. */
  const unblock = paths.map(function (x) {
    return "  System::Call 'kernel32::DeleteFileW(w \"$INSTDIR\\" + x.file + ":Zone.Identifier\") i .r2'";
  }).concat([
    "  System::Call 'kernel32::DeleteFileW(w \"$INSTDIR\\Uninstall.exe:Zone.Identifier\") i .r2'",
    "  System::Call 'kernel32::DeleteFileW(w \"$EXEPATH:Zone.Identifier\") i .r2'"
  ]).join('\r\n');
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
    '!define MUI_ICON "' + iconAbs + '"',
    '!define MUI_UNICON "' + iconAbs + '"',
    '!define VERSION "' + VERSION + '"',
    '!define UNKEY "' + unkey + '"',
    /* The installer's own properties page. Without these the setup executable
     * has no VERSIONINFO and Explorer shows no version, company or copyright.
     * /LANG=2052 matches the installer UI language (SimpChinese). */
    'VIProductVersion "' + versionQuad(VERSION).join('.') + '"',
    'VIAddVersionKey /LANG=2052 "ProductName" "' + app.product + '"',
    'VIAddVersionKey /LANG=2052 "CompanyName" "Infinity.Inc"',
    'VIAddVersionKey /LANG=2052 "FileDescription" "' + app.product + ' Setup"',
    'VIAddVersionKey /LANG=2052 "FileVersion" "' + VERSION + '"',
    'VIAddVersionKey /LANG=2052 "ProductVersion" "' + VERSION + '"',
    'VIAddVersionKey /LANG=2052 "LegalCopyright" "Copyright (C) Infinity.Inc"',
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
    iconFile,
    unblock,
    '  WriteUninstaller "$INSTDIR\\Uninstall.exe"',
    '  CreateDirectory "$SMPROGRAMS\\Infinity.Inc\\${PRODUCT}"',
    '  CreateShortCut "$SMPROGRAMS\\Infinity.Inc\\${PRODUCT}\\Open.lnk" "$INSTDIR\\' + shortcut + '"' + iconArgs,
    '  CreateShortCut "$SMPROGRAMS\\Infinity.Inc\\${PRODUCT}\\Uninstall.lnk" "$INSTDIR\\Uninstall.exe"' + iconArgs,
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
    displayIcon,
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
  const icon = path.join(ICONS, app.dir + '.ico');
  if (!fs.existsSync(icon)) throw new Error('missing product icon: ' + icon);
  fs.copyFileSync(icon, path.join(dest, app.dir + '.ico'));
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


/* Sign one installer with the Infinity.Inc code-signing certificate. */
function signInstaller(file) {
  const thumbprint = process.env.INC_CERT_THUMBPRINT || '3C626CCE1DFA8833F844BA176DB1922B7B4069C2';
  const script = [
    '$cert = Get-ChildItem Cert:\\CurrentUser\\My | Where-Object { $_.Thumbprint -eq "' + thumbprint + '" }',
    'if (-not $cert) { "NO_CERT"; exit 3 }',
    '$sig = Set-AuthenticodeSignature -FilePath "' + file.split('\\').join('\\\\') + '" -Certificate $cert -TimestampServer "http://timestamp.digicert.com" -HashAlgorithm SHA256',
    '$sig.Status'
  ].join('; ');
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
    const status = String(out).trim().split(/\r?\n/).pop();
    log('  signed: ' + status);
  } catch (e) {
    log('  sign skipped: ' + String((e.stdout || '') + (e.message || '')).trim().slice(0, 200));
  }
}

function main() {
  if (!fs.existsSync(MAKENSIS)) throw new Error('makensis is missing: ' + MAKENSIS);
  fs.mkdirSync(OUT, { recursive: true });
  const produced = [];

  for (const app of selected()) {
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
    /* A setup that is not signed shows a warning and, worse, cannot be told
     * apart from a tampered one. The certificate lives in the current user's
     * store, so the build signs what it just made instead of leaving it to a
     * manual step somebody will forget. A missing certificate is a warning,
     * not a failure: the installer is still usable, just unsigned. */
    signInstaller(output);
    const size = fs.statSync(output).size;
    log(app.package.padEnd(25) + size + ' B  ' + output + '  +' + app.dir + '.ico');
    produced.push({ app: app.package, file: output, size: size, platform: 'win64' });
  }
  log('built ' + produced.length + ' self-contained installers');
  return produced;
}

export { main, APPS };

if (process.argv[1] && process.argv[1].indexOf('package.mjs') >= 0) {
  try { main(); } catch (e) { console.error(String(e && e.message ? e.message : e)); process.exit(1); }
}
