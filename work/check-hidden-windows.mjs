/* Guard: nothing this workspace starts may open a window.
 *
 * The rule is blunt on purpose -- a console flash or a crash dialog is a defect
 * the same way a wrong hash is. This scans the sources that spawn processes and
 * the scripts that start programs, and fails when a spawn lacks windowsHide or
 * a Start-Process lacks -WindowStyle Hidden.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const JS_DIRS = ['InfinityStudio/src', 'InfinityServer/src', 'shell', 'tools'];
const PS_DIRS = ['work', 'InfinityStudio', 'InfinityServer'];

function walk(dir, out, filter) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (error) { return; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'build' || e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out, filter);
    else if (filter(e.name)) out.push(full);
  }
}

const jsFiles = [];
for (const d of JS_DIRS) walk(path.join(ROOT, d), jsFiles, (n) => /\.(m?js|cjs)$/.test(n));
const psFiles = [];
for (const d of PS_DIRS) walk(path.join(ROOT, d), psFiles, (n) => /\.ps1$/.test(n));

const problems = [];

for (const file of jsFiles) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/\bspawn(Sync)?\(/.test(line)) continue;
    if (/^\s*(\*|\/\/|\/\*)/.test(line)) continue;
    /* The options object is often built above the call, so look both ways. */
    const window = lines.slice(Math.max(0, i - 30), i + 6).join(' ');
    if (!/windowsHide/.test(window)) {
      problems.push(path.relative(ROOT, file) + ':' + (i + 1) + ' spawn without windowsHide: ' + line.trim().slice(0, 90));
    }
  }
}

for (const file of psFiles) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/Start-Process/.test(line)) continue;
    if (/^\s*#/.test(line)) continue;
    const window = lines.slice(i, i + 3).join(' ');
    if (!/-WindowStyle\s+Hidden|-NoNewWindow/.test(window)) {
      problems.push(path.relative(ROOT, file) + ':' + (i + 1) + ' Start-Process without -WindowStyle Hidden: ' + line.trim().slice(0, 90));
    }
  }
}

for (const p of problems) console.log('  ' + p);
console.log('');
console.log('HIDDEN-WINDOWS ' + (problems.length ? 'FAIL' : 'PASS') + ' files=' + (jsFiles.length + psFiles.length) + ' problems=' + problems.length);
if (problems.length) process.exitCode = 1;
