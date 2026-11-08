/*
 * Infinity.Inc - the one place the site's language is decided.
 *
 * The site is served in English at / and in Chinese at /cn/.
 * Every page carries <html lang>, but the directory is the fact that cannot be
 * forgotten: a page copied from one language to the other keeps its path, and
 * the path is what decides here. A path with a /cn/ segment is Chinese; so is
 * a document that declares a lang beginning with "zh" (the two agree today,
 * and the second rule keeps a page that sets lang but is not yet mirrored
 * readable). Everything else is English.
 *
 * Nothing here touches the DOM and nothing here adds a <script> tag: every
 * asset script reads its language through this module when it happens to be
 * loaded and through the same rule in one line when it is not. That is why the
 * Chinese pages need no new markup and the English ones are untouched.
 *
 * t(key) never returns an empty string for an unknown key - it returns the key
 * itself, so a missing translation is visible in the page instead of silently
 * leaving a hole.
 */
(function () {
  'use strict';

  var I = window.INFINITY = window.INFINITY || {};

  /*
   * The little that is shared by more than one script: the chrome every page
   * draws and the errors the shared GitHub reader raises. site.js registers
   * its full table on top of this, so a page that loads site.js gets every
   * page string through t() as well.
   */
  var CORE = {
    en: {
      footerSuite: 'Infinity.Inc \u2014 the Infinity suite.',
      loadingDefault: 'Loading\u2026',
      signIn: 'Sign in', signUp: 'Sign up', account: 'Account', linkProduct: 'Link a product',
      docs: 'Documentation', settings: 'Settings',
      errTokenRejected: 'The token was rejected. Sign in again.',
      errGithubRefused: 'GitHub refused the request: ',
      errNotFound: 'Not found: '
    },
    zh: {
      footerSuite: 'Infinity.Inc \u2014\u2014 Infinity \u5957\u4ef6\u3002',
      loadingDefault: '\u6b63\u5728\u52a0\u8f7d\u2026',
      signIn: '\u767b\u5f55', signUp: '\u6ce8\u518c', account: '\u8d26\u6237', linkProduct: '\u5173\u8054\u4ea7\u54c1',
      docs: '\u6587\u6863', settings: '\u8bbe\u7f6e',
      errTokenRejected: '\u4ee4\u724c\u88ab\u62d2\u7edd\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55\u3002',
      errGithubRefused: '\u5185\u5bb9\u6e90\u62d2\u7edd\u4e86\u8be5\u8bf7\u6c42\uff1a',
      errNotFound: '\u672a\u627e\u5230\uff1a'
    }
  };

  var DICT = {
    en: Object.assign({}, CORE.en),
    zh: Object.assign({}, CORE.zh)
  };

  var override = null;

  /* /cn/... and anything with a /cn/ segment is Chinese. */
  function detect() {
    var path = '';
    try { path = String(location.pathname || ''); } catch (e) { path = ''; }
    if (/(^|\/)cn(\/|$)/.test(path)) return 'zh';
    var declared = '';
    try { declared = (document.documentElement && document.documentElement.lang) || ''; } catch (e) { declared = ''; }
    if (String(declared).toLowerCase().indexOf('zh') === 0) return 'zh';
    return 'en';
  }

  function lang() { return override || detect(); }
  function zh() { return lang() === 'zh'; }

  /* Merge a { en: {...}, zh: {...} } table into the shared dictionary. */
  function register(table) {
    if (!table) return DICT;
    if (table.en) Object.assign(DICT.en, table.en);
    if (table.zh) Object.assign(DICT.zh, table.zh);
    return DICT;
  }

  function t(key) {
    var current = lang();
    if (DICT[current] && key in DICT[current]) return DICT[current][key];
    if (key in DICT.en) return DICT.en[key];
    return key;
  }

  /* Pick between one English and one Chinese string without a key. */
  function pick(en, zhText) { return zh() ? zhText : en; }

  /* Used by tests and by the checker; null returns to detection. */
  function setLang(value) { override = (value === 'zh' || value === 'en') ? value : null; }

  I.i18n = {
    lang: lang, zh: zh, t: t, pick: pick, register: register,
    setLang: setLang, detect: detect, dict: DICT
  };
})();
