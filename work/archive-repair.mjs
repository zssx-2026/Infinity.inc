#!/usr/bin/env node
// work/archive-repair.mjs - recover entries whose g segments reference a chunk id that
// was reused by more than one chunk line (ids 116 x9 and 127 x2 in history.jsonl).
//
// Read-only. Streams the archive, collects all candidate chunks for every duplicated id
// (brotli-decompressed), and for each affected entry tries candidate x offset combinations
// until the entry's own sha256 matches. Emits work/archive-repair-plan.json.
//
// Usage: node work/archive-repair.mjs [--archive history/history.jsonl] [--out work/archive-repair-plan.json]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..');
function opt(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  if (v === undefined || v.slice(0, 2) === '--') return true;
  return v;
}
const ARCHIVE = path.resolve(String(opt('archive', path.join(REPO, 'history', 'history.jsonl'))));
const OUT = path.resolve(String(opt('out', path.join(here, 'archive-repair-plan.json'))));
const HEADER_BYTES = 4096;
const t0 = Date.now();
const log = (...a) => console.log('[' + ((Date.now() - t0) / 1000).toFixed(1) + 's]', ...a);

// ---------------------------------------------------------------- 1. header + scan
const st = fs.statSync(ARCHIVE);
const fd = fs.openSync(ARCHIVE, 'r');
const hb = Buffer.alloc(HEADER_BYTES);
if (fs.readSync(fd, hb, 0, HEADER_BYTES, 0) !== HEADER_BYTES) throw new Error('short header read');
const headerBefore = JSON.parse(hb.toString('utf8').trimEnd());
log('archive', st.size, 'bytes; header files=' + headerBefore.files, 'chunks=' + headerBefore.chunks, 'chunkSeq=' + headerBefore.chunkSeq);

const CH = 32 * 1024 * 1024;
const buf = Buffer.alloc(CH);
let base = HEADER_BYTES, carry = 0;
const chunkLines = [];   // {i, n, off, len}
const entries = [];      // {p, s, m, h, g, off, len}
let blank = 0;
while (true) {
  const r = fs.readSync(fd, buf, carry, CH - carry, base + carry);
  if (r <= 0) break;
  const valid = carry + r;
  let pos = 0;
  while (true) {
    const nl = buf.indexOf(10, pos);
    if (nl < 0 || nl >= valid) break;
    const len = nl - pos;
    if (len > 0) {
      const off = base + pos;
      if (buf[pos + 6] === 0x63) {
        const head = buf.toString('latin1', pos, Math.min(pos + 120, nl));
        const im = /"i":(\d+)/.exec(head), nm = /"n":(\d+)/.exec(head);
        if (!im || !nm) throw new Error('chunk line without i/n at ' + off);
        chunkLines.push({ i: +im[1], n: +nm[1], off, len });
      } else {
        const o = JSON.parse(buf.toString('utf8', pos, nl));
        entries.push({ p: o.p, s: o.s, m: o.m, h: o.h, g: o.g, off, len });
      }
    } else blank++;
    pos = nl + 1;
  }
  const left = valid - pos;
  if (left > 0) buf.copy(buf, 0, pos, valid);
  base += pos;
  carry = left;
}
fs.closeSync(fd);
if (carry > 0) throw new Error('trailing partial line at EOF (carry=' + carry + '): archive is being appended concurrently');
log('scan: chunkLines', chunkLines.length, 'entryLines', entries.length, 'blank', blank);

// ---------------------------------------------------------------- 2. duplicate ids
const byId = new Map();
for (const c of chunkLines) {
  if (!byId.has(c.i)) byId.set(c.i, []);
  byId.get(c.i).push(c);
}
const dupIds = new Set();
for (const [id, list] of byId) if (list.length > 1) dupIds.add(id);
log('duplicate ids:', [...dupIds].map(id => id + 'x' + byId.get(id).length).join(', '));

// ---------------------------------------------------------------- 3. decompress candidates
function readLine(off, len) {
  const b = Buffer.allocUnsafe(len);
  const f = fs.openSync(ARCHIVE, 'r');
  try {
    let got = 0;
    while (got < len) { const r = fs.readSync(f, b, got, len - got, off + got); if (r <= 0) throw new Error('short read at ' + off); got += r; }
  } finally { fs.closeSync(f); }
  return b;
}
function decodeChunk(line, info) {
  const a = line.indexOf('"d":"');
  const b = line.lastIndexOf('"}');
  if (a < 0 || b < 0 || b <= a) throw new Error('chunk line format unexpected at ' + info.off);
  const raw = zlib.brotliDecompressSync(Buffer.from(line.subarray(a + 5, b).toString('ascii'), 'base64'));
  if (raw.length !== info.n) throw new Error('len mismatch chunk ' + info.i + ': got ' + raw.length + ' want ' + info.n);
  return raw;
}
const idCandidates = new Map(); // id -> [{idx, info, raw, sha256}]
for (const id of dupIds) {
  const list = byId.get(id).map((info, idx) => {
    const raw = decodeChunk(readLine(info.off, info.len), info);
    return { idx, lineOff: info.off, lineLen: info.len, n: info.n, raw, sha256: crypto.createHash('sha256').update(raw).digest('hex') };
  });
  idCandidates.set(id, list);
  log('id', id, 'candidates:', list.map(c => c.n).join('/'), 'rawSha', list.map(c => c.sha256.slice(0, 8)).join('/'));
}
const uniqCache = new Map();
function uniqRaw(id) {
  if (!uniqCache.has(id)) {
    const info = byId.get(id)[0];
    uniqCache.set(id, decodeChunk(readLine(info.off, info.len), info));
  }
  return uniqCache.get(id);
}

// ---------------------------------------------------------------- 4. resolve affected entries
function tryCombo(g, pick) { // pick: Map(id -> candidate record)
  const parts = [];
  for (const seg of g) {
    const [ci, soff, slen] = seg;
    const b = pick.has(ci) ? pick.get(ci).raw : uniqRaw(ci);
    if (soff < 0 || slen < 0 || soff + slen > b.length) return null;
    parts.push(b.subarray(soff, soff + slen));
  }
  const h = crypto.createHash('sha256');
  let size = 0;
  for (const p of parts) { h.update(p); size += p.length; }
  return { sha256: h.digest('hex'), size };
}
function combos(lists, k, acc, out, max) {
  if (out.length >= max) return;
  if (k === lists.length) { out.push(acc.slice()); return; }
  for (const item of lists[k]) { acc.push(item); combos(lists, k + 1, acc, out, max); acc.pop(); }
}

const affected = entries.filter(e => e.g.some(s => dupIds.has(s[0])));
log('affected entries:', affected.length);

const pathGroups = new Map(); // path -> [entry,...] in file order
const affectedOut = [];
let recovered = 0;
for (const e of affected) {
  const dupUsed = [...new Set(e.g.map(s => s[0]).filter(id => dupIds.has(id)))];
  const lists = dupUsed.map(id => idCandidates.get(id));
  const conv = lists.map(l => l[l.length - 1]); // restore-history.ps1 keeps the LAST line per id
  const first = lists.map(l => l[0]);
  const lastN = tryCombo(e.g, new Map(dupUsed.map((id, i) => [id, conv[i]])));
  const firstN = tryCombo(e.g, new Map(dupUsed.map((id, i) => [id, first[i]])));
  const all = [];
  combos(lists, 0, [], all, 4096);
  const hits = [];
  for (const combo of all) {
    const pick = new Map(dupUsed.map((id, i) => [id, combo[i]]));
    const got = tryCombo(e.g, pick);
    if (got && got.sha256 === e.h && got.size === e.s) hits.push(combo.map(c => c.idx));
  }
  const status = hits.length ? 'recovered' : 'unrecoverable';
  if (hits.length) recovered++;
  const chosen = hits.length ? lists.map((l, i) => l[hits[0][i]]) : null;
  const rec = {
    p: e.p, s: e.s, h: e.h, g: e.g, lineOff: e.off, lineLen: e.len,
    dupIdsUsed: dupUsed,
    status,
    hitCombos: hits,
    hitCount: hits.length,
    conventionalLastCandidate: !!(lastN && lastN.sha256 === e.h && lastN.size === e.s),
    conventionalFirstCandidate: !!(firstN && firstN.sha256 === e.h && firstN.size === e.s),
    chosen: chosen ? { candidateIndexes: hits[0], candidateLineOffs: chosen.map(c => c.lineOff) } : null,
  };
  affectedOut.push(rec);
  if (!pathGroups.has(e.p)) pathGroups.set(e.p, []);
  pathGroups.get(e.p).push(rec);
}
log('recovered', recovered, '/', affected.length, '; unrecoverable', affected.length - recovered);

// ---------------------------------------------------------------- 5. r1 output plan
function r1Name(p) {
  const base = p.endsWith('.jsonl') ? p.slice(0, -'.jsonl'.length) : p;
  return base + '-r1.jsonl';
}
function r1ShadowName(p, h) {
  const base = p.endsWith('.jsonl') ? p.slice(0, -'.jsonl'.length) : p;
  return base + '-r1-' + h.slice(0, 8) + '.jsonl';
}
const r1Outputs = [];
const pathPlan = [];
for (const [p, list] of pathGroups) {
  list.forEach((r, k) => { r.pathOccurrence = k; r.firstOfPath = k === 0; });
  const first = list[0];
  const distinct = [];
  for (const r of list) if (!distinct.includes(r.h)) distinct.push(r.h);
  const entryForHash = h => list.find(r => r.h === h);
  const primary = first.status === 'recovered' ? r1Name(p) : null;
  pathPlan.push({
    srcPath: p, occurrences: list.length, distinctContents: distinct.length,
    primaryOut: primary, primaryHash: first.h, primaryBytes: first.s,
    primaryFromFirstOccurrence: true,
    firstOccurrenceStatus: first.status,
  });
  for (const h of distinct) {
    const r = entryForHash(h);
    if (!r || r.status !== 'recovered') continue;
    const isPrimary = h === first.h && first.status === 'recovered';
    r1Outputs.push({
      outPath: isPrimary ? r1Name(p) : r1ShadowName(p, h),
      srcPath: p, h: r.h, s: r.s, kind: isPrimary ? 'primary' : 'shadowed',
      sourceLineOff: r.lineOff,
      segs: r.g,
      g: r.g,
      candidateIndexes: r.chosen.candidateIndexes,
      candidateLineOffs: r.chosen.candidateLineOffs,
    });
  }
}

const totalRaw = r1Outputs.reduce((a, o) => a + o.s, 0);
const dupDesc = {};
for (const id of dupIds) {
  dupDesc[id] = {
    lineCount: byId.get(id).length,
    rawLens: byId.get(id).map(c => c.n),
    lineOffsets: byId.get(id).map(c => c.off),
    candidates: idCandidates.get(id).map(c => ({ idx: c.idx, n: c.n, lineOff: c.lineOff, lineLen: c.lineLen, sha256: c.sha256 })),
  };
}

const plan = {
  tool: 'work/archive-repair.mjs',
  generated: new Date().toISOString(),
  archive: ARCHIVE,
  archiveBytes: st.size,
  archiveMtime: st.mtime.toISOString(),
  headerBefore,
  scan: { chunkLines: chunkLines.length, entryLines: entries.length, distinctChunkIds: byId.size },
  duplicateIds: dupDesc,
  affectedEntryCount: affected.length,
  affectedPathCount: pathGroups.size,
  recoveredCount: recovered,
  unrecoverableCount: affected.length - recovered,
  unrecoverable: affectedOut.filter(r => r.status !== 'recovered').map(r => ({ p: r.p, s: r.s, h: r.h, g: r.g, lineOff: r.lineOff, reason: 'no candidate x offset combination reproduces the entry sha256' })),
  distinctAffectedPaths: [...pathGroups.keys()],
  pathPlan,
  r1OutputCount: r1Outputs.length,
  r1OutputTotalRawBytes: totalRaw,
  r1Outputs,
  entries: affectedOut,
  notes: [
    'candidate index 0..N-1 is the file order of chunk lines with the duplicated id',
    'conventionalLastCandidate mirrors work/restore-history.ps1 behaviour (last chunk line wins for a duplicated id)',
    'chosen.candidateLineOffs are absolute byte offsets of the winning chunk line; stable under append-only growth',
  ],
};
fs.writeFileSync(OUT, JSON.stringify(plan, null, 1));
log('wrote', OUT, '(' + fs.statSync(OUT).size + ' bytes)');
log('r1 outputs', r1Outputs.length, 'raw', totalRaw, 'bytes; paths', pathGroups.size, '; extras', r1Outputs.length - pathGroups.size);
console.log(JSON.stringify({
  ok: true, archiveBytes: st.size, chunkLines: chunkLines.length, entries: entries.length,
  duplicateIds: [...dupIds], affected: affected.length, paths: pathGroups.size,
  recovered, unrecoverable: affected.length - recovered, r1Outputs: r1Outputs.length, r1RawBytes: totalRaw,
  plan: OUT,
}));
