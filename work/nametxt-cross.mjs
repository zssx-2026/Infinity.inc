/* Builds the cross-version catalogue line file for a release directory.
 *
 * cpp/tools/manifest.mjs writes the current release's own lines only; the IPM
 * directory page, however, lists every product that is still downloadable, so
 * the published name.txt is that file plus the entries of the older release the
 * remaining products sit at. Keeping the merge here means a manifest re-run
 * cannot silently drop the older lines.
 *
 * The line order is the historical six-product order of the suite, with each
 * product's line carrying whichever version that product currently ships; that
 * keeps the file byte-identical across releases instead of reshuffling it every
 * time one product moves.
 *
 * Usage: node work/nametxt-cross.mjs [releaseDir] [legacyVersion]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const DIR = process.argv[2] || 'cpp/release/v1.0pre6';
const OLD = process.argv[3] || '1.0.0-pre4';
const ORDER = ['InfinityCloud', 'InfinityFileManager', 'InfinityPackageManager',
  'InfinityInstallerManager', 'InfinityToolbox', 'InfinityGames'];

const line = (name, version) =>
  name + '_' + version + '_win64_setup.exe Infinity.Inc ' + name + ' setup Infinity.Inc win64';

const own = readFileSync(DIR + '/name.txt', 'utf8').split(/\r?\n/).filter(Boolean);
const byProduct = new Map();
for (const l of own) byProduct.set(l.split('_')[0], l);

const merged = [];
for (const product of ORDER) {
  merged.push(byProduct.get(product) || line(product, OLD));
}
/* CRLF, like every catalogue line file the directory page has served so far. */
const text = merged.join('\r\n') + '\r\n';
writeFileSync(DIR + '/name.txt', text, 'utf8');
console.log('name.txt lines=' + merged.length + ' bytes=' + Buffer.byteLength(text, 'utf8'));
