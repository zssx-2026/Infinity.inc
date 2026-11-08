// gate-test.mjs - run the real verify.js against a DOM/Worker shim and assert
// what it does. Product code is never modified here.
//
// The protocol the shim implements (web/infinity/assets/verify.js):
//   bench  -> { type:"bench",  rate }                            measured hash rate
//   start  -> { type:"solved", prefix, nonce, hash, target }      a found proof
//   verify -> { type:"verify", ok }                              re-hash a stored proof
//
// What is asserted:
//   * a first arrival gets the gate class, is held >= MIN_MS, then reveals
//   * the pass it stores is a proof (prefix + nonce + target), not a flag
//   * a hand-written {"v":2} fails the shape check and the gate runs again
//   * a proof whose hash no longer meets the target is refused and replaced
//   * a valid proof is re-verified and reveals in SHORT_MS
//   * internal navigation never blocks the page
//   * worker failure -> the site 404; an unfinished search -> page without a pass
//   * ?verify=reset forgets the pass
//   * a faster machine is given more work (smaller target), not the same work
//
// Timers: verify.js starts a setInterval and never clears it (right for a page,
// fatal for a node host: the process would hang with no exit code). The shim
// clears every interval it handed out.
import fs from 'node:fs';
const SRC = fs.readFileSync('web/infinity/assets/verify.js', 'utf8');
const KEY = 'infinity.verify';

function makeEnv(opts) {
  const nodes = [];
  function node(tag) {
    const n = { tag, id: '', className: '', children: [], attrs: {}, textContent: '',
      style: { setProperty() {} },
      appendChild(c) { this.children.push(c); return c; },
      setAttribute(k, v) { this.attrs[k] = v; },
      getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
      removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); },
      get parentNode() { return null; } };
    nodes.push(n);
    return n;
  }
  const html = node('html');
  const store = {};
  const mkStore = () => ({
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  });
  let replaced = null;
  const document = {
    documentElement: html,
    createElement: node,
    getElementById: (id) => nodes.find((n) => n.id === id) || null,
    addEventListener() {},
    readyState: 'complete',
  };
  const location = {
    search: opts.search || '',
    pathname: opts.pathname || '/infinity/',
    hash: '',
    origin: 'https://zssx-2026.github.io',
    replace(u) { replaced = u; },
  };
  class FakeWorker {
    constructor() { this.onmessage = null; this.onerror = null; }
    emit(data) { if (this.onmessage) this.onmessage({ data }); }
    postMessage(msg) {
      const d = msg || {};
      if (opts.workerFails) {
        setTimeout(() => { if (this.onerror) this.onerror(new Error('boom')); }, 0);
        return;
      }
      if (d.cmd === 'bench') {
        setTimeout(() => this.emit({ type: 'bench', rate: opts.rate || 200000, ms: 300, hashes: 1000 }), 2);
        return;
      }
      if (d.cmd === 'start') {
        if (opts.neverSolve) return;
        setTimeout(() => this.emit({
          type: 'solved', prefix: d.prefix, nonce: 12345,
          hash: '00000000' + 'f'.repeat(56), target: d.target, hashes: 4242,
        }), 3);
        return;
      }
      if (d.cmd === 'verify') {
        setTimeout(() => this.emit({ type: 'verify', ok: opts.verifyOk !== false }), 2);
        return;
      }
    }
  }
  const window = {
    crypto: globalThis.crypto,
    performance: { now: () => Date.now() },
    addEventListener() {}, removeEventListener() {},
    Worker: FakeWorker,
  };
  const sessionStorage = mkStore();
  const localStorage = mkStore();
  if (opts.session) for (const k of Object.keys(opts.session)) sessionStorage.setItem(k, opts.session[k]);
  if (opts.local) for (const k of Object.keys(opts.local)) localStorage.setItem(k, opts.local[k]);
  const history = { replaceState() {} };
  const intervals = new Set();
  const trackedSetInterval = (fn, ms) => { const id = setInterval(fn, ms); intervals.add(id); return id; };
  const fn = new Function(
    'window', 'document', 'localStorage', 'sessionStorage', 'location', 'history',
    'URLSearchParams', 'Worker', 'setTimeout', 'setInterval', 'clearInterval',
    SRC
  );
  fn(window, document, localStorage, sessionStorage, location, history,
     URLSearchParams, FakeWorker, setTimeout, trackedSetInterval, clearInterval);
  return {
    html, nodes, location,
    initialClass: html.className,
    get replaced() { return replaced; },
    state: window.__INFINITY_GATE,
    sessionStorage, localStorage,
    stopTimers() { for (const id of intervals) clearInterval(id); intervals.clear(); },
  };
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
const results = [];
function check(name, cond, detail) {
  results.push((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  -> ' + detail : ''));
}
function splitClass(s) { return String(s || '').split(/\s+/).filter(Boolean); }

const envs = [];

// ---------------------------------------------------------------- 1. first arrival
const a = makeEnv({});
envs.push(a);
const t0 = Date.now();
await wait(3400);
check('first arrival runs the gate', a.state.mode === 'gate', 'mode=' + a.state.mode);
check('first arrival paints infinity-gate', splitClass(a.initialClass).indexOf('infinity-gate') >= 0, 'class="' + a.initialClass + '"');
check('first arrival is held at least 3s', a.state.revealedAt !== null && (a.state.elapsedMs >= 3000), 'elapsedMs=' + a.state.elapsedMs + ' wall=' + (Date.now() - t0));
check('first arrival clears both classes', splitClass(a.html.className).indexOf('infinity-gate') < 0 && splitClass(a.html.className).indexOf('infinity-nav') < 0, 'class="' + a.html.className + '"');
check('first arrival marks the session', a.sessionStorage.getItem('infinity.visited') === '1');
check('first arrival does not redirect', a.replaced === null, String(a.replaced));

let proof = null;
try { proof = JSON.parse(a.localStorage.getItem(KEY) || 'null'); } catch (e) { proof = null; }
check('the stored pass is a proof, not a flag',
  !!proof && proof.v === 2 && typeof proof.prefix === 'string' && proof.prefix.length > 10 &&
  typeof proof.nonce === 'number' && typeof proof.target === 'number' && proof.target > 0,
  JSON.stringify(proof).slice(0, 120));

// ---------------------------------------------------------------- 2. a forged flag
const b = makeEnv({ local: { [KEY]: '{"v":2}' } });
envs.push(b);
await wait(600);
check('a hand-written {"v":2} is not accepted', b.state.mode === 'gate', 'mode=' + b.state.mode);

// ---------------------------------------------------------------- 3. a proof that no longer holds
const forged = JSON.stringify({ v: 2, ts: Date.now(), prefix: 'infinity-gate|2|deadbeefdeadbeef|', nonce: 7, target: 4096 });
const c = makeEnv({ local: { [KEY]: forged }, verifyOk: false });
envs.push(c);
await wait(3400);
check('a proof whose hash fails is refused', c.state.verified === false, 'verified=' + c.state.verified);
check('the refused proof is replaced by a real one', c.localStorage.getItem(KEY) !== forged && !!c.localStorage.getItem(KEY));

// ---------------------------------------------------------------- 4. a valid proof
const good = JSON.stringify({ v: 2, ts: Date.now(), prefix: 'infinity-gate|2|00112233445566aa|', nonce: 99, target: 2048 });
const d = makeEnv({ local: { [KEY]: good }, verifyOk: true });
envs.push(d);
await wait(1000);
check('a valid proof is re-verified', d.state.mode === 'remembered' && d.state.verified === true, 'mode=' + d.state.mode + ' verified=' + d.state.verified);
check('a returning visitor waits only SHORT_MS', d.state.revealedAt !== null && d.state.elapsedMs < 2000, 'elapsedMs=' + d.state.elapsedMs);

// ---------------------------------------------------------------- 5. internal navigation
const e = makeEnv({ session: { 'infinity.visited': '1' } });
envs.push(e);
await wait(900);
check('internal navigation uses infinity-nav', splitClass(e.initialClass).indexOf('infinity-nav') >= 0 && splitClass(e.initialClass).indexOf('infinity-gate') < 0, 'class="' + e.initialClass + '"');
check('internal navigation never blocks', e.state.revealedAt !== null && e.state.elapsedMs < 2000, 'elapsedMs=' + e.state.elapsedMs);

// ---------------------------------------------------------------- 6. worker failure
const f = makeEnv({ workerFails: true });
envs.push(f);
await wait(5200);
check('worker failure redirects to the site 404', /zssx-2026\.github\.io\/404$/.test(String(f.replaced)), String(f.replaced));
check('worker failure leaves no pass behind', f.localStorage.getItem(KEY) === null);

// ---------------------------------------------------------------- 7. an unfinished search
const g = makeEnv({ neverSolve: true, search: '?verify=difficulty=64' });
envs.push(g);
await wait(6600);
check('an unfinished search still shows the page', g.state.revealedAt !== null && g.state.result === 'unfinished', 'result=' + g.state.result + ' reason=' + g.state.reason);
check('a slow search is not punished with the 404', g.replaced === null, String(g.replaced));
check('an unfinished search stores no pass', g.localStorage.getItem(KEY) === null);

// ---------------------------------------------------------------- 8. reset
const h = makeEnv({ local: { [KEY]: good }, search: '?verify=reset', verifyOk: true });
envs.push(h);
await wait(500);
check('?verify=reset forgets the stored pass', h.localStorage.getItem(KEY) === null && h.state.mode === 'gate', 'mode=' + h.state.mode);

// ---------------------------------------------------------------- 9. difficulty follows the machine
const slow = makeEnv({ rate: 10000 });
const fast = makeEnv({ rate: 2000000 });
envs.push(slow, fast);
await wait(500);
check('a faster machine is given more work', slow.state.target > fast.state.target && fast.state.target >= 1024, 'slow.target=' + slow.state.target + ' fast.target=' + fast.state.target);

for (const env of envs) env.stopTimers();

const failed = results.filter((r) => r.indexOf('FAIL ') === 0).length;
const passed = results.filter((r) => r.indexOf('PASS ') === 0).length;
console.log(results.join('\n'));
console.log('GATE-TEST pass=' + passed + ' fail=' + failed);
process.exitCode = failed ? 1 : 0;
