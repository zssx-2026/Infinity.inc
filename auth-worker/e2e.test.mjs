// auth-worker/e2e.test.mjs - both worker editions, full flow, mock GitHub API.
// Run:  node e2e.test.mjs   (Node >= 18; no dependencies)
import nodeCrypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EN = await import(pathToFileURL(path.join(HERE, 'worker.en.mjs')).href);
const ZH = await import(pathToFileURL(path.join(HERE, 'worker.zh.mjs')).href);

/* ---------- PoW helpers, independent of the code under test ---------- */

function solve(prefix, bits) {
  const target = Math.pow(2, 32 - bits);
  for (let n = 0; ; n++) {
    const h = nodeCrypto.createHash('sha256').update(prefix + n).digest('hex');
    if ((parseInt(h.slice(0, 8), 16) >>> 0) < target) return n;
  }
}

function hmac(secret, text) {
  return nodeCrypto.createHmac('sha256', secret).update(text).digest('hex');
}

/* ------------------------- mock GitHub API ------------------------- */

function mockGitHub() {
  const st = {
    main: new Map(),
    branches: new Map(),
    prs: [],
    nextPr: 1,
    log: []
  };
  const rnd = () => nodeCrypto.randomBytes(10).toString('hex');

  async function handler(urlStr, init) {
    init = init || {};
    const u = new URL(urlStr);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    st.log.push(method + ' ' + urlStr);
    const ok = (obj, status) => new Response(JSON.stringify(obj), {
      status: status || 200, headers: { 'Content-Type': 'application/json' } });
    const nf = () => new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    const fileMap = (ref) => (!ref || ref === 'main') ? st.main : (st.branches.get(ref) || null);

    if (u.host === 'github.com') {
      if (u.pathname === '/login/oauth/access_token' && method === 'POST') {
        return ok({ access_token: 'gho_mock_' + body.code, token_type: 'bearer' });
      }
      return nf();
    }
    if (u.host !== 'api.github.com') throw new Error('unexpected host ' + u.host);

    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'repos' || parts.length < 4) return nf();
    const kind = parts[3];
    const rest = parts.slice(4);

    if (kind === 'git' && rest[0] === 'ref' && method === 'GET') {
      return ok({ ref: 'refs/heads/main', object: { sha: 'base0', type: 'commit' } });
    }
    if (kind === 'git' && rest[0] === 'refs' && rest.length === 1 && method === 'POST') {
      const name = body.ref.replace('refs/heads/', '');
      st.branches.set(name, new Map());
      return ok({}, 201);
    }
    if (kind === 'git' && rest[0] === 'refs' && rest[1] === 'heads' && method === 'DELETE') {
      st.branches.delete(rest[2]);
      return new Response(null, { status: 204 });
    }
    if (kind === 'contents' && rest[0] === 'users') {
      const fpath = 'users/' + decodeURIComponent(rest[1]);
      if (method === 'GET') {
        const fm = fileMap(u.searchParams.get('ref'));
        if (!fm || !fm.has(fpath)) return nf();
        const f = fm.get(fpath);
        return ok({ name: fpath.split('/').pop(), path: fpath, sha: f.sha,
                    content: f.content, encoding: 'base64' });
      }
      if (method === 'PUT') {
        const fm = fileMap(body.branch);
        if (!fm) return new Response(JSON.stringify({ message: 'no such branch' }), { status: 422 });
        const existing = fm.get(fpath);
        if (body.sha && (!existing || existing.sha !== body.sha)) {
          return new Response(JSON.stringify({ message: 'sha mismatch' }), { status: 409 });
        }
        const f = { sha: rnd(), content: body.content };
        fm.set(fpath, f);
        return ok({ content: { sha: f.sha, path: fpath } }, existing ? 200 : 201);
      }
    }
    if (kind === 'pulls' && rest.length === 0) {
      if (method === 'GET') return ok(st.prs.filter((x) => x.state === 'open'));
      if (method === 'POST') {
        const pr = { number: st.nextPr++, state: 'open', title: body.title,
                     head: { ref: body.head }, base: { ref: body.base }, body: body.body };
        st.prs.push(pr);
        return ok(pr, 201);
      }
    }
    if (kind === 'pulls' && rest.length === 1 && method === 'GET') {
      const pr = st.prs.find((x) => x.number === Number(rest[0]));
      return pr ? ok(pr) : nf();
    }
    if (kind === 'pulls' && rest.length === 2 && rest[1] === 'merge' && method === 'PUT') {
      const pr = st.prs.find((x) => x.number === Number(rest[0]));
      if (!pr) return nf();
      if (pr.state !== 'open') return new Response(JSON.stringify({ message: 'not open' }), { status: 405 });
      const fm = st.branches.get(pr.head.ref);
      if (fm) for (const kv of fm) st.main.set(kv[0], kv[1]);
      pr.state = 'merged';
      return ok({ merged: true, message: 'Pull Request successfully merged' });
    }
    throw new Error('mock: unhandled ' + method + ' ' + urlStr);
  }
  return { st, handler };
}

/* ----------------------------- suite ----------------------------- */

async function runSuite(mod) {
  const env = {
    GITHUB_CLIENT_ID: 'Iv1testclient',
    GITHUB_CLIENT_SECRET: 'client-secret-test',
    GITHUB_PAT: 'pat-test',
    AUTH_DATA_REPO: 'acme/auth-data',
    FRONTEND_URL: 'https://pages.example/',
    CHALLENGE_SECRET: 'unit-test-secret',
    MIN_POW_BITS: '18',
    GATE_TTL_SECONDS: '600',
    DL_MAP: JSON.stringify({ 'InfinityCloud-setup': 'https://example.invalid/asset/InfinityCloud-setup.exe' }),
    CHALLENGE_TTL_SECONDS: '600'
  };
  const worker = mod.default;
  const mock = mockGitHub();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('https://api.github.com') || url.startsWith('https://github.com/')) {
      return mock.handler(url, init);
    }
    throw new Error('unexpected fetch: ' + url);
  };

  const W = 'https://worker.test';
  const call = (path, init) => worker.fetch(new Request(W + path, init), env,
    { waitUntil() {}, passThroughOnException() {} });
  let ipn = 1;
  const POST = (body, origin) => ({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': origin || 'https://pages.example',
      'CF-Connecting-IP': '10.0.0.' + (ipn++)
    },
    body: JSON.stringify(body)
  });
  const challenge = async (email) =>
    await (await call('/api/challenge?email=' + encodeURIComponent(email), {})).json();
  const proofOf = async (email) => {
    const c = await challenge(email);
    return { prefix: c.prefix, bits: c.bits, nonce: solve(c.prefix, c.bits), expires: c.expires, sig: c.sig };
  };

  let pass = 0, fail = 0;
  const lines = [];
  const t = async (name, fn) => {
    try { await fn(); pass++; lines.push('  PASS ' + name); }
    catch (e) { fail++; lines.push('  FAIL ' + name + ' :: ' + e.message); }
  };
  const eq = (a, b, msg) => {
    if (a !== b) throw new Error((msg || 'eq') + ': got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b));
  };
  const wantErr = async (r, status, code) => {
    eq(r.status, status, 'status for ' + code);
    eq((await r.json()).error, code, 'error code');
  };

  const emailA = 'alice@example.com';
  const emailB = 'bob@example.com';
  let prA = 0, tokenA = '', state1 = '';
  const proofA = await proofOf(emailA);

  await t('healthz', async () => {
    const r = await call('/healthz', {});
    eq(r.status, 200); eq((await r.json()).ok, true);
  });

  await t('challenge: fields + HMAC binds prefix|bits|expires|email', async () => {
    const c = await challenge(emailA);
    eq(c.algo, 'sha256');
    eq(c.bits, 18);
    eq(c.target, Math.pow(2, 32 - 18));
    eq(c.sig, hmac(env.CHALLENGE_SECRET, c.prefix + '|' + c.bits + '|' + c.expires + '|' + emailA), 'sig');
  });

  await t('challenge: rejects malformed email', async () => {
    await wantErr(await call('/api/challenge?email=not-an-email', {}), 400, 'invalid_email');
  });

  await t('register: happy path -> branch + record + PR', async () => {
    const r = await call('/api/register', POST({ email: emailA, proof: proofA }));
    eq(r.status, 200);
    const j = await r.json();
    eq(j.ok, true); eq(j.state, 'pending');
    prA = j.pr;
    const pr = mock.st.prs.find((x) => x.number === prA);
    eq(pr.title, 'register: ' + emailA, 'PR title');
    let branchName = '';
    for (const kv of mock.st.branches) branchName = kv[0];
    if (!branchName) throw new Error('no reg branch created');
    const rec = JSON.parse(Buffer.from(
      mock.st.branches.get(branchName).get('users/' + emailA + '.json').content, 'base64').toString());
    eq(rec.email, emailA); eq(rec.verified, false);
    if (!/^[0-9a-f]{64}$/.test(rec.verifyToken)) throw new Error('verifyToken not 64 hex');
    tokenA = rec.verifyToken;
  });

  await t('register: replayed challenge rejected', async () => {
    await wantErr(await call('/api/register', POST({ email: emailA,
      proof: { prefix: proofA.prefix, bits: proofA.bits, nonce: 0, expires: proofA.expires, sig: proofA.sig } })),
      409, 'replay');
  });

  await t('register: second attempt while pending returns same PR', async () => {
    const r = await call('/api/register', POST({ email: emailA, proof: await proofOf(emailA) }));
    eq(r.status, 200);
    const j = await r.json();
    eq(j.already, true); eq(j.pr, prA, 'same PR');
  });

  await t('register: tampered signature rejected', async () => {
    const proof = await proofOf(emailB);
    const bad = proof.sig.slice(0, -1) + (proof.sig.endsWith('0') ? '1' : '0');
    await wantErr(await call('/api/register', POST({ email: emailB,
      proof: { prefix: proof.prefix, bits: proof.bits, nonce: proof.nonce, expires: proof.expires, sig: bad } })),
      400, 'pow_invalid');
  });

  await t('register: proof bound to one email (re-target rejected)', async () => {
    await wantErr(await call('/api/register', POST({ email: emailB, proof: proofA })), 400, 'pow_invalid');
  });

  await t('register: expired challenge rejected', async () => {
    const prefix = nodeCrypto.randomBytes(8).toString('hex');
    const bits = 18, expires = Date.now() - 1000;
    const sig = hmac(env.CHALLENGE_SECRET, prefix + '|' + bits + '|' + expires + '|' + emailB);
    await wantErr(await call('/api/register', POST({ email: emailB,
      proof: { prefix, bits, nonce: 1, expires, sig } })), 410, 'pow_expired');
  });

  await t('register: below-minimum difficulty rejected', async () => {
    const prefix = nodeCrypto.randomBytes(8).toString('hex');
    const bits = 10, expires = Date.now() + 60000;
    const sig = hmac(env.CHALLENGE_SECRET, prefix + '|' + bits + '|' + expires + '|' + emailB);
    await wantErr(await call('/api/register', POST({ email: emailB,
      proof: { prefix, bits, nonce: solve(prefix, bits), expires, sig } })), 400, 'pow_weak');
  });

  await t('register: foreign origin rejected', async () => {
    await wantErr(await call('/api/register', POST({ email: emailB }, 'https://evil.example')),
      403, 'forbidden_origin');
  });

  await t('CORS: preflight answered for the frontend origin', async () => {
    const r = await call('/api/register', { method: 'OPTIONS', headers: { 'Origin': 'https://pages.example' } });
    eq(r.status, 204);
    eq(r.headers.get('Access-Control-Allow-Origin'), 'https://pages.example');
  });

  await t('verify: wrong token rejected', async () => {
    await wantErr(await call('/api/verify', POST({ pr: prA, email: emailA, token: '0'.repeat(64) })),
      403, 'token_mismatch');
  });

  await t('verify: token match -> verified + merge + branch cleanup', async () => {
    const r = await call('/api/verify', POST({ pr: prA, email: emailA, token: tokenA }));
    eq(r.status, 200);
    const j = await r.json();
    eq(j.ok, true); eq(j.state, 'active');
    eq(mock.st.prs.find((x) => x.number === prA).state, 'merged', 'PR merged');
    const rec = JSON.parse(Buffer.from(
      mock.st.main.get('users/' + emailA + '.json').content, 'base64').toString());
    eq(rec.verified, true, 'record on main is verified');
    eq(mock.st.branches.size, 0, 'reg branch deleted');
  });

  await t('register: already-activated email rejected', async () => {
    await wantErr(await call('/api/register', POST({ email: emailA, proof: await proofOf(emailA) })),
      409, 'already_registered');
  });

  await t('verify: foreign email on a merged PR does not activate anything', async () => {
    const r = await call('/api/verify', POST({ pr: prA, email: emailB, token: tokenA }));
    const j = await r.json();
    if (j.ok) throw new Error('must not activate');
  });

  await t('status: active vs unregistered', async () => {
    eq((await (await call('/api/status?email=' + encodeURIComponent(emailA), {})).json()).state, 'active');
    eq((await (await call('/api/status?email=' + encodeURIComponent(emailB), {})).json()).state, 'unregistered');
  });

  await t('oauth: start redirects to GitHub with state cookie', async () => {
    const r = await call('/api/auth/github', {});
    eq(r.status, 302);
    const loc = r.headers.get('Location');
    if (!loc.startsWith('https://github.com/login/oauth/authorize')) throw new Error('bad location ' + loc);
    state1 = new URL(loc).searchParams.get('state');
    if (!r.headers.get('Set-Cookie').includes('__Host-infx_state=' + state1)) throw new Error('no state cookie');
  });

  await t('oauth: callback with wrong state bounces with #error', async () => {
    const r = await call('/api/auth/github/callback?code=x&state=wrong',
      { headers: { Cookie: '__Host-infx_state=' + state1 } });
    eq(r.status, 302);
    if (!r.headers.get('Location').endsWith('#error=state_mismatch')) {
      throw new Error('bad redirect ' + r.headers.get('Location'));
    }
  });

  await t('oauth: callback lands on FRONTEND_URL with #token fragment', async () => {
    const r = await call('/api/auth/github/callback?code=abc&state=' + state1,
      { headers: { Cookie: '__Host-infx_state=' + state1 } });
    eq(r.status, 302);
    eq(r.headers.get('Location'), 'https://pages.example/#token=gho_mock_abc', 'fragment redirect');
  });

  await t('router: unknown path is 404', async () => {
    await wantErr(await call('/api/nothing', {}), 404, 'not_found');
  });

  await t('rate limit: 6th register inside the window from one IP is refused', async () => {
    const hdrs = () => ({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '99.9.9.9' });
    for (let i = 0; i < 5; i++) {
      const r = await call('/api/register', { method: 'POST', headers: hdrs(), body: JSON.stringify({ email: emailB }) });
      eq(r.status, 400, 'call ' + i + ' should be rejected as pow_required');
    }
    await wantErr(await call('/api/register', { method: 'POST', headers: hdrs(), body: JSON.stringify({ email: emailB }) }), 429, 'rate_limited');
  });

  globalThis.fetch = realFetch;
  /* ---- download gate: /api/gate, /api/gate/verify, /api/dl ---- */
  let gp = null, gpass = '';
  await t('gate challenge binds the scope', async () => {
    const r = await call('/api/gate?scope=download');
    eq(r.status, 200, 'status');
    const j = await r.json();
    eq(j.sig, hmac(env.CHALLENGE_SECRET, j.prefix + '|' + j.bits + '|' + j.expires + '|gate:download'), 'sig binds gate:download');
    gp = j;
  });
  await t('gate verify hands out a signed pass', async () => {
    const nonce = solve(gp.prefix, gp.bits);
    const r = await call('/api/gate/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://pages.example' }, body: JSON.stringify({ scope: 'download', proof: { prefix: gp.prefix, bits: gp.bits, nonce, expires: gp.expires, sig: gp.sig } }) });
    eq(r.status, 200, 'status');
    const j = await r.json();
    eq(j.ok, true, 'ok');
    const p = String(j.pass).split('.');
    eq(p.length, 4, 'pass shape');
    eq(p[0], 'g1', 'pass version');
    eq(p[3], hmac(env.CHALLENGE_SECRET, 'gatepass|download|' + parseInt(p[1], 36) + '|' + p[2]), 'pass sig');
    gpass = j.pass;
  });
  await t('gate proof is single-use', async () => {
    const nonce = solve(gp.prefix, gp.bits);
    const r = await call('/api/gate/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://pages.example' }, body: JSON.stringify({ scope: 'download', proof: { prefix: gp.prefix, bits: gp.bits, nonce, expires: gp.expires, sig: gp.sig } }) });
    eq(r.status, 409, 'replay');
  });
  await t('dl with a valid pass 302s to the asset', async () => {
    const r = await call('/api/dl?scope=download&asset=InfinityCloud-setup&pass=' + encodeURIComponent(gpass));
    eq(r.status, 302, 'status');
    eq(r.headers.get('Location'), 'https://example.invalid/asset/InfinityCloud-setup.exe', 'location');
  });
  await t('dl rejects a tampered pass', async () => {
    const bad = gpass.slice(0, -2) + 'zz';
    const r = await call('/api/dl?scope=download&asset=InfinityCloud-setup&pass=' + encodeURIComponent(bad));
    eq(r.status, 403, 'forbidden');
  });
  await t('dl rejects an unknown asset', async () => {
    const r = await call('/api/dl?scope=download&asset=Nope&pass=' + encodeURIComponent(gpass));
    eq(r.status, 403, 'forbidden');
  });
  await t('dl rejects an expired pass', async () => {
    const exp = Date.now() - 1000;
    const pass = 'g1.' + exp.toString(36) + '.cafebabe.' + hmac(env.CHALLENGE_SECRET, 'gatepass|download|' + exp + '|cafebabe');
    const r = await call('/api/dl?scope=download&asset=InfinityCloud-setup&pass=' + encodeURIComponent(pass));
    eq(r.status, 403, 'expired forbidden');
  });
  return { pass, fail, lines };
}

const en = await runSuite(EN);
console.log('=== worker.en.mjs ===');
for (const l of en.lines) console.log(l);
console.log('EN: ' + en.pass + ' passed, ' + en.fail + ' failed');
const zh = await runSuite(ZH);
console.log('=== worker.zh.mjs ===');
for (const l of zh.lines) console.log(l);
console.log('ZH: ' + zh.pass + ' passed, ' + zh.fail + ' failed');
if (en.fail || zh.fail) process.exit(1);
