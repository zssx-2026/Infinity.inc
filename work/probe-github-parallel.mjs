import { probeRange } from '../InfinityStudio/src/remote.js';

const url = 'https://github.com/zssx-2026/Infinity-Studio/releases/download/v1.0.0-pre8/InfinityStudio_1.0.0-pre8_win64_setup.exe';
const CHUNK = 1024 * 1024;
const N = 4;

async function pull(from) {
  const t0 = Date.now();
  const res = await fetch(url, { headers: { range: 'bytes=' + from + '-' + (from + CHUNK - 1) }, signal: AbortSignal.timeout(60000) });
  if (res.status !== 206) throw new Error('HTTP ' + res.status);
  let got = 0;
  for await (const c of res.body) got += c.length;
  return { ms: Date.now() - t0, got };
}

const probe = await probeRange(url);
console.log('HEAD ranges=' + probe.ranges + ' size=' + probe.size);

const seq0 = Date.now();
for (let i = 0; i < N; i++) {
  const r = await pull(i * CHUNK);
  console.log('  seq ' + i + ' ' + r.got + ' B in ' + r.ms + ' ms = ' + (r.got / 1024 / 1024 / (r.ms / 1000)).toFixed(2) + ' MiB/s');
}
const seqMs = Date.now() - seq0;

const par0 = Date.now();
const par = await Promise.all(Array.from({ length: N }, (_, i) => pull(i * CHUNK)));
const parMs = Date.now() - par0;
const parBytes = par.reduce((a, b) => a + b.got, 0);

console.log('');
console.log('sequential ' + N + ' x 1 MiB : ' + (seqMs / 1000).toFixed(2) + ' s = ' + (N / (seqMs / 1000)).toFixed(2) + ' MiB/s');
console.log('parallel   ' + N + ' x 1 MiB : ' + (parMs / 1000).toFixed(2) + ' s = ' + (parBytes / 1024 / 1024 / (parMs / 1000)).toFixed(2) + ' MiB/s');
console.log('speedup ' + (seqMs / parMs).toFixed(2) + 'x');
console.log(parBytes === N * CHUNK ? 'GITHUB-PARALLEL-PROBE PASS' : 'GITHUB-PARALLEL-PROBE SHORT ' + parBytes);
