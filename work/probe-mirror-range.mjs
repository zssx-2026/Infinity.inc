import { probeRange } from '../InfinityStudio/src/remote.js';

const url = 'https://infinity-downloads.pages.dev/cdn/InfinityServer-setup';
const t0 = Date.now();
const probe = await probeRange(url);
console.log('probe', JSON.stringify(probe), 'ms=' + (Date.now() - t0));

if (!probe.ranges || !probe.size) { console.log('MIRROR-RANGE FAIL no ranges'); process.exit(1); }

const CHUNK = 1024 * 1024;
const N = 8;
const t1 = Date.now();
const sizes = await Promise.all(Array.from({ length: N }, async (_, i) => {
  const from = i * CHUNK;
  const to = from + CHUNK - 1;
  const res = await fetch(url, { headers: { range: 'bytes=' + from + '-' + to }, signal: AbortSignal.timeout(120000) });
  if (res.status !== 206) throw new Error('status ' + res.status);
  const buf = await res.arrayBuffer();
  return buf.byteLength;
}));
const elapsed = (Date.now() - t1) / 1000;
const total = sizes.reduce((a, b) => a + b, 0);
console.log('parallel bytes=' + total + ' sec=' + elapsed.toFixed(2) + ' mibps=' + (total / 1048576 / elapsed).toFixed(2));
console.log('MIRROR-RANGE PASS size=' + probe.size + ' chunks=' + sizes.join(','));
