import zlib from 'node:zlib';
import fs from 'node:fs';
const p = process.argv[2];
const buf = fs.readFileSync(p);
let off = 8, width = 0, height = 0, colorType = 0, bitDepth = 8; const idat = [];
while (off < buf.length) {
  const len = buf.readUInt32BE(off);
  const type = buf.toString('ascii', off + 4, off + 8);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
  else if (type === 'IDAT') idat.push(data);
  off += 12 + len;
}
const raw = zlib.inflateSync(Buffer.concat(idat));
const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
const bpp = channels * (bitDepth / 8);
const stride = width * bpp + 1;
const px = Buffer.alloc(width * height * bpp);
let prev = Buffer.alloc(width * bpp);
for (let y = 0; y < height; y++) {
  const filter = raw[y * stride];
  const line = Buffer.from(raw.subarray(y * stride + 1, y * stride + 1 + width * bpp));
  for (let i = 0; i < line.length; i++) {
    const a = i >= bpp ? line[i - bpp] : 0;
    const b = prev[i];
    const c = i >= bpp ? prev[i - bpp] : 0;
    if (filter === 1) line[i] = (line[i] + a) & 255;
    else if (filter === 2) line[i] = (line[i] + b) & 255;
    else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255;
    else if (filter === 4) {
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      line[i] = (line[i] + pr) & 255;
    }
  }
  line.copy(px, y * width * bpp);
  prev = line;
}
/* find the captcha plate: rows whose dark run is close to the 300px image width */
const rows = [];
for (let y = 0; y < height; y++) {
  let run = 0, start = 0;
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * bpp;
    const v = px[i];
    if (v <= 30) { if (run === 0) start = x; run++; }
    else {
      if (run >= 240 && run <= 380) rows.push({ y, x: start, w: run });
      run = 0;
    }
  }
  if (run >= 240 && run <= 380) rows.push({ y, x: start, w: run });
}
rows.sort((a, b) => a.y - b.y);
console.log(JSON.stringify({ width, height, colorType, first: rows.slice(0, 3), count: rows.length, mid: rows[Math.floor(rows.length / 2)] || null }));
