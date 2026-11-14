import fs from 'node:fs';
const h = fs.readFileSync('work/webview2/ui/index.html', 'utf8');
const js = fs.readFileSync('work/webview2/ui/assets/js/shell.js', 'utf8');
const ids = [...h.matchAll(/id="(btn-[a-z-]+)"/g)].map(m => m[1]);
const dead = ids.filter(id => !js.includes('"#' + id + '"') && !js.includes("'#" + id + "'"));
console.log('total=' + ids.length);
console.log('unwired=' + (dead.join(',') || 'none'));
