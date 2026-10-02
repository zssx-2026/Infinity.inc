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
 * can never contain a stale binary. It carries the whole family - the eight
 * names the program ships under - and the shortcuts point at the launcher,
 * which is the face a double click should open.
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
 *
 * The exe named here is what the shortcuts and the uninstaller point at; it
 * is the launcher, because that is the face a double click should get.
 */
export const SETUPS = [
  { id: 'win64',     target: 'win-x64',   exe: 'ifm_launcher.exe' },
  { id: 'winx86',    target: 'win-ia32',  exe: 'ifm_launcher.exe' },
  { id: 'win-arm64', target: 'win-arm64', exe: 'ifm_launcher.exe' }
];

function log(m) { process.stdout.write(m + NL); }

/*
 * Copy one platform's files into a directory the template can point at.
 *
 * Everything the program needs at run time has to be here: the eight named
 * executables and both icons for the shortcuts. The installer copies this
 * directory wholesale, so a file missing here is a file missing after
 * installation.
 */
function stage(platform) {
  const dest = path.join(STAGE, platform.id);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  for (const name of exeNames({ id: platform.target })) {
    const src = path.join(OUT, platform.target, name);
    if (!fs.existsSync(src)) throw new Error('the build is missing: ' + src);
    fs.copyFileSync(src, path.join(dest, name));
  }
  /* The window is an Electron directory; the shell's helper knows its shape. */
  if (hasGui('ifm', platform.target)) stageGui(dest, 'ifm', platform.target);

  fs.copyFileSync(path.join(ROOT, 'assets', 'ifm.ico'), path.join(dest, 'ifm.ico'));
  fs.copyFileSync(path.join(ROOT, 'assets', 'inc.ico'), path.join(dest, 'inc.ico'));

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

  execFileSync(NSIS, ['/V2', nsi], { cwd: STAGE, stdio: ['ignore', 'pipe', 'pipe'] });
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
