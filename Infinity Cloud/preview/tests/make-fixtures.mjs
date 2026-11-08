#!/usr/bin/env node
// make-fixtures.mjs - the files the preview tests read, built here so a run
// needs nothing from a network or an account.
//
//   small.txt    2 MiB of numbered lines (more lines than the 20000 ceiling)
//   big.bin      5 MiB, deterministic pseudo-random
//   retry.bin    1000 bytes, used with a server that fails the first requests
//   slow.bin     1000 bytes, delayed 2 s (the short timeout test)
//   slow8.bin    1000 bytes, delayed 9 s (the real 8 s default)
//   cancel.bin   1000 bytes, never requested by a cancelled read
//   cancelpart.bin / cancelpart2.bin  the two parts of the in-flight cancelled
//                read; the second one is delayed by the range server
//   sample.zip   four entries (deflate, stored, a 700 KiB deflate, an empty
//                stored one) with a 200-byte comment that contains the EOCD
//                signature, so a parser that searches forward finds garbage
//   descriptor.zip  two entries written with a data descriptor (flag bit 3)
//   zip64.zip    a zip64 end of central directory record plus one zip64 entry
//   zip64bad.zip an entry that declares zip64 but has no extra field
//
// <name>.json carries every entry's sizes, crc, local-header offset, data
// offset and the two extra-field lengths; manifest.json carries sizes and
// sha256 for everything. The zip writer and crc32 are here, not in a
// dependency.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '_fixtures');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function xorshift(seed) {
  let x = seed >>> 0;
  return function () {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x & 0xFF;
  };
}

function bytes(fn, n) {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = fn(i);
  return b;
}

function textLines(lines) {
  let out = '';
  for (let i = 0; i < lines; i++) out += 'line ' + String(i).padStart(6, '0') + ' ' + 'x'.repeat(64) + '\n';
  return Buffer.from(out, 'utf8');
}

function write(name, buf) {
  writeFileSync(join(dir, name), buf);
  return buf;
}

// ------------------------------------------------------------------ the zip

// A minimal zip writer with the options the fixtures need to go past the
// simplest case:
//   e.descriptor  flag bit 3: local crc/sizes are zero and the crc plus the two
//                 sizes are repeated after the data in a data descriptor;
//   e.zip64       the central-directory sizes and offset are 0xFFFFFFFF and the
//                 real values live in extra field 0x0001 (local header too);
//   e.sentinel    declares zip64 in the central directory but writes no extra
//                 field - the broken case the reader has to reject;
//   options.zip64Eocd  writes the zip64 end-of-central-directory record and
//                 locator and puts 0xFFFF/0xFFFFFFFF in the plain EOCD.
function buildZip(entries, comment, options = {}) {
  const zip64Eocd = !!options.zip64Eocd;
  const body = [];       // local header + name + extra + data (+ descriptor)
  const centralDir = []; // central header + name + extra, per entry
  const meta = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = e.data;
    const stored = e.method === 0 ? data : deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const descriptor = !!e.descriptor;
    const zip64 = !!e.zip64;
    const sentinel = !!e.sentinel;
    // Both a zip64 entry and a data descriptor change the size of the local
    // header or the bytes after the data, which is what moves dataOffset.
    const local64 = zip64 ? Buffer.alloc(4 + 16) : Buffer.alloc(0);
    if (local64.length) {
      local64.writeUInt16LE(0x0001, 0);
      local64.writeUInt16LE(16, 2);
      local64.writeBigUInt64LE(BigInt(data.length), 4);
      local64.writeBigUInt64LE(BigInt(stored.length), 12);
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(zip64 ? 45 : 20, 4);
    local.writeUInt16LE(descriptor ? 0x0008 : 0, 6);
    local.writeUInt16LE(e.method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(descriptor ? 0 : crc, 14);
    local.writeUInt32LE(zip64 ? 0xFFFFFFFF : (descriptor ? 0 : stored.length), 18);
    local.writeUInt32LE(zip64 ? 0xFFFFFFFF : (descriptor ? 0 : data.length), 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(local64.length, 28);
    body.push(local, name, local64, stored);
    const headerOffset = offset;
    const dataOffset = headerOffset + 30 + name.length + local64.length;
    let descriptorBytes = Buffer.alloc(0);
    if (descriptor) {
      // The signature makes the descriptor findable; zip64 sizes are 8 bytes.
      descriptorBytes = Buffer.alloc(zip64 ? 4 + 4 + 8 + 8 : 4 + 4 + 4 + 4);
      descriptorBytes.writeUInt32LE(0x08074b50, 0);
      descriptorBytes.writeUInt32LE(crc, 4);
      if (zip64) {
        descriptorBytes.writeBigUInt64LE(BigInt(stored.length), 8);
        descriptorBytes.writeBigUInt64LE(BigInt(data.length), 16);
      } else {
        descriptorBytes.writeUInt32LE(stored.length, 8);
        descriptorBytes.writeUInt32LE(data.length, 12);
      }
      body.push(descriptorBytes);
    }

    const centralSentinel = zip64 || sentinel;
    const central64 = zip64 ? Buffer.alloc(4 + 24) : Buffer.alloc(0);
    if (central64.length) {
      central64.writeUInt16LE(0x0001, 0);
      central64.writeUInt16LE(24, 2);
      central64.writeBigUInt64LE(BigInt(data.length), 4);
      central64.writeBigUInt64LE(BigInt(stored.length), 12);
      central64.writeBigUInt64LE(BigInt(headerOffset), 20);
    }
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(zip64 ? 45 : 20, 4);
    central.writeUInt16LE(zip64 ? 45 : 20, 6);
    central.writeUInt16LE(descriptor ? 0x0008 : 0, 8);
    central.writeUInt16LE(e.method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(centralSentinel ? 0xFFFFFFFF : stored.length, 20);
    central.writeUInt32LE(centralSentinel ? 0xFFFFFFFF : data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(central64.length, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(centralSentinel ? 0xFFFFFFFF : headerOffset, 42);
    meta.push({ name: e.name, method: e.method, compressed: stored.length, uncompressed: data.length,
                crc, headerOffset, dataOffset, localExtraLen: local64.length,
                centralExtraLen: central64.length, descriptor, zip64, placeholder: centralSentinel && !zip64 });
    centralDir.push(central, name, central64);
    offset += 30 + name.length + local64.length + stored.length + descriptorBytes.length;
  }
  const cdOffset = offset;
  const centralBytes = Buffer.concat(centralDir);
  const parts = [...body, centralBytes];
  let entryCount = entries.length;
  let eocdCdSize = centralBytes.length;
  let eocdCdOffset = cdOffset;
  if (zip64Eocd) {
    const recordOffset = cdOffset + centralBytes.length;
    const z64 = Buffer.alloc(56);
    z64.writeUInt32LE(0x06064b50, 0);
    z64.writeBigUInt64LE(44n, 4);
    z64.writeUInt16LE(45, 12);
    z64.writeUInt16LE(45, 14);
    z64.writeUInt32LE(0, 16);
    z64.writeUInt32LE(0, 20);
    z64.writeBigUInt64LE(BigInt(entries.length), 24);
    z64.writeBigUInt64LE(BigInt(entries.length), 32);
    z64.writeBigUInt64LE(BigInt(centralBytes.length), 40);
    z64.writeBigUInt64LE(BigInt(cdOffset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeUInt32LE(0, 4);
    locator.writeBigUInt64LE(BigInt(recordOffset), 8);
    locator.writeUInt32LE(1, 16);
    parts.push(z64, locator);
    entryCount = 0xFFFF;
    eocdCdSize = 0xFFFFFFFF;
    eocdCdOffset = 0xFFFFFFFF;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entryCount, 8);
  eocd.writeUInt16LE(entryCount, 10);
  eocd.writeUInt32LE(eocdCdSize, 12);
  eocd.writeUInt32LE(eocdCdOffset, 16);
  eocd.writeUInt16LE(comment.length, 20);
  return { buf: Buffer.concat([...parts, eocd, comment]), meta };
}

// ------------------------------------------------------------------ build

const small = write('small.txt', textLines(28000));
const big = write('big.bin', bytes(xorshift(0x12345678), 5 * 1024 * 1024));
write('retry.bin', bytes((i) => i & 0xFF, 1000));
write('slow.bin', bytes((i) => (i * 7) & 0xFF, 1000));
write('slow8.bin', bytes((i) => (i * 11) & 0xFF, 1000));
write('cancel.bin', bytes((i) => (i * 13) & 0xFF, 1000));
write('cancel2.bin', bytes((i) => (i * 17) & 0xFF, 1000));
// cancelpart.bin is the fast first part of the two-part cancelled read, and
// cancelpart2.bin is the delayed second part, cancelled while in flight.
write('cancelpart.bin', bytes((i) => (i * 19) & 0xFF, 1000));
write('cancelpart2.bin', bytes((i) => (i * 23) & 0xFF, 1000));

const hello = Buffer.from(Array.from({ length: 60 }, (_, i) => 'hello line ' + i).join('\n') + '\n', 'utf8');
const stored = Buffer.from('this entry is stored, not deflated\n'.repeat(30), 'utf8');
const dataBin = bytes(xorshift(0x9E3779B9), 700 * 1024);
const comment = Buffer.concat([
  Buffer.from('PK\u0005\u0006 a comment that contains the end-of-central-directory signature ', 'latin1'),
  Buffer.alloc(200 - 74, 0x41)
]);

const zipped = buildZip([
  { name: 'hello.txt', method: 8, data: hello },
  { name: 'stored.txt', method: 0, data: stored },
  { name: 'data.bin', method: 8, data: dataBin },
  { name: 'empty.txt', method: 0, data: Buffer.alloc(0) }
], comment);

const zipBytes = write('sample.zip', zipped.buf);
writeFileSync(join(dir, 'sample.zip.json'), JSON.stringify({
  size: zipBytes.length,
  commentBytes: comment.length,
  entries: zipped.meta
}, null, 2));

// Data-descriptor entries: flag bit 3 is set, the local crc and sizes are zero,
// and the crc plus the two sizes are repeated after the data. The central
// directory carries the real values, which is what a reader uses.
const descComment = Buffer.from('data descriptor fixture\n', 'latin1');
const descStored = bytes(xorshift(0x0BADF00D), 300 * 1024);
const descriptorZip = buildZip([
  { name: 'desc-hello.txt', method: 8, data: hello, descriptor: true },
  { name: 'desc-stored.bin', method: 0, data: descStored, descriptor: true }
], descComment);
const descriptorBytes = write('descriptor.zip', descriptorZip.buf);
writeFileSync(join(dir, 'descriptor.zip.json'), JSON.stringify({
  size: descriptorBytes.length,
  commentBytes: descComment.length,
  entries: descriptorZip.meta
}, null, 2));

// A zip64 archive: the plain EOCD holds 0xFFFF/0xFFFFFFFF and the real
// directory size and offset live in the zip64 end-of-central-directory record.
// One entry is zip64 as well, so both levels are exercised at once.
const zip64Comment = Buffer.from('zip64 fixture\n', 'latin1');
const zip64Big = bytes(xorshift(0x5A5A1234), 700 * 1024);
const zip64Zip = buildZip([
  { name: 'z64-hello.txt', method: 8, data: hello },
  { name: 'z64-big.bin', method: 8, data: zip64Big, zip64: true }
], zip64Comment, { zip64Eocd: true });
const zip64Bytes = write('zip64.zip', zip64Zip.buf);
writeFileSync(join(dir, 'zip64.zip.json'), JSON.stringify({
  size: zip64Bytes.length,
  commentBytes: zip64Comment.length,
  zip64Eocd: true,
  entries: zip64Zip.meta
}, null, 2));

// An archive that declares an entry zip64 in the central directory but writes
// no extra field. A reader must reject it with a zip64 error, never hand out
// 0xFFFFFFFF as if it were a size.
const zip64BadComment = Buffer.from('zip64 bad fixture\n', 'latin1');
const zip64Bad = buildZip([
  { name: 'bad-declared.bin', method: 0, data: Buffer.from('declared zip64, no extra field', 'utf8'),
    sentinel: true }
], zip64BadComment);
const zip64BadBytes = write('zip64bad.zip', zip64Bad.buf);
writeFileSync(join(dir, 'zip64bad.zip.json'), JSON.stringify({
  size: zip64BadBytes.length,
  commentBytes: zip64BadComment.length,
  expectRejected: true,
  entries: zip64Bad.meta
}, null, 2));

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const zipInfo = zipped.meta.find((e) => e.name === 'hello.txt');
const rawMemo = { hello: createHash('sha256').update(hello).digest('hex') };
writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
  files: {
    'small.txt': { size: small.length, sha256: sha(small), lines: 28000 },
    'big.bin': { size: big.length, sha256: sha(big) },
    'retry.bin': { size: 1000, sha256: sha(readFileSync(join(dir, 'retry.bin'))) },
    'slow.bin': { size: 1000, sha256: sha(readFileSync(join(dir, 'slow.bin'))) },
    'slow8.bin': { size: 1000, sha256: sha(readFileSync(join(dir, 'slow8.bin'))) },
    'cancel.bin': { size: 1000, sha256: sha(readFileSync(join(dir, 'cancel.bin'))) },
    'cancel2.bin': { size: 1000, sha256: sha(readFileSync(join(dir, 'cancel2.bin'))) },
    'cancelpart.bin': { size: 1000, sha256: sha(readFileSync(join(dir, 'cancelpart.bin'))) },
    'cancelpart2.bin': { size: 1000, sha256: sha(readFileSync(join(dir, 'cancelpart2.bin'))) },
    'sample.zip': { size: zipBytes.length, sha256: sha(zipBytes) },
    'descriptor.zip': { size: descriptorBytes.length, sha256: sha(descriptorBytes) },
    'zip64.zip': { size: zip64Bytes.length, sha256: sha(zip64Bytes) },
    'zip64bad.zip': { size: zip64BadBytes.length, sha256: sha(zip64BadBytes) }
  },
  zip: 'sample.zip',
  helloPlainSha256: rawMemo.hello,
  helloCompressed: zipInfo.compressed,
  helloDataOffset: zipInfo.dataOffset
}, null, 2));

console.log('fixtures in ' + dir);
for (const name of ['small.txt', 'big.bin', 'retry.bin', 'slow.bin', 'slow8.bin', 'cancel.bin', 'cancel2.bin',
                    'cancelpart.bin', 'cancelpart2.bin', 'sample.zip', 'descriptor.zip', 'zip64.zip', 'zip64bad.zip']) {
  const buf = readFileSync(join(dir, name));
  console.log(name.padEnd(12) + ' bytes=' + buf.length + ' sha256=' + sha(buf));
}
console.log('sample.zip entries: ' + zipped.meta.map((e) => e.name + '(' + e.method + ',' + e.compressed + ')').join(' '));
console.log('sample.zip comment bytes: ' + comment.length + ' (contains the EOCD signature)');
console.log('descriptor.zip entries: ' + descriptorZip.meta.map((e) => e.name + '(desc=' + e.descriptor + ',extra=' + e.localExtraLen + ')').join(' '));
console.log('zip64.zip entries: ' + zip64Zip.meta.map((e) => e.name + '(zip64=' + e.zip64 + ',extra=' + e.localExtraLen + ')').join(' '));
console.log('zip64bad.zip: ' + zip64BadBytes.length + ' bytes, entry declares zip64 without an extra field');
