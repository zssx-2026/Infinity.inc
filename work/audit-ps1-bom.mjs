import fs from 'node:fs';
import path from 'node:path';

/* PowerShell 5.1 reads a BOM-less script as ANSI, so a Chinese literal in a
 * probe silently turns into mojibake and its assertion can never pass. That bit
 * this repo twice; this audit makes the rule mechanical instead of a habit.
 * Usage: node work/audit-ps1-bom.mjs [--fix] */
const fix = process.argv.includes('--fix');
const roots = ['work', 'shell'];
const bad = [];
const fixed = [];
for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  for (const name of fs.readdirSync(root)) {
    if (!name.toLowerCase().endsWith('.ps1')) continue;
    const p = path.join(root, name);
    const buf = fs.readFileSync(p);
    const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    const nonAscii = buf.some((b) => b > 0x7f);
    if (nonAscii && !hasBom) {
      bad.push(p);
      if (fix) {
        fs.writeFileSync(p, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), buf]));
        fixed.push(p);
      }
    }
  }
}
for (const p of bad) console.log((fix ? 'BOM-ADDED ' : 'NO-BOM ') + p);
console.log('checked roots=' + roots.join(',') + ' bad=' + bad.length + ' fixed=' + fixed.length);
console.log('PS1-BOM ' + (bad.length && !fix ? 'FAIL' : 'PASS'));
process.exit(bad.length && !fix ? 1 : 0);
