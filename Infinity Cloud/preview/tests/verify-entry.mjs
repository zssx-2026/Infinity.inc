#!/usr/bin/env node
// verify-entry.mjs - checks one entry that the harness pulled out of sample.zip.
//
// The harness read the central directory, then the entry's local header, then
// exactly the compressed bytes of that entry - nothing else in the archive. The
// proof that those bytes are the entry is the crc recorded in the central
// directory: inflate them and the crc must match, and the length must match.
//
//   node verify-entry.mjs --zip <sample.zip> --expected <sample.zip.json>
//                         --entry <name> --bytes <file> [--out <json>]

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const entryName = arg('--entry');
const bytesPath = arg('--bytes');
const expectedPath = arg('--expected');
const outPath = arg('--out');

const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
const want = expected.entries.find((e) => e.name === entryName);
const compressed = readFileSync(bytesPath);

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

let inflated;
let error = '';
try {
  inflated = want.method === 0 ? compressed : inflateRawSync(compressed);
} catch (e) {
  error = e.message;
}

const gotCrc = inflated ? crc32(inflated) : 0;
const sizeOk = !!inflated && inflated.length === want.uncompressed;
const bytesOk = compressed.length === want.compressed;
const crcOk = !!inflated && gotCrc === want.crc;
const sha = inflated ? createHash('sha256').update(inflated).digest('hex') : '';
const pass = sizeOk && bytesOk && crcOk && !error;

const report = { entry: entryName, method: want.method, compressedBytes: compressed.length,
                 expectedCompressed: want.compressed, inflatedBytes: inflated ? inflated.length : 0,
                 expectedUncompressed: want.uncompressed, crc: gotCrc, expectedCrc: want.crc,
                 sha256: sha, sizeOk, bytesOk, crcOk, error, pass };
if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
process.exit(pass ? 0 : 1);
