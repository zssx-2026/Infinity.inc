/*
 * build.mjs - pack the installer window.
 *
 * Same idea as the other shells in this workspace: the studio is a directory
 * with a package.json and a handful of source files, so packing means copying
 * it next to the Electron runtime that shell/node_modules already holds and
 * renaming the executable. Nothing is downloaded, and a missing runtime is an
 * error rather than a reason to fetch one.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* build.mjs sits in the product root, so ROOT is simply its own directory; */
/* the Electron runtime lives one level up, in the workspace's shell/.     */
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SHELL = path.join(ROOT, '..', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules', 'electron', 'dist');
const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : path.join(ROOT, 'build', 'win-x64');

function main() {
  if (!fs.existsSync(path.join(ELECTRON, 'electron.exe'))) {
    console.error('本地 Electron 运行时不存在: ' + ELECTRON);
    console.error('不下载、不安装 —— 请先确认 shell/node_modules/electron 已就绪。');
    process.exit(2);
  }
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'resources'), { recursive: true });
  fs.cpSync(ELECTRON, OUT, { recursive: true });
  fs.cpSync(path.join(ROOT, 'src'), path.join(OUT, 'resources', 'app', 'src'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(OUT, 'resources', 'app', 'package.json'));
  const exe = path.join(OUT, 'electron.exe');
  if (fs.existsSync(exe)) fs.renameSync(exe, path.join(OUT, 'infinitystudio_gui.exe'));
  console.log('INFINITYSTUDIO-PACK OK ' + OUT);
}

main();
