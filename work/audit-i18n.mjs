import fs from 'node:fs';

/* Every t("key") the page asks for must exist in both locales, otherwise the
 * user reads a raw key like "app.failedHint" instead of a sentence. Keys built
 * by concatenation (t("dl.status." + s)) are skipped by the trailing dot and
 * checked through their prefixes below. */
const ui = fs.readFileSync('work/webview2/ui/assets/js/shell.js', 'utf8');
const i18n = fs.readFileSync('work/webview2/ui/assets/js/i18n.js', 'utf8');
const html = fs.readFileSync('work/webview2/ui/index.html', 'utf8');

const keys = new Set();
for (const m of ui.matchAll(/\bt\("([a-zA-Z0-9_.\-]+)"/g)) keys.add(m[1]);
for (const m of ui.matchAll(/\bt\('([a-zA-Z0-9_.\-]+)'/g)) keys.add(m[1]);
for (const m of html.matchAll(/data-i18n(?:-title|-placeholder)?="([a-zA-Z0-9_.\-]+)"/g)) keys.add(m[1]);

const zhStart = i18n.indexOf('"zh-CN": {');
const enStart = i18n.indexOf('"en-US": {');
const zh = i18n.slice(zhStart, enStart);
const en = i18n.slice(enStart);
const has = (block, k) => block.indexOf('"' + k + '"') >= 0;

const missingZh = [...keys].filter(k => !k.endsWith('.') && !has(zh, k)).sort();
const missingEn = [...keys].filter(k => !k.endsWith('.') && !has(en, k)).sort();
const zhCount = (zh.match(/^\s+"[a-zA-Z0-9_.\-]+":/gm) || []).length;
const enCount = (en.match(/^\s+"[a-zA-Z0-9_.\-]+":/gm) || []).length;

/* the download panel builds its status label from the record's state */
const dlStates = ['queued', 'running', 'paused', 'done', 'error', 'canceled'];
const missingDl = dlStates.filter(s => !has(zh, 'dl.status.' + s) || !has(en, 'dl.status.' + s));

console.log('keys used=' + keys.size + ' zh=' + zhCount + ' en=' + enCount);
console.log('MISSING-ZH: ' + (missingZh.join(', ') || 'none'));
console.log('MISSING-EN: ' + (missingEn.join(', ') || 'none'));
console.log('MISSING-DL-STATUS: ' + (missingDl.join(', ') || 'none'));
const bad = missingZh.length + missingEn.length + missingDl.length;
console.log('I18N-AUDIT ' + (bad ? 'FAIL' : 'PASS'));
process.exit(bad ? 1 : 0);
