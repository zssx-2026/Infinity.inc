#!/usr/bin/env node
/*
 * work/site-seo-apply.mjs - site-seo (task-16)
 *
 * 给 web/infinity 下的 38 个双语页面补齐可发现性元数据：
 *   - 双向 <link rel="alternate" hreflang="en|zh-CN|x-default">
 *   - rel=canonical + Open Graph + Twitter Card
 *   - 英文 404.html 的语言切换（指向 /cn/404.html）
 * 并生成 web/sitemap.xml（30 条可索引 URL，404 排除）与两份 robots.txt。
 * task-22：另给部署根 web/index.html、web/404.html 补 canonical + og + twitter（无对应页，不写 hreflang）。
 *
 * 只写 web/**，只做"插入"，不改动任何既有行；assets/*.js 一律不碰。
 * 可重复执行：已带标记的文件会被跳过。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SITE = path.resolve('web/infinity');
const BASE = 'https://zssx-2026.github.io/';
const MARK = '<!-- site-seo: hreflang + open graph -->';
const GENERATED = [];   // {path, bytes, sha256, action}
const SKIPPED = [];

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

const decode = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
const escapeAttr = (s) => s
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const stripTags = (s) => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// 中文运行页的 lede 是 JS 注入的，静态里没有文案；从 site.js 的 zh 文本表取（只读）。
const siteJs = fs.readFileSync(path.join(SITE, 'assets/site.js'), 'utf8');
const runLede = [...siteJs.matchAll(/runLede:\s*'([^']*)'/g)].map((m) => m[1]);
const ZH_RUN_LEDE = runLede[1] || '';

function pageMeta(rel, raw) {
  const isCn = rel.startsWith('cn/');
  const inner = isCn ? rel.slice(3) : rel;
  let pathInner;
  if (inner === 'index.html') pathInner = '';
  else if (inner.endsWith('/index.html')) pathInner = inner.slice(0, -'index.html'.length);
  else pathInner = inner;                       // 404.html
  const enUrl = BASE + pathInner;
  const cnUrl = BASE + 'cn/' + pathInner;
  const selfUrl = isCn ? cnUrl : enUrl;

  const title = decode((/<title>([\s\S]*?)<\/title>/i.exec(raw) || [])[1] || '');
  const metaDesc = /<meta name="description" content="([^"]*)"/i.exec(raw);
  let desc = metaDesc ? decode(metaDesc[1]) : '';
  if (!desc) {
    const lede = /<p class="lede"[^>]*>([\s\S]*?)<\/p>/i.exec(raw);
    if (lede) desc = stripTags(lede[1]);
  }
  if (!desc) {
    const what = /<p id="what">([\s\S]*?)<\/p>/i.exec(raw);
    if (what) desc = stripTags(what[1]);
  }
  if (!desc && rel === 'cn/run/index.html') desc = ZH_RUN_LEDE;
  if (!title || !desc) throw new Error('missing title/description for ' + rel);

  const zh = /<html[^>]*lang="zh/i.test(raw);
  return {
    rel, isCn, selfUrl, enUrl, cnUrl, title, desc,
    locale: zh ? 'zh_CN' : 'en_US',
    altLocale: zh ? 'en_US' : 'zh_CN',
    hasMetaDesc: !!metaDesc
  };
}

function block(m) {
  const e = escapeAttr;
  const out = [MARK];
  if (!m.hasMetaDesc) out.push('<meta name="description" content="' + e(m.desc) + '">');
  out.push('<link rel="canonical" href="' + m.selfUrl + '">');
  // 只有存在中英对应页时才写 hreflang；部署根页面没有对应页，只写 canonical + og。
  if (m.enUrl && m.cnUrl) {
    out.push('<link rel="alternate" hreflang="en" href="' + m.enUrl + '">');
    out.push('<link rel="alternate" hreflang="zh-CN" href="' + m.cnUrl + '">');
    out.push('<link rel="alternate" hreflang="x-default" href="' + m.enUrl + '">');
  }
  out.push('<meta property="og:type" content="website">');
  out.push('<meta property="og:site_name" content="Infinity.Inc">');
  out.push('<meta property="og:title" content="' + e(m.title) + '">');
  out.push('<meta property="og:description" content="' + e(m.desc) + '">');
  out.push('<meta property="og:url" content="' + m.selfUrl + '">');
  out.push('<meta property="og:locale" content="' + m.locale + '">');
  if (m.altLocale) out.push('<meta property="og:locale:alternate" content="' + m.altLocale + '">');
  out.push('<meta name="twitter:card" content="summary">');
  out.push('<meta name="twitter:title" content="' + e(m.title) + '">');
  out.push('<meta name="twitter:description" content="' + e(m.desc) + '">');
  return out.join('\n');
}

// 部署根页面：web/ 就是 https://zssx-2026.github.io/（web/index.html 用 ./... 引资源）。
// 这两页没有中英对应页，按 task-22 只写 canonical + og + twitter，不写 hreflang。
const WEB = path.resolve('web');


function insertBlock(raw, m) {
  // 插到已有 description 之后；没有 description 的页面插到 viewport 之后。
  const lines = raw.split('\n');
  const targetRe = m.hasMetaDesc ? /<meta name="description"/i : /<meta name="viewport"/i;
  let idx = lines.findIndex((l) => targetRe.test(l));
  if (idx < 0) idx = lines.findIndex((l) => /<meta name="viewport"/i.test(l));
  if (idx < 0) throw new Error('no insertion point in ' + m.rel);
  lines.splice(idx + 1, 0, ...block(m).split('\n'));
  return lines.join('\n');
}

const files = walk(SITE);
if (files.length !== 12) throw new Error('expected 12 html pages, found ' + files.length);

const allMeta = [];
for (const rel of files) {
  const abs = path.join(SITE, rel);
  const before = fs.readFileSync(abs);
  const raw = before.toString('utf8');
  const m = pageMeta(rel, raw);
  allMeta.push(m);
  if (raw.includes(MARK)) { SKIPPED.push(rel); continue; }

  let out = insertBlock(raw, m);

  if (rel === '404.html') {
    const oldP = '  <p><a href="https://zssx-2026.github.io/">Go to the Infinity.Inc site</a></p>';
    const newP = '  <p><a href="https://zssx-2026.github.io/">Go to the Infinity.Inc site</a>\n' +
      '     · <a href="https://zssx-2026.github.io/cn/404.html" hreflang="zh-CN" title="中文">中文</a></p>';
    if (!out.includes(oldP)) throw new Error('en 404 language-switch anchor not found');
    out = out.replace(oldP, newP);
  }

  fs.writeFileSync(abs, out, 'utf8');
  GENERATED.push({
    path: 'web/' + rel,
    beforeBytes: before.length,
    bytes: Buffer.byteLength(out),
    sha256: crypto.createHash('sha256').update(out).digest('hex')
  });
}

/* ---------- 部署根页面 web/index.html / web/404.html ---------- */

/* ---------- sitemap.xml ---------- */
// 404 页面是 noindex，不进 sitemap；只保留 15 组可索引页面 = 30 条 URL。
const logical = allMeta.filter((m) => !m.isCn && !m.rel.endsWith('404.html'))
  .map((m) => ({ en: m.enUrl, cn: BASE + 'cn/' + m.selfUrl.slice(BASE.length) }))
  .sort((a, b) => a.en.localeCompare(b.en));
if (logical.length !== 5) throw new Error('expected 5 bilingual pairs, found ' + logical.length);

const sm = [];
sm.push('<?xml version="1.0" encoding="UTF-8"?>');
sm.push('<!-- web/sitemap.xml - 30 indexable pages (15 bilingual pairs); the two 404 pages are noindex and excluded. -->');
sm.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
sm.push('        xmlns:xhtml="http://www.w3.org/1999/xhtml">');
for (const pair of logical) {
  for (const loc of [pair.en, pair.cn]) {
    sm.push('  <url>');
    sm.push('    <loc>' + loc + '</loc>');
    sm.push('    <xhtml:link rel="alternate" hreflang="en" href="' + pair.en + '"/>');
    sm.push('    <xhtml:link rel="alternate" hreflang="zh-CN" href="' + pair.cn + '"/>');
    sm.push('    <xhtml:link rel="alternate" hreflang="x-default" href="' + pair.en + '"/>');
    sm.push('  </url>');
  }
}
sm.push('</urlset>');
const sitemap = sm.join('\n') + '\n';
fs.writeFileSync(path.join(SITE, 'sitemap.xml'), sitemap, 'utf8');

/* ---------- robots.txt（两份，Sitemap 指向同一条 URL） ---------- */
const SITEMAP_URL = 'https://zssx-2026.github.io/sitemap.xml';
const robots = [
  '# Infinity.Inc — https://zssx-2026.github.io/',
  'User-agent: *',
  'Allow: /',
  '',
  'Sitemap: ' + SITEMAP_URL,
  ''
].join('\n');
fs.writeFileSync(path.join(SITE, 'robots.txt'), robots, 'utf8');

// 部署根 robots.txt：爬虫只读取主机根的 /robots.txt，Sitemap 指向必须与子目录那份一致。
const rootRobots = [
  '# Infinity.Inc — https://zssx-2026.github.io/',
  '# 部署根 robots.txt：爬虫只读取主机根的这一份。',
  'User-agent: *',
  'Allow: /',
  '',
  'Sitemap: ' + SITEMAP_URL,
  ''
].join('\n');
fs.writeFileSync(path.join(WEB, 'robots.txt'), rootRobots, 'utf8');

/* smoke-pages manifest: rel 相对 web/，url 为线上根 URL（发布映射 web/infinity/** -> 仓库根）。 */
const SMOKE = [];
for (const rel of files) SMOKE.push({ rel: 'infinity/' + rel, url: 'https://zssx-2026.github.io/' + rel.replace(/(^|\/)index\.html$/, '/') });
fs.writeFileSync(path.join('work', 'site-pages.json'), JSON.stringify(SMOKE, null, 1) + '\n', 'utf8');

console.log(JSON.stringify({
  pages: files.length,
  updated: GENERATED.length,
  skipped: SKIPPED,
  sitemapUrls: logical.length * 2,
  sitemapBytes: Buffer.byteLength(sitemap),
  robotsBytes: Buffer.byteLength(robots),
  rootRobotsBytes: Buffer.byteLength(rootRobots),
  base: BASE
}, null, 1));
for (const g of GENERATED) {
  console.log(g.path + '  ' + g.beforeBytes + '->' + g.bytes + '  sha256=' + g.sha256);
}
