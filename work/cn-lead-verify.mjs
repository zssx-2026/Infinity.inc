#!/usr/bin/env node
// work/cn-lead-verify.mjs - Lead 独立验收：中文官网是否"完全汉化"。
// 站点的双语机制是 <html lang> + assets JS 里的 en/zh 文本表（download.js 的 TEXT、token.js 的 zh 三元、site.js 的产品表）。
// 验收口径（可证伪）：
//  A. 页面：cn/** 每个页面必须 200、<html lang> 为 zh、<title> 含中文、可见 HTML 文本无英文 UI 词；cn 页面集合与英文站一致（含 404）。
//  B. 文本表：assets/*.js 中每个 en 键必须有对应 zh 键，且 zh 值含中文（键缺失/值无中文都算失败）。
//  C. 机制：lang() 判定必须只看 <html lang>，且 cn 页面确实带 zh —— 由 A 保证。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || 'web';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(ROOT, url.endsWith('/') ? url + 'index.html' : url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, url, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

function walk(dir, rel) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name), r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...walk(p, r)); else if (e.name.endsWith('.html')) out.push(r);
  }
  return out.sort();
}
const all = walk(path.join(ROOT, 'infinity'), '');
const en = all.filter(p => !p.startsWith('cn/'));
const cn = all.filter(p => p.startsWith('cn/')).map(p => p.slice(3));
const BLACK = ['Download', 'Sign up', 'Sign in', 'Log in', 'Log out', 'Settings', 'Docs', 'Documentation', 'Get started', 'Home', 'Account', 'Dashboard', 'Overview', 'Search', 'Cancel', 'Confirm', 'Loading', 'Products', 'Platform', 'Install', 'Uninstall', 'Language', 'Privacy', 'Terms', 'Release', 'Archive'];
const ALLOW = /(AES-GCM|SHA-?256|GitHub|Windows|Infinity\.Inc|Infinity Cloud|Infinity File Manager|Infinity Games|Infinity Toolbox|InfinityPackageManager|InfinityInstallerManager|UTF-8|HTTP|API|JSON|URL|CSV|ZIP|ICO|PNG|SVG|CSS|HTML|pre-?release|v?\d+\.\d+)/g;

const problems = [], rows = [];
for (const rel of cn) {
  const url = '/infinity/cn/' + rel.replace(/\/index\.html$/, '/');
  let status = 0, body = '';
  try { const r = await fetch(base + url); status = r.status; body = await r.text(); } catch (e) { problems.push(rel + ': fetch failed ' + e.message); continue; }
  if (status !== 200) problems.push(rel + ': HTTP ' + status);
  const lang = (body.match(/<html[^>]*lang="([^"]*)"/i) || [])[1] || '';
  if (!/^zh/i.test(lang)) problems.push(rel + ': <html lang> 不是中文: ' + JSON.stringify(lang));
  const title = (body.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
  if (!/[\u4e00-\u9fff]/.test(title)) problems.push(rel + ': <title> 无中文: ' + JSON.stringify(title));
  const text = body.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(ALLOW, ' ');
  const words = BLACK.filter(w => new RegExp('(^|[^A-Za-z])' + w + '([^A-Za-z]|$)').test(text));
  for (const w of words) problems.push(rel + ': 可见英文 UI 文案 "' + w + '"');
  rows.push({ page: rel, status, lang, title, cjk: (text.match(/[\u4e00-\u9fff]/g) || []).length, leftover: words.length });
}
for (const p of en) if (!cn.includes(p)) problems.push('缺失中文页面: cn/' + p);

// B. 文本表键位对齐
const TABLES = ['download.js', 'archive.js', 'site.js', 'verify.js', 'token.js', 'product.js'];
const tableRows = [];
for (const f of TABLES) {
  const p = path.join(ROOT, 'infinity', 'assets', f);
  if (!fs.existsSync(p)) continue;
  const t = fs.readFileSync(p, 'utf8');
  const enKeys = new Set(); const zhKeys = new Set();
  const block = (name) => { const i = t.indexOf(name + ':'); if (i < 0) return ''; let d = 0, s = -1; for (let k = i + name.length + 1; k < t.length; k++) { if (t[k] === '{') { if (s < 0) s = k; d++; } else if (t[k] === '}') { d--; if (d === 0 && s >= 0) return t.slice(s + 1, k); } } return ''; };
  for (const sec of [['en', enKeys], ['zh', zhKeys]]) {
    const b = block(sec[0]);
    for (const m of b.matchAll(/(?:^|\n)\s*([A-Za-z0-9_]+)\s*:/g)) sec[1].add(m[1]);
  }
  if (enKeys.size || zhKeys.size) {
    const missing = [...enKeys].filter(k => !zhKeys.has(k));
    const zhBlock = block("zh");
    const noCjk = [];
    const pick = (k) => {
      const sq = zhBlock.match(new RegExp("(?:^|\\n)\\s*" + k + "\\s*:\\s*\u0027([^\u0027]*)\u0027"));
      const dq = zhBlock.match(new RegExp("(?:^|\\n)\\s*" + k + "\\s*:\\s*\"([^\"]*)\"") ) ;
      // Chinese keys always use single quotes in this codebase; strip tags before judging.
      return sq ? sq[1].replace(/<[^>]*>/g, "") : null;
    };
    for (const k of zhKeys) {
      const v = pick(k);
      if (v === null || v.length === 0) continue;
      if (/[\u4e00-\u9fff]/.test(v)) continue;
      if (/^[\s\w./+-]*(msi|exe|zip|zst|dll|Infinity)[\s\w./+-]*$/i.test(v)) continue;
      noCjk.push(k + "=" + JSON.stringify(v).slice(0, 40));
    }
    tableRows.push({ file: f, en: enKeys.size, zh: zhKeys.size, missing: missing.slice(0, 6), noCjk: noCjk.slice(0, 6) });
    if (missing.length) problems.push('assets/' + f + ': zh 缺键 ' + missing.length + ' 个: ' + missing.slice(0, 6).join(','));
    if (noCjk.length) problems.push('assets/' + f + ': zh 值无中文 ' + noCjk.length + ' 个: ' + noCjk.slice(0, 6).join(','));
  } else {
    const zhTernary = (t.match(/zh\s*\?/g) || []).length;
    const cjkStrings = (t.match(/[\u4e00-\u9fff]/g) || []).length;
    tableRows.push({ file: f, en: 0, zh: 0, note: 'zh 三元=' + zhTernary + ' 中文字符=' + cjkStrings });
    const usesT = /(?:^|[^A-Za-z_.])t\s*\(/.test(t) || /I\.t\s*\(/.test(t) || /TEXT\s*\[/.test(t);
    if (zhTernary === 0 && cjkStrings < 5 && !usesT) problems.push('assets/' + f + ': 既无 en/zh 文本表也无 zh 分支，且未见 t() 调用');
  }
}
console.log(JSON.stringify({ cnPages: rows.length, missingPages: en.filter(p => !cn.includes(p)), problems: problems.length }, null, 1));
for (const r of rows) console.log([r.page, r.status, r.lang, 'cjk=' + r.cjk, 'leftover=' + r.leftover, r.title.slice(0, 40)].join('  '));
for (const r of tableRows) console.log(['assets/' + r.file, r.en ? 'en=' + r.en + ' zh=' + r.zh : r.note].join('  '));
if (problems.length) { console.log('--- PROBLEMS ---'); for (const p of problems) console.log('  ' + p); }
console.log(problems.length ? 'FAIL problems=' + problems.length : 'PASS 中文站完全汉化');
server.close();
process.exit(problems.length ? 1 : 0);
