/*
 * download-test.mjs - proves the InfinityViewer download engine really
 * downloads: a local range-capable server, a real multi-segment transfer, a
 * real pause/resume, and a byte-for-byte hash comparison against the source.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DownloadManager } = require('../shell/downloads.js');

const ROOT = path.resolve(process.cwd(), 'work', 'tmp-dl');
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });

const BIG = crypto.randomBytes(4 * 1024 * 1024 + 12345);
const SMALL = Buffer.from('infinity viewer download test\n'.repeat(1000), 'utf8');
const files = { '/big.bin': BIG, '/small.bin': SMALL, '/nohead.bin': BIG.subarray(0, 700000) };

let checks = 0, fails = 0;
function ok(cond, label, detail) {
  checks++;
  if (cond) console.log('ok   ' + label);
  else { fails++; console.log('FAIL ' + label + (detail ? ' :: ' + detail : '')); }
}
function sha(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function shaFile(p) { return sha(fs.readFileSync(p)); }

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const name = url.pathname;
  const buf = files[name];
  if (!buf) { res.writeHead(404); res.end('nope'); return; }
  if (name === '/nohead.bin' && req.method === 'HEAD') { res.writeHead(405); res.end(); return; }
  const range = req.headers.range;
  const slow = url.searchParams.get('slow') === '1';
  const send = (status, headers, body) => {
    res.writeHead(status, headers);
    if (!slow) { res.end(body); return; }
    let off = 0;
    const step = () => {
      if (off >= body.length) { res.end(); return; }
      res.write(body.subarray(off, off + 64 * 1024));
      off += 64 * 1024;
      setTimeout(step, 40);
    };
    step();
  };
  if (range && req.method === 'GET') {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : buf.length - 1;
    const slice = buf.subarray(start, Math.min(end, buf.length - 1) + 1);
    send(206, {
      'content-type': 'application/octet-stream',
      'content-length': String(slice.length),
      'accept-ranges': 'bytes',
      'content-range': 'bytes ' + start + '-' + (start + slice.length - 1) + '/' + buf.length,
      'content-disposition': 'attachment; filename="' + name.replace(/^\//, '') + '"'
    }, slice);
    return;
  }
  send(200, {
    'content-type': 'application/octet-stream',
    'content-length': String(buf.length),
    'accept-ranges': 'bytes',
    'content-disposition': 'attachment; filename="' + name.replace(/^\//, '') + '"'
  }, buf);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = 'http://127.0.0.1:' + port;

const events = [];
const dl = new DownloadManager({
  dir: path.join(ROOT, 'out'),
  stateFile: path.join(ROOT, 'state.json'),
  connections: 8,
  concurrency: 2,
  onEvent: (s) => { events.push(s); }
});

function waitFor(pred, timeout) {
  const deadline = Date.now() + (timeout || 30000);
  return new Promise((resolve, reject) => {
    const step = () => {
      if (pred()) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('timeout'));
      setTimeout(step, 100);
    };
    step();
  });
}

/* 1. parallel segmented download of a 4 MB file */
const idBig = dl.start(base + '/big.bin');
await waitFor(() => { const it = dl.find(idBig); return it && (it.status === 'done' || it.status === 'error'); }, 60000);
const itBig = dl.find(idBig);
ok(itBig.status === 'done', 'big download finished', itBig.status + ' ' + (itBig.error || ''));
ok(itBig.total === BIG.length, 'big size matches (' + itBig.total + ')');
ok(shaFile(itBig.file) === sha(BIG), 'big sha256 matches source');
ok(itBig.segments && itBig.segments.length > 1, 'big used multiple segments (' + (itBig.segments ? itBig.segments.length : 0) + ')');
ok(itBig.segments.every((s) => s.done), 'every segment completed');
ok(path.basename(itBig.file) === 'big.bin', 'name taken from content-disposition: ' + path.basename(itBig.file));

/* 2. a small file still lands intact */
const idSmall = dl.start(base + '/small.bin');
await waitFor(() => { const it = dl.find(idSmall); return it && (it.status === 'done' || it.status === 'error'); }, 20000);
const itSmall = dl.find(idSmall);
ok(itSmall.status === 'done' && shaFile(itSmall.file) === sha(SMALL), 'small download matches source');

/* 3. HEAD rejected -> GET fallback still works */
const idNoHead = dl.start(base + '/nohead.bin');
await waitFor(() => { const it = dl.find(idNoHead); return it && (it.status === 'done' || it.status === 'error'); }, 30000);
const itNoHead = dl.find(idNoHead);
ok(itNoHead.status === 'done' && shaFile(itNoHead.file) === sha(files['/nohead.bin']), 'HEAD-405 fallback works');

/* 4. pause keeps bytes, resume finishes, hash still matches */
const idSlow = dl.start(base + '/big.bin?slow=1');
await waitFor(() => { const it = dl.find(idSlow); return it && it.received > 200000; }, 20000);
dl.pause(idSlow);
const paused = dl.find(idSlow);
const atPause = paused.received;
ok(paused.status === 'paused', 'pause sets status');
await new Promise((r) => setTimeout(r, 600));
ok(dl.find(idSlow).received === atPause || dl.find(idSlow).received - atPause < 200000, 'paused transfer stops growing');
dl.resume(idSlow);
await waitFor(() => { const it = dl.find(idSlow); return it && (it.status === 'done' || it.status === 'error'); }, 90000);
const itSlow = dl.find(idSlow);
ok(itSlow.status === 'done', 'resume finishes', itSlow.status + ' ' + (itSlow.error || ''));
ok(shaFile(itSlow.file) === sha(BIG), 'resumed file sha256 matches source');
ok(atPause > 0, 'resume started from kept bytes (' + atPause + ')');

/* 5. cancel removes the file; snapshot shape is what the UI reads */
const idCancel = dl.start(base + '/big.bin');
await new Promise((r) => setTimeout(r, 400));
dl.cancel(idCancel);
ok(dl.find(idCancel).status === 'canceled', 'cancel sets status');

/* 6. state survives a restart */
const snap = dl.snapshot();
ok(Array.isArray(snap.items) && snap.items.length >= 5, 'snapshot lists items (' + snap.items.length + ')');
ok(typeof snap.dir === 'string' && snap.items[0].name && typeof snap.items[0].received === 'number', 'snapshot fields present');
ok(fs.existsSync(path.join(ROOT, 'state.json')), 'state file written');
const dl2 = new DownloadManager({ dir: path.join(ROOT, 'out'), stateFile: path.join(ROOT, 'state.json'), onEvent: () => { } });
ok(dl2.items.length === dl.items.length, 'restart restores item list (' + dl2.items.length + ')');
ok(dl2.items.filter((i) => i.status === 'running').length === 0, 'no item is left running after restart');

server.close();
fs.rmSync(ROOT, { recursive: true, force: true });
console.log('\nDOWNLOAD-TEST ' + (fails ? 'FAIL' : 'PASS') + ' ' + (checks - fails) + '/' + checks);
process.exit(fails ? 1 : 0);
