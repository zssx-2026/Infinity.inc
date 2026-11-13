import fs from 'node:fs';
const p = 'work/webview2/ui/assets/js/i18n.js';
let s2 = fs.readFileSync(p, 'utf8');
for (const key of ['playzone.music', 'playzone.noMusic', 'playzone.musicHint', 'toast.musicPicked']) {
  const re = new RegExp('^\\s*"' + key.replace('.', '\\.') + '": .*$', 'gm');
  s2 = s2.replace(re, '');
}
s2 = s2.replace(/\n{3,}/g, '\n\n');
fs.writeFileSync(p, s2, 'utf8');
console.log('left=' + (s2.match(/music/gi) || []).length + ' bytes=' + Buffer.byteLength(s2, 'utf8'));
