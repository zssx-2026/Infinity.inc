import fs from 'node:fs';
import path from 'node:path';

/* Takes the file list either from argv[2] (a file of relative paths) or stdin;
 * PowerShell 5.1 has no '<' redirection, so argv is the reliable route. */
const source = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : fs.readFileSync(0, 'utf8');
const files = source.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
let changed = 0;
for (const rel of files) {
  const file = path.resolve(rel);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  let touched = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/Start-Process/.test(line) || /^\s*#/.test(line)) continue;
    if (/-WindowStyle\s+Hidden|-NoNewWindow/.test(line)) continue;
    const next = lines.slice(i, i + 3).join(' ');
    if (/-WindowStyle\s+Hidden|-NoNewWindow/.test(next)) continue;
    lines[i] = line.replace(/Start-Process/, 'Start-Process -WindowStyle Hidden');
    touched = true;
  }
  if (touched) {
    fs.writeFileSync(file, lines.join('\r\n'), 'utf8');
    changed++;
    console.log('patched ' + rel);
  }
}
console.log('files changed=' + changed);
