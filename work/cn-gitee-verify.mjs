/*
 * work/cn-gitee-verify.mjs - independent check of the Chinese/English content
 * source split for the Infinity.Inc site.
 *
 * What it does:
 *   1. serves web/ over a local HTTP server (in this same process) and loads
 *      the Chinese and the English copy of the key pages from it;
 *   2. runs assets/sources.js + site.js + download.js + archive.js in a small
 *      DOM shim with fetch() intercepted, once per language, and collects every
 *      content URL the pages produce;
 *   3. asserts the Chinese copy only ever produces gitee.com content URLs and
 *      the English copy only ever github.com ones, with no cross-source mixing;
 *   4. scans the assets and the pages statically for the same rule.
 *
 * It starts no external process and kills nothing: the server lives inside
 * this process and is closed at the end.
 *
 * Run:  D:\program\nodejs\node.exe work/cn-gitee-verify.mjs
 * Exit: 0 when every assertion passes, 1 otherwise.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WEB = path.join(ROOT, 'web');
const ASSETS = path.join(WEB, 'infinity', 'assets');

const results = [];
function check(name, ok, detail) {
  results.push({ name: name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
}
function hostOf(u) {
  const m = /^https?:\/\/([^\/]+)/i.exec(String(u || ''));
  return m ? m[1].toLowerCase() : '';
}
/* A URL that names one of the two content sources for this project. */
function isContentUrl(u) {
  return /^https?:\/\/(?:github\.com\/zssx-2026|api\.github\.com\/repos\/zssx-2026|raw\.githubusercontent\.com\/zssx-2026|gitee\.com\/zssx2026|gitee\.com\/api\/v5\/repos\/zssx2026)(?:\/|$)/.test(String(u || ''));
}
function contentHostKey(u) {
  const s = String(u || '');
  if (/gitee\.com/.test(s)) return 'gitee.com';
  if (/github\.com/.test(s)) return 'github.com';
  return '(other:' + hostOf(s) + ')';
}

/* ------------------------------------------------------------- HTTP server */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};
const server = http.createServer(function (req, res) {
  let p = decodeURIComponent(String(req.url || '/').split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(WEB, p.replace(/^[\/]+/, '')));
  if (!file.startsWith(WEB)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, function (err, buf) {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
const PORT = server.address().port;
const ORIGIN = 'http://127.0.0.1:' + PORT;
async function httpGet(u) {
  const res = await fetch(u);
  const text = await res.text();
  return { status: res.status, text: text };
}

/* ---------------------------------------------------------------- DOM shim */
function makeNode(tag) {
  const node = {
    tagName: tag,
    children: [],
    attributes: {},
    textContent: '',
    className: '',
    style: { setProperty: function () {} },
    checked: false,
    value: '',
    hidden: false,
    parentNode: null,
    classList: {
      _s: {},
      add: function (c) { this._s[c] = true; },
      remove: function (c) { delete this._s[c]; },
      toggle: function () {},
      contains: function (c) { return !!this._s[c]; }
    },
    appendChild: function (c) { c.parentNode = this; this.children.push(c); return c; },
    insertBefore: function (c, ref) {
      const i = this.children.indexOf(ref);
      if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
      c.parentNode = this; return c;
    },
    removeChild: function (c) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      c.parentNode = null; return c;
    },
    setAttribute: function (k, v) {
      this.attributes[k] = String(v);
      if (k === 'class') this.className = String(v);
    },
    getAttribute: function (k) {
      return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null;
    },
    hasAttribute: function (k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); },
    addEventListener: function () {},
    removeEventListener: function () {},
    querySelectorAll: function () { return []; },
    querySelector: function () { return null; }
  };
  Object.defineProperty(node, 'firstChild', { get: function () { return this.children[0] || null; } });
  return node;
}
function collect(node, out, opts) {
  out = out || [];
  opts = opts || {};
  if (!node) return out;
  const exit = /github-exit/.test(String(node.className || ''));
  if (node.attributes) {
    if (exit) {
      /* The hand-clicked "manual exit" to GitHub: collected only on request,
       * never mixed into the automatic content URLs. */
      if (opts.exits) out.push(node.attributes.href || '');
    } else if (!opts.exits) {
      if (node.attributes.href) out.push(node.attributes.href);
      if (node.attributes.src) out.push(node.attributes.src);
    }
  }
  (node.children || []).forEach(function (c) { collect(c, out, opts); });
  return out;
}
function collectText(node, out) {
  out = out || [];
  if (!node) return out;
  if (node.textContent) out.push(String(node.textContent));
  (node.children || []).forEach(function (c) { collectText(c, out); });
  return out;
}

/* ------------------------------------------------------------ page context */
function makeContext(lang, pagePath, fetchImpl) {
  const html = makeNode('html');
  html.attributes.lang = lang === 'zh' ? 'zh-CN' : 'en';
  const document = {
    currentScript: null,
    readyState: 'complete',
    title: '',
    documentElement: html,
    body: makeNode('body'),
    head: makeNode('head'),
    createElement: function (t) { return makeNode(t); },
    createTextNode: function (t) { const n = makeNode('#text'); n.textContent = t; return n; },
    querySelectorAll: function () { return []; },
    querySelector: function () { return null; },
    getElementById: function () { return null; },
    addEventListener: function () {},
    removeEventListener: function () {}
  };
  const store = {};
  const localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
  };
  const location = {
    pathname: pagePath, href: ORIGIN + pagePath, search: '', hash: '',
    origin: ORIGIN, replace: function () {}, assign: function () {}
  };
  const sandbox = {
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: function () { return 0; },
    clearInterval: function () {},
    URL: URL,
    TextDecoder: TextDecoder,
    TextEncoder: TextEncoder,
    Uint8Array: Uint8Array,
    Promise: Promise,
    Object: Object, Array: Array, String: String, Number: Number, Boolean: Boolean,
    Math: Math, JSON: JSON, RegExp: RegExp, Date: Date, Error: Error, TypeError: TypeError,
    isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat,
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    atob: function (s) { return Buffer.from(String(s), 'base64').toString('binary'); },
    btoa: function (s) { return Buffer.from(String(s), 'binary').toString('base64'); },
    navigator: {},
    performance: { now: function () { return Date.now(); } },
    MutationObserver: undefined,
    localStorage: localStorage,
    location: location,
    document: document,
    fetch: fetchImpl
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  return { ctx: ctx, sandbox: sandbox, document: document, location: location };
}
function runAsset(ctx, file) {
  const code = fs.readFileSync(path.join(ASSETS, file), 'utf8');
  vm.runInContext(code, ctx, { filename: file });
}
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms === undefined ? 30 : ms); }); }

/* --------------------------------------------------------- live fixtures */
function giteeRelease(repo) {
  const tag = 'v1.0.0-pre5';
  return [{
    id: 1, tag_name: tag, name: repo + ' ' + tag, prerelease: true, draft: false,
    created_at: '2026-10-06T01:34:24Z', body: '',
    html_url: 'https://gitee.com/zssx2026/' + repo + '/releases/tag/' + tag,
    assets: [{
      name: repo.replace(/-/g, '') + '_1.0.0-pre5_win64_setup.exe', size: 514535,
      browser_download_url: 'https://gitee.com/zssx2026/' + repo +
        '/releases/download/' + tag + '/' + repo.replace(/-/g, '') + '_1.0.0-pre5_win64_setup.exe'
    }]
  }];
}
function githubRelease(repo) {
  const tag = 'v1.0.0-pre5';
  return [{
    id: 1, tag_name: tag, name: repo + ' ' + tag, prerelease: true, draft: false,
    published_at: '2026-10-06T01:34:24Z', body: '',
    html_url: 'https://github.com/zssx-2026/' + repo + '/releases/tag/' + tag,
    assets: [{
      name: repo.replace(/-/g, '') + '_1.0.0-pre5_win64_setup.exe', size: 514535,
      browser_download_url: 'https://github.com/zssx-2026/' + repo +
        '/releases/download/' + tag + '/' + repo.replace(/-/g, '') + '_1.0.0-pre5_win64_setup.exe'
    }]
  }];
}

const snapshot = JSON.parse(fs.readFileSync(path.join(ASSETS, 'releases.json'), 'utf8'));

/*
 * One full language run. Returns everything the assertions need, plus the list
 * of URLs that were actually requested.
 */
async function runLanguage(opts) {
  const lang = opts.lang;
  const withSources = opts.withSources !== false;
  const emptySnapshot = !!opts.emptySnapshot;
  const pagePath = lang === 'zh'
    ? '/infinity/cn/download/infinitycloud/'
    : '/infinity/download/infinitycloud/';
  const requests = [];
  const fetchImpl = async function (url) {
    const u = String(url);
    requests.push(u);
    if (u.indexOf('/assets/releases.json') >= 0) {
      const body = emptySnapshot ? { repos: {} } : snapshot;
      return { ok: true, status: 200, json: async function () { return body; },
        text: async function () { return JSON.stringify(body); } };
    }
    if (/\/releases\?per_page=/.test(u)) {
      const list = /gitee\.com/.test(u) ? giteeRelease('Infinity-Cloud') : githubRelease('Infinity-Cloud');
      return { ok: true, status: 200, json: async function () { return list; },
        text: async function () { return JSON.stringify(list); } };
    }
    return { ok: false, status: 404, json: async function () { return {}; },
      text: async function () { return 'not found'; } };
  };

  const cx = makeContext(lang, pagePath, fetchImpl);
  if (withSources) runAsset(cx.ctx, 'sources.js');
  cx.document.currentScript = { src: ORIGIN + '/infinity/assets/site.js' };
  runAsset(cx.ctx, 'site.js');
  runAsset(cx.ctx, 'download.js');
  runAsset(cx.ctx, 'archive.js');
  const I = cx.sandbox.INFINITY;

  const clue = { lang: lang, source: I.source(), productHref: I.productHref({ repo: 'Infinity-Cloud', slug: 'infinitycloud', name: 'Infinity Cloud' }) };

  /* the download list, from the local snapshot (the offline fallback) */
  const beforeDl = requests.length;
  const dlHost = makeNode('div');
  I.download.render(dlHost, { slug: 'infinitycloud', repo: 'Infinity-Cloud', name: 'Infinity Cloud' });
  await tick(40);
  clue.downloadRequests = requests.slice(beforeDl);
  clue.downloadHrefs = collect(dlHost, []);
  clue.downloadExits = collect(dlHost, [], { exits: true });
  clue.downloadText = collectText(dlHost, []).join(' ');

  /* the archive, also from the snapshot */
  const beforeArc = requests.length;
  const arcHost = makeNode('div');
  I.archive.render(arcHost);
  await tick(40);
  clue.archiveRequests = requests.slice(beforeArc);
  clue.archiveHrefs = collect(arcHost, []);
  clue.archiveExits = collect(arcHost, [], { exits: true });
  clue.archiveText = collectText(arcHost, []).join(' ');

  /* content request through site.js gh(): releases of a project repository */
  const before = requests.length;
  try { await I.gh('/repos/zssx-2026/Infinity-Cloud/releases?per_page=2'); } catch (e) { /* recorded */ }
  clue.contentRequests = requests.slice(before);

  /* the account conversation is the declared exception and stays on GitHub */
  const before2 = requests.length;
  try { await I.gh('/user'); } catch (e) { /* recorded */ }
  clue.accountRequests = requests.slice(before2);

  clue.mirror = {
    web: I.sources.mirror('https://github.com/zssx-2026/Infinity-Cloud/releases/tag/v1', lang),
    api: I.sources.mirror('https://api.github.com/repos/zssx-2026/Infinity-Cloud/releases', lang),
    raw: I.sources.mirror('https://raw.githubusercontent.com/zssx-2026/Infinity.inc/main/cpp/README.md', lang),
    account: I.sources.mirror('https://github.com/settings/tokens', lang),
    user: I.sources.mirror('https://api.github.com/user', lang),
    giteeWeb: I.sources.mirror('https://gitee.com/zssx2026/Infinity-Cloud/releases/tag/v1', lang),
    giteeApi: I.sources.mirror('https://gitee.com/api/v5/repos/zssx2026/Infinity-Cloud/releases', lang),
    giteeRaw: I.sources.mirror('https://gitee.com/zssx2026/Infinity.inc/raw/main/cpp/README.md', lang)
  };
  clue.rawUrl = I.sources.source(lang).rawUrl('Infinity-Cloud', 'cpp/README.md');

  /* the live path: with an empty snapshot the module must ask its own source */
  if (emptySnapshot) {
    const beforeLive = requests.length;
    const liveHost = makeNode('div');
    I.download.render(liveHost, { slug: 'infinitycloud', repo: 'Infinity-Cloud', name: 'Infinity Cloud' });
    await tick(40);
    clue.liveHrefs = collect(liveHost, []);
    clue.liveExits = collect(liveHost, [], { exits: true });
    clue.liveRequests = requests.slice(beforeLive)
      .filter(function (u) { return /\/releases\?per_page=/.test(u); });
  }
  return clue;
}

/* ---------------------------------------------------------------- checks */
function hostChecks(label, urls, want, failHosts) {
  const seen = {};
  const bad = [];
  (urls || []).forEach(function (u) {
    if (!isContentUrl(u)) return;
    const key = contentHostKey(u);
    seen[key] = (seen[key] || 0) + 1;
    if (key !== want) bad.push(u);
  });
  check(label + ': content URLs only on ' + want, bad.length === 0,
    bad.length ? bad.slice(0, 3).join(' | ') : JSON.stringify(seen));
  return seen;
}

/* --- 1. pages load over HTTP and carry the right script tags -------------- */
const ROUTES = [
  '/infinity/cn/index.html', '/infinity/cn/download/index.html',
  '/infinity/cn/download/infinitycloud/index.html', '/infinity/cn/versions/archive/index.html',
  '/infinity/cn/docs/index.html', '/infinity/cn/myself/index.html',
  '/infinity/index.html', '/infinity/download/index.html',
  '/infinity/download/infinitycloud/index.html', '/infinity/versions/archive/index.html',
  '/infinity/docs/index.html', '/infinity/myself/index.html'
];
const pageText = {};
for (const route of ROUTES) {
  const r = await httpGet(ORIGIN + route);
  pageText[route] = r.text;
  check('HTTP 200 ' + route, r.status === 200, 'status=' + r.status);
}
const sr = await httpGet(ORIGIN + '/infinity/assets/sources.js');
check('HTTP 200 /infinity/assets/sources.js', sr.status === 200, 'status=' + sr.status);

const cnPages = fs.readdirSync(path.join(WEB, 'infinity', 'cn'), { recursive: true })
  .filter(function (f) { return String(f).endsWith('.html'); })
  .map(function (f) { return path.join(WEB, 'infinity', 'cn', String(f)); });
const enPages = fs.readdirSync(path.join(WEB, 'infinity'), { recursive: true })
  .filter(function (f) { return String(f).endsWith('.html') && String(f).indexOf('cn') !== 0; })
  .map(function (f) { return path.join(WEB, 'infinity', String(f)); })
  .filter(function (f) { return fs.statSync(f).isFile(); });

let cnWithSite = 0, cnWithSources = 0, cnMissingSources = [];
let cnGithubLiterals = [], enGiteeLiterals = [];
for (const file of cnPages) {
  const text = fs.readFileSync(file, 'utf8');
  if (text.indexOf('assets/site.js') < 0) continue;
  cnWithSite++;
  if (text.indexOf('assets/sources.js') >= 0) cnWithSources++;
  else cnMissingSources.push(path.relative(ROOT, file));
  if (/github\.com\/zssx-2026/.test(text)) cnGithubLiterals.push(path.relative(ROOT, file));
}
for (const file of enPages) {
  const text = fs.readFileSync(file, 'utf8');
  if (/gitee\.com/.test(text)) enGiteeLiterals.push(path.relative(ROOT, file));
}
check('every cn page that loads site.js also loads sources.js', cnMissingSources.length === 0,
  'missing: ' + JSON.stringify(cnMissingSources));
check('cn pages (' + cnWithSite + ') have no github.com/zssx-2026 content literal',
  cnGithubLiterals.length === 0, JSON.stringify(cnGithubLiterals));
check('en pages (' + enPages.length + ') have no gitee.com literal',
  enGiteeLiterals.length === 0, JSON.stringify(enGiteeLiterals));

/* --- 2. static scans of the assets --------------------------------------- */
const src = fs.readFileSync(path.join(ASSETS, 'sources.js'), 'utf8');
check('sources.js declares the GitHub API base',
  src.indexOf('https://api.github.com/repos/zssx-2026/') >= 0);
check('sources.js declares the Gitee API base',
  src.indexOf('https://gitee.com/api/v5/repos/zssx2026/') >= 0);
check('sources.js declares the Gitee raw base',
  src.indexOf('https://gitee.com/zssx2026/<repo>/raw/main/') >= 0);
check('sources.js declares the GitHub raw base',
  src.indexOf('https://raw.githubusercontent.com/zssx-2026/') >= 0);

const dl = fs.readFileSync(path.join(ASSETS, 'download.js'), 'utf8');
check('download.js no longer hardcodes api.github.com', !/api\.github\.com/.test(dl));
check('download.js no longer hardcodes github.com/zssx-2026', !/github\.com\/zssx-2026/.test(dl));
check('download.js asks its source for the release list', /releasesApi/.test(dl) && /I\.source/.test(dl));

const ar = fs.readFileSync(path.join(ASSETS, 'archive.js'), 'utf8');
check('archive.js resolves snapshot URLs through the source', /sources\.mirror/.test(ar));

const site = fs.readFileSync(path.join(ASSETS, 'site.js'), 'utf8');
check('site.js routes /repos/ content through the source', /apiRoot/.test(site) && /s\.owner/.test(site));
check('site.js keeps the account conversation on api.github.com',
  /url = 'https:\/\/api\.github\.com' \+ path/.test(site));

/* --- 3. the two language runs -------------------------------------------- */
const zh = await runLanguage({ lang: 'zh' });
const en = await runLanguage({ lang: 'en' });
const zhLive = await runLanguage({ lang: 'zh', emptySnapshot: true });
const enLive = await runLanguage({ lang: 'en', emptySnapshot: true });
const zhNoSources = await runLanguage({ lang: 'zh', withSources: false });

/* the four facts INFINITY.source() must return */
check('zh source() api', zh.source.api === 'https://gitee.com/api/v5/repos/zssx2026/', zh.source.api);
check('zh source() web', zh.source.web === 'https://gitee.com/zssx2026', zh.source.web);
check('zh source() raw', zh.source.raw === 'https://gitee.com/zssx2026/<repo>/raw/main/', zh.source.raw);
check('zh source() owner', zh.source.owner === 'zssx2026', zh.source.owner);
check('en source() api', en.source.api === 'https://api.github.com/repos/zssx-2026/', en.source.api);
check('en source() web', en.source.web === 'https://github.com/zssx-2026', en.source.web);
check('en source() raw', en.source.raw === 'https://raw.githubusercontent.com/zssx-2026/', en.source.raw);
check('en source() owner', en.source.owner === 'zssx-2026', en.source.owner);

/* host consistency, per language */
hostChecks('zh productHref', [zh.productHref], 'gitee.com');
hostChecks('zh download (snapshot)', zh.downloadHrefs, 'gitee.com');
hostChecks('zh archive (snapshot)', zh.archiveHrefs, 'gitee.com');
hostChecks('zh download (live)', zhLive.liveHrefs, 'gitee.com');
hostChecks('zh content request', zh.contentRequests, 'gitee.com');
hostChecks('zh without sources.js (fallback)', zhNoSources.downloadHrefs, 'gitee.com');
hostChecks('zh without sources.js (archive)', zhNoSources.archiveHrefs, 'gitee.com');
hostChecks('en productHref', [en.productHref], 'github.com');
hostChecks('en download (snapshot)', en.downloadHrefs, 'github.com');
hostChecks('en archive (snapshot)', en.archiveHrefs, 'github.com');
hostChecks('en download (live)', enLive.liveHrefs, 'github.com');
hostChecks('en content request', en.contentRequests, 'github.com');

/* no cross-source mixing */
const zhAll = [zh.productHref].concat(zh.downloadHrefs, zh.archiveHrefs, zhLive.liveHrefs, zh.contentRequests);
const enAll = [en.productHref].concat(en.downloadHrefs, en.archiveHrefs, enLive.liveHrefs, en.contentRequests);
check('zh has no github.com content URL', !zhAll.some(function (u) { return isContentUrl(u) && /github\.com/.test(u); }),
  zhAll.filter(function (u) { return isContentUrl(u) && /github\.com/.test(u); }).slice(0, 3).join(' | '));
check('en has no gitee.com content URL', !enAll.some(function (u) { return isContentUrl(u) && /gitee\.com/.test(u); }),
  enAll.filter(function (u) { return isContentUrl(u) && /gitee\.com/.test(u); }).slice(0, 3).join(' | '));

/* --- the explicit pending-mirror notice and the manual exit --------------- */
const zhAuto = [].concat(zh.downloadRequests, zh.archiveRequests,
  zhLive.liveRequests, zh.contentRequests);
const enAuto = [].concat(en.downloadRequests, en.archiveRequests,
  enLive.liveRequests, en.contentRequests);
function hostsOf(list) {
  const m = {};
  list.forEach(function (u) { const h = hostOf(u); m[h] = (m[h] || 0) + 1; });
  return m;
}
check('zh automatic content requests hit nothing but gitee.com (and the local snapshot)',
  zhAuto.every(function (u) {
    const h = hostOf(u); return h === 'gitee.com' || h.indexOf('127.0.0.1') === 0;
  }),
  JSON.stringify(hostsOf(zhAuto)));
check('zh automatic content requests contain no github.com',
  !zhAuto.some(function (u) { return /github\.com/.test(u); }), JSON.stringify(zhAuto));
check('en automatic content requests contain no gitee.com',
  !enAuto.some(function (u) { return /gitee\.com/.test(u); }), JSON.stringify(enAuto));
check('zh pending-mirror notice is visible on the download page',
  /Gitee 镜像/.test(zh.downloadText) && /本地快照/.test(zh.downloadText),
  zh.downloadText.slice(0, 150));
check('zh pending-mirror notice is visible on the archive page',
  /Gitee 镜像/.test(zh.archiveText) && /本地快照/.test(zh.archiveText),
  zh.archiveText.slice(0, 150));
check('zh download manual exit is a github.com link',
  zh.downloadExits.length >= 1 && zh.downloadExits.every(function (u) { return hostOf(u) === 'github.com'; }),
  JSON.stringify(zh.downloadExits));
check('zh archive manual exit is a github.com link',
  zh.archiveExits.length >= 1 && zh.archiveExits.every(function (u) { return hostOf(u) === 'github.com'; }),
  JSON.stringify(zh.archiveExits));
check('zh manual exit is never fetched automatically',
  zh.downloadExits.concat(zh.archiveExits).every(function (x) { return !zhAuto.some(function (u) { return u === x; }); }),
  JSON.stringify(zh.downloadExits.concat(zh.archiveExits)));
check('zh live path (Gitee answered) shows no manual exit',
  (zhLive.liveExits || []).length === 0, JSON.stringify(zhLive.liveExits || []));
check('en shows no pending-mirror notice',
  !/Gitee 镜像|Gitee mirror/.test(en.downloadText + ' ' + en.archiveText), '');
check('en has no manual-exit link',
  (en.downloadExits || []).length === 0 && (en.archiveExits || []).length === 0,
  JSON.stringify((en.downloadExits || []).concat(en.archiveExits || [])));
check('zh without sources.js: release request stays local/gitee',
  (zhNoSources.downloadRequests || []).every(function (u) {
    const h = hostOf(u); return h.indexOf('127.0.0.1') === 0 || h === 'gitee.com';
  }),
  JSON.stringify(hostsOf(zhNoSources.downloadRequests || [])));
for (const page of ['web/infinity/cn/index.html', 'web/infinity/cn/docs/index.html',
  'web/infinity/cn/cloud/index.html']) {
  const text = fs.readFileSync(path.join(ROOT, page), 'utf8');
  check('cn page wires the pending-mirror notice: ' + page,
    text.indexOf('giteePendingNote') >= 0 && text.indexOf('github-exit') >= 0);
}

/* the live request itself must hit the language's own host */
check('zh live release requests all went to gitee.com',
  zhLive.liveRequests.length >= 1 &&
    zhLive.liveRequests.every(function (u) { return hostOf(u) === 'gitee.com'; }),
  JSON.stringify(zhLive.liveRequests));
check('en live release requests all went to api.github.com',
  enLive.liveRequests.length >= 1 &&
    enLive.liveRequests.every(function (u) { return hostOf(u) === 'api.github.com'; }),
  JSON.stringify(enLive.liveRequests));

/* the account conversation is the declared, printed exception */
check('zh account request stays on api.github.com (declared exception)',
  zh.accountRequests.length === 1 && hostOf(zh.accountRequests[0]) === 'api.github.com',
  JSON.stringify(zh.accountRequests));
check('en account request stays on api.github.com', en.accountRequests.length === 1 &&
  hostOf(en.accountRequests[0]) === 'api.github.com', JSON.stringify(en.accountRequests));

/* mirror() round trips */
const zhM = zh.mirror, enM = en.mirror;
check('zh mirror web', zhM.web === 'https://gitee.com/zssx2026/Infinity-Cloud/releases/tag/v1', zhM.web);
check('zh mirror api', zhM.api === 'https://gitee.com/api/v5/repos/zssx2026/Infinity-Cloud/releases', zhM.api);
check('zh mirror raw', zhM.raw === 'https://gitee.com/zssx2026/Infinity.inc/raw/main/cpp/README.md', zhM.raw);
check('zh mirror leaves account URLs alone',
  zhM.account === 'https://github.com/settings/tokens' && zhM.user === 'https://api.github.com/user',
  zhM.account + ' / ' + zhM.user);
check('zh mirror leaves gitee URLs alone', zhM.giteeWeb.indexOf('gitee.com/zssx2026') >= 0 &&
  zhM.giteeApi.indexOf('gitee.com/api/v5/repos/zssx2026') >= 0, zhM.giteeWeb);
check('en mirror web', enM.giteeWeb === 'https://github.com/zssx-2026/Infinity-Cloud/releases/tag/v1', enM.giteeWeb);
check('en mirror api', enM.giteeApi === 'https://api.github.com/repos/zssx-2026/Infinity-Cloud/releases', enM.giteeApi);
check('en mirror raw', enM.giteeRaw === 'https://raw.githubusercontent.com/zssx-2026/Infinity.inc/main/cpp/README.md', enM.giteeRaw);
check('zh rawUrl', zh.rawUrl === 'https://gitee.com/zssx2026/Infinity-Cloud/raw/main/cpp/README.md', zh.rawUrl);

/* summary of what was actually produced */
const zhHosts = {};
zhAll.concat(zhNoSources.downloadHrefs, zhNoSources.archiveHrefs).forEach(function (u) {
  if (isContentUrl(u)) { const k = contentHostKey(u); zhHosts[k] = (zhHosts[k] || 0) + 1; }
});
const enHosts = {};
enAll.forEach(function (u) { if (isContentUrl(u)) { const k = contentHostKey(u); enHosts[k] = (enHosts[k] || 0) + 1; } });

/* ---------------------------------------------------------------- report */
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.detail && !r.ok ? '  --> ' + r.detail : ''));
}
console.log('');
console.log('content URL hosts produced - zh: ' + JSON.stringify(zhHosts));
console.log('content URL hosts produced - en: ' + JSON.stringify(enHosts));
console.log('checks: ' + results.length + ', failed: ' + failed);
server.close();
process.exit(failed ? 1 : 0);
