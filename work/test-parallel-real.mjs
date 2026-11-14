import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { downloadParallel, probeRange } from '../InfinityStudio/src/remote.js';

const url = 'https://github.com/zssx-2026/Infinity-Server/releases/download/v1.0.0-pre8/InfinityServer_1.0.0-pre8_win64_setup.exe';
const dir = path.join(os.tmpdir(), 'infinity-real-par-' + process.pid);
fs.mkdirSync(dir, { recursive: true });
const part = path.join(dir, 'server.exe.part');
const probe = await probeRange(url);
console.log('probe ranges=' + probe.ranges + ' size=' + probe.size);
if (!probe.ranges) { console.log('NO RANGES'); process.exit(1); }
const t0 = Date.now();
let lastPrint = 0;
try {
  const got = await downloadParallel(url, part, probe.size, (r, t) => {
    if (Date.now() - lastPrint > 2000) { lastPrint = Date.now(); console.log('  ' + (r / 1048576).toFixed(1) + '/' + (t / 1048576).toFixed(1) + ' MiB ' + (r / 1048576 / ((Date.now() - t0) / 1000)).toFixed(2) + ' MiB/s'); }
  });
  const sha = crypto.createHash('sha256').update(fs.readFileSync(part)).digest('hex');
  console.log('got=' + got + ' bytes file=' + fs.statSync(part).size + ' sha=' + sha.slice(0, 12));
  console.log('elapsed=' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  console.log(sha === 'b69635364069217b241b14eae9ba25e2535f5cf6856579443d6ed884837ea526' ? 'REAL-PARALLEL PASS' : 'REAL-PARALLEL HASH MISMATCH');
} catch (error) {
  console.log('ERROR ' + String((error && error.message) || error));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
