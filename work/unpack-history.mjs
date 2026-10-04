import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import readline from 'node:readline';

function opt(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith('--')) return true;
  return v;
}
const ARCHIVE = path.resolve(String(opt('archive', 'D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/history/history.jsonl')));
const MODE = opt('verify', false) ? 'verify' : opt('extract', false) ? 'extract' : opt('list', false) ? 'list' : 'info';
const OUTDIR = MODE === 'extract' ? path.resolve(String(opt('extract', '.'))) : null;
const MANIFEST = opt('manifest', null) ? path.resolve(String(opt('manifest', null))) : null;
const t0 = Date.now();
const MB = 1048576;

async function readEntries() {
  const rl = readline.createInterface({ input: fs.createReadStream(ARCHIVE, { highWaterMark: 1 << 24 }), crlfDelay: Infinity });
  let header = null;
  const entries = [];
  let chunkCount = 0;
  for await (const line of rl) {
    if (!line) continue;
    if (!header) { header = JSON.parse(line); continue; }
    let o; try { o = JSON.parse(line); } catch (e) { throw new Error('bad json line: ' + String(e).slice(0, 120)); }
    if (o.t === 'c') chunkCount++;
    else if (o.t === 'e') entries.push(o);
  }
  return { header, entries, chunkCount };
}

const { header, entries, chunkCount } = await readEntries();
console.log('header:', JSON.stringify({ files: header.files, chunks: header.chunks, origBytes: header.origBytes, codec: header.codec }));
console.log('scanned: entries=' + entries.length + ' chunkLines=' + chunkCount);
if (MODE === 'list') { for (const e of entries.slice(0, 50)) console.log(e.p, e.s); }
if (MODE === 'info') process.exit(0);

// map chunk -> work items
if (MODE === 'verify' || MODE === 'extract') {
  const jobsByChunk = new Map();
  const state = entries.map((e) => ({ e, done: 0, hash: MODE === 'verify' ? crypto.createHash('sha256') : null, fd: null, out: null }));
  entries.forEach((e, i) => {
    for (const [c, o, l] of e.g) {
      if (!jobsByChunk.has(c)) jobsByChunk.set(c, []);
      jobsByChunk.get(c).push({ i, o, l });
    }
  });
  if (MODE === 'extract') fs.mkdirSync(OUTDIR, { recursive: true });
  const EMPTY = crypto.createHash('sha256').digest('hex');
  let verified = 0, bytes = 0, mismatches = [];
  // zero-byte entries have no segments: settle them up front
  state.forEach((st, i) => {
    if (st.e.s !== 0) return;
    if (MODE === 'verify') { if (st.e.h === EMPTY) verified++; else mismatches.push(st.e.p); }
    else {
      const fp = path.join(OUTDIR, st.e.p);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, Buffer.alloc(0));
      try { const t = st.e.m / 1000; fs.utimesSync(fp, t, t); } catch {}
    }
  });
  const rl = readline.createInterface({ input: fs.createReadStream(ARCHIVE, { highWaterMark: 1 << 24 }), crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    if (!line) continue;
    const o = JSON.parse(line);
    if (o.t !== 'c') continue;
    const buf = o.d ? zlib.brotliDecompressSync(Buffer.from(o.d, 'base64')) : Buffer.alloc(0);
    if (buf.length !== o.n) throw new Error('chunk ' + o.i + ' length mismatch ' + buf.length + ' != ' + o.n);
    const jobs = jobsByChunk.get(o.i) || [];
    for (const j of jobs) {
      const st = state[j.i];
      const piece = buf.subarray(j.o, j.o + j.l);
      if (MODE === 'verify') st.hash.update(piece);
      else {
        if (st.fd === null) {
          const fp = path.join(OUTDIR, st.e.p);
          fs.mkdirSync(path.dirname(fp), { recursive: true });
          st.fd = fs.openSync(fp, 'w');
        }
        fs.writeSync(st.fd, piece);
      }
      st.done += j.l;
      bytes += j.l;
      if (st.done === st.e.s) {
        if (MODE === 'verify') {
          const got = st.hash.digest('hex');
          if (got !== st.e.h) mismatches.push(st.e.p);
          else verified++;
        } else {
          fs.closeSync(st.fd); st.fd = null;
          const fp = path.join(OUTDIR, st.e.p);
          try { const t = st.e.m / 1000; fs.utimesSync(fp, t, t); } catch {}
        }
      }
    }
    if (jobsByChunk.has(o.i)) jobsByChunk.delete(o.i);
  }
  if (MODE === 'verify') {
    console.log('verified=' + verified + '/' + entries.length + ' bytes=' + (bytes / MB).toFixed(1) + ' MB mismatches=' + mismatches.length);
    if (mismatches.length) { console.log('MISMATCH SAMPLE:', mismatches.slice(0, 10)); process.exit(2); }
    if (verified !== entries.length) {
      const inc = state.filter(st => st.done !== st.e.s).map(st => st.e.p + ' done=' + st.done + '/' + st.e.s);
      console.log('INCOMPLETE entries=' + inc.length + ' -> ' + JSON.stringify(inc.slice(0, 10)));
      process.exit(3);
    }
    if (MANIFEST) {
      const man = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
      const seen = new Map(entries.map(e => [e.p, e]));
      const manSet = new Set(man.entries.map(m => m.p));
      let miss = 0, sizeBad = 0, hashBad = 0, mtimeBad = 0, extra = 0;
      for (const m of man.entries) {
        const e = seen.get(m.p);
        if (!e) { miss++; continue; }
        if (e.s !== m.s) sizeBad++;
        if (e.h !== m.h) hashBad++;
        if (Math.abs((e.m || 0) - m.m) > 2000) mtimeBad++;
      }
      for (const e of entries) if (!manSet.has(e.p)) extra++;
      if (mtimeBad) console.log('note: mtime drift on ' + mtimeBad + ' entries (files touched while packing)');
      console.log('manifest cross-check: missing=' + miss + ' sizeBad=' + sizeBad + ' hashBad=' + hashBad + ' extraEntries=' + extra + ' manifestFiles=' + man.entries.length);
      if (miss || sizeBad || hashBad) process.exit(4);
    }
    console.log('VERIFY OK in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  } else {
    console.log('extracted ' + entries.length + ' files, ' + (bytes / MB).toFixed(1) + ' MB to ' + OUTDIR);
  }
}
