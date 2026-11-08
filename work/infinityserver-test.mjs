/*
 * infinityserver-test.mjs - offline acceptance for InfinityServer.
 *
 * Everything here runs in-process: the service is started on a loopback port,
 * every route is exercised, the invariants of chapter 10 are checked against
 * live state, and the Turing embedding of chapter 12 is verified by running
 * the same machine twice - once as a plain machine, once with its tape in
 * cache blocks. No network, no Electron, no window.
 */

import http from 'node:http';
import { start } from '../InfinityServer/src/server.js';
import { feeOf } from '../InfinityServer/src/core/billing.js';
import { resolveConfig, sizeFactor, priorityFactor } from '../InfinityServer/src/core/config.js';
import { LANGUAGES, STRINGS } from '../InfinityServer/src/i18n.js';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; failures.push(name + (detail ? ' -> ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' -> ' + detail : '')); }
}

function request(port, method, p, body) {
  return new Promise((resolve, reject) => {
    const text = body == null ? null : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: port, path: p, method: method,
      headers: text ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) } : {} },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(raw); } catch { /* html or plain text */ }
          resolve({ status: res.statusCode, json: json, raw: raw });
        });
      });
    req.on('error', reject);
    if (text) req.write(text);
    req.end();
  });
}

async function main() {
  console.log('InfinityServer offline acceptance');

  /* ---- the fee formula, checked against hand arithmetic ---- */
  const cfg = resolveConfig({});
  const f1 = feeOf(cfg, { level: 6, bodySize: 512, priority: 'normal' });
  check('fee L6/512B/normal = 0.000256', Math.abs(f1.fee - 0.000001 * 256 * 1.0 * 1.0) < 1e-15, String(f1.fee));
  const f2 = feeOf(cfg, { level: 1, bodySize: 512, priority: 'high' });
  check('fee L1/512B/high = 0.0000015', Math.abs(f2.fee - 0.000001 * 1 * 1.0 * 1.5) < 1e-15, String(f2.fee));
  const f3 = feeOf(cfg, { level: 4, bodySize: 4096, priority: 'low' });
  check('fee L4/4096B/low applies size factor 4', Math.abs(f3.fee - 0.000001 * 16 * 4 * 0.5) < 1e-15, String(f3.fee));
  check('sizeFactor at the limit is 1.0', sizeFactor(1024) === 1.0, String(sizeFactor(1024)));
  check('priorityFactor high/normal/low', priorityFactor('high') === 1.5 && priorityFactor('normal') === 1.0 && priorityFactor('low') === 0.5);

  const held = await start({ port: 0 });
  const port = held.port;
  console.log('  (service on 127.0.0.1:' + port + ')');

  /* ---- pipeline: cold load bills at L6, warm read hits the same tier ---- */
  const r1 = await request(port, 'POST', '/v1/request', { key: 'k1', body: 'hello', userId: 'u1' });
  check('POST /v1/request ok', r1.status === 200 && r1.json.ok === true, String(r1.status));
  check('cold load is a miss at L6', r1.json.cache.hit === false && r1.json.cache.level === 6, JSON.stringify(r1.json.cache));
  check('cold load bills the L6 weight', Math.abs(r1.json.billing.fee - 0.000256) < 1e-12, String(r1.json.billing.fee));
  const r2 = await request(port, 'POST', '/v1/request', { key: 'k1', body: 'hello', userId: 'u1' });
  check('second read is a hit', r2.json.cache.hit === true, JSON.stringify(r2.json.cache));
  check('version survives the read', r2.json.cache.version >= 1, String(r2.json.cache.version));

  /* ---- migration: a hot block climbs ---- */
  let last = null;
  for (let i = 0; i < 140; i++) last = await request(port, 'POST', '/v1/request', { key: 'hot', body: 'warm', userId: 'u1' });
  check('a hot block migrates above L6', last.json.cache.level < 6, 'level=' + last.json.cache.level);

  /* ---- chapter 8: refused requests are not billed ---- */
  const before = held.engine.billing.events.length;
  const big = await request(port, 'POST', '/v1/request', { key: 'big', body: 'x'.repeat(4096), userId: 'u1' });
  check('oversized body refused', big.status === 200 && big.json.ok === false && big.json.refused === 'body-too-large', JSON.stringify(big.json));
  const noAuth = await request(port, 'POST', '/v1/request', { key: 'sec', body: 'hi', userId: 'nobody' });
  const engine2 = held.engine;
  engine2.users.clear();
  (engine2.cfg).security = { allowAnonymous: false };
  const denied = await request(port, 'POST', '/v1/request', { key: 'sec2', body: 'hi', userId: 'nobody' });
  check('unauthorized refused', denied.json.ok === false && denied.json.refused === 'unauthorized', JSON.stringify(denied.json));
  const after = held.engine.billing.events.length;
  check('refusals are not billed', after === before + (noAuth.json && noAuth.json.ok ? 1 : 0), 'before=' + before + ' after=' + after);
  delete (engine2.cfg).security;

  /* ---- prefetch ---- */
  const hintLow = await request(port, 'POST', '/v1/cache/hint', { key: 'p-low', probability: 0.2, data: 'd', bytes: 1 });
  check('prefetch below threshold is ignored', hintLow.json.prefetched === false, JSON.stringify(hintLow.json));
  const hintHigh = await request(port, 'POST', '/v1/cache/hint', { key: 'p-high', probability: 0.9, data: 'd', bytes: 1 });
  check('prefetch at/above threshold lands in L4', hintHigh.json.prefetched === true && held.engine.cache.get('p-high').level === 4, JSON.stringify(hintHigh.json));

  /* ---- pool and policy ---- */
  const pool = await request(port, 'GET', '/v1/resource/pool');
  check('GET /v1/resource/pool', pool.status === 200 && pool.json.nodes === 8, JSON.stringify(pool.json));
  const scaled = await request(port, 'POST', '/v1/resource/scale', { delta: 2 });
  check('POST /v1/resource/scale adds nodes', scaled.json.scaled.to === 10, JSON.stringify(scaled.json.scaled));
  const pol = await request(port, 'PUT', '/v1/schedule/policy', { replicas: 3 });
  check('PUT /v1/schedule/policy', pol.json.policy.replicas === 3, JSON.stringify(pol.json.policy));
  await request(port, 'POST', '/v1/resource/scale', { delta: -2 });

  /* ---- billing chain ---- */
  const sum = await request(port, 'GET', '/v1/billing/summary');
  check('billing summary has events', sum.json.events > 0, JSON.stringify(sum.json.events));
  const ev = await request(port, 'GET', '/v1/billing/events?limit=5');
  check('every event carries prev_hash and merkle_root',
    ev.json.events.every((e) => typeof e.prev_hash === 'string' && e.prev_hash.length === 64 && typeof e.merkle_root === 'string'),
    JSON.stringify(ev.json.events[0]));
  const ver = await request(port, 'GET', '/v1/verify');
  check('GET /v1/verify chain intact', ver.json.chain && ver.json.chain.ok === true, JSON.stringify(ver.json));
  check('no capacity invariant violated', ver.json.ok === true, JSON.stringify(ver.json.problems));

  /* ---- chapter 12: the embedding ---- */
  for (const [machine, tape, want] of [['binary-increment', '1011', '1100'], ['binary-increment', '1111', '10000'], ['equal-zero-one', '0011', null], ['equal-zero-one', '00111', null]]) {
    const t = await request(port, 'POST', '/v1/turing/run', { machine: machine, tape: tape, maxSteps: 5000 });
    check('turing ' + machine + '(' + tape + ') agrees on rack and off', t.json.ok === true, JSON.stringify(t.json));
    if (want) check('  tape is ' + want, t.json.rack.tape === want, t.json.rack.tape + ' vs ' + t.json.plain.tape);
  }
  const bad = await request(port, 'POST', '/v1/turing/run', { machine: 'nope', tape: '1' });
  check('unknown machine is 404', bad.status === 404, String(bad.status));

  /* ---- the dashboard ---- */
  const page = await request(port, 'GET', '/');
  check('dashboard is served', page.status === 200 && page.raw.includes('InfinityServer'), String(page.status));
  const languageMenu = page.raw.match(/<select id="language"[^>]*>([\s\S]*?)<\/select>/);
  const renderedLanguages = languageMenu ? (languageMenu[1].match(/<option value=/g) || []).length : 0;
  check('50+ offline language choices are available', LANGUAGES.length >= 50 && renderedLanguages === LANGUAGES.length, renderedLanguages + '/' + LANGUAGES.length);
  check('language preference is persisted locally', page.raw.includes("localStorage.setItem('infinityserver.language'"), 'language preference is not persisted');
  check('Chinese and English dashboard strings are bundled', STRINGS['zh-CN'] && STRINGS['en-US'] && page.raw.includes('Rack Console'), 'locale strings missing');
  check('German is selectable', LANGUAGES.some(([code]) => code === 'de'), 'German option is missing');
  check('Traditional Chinese, Russian, Arabic, and Korean translations are selectable', ['zh-TW', 'ru', 'ar', 'ko'].every((code) => LANGUAGES.some(([locale]) => locale === code) && STRINGS[code]), 'translation missing');
  check('every bundled dashboard locale covers all English keys', Object.values(STRINGS).every((locale) => Object.keys(locale).length === Object.keys(STRINGS['en-US']).length && Object.keys(STRINGS['en-US']).every((key) => typeof locale[key] === 'string' && locale[key].length > 0)), 'a bundled locale is incomplete');
  let browserScriptError = '';
  try {
    const script = page.raw.match(/<script>([\s\S]*?)<\/script>/);
    if (script) new Function(script[1]);
    else browserScriptError = 'inline script missing';
  } catch (error) { browserScriptError = error.message; }
  check('generated dashboard browser script parses', !browserScriptError, browserScriptError);
  check('dashboard has no external reference', page.raw.indexOf('http://') === -1 && page.raw.indexOf('https://') === -1, 'external ref found');
  const miss = await request(port, 'GET', '/v1/nope');
  check('unknown route is 404', miss.status === 404, String(miss.status));

  /* ---- capacity invariant under load ---- */
  for (let i = 0; i < 200; i++) await request(port, 'POST', '/v1/request', { key: 'load:' + (i % 40), body: 'b'.repeat(64), userId: 'u2' });
  const ver2 = await request(port, 'GET', '/v1/verify');
  check('invariants hold after 200 requests', ver2.json.ok === true, JSON.stringify(ver2.json.problems));
  const st = held.engine.stats();
  check('hit rate is reported', st.requests.hitRate >= 0 && st.requests.hitRate <= 1, String(st.requests.hitRate));
  check('every tier is within capacity', st.cache.tiers.every((t) => t.usageBytes <= t.capacityBytes), JSON.stringify(st.cache.tiers.map((t) => t.id + ':' + t.usageBytes + '/' + t.capacityBytes)));

  await held.close();
  console.log('');
  console.log(fail === 0 ? 'INFINITYSERVER-TEST-PASS ' + pass + '/' + (pass + fail) : 'INFINITYSERVER-TEST-FAIL ' + fail + ' failed of ' + (pass + fail));
  if (fail) { for (const f of failures) console.log('   - ' + f); process.exit(1); }
}

main().catch((e) => { console.error('INFINITYSERVER-TEST-ERROR ' + ((e && e.stack) || e)); process.exit(2); });
