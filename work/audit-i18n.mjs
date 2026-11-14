import fs from 'node:fs';

/* Every translation key the page asks for must exist in BOTH locales, and the
 * two locales must carry the same key set - otherwise the user reads a raw key
 * like "exit.bodyNoRestore" instead of a sentence. Keys built by concatenation
 * (t("dl.status." + s)) are covered through their prefixes below.
 *
 * Earlier versions only scanned the literal right after t( and so missed keys
 * chosen by a ternary (t(cond ? "a" : "b")); that blind spot let a key live in
 * zh-CN only while the audit still printed PASS. */
const read = (p) => fs.readFileSync(p, 'utf8');
const ui = read('work/webview2/ui/assets/js/shell.js');
const html = read('work/webview2/ui/index.html');
const i18n = read('work/webview2/ui/assets/js/i18n.js');

function section(name) {
  const at = i18n.indexOf('"' + name + '": {');
  if (at < 0) throw new Error('no locale section ' + name);
  const open = i18n.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < i18n.length; i++) {
    if (i18n[i] === '{') depth++;
    else if (i18n[i] === '}') { depth--; if (depth === 0) return i18n.slice(open, i + 1); }
  }
  throw new Error('unterminated locale section ' + name);
}
const zh = section('zh-CN');
const en = section('en-US');
const keyRe = /"([a-zA-Z0-9_.\-]+)":/g;
const zhKeys = new Set([...zh.matchAll(keyRe)].map((m) => m[1]));
const enKeys = new Set([...en.matchAll(keyRe)].map((m) => m[1]));

/* Candidate keys: any dotted string literal in the page or the markup, kept
 * only when the string is a real translation key in at least one locale. */
const dotted = /^[a-z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/;
const used = new Set();
for (const m of (ui + html).matchAll(/["']([a-zA-Z0-9_.\-]+)["']/g)) {
  const k = m[1];
  if (dotted.test(k) && (zhKeys.has(k) || enKeys.has(k))) used.add(k);
}
for (const m of html.matchAll(/data-i18n(?:-title|-placeholder|-aria)?="([a-zA-Z0-9_.\-]+)"/g)) used.add(m[1]);

const missingZh = [...used].filter((k) => !zhKeys.has(k)).sort();
const missingEn = [...used].filter((k) => !enKeys.has(k)).sort();
const zhOnly = [...zhKeys].filter((k) => !enKeys.has(k)).sort();
const enOnly = [...enKeys].filter((k) => !zhKeys.has(k)).sort();

const dlStates = ['queued', 'running', 'paused', 'done', 'error', 'canceled'];
const missingDl = dlStates.filter((s) => !zhKeys.has('dl.status.' + s) || !enKeys.has('dl.status.' + s));

console.log('keys used=' + used.size + ' zh=' + zhKeys.size + ' en=' + enKeys.size);
console.log('MISSING-ZH: ' + (missingZh.join(', ') || 'none'));
console.log('MISSING-EN: ' + (missingEn.join(', ') || 'none'));
console.log('ASYM-ZH-ONLY: ' + (zhOnly.join(', ') || 'none'));
console.log('ASYM-EN-ONLY: ' + (enOnly.join(', ') || 'none'));
console.log('MISSING-DL-STATUS: ' + (missingDl.join(', ') || 'none'));
/* Keys nothing references are dead promises: text written for a feature that
 * never got wired. They do not fail the audit (some are used via attributes the
 * scan cannot see), but they are listed so the count cannot grow silently. */
const unused = [...zhKeys].filter((k) => !used.has(k)).sort();
console.log('UNUSED: ' + (unused.join(', ') || 'none'));
const bad = missingZh.length + missingEn.length + zhOnly.length + enOnly.length + missingDl.length;
/* The only keys allowed to look unused are the ones the download panel builds
 * from a record state (t("dl.status." + s)); anything else is a dead promise. */
const deadPromises = unused.filter((k) => !k.startsWith('dl.status.'));
if (deadPromises.length) { console.log('DEAD-PROMISE: ' + deadPromises.join(', ')); }
console.log('I18N-AUDIT ' + (bad || deadPromises.length ? 'FAIL' : 'PASS'));
process.exit(bad || deadPromises.length ? 1 : 0);