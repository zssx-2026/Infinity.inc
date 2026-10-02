/*
 * bootstrap-test.mjs - exercise the real resolution path end to end.
 *
 * The point is not to prove a URL exists. It is to prove the whole chain:
 * find a tool (installed or downloaded), unpack it if needed, locate the
 * executable inside whatever layout the upstream release uses, put it in a
 * stable place, and record that place so the next start skips the search.
 */
import fs from 'node:fs';
import { ensureTools } from '../src/net/bootstrap.js';
import { loadProgramPaths, makeDownloader } from '../src/net/accelerator.js';

const base = process.cwd();
console.log('base = ' + base);

const t0 = Date.now();
const manifest = await ensureTools(base, {}, (m) => console.log('  [boot] ' + m));
console.log('elapsed = ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
console.log('manifest = ' + JSON.stringify(manifest, null, 2));

for (const k of Object.keys(manifest)) {
  const p = manifest[k];
  const ok = fs.existsSync(p);
  console.log('  ' + k.padEnd(14) + (ok ? 'OK  ' + fs.statSync(p).size + ' bytes' : 'MISSING') + '  ' + p);
}

const paths = loadProgramPaths(base);
const d = await makeDownloader(paths);
console.log('downloader: aria2c=' + (d.aria2c || 'none') + '  proxy=' + (d.proxy || 'none'));
