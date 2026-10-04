/* temp verification: download every published asset (product release + catalogue
 * copy) and compare size + sha256 against the local file */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const DIR = 'D:/dev/DeepSeekHarnessWorkspace/Infinity.inc';
const TAG = 'v1.0.0-pre3';
const TMP = DIR + '/work/_pubtmp/dl';
fs.mkdirSync(TMP, { recursive: true });

const ASSETS = [
  { repo: 'Infinity-Cloud', file: DIR + '/cpp/release/v1.0pre3/InfinityCloud_1.0.0-pre3_win64_setup.exe' },
  { repo: 'Infinity-File-Manager', file: DIR + '/cpp/release/v1.0pre3/InfinityFileManager_1.0.0-pre3_win64_setup.exe' },
  { repo: 'InfinityPackageManager', file: DIR + '/cpp/release/v1.0pre3/InfinityPackageManager_1.0.0-pre3_win64_setup.exe' },
  { repo: 'Infinity-Installer-Manager', file: DIR + '/cpp/release/v1.0pre3/InfinityInstallerManager_1.0.0-pre3_win64_setup.exe' }
];

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function download(url, out) {
  execFileSync('curl.exe', ['-sS', '-L', '--ssl-no-revoke', '--max-time', '3600', '-o', out, url],
    { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
}

let allOk = true;
function check(label, url, out, local, ls, lh) {
  let status;
  try {
    download(url, out);
    const remote = fs.readFileSync(out);
    const rs = remote.length, rh = sha256(remote);
    const ok = rs === ls && rh === lh;
    if (!ok) allOk = false;
    status = (ok ? 'MATCH   ' : 'MISMATCH') + ' local ' + ls + ' B / ' + lh.slice(0, 16) + '  vs  remote ' + rs + ' B / ' + rh.slice(0, 16);
  } catch (e) {
    allOk = false;
    status = 'DOWNLOAD FAILED: ' + String((e.stderr || '') + (e.message || '')).slice(0, 200);
  }
  console.log('  ' + label.padEnd(12) + status);
}

for (const a of ASSETS) {
  const name = path.basename(a.file);
  const local = fs.readFileSync(a.file);
  const ls = local.length, lh = sha256(local);
  console.log(name);
  check('product', 'https://github.com/zssx-2026/' + a.repo + '/releases/download/' + TAG + '/' + name,
    path.join(TMP, 'p_' + name), local, ls, lh);
  check('catalogue', 'https://github.com/zssx-2026/applications/releases/download/application-inc/' + name,
    path.join(TMP, 'c_' + name), local, ls, lh);
}
console.log(allOk ? 'ALL ASSETS MATCH' : 'SOME ASSETS FAILED');
