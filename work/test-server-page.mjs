/*
 * test-server-page.mjs - the dashboard has to render real numbers, headless.
 *
 * The console is the same page the Electron window shows, so asserting on the
 * HTML is asserting on the window: no browser, no window, no screenshot.
 * The bug this guards: /v1/health used to omit rack.coresPerNode, so the page
 * rendered "8 节点 x undefined 核".
 */
import { start } from '../InfinityServer/src/server.js';

const checks = [];
const ok = (name, pass, detail) => checks.push({ name, pass, detail });

const { port, close } = await start({ port: 0 });
let html = '', health = '', cacheStats = '', verify = '';
try {
  const r = await fetch('http://127.0.0.1:' + port + '/');
  ok('GET / status 200', r.status === 200, r.status);
  html = await r.text();
  ok('page has brand', /InfinityServer/.test(html), html.length + ' bytes');
  ok('page has no "undefined"', !/undefined/.test(html), (html.match(/undefined/g) || []).length + ' hit(s)');
  // The rack id is not baked into the markup: the page fetches /v1/health and
  // paints it. So the honest assertion is that the markup wires that call up.
  ok('page wires /v1/health', /\/v1\/health/.test(html), '');
  const h = await fetch('http://127.0.0.1:' + port + '/v1/health');
  ok('GET /v1/health 200', h.status === 200, h.status);
  health = await h.text();
  const j = JSON.parse(health);
  const rack = j.rack && j.rack.rack;
  ok('health has rack.rack', !!rack, rack ? 'ok' : 'missing');
  ok('coresPerNode present', rack && typeof rack.coresPerNode === 'number', rack && rack.coresPerNode);
  ok('cores === nodes * coresPerNode', rack && rack.cores === rack.nodes * rack.coresPerNode, rack ? rack.cores + ' vs ' + rack.nodes + '*' + rack.coresPerNode : '');
  ok('health has no undefined', !/undefined/.test(health), '');
  const cs = await fetch('http://127.0.0.1:' + port + '/v1/cache/stats');
  cacheStats = await cs.text();
  ok('cache tiers present', /"tiers"/.test(cacheStats) && JSON.parse(cacheStats).tiers.length >= 6, (JSON.parse(cacheStats).tiers || []).length + ' tiers');
  const v = await fetch('http://127.0.0.1:' + port + '/v1/verify');
  verify = await v.text();
  ok('verify chain ok', JSON.parse(verify).ok === true, verify);
} finally {
  await close();
}

const failed = checks.filter((c) => !c.pass);
for (const c of checks) console.log((c.pass ? 'ok   ' : 'FAIL ') + c.name + (c.detail !== '' && c.detail !== undefined ? '  [' + c.detail + ']' : ''));
console.log('SERVER-PAGE ' + (failed.length ? 'FAIL' : 'PASS') + ' ' + (checks.length - failed.length) + '/' + checks.length);
process.exitCode = failed.length ? 1 : 0;
