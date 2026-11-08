// work/verify-archive.mjs —— 归档自洽校验（Lead 2026-10-06）
// 每条 entry 自带 sha256 与 [chunkId, off, len] 定位。本脚本只做一件事：按"首个同 id 分块"约定
// 还原每条 entry 的字节，重算 sha256 与条目自带 h 比对。凡是引用唯一 id 的条目必须命中；
// 引用历史重复 id(116/127) 的条目属已知歧义，由 work/archive-resolution-map.json 的 -r1 副本取代。
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import readline from 'node:readline';

const ARCH = process.argv[2] || 'history/history.jsonl';
const HEADER = 4096;
const DUP = new Set([116, 127]);
const eRx = /^\{"t":"e","p":"((?:[^"\\]|\\.)*)","s":(\d+),"m":(\d+),"h":"([0-9a-f]{64})","g":(.*)\}$/;

const rl = readline.createInterface({ input: fs.createReadStream(ARCH, { start: HEADER }), crlfDelay: Infinity });
const byId = new Map();      // id -> first decompressed buffer
const firstLine = new Map(); // id -> {i,n,d}
let chunks = 0, chunkLines = 0, entries = 0, okUnique = 0, badUnique = 0, dupRefs = 0, okDup = 0;
const bad = [], dupPaths = new Map();
for await (const line of rl) {
  if (line.startsWith('{"t":"c"')) {
    chunkLines++;
    const j = JSON.parse(line);
    if (!firstLine.has(j.i)) firstLine.set(j.i, j);
    continue;
  }
  if (!line.startsWith('{"t":"e"')) continue;
  entries++;
  const m = line.match(eRx);
  if (!m) { bad.push({ p: 'PARSE-FAIL', line: line.slice(0, 80) }); badUnique++; continue; }
  const g = JSON.parse(m[5]);
  const needsDup = g.some(([id]) => DUP.has(id));
  const bufs = [];
  let unresolved = false;
  for (const [id, off, len] of g) {
    let raw = byId.get(id);
    if (!raw) {
      const src = firstLine.get(id);
      if (!src) { unresolved = true; break; }
      raw = zlib.brotliDecompressSync(Buffer.from(src.d, 'base64'));
      byId.set(id, raw);
      if (byId.size > 4) byId.delete(byId.keys().next().value);
    }
    bufs.push(raw.subarray(off, off + len));
  }
  if (unresolved) { bad.push({ p: m[1], why: 'chunk missing' }); badUnique++; continue; }
  const got = crypto.createHash('sha256').update(Buffer.concat(bufs)).digest('hex');
  if (got === m[4]) { if (needsDup) { okDup++; } else okUnique++; }
  else {
    if (needsDup) { dupRefs++; if (!dupPaths.has(m[1])) dupPaths.set(m[1], []); dupPaths.get(m[1]).push(got.slice(0, 12)); }
    else { badUnique++; bad.push({ p: m[1], want: m[4].slice(0, 12), got: got.slice(0, 12), s: +m[2] }); }
  }
}
const out = { archive: ARCH, bytes: fs.statSync(ARCH).size, chunkLines, entries, okUnique, badUnique, duplicateIdRefs: dupRefs, okDuplicateResolved: okDup, dupPaths: dupPaths.size, bad: bad.slice(0, 20) };
console.log(JSON.stringify(out, null, 1));
console.log(badUnique === 0 ? 'ARCHIVE-SELFCHECK-PASS' : 'ARCHIVE-SELFCHECK-FAIL');
process.exit(badUnique === 0 ? 0 : 1);
