const base = 'https://gh-proxy.com/https://github.com/zssx-2026/Infinity-Server/releases/download/v1.0.0-pre8/InfinityServer_1.0.0-pre8_win64_setup.exe';
const N = 8, CHUNK = 1048576;
const t = Date.now();
const out = await Promise.all(Array.from({ length: N }, async (_, i) => {
  const from = i * CHUNK, to = from + CHUNK - 1;
  const s = Date.now();
  try {
    const res = await fetch(base, { headers: { range: 'bytes=' + from + '-' + to }, signal: AbortSignal.timeout(90000) });
    const buf = await res.arrayBuffer();
    return { status: res.status, bytes: buf.byteLength, sec: +((Date.now() - s) / 1000).toFixed(1) };
  } catch (e) { return { status: 'ERR', error: String(e).slice(0, 40), sec: +((Date.now() - s) / 1000).toFixed(1) }; }
}));
const wall = (Date.now() - t) / 1000;
const total = out.reduce((a, b) => a + (b.bytes || 0), 0);
console.log(JSON.stringify(out));
console.log('wall=' + wall.toFixed(1) + ' total=' + total + ' mibps=' + (total / 1048576 / wall).toFixed(2));
