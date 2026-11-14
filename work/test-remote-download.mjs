import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { download, fetchCatalog, fileNameOf, probeRange, PARALLEL_MIN_BYTES } from '../InfinityStudio/src/remote.js';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' :: ' + detail : '')); }
}

const SIZE = 12 * 1024 * 1024 + 12345;
const body = crypto.randomBytes(SIZE);
const sha = crypto.createHash('sha256').update(body).digest('hex');
const hits = { range: 0, full: 0, head: 0 };

function serve(withRange) {
  return http.createServer((req, res) => {
    if (req.method === 'HEAD') {
      hits.head++;
      const h = { 'content-length': String(body.length), 'content-type': 'application/octet-stream' };
      if (withRange) h['accept-ranges'] = 'bytes';
      res.writeHead(200, h);
      res.end();
      return;
    }
    const r = req.headers.range;
    if (withRange && r) {
      hits.range++;
      const m = /bytes=(\d+)-(\d+)/.exec(r);
      const from = Number(m[1]), to = Number(m[2]);
      res.writeHead(206, { 'content-length': String(to - from + 1), 'accept-ranges': 'bytes', 'content-type': 'application/octet-stream' });
      res.end(body.subarray(from, to + 1));
      return;
    }
    hits.full++;
    res.writeHead(200, { 'content-length': String(body.length), 'content-type': 'application/octet-stream' });
    res.end(body);
  });
}

/* A host that answers one 2 MiB segment at 5 KB/s on its first try: alive,
 * never silent, and slower than the downloader's floor. The old code waited it
 * out (a 30 minute tail on a real 80 MiB setup); the segmented downloader has to
 * drop that segment and fetch it again. */
function serveSlowTail() {
  const attempts = new Map();
  const server = http.createServer((req, res) => {
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'content-length': String(body.length), 'accept-ranges': 'bytes', 'content-type': 'application/octet-stream' });
      res.end();
      return;
    }
    const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
    const from = Number(m[1]), to = Number(m[2]);
    const key = from + '-' + to;
    const n = (attempts.get(key) || 0) + 1;
    attempts.set(key, n);
    if (from === 2 * 1024 * 1024 && n === 1) {
      res.writeHead(206, { 'content-length': String(to - from + 1), 'accept-ranges': 'bytes', 'content-type': 'application/octet-stream' });
      let off = from;
      const timer = setInterval(() => {
        if (off > to) { clearInterval(timer); res.end(); return; }
        const end = Math.min(to + 1, off + 512);
        res.write(body.subarray(off, end));
        off = end;
      }, 100);
      req.on('close', () => clearInterval(timer));
      return;
    }
    res.writeHead(206, { 'content-length': String(to - from + 1), 'accept-ranges': 'bytes', 'content-type': 'application/octet-stream' });
    res.end(body.subarray(from, to + 1));
  });
  return { server: server, attempts: attempts };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

const dir = path.join(os.tmpdir(), 'infinity-remote-test-' + process.pid);
fs.mkdirSync(dir, { recursive: true });

console.log('--- ranged host ---');
let server = serve(true);
let port = await listen(server);
let url = 'http://127.0.0.1:' + port + '/InfinityProbe_1.0.0-pre8_win64_setup.exe';
let product = { asset: 'InfinityProbe-setup', name: 'Probe', url, size: SIZE, sha256: sha };

check('fileNameOf uses the asset name', fileNameOf(product) === 'InfinityProbe_1.0.0-pre8_win64_setup.exe', fileNameOf(product));
const probe = await probeRange(url);
check('probe sees ranges + size', probe.ranges === true && probe.size === SIZE, JSON.stringify(probe));

let seen = [];
const got = await download(product, { dir, onProgress: (r, t) => { if (seen.length === 0 || r > seen[seen.length - 1]) seen.push(r); } });
check('bytes match', got.bytes === SIZE, String(got.bytes));
check('sha matches', got.sha256 === sha);
check('file on disk', fs.existsSync(got.file) && fs.statSync(got.file).size === SIZE);
check('parallel used >= 4 range requests', hits.range >= 4, 'range=' + hits.range);
check('no full-body request when ranged', hits.full === 0, 'full=' + hits.full);
check('progress is monotonic and ends at size', seen[seen.length - 1] === SIZE && seen.every((v, i) => i === 0 || v >= seen[i - 1]), String(seen.length));
check('no .part left behind', !fs.existsSync(got.file + '.part'));

const again = await download(product, { dir });
check('second call is a cache hit', again.cached === true && again.sha256 === sha);
server.close();

console.log('--- host without Range ---');
hits.range = 0; hits.full = 0;
server = serve(false);
port = await listen(server);
url = 'http://127.0.0.1:' + port + '/InfinityProbe2_1.0.0-pre8_win64_setup.exe';
product = { asset: 'InfinityProbe2-setup', name: 'Probe2', url, size: SIZE, sha256: sha };
const got2 = await download(product, { dir });
check('single stream fallback works', got2.bytes === SIZE && got2.sha256 === sha, String(got2.bytes));
check('fallback made one full request', hits.full === 1, 'full=' + hits.full);
server.close();

console.log('--- bad hash is rejected ---');
server = serve(true);
port = await listen(server);
url = 'http://127.0.0.1:' + port + '/Bad_1.0.0-pre8_win64_setup.exe';
product = { asset: 'Bad-setup', name: 'Bad', url, size: SIZE, sha256: 'deadbeef' };
let threw = '';
try { await download(product, { dir }); } catch (error) { threw = String(error.message || error); }
check('sha mismatch throws and cleans up', threw.indexOf('sha256 mismatch') === 0 && !fs.existsSync(path.join(dir, 'Bad_1.0.0-pre8_win64_setup.exe')), threw);
server.close();

console.log('--- mirror is kept by the catalog ---');
server = serve(true);
port = await listen(server);
const mirrorUrl = 'http://127.0.0.1:' + port + '/Mirror_1.0.0-pre8_win64_setup.exe';
const catalogServer = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    version: '1.0.0-pre8',
    products: [{
      asset: 'Mirror-setup', id: 'mirror', name: 'Mirror', version: '1.0.0-pre8',
      size: SIZE, sha256: sha, url: 'https://example.invalid/Mirror.exe', mirror: mirrorUrl,
      /* The gate now publishes an ordered list (public proxy first, own edge
       * proxy last); the downloader has to keep that order and not need a
       * rebuild to learn about a new host. */
      mirrors: [mirrorUrl, 'https://example.invalid/second.exe', mirrorUrl]
    }]
  }));
});
const catPort = await listen(catalogServer);
const cat = await fetchCatalog('http://127.0.0.1:' + catPort);
catalogServer.close();
check('catalog keeps the mirror host', cat.products[0] && cat.products[0].mirror === mirrorUrl, JSON.stringify(cat.products[0] && cat.products[0].mirror));
check('catalog keeps the ordered mirrors list', cat.products[0] && JSON.stringify(cat.products[0].mirrors) === JSON.stringify([mirrorUrl, 'https://example.invalid/second.exe']), JSON.stringify(cat.products[0] && cat.products[0].mirrors));

console.log('--- dead primary falls through to the mirror ---');
/* A port that was just closed: connections are refused, which is what a
 * blocked release host looks like from inside the app. */
const dead = http.createServer(() => {});
const deadPort = await listen(dead);
await new Promise((r) => dead.close(r));
hits.range = 0; hits.full = 0;
/* No `mirror` field on this one: the bytes can only come from `mirrors`, so a
 * downloader that ignores the list fails here instead of at a user's desk. */
const fallbackProduct = { asset: cat.products[0].asset, name: cat.products[0].name, url: cat.products[0].url, size: SIZE, sha256: sha, mirrors: [mirrorUrl] };
const got4 = await download(fallbackProduct, { dir });
check('download succeeds via the mirror', got4.bytes === SIZE && got4.sha256 === sha, String(got4.bytes));
check('mirror served the bytes', hits.range + hits.full >= 1, 'range=' + hits.range + ' full=' + hits.full);
check('dead port really was dead', deadPort !== port, String(deadPort));
server.close();

console.log('--- a crawling segment is dropped and retried ---');
const slow = serveSlowTail();
const slowPort = await listen(slow.server);
const slowUrl = 'http://127.0.0.1:' + slowPort + '/SlowTail_1.0.0-pre8_win64_setup.exe';
const slowProduct = { asset: 'SlowTail-setup', name: 'SlowTail', url: slowUrl, size: SIZE, sha256: sha };
const slowStart = Date.now();
let slowError = '';
let slowGot = null;
try { slowGot = await download(slowProduct, { dir }); } catch (error) { slowError = String(error.message || error); }
const slowSeconds = Math.round((Date.now() - slowStart) / 1000);
const tailKey = Array.from(slow.attempts.keys()).find((k) => Number(k.split('-')[0]) === 2 * 1024 * 1024) || '';
check('slow tail still finishes', slowGot && slowGot.bytes === SIZE && slowGot.sha256 === sha, slowError || String(slowGot && slowGot.bytes));
check('slow tail was retried on a fresh request', (slow.attempts.get(tailKey) || 0) >= 2, tailKey + ' attempts=' + (slow.attempts.get(tailKey) || 0));
check('slow tail did not have to be waited out', slowSeconds < 180, slowSeconds + 's');
slow.server.close();

fs.rmSync(dir, { recursive: true, force: true });
console.log('');
console.log('REMOTE-DOWNLOAD-TEST ' + (fail === 0 ? 'PASS' : 'FAIL') + ' ' + pass + '/' + (pass + fail));
if (fail) process.exitCode = 1;
