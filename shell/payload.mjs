/*
 * payload.mjs - put the Electron window into an installer payload.
 *
 * The command-line faces are single files and stage like any other file. The
 * graphical face is not: Electron ships as a directory, because the
 * executable needs its resources beside it. This module knows that shape so
 * the three make-setup scripts do not each have to.
 *
 * Both names - the user's and the administrator's - are the same program, so
 * one packaged directory is copied and its executable is duplicated under the
 * second name. That halves what the installer carries.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const BUILD = path.join(HERE, 'build');

/* win-x64 and win-ia32 share the 32/64 split Electron uses; arm64 is its own. */
export function electronArch(targetId) {
  if (targetId === 'win-arm64') return 'arm64';
  if (targetId === 'win-ia32') return 'ia32';
  return 'x64';
}

export function guiDir(prefix, arch) {
  return path.join(BUILD, prefix + '_gui-win32-' + arch);
}

/* Is the window available for this target at all? A build that predates the
 * shell, or one where Electron could not be fetched, simply has no window and
 * the installer keeps the command-line faces. */
export function hasGui(prefix, targetId) {
  const dir = guiDir(prefix, electronArch(targetId));
  return fs.existsSync(path.join(dir, prefix + '_gui.exe'));
}

/*
 * Copy the packaged window into dest and give the administrator twin its own
 * name. Returns the list of file names it contributed.
 */
export function stageGui(dest, prefix, targetId) {
  const arch = electronArch(targetId);
  const src = guiDir(prefix, arch);
  const main = path.join(src, prefix + '_gui.exe');
  if (!fs.existsSync(main)) throw new Error('the Electron shell is missing: ' + main);

  fs.cpSync(src, dest, { recursive: true, dereference: false });

  const admin = path.join(dest, prefix + 'x_gui.exe');
  try { fs.copyFileSync(main, admin); }
  catch (e) { /* the copy is best effort; the user's name is what matters */ }

  return [prefix + '_gui.exe', prefix + 'x_gui.exe'];
}
