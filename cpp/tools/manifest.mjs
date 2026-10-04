/*
 * manifest.mjs - write the two files a release folder carries beside its
 * installers: name.txt (the manifest the catalogue page reads) and
 * release-assets.json (what the publication step put on GitHub, plus the
 * digests so a verification does not have to recompute them by hand).
 *
 * The installers themselves are produced by package.mjs; this step only
 * describes them. It reads the bytes off disk, so the size and the digest
 * cannot drift from the file they claim to describe, and it fails rather than
 * write a manifest that names a file which is not there.
 *
 * Usage:  NODE_OPTIONS= node tools/manifest.mjs [v1.0pre4] [1.0.0-pre4]
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import crypto from 'node:crypto';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const RELEASE = process.argv[2] || 'v1.0pre4';
const VERSION = process.argv[3] || '1.0.0-pre4';
const TAG = 'v' + VERSION;
const OWNER = 'zssx-2026';
const OUT = path.join(ROOT, 'release', RELEASE);

/* package name in the file name -> repository that holds the application */
const APPS = [
  { package: 'InfinityCloud', repo: 'Infinity-Cloud' },
  { package: 'InfinityFileManager', repo: 'Infinity-File-Manager' },
  { package: 'InfinityPackageManager', repo: 'InfinityPackageManager' },
  { package: 'InfinityInstallerManager', repo: 'Infinity-Installer-Manager' },
  { package: 'InfinityToolbox', repo: 'Infinity-Toolbox' },
  { package: 'InfinityGames', repo: 'Infinity-Games' }
];

function fnv1a(buf) {
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i++) { h ^= buf[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const assets = [];
for (const app of APPS) {
  const name = app.package + '_' + VERSION + '_win64_setup.exe';
  const file = path.join(OUT, name);
  if (!fs.existsSync(file)) throw new Error('installer is missing: ' + file);
  const buf = fs.readFileSync(file);
  /* The catalogue line, in the shape ghsync.mjs already writes:
   * <asset name> <company> <package> setup <company> <platform> */
  lines.push(name + ' Infinity.Inc ' + app.package + ' setup Infinity.Inc win64');
  assets.push({
    name: name,
    size: buf.length,
    sha256: sha256(buf),
    fnv1a: fnv1a(buf),
    repo: OWNER + '/' + app.repo,
    url: 'https://github.com/' + OWNER + '/' + app.repo + '/releases/download/' + TAG + '/' + name
  });
}
fs.writeFileSync(path.join(OUT, 'name.txt'), lines.join('\n') + '\n', 'utf8');
fs.writeFileSync(path.join(OUT, 'release-assets.json'),
  JSON.stringify({ tag: TAG, version: VERSION, generated: new Date().toISOString(), assets: assets }, null, 2) + '\n', 'utf8');
for (const a of assets) process.stdout.write(a.name.padEnd(48) + a.size + ' B  ' + a.sha256.slice(0, 16) + '...\n');
process.stdout.write('wrote ' + path.join(OUT, 'name.txt') + ' and release-assets.json (' + assets.length + ' assets)\n');
