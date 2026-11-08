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
/* The multi file layout: one shared runtime, the bundle, one small launcher
 * per name. See work/jslayout for what it is and why. */
const LAYOUT = path.join(ROOT, 'build', 'layout');
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
  'update.js','aria2c.exe',
  /*
   * package.json 一定要跟着走：程序自己的版本号就是从这里读的
   * （bundle.js 的 detectRoot() 取 exe 所在目录，getPkgVersion() 读该目录下的
   * package.json，读不到就退回 '0.0.0'）。载荷里没有它，ipm version 就显示
   * v0.0.0，而不是产品真正发布的 1.0.0-pre5。
   */
  'package.json'
];

function log(m) { process.stdout.write(m + NL); }

function stage(platform) {
  const dest = path.join(STAGE, platform.id);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  /*
   * Where the payload comes from.
   *
   * The layout is preferred whenever it exists for this target: one shared
   * runtime instead of one inside every name. The old single file output is
   * still used for targets no launcher can be built for yet, so a platform
   * is never silently dropped.
   */
  const layout = path.join(LAYOUT, platform.target);
  const hasLayout = fs.existsSync(path.join(layout, 'node.exe')) && fs.existsSync(path.join(layout, 'app.cjs'));
  const from = hasLayout ? layout : path.join(OUT, platform.target);
  if (hasLayout) {
    /* The runtime and the bundle are what the launchers actually run. They
     * are not named executables, so nothing below would think to copy them. */
    for (const name of ['node.exe', 'app.cjs']) {
      fs.copyFileSync(path.join(layout, name), path.join(dest, name));
    }
    log('  payload layout  ' + layout);
  }

  /*
   * The name family, copied from whichever tree won above. build-all.mjs
   * already decided the names for this target; asking it rather than
   * repeating the list here means the installer can never ship a name the
   * build did not produce.
   */
  const names = exeNames({ id: platform.target });
  for (const name of names) {
    const src = path.join(from, name);
    if (!fs.existsSync(src)) throw new Error('the build is missing: ' + src);
    fs.copyFileSync(src, path.join(dest, name));
  }

  for (const f of PAYLOAD_FILES) {
    const from = path.join(APP, f);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dest, f));
  }
  if (hasGui('ipm', platform.target)) stageGui(dest, 'ipm', platform.target);

  /*
   * The one icon this installer uses, and the only one it stages.
   *
   * nsis.nsi reads it for MUI_ICON, MUI_UNICON, every shortcut and
   * DisplayIcon. Infinity.inc/icons holds one icon per product and the file
   * name is the product, so there is nothing to choose here; a missing icon
   * is a hard error rather than a setup built with the default NSIS icon.
   */
  const icon = path.resolve(ROOT, '..', 'icons', 'ipm.ico');
  if (!fs.existsSync(icon)) throw new Error('no ipm.ico in ' + path.dirname(icon));
  fs.copyFileSync(icon, path.join(dest, 'ipm.ico'));
  log('  icon ' + icon);

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

  /*
   * The template only holds placeholders now, exactly like the other two
   * products: the payload directory, the output file, the version and the
   * executable the shortcuts point at. Anything left unreplaced is a bug,
   * so it is checked rather than silently shipped.
   */
  const filled = template
    .split('@@VERSION@@').join(version)
    .split('@@OUTFILE@@').join(setupPath)
    .split('@@APP_DIR@@').join(payload)
    .split('@@EXE@@').join('ipm_launcher.exe');

  const left = ['@@VERSION@@', '@@OUTFILE@@', '@@APP_DIR@@', '@@EXE@@']
    .filter(function (p) { return filled.indexOf(p) >= 0; });
  if (left.length) throw new Error('the template still holds: ' + left.join(', '));
  template = filled;

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
  const version = process.argv[2] || 'v1.0pre5';
  // --only=<id> builds a single platform; the default is still every setup, so a plain
  // 'node tools/make-setup.mjs' behaves exactly as it did before the flag existed.
  const onlyArg = process.argv.find(function (a) { return a.indexOf('--only=') === 0; });
  const only = onlyArg ? onlyArg.slice('--only='.length) : '';
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });
  fs.mkdirSync(SETUP, { recursive: true });
  log('version ' + version);
  log('');
  const made = [];
  for (const p of SETUPS) {
    if (only && p.id !== only) { log('skip      ' + p.id + ' (--only=' + only + ')'); continue; }
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
