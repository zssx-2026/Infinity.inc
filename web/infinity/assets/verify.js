/*
 * Infinity.Inc - the gate in front of the suite's entry pages.
 *
 * What a visitor sees: a loading state, then the page. There is no checkbox,
 * no puzzle and no button - the proof-of-work runs silently in a worker and
 * the result is never shown, because a challenge a visitor can watch is a
 * challenge a visitor can be asked to solve.
 *
 * What actually happens:
 *
 *   1. The worker measures this machine (about 300 ms of hashing) and the page
 *      picks a target so that the expected search is about BUDGET_MS. A fast
 *      machine is asked for more work, not the same work in less time; a slow
 *      machine is asked for less, instead of being lowered to nothing while it
 *      waits. There is no step-down timer any more - that timer was the reason
 *      the gate used to cost a few milliseconds and pass everyone.
 *   2. The worker searches for a nonce whose SHA-256 starts below the target.
 *   3. On success the page stores the proof - prefix, nonce and target - not a
 *      flag. Next visit re-hashes that triple in the worker before it is
 *      believed, so writing {"v":2} into localStorage by hand gets a visitor
 *      exactly one thing: the gate, run again.
 *
 * This is a static site with no server, so it cannot authenticate anybody:
 * the honest claim is that entry costs a few seconds of CPU that a script
 * cannot skip without doing the same work, and that a stored pass is checked
 * rather than trusted. It is a speed bump with teeth, not a login.
 *
 * Failure is quiet: if the worker cannot start or dies, the document is
 * replaced by the site's 404 - a title and one sentence, no diagnostics. If
 * the search simply has not finished by MAX_MS, the page is shown without a
 * stored pass, so the next visit pays again; a slow machine is not punished
 * with an error page.
 *
 * ?verify=reset          forgets a remembered pass and runs the gate again.
 * ?verify=difficulty=N   (N >= 1) asks for a target of 2^(32-N); N=64 cannot
 *                        be met and is how the timeout path is reproduced.
 *                        It can only make the gate harder, never easier.
 */
(function () {
  'use strict';

  var KEY = 'infinity.verify';
  var VERSION = 2;

  var MIN_MS = 3000;    // content is never shown before this
  var MAX_MS = 6000;    // after this the page is shown anyway, with no pass
  var SHORT_MS = 700;   // returning visitors get the same look, briefly
  var BENCH_MS = 300;   // how long the machine gets to prove its speed
  var BUDGET_MS = 1200; // expected search time we aim for on this machine
  var BUDGET_MIN_MS = 500;   // never set a target that finishes faster than this
  var BUDGET_MAX_MS = 4000;  // never set one that cannot finish before MAX_MS

  var html = document.documentElement;
  var zh = (window.INFINITY && window.INFINITY.i18n && window.INFINITY.i18n.zh)
    ? window.INFINITY.i18n.zh()
    : (/(^|\/)cn(\/|$)/.test(String(location.pathname || '')) ||
       String(html.getAttribute('lang') || '').toLowerCase().indexOf('zh') === 0);
  var T = zh
    ? { loading: '正在加载…', title: '响应时间过长', line: '该网页暂时无法访问，请稍后重试。' }
    : { loading: 'Loading…', title: 'This page took too long to respond', line: 'The page is temporarily unavailable. Please try again later.' };

  function now() {
    return (window.performance && window.performance.now) ? window.performance.now() : Date.now();
  }

  var state = {
    mode: 'gate', startedAt: Date.now(), revealedAt: null, elapsedMs: null,
    result: 'pending', reason: '', solvedAt: null, target: 0, rate: 0, hashes: 0
  };
  window.__INFINITY_GATE = state;

  // ---------------------------------------------------------------- params
  var qs = null;
  try { qs = new URLSearchParams(location.search); } catch (e) { qs = null; }
  var param = qs ? qs.get('verify') : null;
  var wanted = qs ? qs.get('difficulty') : null;

  if (param === 'reset') {
    try { localStorage.removeItem(KEY); } catch (e) { /* private mode */ }
  }

  /*
   * A stored pass is a proof, not a flag. It is only believed when it has the
   * shape this version writes AND the worker recomputes the hash and the hash
   * still meets the target. A hand-written {"v":2} fails the shape check; a
   * copied proof from another prefix fails the hash check.
   */
  var stored = null;
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) {
      var cred = JSON.parse(raw);
      if (cred && cred.v === VERSION && typeof cred.prefix === 'string' && cred.prefix &&
          typeof cred.nonce === 'number' && cred.nonce >= 0 &&
          typeof cred.target === 'number' && cred.target > 0) {
        stored = cred;
      }
    }
  } catch (e) { stored = null; }

  /*
   * A reader moving between pages of this site keeps the page they asked for:
   * the loading bar runs across the top and the UI underneath stays visible.
   * Only a first arrival - a direct link, a bookmark, another site - gets the
   * blank page, because there is no UI of its own to keep yet.
   */
  var internal = false;
  try {
    var ref = document.referrer || '';
    if (ref && ref.indexOf(location.origin) === 0) internal = true;
    if (sessionStorage.getItem('infinity.visited') === '1') internal = true;
  } catch (e) { internal = false; }
  state.internal = internal;

  // ---------------------------------------------------------------- overlay
  var started = now();

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  }

  html.className = (html.className ? html.className + ' ' : '') + (internal ? 'infinity-nav' : 'infinity-gate');

  /*
   * One element only: the bar. The page behind it stays blank, because a
   * loading screen with content on it is a screen that has already loaded.
   */
  var overlay = el('div');
  overlay.id = 'infinity-gate';
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  var bar = el('div', 'bar');
  overlay.appendChild(bar);
  try { overlay.style.setProperty('--ig-ms', ((internal) ? SHORT_MS : MIN_MS) + 'ms'); } catch (e) { /* older engines */ }
  html.appendChild(overlay);

  function clearGateClass() {
    html.className = html.className.split(/\s+/).filter(function (c) {
      return c && c !== 'infinity-gate' && c !== 'infinity-nav';
    }).join(' ');
    try { sessionStorage.setItem('infinity.visited', '1'); } catch (e) { /* private mode */ }
  }

  function reveal() {
    if (state.revealedAt) return;
    state.revealedAt = Date.now();
    state.elapsedMs = Math.round(now() - started);
    // A reveal that follows a timeout keeps the reason it was given; only a
    // plain success is recorded as 'shown'.
    if (state.result === 'pending') state.result = 'shown';
    clearGateClass();
    var node = document.getElementById('infinity-gate');
    if (node) {
      node.className = 'done';
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 240);
    }
    // A reset link left in the address would clear the pass again on the next
    // refresh; drop it now that it has been honoured.
    if (qs && qs.get('verify')) {
      try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* ignore */ }
    }
  }

  /*
   * Failure is not a page of its own. An error screen is a screen that can be
   * studied, and the requirement is a plain 404: the document is replaced by
   * the site's 404 handler and nothing else is shown.
   */
  var FAIL_URL = 'https://zssx-2026.github.io/404';

  function showTimeout(reason) {
    if (state.revealedAt) return;
    state.revealedAt = Date.now();
    state.elapsedMs = Math.round(now() - started);
    state.result = 'timeout';
    state.reason = reason || 'failed';
    try { location.replace(FAIL_URL); } catch (e) { window.location.href = FAIL_URL; }
  }

  if (internal) {
    /* The bar is shown for its own moment and the page is never held back. */
    setTimeout(reveal, SHORT_MS);
    return;
  }

  // ------------------------------------------------------------- challenge
  var failed = false;
  var solved = false;
  var worker = null;
  var target = 0;
  var explicit = false;
  var prefix = makePrefix();

  // Read on its own: ?verify=reset&difficulty=64 has to mean both "forget the
  // pass" and "run the impossible target", which a single parameter could not.
  if (wanted !== null) {
    var n = parseInt(wanted, 10);
    if (isFinite(n) && n >= 1 && n <= 64) {
      target = Math.max(1, Math.pow(2, 32 - n));
      explicit = true;
    }
  }

  function makePrefix() {
    var rnd = '';
    try {
      var buf = new Uint8Array(8);
      var c = window.crypto || window.msCrypto;
      c.getRandomValues(buf);
      for (var i = 0; i < buf.length; i++) rnd += ('0' + buf[i].toString(16)).slice(-2);
    } catch (e) {
      rnd = Math.random().toString(16).slice(2, 18) + Date.now().toString(16);
    }
    return 'infinity-gate|' + VERSION + '|' + rnd + '|';
  }

  function startWorker() {
    if (typeof Worker !== 'function') { failed = true; state.reason = 'worker-unavailable'; return; }
    // The page always loads this file from /assets/, so the
    // worker sits beside it. The absolute path is the fallback: a relative one
    // would resolve against the document, not this script.
    var url = '/assets/verify-worker.js';
    try {
      var src = document.currentScript ? document.currentScript.src : '';
      if (src && /verify\.js$/.test(src)) url = src.replace(/verify\.js$/, 'verify-worker.js');
    } catch (e) { /* keep the relative fallback */ }
    try {
      worker = new Worker(url);
    } catch (e) { failed = true; state.reason = 'worker-create'; return; }
    worker.onerror = function () { failed = true; state.reason = 'worker-error'; };
    worker.onmessage = function (ev) {
      var d = ev.data || {};

      if (d.type === 'bench') {
        state.rate = d.rate || 0;
        if (!explicit) {
          /*
           * attempts = 2^32 / target, so seconds = attempts / rate. The budget
           * is clamped to [BUDGET_MIN_MS, BUDGET_MAX_MS] on THIS machine: a
           * target that would finish in 50 ms is not a gate, and one that
           * would need 20 s can never produce a pass before MAX_MS, which
           * would make every visit pay again.
           */
          var rate = Math.max(1, state.rate);
          var want = rate * (BUDGET_MS / 1000);
          var lo = rate * (BUDGET_MIN_MS / 1000);
          var hi = rate * (BUDGET_MAX_MS / 1000);
          if (want < lo) want = lo;
          if (want > hi) want = hi;
          target = Math.round(4294967296 / want);
          if (target < 1) target = 1;
          if (target > 4294967295) target = 4294967295;
        }
        state.target = target;
        worker.postMessage({ cmd: 'start', prefix: prefix, target: target });
        return;
      }

      if (d.type === 'progress') {
        state.hashes = d.hashes || 0;
        return;
      }

      if (d.type === 'solved') {
        solved = true;
        state.solvedAt = Date.now();
        state.target = d.target || target;
        state.hashes = d.hashes || state.hashes;
        state.prefix = d.prefix || prefix;
        state.nonce = d.nonce;
        finish();
        return;
      }

      if (d.type === 'verify') {
        state.verified = !!d.ok;
        if (d.ok) {
          /* the stored proof still holds: this visit costs the short wait */
          setTimeout(reveal, SHORT_MS);
        } else {
          try { localStorage.removeItem(KEY); } catch (e) { /* private mode */ }
          beginSearch();
        }
        return;
      }
    };

    if (stored) {
      state.mode = 'remembered';
      worker.postMessage({ cmd: 'verify', prefix: stored.prefix, nonce: stored.nonce, target: stored.target });
    } else {
      state.mode = 'gate';
      worker.postMessage({ cmd: 'bench', ms: BENCH_MS });
    }
  }

  function beginSearch() {
    if (explicit) {
      state.target = target;
      worker.postMessage({ cmd: 'start', prefix: prefix, target: target });
      return;
    }
    worker.postMessage({ cmd: 'bench', ms: BENCH_MS });
  }

  function finish() {
    if (state.revealedAt) return;
    var waited = now() - started;
    if (failed) {
      if (waited >= MIN_MS) showTimeout(state.reason);
      return;
    }
    if (solved && waited >= MIN_MS) {
      try {
        localStorage.setItem(KEY, JSON.stringify({
          v: VERSION, ts: Date.now(), prefix: state.prefix, nonce: state.nonce, target: state.target
        }));
      } catch (e) { /* private mode: the gate simply runs again next time */ }
      reveal();
    }
  }

  startWorker();
  setInterval(finish, 60);

  /*
   * No step-down timer: the target is already chosen from this machine's
   * measured speed, so lowering it here would only make the gate cheaper than
   * the machine can afford. If the search has not finished by MAX_MS the page
   * is shown without a pass, and the next visit pays again.
   */
  setTimeout(function () {
    if (state.revealedAt) return;
    finish();
    if (!state.revealedAt) {
      state.result = 'unfinished';
      state.reason = failed ? (state.reason || 'failed') : 'max-time';
      if (failed) showTimeout(state.reason);
      else reveal();
    }
  }, MAX_MS);
})();
