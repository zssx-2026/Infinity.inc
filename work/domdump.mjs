import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const url = process.argv[2];
for (const mode of ['--headless=old', '--headless']) {
  try {
    const out = execFileSync(EDGE, [mode, '--disable-gpu', '--no-first-run', '--user-data-dir=D:/dev/Chormium/edgep' + Date.now(), '--virtual-time-budget=15000', '--dump-dom', url],
      { encoding: 'utf8', timeout: 180000, maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    console.log(mode + ' bytes=' + out.length);
    if (out.length > 0) { fs.writeFileSync("D:\\dev\\DeepSeekHarnessWorkspace\\Infinity.inc\\work\\_dl-shots\\dom.html", out); break; }
  } catch (e) { console.log(mode + ' ERR ' + String(e).slice(0, 120)); }
}
