/*
 * Infinity.Inc - the version archive.
 *
 * Every release of every product, grouped by platform only. The download
 * pages carry the last year; this page carries the rest, and each platform
 * gets one .zst holding that release's files for that platform, so an old
 * version stays reachable without turning the download page into a list that
 * grows for ever.
 *
 * A release that has no .zst yet says so and offers its files directly: a
 * missing bundle must never look like a missing version.
 */
(function () {
  'use strict';
  var I = window.INFINITY;
  var D = null;

  var TEXT = {
    en: {
      loading: 'Loading the archive…', failed: 'The archive is unavailable right now.',
      all: 'All products', product: 'Product', version: 'Version', published: 'Published',
      platform: 'Platform', files: 'Files', bundle: 'Archive (.zst)', noBundle: 'the .zst for this platform is not built yet',
      sizes: 'Total', open: 'Release page', recentNote: 'Releases from the last year are on the download page.',
      count: 'releases',
      snapshotNotice: 'Note: the Chinese site reads Gitee, but the Gitee mirror is not published yet; this archive comes from the local snapshot built into this site and the links may not work until the mirror exists. Manual exit (a hand click; this page never requests GitHub automatically):',
      githubExit: 'Open the matching repository on GitHub'
    },
    zh: {
      loading: '正在加载归档…', failed: '暂时无法获取归档。',
      all: '全部产品', product: '产品', version: '版本', published: '发布时间',
      platform: '平台', files: '文件', bundle: '归档（.zst）', noBundle: '该平台的 .zst 归档包尚未生成',
      sizes: '合计', open: 'Release 页', recentNote: '一年内的版本在下载页。',
      count: '个版本',
      snapshotNotice: '注意：中文站的内容源为 Gitee，但 Gitee 镜像尚未就绪，以下归档来自本站内置的本地快照，链接在镜像就绪前可能不可用。人工出口（需手动点击，本站不会自动请求 GitHub）：',
      githubExit: '在 GitHub 上打开对应仓库'
    }
  };
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
  /* The archive reads the local snapshot, whose URLs were written for GitHub.
   * Every link is resolved for this page's language here: GitHub in English,
   * Gitee in Chinese. */
  function M(url) {
    if (window.INFINITY && window.INFINITY.sources &&
        typeof window.INFINITY.sources.mirror === 'function') {
      return window.INFINITY.sources.mirror(url, lang());
    }
    return url;
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

  /* See download.js: the archive reads the local snapshot, so on a Chinese
   * page whose Gitee mirror is not published yet, say so and offer the GitHub
   * page as a hand-clicked exit. No request is made to GitHub. */
  function pending(host) {
    if (lang() !== 'zh') return;
    var other = (I.sources && typeof I.sources.other === 'function') ? I.sources.other() : null;
    var note = el('p', { class: 'small faint' });
    note.appendChild(document.createTextNode(t('snapshotNotice')));
    if (other) {
      note.appendChild(el('a', {
        class: 'github-exit',
        href: other.web, target: '_blank', rel: 'noopener', text: t('githubExit')
      }));
    }
    host.appendChild(note);
  }

  function render(host) {
    var box = el('div', { class: 'arc' });
    host.appendChild(box);
    box.appendChild(el('p', { class: 'dl-state', text: t('loading') }));

    D = I.download;
    fetch(I.BASE + '/assets/releases.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        I.clear(box);
        pending(box);
        var products = (I.PRODUCTS || []).filter(function (p) { return data.repos[p.repo]; });
        if (!products.length) { box.appendChild(el('p', { class: 'dl-state', text: t('failed') })); return; }
        products.forEach(function (p) {
          box.appendChild(productSection(p, data.repos[p.repo], (data.bundles && data.bundles[p.repo]) || []));
        });
      })
      .catch(function () {
        I.clear(box);
        box.appendChild(el('p', { class: 'dl-state', text: t('failed') }));
      });
  }

  function productSection(product, releases, bundles) {
    var sec = el('section', { class: 'arc-product' });
    var h = el('h2', { class: 'arc-title' });
    h.appendChild(document.createTextNode(product.name + '  '));
    h.appendChild(el('span', { class: 'faint small', text: releases.length + ' ' + t('count') }));
    sec.appendChild(h);
    sec.appendChild(el('p', { class: 'faint small', text: t('recentNote') }));

    /* platform -> [{release, assets}] - the archive is grouped by platform and
     * by nothing else. */
    var byPlatform = {};
    releases.forEach(function (r) {
      (r.assets || []).forEach(function (a) {
        var parsed = D.parseAsset(a.name);
        if (!parsed) return;
        (byPlatform[parsed.platform] = byPlatform[parsed.platform] || [])
          .push({ release: r, asset: a, parsed: parsed });
      });
    });

    var platforms = Object.keys(byPlatform).sort(function (x, y) {
      return (D.platformsIn([{ assets: [{ name: 'x_' + x }] }]) , 0) || 0;
    });

    platforms.forEach(function (platformCode) {
      var rows = byPlatform[platformCode];
      var d = el('details', { class: 'arc-platform' });
      if (rows.length) d.setAttribute('open', '');
      var total = rows.reduce(function (n, r) { return n + (r.asset.size || 0); }, 0);
      var sum = el('summary', { class: 'dl-sum' });
      sum.appendChild(el('span', { class: 'dl-ver-tag', text: D.shortPlatform(platformCode) }));
      sum.appendChild(el('span', { class: 'dl-meta', text: rows.length + ' ' + t('files') + ' \u00b7 ' + bytes(total) }));
      d.appendChild(sum);
      var body = el('div', { class: 'dl-body' });

      var byRelease = {};
      var order = [];
      rows.forEach(function (r) {
        var key = r.release.tag_name;
        if (!byRelease[key]) { byRelease[key] = { release: r.release, files: [] }; order.push(key); }
        byRelease[key].files.push(r);
      });

      order.forEach(function (key) {
        var group = byRelease[key];
        /* A .zst built for this release and platform wins over one that a
         * release happens to carry; both are shown when both exist. */
        var published = (bundles || []).filter(function (b) {
          return String(b.tag) === String(key) && b.platform === platformCode;
        });
        var bundle = published.concat(group.files.filter(function (f) { return f.parsed.ext === 'zst'; }));
        var line = el('div', { class: 'arc-row' });
        line.appendChild(el('span', { class: 'dl-ver-tag', text: key }));
        line.appendChild(el('span', { class: 'dl-date', text: when(group.release.published_at) }));
        if (bundle.length) {
          bundle.forEach(function (f) {
            var url = M(f.asset ? f.asset.browser_download_url : f.url);
            var size = f.asset ? f.asset.size : f.size;
            var label = t('bundle') + ' \u00b7 ' + bytes(size);
            if (f.sha256) label += ' \u00b7 sha256:' + String(f.sha256).slice(0, 10) + '\u2026';
            line.appendChild(el('a', { class: 'arc-bundle', href: url, text: label }));
          });
        } else {
          var bits = group.files.filter(function (f) { return f.parsed.ext !== 'zst'; });
          line.appendChild(el('span', { class: 'faint small', text: t('noBundle') }));
          bits.forEach(function (f) {
            line.appendChild(el('a', { class: 'arc-file', href: M(f.asset.browser_download_url), text: f.asset.name + ' (' + bytes(f.asset.size) + ')' }));
          });
        }
        line.appendChild(el('a', { class: 'dl-openrel', href: M(group.release.html_url), text: t('open') }));
        body.appendChild(line);
      });

      d.appendChild(body);
      sec.appendChild(d);
    });
    return sec;
  }

  window.INFINITY = window.INFINITY || {};
  window.INFINITY.archive = { render: render };
})();
