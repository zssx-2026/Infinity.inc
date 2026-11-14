/* audit-shortcuts.mjs - every shortcut the menu prints must exist.
 * The menu prints Ctrl+J next to Downloads, but the keydown handler had no J
 * branch at all: the chrome advertised a key that did nothing. This reads the
 * printed labels out of the markup and checks each one against the handler. */
import fs from 'node:fs';

const html = fs.readFileSync('work/webview2/ui/index.html', 'utf8');
const js = fs.readFileSync('work/webview2/ui/assets/js/shell.js', 'utf8');
const lines = js.split(/\r?\n/);

const labels = [];
const re = /<span class="mi-k"[^>]*>([^<]+)<\/span>/g;
let m;
while ((m = re.exec(html)) !== null) {
  const t = m[1].trim();
  /* .mi-k also holds the version; only accelerator-looking labels count. */
  if (/^(Ctrl|Alt|Shift)(\+|$)/.test(t) || /^F\d{1,2}$/.test(t)) { labels.push(t); }
}

function branchFor(label) {
  const parts = label.split('+').map(function (s) { return s.trim(); });
  const key = parts[parts.length - 1];
  const wantShift = parts.some(function (p) { return /^Shift$/i.test(p); });
  const wantCtrl = parts.some(function (p) { return /^Ctrl$/i.test(p); });
  const names = key.length === 1 ? [key.toLowerCase(), key.toUpperCase()] : [key];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hit = names.some(function (n) {
      return line.indexOf('key === "' + n + '"') >= 0 || line.indexOf("key === '" + n + "'") >= 0;
    });
    if (!hit) { continue; }
    const shiftOk = wantShift ? /shiftKey/.test(line) : true;
    const ctrlOk = wantCtrl ? /ctrl/.test(line) : true;
    if (shiftOk && ctrlOk) { return i + 1; }
  }
  return 0;
}

let bad = 0;
console.log('AUDIT-SHORTCUTS labels=' + labels.length);
labels.forEach(function (label) {
  const line = branchFor(label);
  console.log('  ' + (line ? 'ok  ' : 'MISS') + ' ' + label + (line ? '  shell.js:' + line : ''));
  if (!line) { bad++; }
});
console.log('AUDIT-SHORTCUTS ' + (bad === 0 ? 'PASS' : 'FAIL missing=' + bad));
process.exit(bad === 0 ? 0 : 1);
