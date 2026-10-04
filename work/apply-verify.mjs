// apply-verify.mjs - put the gate on every page except the 404 handler.
import fs from 'node:fs';
import path from 'node:path';
const WEB = 'web';
const CSS = '<link rel="stylesheet" href="/infinity/assets/verify.css">';
const JS = '<script src="/infinity/assets/verify.js"></script>';
const files = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full);
    else if (/\.html$/i.test(name)) files.push(full);
  }
})(WEB);
let changed = 0, skipped = 0;
for (const file of files) {
  if (/404/i.test(file)) { skipped++; continue; }
  let html = fs.readFileSync(file, 'utf8');
  if (html.indexOf('<head') < 0) { skipped++; continue; }
  html = html.replace(/\s*<link[^>]*verify\.css[^>]*>/gi, '')
             .replace(/\s*<script[^>]*verify\.js[^>]*><\/script>/gi, '');
  const inject = '  ' + CSS + '\n  ' + JS + '\n';
  html = html.replace(/<\/head>/i, inject + '</head>');
  fs.writeFileSync(file, html);
  changed++;
}
console.log('pages gated: ' + changed + ', skipped: ' + skipped + ', total html: ' + files.length);
