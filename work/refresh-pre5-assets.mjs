import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const DIR = 'cpp/release/v1.0pre5';
const TAG = 'v1.0.0-pre5';
const VERSION = '1.0.0-pre5';
const REPOS = {
  InfinityCloud: 'zssx-2026/Infinity-Cloud',
  InfinityPackageManager: 'zssx-2026/InfinityPackageManager',
  InfinityToolbox: 'zssx-2026/Infinity-Toolbox'
};

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function fnv1a(buf) {
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const files = readdirSync(DIR).filter(function (n) { return n.endsWith('_setup.exe'); }).sort();
const assets = [];
for (const name of files) {
  const buf = readFileSync(join(DIR, name));
  const product = name.split('_')[0];
  const repo = REPOS[product];
  if (!repo) throw new Error('unknown product in ' + name);
  assets.push({
    name: name,
    size: buf.length,
    sha256: sha256(buf),
    fnv1a: fnv1a(buf),
    repo: repo,
    url: 'https://github.com/' + repo + '/releases/download/' + TAG + '/' + name
  });
  console.log('asset ' + name + ' ' + buf.length + 'B ' + sha256(buf).slice(0, 12) + ' fnv=' + fnv1a(buf));
}

const manifest = {
  tag: TAG,
  version: VERSION,
  generated: new Date().toISOString(),
  assets: assets
};
writeFileSync(join(DIR, 'release-assets.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

const lines = [];
for (const a of assets) lines.push(a.sha256 + '  ' + a.name);
for (const extra of ['name.txt', 'release-assets.json']) {
  lines.push(sha256(readFileSync(join(DIR, extra))) + '  ' + extra);
}
writeFileSync(join(DIR, 'SHA256SUMS.txt'), lines.join('\n') + '\n', 'utf8');
console.log('manifest + SHA256SUMS rewritten');
