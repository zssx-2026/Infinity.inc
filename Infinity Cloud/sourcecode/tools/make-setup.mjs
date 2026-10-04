/*
 * make-setup.mjs - turn the installer template into a real setup program.
 *
 * The template is one file with four placeholders rather than one file per
 * platform. That keeps the wizard identical everywhere - same pages, same
 * component tree, same wording - and leaves the differences where they
 * belong: in the payload directory and the executable name.
 *
 *   @@VERSION@@   the release tag, shown in the title bar and Add/Remove
 *   @@OUTFILE@@   where makensis writes the setup executable
 *   @@APP_DIR@@   the staged payload the File directives copy from
 *   @@EXE@@       the executable name inside that payload
 *
 * The payload is staged fresh each run from the build output, so the setup
 * can never contain a stale binary.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execFileSync } from 'node:child_process';
import { exeNames } from './build-all.mjs';
import { stageGui, hasGui } from '../../../shell/payload.mjs';

const NL = String.fromCharCode(10);
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
/* installer.nsi lives in the project root, above sourcecode. */
const PROJECT = path.resolve(ROOT, '..');
const OUT = path.join(ROOT, 'build', 'out');
const STAGE = path.join(ROOT, 'build', 'setup-stage');
const NSIS = 'C:/Program Files (x86)/NSIS/makensis.exe';

/*
 * Which Windows builds get an installer, and what the setup is called.
 *
 * win64 and winx86 are the two architectures people actually run. win-arm64
 * is included because a laptop that will not install the app is worse than
 * one that runs it slowly.
 */
export const SETUPS = [
  { id: 'win64',     target: 'win-x64',   exe: 'inc_launcher.exe' },
  { id: 'winx86',    target: 'win-ia32',  exe: 'inc_launcher.exe' },
  { id: 'win-arm64', target: 'win-arm64', exe: 'inc_launcher.exe' }
];

function log(m) { process.stdout.write(m + NL); }

/*
 * Copy one platform's files into a directory the template can point at.
 *
 * Everything the program needs at run time has to be here: the executable,
 * the product icon the installer and the shortcuts use, the launchers, and a
 * short readme. The installer copies this directory wholesale, so a file
 * missing here is a file missing after installation.
 */
function stage(platform) {
  const dest = path.join(STAGE, platform.id);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  /*
   * The whole name family goes in, not one executable.
   *
   * build-all.mjs already decided the names for this target; asking it
   * rather than repeating the list here means the installer can never ship a
   * name the build did not produce.
   */
  const from = path.join(OUT, platform.target);
  const names = exeNames({ id: platform.target });
  for (const name of names) {
    const src = path.join(from, name);
    if (!fs.existsSync(src)) throw new Error('the build is missing: ' + src);
    fs.copyFileSync(src, path.join(dest, name));
  }

  /* The window is an Electron directory rather than a file, so it comes in
   * through the shell's own helper. When it has not been packaged the
   * installer simply ships the command-line faces. */
  if (hasGui('inc', platform.target)) stageGui(dest, 'inc', platform.target);
  else log('  (no Electron shell for ' + platform.target + '; the window is skipped)');

  /*
   * The one icon this installer uses, and the only one it stages.
   *
   * Infinity.inc/icons holds one icon per product, and the file name is the
   * product:
   *   inc.ico  Infinity Cloud           ifm.ico  Infinity File Manager
   *   ipm.ico  InfinityPackageManager   iim.ico  Infinity Installer Manager
   *   ing.ico  Infinity Games           int.ico  Infinity Toolbox
   * An Infinity Cloud setup needs only its own; the other products ship their
   * own installers with their own copy, and a sibling icon in this payload
   * would just be a file nothing references.
   *
   * installer.nsi reads this file for MUI_ICON, MUI_UNICON, every shortcut
   * and DisplayIcon, so a missing icon is a hard error here rather than a
   * setup silently built with the default NSIS icon.
   */
  const icons = path.resolve(ROOT, '..', '..', 'icons');
  const pick = function (name) {
    const shared = path.join(icons, name);
    const local = path.join(ROOT, 'assets', name);
    return fs.existsSync(shared) ? shared : (fs.existsSync(local) ? local : null);
  };
  const name = 'inc.ico';
  const icon = pick(name);
  if (!icon) throw new Error('no ' + name + ' in ' + icons + ' or ' + path.join(ROOT, 'assets'));
  fs.copyFileSync(icon, path.join(dest, name));
  log('  icon ' + icon);

  return dest;
}

/*
 * Fill in the template and hand it to makensis.
 *
 * The four replacements happen on the text, not through /D defines, because
 * the paths contain spaces and backslashes and would need quoting rules that
 * differ between the two.
 */
function compile(platform, payload, setupPath, version) {
  const template = fs.readFileSync(path.join(PROJECT, 'installer.nsi'), 'utf8')
    .replace(/^\uFEFF/, '');
  const filled = template
    .split('@@VERSION@@').join(version)
    .split('@@OUTFILE@@').join(setupPath)
    .split('@@APP_DIR@@').join(payload)
    .split('@@EXE@@').join(platform.exe);

  const nsi = path.join(STAGE, 'setup-' + platform.id + '.nsi');
  /*
   * makensis only treats a script as Unicode when it starts with a BOM.
   * Without one it reads the file as ANSI, and the first non-ASCII byte -
   * the Chinese text in the mode page - aborts the build with
   * "Bad text encoding". The BOM is therefore not optional here.
   */
  fs.writeFileSync(nsi, '\uFEFF' + filled, 'utf8');

  const left = ['@@VERSION@@', '@@OUTFILE@@', '@@APP_DIR@@', '@@EXE@@']
    .filter(function (p) { return filled.indexOf(p) >= 0; });
  if (left.length) throw new Error('the template still holds: ' + left.join(', '));

  try {
    execFileSync(NSIS, ['/V2', nsi], { cwd: STAGE, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const msg = String((e.stderr || '') + (e.stdout || '') + (e.message || ''));
    throw new Error('makensis failed:' + NL + msg.slice(0, 1200));
  }
  if (!fs.existsSync(setupPath)) throw new Error('makensis produced nothing');
  return fs.statSync(setupPath).size;
}

function main() {
  const version = process.argv[2] || 'v1.0pre2';
  const outDir = process.argv[3] || path.join(ROOT, 'build', 'setup');
  fs.mkdirSync(outDir, { recursive: true });
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });

  log('version ' + version);
  log('');
  const made = [];
  for (const p of SETUPS) {
    const payload = stage(p);
    const setup = path.join(outDir, p.id + '.exe');
    const size = compile(p, payload, setup, version);
    log(p.id.padEnd(11) + String(size).padStart(12) + ' B');
    made.push({ platform: p, setup: setup, size: size });
  }
  log('');
  log('built ' + made.length + ' installers');
  return made;
}

export { main };

if (process.argv[1] && process.argv[1].indexOf('make-setup') >= 0) {
  main();
}
