import fs from 'node:fs';
const p = 'work/webview2/ui/assets/js/i18n.js';
const dead = ['home.newTab', 'playzone.pick', 'playzone.play', 'playzone.pause', 'playzone.volume',
  'playzone.switched', 'toast.devOpened', 'toast.notImplemented', 'toast.searchSent'];
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
const kept = [];
let removed = 0;
for (const line of lines) {
  const m = line.match(/^\s*"([A-Za-z][A-Za-z0-9_.]*)"\s*:/);
  if (m && dead.includes(m[1])) { removed++; continue; }
  kept.push(line);
}
fs.writeFileSync(p, kept.join('\n'));
console.log('removed=' + removed + ' expected=' + dead.length * 2);
