
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const pages = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let ok = 0, bad = [];
for (const p of pages) {
  const local = fs.readFileSync('web/' + p.rel, 'utf8');
  let code = '000', body = '';
  try {
    code = execFileSync('curl.exe', ['-s', '--ssl-no-revoke', '--max-time', '30', '-o', '-', '-w', '\n%{http_code}', p.url], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const idx = code.lastIndexOf('\n');
    body = code.slice(0, idx); code = code.slice(idx + 1).trim();
  } catch (e) { code = 'ERR'; }
  const is404 = /404/i.test(p.rel);
  const wantGate = !is404;
  const hasGate = body.indexOf('/infinity/assets/verify.js') >= 0;
  const sameSize = Math.abs(body.length - local.length) <= Math.max(80, local.length * 0.25);
  const good = code === '200' && (wantGate ? hasGate : true) && sameSize;
  if (good) ok++; else bad.push(p.rel + ' code=' + code + ' gate=' + hasGate + ' live=' + body.length + ' local=' + local.length);
}
console.log('pages checked: ' + pages.length + '  ok: ' + ok);
for (const b of bad) console.log('  FAIL ' + b);
