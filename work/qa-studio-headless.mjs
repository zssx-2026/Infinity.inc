/* Headless end-to-end check of the Studio remote installer.
 *
 * No window is created at any point: the Studio service is started through its
 * command-line face, driven over loopback HTTP, and the numbers printed here are
 * the ones the service itself reports. This is the test that failed before --
 * the download died at 454,730 B and took the process with it -- so it asserts
 * progress moves past that point and the service is still answering afterwards.
 */
const port = Number(process.argv[2] || 7799);
const asset = process.argv[3] || 'InfinityServer-setup';
const base = 'http://127.0.0.1:' + port;

async function getJson(pathname) {
  const res = await fetch(base + pathname, { signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  if (!res.ok) throw new Error(pathname + ' -> HTTP ' + res.status + ' ' + text.slice(0, 200));
  return JSON.parse(text);
}

const remote = await getJson('/v1/remote');
const products = (remote.catalog && remote.catalog.products) || [];
console.log('catalog base=' + remote.base + ' products=' + products.length);
for (const p of products) console.log('  ' + p.asset + ' ' + p.size + ' ' + p.sha256.slice(0, 12));

const started = Date.now();
const post = await fetch(base + '/v1/remote/install', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ ids: [asset] }),
  signal: AbortSignal.timeout(20000)
});
console.log('install POST -> HTTP ' + post.status + ' ' + (await post.text()).slice(0, 200));

let last = '';
let peak = 0;
let outcome = null;
let idle = 0;
for (let i = 0; i < 1500; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  let data;
  try {
    data = await getJson('/v1/remote/state');
  } catch (error) {
    console.log('service stopped answering after ' + Math.round((Date.now() - started) / 1000) + 's: ' + error.message);
    process.exit(1);
  }
  const state = data.state || data;
  const line = (state.phase || '?') + ' ' + (state.received || 0) + '/' + (state.expected || 0);
  if (line !== last) {
    console.log('  t=' + Math.round((Date.now() - started) / 1000) + 's ' + line);
    last = line;
  }
  peak = Math.max(peak, state.received || 0);
  if (state.phase === 'done' || state.phase === 'failed') { outcome = state; break; }
  idle = (state.received || 0) > 0 ? 0 : idle + 1;
  if (idle > 300) { console.log('no progress for 300 s'); process.exit(1); }
}

const seconds = Math.round((Date.now() - started) / 1000);
console.log('peak_received=' + peak + ' seconds=' + seconds);
if (!outcome) { console.log('STUDIO-HEADLESS FAIL no terminal state'); process.exit(1); }
for (const line of outcome.log || []) console.log('  log: ' + (line && typeof line === 'object' ? line.text : line));
const result = (outcome.results || [])[0] || {};
console.log('phase=' + outcome.phase + ' ok=' + result.ok + ' code=' + result.code + ' error=' + (outcome.error || 'none'));
const pass = outcome.phase === 'done' && result.ok === true && peak > 454730;
console.log('STUDIO-HEADLESS ' + (pass ? 'PASS' : 'FAIL') + ' asset=' + asset + ' seconds=' + seconds);
process.exit(pass ? 0 : 1);
