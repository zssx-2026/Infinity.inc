#!/usr/bin/env node
// ui-preview.test.mjs - the page side of the preview, checked without a browser.
//
// preview-math.js is the module the page actually runs (apply-preview.mjs
// inlines it), so the windowing that keeps the DOM small is checked here on the
// real source. The node runtime implements the same DecompressionStream the
// page uses, so a deflate-raw entry pulled by the harness can be inflated here
// exactly the way the page would.
//
//   node ui-preview.test.mjs [--out <json>]

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { deflateRawSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const previewDir = join(here, '..');
const outPath = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : '';

const results = [];
function check(name, pass, detail) {
  results.push({ test: name, pass: !!pass, detail: String(detail) });
}

const sandbox = {};
vm.runInNewContext(readFileSync(join(previewDir, 'assets', 'preview-math.js'), 'utf8'), sandbox);
const PV = sandbox.PV;

function inflateRawWebApi(buf) {
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate-raw')))
    .arrayBuffer().then((ab) => new Uint8Array(ab));
}

// ---------------------------------------------------------------- windowing
{
  const w = PV.pvWindow(20000, 0, 600, PV.PV_ROW, PV.PV_OVERSCAN);
  check('window-top', w.start === 0 && w.rows <= 100 && w.bottomPad === (20000 - w.rows) * PV.PV_ROW,
        JSON.stringify(w));
}
{
  const w = PV.pvWindow(20000, 10000 * PV.PV_ROW, 600, PV.PV_ROW, PV.PV_OVERSCAN);
  const expectedStart = 10000 - PV.PV_OVERSCAN;
  check('window-middle', w.start === expectedStart && w.topPad === expectedStart * PV.PV_ROW && w.rows <= 100,
        JSON.stringify(w));
}
{
  const w = PV.pvWindow(20000, 19999 * PV.PV_ROW, 600, PV.PV_ROW, PV.PV_OVERSCAN);
  check('window-bottom', w.end === 20000 && w.bottomPad === 0 && w.rows > 0, JSON.stringify(w));
}
check('window-empty', PV.pvWindow(0, 0, 600, 18, 8).rows === 0, JSON.stringify(PV.pvWindow(0, 0, 600, 18, 8)));
check('dom-nodes-bounded', PV.pvWindow(20000, 0, 600, 18, 8).rows <= 100,
      '20000 lines would put ' + PV.pvWindow(20000, 0, 600, 18, 8).rows + ' rows in the document');

// ---------------------------------------------------------------- byte counts
{
  let offset = 0, windows = 0, sum = 0;
  const size = 5242880;
  while (offset < size) {
    const n = PV.pvChunk(offset, size, PV.PV_CHUNK);
    if (n <= 0) break;
    windows++;
    sum += n;
    offset += n;
  }
  check('chunk-loop-5mib', windows === 20 && sum === size && offset === size,
        'windows=' + windows + ' bytes=' + sum);
}
check('chunk-never-past-end', PV.pvChunk(5242880 - 100, 5242880, PV.PV_CHUNK) === 100,
      'last window=' + PV.pvChunk(5242880 - 100, 5242880, PV.PV_CHUNK));
check('chunk-at-end-is-zero', PV.pvChunk(5242880, 5242880, PV.PV_CHUNK) === 0, 'end window');

// ---------------------------------------------------------------- zip offsets
// The page works out an entry's data offset from the local header's two
// lengths, so every archive is checked - including the one whose local header
// carries a zip64 extra field (20 bytes more) and the one written with data
// descriptors.
for (const zipName of ['sample.zip.json', 'descriptor.zip.json', 'zip64.zip.json']) {
  const zipPath = join(here, '_fixtures', zipName);
  if (!existsSync(zipPath)) continue;
  const zipExpected = JSON.parse(readFileSync(zipPath, 'utf8'));
  let allOk = true;
  const detail = [];
  for (const e of zipExpected.entries) {
    const nameLen = Buffer.byteLength(e.name, 'utf8');
    const extraLen = e.localExtraLen || 0;
    const got = PV.pvDataOffset(e.headerOffset, nameLen, extraLen);
    if (got !== e.dataOffset) allOk = false;
    detail.push(e.name + '=' + got + '/' + e.dataOffset);
  }
  const label = zipName === 'sample.zip.json' ? 'zip-data-offset'
                                               : 'zip-data-offset-' + zipName.replace('.json', '');
  check(label, allOk, detail.join(' '));
}

// ---------------------------------------------------------------- retain cap
{
  const r = PV.pvRetain([1, 2, 3], 0, [4, 5], 3);
  check('retain-ceiling', r.lines.join(',') === '3,4,5' && r.first === 2,
        'lines=' + r.lines.join(',') + ' first=' + r.first);
}

// ------------------------------------------------- DecompressionStream path
{
  const raw = Buffer.from(Array.from({ length: 200 }, (_, i) => 'line ' + i).join('\n') + '\n');
  const deflated = deflateRawSync(raw, { level: 9 });
  const out = await inflateRawWebApi(deflated);
  check('deflate-raw-roundtrip', Buffer.compare(Buffer.from(out), raw) === 0,
        'deflated=' + deflated.length + ' inflated=' + out.length + ' raw=' + raw.length);
}

// The compressed bytes the harness pulled out of sample.zip for hello.txt.
{
  const bytesPath = join(here, '_out', 'entry-hello.txt.bin');
  const manifestPath = join(here, '_fixtures', 'manifest.json');
  if (existsSync(bytesPath) && existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const compressed = readFileSync(bytesPath);
    const out = await inflateRawWebApi(compressed);
    const sha = createHash('sha256').update(out).digest('hex');
    check('page-inflates-pulled-entry', sha === manifest.helloPlainSha256,
          'compressed=' + compressed.length + ' inflated=' + out.length + ' sha256=' + sha);
  } else {
    check('page-inflates-pulled-entry', false, 'missing ' + bytesPath + ' (run the harness first)');
  }
}

// ---------------------------------------------------------------- artifacts
{
  const main = readFileSync(join(previewDir, 'generated', 'main.cpp'), 'utf8');
  const ui = readFileSync(join(previewDir, 'generated', 'ui.hpp'), 'utf8');
  const routes = ['/api/preview/meta', '/api/preview/chunk', '/api/preview/zip', '/api/preview/zip/entry',
                  '/api/preview/cancel'];
  const missing = routes.filter((r) => !main.includes(r));
  check('routes-in-generated-main', missing.length === 0, 'missing=' + (missing.join(',') || 'none'));
  const page = ['pvWindow(', 'AbortController(', 'DecompressionStream', 'PV_MAX_LINES', 'pv-line', 'xvfb'].slice(0, 5);
  const pageMissing = page.filter((p) => !ui.includes(p));
  check('page-module-in-generated-ui', pageMissing.length === 0, 'missing=' + (pageMissing.join(',') || 'none'));
  check('generated-preview-header-present', readFileSync(join(previewDir, 'generated', 'preview.hpp'), 'utf8')
        .includes('kPreviewChunkBytes = 256 * 1024'), 'preview.hpp copied into generated/');
}

const fail = results.filter((r) => !r.pass).length;
if (outPath) writeFileSync(outPath, JSON.stringify({ results, fail }, null, 2));
for (const r of results) console.log(JSON.stringify(r));
console.log(JSON.stringify({ test: 'ui-summary', pass: fail === 0, fail }));
process.exit(fail === 0 ? 0 : 1);
