#!/usr/bin/env node
// work/sync-history.mjs - compress session logs into history/history.jsonl (append-only).
//
// Two sources:
//   A) snapshot root  history/ : history/*.jsonl + history/subagents/*/*.jsonl  -> whole-file entries
//      (a changed file is re-archived as a new entry)
//   B) live root      ~/.dsh/sessions/<slug>/   : <dir>/session.v4.jsonl.zstd   -> INCREMENTAL parts
//      The .zstd is decompressed with node's built-in zstd, and only the bytes appended since the
//      last snapshot are written, as live/<dir>/parts/part-NNNNN.jsonl. Concatenating the parts in
//      order reproduces the whole session log exactly (state file records offsets + sha256).
//
// Usage:
//   node work/sync-history.mjs [--dry-run] [--force] [--quiet] [--no-live]
//        [--root history] [--archive history/history.jsonl]
//        [--state work/history-sync-state.json] [--live-root <dir>] [--max-mb 512]
//
// Container: 4096-byte JSON header (space padded, last byte 0x0A), then segments; each segment is
// chunk lines {"t":"c","i":n,"n":rawLen,"d":base64(brotli(raw))} followed by entry lines
// {"t":"e","p":relPath,"s":size,"m":mtimeMs,"h":sha256,"g":[[chunk,off,len],...]}.
// Appends a new segment at EOF and patches the fixed header in place: no existing byte moves.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..');
const HEADER_BYTES = 4096;
const MB = 1048576;

function opt(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  if (v === undefined || v.slice(0, 2) === '--') return true;
  return v;
}

const ROOT = path.resolve(String(opt('root', path.join(REPO, 'history'))));
const ARCHIVE = path.resolve(String(opt('archive', path.join(ROOT, 'history.jsonl'))));
const STATE = path.resolve(String(opt('state', path.join(here, 'history-sync-state.json'))));
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const LIVE_ROOT = path.resolve(String(opt('live-root', path.join(DSH_HOME, 'sessions'))));
const NO_LIVE = !!opt('no-live', false);
const DRY = !!opt('dry-run', false);
const FORCE = !!opt('force', false);
const QUIET = !!opt('quiet', false);
const MAX_MB = Number(opt('max-mb', 512));

const t0 = Date.now();
function log() {
  if (QUIET) return;
  const parts = Array.prototype.map.call(arguments, String);
  console.log('[' + ((Date.now() - t0) / 1000).toFixed(1) + 's] ' + parts.join(' '));
}
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function readHeader(p) {
  const fd = fs.openSync(p, 'r');
  const buf = Buffer.alloc(HEADER_BYTES);
  let n = 0;
  try { n = fs.readSync(fd, buf, 0, HEADER_BYTES, 0); } finally { fs.closeSync(fd); }
  if (n < HEADER_BYTES) throw new Error('archive shorter than ' + HEADER_BYTES + ' bytes: ' + p);
  const s = buf.toString('utf8');
  const nl = s.indexOf('\n');
  return JSON.parse(s.slice(0, nl < 0 ? HEADER_BYTES : nl).trim());
}

function collectSnapshot(root, archiveBase) {
  const out = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isFile() || e.name === archiveBase) continue;
    if (e.name.length < 6 || e.name.slice(-6).toLowerCase() !== '.jsonl') continue;
    out.push({ abs: path.join(root, e.name), rel: e.name });
  }
  const sub = path.join(root, 'subagents');
  if (fs.existsSync(sub)) {
    for (const d of fs.readdirSync(sub, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const dir = path.join(sub, d.name);
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!f.isFile()) continue;
        if (f.name.length < 6 || f.name.slice(-6).toLowerCase() !== '.jsonl') continue;
        out.push({ abs: path.join(dir, f.name), rel: 'subagents/' + d.name + '/' + f.name });
      }
    }
  }
  out.sort(function (a, b) { return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0; });
  return out;
}

// live root: <liveRoot>/<slug>/<sessionDir>/session.v4.jsonl.zstd
function collectLive(root, skipDirs) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const slug of fs.readdirSync(root, { withFileTypes: true })) {
    if (!slug.isDirectory()) continue;
    const slugDir = path.join(root, slug.name);
    for (const d of fs.readdirSync(slugDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const dir = path.join(slugDir, d.name);
      if (!dir.includes('Infinity')) continue;
      if (skipDirs && skipDirs.has(d.name)) continue;
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!f.isFile()) continue;
        if (!f.name.endsWith('.jsonl.zstd')) continue;
        out.push({
          abs: path.join(dir, f.name),
          rel: 'live/' + d.name + '/' + f.name.replace(/\.zstd$/, ''),
          dirName: d.name,
        });
      }
    }
  }
  out.sort(function (a, b) { return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0; });
  return out;
}

const LOCK = ARCHIVE + '.lock';
let locked = false;
function acquireLock() {
  try {
    const fd = fs.openSync(LOCK, 'wx');
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    fs.closeSync(fd);
    locked = true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let st = null;
    try { st = fs.statSync(LOCK); } catch (err) { st = null; }
    if (!st || Date.now() - st.mtimeMs > 1800000) { try { fs.unlinkSync(LOCK); } catch (err) {} return acquireLock(); }
    throw new Error('another sync is running (lock ' + LOCK + ')');
  }
}
function releaseLock() { if (!locked) return; try { fs.unlinkSync(LOCK); } catch (e) {} locked = false; }

// DSH appends one independent zstd frame per flush; node's zstdDecompressSync only decodes the
// first frame, so walk the frame/block structure and decode every frame, then concatenate.
function decodeZstdAll(buf) {
  const frames = [];
  let off = 0;
  while (off + 4 <= buf.length) {
    if (buf.readUInt32LE(off) !== 0xFD2FB528) break;
    let p = off + 4;
    const fhd = buf[p++];
    const fcsFlag = fhd >> 6;
    const singleSegment = (fhd >> 5) & 1;
    const dictIdFlag = fhd & 3;
    const checksum = (fhd >> 2) & 1;
    if (!singleSegment) p += 1;
    p += [0, 1, 2, 4][dictIdFlag];
    const fcsSize = fcsFlag === 0 ? (singleSegment ? 1 : 0) : [0, 2, 4, 8][fcsFlag];
    p += fcsSize;
    for (;;) {
      if (p + 3 > buf.length) throw new Error('truncated zstd block header at ' + p);
      const h = buf.readUIntLE(p, 3);
      p += 3;
      const last = h & 1;
      const type = (h >> 1) & 3;
      const size = h >> 3;
      if (type === 0 || type === 2) p += size;
      else if (type === 1) p += 1;
      else throw new Error('reserved zstd block type at ' + p);
      if (last) break;
    }
    if (checksum) p += 4;
    if (p > buf.length) throw new Error('zstd frame overruns buffer');
    frames.push(buf.subarray(off, p));
    off = p;
  }
  if (frames.length === 0) throw new Error('no zstd frame found');
  const parts = [];
  for (const f of frames) parts.push(zlib.zstdDecompressSync(f));
  return { buf: Buffer.concat(parts), frames: frames.length, tail: buf.length - off };
}

function main() {
  if (!fs.existsSync(ARCHIVE)) throw new Error('archive not found: ' + ARCHIVE);
  const header = readHeader(ARCHIVE);
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { version: 1, files: {}, live: {} };
  if (!state.files) state.files = {};
  if (!state.live) state.live = {};
  const checkedAt = new Date().toISOString();
  const changed = [];

  // ---------- A) snapshot files ----------
  const targets = collectSnapshot(ROOT, path.basename(ARCHIVE));
  for (const t of targets) {
    const st = fs.statSync(t.abs);
    const mtime = Math.round(st.mtimeMs);
    const prev = state.files[t.rel];
    if (!FORCE && prev && prev.size === st.size && prev.mtime === mtime) continue;
    const buf = fs.readFileSync(t.abs);
    const h = sha256(buf);
    if (!FORCE && prev && prev.sha256 === h) {
      state.files[t.rel] = Object.assign({}, prev, { size: buf.length, mtime: mtime, checkedAt: checkedAt });
      continue;
    }
    changed.push({ rel: t.rel, buf: buf, h: h, size: buf.length, mtime: mtime });
  }
  log('snapshot targets', targets.length, '| changed', changed.length);

  // ---------- B) live session logs (incremental parts) ----------
  let liveSeen = 0, liveParts = 0, liveBytes = 0;
  if (!NO_LIVE && typeof zlib.zstdDecompressSync === 'function') {
    const skipLive = new Set();
    try { for (const d of fs.readdirSync(path.join(ROOT, 'subagents'), { withFileTypes: true })) if (d.isDirectory()) skipLive.add(d.name); } catch (e) {}
    for (const t of collectLive(LIVE_ROOT, skipLive)) {
      liveSeen++;
      const st = fs.statSync(t.abs);
      const mtime = Math.round(st.mtimeMs);
      const prev = state.live[t.rel];
      if (!FORCE && prev && prev.zstdSize === st.size && prev.zstdMtime === mtime) continue;
      let raw = null, frameCount = 1, tailBytes = 0;
      try {
        const dec = decodeZstdAll(fs.readFileSync(t.abs));
        raw = dec.buf; frameCount = dec.frames; tailBytes = dec.tail;
      } catch (e) { log('zstd decode failed', t.rel, String(e && e.message)); continue; }
      const h = sha256(raw);
      if (prev && prev.sha256 === h) {
        state.live[t.rel] = Object.assign({}, prev, { zstdSize: st.size, zstdMtime: mtime, checkedAt: checkedAt });
        continue;
      }
      let base = 0, mode = 'full';
      let parts = [];
      if (prev && Array.isArray(prev.parts) && prev.size <= raw.length && sha256(raw.subarray(0, prev.size)) === prev.sha256) {
        base = prev.size; mode = 'delta'; parts = prev.parts.slice();
      }
      const slice = raw.subarray(base);
      if (slice.length > 0) {
        const ph = sha256(slice);
        // Hash-qualified part name: the archive is append-only and readers take the FIRST entry for a path,
        // so reusing a name after its bytes changed would shadow the newer copy. Never reused.
        const partRel = 'live/' + t.dirName + '/parts/part-' + String(parts.length).padStart(5, '0') + '-' + ph.slice(0, 8) + '.jsonl';
        const copy = Buffer.from(slice);
        changed.push({ rel: partRel, buf: copy, h: ph, size: copy.length, mtime: mtime });
        parts.push({ p: partRel, s: copy.length, off: base, h: ph });
        liveParts++; liveBytes += copy.length;
      }
      state.live[t.rel] = {
        size: raw.length, sha256: h, mode: mode, parts: parts,
        zstdSize: st.size, zstdMtime: mtime, frames: frameCount, tailBytes: tailBytes, updatedAt: checkedAt,
      };
      log('live', t.rel, mode, 'raw=' + raw.length, 'new=' + slice.length, 'parts=' + parts.length);
    }
  } else if (!NO_LIVE) {
    log('zstd decompression unavailable in this node build; live sources skipped');
  }

  if (changed.length === 0) {
    state.version = 2;
    state.archive = ARCHIVE;
    state.liveRoot = LIVE_ROOT;
    state.updatedAt = checkedAt;
    state.archiveBytes = fs.statSync(ARCHIVE).size;
    if (!DRY) fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
    console.log(JSON.stringify({ ok: true, action: 'up-to-date', snapshotFiles: targets.length, liveFiles: liveSeen, changed: 0, archiveBytes: state.archiveBytes }));
    return;
  }

  const totalNew = changed.reduce(function (a, c) { return a + c.size; }, 0);
  if (totalNew > MAX_MB * MB && !FORCE) throw new Error('refusing: ' + (totalNew / MB).toFixed(1) + ' MB > max-mb ' + MAX_MB);
  log('changed', changed.length, 'entries,', (totalNew / MB).toFixed(2), 'MB (live parts', liveParts, ')');

  /*
   * The header is a fixed 4096-byte JSON block, and a segment is written before the header is
   * rewritten. If the new header cannot fit, the old code appended the segment and then failed,
   * leaving a stale header: chunk ids were then reused (nine chunks all numbered 116) and 24
   * entries became unreadable. Decide before writing a single byte.
   */
  const probeAppended = (Array.isArray(header.appended) ? header.appended : []).slice(-7).concat([
    { at: new Date().toISOString(), files: changed.length, bytes: totalNew, chunks: 1, firstChunk: 0, archiveBytes: 0 },
  ]);
  const probeHeader = Object.assign({}, header, {
    appended: probeAppended,
    snapshots: (Number(header.snapshots) || 0) + 1,
    files: (Number(header.files) || 0) + changed.length,
    chunks: (Number(header.chunkSeq) || Number(header.chunks) || 0) + 1,
    origBytes: (Number(header.origBytes) || 0) + totalNew,
  });
  const probeLen = Buffer.byteLength(JSON.stringify(probeHeader), 'utf8');
  if (probeLen > HEADER_BYTES) throw new Error('header would not fit: ' + probeLen + ' > ' + HEADER_BYTES + ' bytes; refusing to append');

  const byHash = new Map();
  for (const c of changed) {
    let b = byHash.get(c.h);
    if (!b) { b = { h: c.h, size: c.size, files: [], segs: [] }; byHash.set(c.h, b); }
    b.files.push(c);
  }

  const chunkBytes = Number(header.chunkBytes) || 16777216;
  const quality = Number(header.quality) || 10;
  const lgwin = Number(header.lgwin) || 24;
  // Chunk ids must be unique for the whole archive: readers gather bytes by [id, off, len],
  // so reusing an id would make two segments indistinguishable. `chunkSeq` is the next free
  // id, kept in the header; older archives that lack it fall back to the chunk count.
  const chunkOffset = Number(header.chunkSeq) || Number(header.chunks) || 0;

  const rawChunks = [];
  let cur = Buffer.allocUnsafe(chunkBytes);
  let curLen = 0;
  function seal() {
    if (curLen === 0) return;
    rawChunks.push(Buffer.from(cur.subarray(0, curLen)));
    cur = Buffer.allocUnsafe(chunkBytes);
    curLen = 0;
  }
  for (const b of byHash.values()) {
    const buf = b.files[0].buf;
    const segs = [];
    let off = 0;
    while (off < buf.length) {
      const space = chunkBytes - curLen;
      const take = Math.min(space, buf.length - off);
      segs.push([chunkOffset + rawChunks.length, curLen, take]);
      buf.copy(cur, curLen, off, off + take);
      curLen += take;
      off += take;
      if (curLen >= chunkBytes) seal();
    }
    b.segs = segs;
  }
  seal();

  const entries = [];
  for (const b of byHash.values()) {
    for (const f of b.files) entries.push({ t: 'e', p: f.rel, s: f.size, m: f.mtime, h: f.h, g: b.segs });
  }
  log('new chunks', rawChunks.length, '| entries', entries.length, '| raw', (totalNew / MB).toFixed(2), 'MB');

  if (DRY) {
    console.log(JSON.stringify({ ok: true, action: 'dry-run', changed: changed.length, bytes: totalNew, chunks: rawChunks.length, entries: entries.length, liveParts: liveParts }));
    return;
  }

  const startSize = fs.statSync(ARCHIVE).size;
  const NL = String.fromCharCode(10);
  const fd = fs.openSync(ARCHIVE, 'a');
  let written = 0;
  try {
    for (let i = 0; i < rawChunks.length; i++) {
      const raw = rawChunks[i];
      const out = zlib.brotliCompressSync(raw, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: quality,
          [zlib.constants.BROTLI_PARAM_LGWIN]: lgwin,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length
        }
      });
      const line = JSON.stringify({ t: 'c', i: chunkOffset + i, n: raw.length, d: out.toString('base64') }) + NL;
      written += fs.writeSync(fd, line);
      log('chunk', chunkOffset + i, 'raw', (raw.length / MB).toFixed(2), 'MB ->', (out.length / MB).toFixed(2), 'MB');
    }
    const lines = new Array(entries.length);
    for (let i = 0; i < entries.length; i++) lines[i] = JSON.stringify(entries[i]);
    if (lines.length) written += fs.writeSync(fd, Buffer.from(lines.join(NL) + NL, 'utf8'));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  const now = new Date().toISOString();
  const newSize = startSize + written;
  // The header is a fixed 4096-byte JSON block, so this list cannot grow without bound:
  // keep the newest runs and let the counters (files/origBytes/snapshots) carry the totals.
  const appended = (Array.isArray(header.appended) ? header.appended : []).slice(-7);
  appended.push({ at: now, files: entries.length, bytes: totalNew, chunks: rawChunks.length, firstChunk: chunkOffset, archiveBytes: newSize, liveParts: liveParts });
  const newHeader = Object.assign({}, header, {
    layout: 'header|segment(chunk-lines then entry-lines), repeated; appended segments start at EOF',
    snapshots: (Number(header.snapshots) || 0) + 1,
    appended: appended,
    files: (Number(header.files) || 0) + entries.length,
    origBytes: (Number(header.origBytes) || 0) + totalNew,
    chunks: chunkOffset + rawChunks.length,
    // The next run must start past every id this one used; without this the header kept
    // handing out the same id again and two different chunks ended up indistinguishable.
    chunkSeq: chunkOffset + rawChunks.length,
    archiveBytes: newSize,
    updated: now
  });
  const hb = Buffer.from(JSON.stringify(newHeader), 'utf8');
  if (hb.length > HEADER_BYTES - 1) throw new Error('header too long: ' + hb.length);
  const pad = Buffer.alloc(HEADER_BYTES, 0x20);
  hb.copy(pad, 0);
  pad[HEADER_BYTES - 1] = 0x0a;
  const hfd = fs.openSync(ARCHIVE, 'r+');
  try {
    fs.writeSync(hfd, pad, 0, HEADER_BYTES, 0);
    fs.fsyncSync(hfd);
  } finally {
    fs.closeSync(hfd);
  }

  for (const b of byHash.values()) {
    for (const f of b.files) {
      const prev = state.files[f.rel] || {};
      state.files[f.rel] = {
        sha256: f.h, size: f.size, mtime: f.mtime, appendedAt: now,
        archiveChunks: b.segs.length, snapshots: (Number(prev.snapshots) || 0) + 1
      };
    }
  }
  state.version = 2;
  state.archive = ARCHIVE;
  state.liveRoot = LIVE_ROOT;
  state.updatedAt = now;
  state.archiveBytes = newSize;
  state.snapshots = (Number(state.snapshots) || 0) + 1;
  fs.writeFileSync(STATE, JSON.stringify(state, null, 1));

  log('appended', entries.length, 'entries +', rawChunks.length, 'chunks =', (written / MB).toFixed(2), 'MB; archive', (newSize / MB).toFixed(2), 'MB');
  console.log(JSON.stringify({
    ok: true, action: 'appended', changed: changed.length, bytes: totalNew,
    chunks: rawChunks.length, entries: entries.length, writtenBytes: written,
    liveFiles: liveSeen, liveParts: liveParts, liveBytes: liveBytes,
    archiveBytes: newSize, headerChunks: newHeader.chunks, headerFiles: newHeader.files, state: STATE
  }));
}

try { acquireLock(); main(); releaseLock(); } catch (e) { releaseLock(); console.error('ERROR: ' + ((e && e.stack) || e)); process.exit(1); }
