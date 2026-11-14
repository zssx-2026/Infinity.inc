import fs from 'node:fs';
const ui = fs.readFileSync('work/webview2/ui/assets/js/shell.js','utf8');
const main = fs.readFileSync('shell/main.js','utf8');
const sent = new Set();
for (const m of ui.matchAll(/send\("([a-z.\-]+)"/g)) sent.add(m[1]);
for (const m of ui.matchAll(/send\('([a-z.\-]+)'/g)) sent.add(m[1]);
const handled = new Set();
for (const m of main.matchAll(/case '([a-z.\-]+)'/g)) handled.add(m[1]);
for (const m of main.matchAll(/case "([a-z.\-]+)"/g)) handled.add(m[1]);
const missing = [...sent].filter(k => !handled.has(k)).sort();
console.log('sent=' + sent.size + ' handled=' + handled.size);
console.log('UNHANDLED: ' + missing.join(', '));
const hosts = new Set();
for (const m of ui.matchAll(/case "(host\.[a-z.\-]+)"/g)) hosts.add(m[1]);
const replied = new Set();
for (const m of main.matchAll(/replyShell\('([a-z.\-]+)'/g)) replied.add(m[1]);
const never = [...replied].filter(k => !hosts.has(k)).sort();
console.log('replied=' + replied.size + ' uiHandles=' + hosts.size);
console.log('REPLIED-BUT-UNHANDLED-IN-UI: ' + never.join(', '));

/* The WebView2 host (cpp/hosts/webview2/main.c) serves the same page, so the
 * actions it answers must be visible too - otherwise a page feature silently
 * dies on the fallback host. */
const cpp = fs.readFileSync('cpp/hosts/webview2/main.c', 'utf8');
const cppHandled = new Set();
for (const m of cpp.matchAll(/wcsstr\(json, L"\\"([a-z.\-]+)\\""\)/g)) cppHandled.add(m[1]);
const cppMissing = [...sent].filter(k => !cppHandled.has(k)).sort();
console.log('webview2-host handled=' + cppHandled.size + ': ' + [...cppHandled].sort().join(', '));
console.log('WEBVIEW2-HOST-MISSING: ' + cppMissing.join(', '));
