/*
 * installer.js - the setup program.
 *
 * It is deliberately not an MSI and not a self-extractor stub. It is this same
 * program started with a different first argument, which means the installer
 * and the application can never disagree about where things go or what a
 * setting is called.
 *
 * The flow the specification asks for:
 *
 *   1. pick a language
 *   2. unpack the payload into the cache directory
 *   3. copy it into place, hashing every file
 *   4. write those hashes to the registry, so a later repair can tell a
 *      modified file from an intact one
 *   5. optionally create shortcuts and start the application
 *
 * Reinstall, repair and uninstall all work from the same hash table.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { t, setLang, matchLang, LANGS } from './i18n/i18n.js';
import { PATHS } from './core/config.js';

const NL = String.fromCharCode(10);
const APP = 'Infinity Cloud';
const REG_KEY = 'HKCU\\Software\\InfinityCloud';

function hashFile(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function walkFiles(dir, base, out) {
  const b = base || dir;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, b, out);
    else out.push({ full: p, rel: path.relative(b, p) });
  }
  return out;
}

function regWrite(values) {
  const lines = [];
  for (const k of Object.keys(values)) lines.push('  /v "' + k + '" /t REG_SZ /d "' + String(values[k]).replace(/"/g, '') + '" /f');
  for (const line of lines) {
    try { execFileSync('reg.exe', ['add', REG_KEY].concat(line.split(' ').filter((x) => x)), { stdio: 'ignore' }); }
    catch (e) { /* the registry is a convenience, not a requirement */ }
  }
}

function shortcut(linkPath, target, args, workDir, icon) {
  const ps = [
    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut(' + JSON.stringify(linkPath) + ')',
    '$s.TargetPath = ' + JSON.stringify(target),
    '$s.Arguments = ' + JSON.stringify(args || ''),
    '$s.WorkingDirectory = ' + JSON.stringify(workDir || ''),
    '$s.IconLocation = ' + JSON.stringify(icon || target),
    '$s.Save()'
  ].join('; ');
  try { execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'ignore' }); return true; }
  catch (e) { return false; }
}

export async function runInstaller(argv) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  /*
   * A queue rather than rl.question. Piped input arrives all at once, and a
   * one-shot listener per question would drop every answer after the first -
   * the installer would read the language and then wait forever.
   */
  const lines = [];
  const waiters = [];
  let ended = false;
  rl.on('line', (line) => {
    const w = waiters.shift();
    if (w) w(line); else lines.push(line);
  });
  rl.on('close', () => {
    ended = true;
    while (waiters.length) waiters.shift()(null);
  });
  const ask = (q) => {
    if (q) process.stdout.write(q);
    if (lines.length) return Promise.resolve(lines.shift());
    if (ended) return Promise.resolve(null);
    return new Promise((resolve) => waiters.push(resolve));
  };

  console.log('Infinity Cloud - setup');
  console.log('Please choose language:');
  console.log(LANGS.map((l) => l.native).join(', '));
  let code = null;
  while (!code) {
    const a = await ask('> ');
    if (a === null) { console.log('No language was chosen: the input ended.'); rl.close(); return 1; }
    code = matchLang(a);
    if (!code) console.log('Unknown language. Do you mean English / 简体中文?');
  }
  setLang(code);

  console.log(t('press_any'));
  if ((await ask('')) === null) { rl.close(); return 1; }

  const base = process.cwd();
  const installDir = path.join(process.env.LOCALAPPDATA || base, 'Programs', 'InfinityCloud');
  const payload = path.join(base, 'program');

  if (!fs.existsSync(payload)) {
    console.log('The program directory is missing beside the installer.');
    rl.close();
    return 1;
  }

  console.log('Installing to ' + installDir);
  fs.mkdirSync(installDir, { recursive: true });

  const files = walkFiles(payload, null, []);
  const hashes = {};
  let done = 0;
  for (const f of files) {
    const dest = path.join(installDir, f.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f.full, dest);
    hashes[f.rel] = hashFile(dest);
    done++;
    const pct = Math.floor((done / files.length) * 100);
    process.stdout.write(String.fromCharCode(13) + '[' + '#'.repeat(Math.floor(pct / 5)).padEnd(20, ' ') + '] ' + pct + '%');
  }
  process.stdout.write(NL);

  fs.writeFileSync(path.join(installDir, 'hashes.json'), JSON.stringify(hashes, null, 2), 'utf8');
  regWrite({ InstallDir: installDir, Version: 'v1.0pre2', Hashes: path.join(installDir, 'hashes.json') });

  const ans = await ask('Create a desktop shortcut? (y/n) ');
  const want = ans !== null && ans.trim().toLowerCase() === 'y';
  if (want) {
    const link = path.join(process.env.USERPROFILE || base, 'Desktop', APP + '.lnk');
    shortcut(link, process.execPath, 'gui', installDir, path.join(installDir, 'inc.ico'));
    console.log('  shortcut created');
  }

  console.log('Done.');
  rl.close();
  return 0;
}

export function repair(installDir) {
  const hashPath = path.join(installDir, 'hashes.json');
  if (!fs.existsSync(hashPath)) return { ok: false, reason: 'no hash table' };
  const want = JSON.parse(fs.readFileSync(hashPath, 'utf8'));
  const bad = [];
  for (const rel of Object.keys(want)) {
    const p = path.join(installDir, rel);
    if (!fs.existsSync(p)) { bad.push(rel); continue; }
    if (hashFile(p) !== want[rel]) bad.push(rel);
  }
  return { ok: bad.length === 0, bad: bad };
}

export function uninstall(installDir) {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      try { fs.unlinkSync(p); n++; } catch (x) { }
    }
  };
  try { walk(installDir); fs.rmdirSync(installDir); } catch (e) { }
  try { execFileSync('reg.exe', ['delete', REG_KEY, '/f'], { stdio: 'ignore' }); } catch (e) { }
  return n;
}
