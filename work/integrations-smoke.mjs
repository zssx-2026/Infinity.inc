/**
 * integrations-smoke.mjs - real-work smoke test for src/apps/integrations.js.
 *
 * Really signs/verifies payloads (independently recomputed with node:crypto,
 * plus an RFC 4231 known-answer vector), really writes manifest fixtures to a
 * temp dir and validates them. No mocks, no stubs.
 */
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let pass = 0, fail = 0;
function check(d, cond, e) {
  if (cond) { pass += 1; console.log('PASS ' + d); }
  else { fail += 1; console.log('FAIL ' + d + (e === undefined ? '' : ' <- ' + JSON.stringify(e))); }
}

// 缓存穿透加载（静态 import 无法拼接查询串，此处用等价的动态 import）。
let m = null;
try {
  m = (await import('file:///D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/InfinityStudio/src/apps/integrations.js?v=' + Date.now())).default;
} catch (err) {
  console.log('FAIL load module <- ' + (err && err.message ? err.message : String(err)));
  fail += 1;
}
check('module loaded with META/capabilities/plan/run', !!m && typeof m.run === 'function' && typeof m.plan === 'function' && typeof m.capabilities === 'function', m && Object.keys(m));

if (m) {
  const SECRET = 'it-is-a-test-secret-2026';
  const PAYLOAD = '{"event":"ping","n":42}';
  // 独立参照实现：冒烟脚本里直接用 node:crypto 重算，与模块实现互证。
  const expect = (alg, secret, payload) =>
    createHmac(alg, Buffer.from(secret, 'utf8')).update(Buffer.from(payload, 'utf8')).digest('hex');

  // --- sign ---
  let s = await m.run('sign', { secret: SECRET, payload: PAYLOAD });
  check('sign ok + default sha256', !!s && s.ok === true && s.algorithm === 'sha256', s);
  check('signature is 64-hex', typeof (s && s.signature) === 'string' && /^[0-9a-f]{64}$/.test(s.signature), s && s.signature);
  check('signature matches independent recompute', !!s && s.signature === expect('sha256', SECRET, PAYLOAD), s && s.signature);
  const RFC = '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843';
  let sr = await m.run('sign', { secret: 'Jefe', payload: 'what do ya want for nothing?' });
  check('sign matches RFC 4231 #2 vector', !!sr && sr.ok === true && sr.signature === RFC, sr && sr.signature);
  let s512 = await m.run('sign', { secret: SECRET, payload: PAYLOAD, algorithm: 'sha512' });
  check('sign sha512 is 128-hex', typeof (s512 && s512.signature) === 'string' && /^[0-9a-f]{128}$/.test(s512.signature), s512 && s512.signature);
  let noSecret = await m.run('sign', { payload: PAYLOAD });
  check('sign without secret -> MISSING_SECRET', !!noSecret && noSecret.ok === false && noSecret.error === 'MISSING_SECRET', noSecret);
  let noPayload = await m.run('sign', { secret: SECRET });
  check('sign without payload -> MISSING_PAYLOAD', !!noPayload && noPayload.ok === false && noPayload.error === 'MISSING_PAYLOAD', noPayload);

  // --- verify ---
  let v = await m.run('verify', { secret: SECRET, payload: PAYLOAD, signature: expect('sha256', SECRET, PAYLOAD) });
  check('verify same params -> match true', !!v && v.ok === true && v.match === true, v);
  let vt = await m.run('verify', { secret: SECRET, payload: PAYLOAD + ' ', signature: expect('sha256', SECRET, PAYLOAD) });
  check('verify tampered payload -> match false', !!vt && vt.ok === true && vt.match === false, vt);
  let vs = await m.run('verify', { secret: SECRET, payload: PAYLOAD, signature: 'deadbeef' });
  check('verify wrong-length signature -> match false, no throw', !!vs && vs.ok === true && vs.match === false, vs);
  let v512 = await m.run('verify', { secret: SECRET, payload: PAYLOAD, signature: expect('sha512', SECRET, PAYLOAD), algorithm: 'sha512' });
  check('verify sha512 -> match true', !!v512 && v512.ok === true && v512.match === true, v512);

  // --- catalog ---
  let cat = await m.run('catalog', {});
  check('catalog ok', !!cat && cat.ok === true, cat);
  check('catalog has exactly 4 kinds', !!cat && Array.isArray(cat.kinds) && cat.kinds.length === 4, cat && cat.kinds);
  let ids = new Set(((cat && cat.kinds) || []).map((k) => k.id));
  check('catalog kinds = webhook/smtp/oauth/websocket', ['webhook', 'smtp', 'oauth', 'websocket'].every((x) => ids.has(x)), Array.from(ids));
  check('every kind has non-empty fields', !!cat && cat.kinds.every((k) => Array.isArray(k.fields) && k.fields.length > 0), cat && cat.kinds);

  // --- manifest：真写合法 fixture（2 个 integration） ---
  let dir = path.join(os.tmpdir(), 'integrations-smoke-' + Date.now());
  fs.mkdirSync(dir, { recursive: true });
  let goodPath = path.join(dir, 'good.json');
  fs.writeFileSync(goodPath, JSON.stringify({
    integrations: [
      { id: 'hook-main', type: 'webhook', config: { url: 'https://example.com/hook' } },
      { id: 'mail-main', type: 'smtp', config: { host: 'smtp.example.com', port: 587 } }
    ]
  }), 'utf8');
  let mg = await m.run('manifest', { path: goodPath });
  check('valid manifest ok + issues empty + count 2', !!mg && mg.ok === true && Array.isArray(mg.issues) && mg.issues.length === 0 && mg.integrations === 2, mg);

  // --- manifest：真写非法 fixture（重复 id + 非法 type + webhook 无 url） ---
  let badPath = path.join(dir, 'bad.json');
  fs.writeFileSync(badPath, JSON.stringify({
    integrations: [
      { id: 'dup', type: 'webhook', config: { url: 'http://example.com/hook' } },
      { id: 'dup', type: 'webhook', config: {} },
      { id: 'x1', type: 'carrier-pigeon', config: {} }
    ]
  }), 'utf8');
  let mb = await m.run('manifest', { path: badPath });
  check('invalid manifest -> exactly 3 issues', !!mb && Array.isArray(mb.issues) && mb.issues.length === 3, mb && mb.issues);
  check('invalid manifest counts 3 integrations', !!mb && mb.integrations === 3, mb);

  // --- 缺失文件 ---
  let miss = await m.run('manifest', { path: path.join(dir, 'nope.json') });
  check('missing manifest -> READ_FAILED', !!miss && miss.ok === false && miss.error === 'READ_FAILED', miss);

  // --- 未知 action ---
  let unk = await m.run('ghost', {});
  check('unknown run action -> UNKNOWN_ACTION', !!unk && unk.ok === false && unk.error === 'UNKNOWN_ACTION', unk);
  let unkPlan = m.plan('ghost', {});
  check('unknown plan action -> UNKNOWN_ACTION', !!unkPlan && unkPlan.ok === false && unkPlan.error === 'UNKNOWN_ACTION', unkPlan);

  // --- plan 形状 ---
  let p = m.plan('sign', { secret: SECRET, payload: PAYLOAD });
  check('plan(sign) ok with steps + warnings', !!p && p.ok === true && Array.isArray(p.steps) && p.steps.length > 0 && Array.isArray(p.warnings), p);

  // --- capabilities / META ---
  let cap = m.capabilities();
  check('capabilities shape', !!cap && cap.implemented === true && cap.id === 'integrations' && cap.version === '1.0.0-pre5' && cap.features.length === 4 && cap.formats[0] === '.json', cap);
  check('META shape', !!m.META && m.META.id === 'integrations' && m.META.version === '1.0.0-pre5' && m.META.branch === 'integrations' && m.META.hosts.length === 4, m.META);

  // 清理临时 fixture
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

console.log('INTEGRATIONS-SMOKE-PASS ' + pass + '/' + (pass + fail));
process.exitCode = fail > 0 ? 1 : 0;
