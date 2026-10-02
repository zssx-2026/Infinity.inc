/*
 * make-setup.mjs - compile the InfinityPackageManager installer for each Windows target.
 *
 * nsis.nsi is already the full wizard: welcome, install/repair/uninstall mode page,
 * directory, components, install, finish, with every installed file hashed to
 * hash.ini, hash.txt and the registry. The only thing it hard-codes is where the
 * payload lives and where the setup is written, so those two are rewritten here
 * and makensis does the rest.
 *
 * The payload is staged fresh each run from build/out, so a setup can never ship
 * a stale executable.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execFileSync } from 'node:child_process';
import { exeNames } from './build-all.mjs';
import { stageGui, hasGui } from '../../shell/payload.mjs';

const NL = String.fromCharCode(10);
const BS = String.fromCharCode(92);
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const APP = path.join(ROOT, 'InfinityPackageManager');
const OUT = path.join(ROOT, 'build', 'out');
const STAGE = path.join(ROOT, 'build', 'setup-stage');
const SETUP = path.join(ROOT, 'build', 'setup');
const NSIS = 'C:/Program Files (x86)/NSIS/makensis.exe';
const TEMPLATE = path.join(ROOT, 'nsis.nsi');

/*
 * The Windows targets. IPM ships the full eight-name executable family on
 * every architecture: ipm_/ipmx_ crossed with cli/tui/gui/launcher. The setup
 * stages all eight beside the payload so the installed tree is complete.
 */
const SETUPS = [
  { id: 'win64',     target: 'win-x64'  },
  { id: 'winx86',    target: 'win-ia32' },
  { id: 'win-arm64', target: 'win-arm64' }
];

/*
 * Everything the program needs at run time. The eight executables alone are
 * not enough: the catalogue, the release index, the settings and the seven
 * language files all sit beside them and are read at startup.
 */
const PAYLOAD_FILES = [
  'applist.json','url.json','registry.json',
  'settings.json','pak.json','.ipm-versions.json',
  'update.js','aria2c.exe'
];

function log(m) { process.stdout.write(m + NL); }

function stage(platform) {
  const dest = path.join(STAGE, platform.id);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  /*
   * The full eight-name executable family, copied from build/out/<target>/.
   * They are hard links to one file there; the stage gets real copies so the
   * staged tree stays valid even if build/out is rebuilt mid-run.
   */
  const outDir = path.join(OUT, platform.target);
  const names = exeNames({ id: platform.target });
  for (const name of names) {
    const src = path.join(outDir, name);
    if (!fs.existsSync(src)) throw new Error('the build is missing: ' + src);
    fs.copyFileSync(src, path.join(dest, name));
  }

  for (const f of PAYLOAD_FILES) {
    const from = path.join(APP, f);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dest, f));
  }
  if (hasGui('ipm', platform.target)) stageGui(dest, 'ipm', platform.target);

  const lang = path.join(APP, 'lang');
  if (fs.existsSync(lang)) fs.cpSync(lang, path.join(dest, 'lang'), { recursive: true });
  return dest;
}

/*
 * Fill the two placeholders and hand the script to makensis.
 *
 * The output file has to be written with a BOM: makensis only treats a script
 * as Unicode when it starts with one, and this script is full of Chinese.
 */
function compile(platform, payload, setupPath, version) {
  let template = fs.readFileSync(TEMPLATE, 'utf8').replace(/^\uFEFF/, '');

  const oldPayload = /File \/r "[^"]*"/;
  if (!oldPayload.test(template)) throw new Error('the template has no File /r payload line');
  template = template.replace(oldPayload, 'File /r "' + payload.split(BS).join(BS + BS) + '\\*.*"');

  const oldOut = /OutFile "[^"]*"/;
  if (!oldOut.test(template)) throw new Error('the template has no OutFile line');
  template = template.replace(oldOut, 'OutFile "' + setupPath.split(BS).join(BS + BS) + '"');

  template = template.replace(/!define PRODUCT_VERSION "[^"]*"/, '!define PRODUCT_VERSION "' + version + '"');

  const nsi = path.join(STAGE, 'setup-' + platform.id + '.nsi');
  fs.writeFileSync(nsi, '\uFEFF' + template, 'utf8');

  try {
    execFileSync(NSIS, ['/V2', nsi], { cwd: STAGE, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const msg = String((e.stdout || '') + (e.stderr || '') + (e.message || ''));
    throw new Error('makensis failed for ' + platform.id + ':' + NL + msg.slice(0, 900));
  }
  if (!fs.existsSync(setupPath)) throw new Error('makensis produced nothing');
  return fs.statSync(setupPath).size;
}

function main() {
  const version = process.argv[2] || 'v1.0pre2';
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });
  fs.mkdirSync(SETUP, { recursive: true });
  log('version ' + version);
  log('');
  const made = [];
  for (const p of SETUPS) {
    const payload = stage(p);
    const setup = path.join(SETUP, p.id + '.exe');
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
