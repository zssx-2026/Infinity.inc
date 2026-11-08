// build-manifest.mjs — 生成"逐路径权威内容"manifest：first-wins，并把已知重复 chunk-id 的
// 历史歧义路径别名到修复副本（-r1），使 work/restore-history.ps1 能对每个路径还原出正确字节。
//
// 用法：node work/build-manifest.mjs [--archive history/history.jsonl] [--map work/archive-resolution-map.json]
//        [--out work/history-manifest.json] [--verify 200] [--verify-aliases]
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const QUIET = process.argv.includes('--quiet');
const ARCHIVE = arg('archive', 'history/history.jsonl');
const MAP = arg('map', 'work/archive-resolution-map.json');
const OUT = arg('out', 'work/history-manifest.json');
const FRESH = arg('fresh', 'work/history-manifest-fresh.json');
const ALIASES = arg('aliases', 'work/history-manifest-aliases.json');
const VERIFY = Number(arg('verify', '0'));
const HEADER = 4096;

const entryRx = /^\{"t":"e","p":"((?:[^"\\]|\\.)*)","s":(\d+),"m":(\d+),"h":"([0-9a-f]{64})","g":(\[.*\])\}$/;
const chunkRx = /^\{"t":"c","i":(\d+),"n":(\d+),"d":"([A-Za-z0-9+/=]+)"\}$/;

const first = new Map();      // path -> {p,s,m,h,refs}
const extras = [];            // 同一路径的后续条目（归档为追加式，路径可能重复出现）
const chunkIndex = new Map(); // id -> {off,len,n}
const seenChunk = new Set();
const shadowedChunk = new Set(); // 同一 chunk id 出现多次（历史修复写入），此 id 的解析有歧义
const rl = readline.createInterface({ input: fs.createReadStream(ARCHIVE, { start: HEADER }), crlfDelay: Infinity });
let lineOff = HEADER, chunkLines = 0, entryLines = 0;
const fd = fs.openSync(ARCHIVE, 'r');
for await (const line of rl) {
  const len = Buffer.byteLength(line);
  if (line.startsWith('{"t":"c"')) {
    const exact = chunkRx.exec(line);
    if (exact) { const id = Number(exact[1]); if (!chunkIndex.has(id)) chunkIndex.set(id, { off: lineOff, len, n: Number(exact[2]) }); else shadowedChunk.add(id); chunkLines++; }
  } else if (line.startsWith('{"t":"e"')) {
    const m = entryRx.exec(line);
    if (m) {
      entryLines++;
      const refs = JSON.parse(m[5]);
      const rec = { p: m[1], s: Number(m[2]), m: Number(m[3]), h: m[4], refs };
      if (!first.has(m[1])) first.set(m[1], rec); else extras.push(rec);
    }
  }
  lineOff += len + 1;
}
fs.closeSync(fd);

function chunkBuffer(id) {
  const c = chunkIndex.get(id);
  if (!c) throw new Error('chunk id not found: ' + id);
  const buf = Buffer.alloc(c.len);
  const f = fs.openSync(ARCHIVE, 'r');
  fs.readSync(f, buf, 0, c.len, c.off);
  fs.closeSync(f);
  const line = buf.toString('utf8').replace(/\r?\n$/, '');
  const m = chunkRx.exec(line);
  if (!m) throw new Error('chunk line parse failed at ' + c.off);
  return zlib.brotliDecompressSync(Buffer.from(m[3], 'base64'));
}
const cache = new Map();
function chunkCached(id) {
  if (cache.has(id)) { const b = cache.get(id); cache.delete(id); cache.set(id, b); return b; }
  const b = chunkBuffer(id);
  cache.set(id, b);
  while (cache.size > 6) cache.delete(cache.keys().next().value);
  return b;
}
import crypto from 'node:crypto';
function resolveSha(e) {
  const h = crypto.createHash('sha256');
  for (const [id, off, len] of e.refs) { const cb = chunkCached(id); h.update(cb.subarray(off, off + len)); }
  return h.digest('hex');
}
// alias map: original -> repaired, only when both paths exist and the repaired one is authoritative
const alias = new Map();
if (fs.existsSync(MAP)) {
  const j = JSON.parse(fs.readFileSync(MAP, 'utf8'));
  for (const row of (j.map || [])) {
    if (first.has(row.original) && first.has(row.repaired)) alias.set(row.original, { repaired: row.repaired, sha: row.sha256, bytes: row.bytes });
  }
}
// verify: aliased pairs always; plus N random entries unless --verify 0
const toVerify = new Set([...alias.keys()]);
const allPaths = [...first.keys()];
if (VERIFY > 0) { const rnd = crypto.createHash('sha256').update('manifest-' + Date.now()).digest(); for (let i = 0; i < VERIFY; i++) toVerify.add(allPaths[(rnd[i % 32] * 7919 + i * 104729) % allPaths.length]); }
let vOk = 0, vBad = [];
let expectedWrong = 0, aliasChecked = 0;
for (const p of toVerify) {
  const a = alias.get(p);
  const target = a ? first.get(a.repaired) : first.get(p);
  const want = a ? a.sha : target.h;
  let got; try { got = resolveSha(target); } catch (err) { vBad.push(p + ' resolve-error ' + err.message); continue; }
  if (got === want) { vOk++; if (a) aliasChecked++; } else { vBad.push((a ? 'alias->' + a.repaired + ' ' : '') + p + ' got=' + got.slice(0, 12) + ' want=' + want.slice(0, 12)); }
  if (a) { try { if (resolveSha(first.get(p)) !== a.sha) expectedWrong++; } catch (e2) { expectedWrong++; } }
}
// 重复路径的后续条目也自检：用该条目自己的 chunk 引用重算 sha，与条目自身的 h 比对。
// 这样 `--verify N` 覆盖的是"条目"而不只是"唯一路径的首次条目"。
let xOk = 0, xAmbig = 0; const xBad = [];
if (VERIFY > 0 && extras.length > 0) {
  const rnd2 = crypto.createHash('sha256').update('manifest-extras-' + Date.now()).digest();
  const n = Math.min(VERIFY, extras.length);
  for (let i = 0; i < n; i++) {
    const e = extras[(rnd2[i % 32] * 256 + rnd2[(i + 3) % 32]) % extras.length];
    // 引用了重复出现的 chunk id 的条目无法自证：条目只记录 id，不记录它指的是哪一条 chunk 行
    if (e.refs.some((r) => shadowedChunk.has(Number(r[0])))) { xAmbig++; continue; }
    let got; try { got = resolveSha(e); } catch (err) { xBad.push(e.p + ' resolve-error ' + err.message); continue; }
    if (got === e.h) xOk++; else xBad.push(e.p + ' extra got=' + got.slice(0, 12) + ' want=' + e.h.slice(0, 12));
  }
}
const lines = [];
let aliased = 0;
for (const [p, e] of first) {
  const a = alias.get(p);
  if (a) aliased++;
  lines.push(JSON.stringify({ t: 'e', p, s: a ? a.bytes : e.s, m: e.m, h: a ? a.sha : e.h, ...(a ? { a: a.repaired } : {}) }));
}
fs.writeFileSync(OUT, lines.join('\n'));
fs.writeFileSync(FRESH, lines.join('\n'));
// 别名表单独一份 JSON，供 work/restore-history.ps1 读取（逐行解析 manifest 太脆）
const aliasObj = {};
for (const [p, a] of alias) aliasObj[p] = a.repaired;
fs.writeFileSync(ALIASES, JSON.stringify(aliasObj, null, 1));
const summary = { ok: vBad.length === 0 && xBad.length === 0, action: 'manifest', archive: ARCHIVE, duplicateEntries: extras.length, shadowedChunkIds: [...shadowedChunk], verifyExtras: xOk, verifyExtrasAmbiguous: xAmbig, verifyExtrasFailed: xBad.length,
  fresh: FRESH, aliases: ALIASES, archiveBytes: fs.statSync(ARCHIVE).size, chunkLines, entryLines, uniquePaths: first.size, aliased, aliasChecked, expectedWrong, out: OUT, outBytes: fs.statSync(OUT).size, verified: vOk, verifyFailed: vBad.length, bad: vBad.slice(0, 10) };
/*
 * The same numbers as a file, so a reader who only wants the shape of the
 * archive - how many entries, how many of them repeat a path - never has to
 * re-scan 300 MB to learn it.
 */
fs.writeFileSync(arg('stats', path.join(path.dirname(OUT), 'history-manifest-stats.json')), JSON.stringify({
  archiveBytes: summary.archiveBytes, entryLines: summary.entryLines, uniquePaths: summary.uniquePaths,
  duplicateEntries: summary.duplicateEntries, shadowedChunkIds: summary.shadowedChunkIds,
  verified: summary.verified, verifyFailed: summary.verifyFailed, aliased: summary.aliased,
  generatedAt: new Date().toISOString()
}, null, 1));
console.log(QUIET ? JSON.stringify({ ok: summary.ok, action: summary.action, uniquePaths: summary.uniquePaths, aliased: summary.aliased, outBytes: summary.outBytes, archiveBytes: summary.archiveBytes, verifyFailed: summary.verifyFailed }) : JSON.stringify(summary, null, 1));
/*
 * The sync log is the only place that says what the archive looked like
 * after a cycle, and sync-history.mjs writes there. A manifest rebuild that
 * stayed silent left the log claiming a stale manifest, so it appends its
 * own record here too - same file, same one-line-per-event shape.
 */
const LOG = arg('log', path.join(path.dirname(OUT), 'history-sync.log'));
try {
  fs.appendFileSync(LOG, JSON.stringify({ ok: summary.ok, action: 'manifest', uniquePaths: summary.uniquePaths, aliased: summary.aliased, outBytes: summary.outBytes, archiveBytes: summary.archiveBytes, verifyFailed: summary.verifyFailed }) + '\n', 'utf8');
} catch (e) { /* a read-only log must not fail a rebuild that already succeeded */ }
if (vBad.length > 0) process.exit(2);
