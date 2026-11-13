/* Server-rendered code image for the local download check.
 * The code never appears as text in the page or in the signed challenge: only
 * its HMAC does, so reading the token does not reveal the answer. */

const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100']
};

const CRC_TABLE = (function () {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function pngEncode(width, height, pixels) {
  const stride = width;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const deflated = new Uint8Array(await new Response(
    new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))
  ).arrayBuffer());
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8;   /* bit depth */
  ihdr[9] = 0;   /* grayscale */
  ihdr[10] = 0;  /* deflate */
  ihdr[11] = 0;  /* adaptive filtering */
  ihdr[12] = 0;  /* no interlace */
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflated),
    chunk('IEND', new Uint8Array(0))
  ];
  const total = parts.reduce(function (n, p) { return n + p.length; }, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/* 5x7 glyphs scaled up, with per-glyph vertical jitter, dot noise and two
 * faint diagonal strokes - readable for people, awkward for naive OCR. */
export async function codePng(code, scale) {
  const s = scale || 6;
  const pad = 10;
  const glyphW = 5 * s;
  const glyphH = 7 * s;
  const gap = Math.round(s * 1.6);
  const width = pad * 2 + code.length * glyphW + (code.length - 1) * gap;
  const height = pad * 2 + glyphH;
  const bg = 18, fg = 232;
  const pixels = new Uint8Array(width * height).fill(bg);

  function put(x, y, v) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    pixels[y * width + x] = v;
  }

  for (let i = 0; i < code.length; i++) {
    const glyph = FONT[code[i]];
    if (!glyph) continue;
    const jitter = ((i * 7) % 5) - 2;
    const ox = pad + i * (glyphW + gap);
    const oy = pad + jitter;
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] !== '1') continue;
        for (let dy = 0; dy < s; dy++) {
          for (let dx = 0; dx < s; dx++) {
            put(ox + col * s + dx, oy + row * s + dy, fg);
          }
        }
      }
    }
  }

  /* deterministic noise so the same code still looks different from a clean font */
  let seed = 0;
  for (let i = 0; i < code.length; i++) seed = (seed * 31 + code.charCodeAt(i)) >>> 0;
  for (let n = 0; n < 160; n++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const x = seed % width;
    seed = (seed * 1103515245 + 12345) >>> 0;
    const y = seed % height;
    put(x, y, 90 + (seed % 60));
  }
  for (let x = 0; x < width; x++) {
    const y = Math.round((x / width) * height * 0.7 + height * 0.12);
    put(x, y, 70);
    const y2 = height - 1 - Math.round((x / width) * height * 0.6);
    put(x, y2, 60);
  }

  const png = await pngEncode(width, height, pixels);
  return 'data:image/png;base64,' + toBase64(png);
}
