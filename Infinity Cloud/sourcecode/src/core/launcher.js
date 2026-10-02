/*
 * launcher.js - the face that only chooses.
 *
 * A user who double-clicks inc_launcher.exe has not decided whether they
 * want the command line, the terminal UI or the window; the launcher asks,
 * then hands over to the matching sibling executable and exits.
 *
 * The siblings are found beside this file, by name, which is exactly the
 * contract mode.js reads on the other side. Nothing is spawned until the
 * choice is made, so quitting the launcher costs nothing.
 */
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

const MENU = [
  { key: '1', mode: 'cli', label: 'CLI       命令行' },
  { key: '2', mode: 'tui', label: 'TUI       终端界面' },
  { key: '3', mode: 'gui', label: 'GUI       图形界面' }
];

export function siblingFor(prefix, mode) {
  const ext = process.platform === 'win32' ? '.exe' : '';
  return path.join(path.dirname(process.execPath), prefix + '_' + mode + ext);
}

export async function runLauncher(opts) {
  opts = opts || {};
  const title = opts.title || 'Infinity';
  const prefix = opts.prefix || 'inc';
  const admin = !!opts.admin;

  process.stdout.write(title + ' [' + (admin ? '管理员' : '用户') + ']\n\n');
  for (const m of MENU) process.stdout.write('  ' + m.key + ') ' + m.label + '\n');
  process.stdout.write('\n  q) 退出\n\n');

  /*
   * Without a terminal there is nobody to answer the menu, and guessing
   * would start a program in the background that the caller never asked for.
   * So nothing is launched; the choice is left to the caller, who can run
   * the sibling executable by name.
   */
  if (!process.stdin.isTTY) {
    process.stdout.write('非交互环境，未启动任何程序。请直接运行 ' + prefix + '_cli / _tui / _gui。\n');
    return { ok: true, launched: null };
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(function (resolve) { rl.question('> ', resolve); });
  rl.close();
  const a = String(answer || '').trim().toLowerCase();
  if (a === '' || a === 'q') return { ok: true, launched: null };
  const hit = MENU.find(function (m) { return m.key === a || m.mode === a; });
  if (!hit) return { ok: false, error: 'unknown choice' };
  return launch(prefix, hit.mode);
}

function launch(prefix, mode) {
  const target = siblingFor(prefix, mode);
  if (!fs.existsSync(target)) return { ok: false, error: 'missing: ' + target };
  const child = spawn(target, [], { detached: true, stdio: 'inherit' });
  child.unref();
  return { ok: true, launched: target };
}

export { MENU };
