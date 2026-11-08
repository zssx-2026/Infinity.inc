/*
 * Offline tests for the Infinity.Inc account module (task-30).
 *
 * No browser, no spawned process, no network: a localStorage stand-in and a
 * fetch stub stand in for the page, and the only files read are the module
 * under test and, for the QR cross-check, the independently written "qrcode"
 * package that ships with the harness (it is not part of the site).
 *
 *   node work/account-tests.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const core = require(path.resolve('web/infinity/assets/account.js'));
const nodeCrypto = require('node:crypto');
const oraclePath = 'D:/Program Files/DeepSeekHarness/DSH Desktop/resources/app/node_modules/qrcode';
let QR = null;
try { QR = require(oraclePath); } catch (e) { QR = null; }
let failures = 0, checks = 0;
function ok(name, pass, extra) { checks++; console.log((pass ? 'PASS ' : 'FAIL ') + name + (extra !== undefined && !pass ? '  >> ' + JSON.stringify(extra) : '')); if (!pass) failures++; }
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32decode(text) {
  let bits = 0, value = 0; const out = [];
  for (const ch of text.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
/* independent RFC 6238 implementation: what an authenticator app would show */
function nodeTotp(secretB32, ms) {
  const counter = Math.floor(ms / 1000 / 30);
  const buf = Buffer.alloc(8); buf.writeUInt32BE(Math.floor(counter / 4294967296), 0); buf.writeUInt32BE(counter >>> 0, 4);
  const h = nodeCrypto.createHmac('sha1', b32decode(secretB32)).update(buf).digest();
  const off = h[h.length - 1] & 15;
  const bin = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 1000000).padStart(6, '0');
}

const requests = [];
global.fetch = async (url, options) => { requests.push({ url: String(url), method: (options && options.method) || 'GET' }); throw new Error('offline test: no network available'); };

/* a tiny localStorage stand-in so the module uses it like a browser would */
function fakeStorage() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _dump: () => m }; }

(async function () {
  /* ---- section 1: the QR encoder against an independent implementation ---- */
  if (QR) {
    const payloads = [
      'otpauth://totp/Infinity.Inc:user@example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Infinity.Inc&algorithm=SHA1&digits=6&period=30',
      'otpauth://totp/Infinity.Inc:a.very.long.address.for.testing@subdomain.example.org?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Infinity.Inc&algorithm=SHA1&digits=6&period=30',
      'otpauth://totp/Infinity.Inc:a@b.co?secret=JBSWY3DPEHPK3PXP&issuer=Infinity.Inc',
      'HELLO',
      'A'.repeat(200)
    ];
    for (const text of payloads) {
      const mine = core.qrMatrix(text);
      const ref = QR.create([{ data: text, mode: 'byte' }], { errorCorrectionLevel: 'M', maskPattern: 0 });
      const refRows = [];
      for (let y = 0; y < ref.modules.size; y++) { let row = ''; for (let x = 0; x < ref.modules.size; x++) row += ref.modules.get(y, x) ? '1' : '0'; refRows.push(row); }
      const same = refRows.length === mine.rows.length && refRows.every((row, i) => row === mine.rows[i]);
      ok('QR ' + text.length + 'B matches the independent encoder (v' + mine.version + ', ' + mine.size + 'x' + mine.size + ')', same);
    }
  } else {
    console.log('SKIP QR cross-check: the oracle package is not installed here');
  }

  /* ---- section 2: account lifecycle, still entirely offline ---- */
  const store = fakeStorage();
  core.setStore(store);
  const PASS = 'correct horse battery staple';
  const EMAIL = 'reader@example.com';

  /* --- validation --- */
  const bad = await core.create({ email: 'not-an-email', passphrase: PASS });
  ok('create rejects a malformed address', bad.ok === false && bad.reason === 'bad-email', bad);
  const weak = await core.create({ email: EMAIL, passphrase: 'short' });
  ok('create rejects a short passphrase', weak.ok === false && weak.reason === 'weak-passphrase', weak);
  const created = await core.create({ email: EMAIL, displayName: 'Reader', passphrase: PASS });
  ok('create succeeds', created.ok === true && created.state.emailLevel === 'unverified', created);
  const again = await core.create({ email: EMAIL, passphrase: PASS });
  ok('create refuses to overwrite an existing account', again.ok === false && again.reason === 'already-exists', again);

  /* --- storage schema --- */
  const raw = JSON.parse(store.getItem(core.VAULT_KEY));
  ok('vault has PBKDF2-SHA256 with >= 200k iterations', raw.kdf.name === 'PBKDF2' && raw.kdf.hash === 'SHA-256' && raw.kdf.iterations >= 200000, raw.kdf);
  ok('vault uses AES-GCM 256', raw.cipher.name === 'AES-GCM' && raw.cipher.length === 256, raw.cipher);
  ok('salt 16 bytes / iv 12 bytes', Buffer.from(raw.kdf.salt, 'base64').length === 16 && Buffer.from(raw.cipher.iv, 'base64').length === 12);
  ok('ciphertext does not leak the plaintext', store.getItem(core.VAULT_KEY).indexOf(EMAIL) < 0);

  /* --- lock / unlock --- */
  core.lock();
  const wrong = await core.unlock('wrong passphrase entirely');
  ok('unlock rejects a wrong passphrase', wrong.ok === false && wrong.reason === 'bad-passphrase', wrong);
  const good = await core.unlock(PASS);
  ok('unlock accepts the passphrase', good.ok === true && good.state.unlocked === true, good);

  /* --- export / import --- */
  const exported = core.exportBlob();
  ok('export returns an encrypted blob', exported.ok && JSON.parse(exported.json).cipher && exported.json.indexOf(EMAIL) < 0);
  const store2 = fakeStorage();
  core.setStore(store2);
  const imported = await core.importBlob(exported.json);
  ok('import accepts the exported blob', imported.ok === true && imported.needsPassphrase === true, imported);
  const unlocked2 = await core.unlock(PASS);
  ok('imported blob unlocks with the same passphrase', unlocked2.ok === true && unlocked2.state.email === EMAIL, unlocked2);
  const broken = await core.importBlob('{"hello":1}');
  ok('import rejects a foreign JSON file', broken.ok === false && broken.reason === 'not-a-vault', broken);
  const reexport = core.exportBlob();
  await core.importBlob(exported.json);
  await core.unlock(PASS);

  /* --- B2 self-attested mail verification --- */
  const b2 = await core.b2Start();
  ok('B2 issues a 6-digit code and a mailto draft', b2.ok === true && /^[0-9]{6}$/.test(b2.code) && b2.mailto.startsWith('mailto:'), { code: b2.code });
  ok('B2 payload is signed with Ed25519', b2.alg === 'Ed25519' && (await core.verifyText(b2.spki, b2.canonical, b2.signature)) === true);
  const badCode = await core.b2Confirm('000000' === b2.code ? '111111' : '000000');
  ok('B2 rejects a wrong code', badCode.ok === false && badCode.reason === 'code-mismatch', badCode);
  const confirmed = await core.b2Confirm(b2.code);
  ok('B2 marks the address self-attested', confirmed.ok === true && confirmed.level === 'self-attested' && confirmed.selfAttest && confirmed.selfAttest.note.length > 20, { level: confirmed.level });
  const staled = await core.b2Start();
  core.qa.setClock(() => Date.now() + 16 * 60 * 1000);
  const expired = await core.b2Confirm(staled.code);
  ok('B2 code expires after 15 minutes', expired.ok === false && expired.reason === 'expired', expired);
  core.qa.resetClock();

  /* --- 2FA --- */
  const totp = await core.totpEnable();
  ok('TOTP setup returns otpauth URI, secret, QR and 10 codes', totp.ok && totp.uri.startsWith('otpauth://totp/') && totp.codes.length === 10 && totp.qr.size >= 21, { uri: totp.uri.slice(0, 60), qr: totp.qr.size });
  const opened = await core.openBlob(JSON.parse(store2.getItem(core.VAULT_KEY)), PASS);
  const openedText = JSON.stringify(opened.plain);
  ok('recovery codes are stored as SHA-256 only', totp.codes.every((c) => openedText.indexOf(c) < 0) && opened.plain.recovery.hashes.length === 10 && opened.plain.recovery.hashes.every((h) => /^[0-9a-f]{64}$/.test(h)));
  const codeNow = await core.totpNow();
  ok('totpNow produces 6 digits', /^[0-9]{6}$/.test(codeNow), codeNow);
  const wrongCode = codeNow === '000000' ? '111111' : '000000';
  const notYet = await core.totpConfirm(wrongCode);
  ok('TOTP confirm rejects a wrong code', notYet.ok === false && notYet.reason === 'code-mismatch', notYet);
  const enabled = await core.totpConfirm(codeNow);
  ok('TOTP confirm enables the second factor', enabled.ok === true);
  ok('state reports 2FA on with 10 recovery codes', (await core.state()).totpEnabled === true && (await core.state()).recoveryLeft === 10);

  /* --- login with TOTP and with a recovery code --- */
  core.lock();
  const noCode = await core.login(PASS);
  ok('login without a second factor is refused', noCode.ok === false && noCode.reason === 'second-factor-required', noCode);
  const wrongSecond = await core.login(PASS, wrongCode);
  ok('login with a wrong second factor is refused and leaves the vault locked', wrongSecond.ok === false && core.isUnlocked() === false, wrongSecond);
  const loginTotp = await core.login(PASS, nodeTotp(totp.secretB32, Date.now()));
  ok('login with a valid TOTP succeeds', loginTotp.ok === true && loginTotp.secondFactor === 'totp', loginTotp);

  core.lock();
  const loginRecovery = await core.login(PASS, totp.codes[0]);
  ok('login with a recovery code succeeds', loginRecovery.ok === true && loginRecovery.secondFactor === 'recovery', loginRecovery);
  ok('used recovery code is spent', (await core.state()).recoveryLeft === 9, (await core.state()).recoveryLeft);
  core.lock();
  const reuse = await core.login(PASS, totp.codes[0]);
  ok('a spent recovery code no longer works', reuse.ok === false, reuse.reason);
  await core.unlock(PASS);
  await core.qa.clearLock();

  /* --- five failures lock for five minutes --- */
  core.lock();
  let last = null;
  for (let i = 0; i < 5; i++) last = await core.login(PASS, wrongCode);
  ok('five wrong answers lock the account', last && last.ok === false && last.locked === true, last && last.reason);
  const locked = await core.login(PASS, nodeTotp(totp.secretB32, Date.now()));
  ok('the lock holds even with a correct TOTP code', locked.ok === false && locked.locked === true, locked.reason);
  core.lock();
  await core.unlock(PASS);
  const lockInfo = (await core.state());
  ok('lock window is 5 minutes', Math.abs(lockInfo.lockedUntil - Date.now() - 5 * 60 * 1000) < 5000, lockInfo.lockedUntil - Date.now());
  await core.qa.clearLock();
  core.lock();
  const recovered = await core.login(PASS, nodeTotp(totp.secretB32, Date.now()));
  ok('login works again after the lock is cleared', recovered.ok === true, recovered.reason);

  /* --- product file --- */
  const product = await core.exportProductFile();
  ok('product file carries trust level, public key and target path', product.ok && product.snapshot.email.trust === 'self-attested' && product.snapshot.publicKey.spki && product.snapshot.targetPath.indexOf('%LOCALAPPDATA%') === 0, product.snapshot.targetPath);
  const verifiedProduct = await core.verifyProductFile(product.json);
  ok('product file signature verifies offline', verifiedProduct.ok === true, verifiedProduct.reason);
  const tampered = JSON.parse(product.json); tampered.email.trust = 'github-verified';
  const tamperCheck = await core.verifyProductFile(tampered);
  ok('a tampered product file fails verification', tamperCheck.ok === false);

  /* --- self test and network accounting --- */
  const st = await core.selfTest();
  ok('RFC 6238/4226 vectors pass in the module self test', st.vectors.every((v) => v.ok), st.vectors.filter((v) => !v.ok));
  ok('AES-GCM round trip and wrong-passphrase rejection', st.crypto.aesGcmRoundTrip === true && st.crypto.wrongPassphraseRejected === true, st.crypto);
  ok('Ed25519 signature verifies and tamper is rejected', st.signature.verified === true && st.signature.tamperedRejected === true, st.signature);
  ok('the whole offline flow made zero network requests', requests.length === 0 && core.netlog.length === 0, requests);

  /* --- the GitHub leg: one call, to api.github.com only --- */
  core.qa.setClock(() => Date.now());
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), method: (options && options.method) || 'GET' });
    if (String(url).indexOf('api.github.com/user/emails') > -1) {
      return { ok: true, status: 200, json: async () => ([{ email: 'reader@example.com', primary: true, verified: true }, { email: 'old@example.com', primary: false, verified: false }]) };
    }
    throw new Error('CORS: no Access-Control-Allow-Origin');
  };
  await core.unlock(PASS);
  const pat = await core.b1Pat('github_pat_test', 'reader@example.com');
  ok('B1 PAT route returns a github-verified address', pat.ok === true && pat.level === 'github-verified' && pat.evidence.source === 'api.github.com/user/emails', pat);
  const device = await core.b1DeviceStart('test-client-id');
  ok('device flow failure is reported, not hidden', device.ok === false && device.reason === 'cors-or-network', device);
  const urls = core.netlog.map((e) => e.url);
  ok('only github endpoints were ever contacted', urls.every((u) => u.indexOf('https://api.github.com/') === 0 || u.indexOf('https://github.com/login/') === 0), urls);
  ok('device flow request is logged with its failure reason', core.netlog.some((e) => e.url.indexOf('github.com/login/device/code') > -1 && !!e.error), core.netlog);

  /* ---- optional Gist sync: ciphertext only, api.github.com only ---- */
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url: String(url), method: (options && options.method) || 'GET', body: options && options.body });
    if (String(url).indexOf('api.github.com/gists') > -1 && ((options && options.method) || 'GET') === 'POST') {
      return { ok: true, status: 201, json: async () => ({ id: 'gist123', html_url: 'https://gist.github.com/gist123' }) };
    }
    if (String(url).indexOf('api.github.com/gists/gist123') > -1) {
      return { ok: true, status: 200, json: async () => ({ files: { 'infinity-account.encrypted.json': { content: store2.getItem(core.VAULT_KEY), truncated: false } } }) };
    }
    throw new Error('unexpected ' + url);
  };
  await core.unlock(PASS);
  const pushed = await core.syncPush('github_pat_sync');
  ok('sync push writes a private Gist and returns its id', pushed.ok === true && pushed.gistId === 'gist123' && pushed.encryptedOnly === true, pushed);
  ok('sync push uploads ciphertext only (no plaintext address)', seen[0].body.indexOf(EMAIL) < 0 && seen[0].body.indexOf('cipher') > -1, seen[0].body.slice(0, 80));
  ok('sync goes to api.github.com/gists only', seen.every((r) => r.url.indexOf('https://api.github.com/gists') === 0), seen.map((r) => r.url));
  const pulled = await core.syncPull('github_pat_sync');
  ok('sync pull imports the vault and asks for the passphrase', pulled.ok === true && pulled.needsPassphrase === true, pulled);
  const afterPull = await core.unlock(PASS);
  ok('the pulled vault unlocks', afterPull.ok === true && afterPull.state.email === EMAIL, afterPull.reason);

  console.log('');
  console.log(failures === 0 ? 'ALL ' + checks + ' ACCOUNT CHECKS PASS' : failures + ' of ' + checks + ' CHECKS FAILED');
  process.exit(failures === 0 ? 0 : 1);
})();
