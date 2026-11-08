#!/usr/bin/env node
// apply-preview.mjs - turn the streaming preview on for Infinity Cloud, without
// touching the tree until it is asked to.
//
//   node "Infinity Cloud/preview/apply-preview.mjs"           # check + generate
//   node "Infinity Cloud/preview/apply-preview.mjs" --write   # patch the real files
//
// The patch itself lives in assets/: the routes (preview-routes.inc), the page
// (preview-ui.html, preview-ui.css) and the module (preview-math.js,
// preview-ui.js). Keeping them as files - rather than as template strings in
// this script - is what lets the node test read the same module the page runs.
//
// It makes three insertions in cpp/apps/inc/main.cpp (the include and the
// routes) and three in cpp/apps/inc/ui.hpp (markup, styles, the preview
// module), and it copies preview.hpp into the application next to ui.hpp.
// Every anchor must be found exactly once, or the script fails without writing
// anything: a patch that silently half-applies is worse than no patch.
//
// It never spawns a process. Outputs, all inside Infinity Cloud/preview/:
//   generated/main.cpp, generated/ui.hpp      the patched files, for review
//   generated/preview.hpp                     the header the build needs
//   preview.patch                             unified diff, git apply -p1

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const write = process.argv.includes('--write');

function asset(name) { return readFileSync(join(here, 'assets', name), 'utf8'); }

const ROUTES = asset('preview-routes.inc');
const UI_MARKUP = asset('preview-ui.html');
const UI_STYLES = asset('preview-ui.css');
const UI_JS = asset('preview-math.js') + '\n' + asset('preview-ui.js');

// ---------------------------------------------------------------- the edits

const EDITS = [
  {
    file: 'cpp/apps/inc/main.cpp',
    name: 'include the preview module',
    anchor: '#include "ui.hpp"',
    before: true,   // new text goes after the anchor line
    text: '#include "preview.hpp"'
  },
  {
    file: 'cpp/apps/inc/main.cpp',
    name: 'preview routes',
    anchor: '  if (!server.start(port, &error)) {',
    before: true,
    text: ROUTES
  },
  {
    file: 'cpp/apps/inc/ui.hpp',
    name: 'preview markup',
    anchor: '<script src="/app.js"></script>',
    before: true,
    text: UI_MARKUP
  },
  {
    file: 'cpp/apps/inc/ui.hpp',
    name: 'preview styles',
    anchor: ')CSS";',
    before: true,
    text: UI_STYLES
  },
  {
    file: 'cpp/apps/inc/ui.hpp',
    name: 'preview module',
    anchor: '})();',
    before: true,
    text: UI_JS
  }
];

// Every edit is an insertion immediately before (or after) one line that must
// appear exactly once.
const originals = new Map();
function linesOf(file) {
  if (!originals.has(file)) originals.set(file, readFileSync(join(root, file), 'utf8').split('\n'));
  return originals.get(file);
}

const applied = new Map();
const insertions = new Map();
const changes = [];
let already = 0;
function patchedLines(file) {
  if (!applied.has(file)) applied.set(file, linesOf(file).slice());
  return applied.get(file);
}

for (const edit of EDITS) {
  const source = patchedLines(edit.file);
  const want = edit.anchor;
  let hits = [];
  for (let i = 0; i < source.length; i++) if (source[i] === want) hits.push(i);
  if (!hits.length) {
    for (let i = 0; i < source.length; i++) if (source[i].trim() === want.trim()) hits.push(i);
  }
  if (hits.length !== 1) {
    console.error('anchor not unique for "' + edit.name + '" in ' + edit.file +
                  ': ' + hits.length + ' matches for ' + JSON.stringify(want));
    process.exit(1);
  }
  const at = hits[0] + (edit.before ? 0 : 1);
  const inserted = edit.text.replace(/\n$/, '').split('\n');
  // Idempotency: if this exact block already sits at the insertion point the edit is in
  // place, so a second --write must not insert it again.
  const blockStart = edit.before ? at - inserted.length : at;
  if (blockStart >= 0 && source.slice(blockStart, blockStart + inserted.length).join('\n') === inserted.join('\n')) {
    already++;
    console.log('= ' + edit.name + ': ' + edit.file + ' already applied at line ' + (at + 1));
    continue;
  }
  const sofar = insertions.get(edit.file) || 0;
  insertions.set(edit.file, sofar + inserted.length);
  changes.push({ file: edit.file, at: at - sofar, count: inserted.length });
  source.splice(at, 0, ...inserted);
  console.log('+ ' + edit.name + ': ' + edit.file + ' line ' + (at + 1) + ' (+' + inserted.length + ' lines)');
}

mkdirSync(join(here, 'generated'), { recursive: true });
for (const [file, lines] of applied) {
  const text = lines.join('\n');
  writeFileSync(join(here, 'generated', file.split('/').pop()), text);
  if (write) writeFileSync(join(root, file), text);
}

// The header travels with the patch: the routes and the page call into it, so a
// tree that has the patch but not the header would not compile. It is copied
// into generated/ always, so an out-of-tree build can use it without the tree
// being touched.
const header = readFileSync(join(here, 'preview.hpp'), 'utf8');
writeFileSync(join(here, 'generated', 'preview.hpp'), header);
if (write) writeFileSync(join(root, 'cpp/apps/inc/preview.hpp'), header);
console.log(header === readFileSync(join(root, 'cpp/apps/inc/preview.hpp'), 'utf8')
  ? 'preview.hpp: the tree copy is already identical'
  : 'preview.hpp: generated/preview.hpp is newer than the tree copy' +
    (write ? ' (written into the tree)' : ' (pass --write to copy it)'));
console.log(write
  ? (changes.length ? 'written into the tree' : 'the tree already matches; nothing written')
  : 'generated only (pass --write to patch the tree)');

// ---------------------------------------------------------------- the patch

// A small unified diff over the recorded insertions: one hunk each, three lines
// of context, exactly what a diff tool writes when the insertions are more than
// six lines apart.
function unifiedDiff(file) {
  const a = linesOf(file);
  const b = patchedLines(file);
  const hunks = changes.filter(function (c) { return c.file === file; })
                       .sort(function (x, y) { return x.at - y.at; });
  if (!hunks.length) return '';
  for (let k = 1; k < hunks.length; k++) {
    if (hunks[k].at - hunks[k - 1].at <= 6) {
      console.error('two preview insertions are too close to hunk separately in ' + file);
      process.exit(1);
    }
  }
  let out = '--- a/' + file + '\n+++ b/' + file + '\n';
  let shifted = 0;                        // how far b is ahead of a so far
  for (const hunk of hunks) {
    const ctxBefore = Math.min(3, hunk.at);
    const ctxAfter = Math.min(3, a.length - hunk.at);
    const aStart = hunk.at - ctxBefore;
    const aCount = ctxBefore + ctxAfter;
    const bStart = aStart + shifted;
    const bCount = aCount + hunk.count;
    out += '@@ -' + (aStart + 1) + ',' + aCount + ' +' + (bStart + 1) + ',' + bCount + ' @@\n';
    for (let i = aStart; i < hunk.at; i++) out += ' ' + a[i] + '\n';
    for (let i = 0; i < hunk.count; i++) out += '+' + b[hunk.at + shifted + i] + '\n';
    for (let i = hunk.at; i < hunk.at + ctxAfter; i++) out += ' ' + a[i] + '\n';
    shifted += hunk.count;
  }
  return out;
}

if (!changes.length) {
  console.log('the tree already contains the preview patch (' + already + '/' + EDITS.length +
              ' insertions in place); preview.patch left untouched');
} else {
  let patch = '';
  for (const file of applied.keys()) patch += unifiedDiff(file);
  writeFileSync(join(here, 'preview.patch'), patch);
  console.log('preview.patch: ' + patch.split('\n').length + ' lines');
}
