#!/usr/bin/env node
/*
 * work/site-seo-verify.mjs - site-seo (task-16) 只读验收
 *
 * 1) 起一个只读静态服务器（只 GET，不写盘），逐个 GET 12 个双语页面并断言 200。
 * 2) 断言每页 canonical / hreflang(en,zh-CN,x-default) / og:* / twitter:* 齐备且取值正确。
 * 3) 断言 sitemap.xml 恰好 10 个 <loc>，逐个带 en/zh-CN/x-default alternate，且集合与页面集合一致。
 * 4) 断言 robots.txt 允许抓取并指向 sitemap。
 * 5) 断言英文 404.html 与中文 cn/404.html 语言切换双向可达。
 *
 * 只读：不修改任何文件。退出码 0 = PASS。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || 'web';
const SITE = path.join(ROOT, 'infinity');
const BASE = 'https://zssx-2026.github.io/';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(SITE, url.endsWith('/') ? url + 'index.html' : url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(SITE, url, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;

const problems = [];
const rows = [];

function decode(s) {
  return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}
const attr = (body, re) => { const m = re.exec(body); return m ? decode(m[1]) : ''; };

function walk(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.indexOf('.retired-') === 0) continue;
    const p = path.join(dir, e.name), r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...walk(p, r));
    else if (e.name.endsWith('.html')) out.push(r);
  }
  return out.sort();
}

function urlFor(rel, isCn) {
  const inner = isCn ? rel.slice(3) : rel;
  let p;
  if (inner === 'index.html') p = '';
  else if (inner.endsWith('/index.html')) p = inner.slice(0, -'index.html'.length);
  else p = inner;
  const enUrl = BASE + p;
  const cnUrl = BASE + 'cn/' + p;
  const url = '/' + rel.replace(/index\.html$/, '');
  return { enUrl, cnUrl, self: isCn ? cnUrl : enUrl, url: isCn ? '/cn/' + inner.replace(/index\.html$/, '') : url };
}

const files = walk(SITE);
if (files.length !== 12) problems.push('页面数不是 12，而是 ' + files.length);
const pages = files.map((rel) => ({ rel, isCn: rel.startsWith('cn/'), ...urlFor(rel, rel.startsWith('cn/')) }));
const byUrl = new Map(pages.map((p) => [p.self, p]));

for (const p of pages) {
  const r = await fetch(origin + p.url);
  const body = await r.text();
  const tag = p.rel;
  if (r.status !== 200) problems.push(tag + ': GET ' + p.url + ' -> HTTP ' + r.status);
  if (!/<html[^>]*lang="/i.test(body)) problems.push(tag + ': 缺 <html lang>');

  const canonical = attr(body, /<link rel="canonical" href="([^"]*)"/i);
  if (canonical !== p.self) problems.push(tag + ': canonical=' + canonical + ' 期望 ' + p.self);

  const alts = {};
  for (const m of body.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]*)"/gi)) alts[m[1]] = decode(m[2]);
  if (alts['en'] !== p.enUrl) problems.push(tag + ': hreflang en=' + alts['en'] + ' 期望 ' + p.enUrl);
  if (alts['zh-CN'] !== p.cnUrl) problems.push(tag + ': hreflang zh-CN=' + alts['zh-CN'] + ' 期望 ' + p.cnUrl);
  if (alts['x-default'] !== p.enUrl) problems.push(tag + ': hreflang x-default=' + alts['x-default'] + ' 期望 ' + p.enUrl);
  if (Object.keys(alts).length !== 3) problems.push(tag + ': hreflang 条目数=' + Object.keys(alts).length + ' 期望 3');

  const ogt = attr(body, /<meta property="og:type" content="([^"]*)"/i);
  const ogu = attr(body, /<meta property="og:url" content="([^"]*)"/i);
  const ogTitle = attr(body, /<meta property="og:title" content="([^"]*)"/i);
  const ogDesc = attr(body, /<meta property="og:description" content="([^"]*)"/i);
  const locale = attr(body, /<meta property="og:locale" content="([^"]*)"/i);
  const localeAlt = attr(body, /<meta property="og:locale:alternate" content="([^"]*)"/i);
  const title = decode((/<title>([\s\S]*?)<\/title>/i.exec(body) || [])[1] || '');
  const desc = attr(body, /<meta name="description" content="([^"]*)"/i);
  const wantLocale = p.isCn ? 'zh_CN' : 'en_US';
  if (ogt !== 'website') problems.push(tag + ': og:type=' + ogt);
  if (ogu !== p.self) problems.push(tag + ': og:url=' + ogu + ' 期望 ' + p.self);
  if (!ogTitle || ogTitle !== title) problems.push(tag + ': og:title=' + ogTitle + ' title=' + title);
  if (!ogDesc) problems.push(tag + ': og:description 为空');
  if (!desc) problems.push(tag + ': meta description 为空');
  if (locale !== wantLocale) problems.push(tag + ': og:locale=' + locale + ' 期望 ' + wantLocale);
  if (localeAlt !== (p.isCn ? 'en_US' : 'zh_CN')) problems.push(tag + ': og:locale:alternate=' + localeAlt);

  const card = attr(body, /<meta name="twitter:card" content="([^"]*)"/i);
  const twTitle = attr(body, /<meta name="twitter:title" content="([^"]*)"/i);
  const twDesc = attr(body, /<meta name="twitter:description" content="([^"]*)"/i);
  if (card !== 'summary') problems.push(tag + ': twitter:card=' + card);
  if (twTitle !== title) problems.push(tag + ': twitter:title 与 title 不一致');
  if (!twDesc) problems.push(tag + ': twitter:description 为空');

  // 双向：对端页面必须把本页列为其 alternate 之一。
  const peer = byUrl.get(p.isCn ? p.enUrl : p.cnUrl);
  if (!peer) problems.push(tag + ': 找不到对端页面 ' + (p.isCn ? p.enUrl : p.cnUrl));
  else {
    const pr = await fetch(origin + peer.url);
    const pbody = await pr.text();
    const palts = {};
    for (const m of pbody.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]*)"/gi)) palts[m[1]] = decode(m[2]);
    if (palts['en'] !== peer.enUrl || palts['zh-CN'] !== peer.cnUrl || palts['x-default'] !== peer.enUrl) {
      problems.push(tag + ': 对端 ' + peer.rel + ' 的 hreflang 不回指本页');
    }
  }

  rows.push({ rel: tag, status: r.status, url: p.url, og: ogTitle.slice(0, 34), locale, desc: ogDesc.length });
}

// 404 语言切换双向
const en404 = await (await fetch(origin + '/404.html')).text();
const cn404 = await (await fetch(origin + '/cn/404.html')).text();
if (!/href="https:\/\/zssx-2026\.github\.io\/cn\/404\.html"/.test(en404)) problems.push('英文 404.html 缺指向 /cn/404.html 的切换链接');
if (!/href="https:\/\/zssx-2026\.github\.io\/404\.html"/.test(cn404)) problems.push('中文 cn/404.html 缺指向 /404.html 的切换链接');

const rootRows = [];

// sitemap.xml
const smPath = path.join(SITE, 'sitemap.xml');
let sitemapLocs = [];
if (!fs.existsSync(smPath)) problems.push('缺 sitemap.xml');
else {
  const sm = fs.readFileSync(smPath, 'utf8');
  if (!/xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/.test(sm)) problems.push('sitemap 缺 xhtml 命名空间');
  for (const m of sm.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const blk = m[1];
    const loc = (blk.match(/<loc>([^<]*)<\/loc>/) || [])[1] || '';
    sitemapLocs.push(loc);
    const alts = {};
    for (const a of blk.matchAll(/<xhtml:link rel="alternate" hreflang="([^"]+)" href="([^"]*)"\/>/g)) alts[a[1]] = a[2];
    const page = byUrl.get(loc);
    if (!page) { problems.push('sitemap: 未知 loc ' + loc); continue; }
    if (alts['en'] !== page.enUrl || alts['zh-CN'] !== page.cnUrl || alts['x-default'] !== page.enUrl) {
      problems.push('sitemap: ' + loc + ' 的 alternate 不齐或不对');
    }
  }
  // task-22：404 页是 noindex，不进 sitemap；断言数改为 10（5 组中英配对）。
  if (sitemapLocs.length !== 10) problems.push('sitemap <loc> 数量=' + sitemapLocs.length + ' 期望 10（404 noindex 已移出）');
  const expected = new Set(pages.filter((p) => !p.rel.endsWith('404.html')).map((p) => p.self));
  const missing = [...expected].filter((u) => !sitemapLocs.includes(u));
  const extra = sitemapLocs.filter((u) => !expected.has(u));
  const noindexInSitemap = sitemapLocs.filter((u) => u.endsWith('404.html'));
  if (noindexInSitemap.length) problems.push('sitemap 仍含 noindex 的 404 URL: ' + noindexInSitemap.join(','));
  if (missing.length) problems.push('sitemap 缺 ' + missing.length + ' 个 URL: ' + missing.slice(0, 3).join(','));
  if (extra.length) problems.push('sitemap 多出 ' + extra.length + ' 个 URL: ' + extra.slice(0, 3).join(','));
}

// robots.txt
const rbPath = path.join(SITE, 'robots.txt');
if (!fs.existsSync(rbPath)) problems.push('缺 robots.txt');
else {
  const rb = fs.readFileSync(rbPath, 'utf8');
  if (!/^User-agent:\s*\*/m.test(rb)) problems.push('robots.txt 缺 User-agent: *');
  if (!/^Allow:\s*\/\s*$/m.test(rb)) problems.push('robots.txt 缺 Allow: /');
  if (!rb.includes('Sitemap: ' + BASE + 'sitemap.xml')) problems.push('robots.txt 的 Sitemap 指向不对');
}

// 部署根 robots.txt：爬虫只读取 https://zssx-2026.github.io/robots.txt 这一份。
const rootRbPath = path.join(ROOT, 'robots.txt');
if (!fs.existsSync(rootRbPath)) problems.push('缺 web/robots.txt（部署根 robots.txt，爬虫实际读取的位置）');
else {
  const rootRb = fs.readFileSync(rootRbPath, 'utf8');
  if (!rootRb.includes('Sitemap: ' + BASE + 'sitemap.xml')) problems.push('web/robots.txt 的 Sitemap 指向不对');
  if (!/^User-agent:\s*\*/m.test(rootRb)) problems.push('web/robots.txt 缺 User-agent: *');
  if (!/^Allow:\s*\/\s*$/m.test(rootRb)) problems.push('web/robots.txt 缺 Allow: /');
}

// task-22：两份 robots.txt 的 Sitemap 指向必须一致。
const sitemapOf = (t) => ((t.match(/^Sitemap:\s*(\S+)/m) || [])[1] || '');
if (fs.existsSync(rbPath) && fs.existsSync(rootRbPath)) {
  const a = sitemapOf(fs.readFileSync(rbPath, 'utf8'));
  const b = sitemapOf(fs.readFileSync(rootRbPath, 'utf8'));
  if (!a || a !== b) problems.push('两份 robots.txt 的 Sitemap 指向不一致: ' + a + ' vs ' + b);
}

const ok = problems.length === 0;
console.log(JSON.stringify({ pages: pages.length, http200: rows.filter((r) => r.status === 200).length, rootPages: rootRows.length, sitemapLocs: sitemapLocs.length, problems: problems.length }, null, 1));
for (const r of rows) console.log(r.status + '  ' + r.url + '  locale=' + r.locale + '  desc=' + r.desc + '  ' + r.rel);
for (const r of rootRows) console.log(r.status + '  (root) ' + r.tag + '  canonical=' + r.canonical);
if (!ok) { console.log('--- PROBLEMS ---'); for (const p of problems) console.log('  ' + p); }
console.log(ok ? 'PASS 12/12 页面 200、sitemap 10 条可索引 URL（404 已排除）、hreflang/og/twitter/robots/404 全部通过' : 'FAIL problems=' + problems.length);
server.close();
process.exit(ok ? 0 : 1);
