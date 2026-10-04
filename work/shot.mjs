// shot.mjs - run headless Edge without shell quoting problems.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const [, , mode, url, out, profile] = process.argv;
const base = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--virtual-time-budget=12000', '--user-data-dir=' + (profile || 'D:/dev/Chormium/edgepX'),
  '--window-size=1180,1400'];
try {
  if (mode === 'dom') {
    const dom = execFileSync(EDGE, base.concat(['--dump-dom', url]), { encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    fs.writeFileSync(out, dom);
    console.log('dom bytes=' + dom.length);
  } else {
    execFileSync(EDGE, base.concat(['--screenshot=' + out, url]), { timeout: 180000, stdio: 'ignore' });
    console.log('shot ' + out + ' = ' + (fs.existsSync(out) ? fs.statSync(out).size + ' B' : 'MISSING'));
  }
} catch (e) { console.log('ERR ' + String(e).slice(0, 200)); }
