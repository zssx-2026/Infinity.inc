// itbt-verify.mjs - independent reader for .itbt, written from work/ITBT-FORMAT.md.
// Uses Node's crypto for SHA-256 so the check does not share code with the C++ packer.
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

function hexdump(buf, n = 64) {
  const lines = [];
  for (let i = 0; i < Math.min(n, buf.length); i += 16) {
    const row = buf.subarray(i, Math.min(i + 16, buf.length));
    const hex = [...row].map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = [...row].map(b => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  |${ascii}|`);
  }
  return lines.join('\n');
}

const file = process.argv[2];
const buf = readFileSync(file);
const fail = [];
const ok = (cond, msg) => { if (!cond) fail.push(msg); };

ok(buf.length >= 20, 'shorter than the fixed header');
ok(buf.toString('latin1', 0, 4) === 'ITBT', 'magic is not ITBT');
ok(buf.readUInt16LE(4) === 1, 'version != 1');
const flags = buf.readUInt16LE(6);
const headerSize = buf.readUInt32LE(8);
const entryCount = buf.readUInt32LE(12);
const totalSize = buf.readUInt32LE(16);
ok(totalSize === buf.length, `totalSize ${totalSize} != file size ${buf.length}`);

let p = 20;
const rd = (n) => { const s = buf.subarray(p, p + n); p += n; return s; };
const rdU16 = () => { const v = buf.readUInt16LE(p); p += 2; return v; };
const rdStr = () => { const n = rdU16(); return rd(n).toString('utf8'); };
const name = rdStr(), version = rdStr(), exe = rdStr();

const entries = [];
for (let i = 0; i < entryCount; i++) {
  const path = rdStr();
  const offset = Number(buf.readBigUInt64LE(p)); p += 8;
  const storedSize = Number(buf.readBigUInt64LE(p)); p += 8;
  const rawSize = Number(buf.readBigUInt64LE(p)); p += 8;
  const sha = rd(32).toString('hex');
  const compression = rd(1)[0];
  entries.push({ path, offset, storedSize, rawSize, sha, compression });
}
ok(p === headerSize, `entry table ends at ${p}, headerSize says ${headerSize}`);
ok(headerSize <= buf.length, 'headerSize beyond end of file');

console.log('== hexdump (first 64 bytes) ==');
console.log(hexdump(buf, 64));
console.log('== header ==');
console.log(`magic=ITBT version=1 flags=${flags} headerSize=${headerSize} entryCount=${entryCount} totalSize=${totalSize}`);
console.log(`name="${name}" version="${version}" exe="${exe}"`);
console.log('== entries ==');
let bad = 0;
for (const e of entries) {
  const safe = !e.path.startsWith('/') && !e.path.includes('\\') && !e.path.split('/').some(c => c === '..' || c === '.' || c === '');
  const inBounds = e.offset + e.storedSize <= buf.length;
  const payload = inBounds ? buf.subarray(e.offset, e.offset + e.storedSize) : Buffer.alloc(0);
  const actual = createHash('sha256').update(payload).digest('hex');
  const shaOk = actual === e.sha;
  const sizeOk = e.compression === 1 ? true : e.storedSize === e.rawSize;
  const good = safe && inBounds && shaOk && (e.compression === 0 || e.compression === 1) && sizeOk;
  if (!good) bad++;
  console.log(`${good ? 'OK  ' : 'BAD '} ${e.path}  offset=${e.offset} stored=${e.storedSize} raw=${e.rawSize} comp=${e.compression} sha256=${e.sha}`);
  if (!safe) console.log('     unsafe path');
  if (!inBounds) console.log('     payload out of bounds');
  if (!shaOk) console.log(`     sha mismatch: payload hashes to ${actual}`);
}
if (bad) fail.push(`${bad} entr${bad === 1 ? 'y' : 'ies'} failed`);
if (fail.length) { console.log('== RESULT: FAIL =='); for (const f of fail) console.log(' - ' + f); process.exit(1); }
console.log('== RESULT: PASS ==');
