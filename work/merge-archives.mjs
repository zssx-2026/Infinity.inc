import fs from 'node:fs';
import readline from 'node:readline';

const [A, Bp, OUT] = process.argv.slice(2);
const HEADER_BYTES = 4096;

function firstLine(p) {
  const fd = fs.openSync(p, 'r');
  const buf = Buffer.alloc(8192);
  const n = fs.readSync(fd, buf, 0, 8192, 0);
  fs.closeSync(fd);
  const s = buf.subarray(0, n).toString('utf8');
  return s.slice(0, s.indexOf('\n'));
}
const hA = JSON.parse(firstLine(A));
const bLines = fs.readFileSync(Bp, 'utf8').split('\n').filter(l => l.length > 0);
const hB = JSON.parse(bLines[0]);
const bChunks = bLines.slice(1).filter(l => l.startsWith('{"t":"c"'));
const bEntries = bLines.slice(1).filter(l => l.startsWith('{"t":"e"'));
const off = Number(hA.chunks) || 0;
console.log('A: files=' + hA.files + ' chunks=' + hA.chunks + ' origBytes=' + hA.origBytes);
console.log('B: files=' + hB.files + ' chunks=' + hB.chunks + ' origBytes=' + hB.origBytes + '  chunk offset=' + off);

const fd = fs.openSync(OUT, 'w');
const hdr = Buffer.alloc(HEADER_BYTES, 0x20); hdr[HEADER_BYTES - 1] = 0x0a;
fs.writeSync(fd, hdr);
let outBytes = HEADER_BYTES;
let chunkCount = 0, pathFixed = 0;
const entries = [];

const rl = readline.createInterface({ input: fs.createReadStream(A, { highWaterMark: 1 << 24 }), crlfDelay: Infinity });
let first = true;
for await (const line of rl) {
  if (first) { first = false; continue; }
  if (!line) continue;
  if (line.startsWith('{"t":"c"')) { outBytes += fs.writeSync(fd, line + '\n'); chunkCount++; }
  else entries.push(line);
}
for (const l of bChunks) {
  const o = JSON.parse(l); o.i += off;
  outBytes += fs.writeSync(fd, JSON.stringify(o) + '\n');
  chunkCount++;
}
for (const l of entries) {
  const o = JSON.parse(l);
  if (o.p === 'history.jsonl') { o.p = 'history.jsonl.old'; pathFixed++; }
  outBytes += fs.writeSync(fd, JSON.stringify(o) + '\n');
}
for (const l of bEntries) {
  const o = JSON.parse(l);
  o.p = 'DSH/' + o.p;   // second part was packed with --root history/DSH; restore the canonical prefix
  o.g = o.g.map(([c, s, len]) => [c + off, s, len]);
  outBytes += fs.writeSync(fd, JSON.stringify(o) + '\n');
}
const header = JSON.stringify({
  f: 'Infinity.Inc history archive', v: 1, created: new Date().toISOString(),
  root: 'history', layout: 'header|chunk-lines|entry-lines', codec: 'brotli',
  quality: 10, lgwin: 24, chunkBytes: 16777216,
  files: entries.length + bEntries.length, origBytes: hA.origBytes + hB.origBytes,
  chunks: chunkCount, archiveBytes: outBytes,
  mergedFrom: ['history-archive-v1.jsonl', 'dsh-archive.jsonl.pack'],
  note: 'chunk indices of the second part are offset by ' + off + '; entry path history.jsonl renamed to history.jsonl.old (' + pathFixed + ')',
});
const hb = Buffer.from(header, 'utf8');
const hdr2 = Buffer.alloc(HEADER_BYTES, 0x20); hb.copy(hdr2, 0); hdr2[HEADER_BYTES - 1] = 0x0a;
fs.writeSync(fd, hdr2, 0, HEADER_BYTES, 0);
fs.fsyncSync(fd);
const size = fs.fstatSync(fd).size;
fs.closeSync(fd);
console.log('MERGED files=' + (entries.length + bEntries.length) + ' chunks=' + chunkCount + ' size=' + (size / 1048576).toFixed(1) + ' MB (pathsFixed=' + pathFixed + ')');