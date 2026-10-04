import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
function opt(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith('--')) return true;
  return v;
}

const ROOT = path.resolve(String(opt('root', 'D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/history')));
const OUT = path.resolve(String(opt('out', path.join(ROOT, 'history.jsonl'))));
const TMP = OUT + '.pack';
const MANIFEST = path.resolve(String(opt('manifest', path.join(here, 'history-manifest.json'))));
const CHUNK = Math.round(Number(opt('chunk-mb', 16)) * 1048576);
const QUALITY = Number(opt('quality', 11));
const LGWIN = Number(opt('lgwin', 24));
let WORKERS = Number(opt('workers', 8));
{
  const freeGB = os.freemem() / 1073741824;
  const cap = Math.max(2, Math.floor(freeGB / 0.35));
  if (WORKERS > cap) { console.log('[mem-guard] free=' + freeGB.toFixed(2) + 'GB, workers ' + WORKERS + ' -> ' + cap); WORKERS = cap; }
}
const BATCH = Math.round(Number(opt('batch-mb', 128)) * 1048576);
const HEADER_BYTES = 4096;
const QUIET = !!opt('quiet', false);

const t0 = Date.now();
const log = (...a) => { if (!QUIET) console.log('[' + ((Date.now() - t0) / 1000).toFixed(1) + 's]', ...a); };

// ---------- 1. walk ----------
const sources = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.isFile()) {
      if (path.resolve(p) === TMP) continue;
      const st = fs.statSync(p);
      sources.push({ p, rel: path.relative(ROOT, p).split(path.sep).join('/'), size: st.size, mtime: Math.round(st.mtimeMs) });
    }
  }
})(ROOT);
sources.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
let totalBytes = 0;
for (const s of sources) totalBytes += s.size;
log('walked', sources.length, 'files,', (totalBytes / 1048576).toFixed(1), 'MB');

// ---------- 2. hash + classify ----------
const HASH_BUF = Buffer.allocUnsafe(1 << 20);
function sha256(p) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(p, 'r');
  try {
    let n;
    while ((n = fs.readSync(fd, HASH_BUF, 0, HASH_BUF.length, null)) > 0) h.update(HASH_BUF.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}
const utf8 = new TextDecoder('utf-8', { fatal: true });
function looksText(p) {
  const fd = fs.openSync(p, 'r');
  const b = Buffer.alloc(65536);
  let n = 0;
  try { n = fs.readSync(fd, b, 0, 65536, 0); } finally { fs.closeSync(fd); }
  const s = b.subarray(0, n);
  if (s.includes(0)) return false;
  try { utf8.decode(s); return true; } catch { return false; }
}
const byHash = new Map();
let done = 0;
for (const s of sources) {
  s.h = sha256(s.p);
  let b = byHash.get(s.h);
  if (!b) { b = { h: s.h, size: s.size, rep: s, files: [] }; byHash.set(s.h, b); }
  b.files.push(s);
  if (++done % 5000 === 0) log('hashed', done, '/', sources.length);
}
const blobs = [...byHash.values()];
for (const b of blobs) b.text = looksText(b.rep.p);
blobs.sort((a, b) => (a.text !== b.text) ? (a.text ? -1 : 1) : (a.rep.rel < b.rep.rel ? -1 : a.rep.rel > b.rep.rel ? 1 : 0));
const uniqueBytes = blobs.reduce((a, b) => a + b.size, 0);
log('hashed all:', byHash.size, 'unique blobs,', (uniqueBytes / 1048576).toFixed(1), 'MB unique; dup saved', ((totalBytes - uniqueBytes) / 1048576).toFixed(1), 'MB');

// manifest for independent cross-check
fs.writeFileSync(MANIFEST, JSON.stringify({
  root: ROOT, created: new Date().toISOString(), files: sources.length, bytes: totalBytes,
  blobs: blobs.length, uniqueBytes,
  entries: sources.map(s => ({ p: s.rel, s: s.size, m: s.mtime, h: s.h })),
}));

// ---------- 3. worker pool ----------
function makePool(n) {
  const workers = [];
  const idle = [];
  const queue = [];
  let seq = 0;
  const pending = new Map();
  let closed = false;
  function drain() {
    while (queue.length && idle.length) {
      const w = idle.pop();
      const job = queue.shift();
      const id = ++seq;
      pending.set(id, job);
      const transfer = job.buf.byteOffset === 0 && job.buf.byteLength === job.buf.buffer.byteLength ? [job.buf.buffer] : [];
      w.postMessage({ id, buf: job.buf, quality: QUALITY, lgwin: LGWIN }, transfer);
    }
  }
  for (let i = 0; i < n; i++) {
    const w = new Worker(new URL('./hist-br.mjs', import.meta.url));
    w.on('message', (m) => {
      const job = pending.get(m.id);
      if (job) { pending.delete(m.id); idle.push(w); job.resolve(m); drain(); }
    });
    w.on('error', (e) => {
      for (const job of pending.values()) job.reject(e);
      pending.clear();
      if (!closed) console.error('worker error:', e);
    });
    workers.push(w); idle.push(w);
  }
  return {
    run(buf) { return new Promise((resolve, reject) => { queue.push({ buf, resolve, reject }); drain(); }); },
    close() { closed = true; for (const w of workers) w.terminate(); },
  };
}
const pool = makePool(WORKERS);

// ---------- 4. pack bytes into chunks, compress in batches ----------
const outFd = fs.openSync(TMP, 'w');
const hdr = Buffer.alloc(HEADER_BYTES, 0x20); hdr[HEADER_BYTES - 1] = 0x0a;
fs.writeSync(outFd, hdr);
let outBytes = HEADER_BYTES;

let cur = [];             // pieces of current chunk
let curLen = 0;
let batchChunks = [];     // buffers of current batch
let batchChunksIdx = [];  // global index of each buffered chunk
let batchRaw = 0;
let nextChunk = 0;
let chunkCount = 0;
let batchNo = 0;

function sealChunk() {
  if (curLen === 0) return;
  batchChunks.push(Buffer.concat(cur, curLen));
  batchChunksIdx.push(nextChunk);
  nextChunk++;
  batchRaw += curLen;
  cur = []; curLen = 0;
}
function appendPiece(piece) {
  cur.push(piece); curLen += piece.length;
  if (curLen >= CHUNK) sealChunk();
}
async function flushBatch(force) {
  if (!batchChunks.length) return;
  if (!force && batchRaw < BATCH) return;
  const bufs = batchChunks;
  const idxs = batchChunksIdx;
  batchChunks = []; batchChunksIdx = []; batchRaw = 0;
  // NOTE: pool.run() transfers each chunk's ArrayBuffer, so any length we need
  // afterwards must be captured before dispatching.
  const lens = bufs.map(b => b.length);
  const rawSum = lens.reduce((a, b) => a + b, 0);
  const results = await Promise.all(bufs.map(b => pool.run(b)));
  let written = 0;
  for (let i = 0; i < bufs.length; i++) {
    const m = results[i];
    if (!m.ok) throw new Error('brotli failed: ' + m.err);
    const ob = Buffer.isBuffer(m.out) ? m.out : Buffer.from(m.out.buffer, m.out.byteOffset, m.out.byteLength);
    const line = JSON.stringify({ t: 'c', i: idxs[i], n: lens[i], d: ob.toString('base64') }) + '\n';
    written += fs.writeSync(outFd, line);
    chunkCount++;
  }
  outBytes += written;
  batchNo++;
  log('batch', batchNo, 'chunks', bufs.length, 'raw', (rawSum / 1048576).toFixed(1), 'MB -> out', (outBytes / 1048576).toFixed(1), 'MB');
}

const READ_BUF = 4 << 20;
for (let bi = 0; bi < blobs.length; bi++) {
  const b = blobs[bi];
  let fd = null;
  const segs = [];
  try {
    fd = fs.openSync(b.rep.p, 'r');
    let n;
    const buf = Buffer.allocUnsafe(READ_BUF);
    while ((n = fs.readSync(fd, buf, 0, READ_BUF, null)) > 0) {
      let off = 0;
      while (off < n) {
        const space = CHUNK - curLen;
        const take = Math.min(space, n - off);
        segs.push([nextChunk, curLen, take]);
        appendPiece(Buffer.from(buf.subarray(off, off + take)));
        off += take;
      }
    }
  } finally { if (fd !== null) fs.closeSync(fd); }
  b.segs = segs;
  await flushBatch(false);
  if ((bi + 1) % 4000 === 0) log('packed', bi + 1, '/', blobs.length, 'blobs');
}
sealChunk();
await flushBatch(true);
log('all chunks compressed:', chunkCount, 'chunks; out', (outBytes / 1048576).toFixed(1), 'MB');

// ---------- 5. entries ----------
let entryBytes = 0, entryCount = 0;
const chunk = [];
for (const b of blobs) {
  for (const f of b.files) {
    const line = JSON.stringify({ t: 'e', p: f.rel, s: f.size, m: f.mtime, h: b.h, g: b.segs }) + '\n';
    chunk.push(line); entryBytes += Buffer.byteLength(line); entryCount++;
    if (chunk.length >= 2000) { fs.writeSync(outFd, chunk.join('')); chunk.length = 0; }
  }
}
if (chunk.length) fs.writeSync(outFd, chunk.join(''));
outBytes += entryBytes;
log('wrote', entryCount, 'file entries,', (entryBytes / 1048576).toFixed(1), 'MB');

// ---------- 6. header ----------
const header = JSON.stringify({
  f: 'Infinity.Inc history archive', v: 1, created: new Date().toISOString(),
  root: ROOT, layout: 'header|chunk-lines|entry-lines',
  codec: 'brotli', quality: QUALITY, lgwin: LGWIN, chunkBytes: CHUNK,
  files: entryCount, origBytes: totalBytes, uniqueBytes, blobs: blobs.length,
  chunks: chunkCount, dedupSavedBytes: totalBytes - uniqueBytes,
  archiveBytes: outBytes, manifest: path.basename(MANIFEST),
});
const hb = Buffer.from(header, 'utf8');
if (hb.length > HEADER_BYTES - 1) { fs.closeSync(outFd); throw new Error('header too long'); }
const hdr2 = Buffer.alloc(HEADER_BYTES, 0x20); hb.copy(hdr2, 0); hdr2[HEADER_BYTES - 1] = 0x0a;
fs.writeSync(outFd, hdr2, 0, HEADER_BYTES, 0);
fs.fsyncSync(outFd);
const finalSize = fs.fstatSync(outFd).size;
fs.closeSync(outFd);
pool.close();

log('DONE', (finalSize / 1048576).toFixed(1), 'MB archive =', (100 * finalSize / totalBytes).toFixed(2) + '% of', (totalBytes / 1048576).toFixed(1), 'MB original');
console.log('ARCHIVE=' + TMP);
console.log('MANIFEST=' + MANIFEST);
