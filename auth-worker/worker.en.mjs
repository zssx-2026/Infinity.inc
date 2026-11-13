/*
 * Infinity.Inc - the account auth worker (Cloudflare Worker, English edition).
 *
 *   frontend (GitHub Pages, zero secrets)
 *        |  fetch, JSON only
 *        v
 *   THIS WORKER  < the only place secrets exist >
 *        |  GitHub REST API with a PAT
 *        v
 *   private repo "auth-data"  = the database + the event source
 *     users/<email>.json      = the account table
 *     PR lifecycle            = the account state machine
 *     pull_request: opened    = the trigger for the verification email
 *
 * Endpoints
 *   GET  /healthz                     liveness
 *   GET  /api/challenge?email=...     issue a signed proof-of-work challenge (human test)
 *   POST /api/register                verify human + open the registration PR
 *   POST /api/verify                  compare the mail token, mark verified, merge, activate
 *   GET  /api/status?email=...        unregistered | pending | active
 *   GET  /api/gate?scope=...          signed PoW challenge for the download gate
 *   POST /api/gate/verify             check the proof, hand out a short-lived pass
 *   GET  /api/dl?scope&asset&pass     check the pass, 302 to the real asset URL
 *   GET  /dl/<asset>                  public 302 for the assets the site lists
 *   GET  /api/catalog                 the public product list the studio reads
 *   GET  /api/auth/github             start GitHub OAuth (state cookie)
 *   GET  /api/auth/github/callback    exchange code + secret, redirect  FRONTEND_URL#token=...
 *
 * Human verification, for real
 *   The gate in the static site (verify.js) can only be checked by the browser,
 *   so it is a speed bump, not a test. Here the challenge is issued by this
 *   worker and HMAC-signed (prefix|bits|expires|email); the register endpoint
 *   re-hashes sha256(prefix + nonce) itself and compares the first 32 bits
 *   against 2^(32-bits) before it believes anything. A proof cannot be forged,
 *   reused, re-targeted to another address, or tuned below the configured
 *   difficulty. If a TURNSTILE_SECRET is configured the register endpoint also
 *   demands a Cloudflare Turnstile token on top.
 *
 * Configuration (wrangler.toml [vars] + secrets)
 *   vars    GITHUB_CLIENT_ID, AUTH_DATA_REPO, FRONTEND_URL,
 *           MIN_POW_BITS (default 20), CHALLENGE_TTL_SECONDS (default 600)
 *   secrets GITHUB_CLIENT_SECRET, GITHUB_PAT, CHALLENGE_SECRET
 *   optional TURNSTILE_SECRET (+ TURNSTILE_SITE_KEY for the page),
 *            KV binding AUTH_KV (global single-use for challenges)
 *
 * Deploy: paste this file into the worker editor, or  npx wrangler deploy
 * See README.md for the full setup (OAuth app, PAT, auth-data workflow, SMTP).
 */

'use strict';

/* ------------------------------------------------------------------ i18n */

const MSG = {
  bad_request: 'Malformed request.',
  invalid_email: 'That email address is not valid.',
  not_found: 'Not found.',
  not_configured: 'The worker is missing required configuration (secrets or vars).',
  forbidden_origin: 'Requests from this origin are not accepted.',
  rate_limited: 'Too many requests from this address; try again later.',
  pow_required: 'A proof-of-work challenge is required (GET /api/challenge first).',
  pow_invalid: 'The proof-of-work is invalid.',
  pow_expired: 'The challenge has expired; request a new one.',
  pow_weak: 'The challenge difficulty is below the required minimum.',
  replay: 'This challenge has already been used.',
  turnstile_failed: 'Human verification (Turnstile) failed.',
  already_registered: 'This address is already registered and active.',
  pr_not_found: 'That registration PR does not exist.',
  pr_closed: 'That registration PR is no longer open.',
  email_mismatch: 'This link does not belong to that registration.',
  token_mismatch: 'The verification token is wrong.',
  merge_failed: 'Merging the registration PR failed; try again.',
  github_error: 'The GitHub API call failed; try again later.',
  oauth_failed: 'GitHub sign-in failed.',
  server_error: 'Unexpected server error.',
  forbidden: 'Missing or invalid download pass.'
};

/* ----------------------------------------------------------------- config */

const EMAIL_RE = /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{3,190}\.[a-z]{2,24}$/;
const MAX_BODY_BYTES = 4096;
const POW_MAX_BITS = 30;
const STATE_COOKIE = '__Host-infx_state';

function intEnv(v, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

function frontendOrigin(env) {
  try { return new URL(env.FRONTEND_URL).origin; } catch (e) { return '*'; }
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': frontendOrigin(env),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Cache-Control': 'no-store'
  };
}

function json(env, obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, corsHeaders(env))
  });
}

function preflight(env) {
  return new Response(null, { status: 204, headers: corsHeaders(env) });
}

function redirect(location, extra) {
  return new Response(null, {
    status: 302,
    headers: Object.assign({ 'Location': location, 'Cache-Control': 'no-store' }, extra || {})
  });
}

/* ----------------------------------------------------------------- crypto */

const enc = new TextEncoder();

function toHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += (bytes[i] + 256).toString(16).slice(1);
  return s;
}

function randomHex(nBytes) {
  const b = new Uint8Array(nBytes);
  crypto.getRandomValues(b);
  return toHex(b);
}

async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return toHex(new Uint8Array(d));
}

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const d = await crypto.subtle.sign('HMAC', key, enc.encode(text));
  return toHex(new Uint8Array(d));
}

/* the first 32 bits of the digest, as a plain number - the site convention */
function hash32(hexStr) { return parseInt(hexStr.slice(0, 8), 16) >>> 0; }

/* constant-time compare for signatures and tokens */
function ctEqual(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/* ------------------------------------------------- soft per-isolate limits */

const hits = new Map();
function rateLimit(kind, ip, max, windowMs) {
  const now = Date.now();
  const key = kind + '|' + ip;
  const arr = (hits.get(key) || []).filter(function (t) { return now - t < windowMs; });
  if (arr.length >= max) { hits.set(key, arr); return false; }
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) hits.clear(); /* crude memory bound */
  return true;
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || '0.0.0.0';
}

function checkOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return null; /* browsers always send Origin on POST; CLI may not */
  return origin === frontendOrigin(env) ? null : 'forbidden_origin';
}

/* --------------------------------------------------------------- github io */

async function gh(env, path, init) {
  return fetch('https://api.github.com' + path, {
    method: (init && init.method) || 'GET',
    headers: {
      'Authorization': 'Bearer ' + env.GITHUB_PAT,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'infinity-account-auth-worker',
      'Content-Type': 'application/json'
    },
    body: init && init.body !== undefined ? JSON.stringify(init.body) : undefined
  });
}

function repoPath(env, email) {
  return '/repos/' + env.AUTH_DATA_REPO + '/contents/users/' + encodeURIComponent(email) + '.json';
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    const j = JSON.parse(text);
    return j && typeof j === 'object' ? j : null;
  } catch (e) { return null; }
}

function normalizeEmail(v) {
  return String(v || '').trim().toLowerCase();
}

async function githubError(env, r) {
  let detail = '';
  try {
    const j = await r.json();
    detail = j && j.message ? String(j.message).slice(0, 200) : '';
  } catch (e) { detail = ''; }
  console.log('github api error ' + r.status + (detail ? ' :: ' + detail : ''));
  return json(env, { error: 'github_error', message: MSG.github_error }, 502);
}

/* ----------------------------------------------------------- human test */

const usedChallenges = new Set(); /* per-isolate single-use; AUTH_KV makes it global */

function powStatus(code) {
  if (code === 'pow_expired') return 410;
  if (code === 'replay') return 409;
  return 400;
}

/*
 * The challenge is HMAC-signed over prefix|bits|expires|email, so a proof is
 * bound to one address and one lifetime and the difficulty cannot be tuned
 * down by the client. The register endpoint re-hashes the claim itself.
 */
async function checkPow(env, bind, proof) {
  if (!proof || typeof proof !== 'object') return 'pow_required';
  const prefix = String(proof.prefix || '');
  const nonce = proof.nonce;
  const bits = proof.bits;
  const expires = proof.expires;
  const sig = String(proof.sig || '');
  if (!/^[0-9a-f]{16,64}$/.test(prefix)) return 'pow_invalid';
  if (!Number.isInteger(nonce) || nonce < 0 || nonce > 9007199254740991) return 'pow_invalid';
  if (!Number.isInteger(bits) || bits < 1 || bits > POW_MAX_BITS) return 'pow_invalid';
  if (!Number.isInteger(expires) || expires < 0) return 'pow_invalid';
  if (Date.now() > expires) return 'pow_expired';
  const minBits = intEnv(env.MIN_POW_BITS, 20);
  if (bits < minBits) return 'pow_weak';
  const expect = await hmacHex(env.CHALLENGE_SECRET, prefix + '|' + bits + '|' + expires + '|' + bind);
  if (!ctEqual(sig, expect)) return 'pow_invalid';
  if (usedChallenges.has(prefix)) return 'replay';
  if (env.AUTH_KV) {
    const seen = await env.AUTH_KV.get('pow:' + prefix);
    if (seen) return 'replay';
  }
  const target = Math.pow(2, 32 - bits);
  const h = await sha256Hex(prefix + nonce);
  if (hash32(h) >= target) return 'pow_invalid';
  if (usedChallenges.size > 10000) usedChallenges.clear();
  usedChallenges.add(prefix);
  if (env.AUTH_KV) {
    try { await env.AUTH_KV.put('pow:' + prefix, '1', { expirationTtl: 86400 }); } catch (e) { /* soft */ }
  }
  return null;
}

async function verifyTurnstile(env, token, ip) {
  if (!token || typeof token !== 'string') return false;
  const body = new URLSearchParams();
  body.set('secret', env.TURNSTILE_SECRET);
  body.set('response', token);
  if (ip) body.set('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: body });
    if (!r.ok) return false;
    const j = await r.json();
    return j.success === true;
  } catch (e) { return false; }
}

async function handleChallenge(request, env, url, bind) {
  const scopeMode = typeof bind === 'string' && bind.indexOf('gate:') === 0;
  let bindKey = bind;
  if (!scopeMode) {
    const email = normalizeEmail(url.searchParams.get('email'));
    if (!EMAIL_RE.test(email)) return json(env, { error: 'invalid_email', message: MSG.invalid_email }, 400);
    bindKey = email;
  }
  if (!rateLimit('challenge', clientIp(request), 60, 10 * 60 * 1000)) {
    return json(env, { error: 'rate_limited', message: MSG.rate_limited }, 429);
  }
  const bits = Math.min(intEnv(env.MIN_POW_BITS, 20), POW_MAX_BITS);
  const ttl = intEnv(env.CHALLENGE_TTL_SECONDS, 600);
  const expires = Date.now() + ttl * 1000;
  const prefix = randomHex(16);
  const target = Math.pow(2, 32 - bits);
  const sig = await hmacHex(env.CHALLENGE_SECRET, prefix + '|' + bits + '|' + expires + '|' + bindKey);
  return json(env, {
    algo: 'sha256',
    fmt: 'hash32(sha256(prefix + nonce)) < target',
    prefix: prefix,
    bits: bits,
    target: target,
    expires: expires,
    sig: sig
  });
}

/* ------------------------------------------------------------- register */

async function handleRegister(request, env) {
  if (checkOrigin(request, env)) return json(env, { error: 'forbidden_origin', message: MSG.forbidden_origin }, 403);
  if (!rateLimit('register', clientIp(request), 5, 60 * 60 * 1000)) {
    return json(env, { error: 'rate_limited', message: MSG.rate_limited }, 429);
  }
  const body = await readJson(request);
  if (!body) return json(env, { error: 'bad_request', message: MSG.bad_request }, 400);
  const email = normalizeEmail(body.email);
  if (!EMAIL_RE.test(email)) return json(env, { error: 'invalid_email', message: MSG.invalid_email }, 400);

  /* 1. the human test: server-issued, signed, single-use, re-hashed here */
  const powErr = await checkPow(env, email, body.proof);
  if (powErr) return json(env, { error: powErr, message: MSG[powErr] }, powStatus(powErr));
  if (env.TURNSTILE_SECRET) {
    const okTurn = await verifyTurnstile(env, body.turnstile, clientIp(request));
    if (!okTurn) return json(env, { error: 'turnstile_failed', message: MSG.turnstile_failed }, 403);
  }

  /* 2. already active on main? */
  let r = await gh(env, repoPath(env, email) + '?ref=main', {});
  if (r.status === 200) return json(env, { error: 'already_registered', message: MSG.already_registered }, 409);
  if (r.status !== 404) return githubError(env, r);

  /* 3. already pending? (an open register PR for this address) */
  r = await gh(env, '/repos/' + env.AUTH_DATA_REPO + '/pulls?state=open&per_page=100', {});
  if (!r.ok) return githubError(env, r);
  const pulls = await r.json();
  const open = (Array.isArray(pulls) ? pulls : []).find(function (p) { return p.title === 'register: ' + email; });
  if (open) return json(env, { ok: true, state: 'pending', pr: open.number, already: true });

  /* 4. branch reg-<stamp> from main */
  const base = await gh(env, '/repos/' + env.AUTH_DATA_REPO + '/git/ref/heads/main', {});
  if (!base.ok) return githubError(env, base);
  const baseSha = (await base.json()).object.sha;
  const branch = 'reg-' + Date.now().toString(36) + '-' + randomHex(3);
  r = await gh(env, '/repos/' + env.AUTH_DATA_REPO + '/git/refs', {
    method: 'POST',
    body: { ref: 'refs/heads/' + branch, sha: baseSha }
  });
  if (!r.ok && r.status !== 422) return githubError(env, r);

  /* 5. commit users/<email>.json with the mail token */
  const record = {
    email: email,
    verified: false,
    verifyToken: randomHex(32),
    createdAt: new Date().toISOString()
  };
  r = await gh(env, repoPath(env, email), {
    method: 'PUT',
    body: { message: 'register: ' + email, content: btoa(JSON.stringify(record)), branch: branch }
  });
  if (!r.ok) return githubError(env, r);

  /* 6. open the PR - pull_request:opened is what fires the verification mail */
  r = await gh(env, '/repos/' + env.AUTH_DATA_REPO + '/pulls', {
    method: 'POST',
    body: {
      title: 'register: ' + email,
      head: branch,
      base: 'main',
      body: 'New registration for **' + email + '**.\n\nThe verification mail is sent by Actions. Merging this PR activates the account.'
    }
  });
  if (!r.ok) return githubError(env, r);
  const pr = (await r.json()).number;
  return json(env, { ok: true, state: 'pending', pr: pr });
}

/* --------------------------------------------------------------- verify */

async function handleVerify(request, env) {
  if (checkOrigin(request, env)) return json(env, { error: 'forbidden_origin', message: MSG.forbidden_origin }, 403);
  if (!rateLimit('verify', clientIp(request), 20, 60 * 60 * 1000)) {
    return json(env, { error: 'rate_limited', message: MSG.rate_limited }, 429);
  }
  const body = await readJson(request);
  if (!body) return json(env, { error: 'bad_request', message: MSG.bad_request }, 400);
  const email = normalizeEmail(body.email);
  if (!EMAIL_RE.test(email)) return json(env, { error: 'invalid_email', message: MSG.invalid_email }, 400);
  const pr = body.pr;
  const token = String(body.token || '');
  if (!Number.isInteger(pr) || pr < 1) return json(env, { error: 'bad_request', message: MSG.bad_request }, 400);
  if (!/^[0-9a-f]{64}$/.test(token)) return json(env, { error: 'token_mismatch', message: MSG.token_mismatch }, 403);

  /* 1. the registration PR must still be open */
  let r = await gh(env, '/repos/' + env.AUTH_DATA_REPO + '/pulls/' + pr, {});
  if (r.status === 404) return json(env, { error: 'pr_not_found', message: MSG.pr_not_found }, 404);
  if (!r.ok) return githubError(env, r);
  const pull = await r.json();
  if (pull.state !== 'open') return json(env, { error: 'pr_closed', message: MSG.pr_closed }, 409);
  const head = pull.head && pull.head.ref;
  if (!head) return json(env, { error: 'pr_not_found', message: MSG.pr_not_found }, 404);

  /* 2. the record on the PR branch, not on main */
  r = await gh(env, repoPath(env, email) + '?ref=' + encodeURIComponent(head), {});
  if (r.status === 404) return json(env, { error: 'email_mismatch', message: MSG.email_mismatch }, 403);
  if (!r.ok) return githubError(env, r);
  const file = await r.json();
  let record;
  try {
    const raw = atob(String(file.content || '').replace(/\n/g, ''));
    record = JSON.parse(new TextDecoder().decode(Uint8Array.from(raw, function (c) { return c.charCodeAt(0); })));
  } catch (e) {
    return json(env, { error: 'github_error', message: MSG.github_error }, 502);
  }
  if (record.email !== email) return json(env, { error: 'email_mismatch', message: MSG.email_mismatch }, 403);
  if (!ctEqual(String(record.verifyToken || ''), token)) {
    return json(env, { error: 'token_mismatch', message: MSG.token_mismatch }, 403);
  }

  /* 3. mark verified on the PR branch */
  record.verified = true;
  record.verifiedAt = new Date().toISOString();
  r = await gh(env, repoPath(env, email), {
    method: 'PUT',
    body: { message: 'verify: ' + email, content: btoa(JSON.stringify(record)), branch: head, sha: file.sha }
  });
  if (!r.ok) return githubError(env, r);

  /* 4. merge = activation */
  r = await gh(env, '/repos/' + env.AUTH_DATA_REPO + '/pulls/' + pr + '/merge', {
    method: 'PUT',
    body: { merge_method: 'squash' }
  });
  if (!r.ok) return json(env, { error: 'merge_failed', message: MSG.merge_failed }, 502);

  /* 5. best-effort branch cleanup */
  try {
    await gh(env, '/repos/' + env.AUTH_DATA_REPO + '/git/refs/heads/' + head, { method: 'DELETE' });
  } catch (e) { /* ignore */ }

  return json(env, { ok: true, state: 'active' });
}

/* --------------------------------------------------------------- status */

async function handleStatus(request, env, url) {
  if (!rateLimit('status', clientIp(request), 120, 10 * 60 * 1000)) {
    return json(env, { error: 'rate_limited', message: MSG.rate_limited }, 429);
  }
  const email = normalizeEmail(url.searchParams.get('email'));
  if (!EMAIL_RE.test(email)) return json(env, { error: 'invalid_email', message: MSG.invalid_email }, 400);
  let r = await gh(env, repoPath(env, email) + '?ref=main', {});
  if (r.status === 200) return json(env, { ok: true, state: 'active' });
  if (r.status !== 404) return githubError(env, r);
  r = await gh(env, '/repos/' + env.AUTH_DATA_REPO + '/pulls?state=open&per_page=100', {});
  if (!r.ok) return githubError(env, r);
  const pulls = await r.json();
  const open = (Array.isArray(pulls) ? pulls : []).find(function (p) { return p.title === 'register: ' + email; });
  if (open) return json(env, { ok: true, state: 'pending', pr: open.number });
  return json(env, { ok: true, state: 'unregistered' });
}

/* ----------------------------------------------------------------- oauth */

function cookieGet(request, name) {
  const raw = request.headers.get('Cookie') || '';
  const parts = raw.split(';');
  for (let i = 0; i < parts.length; i++) {
    const idx = parts[i].indexOf('=');
    if (idx > 0 && parts[i].slice(0, idx).trim() === name) return parts[i].slice(idx + 1).trim();
  }
  return '';
}

function frontendBase(env) {
  return String(env.FRONTEND_URL || '').replace(/\/+$/, '') + '/';
}

async function handleOAuthStart(request, env, url) {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return json(env, { error: 'not_configured', message: MSG.not_configured }, 500);
  }
  const state = randomHex(16);
  const authorize = 'https://github.com/login/oauth/authorize'
    + '?client_id=' + encodeURIComponent(env.GITHUB_CLIENT_ID)
    + '&redirect_uri=' + encodeURIComponent(url.origin + '/api/auth/github/callback')
    + '&scope=' + encodeURIComponent('read:user user:email')
    + '&state=' + encodeURIComponent(state);
  return redirect(authorize, {
    'Set-Cookie': STATE_COOKIE + '=' + state + '; Max-Age=600; Path=/; Secure; HttpOnly; SameSite=Lax'
  });
}

async function handleOAuthCallback(request, env, url) {
  const frontend = frontendBase(env);
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const cookieState = cookieGet(request, STATE_COOKIE);
  const clear = { 'Set-Cookie': STATE_COOKIE + '=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax' };
  if (!code || !state || !cookieState || !ctEqual(state, cookieState)) {
    return redirect(frontend + '#error=state_mismatch', clear);
  }
  let r;
  try {
    r = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'infinity-account-auth-worker'
      },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code: code,
        redirect_uri: url.origin + '/api/auth/github/callback'
      })
    });
  } catch (e) {
    return redirect(frontend + '#error=oauth_failed', clear);
  }
  let token = '';
  try { token = (await r.json()).access_token || ''; } catch (e) { token = ''; }
  if (!r.ok || !token) return redirect(frontend + '#error=oauth_failed', clear);
  /* the token rides the fragment: it never reaches a server log */
  return redirect(frontend + '#token=' + encodeURIComponent(token), clear);
}

/* ---------------------------------------------------------------- router */

function gateScopeOk(s) { return /^[a-z][a-z0-9-]{1,23}$/.test(String(s || '')); }

function dlMap(env) {
  try {
    const j = JSON.parse(env.DL_MAP || '{}');
    return j && typeof j === 'object' ? j : {};
  } catch (e) { return {}; }
}

/* The public download surface: only the assets the site lists are reachable
 * here, everything else still needs a gate pass through /api/dl. DL_PUBLIC is
 * one variable doing two jobs - the 302 table and the catalog - because its
 * keys are asset file names and its values carry { url, size, sha256, name,
 * id }, so /api/catalog needs no second list to drift out of step. */
function dlPublic(env) {
  try {
    const j = JSON.parse(env.DL_PUBLIC || '{}');
    return j && typeof j === 'object' ? j : {};
  } catch (e) { return {}; }
}

function publicJson(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
  });
}

function htmlPage(markup, status) {
  return new Response(markup, {
    status: status || 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

/* Human verification: the site asks Turnstile for a ticket first, then presents
 * it here to collect the 302. Tickets are single-use and expire in minutes and
 * the check happens on Cloudflare's side, so a copied /dl/ link without a
 * ticket only ever reaches this page. */
/* The page a bare /dl/<asset> gets: one Turnstile widget, which returns to the
 * same address with the ticket. The download target therefore never has to be
 * written into a page. */
function gatePage(env, asset) {
  const sitekey = String(env.TURNSTILE_SITEKEY || '');
  if (!sitekey) return publicJson({ error: 'not_configured', message: MSG.not_configured }, 503);
  const action = JSON.stringify('/dl/' + encodeURIComponent(asset));
  const key = JSON.stringify(sitekey);
  const parts = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Verifying</title>',
    '<style>html,body{margin:0;height:100%;background:#0e1116;color:#e6e6ea;',
    'font:14px/1.5 system-ui,"Segoe UI",sans-serif}',
    'main{max-width:420px;margin:0 auto;padding:96px 24px}h1{font-size:16px;font-weight:600;margin:0 0 6px}',
    'p{margin:0 0 20px;color:#8b8b95}#w{min-height:65px}</style></head><body><main>',
    '<h1>Verifying…</h1><p>One quick check before the download starts.</p><div id="w"></div><p id="m"></p>',
    '</main><script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>',
    '<script>var action=', action, ';var sitekey=', key, ';',
    'function go(token){location.replace(action+"?token="+encodeURIComponent(token));}',
    'function start(){if(!window.turnstile){setTimeout(start,120);return;}',
    'turnstile.render("#w",{sitekey:sitekey,callback:go,',
    '"error-callback":function(){document.getElementById("m").textContent="Verification failed. Reload the page and try again.";},',
    '"expired-callback":function(){turnstile.reset();}});}start();</script></body></html>'
  ];
  return htmlPage(parts.join(''), 200);
}

async function handlePublicDl(request, env, url) {
  const asset = decodeURIComponent(url.pathname.slice('/dl/'.length));
  if (!/^[A-Za-z0-9._-]{1,140}$/.test(asset)) return publicJson({ error: 'bad_request', message: MSG.bad_request }, 400);
  if (!rateLimit('dlp', clientIp(request), 120, 10 * 60 * 1000)) {
    return publicJson({ error: 'rate_limited', message: MSG.rate_limited }, 429);
  }
  const row = dlPublic(env)[asset];
  const target = typeof row === 'string' ? row : (row && row.url);
  if (!target) return publicJson({ error: 'not_found', message: MSG.not_found }, 404);
  const token = String(url.searchParams.get('token') || '');
  const wantsHtml = String(request.headers.get('accept') || '').indexOf('text/html') >= 0;
  if (!token) {
    if (wantsHtml) return gatePage(env, asset);
    return publicJson({ error: 'turnstile_required', message: 'A human verification ticket (?token=) is required.' }, 403);
  }
  const passed = await verifyTurnstile(env, token, clientIp(request));
  if (!passed) {
    if (wantsHtml) return gatePage(env, asset);
    return publicJson({ error: 'turnstile_failed', message: MSG.turnstile_failed }, 403);
  }
  return redirect(target);
}

function handleCatalog(env, url) {
  const map = dlPublic(env);
  const products = Object.keys(map).sort().map(function (asset) {
    const row = map[asset];
    const o = typeof row === 'string' ? { url: row } : (row || {});
    return {
      id: o.id || '',
      name: o.name || '',
      asset: asset,
      size: Number(o.size) || 0,
      sha256: o.sha256 || '',
      url: o.url || '',
      dl: url.origin + '/dl/' + encodeURIComponent(asset)
    };
  });
  return { ok: true, version: env.CATALOG_VERSION || '', updated: env.CATALOG_UPDATED || '', products: products };
}

async function handleGate(request, env, url) {
  const scope = String(url.searchParams.get('scope') || '');
  if (!gateScopeOk(scope)) return json(env, { error: 'bad_request', message: MSG.bad_request }, 400);
  return handleChallenge(request, env, url, 'gate:' + scope);
}

async function handleGateVerify(request, env) {
  if (checkOrigin(request, env)) return json(env, { error: 'forbidden_origin', message: MSG.forbidden_origin }, 403);
  if (!rateLimit('gate', clientIp(request), 60, 10 * 60 * 1000)) {
    return json(env, { error: 'rate_limited', message: MSG.rate_limited }, 429);
  }
  const body = await readJson(request);
  if (!body) return json(env, { error: 'bad_request', message: MSG.bad_request }, 400);
  const scope = String(body.scope || '');
  if (!gateScopeOk(scope)) return json(env, { error: 'bad_request', message: MSG.bad_request }, 400);
  const powErr = await checkPow(env, 'gate:' + scope, body.proof);
  if (powErr) return json(env, { error: powErr, message: MSG[powErr] }, powStatus(powErr));
  const exp = Date.now() + intEnv(env.GATE_TTL_SECONDS, 600) * 1000;
  const rand = randomHex(4);
  const pass = 'g1.' + exp.toString(36) + '.' + rand + '.' + (await hmacHex(env.CHALLENGE_SECRET, 'gatepass|' + scope + '|' + exp + '|' + rand));
  return json(env, { ok: true, pass: pass, expires: exp });
}

async function handleDl(request, env, url) {
  if (!rateLimit('dl', clientIp(request), 30, 10 * 60 * 1000)) {
    return json(env, { error: 'rate_limited', message: MSG.rate_limited }, 429);
  }
  const scope = String(url.searchParams.get('scope') || '');
  const asset = String(url.searchParams.get('asset') || '');
  const pass = String(url.searchParams.get('pass') || '');
  const parts = pass.split('.');
  if (parts.length !== 4 || parts[0] !== 'g1' || !gateScopeOk(scope)) return json(env, { error: 'forbidden', message: MSG.forbidden }, 403);
  const exp = parseInt(parts[1], 36);
  const rand = parts[2];
  if (!Number.isFinite(exp) || Date.now() > exp) return json(env, { error: 'forbidden', message: MSG.forbidden }, 403);
  const expect = await hmacHex(env.CHALLENGE_SECRET, 'gatepass|' + scope + '|' + exp + '|' + rand);
  if (!ctEqual(parts[3], expect)) return json(env, { error: 'forbidden', message: MSG.forbidden }, 403);
  const target = dlMap(env)[asset];
  if (!target || typeof target !== 'string') return json(env, { error: 'forbidden', message: MSG.forbidden }, 403);
  return redirect(target);
}

export default {
  async fetch(request, env, ctx) {
    let url;
    try { url = new URL(request.url); } catch (e) {
      return new Response('bad url', { status: 400 });
    }
    const p = url.pathname;
    try {
      if (request.method === 'OPTIONS' && p.indexOf('/api/') === 0) return preflight(env);
      if (p === '/healthz') return json(env, { ok: true });
      if (p === '/api/challenge' && request.method === 'GET') return handleChallenge(request, env, url);
      if (p === '/api/register' && request.method === 'POST') return handleRegister(request, env);
      if (p === '/api/verify' && request.method === 'POST') return handleVerify(request, env);
      if (p === '/api/status' && request.method === 'GET') return handleStatus(request, env, url);
      if (p === '/api/gate' && request.method === 'GET') return handleGate(request, env, url);
      if (p === '/api/gate/verify' && request.method === 'POST') return handleGateVerify(request, env);
      if (p === '/api/dl' && request.method === 'GET') return handleDl(request, env, url);
      if (p === '/api/catalog' && request.method === 'GET') return publicJson(handleCatalog(env, url));
      if (p.indexOf('/dl/') === 0 && request.method === 'GET') return handlePublicDl(request, env, url);
      if (p === '/api/auth/github' && request.method === 'GET') return handleOAuthStart(request, env, url);
      if (p === '/api/auth/github/callback' && request.method === 'GET') return handleOAuthCallback(request, env, url);
      return json(env, { error: 'not_found', message: MSG.not_found }, 404);
    } catch (e) {
      console.log('worker error', e && e.stack ? e.stack : String(e));
      return json(env, { error: 'server_error', message: MSG.server_error || 'Unexpected server error.' }, 500);
    }
  }
};
