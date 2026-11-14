import fs from 'node:fs';

/* Keep the published catalog honest: the size and hash it advertises must be
 * the bytes that were actually signed and uploaded, so they are patched from
 * the file itself rather than typed by hand. The numbers live in the shared
 * asset table that the catalog, the gate and the mirror all read. */
const [size, sha, asset] = process.argv.slice(2);
if (!size || !sha) {
  console.error('usage: node work/catalog-studio-update.mjs <size> <sha256> [assetKey]');
  process.exit(2);
}
const file = 'work/pages-gate/functions/_lib/assets.js';
const key = asset || 'InfinityStudio-setup';
const text = fs.readFileSync(file, 'utf8');
const block = new RegExp("('" + key + "'[\\s\\S]{0,500}?)size: \\d+([\\s\\S]{0,120}?)sha256: '[0-9a-f]{64}'");
if (!block.test(text)) {
  console.error('asset entry not found for ' + key);
  process.exit(3);
}
const next = text.replace(block, (m, a, b) => a + 'size: ' + size + b + "sha256: '" + sha + "'");
if (next === text) {
  console.log('unchanged');
} else {
  fs.writeFileSync(file, next, 'utf8');
  console.log('assets.js updated ' + key + ' size=' + size + ' sha=' + sha.slice(0, 12));
}
