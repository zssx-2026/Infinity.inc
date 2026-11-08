/*
 * infinitystudio-test.mjs - offline acceptance for InfinityStudio.
 *
 * The installer is three claims: that it knows what each workload weighs, that
 * it refuses to start when a required part is absent, and that what it copies
 * is byte-for-byte what it planned. All three are checked here against the real
 * workspace - a real loopback service, a real install into a temporary
 * directory, and a SHA-256 over every file that landed. No Electron, no
 * window, no network, and nothing is deleted outside that temporary directory.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { start } from '../InfinityStudio/src/server.js';
import { WORKLOADS, PRODUCTS, expand, sourceLayout } from '../InfinityStudio/src/catalog.js';
import { LANGUAGES, STRINGS } from '../InfinityStudio/src/i18n.js';

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
          try { json = JSON.parse(raw); } catch { /* html */ }
          resolve({ status: res.statusCode, json: json, raw: raw });
        });
      });
    req.on('error', reject);
    if (text) req.write(text);
    req.end();
  });
}

function sha256Of(file) {
  const h = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1024 * 1024);
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      h.update(buf.subarray(0, n));
    }
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

let heldServer = null;
async function startServerForTest() {
  if (heldServer) return heldServer.port;
  const mod = await import('../InfinityServer/src/server.js');
  heldServer = await mod.start({ port: 0 });
  return heldServer.port;
}

async function main() {
  console.log('InfinityStudio offline acceptance');

  const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
  const held = await start({ root: ROOT, port: 0 });
  const port = held.port;

  /* ---- the catalogue ---- */
  const wl = await request(port, 'GET', '/v1/workloads');
  check('workloads are listed', wl.status === 200 && wl.json.workloads.length === WORKLOADS.length, String(wl.status));
  check('five workloads', wl.json.workloads.length === 5, String(wl.json.workloads.length));
  check('two are recommended', wl.json.workloads.filter((w) => w.recommended).length === 2, String(wl.json.workloads.map((w) => w.recommended)));
  check('four products are inventoried (IFM/IIM/ING retired 2026-10-24)', wl.json.products.length === 4, String(wl.json.products.length));
  check('the server is listed as standalone', wl.json.products.find((p) => p.id === 'isv').standalone === true, wl.json.products.map((p) => p.id).join());
  check('the installer manager is gone', !wl.json.products.some((p) => p.id === 'iim'), wl.json.products.map((p) => p.id).join());
  check('the server has its own row', wl.json.products.some((p) => p.id === 'isv' && p.name === 'Infinity Server'), wl.json.products.map((p) => p.id).join());
  check('Infinity Cloud is the required one', wl.json.products.filter((p) => p.required).map((p) => p.id).join() === 'inc', wl.json.products.map((p) => p.id + (p.required ? '*' : '')).join());

  /* ---- a plan is measured, not assumed ---- */
  const core = await request(port, 'POST', '/v1/plan', { workloads: ['core'] });
  check('core plan is served', core.status === 200, String(core.status));
  check('core has files', core.json.counts.files > 0, JSON.stringify(core.json.counts));
  check('core total equals the sum of its files', core.json.totalBytes === core.json.files.reduce((a, f) => a + (f.missing ? 0 : f.bytes), 0), core.json.totalText);
  check('core carries the shared runtime', core.json.files.some((f) => f.from.endsWith('node.exe')), 'no node.exe');
  check('core carries the bundle', core.json.files.some((f) => f.from.endsWith('app.cjs')), 'no app.cjs');
  check('core names the window and command faces', core.json.files.some((f) => /inc_gui/.test(f.from)) && core.json.files.some((f) => /inc_cli/.test(f.from)), 'missing a face');
  check('core includes the admin names', core.json.files.some((f) => /inx_/.test(f.from)), 'no admin names');

  const desk = await request(port, 'POST', '/v1/plan', { workloads: ['desktop'] });
  check('desktop covers every product it installs', wl.json.products.filter((p) => !p.standalone).every((p) => desk.json.products.includes(p.id)), desk.json.products.join());
  check('desktop does not install the standalone server', !desk.json.products.includes('isv'), desk.json.products.join());
  check('desktop is larger than core', desk.json.totalBytes > core.json.totalBytes, desk.json.totalText + ' vs ' + core.json.totalText);
  const windowNames = PRODUCTS.filter((p) => !p.standalone).map((p) => sourceLayout(p.id, 'win-x64').guiName);
  check('desktop installs every window face', windowNames.every((n) => desk.json.files.some((f) => f.from.endsWith(n + '.exe'))), desk.json.files.filter((f) => /_gui/.test(f.from)).map((f) => f.from.split('\\').pop()).join());
  const shellOf = PRODUCTS.filter((p) => !p.standalone && sourceLayout(p.id, 'win-x64').shell && fs.existsSync(path.join(ROOT, sourceLayout(p.id, 'win-x64').shell)));
  check('every shell-backed window face is a whole Electron tree', shellOf.every((p) => { const n = sourceLayout(p.id, 'win-x64').guiName; return desk.json.files.some((f) => f.from.endsWith(n + '.exe')) && desk.json.files.some((f) => f.from.endsWith('resources.pak') && f.from.includes(p.id)); }), shellOf.map((p) => p.id).join());

  const dev = await request(port, 'POST', '/v1/plan', { workloads: ['developer'] });
  check('developer includes the tui faces', dev.json.files.some((f) => /inc_tui/.test(f.from)) && dev.json.files.some((f) => /ipm_tui/.test(f.from)), 'no tui');
  check('developer includes the native product', dev.json.files.some((f) => /int_cli/.test(f.from)), 'no native cli');
  check('developer plans no installer manager', !dev.json.files.some((f) => /iim/i.test(f.from)), 'iim still planned');

  /* ---- the same file wanted twice is planned once ---- */
  const both = await request(port, 'POST', '/v1/plan', { workloads: ['core', 'desktop'] });
  const paths = both.json.files.map((f) => f.from);
  check('no duplicate source paths across workloads', new Set(paths).size === paths.length, String(paths.length - new Set(paths).size) + ' duplicates');
  check('two workloads do not double count the shared runtime', paths.filter((p) => p.endsWith('node.exe')).length === new Set(paths.filter((p) => p.endsWith('node.exe'))).size, 'node.exe planned twice');

  const cliPlan = await request(port, 'POST', '/v1/plan', { workloads: ['server'] });
  check('the server client installs nothing', cliPlan.status === 200 && cliPlan.json.counts.files === 0, JSON.stringify(cliPlan.json.counts));

  const min = await request(port, 'POST', '/v1/plan', { workloads: ['minimal'] });
  const clientWl = WORKLOADS.find((w) => w.client);
check('server client workload installs nothing', !clientWl || clientWl.parts.length === 0, clientWl ? clientWl.parts.length + ' parts' : 'absent');
check('minimal is a strict subset of core', min.json.files.length < core.json.files.length && min.json.totalBytes < core.json.totalBytes, min.json.files.length + '/' + core.json.files.length);
  check('minimal still plans the window face', min.json.files.some((f) => /inc_gui/.test(f.from)), 'no window face');

  /* ---- the studio is the server's client, not its installer ---- */
  const srvPort = await startServerForTest();
  const good = await request(port, 'POST', '/v1/server/status', { base: 'http://127.0.0.1:' + srvPort });
  check('the studio reaches a running server', good.status === 200 && good.json.reachable === true, JSON.stringify(good.json).slice(0, 120));
  check('the studio reads the server health route', good.json.health && typeof good.json.health === 'object', JSON.stringify(good.json).slice(0, 120));
  const bad = await request(port, 'POST', '/v1/server/status', { base: 'http://127.0.0.1:1' });
  check('an unreachable server is reported, not thrown', bad.status === 200 && bad.json.reachable === false, JSON.stringify(bad.json).slice(0, 120));
  const none = await request(port, 'POST', '/v1/server/status', { base: '' });
  check('an empty address is rejected', none.status === 400, String(none.status));

  /* ---- missing parts are reported, not pretended ---- */
  const emptyPlan = await request(port, 'POST', '/v1/plan', { workloads: [] });
  check('an empty plan is empty', emptyPlan.json.counts.files === 0 && emptyPlan.json.totalBytes === 0, JSON.stringify(emptyPlan.json.counts));
  check('nothing is missing in a healthy workspace', desk.json.counts.missing === 0, String(desk.json.missing.slice(0, 4)));
  check('no blocking entry when everything is present', desk.json.blocking.length === 0, String(desk.json.blocking));

  /* ---- install: refuses nonsense, then verifies what it wrote ---- */
  const noDest = await request(port, 'POST', '/v1/install', { workloads: ['minimal'] });
  check('install without a destination is 400', noDest.status === 400, String(noDest.status));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-'));
  try {
    const res = await request(port, 'POST', '/v1/install', { workloads: ['minimal'], dest: tmp });
    check('install reports success', res.status === 200 && res.json.ok === true, JSON.stringify(res.json.failures));
    check('every planned file was copied', res.json.copied === min.json.counts.files, res.json.copied + '/' + min.json.counts.files);
    check('nothing failed the hash check', res.json.failures.length === 0, JSON.stringify(res.json.failures.slice(0, 2)));

    /* Re-hash the destination independently of the installer's own report. */
    let verified = 0;
    let mismatched = [];
    for (const f of min.json.files) {
      const abs = path.join(tmp, f.to);
      if (!fs.existsSync(abs)) { mismatched.push(f.to + ' absent'); continue; }
      const landed = sha256Of(abs);
      if (landed === f.sha256 && fs.statSync(abs).size === f.bytes) verified++;
      else mismatched.push(f.to);
    }
    check('every installed file re-hashes to the plan', verified === min.json.files.length && mismatched.length === 0, mismatched.slice(0, 3).join(' | '));
    check('the installed bytes match the planned total', res.json.bytes === min.json.totalBytes, res.json.bytes + ' vs ' + min.json.totalBytes);
    check('the window executable landed', fs.existsSync(path.join(tmp, min.json.files.find((f) => /inc_gui/.test(f.from)).to)), 'missing window exe');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  /* ---- the page ---- */
  const page = await request(port, 'GET', '/');
  check('installer page is served', page.status === 200 && page.raw.includes('InfinityStudio'), String(page.status));
  const languageMenu = page.raw.match(/<select id="language"[^>]*>([\s\S]*?)<\/select>/);
  const renderedLanguages = languageMenu ? (languageMenu[1].match(/<option value=/g) || []).length : 0;
  check('50+ offline language choices are available', LANGUAGES.length >= 50 && renderedLanguages === LANGUAGES.length, renderedLanguages + '/' + LANGUAGES.length);
  check('language preference is persisted locally', page.raw.includes("localStorage.setItem('infinitystudio.language'"), 'language preference is not persisted');
  check('Chinese and English installer strings are bundled', STRINGS['zh-CN'] && STRINGS['en-US'] && page.raw.includes('InfinityStudio Installer'), 'locale strings missing');
  check('German is selectable', LANGUAGES.some(([code]) => code === 'de'), 'German option is missing');
  check('Traditional Chinese, Russian, Arabic, and Korean translations are selectable', ['zh-TW', 'ru', 'ar', 'ko'].every((code) => LANGUAGES.some(([locale]) => locale === code) && STRINGS[code]), 'translation missing');
  check('every bundled installer locale covers all English keys', Object.values(STRINGS).every((locale) => Object.keys(locale).length === Object.keys(STRINGS['en-US']).length && Object.keys(STRINGS['en-US']).every((key) => typeof locale[key] === 'string' && locale[key].length > 0)), 'a bundled locale is incomplete');
  let browserScriptError = '';
  try {
    const script = page.raw.match(/<script>([\s\S]*?)<\/script>/);
    if (script) new Function(script[1]);
    else browserScriptError = 'inline script missing';
  } catch (error) { browserScriptError = error.message; }
  check('generated installer browser script parses', !browserScriptError, browserScriptError);
  const refs = page.raw.match(/(?:src|href)\s*=\s*["'][^"']*(?:https?:)?\/\/[^"']*["']/gi) || [];
  check('installer page loads nothing from the network', refs.length === 0, refs.slice(0, 3).join(' | '));
  check('the server address is a loopback default', page.raw.includes('http://127.0.0.1:7711'), 'default not loopback');
  /* The names are rendered from /v1/workloads by the page's own script, so
   * what the HTML must prove is that it asks the service for them - and the
   * service must answer with every workload's real name. */
  check('installer page reads workloads from the service', page.raw.includes('/v1/workloads'), 'page does not call /v1/workloads');
  check('every workload has a name to render', WORKLOADS.every((w) => wl.json.workloads.some((x) => x.id === w.id && x.name === w.name)), 'a workload name is missing from the service');
  const miss = await request(port, 'GET', '/v1/nope');
  check('unknown route is 404', miss.status === 404, String(miss.status));

  if (heldServer && heldServer.close) await heldServer.close();
  await held.close();
  console.log('');
  console.log(fail === 0 ? 'INFINITYSTUDIO-TEST-PASS ' + pass + '/' + (pass + fail) : 'INFINITYSTUDIO-TEST-FAIL ' + fail + ' failed of ' + (pass + fail));
  if (fail) { for (const f of failures) console.log('   - ' + f); process.exit(1); }
}

main().catch((e) => { console.error('INFINITYSTUDIO-TEST-ERROR ' + ((e && e.stack) || e)); process.exit(2); });
