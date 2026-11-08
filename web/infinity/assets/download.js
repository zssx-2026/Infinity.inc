/*
 * Infinity.Inc - the version list on a product's own download page.
 *
 * One collapsed row per version, a platform switch above it, and files
 * grouped by what they are: the exe installer, the Windows msi, the portable
 * zip, the source zip and the source zst.
 *
 * Only releases from the last year are listed; everything older stays on each
 * repository's GitHub Releases page.
 *
 * Nothing is asked of the reader here: no digest to compare and no script to
 * run. A downloaded file unblocks itself when the application first starts.
 *
 * The list comes from assets/releases.json, written when the site is
 * published, so it needs no API quota, no proxy and no CORS; the live API is
 * the fallback for a release published after that file was built.
 */
(function () {
  'use strict';

  var I = window.INFINITY;
  var PLATFORM_KEY = 'inc.download.platform';
  var PRE_KEY = 'inc.download.pre';
  var SHOW_PRE = localStorage.getItem(PRE_KEY) !== '0';
  var YEAR_MS = 365 * 24 * 60 * 60 * 1000;

  var PLATFORM_SHORT = {
    win16: 'Win16', win32: 'Win32', win64: 'Win64', winx86: 'WinX86', winarm: 'WinARM',
    linux16: 'Linux16', linux32: 'Linux32', linux64: 'Linux64', linuxx86: 'LinuxX86',
    mac16: 'Mac16', mac32: 'Mac32', mac64: 'Mac64', macx86: 'MacX86'
  };
  var PLATFORM_ORDER = ['win64', 'win32', 'win16', 'winx86', 'winarm',
    'linux64', 'linux32', 'linux16', 'linuxx86', 'mac64', 'mac32', 'mac16', 'macx86'];
  var ALIAS = {
    'win-x86': 'winx86', 'win-x64': 'win64', x64: 'win64', x86: 'winx86',
    'win-arm64': 'winarm', 'win-arm': 'winarm', arm64: 'winarm', arm: 'winarm',
    'linux-x86': 'linuxx86', 'linux-x64': 'linux64',
    'mac-x86': 'macx86', 'mac-x64': 'mac64', osx64: 'mac64', darwin64: 'mac64',
    amd64: 'win64', i386: 'winx86', i686: 'winx86'
  };
  var TOKEN = '(win16|win32|win64|winx86|win-x86|win-x64|x64|x86|win-arm64|win-arm|winarm|arm64|arm|amd64|i386|i686|linux16|linux32|linux64|linuxx86|linux-x86|linux-x64|linux-arm64|mac16|mac32|mac64|macx86|mac-x86|mac-x64|osx64|darwin64)';

  var TEXT = {
    en: {
      platform: 'Platform', loading: 'Loading versions…', showPre: 'Show pre-releases',
      failed: 'The version list is unavailable right now.',
      noReleases: 'No release is published yet.', noAssets: 'No files for this platform in this version.',
      pre: 'pre-release', latest: 'latest', files: 'files', file: 'file', recent: 'Released in the last year',
      archive: 'Older releases are in the archive', archiveLink: 'Open the archive',
      kindSetup: 'Installer (exe)', kindMsi: 'Windows msi', kindPort: 'Portable (zip)',
      kindSrcZip: 'Source code (zip)', kindSrcZst: 'Source code (zst)', kindOther: 'Other files',
      snapshotNotice: 'Note: the Chinese site reads Gitee, but the Gitee mirror is not published yet; these versions come from the local snapshot built into this site and the download links may not work until the mirror exists. Manual exit (a hand click; this page never requests GitHub automatically):',
      githubExit: 'Open this product’s releases on GitHub',
    },
    zh: {
      platform: '平台', loading: '正在加载版本…', showPre: '显示预发布版本',
      failed: '暂时无法获取版本列表。',
      noReleases: '还没有发布任何版本。', noAssets: '该版本在此平台下没有文件。',
      pre: '预发布', latest: '最新', files: '个文件', file: '个文件', recent: '一年内发布的版本',
      archive: '更早的版本在归档里', archiveLink: '打开归档',
      kindSetup: 'exe 安装包', kindMsi: 'Windows msi', kindPort: '便携版 zip',
      kindSrcZip: '源代码 zip', kindSrcZst: '源代码 zst', kindOther: '其它文件',
      snapshotNotice: '注意：中文站的内容源为 Gitee，但 Gitee 镜像尚未就绪，以下版本来自本站内置的本地快照，下载链接在镜像就绪前可能不可用。人工出口（需手动点击，本站不会自动请求 GitHub）：',
      githubExit: '在 GitHub 上查看该产品的发布',
    }
  };

  var ORDER = ['setup', 'msi', 'port', 'srczip', 'srczst', 'other'];
  var KIND_LABEL = { setup: 'kindSetup', msi: 'kindMsi', port: 'kindPort', srczip: 'kindSrcZip', srczst: 'kindSrcZst', other: 'kindOther' };

  function lang() {
    if (window.INFINITY && window.INFINITY.i18n && window.INFINITY.i18n.lang) return window.INFINITY.i18n.lang();
    var path = '';
    try { path = String(location.pathname || ''); } catch (e) { path = ''; }
    if (/(^|\/)cn(\/|$)/.test(path)) return 'zh';
    var l = (document.documentElement.getAttribute('lang') || 'en').toLowerCase();
    return l.indexOf('zh') === 0 ? 'zh' : 'en';
  }
  function t(k) { return TEXT[lang()][k] || k; }
  function el(tag, attrs, kids) { return I.el(tag, attrs, kids); }
  /* The content source for this page: GitHub in English, Gitee in Chinese.
   * site.js always defines it; a null here only means the page loaded no
   * source at all, in which case the local snapshot is used as-is. */
  function src() { return (typeof I.source === 'function') ? I.source() : null; }
  /* The snapshot was written for GitHub, so every URL in it is resolved for
   * the reader's language before it reaches the page. */
  function loc(url, source) {
    if (!url || !source || source.key === 'github') return url;
    if (I.sources && typeof I.sources.mirror === 'function') return I.sources.mirror(url, source.lang);
    return url;
  }
  /* The Chinese site reads Gitee, and assets/releases.json is only the offline
   * fallback. When the snapshot is what the reader is looking at, say so and
   * offer the matching GitHub page as a hand-clicked exit - never as a request:
   * this file never fetches GitHub. */
  function pending(host, product) {
    if (lang() !== 'zh') return;
    var other = (I.sources && typeof I.sources.other === 'function') ? I.sources.other() : null;
    var note = el('p', { class: 'dl-state small faint' });
    note.appendChild(document.createTextNode(t('snapshotNotice')));
    if (other) {
      note.appendChild(el('a', {
        class: 'github-exit',
        href: other.repoWeb(product.repo) + '/releases',
        target: '_blank', rel: 'noopener', text: t('githubExit')
      }));
    }
    host.appendChild(note);
  }
  function localize(rels, source) {
    if (!source || source.key === 'github') return rels;
    return (rels || []).map(function (r) {
      var row = {};
      for (var a in r) row[a] = r[a];
      row.html_url = loc(r.html_url, source);
      row.assets = (r.assets || []).map(function (asset) {
        var copy = {};
        for (var b in asset) copy[b] = asset[b];
        copy.browser_download_url = loc(asset.browser_download_url, source);
        return copy;
      });
      return row;
    });
  }

  function bytes(n) {
    if (!n && n !== 0) return '';
    var u = ['B', 'KB', 'MB', 'GB'], i = 0;
    while (n >= 1024 && i < u.length - 1) { n = n / 1024; i++; }
    return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + ' ' + u[i];
  }
  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
  }
  function shortPlatform(code) { return PLATFORM_SHORT[code] || code; }
  function fold(token) {
    var k = String(token || '').toLowerCase();
    if (ALIAS[k]) return ALIAS[k];
    return PLATFORM_SHORT[k] ? k : null;
  }
  /* The last year only, counted from UTC now. */
  function isRecent(release) {
    var at = Date.parse(release.published_at || release.created_at || '');
    if (!at) return true;
    return (Date.now() - at) <= YEAR_MS;
  }
  function archiveHref() {
    if (I.page) return I.page('/versions/archive/');
    return String(I.BASE || '').replace(/\/assets.*$/, '') + '/versions/archive/';
  }

  function parseAsset(name) {
    if (/_hash\.txt$|\.hash(es)?$/i.test(name)) return null;
    var lower = name.toLowerCase();
    var base = name.replace(/\.(exe|msi|zip|7z|zst|tar\.gz|tar\.xz|dmg|deb|appimage)$/i, '');
    var versioned = new RegExp('^(.+?)_([0-9][^_]*)_' + TOKEN + '_([a-z0-9-]+)$', 'i').exec(base);
    var legacy = versioned ? null : new RegExp('^(.+?)_' + TOKEN + '(?:_([a-z0-9-]+))?$', 'i').exec(base);
    var m = versioned || legacy;
    if (!m) return null;
    var platform = fold(versioned ? m[3] : m[2]);
    if (!platform) return null;
    return {
      name: name, version: versioned ? m[2] : '', platform: platform,
      ext: (/\.([a-z0-9]+)$/i.exec(lower) || [, ''])[1],
      isSource: /(^|[_-])(source|sourcecode|src)([_-]|$)/.test(lower)
    };
  }

  /* The five categories the download page offers. */
  function categoryOf(parsed) {
    if (!parsed) return 'other';
    var ext = parsed.ext;
    if (ext === 'zst') return 'srczst';
    if (parsed.isSource) return ext === 'zip' ? 'srczip' : 'src' + ext;
    if (ext === 'exe') return 'setup';
    if (ext === 'msi') return 'msi';
    if (ext === 'zip') return 'port';
    return 'other';
  }

  function render(host, product) {
    var box = el('section', { class: 'dl' });
    host.appendChild(box);
    box.appendChild(el('p', { class: 'dl-state', text: t('loading') }));
    var source = src();

    fetch(I.BASE + '/assets/releases.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('static HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        var rels = data && data.repos && data.repos[product.repo];
        if (rels && rels.length) return { rels: localize(rels, source), snapshot: true };
        throw new Error('no static data for ' + product.repo);
      })
      .catch(function () {
        /* The live list is read from the reader's own source: Gitee on a
         * Chinese page, GitHub on an English one. */
        if (!source) throw new Error('no source');
        return fetch(source.releasesApi(product.repo), { headers: { Accept: 'application/json' } })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (list) {
            var rels = (I.sources && typeof I.sources.normalizeReleases === 'function')
              ? I.sources.normalizeReleases(list, product.repo, source.lang)
              : list;
            return { rels: localize(rels, source), snapshot: false };
          });
      })
      .then(function (out) {
        paint(box, product, out.rels);
        if (out.snapshot) pending(box, product);
      })
      .catch(function () {
        I.clear(box);
        box.appendChild(el('p', { class: 'dl-state', text: t('failed') }));
        var grid = el('div', { class: 'grid' });
        grid.appendChild(I.productCard(product));
        box.appendChild(grid);
      });
  }

  function platformsIn(releases) {
    var present = [];
    releases.forEach(function (r) {
      (r.assets || []).forEach(function (a) {
        var p = parseAsset(a.name);
        if (p && present.indexOf(p.platform) < 0) present.push(p.platform);
      });
    });
    present.sort(function (a, b) { return PLATFORM_ORDER.indexOf(a) - PLATFORM_ORDER.indexOf(b); });
    return present;
  }

  function paint(box, product, releases) {
    I.clear(box);
    if (!releases || !releases.length) {
      box.appendChild(el('p', { class: 'dl-state', text: t('noReleases') }));
      return;
    }
    var recent = releases.filter(isRecent);
    var older = releases.filter(function (r) { return !isRecent(r); });
    if (!recent.length && releases.length) { recent = releases.slice(); older = []; }

    var present = platformsIn(recent);
    if (!present.length) present = platformsIn(releases);

    var chosen = localStorage.getItem(PLATFORM_KEY);
    if (!chosen || present.indexOf(chosen) < 0) chosen = present[0] || 'win64';

    var bar = el('div', { class: 'dl-bar' });
    var seg = el('div', { class: 'dl-seg', role: 'tablist', 'aria-label': t('platform') });
    present.forEach(function (p) {
      var b = el('button', { type: 'button', class: 'dl-seg-btn' + (p === chosen ? ' is-on' : ''), title: p, text: shortPlatform(p) });
      b.addEventListener('click', function () {
        localStorage.setItem(PLATFORM_KEY, p);
        chosen = p;
        Array.prototype.forEach.call(seg.children, function (c) { c.classList.toggle('is-on', c === b); });
        paintVersions(list, recent, chosen);
      });
      seg.appendChild(b);
    });
    bar.appendChild(seg);

    var preWrap = el('label', { class: 'dl-pre' });
    var pre = el('input', { type: 'checkbox' });
    pre.checked = SHOW_PRE;
    pre.addEventListener('change', function () {
      SHOW_PRE = pre.checked;
      localStorage.setItem(PRE_KEY, SHOW_PRE ? '1' : '0');
      paintVersions(list, recent, chosen);
    });
    preWrap.appendChild(pre);
    preWrap.appendChild(el('span', { text: t('showPre') }));
    bar.appendChild(preWrap);
    box.appendChild(bar);

    var list = el('div', { class: 'dl-list' });
    box.appendChild(list);
    paintVersions(list, recent, chosen);

    if (older.length) {
      var note = el('div', { class: 'dl-archive' });
      note.appendChild(el('span', { text: t('archive') + ' (' + older.length + ')' }));
      note.appendChild(el('a', { href: archiveHref(), text: t('archiveLink') + ' \u2192' }));
      box.appendChild(note);
    }
  }

  function paintVersions(host, releases, platform) {
    I.clear(host);
    var shown = releases.filter(function (r) { return SHOW_PRE || !r.prerelease; });
    if (!shown.length) shown = releases.slice(0, 1);

    shown.forEach(function (r, idx) {
      var assets = (r.assets || []).map(function (a) {
        var p = parseAsset(a.name);
        return p && p.platform === platform ? { raw: a, p: p, kind: categoryOf(p) } : null;
      }).filter(Boolean);

      var byKind = {};
      assets.forEach(function (x) { (byKind[x.kind] = byKind[x.kind] || []).push(x); });
      var total = assets.reduce(function (n, x) { return n + (x.raw.size || 0); }, 0);

      var d = el('details', { class: 'dl-ver' });
      if (assets.length && /(^|[?&])expand=1(&|$)/.test(location.search)) d.setAttribute('open', '');
      var sum = el('summary', { class: 'dl-sum' });
      sum.appendChild(el('span', { class: 'dl-ver-tag', text: r.tag_name || r.name }));
      if (r.prerelease) sum.appendChild(el('span', { class: 'pill dl-pill-pre', text: t('pre') }));
      if (idx === 0) sum.appendChild(el('span', { class: 'pill dl-pill-latest', text: t('latest') }));
      sum.appendChild(el('span', { class: 'dl-date', text: when(r.published_at) }));
      sum.appendChild(el('span', { class: 'dl-meta', text: assets.length + ' ' + (assets.length === 1 ? t('file') : t('files')) + ' \u00b7 ' + bytes(total) + ' \u00b7 ' + shortPlatform(platform) }));
      d.appendChild(sum);

      var body = el('div', { class: 'dl-body' });
      if (!assets.length) {
        body.appendChild(el('p', { class: 'dl-state', text: t('noAssets') }));
      } else {
        ORDER.forEach(function (kind) { if (byKind[kind]) body.appendChild(kindBlock(kind, byKind[kind])); });
        Object.keys(byKind).forEach(function (kind) {
          if (ORDER.indexOf(kind) < 0) body.appendChild(kindBlock(kind, byKind[kind]));
        });
      }
      d.appendChild(body);
      host.appendChild(d);
    });
  }

  function kindBlock(kind, items) {
    var sec = el('section', { class: 'dl-kind' });
    sec.appendChild(el('h4', { class: 'dl-kind-name', text: t(KIND_LABEL[kind] || 'kindOther') }));
    var ul = el('ul', { class: 'dl-files' });
    items.forEach(function (x) {
      var li = el('li', { class: 'dl-file' });
      var link = el('a', { class: 'dl-file-name', href: x.raw.browser_download_url, text: x.raw.name });
      var gateAsset = gateAssetFor(x.raw.browser_download_url, x.kind);
      if (gateAsset) link.addEventListener('click', function (ev) { gateDownload(ev, link, gateAsset); });
      li.appendChild(link);
      li.appendChild(el('span', { class: 'dl-file-size', text: bytes(x.raw.size) }));
      li.appendChild(el('span', { class: 'dl-file-date', text: when(x.raw.created_at) }));
      ul.appendChild(li);
    });
    sec.appendChild(ul);
    return sec;
  }

  /* ---- real human-verification gate (worker-signed PoW) ----
   * Setup installers start from the auth worker: the page solves a
   * server-signed challenge, swaps it for a short-lived pass and the
   * download redirects through /api/dl. The gate slows scripted hits
   * down; it must never stop a reader, so any worker hiccup falls back
   * to the plain link. Only GitHub setup links are gated; mirrors and
   * msi/zip/source files download directly.
   */
  var GATE_WORKER = 'https://infinity-account-auth-worker.zssx2026.workers.dev';
  var GATE_SCOPE = 'download';
  var GATE_ASSETS = {
    'Infinity-Cloud': 'InfinityCloud-setup',
    'InfinityPackageManager': 'InfinityPackageManager-setup'
  };
  var GATE_KEY = 'inc.gate.pass';

  function gateAssetFor(url, kind) {
    if (kind !== 'setup') return null;
    var m = /github\.com\/zssx-2026\/([^/]+)\/releases\/download/.exec(String(url || ''));
    return (m && GATE_ASSETS[m[1]]) || null;
  }

  function gateHex(buf) {
    var out = '', b = new Uint8Array(buf), i;
    for (i = 0; i < b.length; i += 1) out += ('0' + b[i].toString(16)).slice(-2);
    return out;
  }

  function gateSha256Hex(s) {
    return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(gateHex);
  }

  /* Same convention as the worker: sha256(prefix + nonce) must land below
   * 2^(32 - bits) when read as the first 32 bits. */
  function gateSolve(ch) {
    var target = Math.pow(2, 32 - ch.bits);
    function attempt(nonce) {
      return gateSha256Hex(ch.prefix + nonce).then(function (hex) {
        if ((parseInt(hex.slice(0, 8), 16) >>> 0) < target) return nonce;
        return attempt(nonce + 1);
      });
    }
    return attempt(0);
  }

  function gatePassCached() {
    try {
      var v = JSON.parse(sessionStorage.getItem(GATE_KEY) || 'null');
      if (v && v.pass && v.expires && Date.now() + 60000 < v.expires) return v.pass;
      sessionStorage.removeItem(GATE_KEY);
    } catch (e) { /* private mode: just fetch a new pass */ }
    return null;
  }

  function gateFetchPass() {
    var cached = gatePassCached();
    if (cached) return Promise.resolve(cached);
    return fetch(GATE_WORKER + '/api/gate?scope=' + GATE_SCOPE).then(function (r) {
      if (!r.ok) throw new Error('gate challenge HTTP ' + r.status);
      return r.json();
    }).then(function (ch) {
      return gateSolve(ch).then(function (nonce) {
        return fetch(GATE_WORKER + '/api/gate/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: GATE_SCOPE, proof: {
            prefix: ch.prefix, bits: ch.bits, nonce: nonce, expires: ch.expires, sig: ch.sig
          } })
        });
      });
    }).then(function (r) {
      if (!r.ok) throw new Error('gate verify HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      if (!j || !j.pass) throw new Error('gate pass missing');
      try { sessionStorage.setItem(GATE_KEY, JSON.stringify({ pass: j.pass, expires: j.expires || 0 })); } catch (e) { /* ignore */ }
      return j.pass;
    });
  }

  function gateDownload(ev, link, asset) {
    ev.preventDefault();
    if (link.getAttribute('data-gate-busy')) return;
    link.setAttribute('data-gate-busy', '1');
    var href = link.getAttribute('href');
    var done = function () { link.removeAttribute('data-gate-busy'); };
    gateFetchPass().then(function (pass) {
      window.location.href = GATE_WORKER + '/api/dl?scope=' + GATE_SCOPE +
        '&asset=' + encodeURIComponent(asset) + '&pass=' + encodeURIComponent(pass);
      done();
    }).catch(function () {
      window.location.href = href; /* worker unreachable: download directly */
      done();
    });
  }

  window.INFINITY = window.INFINITY || {};
  window.INFINITY.download = {
    render: render, parseAsset: parseAsset, categoryOf: categoryOf,
    shortPlatform: shortPlatform, fold: fold, isRecent: isRecent,
    platformsIn: platformsIn, archiveHref: archiveHref
  };
})();
