const url = 'https://infinity-downloads.pages.dev/cdn/InfinityServer-setup';

async function one(from, len, ms) {
  const t = Date.now();
  try {
    const res = await fetch(url, { headers: { range: 'bytes=' + from + '-' + (from + len - 1) }, signal: AbortSignal.timeout(ms) });
    const buf = await res.arrayBuffer();
    const sec = (Date.now() - t) / 1000;
    return { status: res.status, bytes: buf.byteLength, sec: +sec.toFixed(2), kbps: Math.round(buf.byteLength / 1024 / sec) };
  } catch (e) {
    return { status: 'ERR', error: String(e).slice(0, 60), sec: +((Date.now() - t) / 1000).toFixed(2) };
  }
}

console.log('single 1MiB', JSON.stringify(await one(0, 1048576, 90000)));
const t = Date.now();
const four = await Promise.all([0, 1, 2, 3].map(i => one(i * 1048576, 1048576, 90000)));
console.log('four 1MiB', JSON.stringify(four), 'wall=' + ((Date.now() - t) / 1000).toFixed(2));
