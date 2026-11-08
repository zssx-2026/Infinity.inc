/*
 * Static self-check for the account pages (task-30). Reads files only: no
 * process is spawned, no browser, no network. It answers three questions:
 *   1. do the four pages load the account module and the site chrome?
 *   2. does the module ever talk to anything other than api.github.com /
 *      github.com (the device-flow attempt) - and does it ever use XHR, a
 *      WebSocket, a beacon or eval?
 *   3. are the controls the flow needs actually present in the generated UI?
 *
 *   node work/account-static-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
let failures = 0, checks = 0;
function ok(name, pass, extra) { checks++; console.log((pass ? 'PASS ' : 'FAIL ') + name + (pass || extra === undefined ? '' : '  >> ' + JSON.stringify(extra))); if (!pass) failures++; }
const read = (f) => fs.readFileSync(f, 'utf8');
const pages = [
  ['web/infinity/signup/index.html', 'signup', 'en'],
  ['web/infinity/login/index.html', 'login', 'en'],
  ['web/infinity/cn/signup/index.html', 'signup', 'zh-CN'],
  ['web/infinity/cn/login/index.html', 'login', 'zh-CN']
];
const js = read('web/infinity/assets/account.js');
for (const [file, page, lang] of pages) {
  const html = read(file);
  ok(file + ' exists with data-account-page=' + page, html.includes('data-account-page="' + page + '"') && html.includes('lang="' + lang + '"'));
  ok(file + ' loads account.js, account.css, site.js, guard.js and the verify gate',
    html.includes('assets/account.js') && html.includes('assets/account.css') && html.includes('assets/site.js') &&
    html.includes('assets/guard.js') && html.includes('/infinity/assets/verify.js') && html.includes('/infinity/assets/verify.css'));
  const hosts = (html.match(/https?:\/\/[^"'\s>]+/g) || []).map((u) => { try { return new URL(u).host; } catch { return '?'; } });
  ok(file + ' references no external host', hosts.every((h) => ['github.com', 'api.github.com', 'zssx-2026.github.io'].includes(h)) && !/cdn/i.test(html));
}
/* ---- the network inventory, straight from the source ---- */
const lines = js.split('\n');
const fetchLines = lines.map((l, i) => [i + 1, l]).filter(([, l]) => /\bfetch\s*\(/.test(l));
const xhrLines = lines.map((l, i) => [i + 1, l]).filter(([, l]) => /XMLHttpRequest|sendBeacon|new WebSocket|EventSource|importScripts|\beval\s*\(/.test(l));
const urls = Array.from(new Set((js.match(/https:\/\/[A-Za-z0-9._\/-]+/g) || []))).sort();
console.log('');
console.log('network inventory (account.js)');
console.log('  fetch( occurrences: ' + fetchLines.length);
fetchLines.forEach(([n, l]) => console.log('    line ' + n + ': ' + l.trim().slice(0, 100)));
console.log('  XHR / beacon / WebSocket / EventSource / importScripts / eval occurrences: ' + xhrLines.length);
xhrLines.forEach(([n, l]) => console.log('    line ' + n + ': ' + l.trim().slice(0, 100)));
console.log('  literal URLs: ' + JSON.stringify(urls));
ok('the module contains exactly one fetch call site (the gh helper)', fetchLines.length === 1, fetchLines.map(([n]) => n));
ok('no XHR, beacon, WebSocket, EventSource, importScripts or eval', xhrLines.length === 0, xhrLines);
ok('the only literal hosts are api.github.com and github.com/login', urls.every((u) => u.startsWith('https://api.github.com/') || u.startsWith('https://github.com/login/')), urls);
ok('no CDN or third-party host in the module', !/cdnjs|unpkg|jsdelivr|googleapis|cloudflare/i.test(js));
/* ---- the controls the flow needs ---- */
const ids = ['acct-create', 'acct-pat-go', 'acct-device-go', 'acct-b2-start', 'acct-b2-confirm', 'acct-totp-start', 'acct-totp-confirm',
  'acct-export', 'acct-product', 'acct-import-file', 'acct-login', 'acct-code', 'acct-lock', 'acct-remove', 'acct-qr'];
const missing = ids.filter((id) => !js.includes("'" + id + "'"));
ok('every control the flow needs is wired in account.js', missing.length === 0, missing);
ok('the QR is drawn on a canvas from the local encoder', js.includes("getContext('2d')") && js.includes('qrMatrix('));
ok('trust levels are shown as distinct labels', js.includes('trustSelf') && js.includes('trustGithub') && js.includes('selfAttested'));
ok('the product file target path is documented in the UI', js.includes('%LOCALAPPDATA%'));
/* ---- crypto parameters advertised in the module ---- */
ok('PBKDF2 iterations are 250000 (>= 200k)', js.includes('250000'));
ok('AES-GCM 256 is used', js.includes("name: 'AES-GCM', length: 256"));
ok('TOTP is SHA-1, 30 s, 6 digits with a +/-1 step window', js.includes("'SHA-1'") && js.includes('period: 30') && js.includes('digits: 6') && js.includes('totpVerify'));
ok('recovery codes are hashed with SHA-256', js.includes("'SHA-256'") && js.includes('sha256Hex'));
console.log('');
console.log(failures === 0 ? 'ALL ' + checks + ' STATIC CHECKS PASS' : failures + ' of ' + checks + ' STATIC CHECKS FAILED');
process.exit(failures === 0 ? 0 : 1);
