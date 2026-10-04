// gate-test.mjs - run the real verify.js three ways and assert what it does.
import fs from 'node:fs';
const SRC = fs.readFileSync('web/infinity/assets/verify.js', 'utf8');

function makeEnv(opts) {
  const nodes = [];
  function node(tag) {
    const n = { tag, id: '', className: '', children: [], style: { setProperty() {} }, attrs: {},
      textContent: '',
      appendChild(c) { this.children.push(c); return c; },
      setAttribute(k, v) { this.attrs[k] = v; },
      getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
      removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); },
      get parentNode() { return null; } };
    nodes.push(n);
    return n;
  }
  const html = node('html');
  html.className = '';
  const store = {};
  const mkStore = () => ({ getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } });
  let replaced = null;
  const document = {
    documentElement: html,
    createElement: node,
    getElementById: (id) => nodes.find((n) => n.id === id) || null,
    addEventListener() {},
    readyState: 'complete',
  };
  const location = { search: opts.search || '', pathname: '/infinity/', hash: '', origin: opts.origin || 'https://zssx-2026.github.io', replace(u) { replaced = u; } };
  class FakeWorker {
    constructor() { this.onmessage = null; this.onerror = null; }
    postMessage(msg) {
      if (opts.workerFails) { setTimeout(() => { if (this.onerror) this.onerror(new Error('boom')); }, 0); return; }
      setTimeout(() => { if (this.onmessage) this.onmessage({ data: { type: 'solved', zeros: 3 } }); }, 5);
    }
  }
  const window = { crypto: globalThis.crypto, performance: { now: () => Date.now() }, addEventListener() {}, removeEventListener() {}, Worker: FakeWorker };
  const sessionStorage = mkStore();
  const localStorage = mkStore();
  const history = { replaceState() {} };
  const fn = new Function('window', 'document', 'localStorage', 'sessionStorage', 'location', 'history', 'URLSearchParams', 'Worker', 'setTimeout', 'setInterval', 'clearInterval', SRC);
  fn(window, document, localStorage, sessionStorage, location, history, URLSearchParams, FakeWorker, setTimeout, setInterval, clearInterval);
  return { html, nodes, location, get replaced() { return replaced; }, state: window.__INFINITY_GATE, sessionStorage, localStorage };
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
const results = [];
function check(name, cond, detail) { results.push((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  -> ' + detail : '')); }

// 1) a first arrival: blank page, gate class, held for >= MIN_MS
const a = makeEnv({});
const t0 = Date.now();
await wait(3300);
check('first visit uses infinity-gate', a.html.className.indexOf('infinity-gate') >= 0, 'class="' + a.html.className + '"');
check('first visit reveals after >= 3s', a.state.revealedAt !== null && (Date.now() - t0) >= 3000, 'elapsed=' + (a.state.revealedAt || 0));
check('first visit marks the session visited', a.sessionStorage.getItem('infinity.visited') === '1');
check('first visit does not redirect', a.replaced === null, String(a.replaced));

// 2) an internal navigation: page stays, bar only
const b = makeEnv({});
b.sessionStorage.setItem('infinity.visited', '1');
b.html.className = (() => { const c = 'x'; return c; })();
const c = makeEnv({});
c.sessionStorage.setItem('infinity.visited', '1');
await wait(900);
check('internal navigation uses infinity-nav', c.html.className.indexOf('infinity-nav') >= 0, 'class="' + c.html.className + '"');
check('internal navigation is not a gate', c.html.className.indexOf('infinity-gate') < 0);
check('internal navigation reveals quickly', c.state.revealedAt !== null, 'elapsed=' + (c.state.revealedAt || 0));

// 3) a worker that cannot start, on a first arrival: straight to 404
const d = makeEnv({ workerFails: true, search: '?verify=reset' });
await wait(5200);
check('worker failure redirects to /404', /zssx-2026\.github\.io\/404$/.test(String(d.replaced)), String(d.replaced));
check('worker failure keeps the gate class', d.html.className.indexOf('infinity-gate') >= 0, 'class="' + d.html.className + '"');

console.log(results.join('\n'));
console.log(results.filter((r) => r.startsWith('PASS')).length + '/' + results.length + ' passed');
