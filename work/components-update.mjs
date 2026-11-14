/* Rewrite the COMPONENTS table in the gate with the real bytes of the three
 * sub-product setups. Same reason the public table is generated: a size or hash
 * that disagrees with the file is an install that fails the sha256 check after
 * downloading 80 MiB. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'cpp', 'release', 'v1.0pre8');
const TABLE = [
  ['InfinityCloud-setup', 'inc', 'Infinity Cloud', 'InfinityCloud_1.0.0-pre8_win64_setup.exe'],
  ['InfinityPackageManager-setup', 'ipm', 'Infinity Package Manager', 'InfinityPackageManager_1.0.0-pre8_win64_setup.exe'],
  ['InfinityToolbox-setup', 'int', 'Infinity Toolbox', 'InfinityToolbox_1.0.0-pre8_win64_setup.exe']
];

function sha256File(file) {
  const h = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1024 * 1024);
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      h.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

const rows = TABLE.map(([asset, id, name, file]) => {
  const full = path.join(DIR, file);
  if (!fs.existsSync(full)) { console.log('missing ' + file); process.exit(3); }
  const size = fs.statSync(full).size;
  const sha = sha256File(full);
  console.log(asset + ' ' + size + ' ' + sha);
  return "  '" + asset + "': {\n" +
    "    id: '" + id + "',\n" +
    "    name: '" + name + "',\n" +
    "    repo: 'Infinity-Studio',\n" +
    "    file: '" + file + "',\n" +
    "    size: " + size + ",\n" +
    "    sha256: '" + sha + "'\n" +
    '  }';
});

const target = path.join(ROOT, 'work', 'pages-gate', 'functions', '_lib', 'assets.js');
const text = fs.readFileSync(target, 'utf8');
const start = text.indexOf('export const COMPONENTS = {');
if (start < 0) { console.log('COMPONENTS block not found'); process.exit(4); }
const endMark = '\n};\n';
const end = text.indexOf(endMark, start);
if (end < 0) { console.log('COMPONENTS block end not found'); process.exit(5); }
const block = 'export const COMPONENTS = {\n' + rows.join(',\n') + '\n};';
const next = text.slice(0, start) + block + text.slice(end + endMark.length - 1);
fs.writeFileSync(target, next);
console.log('assets.js components updated');
