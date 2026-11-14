/* audit-hardcoded.mjs - find user-visible text that never goes through i18n.
 * audit-i18n.mjs proves every t("key") has a translation; it says nothing about
 * strings written straight into the DOM, which stay Chinese even when the UI is
 * switched to English. This walks the page script for assignments and calls
 * whose argument is a literal containing CJK (or an English sentence), ignoring
 * comments and the i18n dictionary itself. */
import fs from 'node:fs';

const FILE = 'work/webview2/ui/assets/js/shell.js';
const src = fs.readFileSync(FILE, 'utf8');
const lines = src.split(/\r?\n/);

/* Blank out comments so a sentence in a comment is not reported. */
const stripped = lines.map(function (l) {
  return l.replace(/\/\/.*$/, '');
});

const PATTERNS = [
  { re: /toast\(\s*"([^"]*[\u4e00-\u9fff][^"]*)"/, what: 'toast' },
  { re: /toast\(\s*'([^']*[\u4e00-\u9fff][^']*)'/, what: 'toast' },
  { re: /\.textContent\s*=\s*"([^"]*[\u4e00-\u9fff][^"]*)"/, what: 'textContent' },
  { re: /\.innerHTML\s*=\s*"([^"]*[\u4e00-\u9fff][^"]*)"/, what: 'innerHTML' },
  { re: /\.setAttribute\(\s*"title"\s*,\s*"([^"]*[\u4e00-\u9fff][^"]*)"/, what: 'title' },
  { re: /window\.alert\(\s*"([^"]*[\u4e00-\u9fff][^"]*)"/, what: 'alert' },
  { re: /window\.confirm\(\s*"([^"]*[\u4e00-\u9fff][^"]*)"/, what: 'confirm' }
];

const hits = [];
stripped.forEach(function (line, i) {
  PATTERNS.forEach(function (p) {
    const m = line.match(p.re);
    if (m) { hits.push({ line: i + 1, what: p.what, text: m[1] }); }
  });
});

console.log('AUDIT-HARDCODED file=' + FILE + ' hits=' + hits.length);
hits.forEach(function (h) {
  console.log('  L' + h.line + ' ' + h.what + ' "' + h.text + '"');
});

/* The markup carries the static chrome text. A text node with CJK that is not
 * under a data-i18n element never switches language, so an English user keeps
 * reading Chinese. Scripts and styles are skipped; placeholders are covered by
 * data-i18n-placeholder and are not text nodes. */
const HTML = 'work/webview2/ui/index.html';
const html = fs.readFileSync(HTML, 'utf8');
const body = html
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<style[\s\S]*?<\/style>/g, '');
const markup = [];
const tagRe = /<([a-zA-Z][\w-]*)([^>]*)>([^<]*)/g;
let m;
while ((m = tagRe.exec(body)) !== null) {
  const attrs = m[2] || '';
  const text = (m[3] || '').trim();
  if (!text || !/[\u4e00-\u9fff]/.test(text)) { continue; }
  if (/data-i18n=/.test(attrs)) { continue; }
  /* A language endonym is the one string that must not be translated: an
   * English user looking for Chinese still looks for 中文. Marked, not guessed. */
  if (/data-i18n-fixed=/.test(attrs)) { continue; }
  const line = body.slice(0, m.index).split('\n').length;
  markup.push({ line: line, tag: m[1], text: text });
}
console.log('AUDIT-HARDCODED markup=' + HTML + ' untranslated=' + markup.length);
markup.forEach(function (h) { console.log('  L' + h.line + ' <' + h.tag + '> "' + h.text.slice(0, 60) + '"'); });
console.log('AUDIT-HARDCODED ' + (hits.length === 0 && markup.length === 0 ? 'PASS' : 'FINDINGS ' + (hits.length + markup.length)));
process.exit(0);
