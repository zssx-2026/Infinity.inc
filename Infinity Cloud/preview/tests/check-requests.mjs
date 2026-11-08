#!/usr/bin/env node
// check-requests.mjs - reads the range server's request log and checks the
// properties that are visible only on the wire:
//
//   * no Range request is wider than one 256 KiB window;
//   * a 3-window read really is 3 requests, a 5 MiB file really is 20;
//   * a failed read retries twice, and no more (3 attempts);
//   * a cancelled read asks for nothing at all;
//   * listing a zip asks for exactly the last 64 KiB first;
//   * pulling one entry reads its header and then only that entry's bytes.
//
//   node check-requests.mjs --log <requests.jsonl> --expected <sample.zip.json>
//                           [--out <json>]

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const logPath = arg('--log');
const expectedPath = arg('--expected');
const outPath = arg('--out');
const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
const rows = readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const byPath = new Map();
for (const r of rows) {
  if (!byPath.has(r.path)) byPath.set(r.path, []);
  byPath.get(r.path).push(r);
}
const forPath = (p) => byPath.get(p) || [];

const results = [];
function check(name, pass, detail) {
  results.push({ test: name, pass, detail });
}

const violations = rows.filter((r) => r.violation);
check('no-range-wider-than-262144', violations.length === 0,
      'violations=' + violations.length + ' requests=' + rows.length);

const okOnly = rows.filter((r) => r.status === 206);
const tooWide = okOnly.filter((r) => r.span > 262144);
check('every-206-is-one-window', tooWide.length === 0, '206s=' + okOnly.length + ' over-wide=' + tooWide.length);

// small.txt: 1 window + 3 windows = 4 requests, every span a full window.
const small = forPath('small.txt');
check('small.txt-four-windows', small.length === 4 && small.every((r) => r.span === 262144),
      'requests=' + small.length + ' spans=' + small.map((r) => r.span).join(','));

// big.bin: 5 MiB / 256 KiB = 20 requests, exactly, covering the whole file.
const big = forPath('big.bin');
const bigSum = big.reduce((a, r) => a + r.sent, 0);
check('big.bin-twenty-windows', big.length === 20 && bigSum === 5242880,
      'requests=' + big.length + ' bytes=' + bigSum);

// retry.bin: the server fails the first two, the third must succeed.
const retry = forPath('retry.bin');
check('retry-three-attempts', retry.length === 3 && retry[0].status === 503 && retry[1].status === 503 &&
      retry[2].status === 206,
      'statuses=' + retry.map((r) => r.status).join(','));

// slow.bin: the delayed path; three attempts, none of them a success.
const slow = forPath('slow.bin');
check('timeout-three-attempts', slow.length === 3 && slow.every((r) => r.status === 206),
      'attempts=' + slow.length + ' (each answered after the client gave up)');

const slow8 = forPath('slow8.bin');
if (slow8.length) {
  check('timeout-8s-three-attempts', slow8.length === 3, 'attempts=' + slow8.length);
}

// cancel.bin: a cancelled read never opens a socket.
check('cancel-asks-for-nothing', forPath('cancel.bin').length === 0,
      'requests=' + forPath('cancel.bin').length);

// cancel2.bin: the request was in flight when the cancel arrived, so the server
// sees exactly one, and no retry follows it.
check('cancel-in-flight-one-request', forPath('cancel2.bin').length === 1,
      'requests=' + forPath('cancel2.bin').length);

// cancelpart.bin / cancelpart2.bin: the two-part read whose second request is
// cancelled in flight. The first window was sent, and the cancelled one is not
// retried - the read stopped instead of writing more.
check('cancel-partial-first-one-request', forPath('cancelpart.bin').length === 1,
      'requests=' + forPath('cancelpart.bin').length);
check('cancel-partial-second-one-request', forPath('cancelpart2.bin').length === 1,
      'requests=' + forPath('cancelpart2.bin').length);

// sample.zip: the very first request is the 64 KiB tail.
const zip = forPath('sample.zip');
const zipSize = expected.size;
const first = zip[0];
// Every listing starts with the tail, so a later test's tail read must not be
// mistaken for that entry's data.
const isTail = (r) => r.start === zipSize - 65536 && r.span === 65536;
check('zip-tail-first-64k', !!first && first.start === zipSize - 65536 && first.span === 65536,
      first ? ('start=' + first.start + ' span=' + first.span + ' size=' + zipSize) : 'no request');

// One entry pulled on demand: header at headerOffset (30 bytes), then its bytes
// at dataOffset, in windows. Nothing between the tail and that entry.
for (const name of ['hello.txt', 'stored.txt', 'data.bin']) {
  const want = expected.entries.find((e) => e.name === name);
  const header = zip.find((r) => r.start === want.headerOffset && r.span === 30);
  const data = zip.filter((r) => !isTail(r) && r.start >= want.dataOffset &&
                                 r.start < want.dataOffset + want.compressed);
  const dataBytes = data.reduce((a, r) => a + r.sent, 0);
  const dataWindows = data.every((r) => r.span <= 262144);
  check('zip-entry-' + name, !!header && dataBytes === want.compressed && dataWindows,
        'header=' + (header ? 'yes' : 'no') + ' dataBytes=' + dataBytes + ' want=' + want.compressed +
        ' windows=' + data.length + ' (<=262144 each: ' + dataWindows + ')');
}

// The tail read itself touched only the last 64 KiB: any other sample.zip
// request must be one of the entry reads checked above.
const entryRanges = [];
for (const e of expected.entries) {
  entryRanges.push([e.headerOffset, e.headerOffset + 30]);
  entryRanges.push([e.dataOffset, e.dataOffset + e.compressed]);
}
const insideEntry = (r) => isTail(r) || entryRanges.some(([a, b]) => r.start >= a && r.start + r.span <= b);
const strays = zip.filter((r, i) => i > 0 && !insideEntry(r));
check('zip-tail-touches-nothing-else', strays.length === 0,
      'strays=' + strays.length + ' tailRequests=' + zip.filter((r) => r.start === zipSize - 65536 && r.span === 65536).length);

// The same wire rules for the two archives that exercise the harder zip
// features. A data descriptor sits between an entry's data and the next local
// header, so a reader that read past the central directory's compressed size
// would touch it; "touches-nothing-else" catches that.
function checkZipWire(label, zipName, jsonName, entryNames) {
  const exp = JSON.parse(readFileSync(join(dirname(expectedPath), jsonName), 'utf8'));
  const rows = forPath(zipName);
  const isTail = (r) => r.start === exp.size - 65536 && r.span === 65536;
  const first = rows[0];
  check(label + '-tail-first-64k', !!first && isTail(first),
        first ? ('start=' + first.start + ' span=' + first.span + ' size=' + exp.size) : 'no request');
  const ranges = [];
  for (const e of exp.entries) {
    ranges.push([e.headerOffset, e.headerOffset + 30]);
    ranges.push([e.dataOffset, e.dataOffset + e.compressed]);
  }
  for (const name of entryNames) {
    const want = exp.entries.find((e) => e.name === name);
    const header = rows.find((r) => r.start === want.headerOffset && r.span === 30);
    const data = rows.filter((r) => !isTail(r) && r.start >= want.dataOffset &&
                                   r.start < want.dataOffset + want.compressed);
    const dataBytes = data.reduce((a, r) => a + r.sent, 0);
    check(label + '-entry-' + name,
          !!header && dataBytes === want.compressed && data.every((r) => r.span <= 262144),
          'header=' + (header ? 'yes' : 'no') + ' dataBytes=' + dataBytes + ' want=' + want.compressed +
          ' windows=' + data.length);
  }
  const strays = rows.filter((r, i) => i > 0 && !isTail(r) &&
    !ranges.some(([a, b]) => r.start >= a && r.start + r.span <= b));
  check(label + '-touches-nothing-else', strays.length === 0, 'strays=' + strays.length);
}

checkZipWire('descriptor.zip', 'descriptor.zip', 'descriptor.zip.json', ['desc-stored.bin']);
checkZipWire('zip64.zip', 'zip64.zip', 'zip64.zip.json', ['z64-hello.txt', 'z64-big.bin']);

// The fixtures must really carry the features they are named for, or the checks
// above would pass on an ordinary archive.
{
  const desc = JSON.parse(readFileSync(join(dirname(expectedPath), 'descriptor.zip.json'), 'utf8'));
  const z64 = JSON.parse(readFileSync(join(dirname(expectedPath), 'zip64.zip.json'), 'utf8'));
  check('zip-fixture-descriptor-entry', desc.entries.some((e) => e.descriptor === true),
        'descriptor entries=' + desc.entries.filter((e) => e.descriptor).length);
  check('zip-fixture-zip64-eocd', z64.zip64Eocd === true && z64.entries.some((e) => e.zip64 === true),
        'zip64Eocd=' + z64.zip64Eocd + ' zip64 entries=' + z64.entries.filter((e) => e.zip64).length);
}

const fail = results.filter((r) => !r.pass).length;
if (outPath) writeFileSync(outPath, JSON.stringify({ results, requests: rows.length, fail }, null, 2));
for (const r of results) console.log(JSON.stringify(r));
console.log(JSON.stringify({ test: 'wire-summary', pass: fail === 0, fail, requests: rows.length }));
process.exit(fail === 0 ? 0 : 1);
