/*
 * Infinity.Inc - where a page's content comes from.
 *
 * The site is served from GitHub Pages, which says nothing about where the
 * content a page shows lives. The rule is the reader's language: an English
 * page reads GitHub, a Chinese page reads Gitee. The language itself is the
 * same rule the rest of the site uses - a path with a /cn/ segment is Chinese,
 * then <html lang>, then assets/i18n.js when it happens to be loaded.
 *
 * This is the one place that decides the four facts every content request
 * needs, so no other script writes a host name down:
 *
 *   api    the REST base for one repository, owner included
 *   web    the owner's page, which release and tag links hang off
 *   raw    the raw-file base (Gitee needs the repository in the path)
 *   owner  the account name on that host
 *
 * Helpers build the URLs the download, archive, docs and cloud pages use, and
 * mirror() rewrites a URL written for the other source into this one, so a
 * link that came out of the local snapshot or out of an API response is still
 * resolved for the reader's language rather than for the host it was written
 * on.
 *
 * Account and token flows are deliberately NOT routed here: the suite's data
 * lives in GitHub releases and a GitHub personal access token is the only
 * credential those endpoints accept, so sign-in and account calls stay on
 * api.github.com in both languages. That exception is stated in the pages
 * themselves, not hidden.
 */
(function () {
  'use strict';

  var I = window.INFINITY = window.INFINITY || {};

  var OWNER = { github: 'zssx-2026', gitee: 'zssx2026' };

  var GITHUB = {
    key: 'github', label: 'GitHub', owner: OWNER.github, lang: 'en',
    api: 'https://api.github.com/repos/zssx-2026/',
    apiRoot: 'https://api.github.com',
    web: 'https://github.com/zssx-2026',
    webRoot: 'https://github.com',
    raw: 'https://raw.githubusercontent.com/zssx-2026/',
    rawRoot: 'https://raw.githubusercontent.com',
    ref: 'main'
  };

  var GITEE = {
    key: 'gitee', label: 'Gitee', owner: OWNER.gitee, lang: 'zh',
    api: 'https://gitee.com/api/v5/repos/zssx2026/',
    apiRoot: 'https://gitee.com/api/v5',
    web: 'https://gitee.com/zssx2026',
    webRoot: 'https://gitee.com',
    /* Gitee needs the repository in the raw path, so the base carries <repo>. */
    raw: 'https://gitee.com/zssx2026/<repo>/raw/master/',
    rawRoot: 'https://gitee.com',
    /* The Gitee mirrors were created by a mirror push from repositories whose
     * default branch was master, so their default branch is master even where
     * the GitHub original is main. A raw URL with the wrong ref is a 404 that
     * looks like a missing file. */
    ref: 'master'
  };

  /* The same language rule as i18n.js and every asset script. */
  function detectLang() {
    if (I.i18n && typeof I.i18n.lang === 'function') return I.i18n.lang();
    var path = '';
    try { path = String(location.pathname || ''); } catch (e) { path = ''; }
    if (/(^|\/)cn(\/|$)/.test(path)) return 'zh';
    var declared = '';
    try { declared = (document.documentElement && document.documentElement.lang) || ''; } catch (e) { declared = ''; }
    if (String(declared).toLowerCase().indexOf('zh') === 0) return 'zh';
    return 'en';
  }

  function base(lang) {
    if (lang === 'zh' || lang === 'gitee') return GITEE;
    if (lang === 'en' || lang === 'github') return GITHUB;
    return detectLang() === 'zh' ? GITEE : GITHUB;
  }

  /* Build the per-language view: the four facts plus the URL builders. */
  function view(lang) {
    var b = base(lang);
    return {
      key: b.key,
      label: b.label,
      lang: b.lang,
      api: b.api,
      web: b.web,
      raw: b.raw,
      owner: b.owner,
      apiRoot: b.apiRoot,
      webRoot: b.webRoot,

      repoWeb: function (repo) { return b.web + '/' + repo; },
      repoApi: function (repo) { return b.api + repo; },
      releasesApi: function (repo, perPage) {
        return b.api + repo + '/releases?per_page=' + (perPage || 30);
      },
      releaseApi: function (repo, id) { return b.api + repo + '/releases/' + id; },
      releasePage: function (repo, tag) { return b.web + '/' + repo + '/releases/tag/' + tag; },
      assetUrl: function (repo, tag, name) {
        return b.web + '/' + repo + '/releases/download/' + tag + '/' + name;
      },
      contentsApi: function (repo, path, ref) {
        return b.api + repo + '/contents/' + String(path).replace(/^\/+/, '') +
          '?ref=' + (ref || b.ref);
      },
      rawUrl: function (repo, path, ref) {
        ref = ref || b.ref;
        if (b.key === 'gitee') {
          return 'https://gitee.com/' + b.owner + '/' + repo + '/raw/' + ref + '/' +
            String(path).replace(/^\/+/, '');
        }
        return b.rawRoot + '/' + b.owner + '/' + repo + '/' + ref + '/' +
          String(path).replace(/^\/+/, '');
      },

      /* True when a URL already points at this source. */
      owns: function (url) {
        url = String(url || '');
        return url.indexOf(b.web + '/') === 0 ||
          url.indexOf(b.web) === 0 && url.length === b.web.length ||
          url.indexOf(b.apiRoot + '/repos/' + b.owner + '/') === 0;
      }
    };
  }

  function hostOf(url) {
    var m = /^https?:\/\/([^\/]+)/i.exec(String(url || ''));
    return m ? m[1].toLowerCase() : '';
  }

  /*
   * Rewrite a URL that names one source so it names the other. Only URLs
   * scoped to the project's own account are touched: github.com/settings/...,
   * an avatar host or any third-party link is left exactly as it was written.
   */
  function mirror(url, lang) {
    if (!url) return url;
    var target = view(lang);
    var sources = [GITHUB, GITEE];
    for (var i = 0; i < sources.length; i++) {
      var b = sources[i];
      if (b.key === target.key) continue;
      var s = String(url);

      /* Raw files: the two hosts lay the path out differently. */
      var rawPrefix = b.rawRoot + '/' + b.owner + '/';
      if (s.indexOf(rawPrefix) === 0 && (b.key === 'github' || s.indexOf('/raw/' + b.ref + '/') > 0)) {
        if (b.key === 'github') {
          var rest = s.slice(rawPrefix.length).split('/');
          var repo = rest.shift();
          var ref = rest.shift() || b.ref;
          return target.rawUrl(repo, rest.join('/'), ref);
        }
        var mRaw = new RegExp('^' + b.web.replace(/[.]/g, '\\.') + '/([^/]+)/raw/([^/]+)/(.*)$').exec(s);
        if (mRaw) return target.rawUrl(mRaw[1], mRaw[3], mRaw[2]);
      }

      /* REST base: https://api.github.com/repos/<owner> or gitee's equivalent. */
      var apiPrefix = b.apiRoot + '/repos/' + b.owner;
      if (s.indexOf(apiPrefix) === 0) {
        return target.apiRoot + '/repos/' + target.owner + s.slice(apiPrefix.length);
      }

      /* The owner's page: release, tag and repository links. */
      if (s.indexOf(b.web) === 0 &&
          (s.length === b.web.length || s.charAt(b.web.length) === '/')) {
        return target.web + s.slice(b.web.length);
      }
    }
    return url;
  }

  /*
   * Gitee and GitHub describe a release a little differently. The pages were
   * written against GitHub's shape, so a Gitee response is folded into it here
   * rather than taught to every reader: created_at stands in for the missing
   * published_at, and an asset's download URL is taken from whichever field
   * the host used, or rebuilt from the repository, tag and file name.
   */
  function normalizeReleases(list, repo, lang) {
    var v = view(lang);
    if (!Array.isArray(list)) return [];
    return list.map(function (r) {
      if (!r) return r;
      var tag = r.tag_name || r.tag || '';
      var rawAssets = r.assets || r.attach_files || [];
      var assets = (Array.isArray(rawAssets) ? rawAssets : []).map(function (a) {
        return {
          name: a.name || a.file_name || '',
          size: (a.size || a.size_bytes || 0),
          created_at: a.created_at || a.updated_at || r.published_at || r.created_at,
          browser_download_url: a.browser_download_url || a.download_url || a.url ||
            (tag && a.name ? v.assetUrl(repo, tag, a.name) : ''),
          digest: a.digest || (a.sha256 ? 'sha256:' + a.sha256 : null)
        };
      }).filter(function (a) { return a.name; });
      return {
        tag_name: tag,
        name: r.name || tag,
        prerelease: !!r.prerelease,
        draft: !!r.draft,
        published_at: r.published_at || r.created_at || r.updated_at || '',
        created_at: r.created_at || r.published_at || '',
        html_url: remoteWeb(r.html_url || r.url || '', v) || v.releasePage(repo, tag),
        body: r.body || r.description || '',
        assets: assets
      };
    });
  }

  /* Keep a host-supplied link, but resolve it for the reader's language. */
  function remoteWeb(url, v) {
    if (!url) return '';
    var migrated = mirror(url, v.lang);
    return migrated;
  }

  function source(lang) { return view(lang); }

  I.source = source;
  I.sources = {
    github: view('en'),
    gitee: view('zh'),
    source: source,
    /* The opposite source: used only for a hand-clicked "manual exit" link,
     * never for an automatic request. */
    other: function (lang) {
      var b = base(lang);
      return view(b.key === 'github' ? 'zh' : 'en');
    },
    detectLang: detectLang,
    mirror: mirror,
    normalizeReleases: normalizeReleases,
    hostOf: hostOf,
    OWNER: OWNER
  };
})();
