/*
 * picturecraft.js - PictureCraft, the bitmap member of the Craft family.
 *
 * Two jobs, both done in plain JavaScript on node: built-ins only:
 *
 *   1. read the header of a PNG or JPEG well enough to answer what the
 *      studio asks about a project file: container, size, bit depth, colour
 *      model, and whether the chunk checksums still hold;
 *   2. write a real PNG out of raw RGBA pixels, with our own CRC32 and our
 *      own fixed-Huffman deflate, so a canvas can round-trip without an
 *      image library on the box.
 *
 * Thumbnails are nearest neighbour: decode the source pixels, sample them,
 * re-encode. That is the whole pipeline, and it is all local.
 *
 * The module never throws across its boundary: run() is the safe edge and
 * reports { ok: false, error: CODE }. The low level helpers throw a
 * PictureError carrying a code, which run() turns into that row.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

export const META = {
  id: 'craft.picture',
  name: 'PictureCraft',
  version: '1.0.0-pre4',
  branch: 'craft',
  codecs: [{ ext: '.is-picp', since: '0.29.2' }, { ext: '.is-picpx', since: '0.29.2' }],
  hosts: []
};

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const PNG_CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const COLOR_TYPE_NAME = { 0: 'gray', 2: 'rgb', 3: 'palette', 4: 'gray-alpha', 6: 'rgba' };

export class PictureError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'PictureError';
    this.code = code;
  }
}

/* ---- checksums ----------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export function adler32(buf) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < buf.length; i += 1) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/* ---- deflate, fixed Huffman, written here ------------------------- */

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
  35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
  3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129,
  193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193,
  12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
  7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

const HASH_BITS = 15;
const HASH_SIZE = 1 << HASH_BITS;
const WINDOW = 32768;
const MIN_MATCH = 3;
const MAX_MATCH = 258;
const MAX_CHAIN = 32;

function makeBitWriter() {
  const bytes = [];
  let cur = 0;
  let cnt = 0;
  const push = () => {
    if (cnt > 0) {
      bytes.push(cur & 0xFF);
      cur = 0;
      cnt = 0;
    }
  };
  return {
    /* header and extra bits travel least significant bit first */
    bits(value, n) {
      for (let i = 0; i < n; i += 1) {
        cur |= ((value >>> i) & 1) << cnt;
        cnt += 1;
        if (cnt === 8) push();
      }
    },
    /* Huffman codes travel most significant bit first */
    code(value, n) {
      for (let i = n - 1; i >= 0; i -= 1) {
        cur |= ((value >>> i) & 1) << cnt;
        cnt += 1;
        if (cnt === 8) push();
      }
    },
    done() {
      push();
      return Buffer.from(bytes);
    }
  };
}

function writeSymbol(w, sym) {
  if (sym <= 143) w.code(0x30 + sym, 8);
  else if (sym <= 255) w.code(0x190 + (sym - 144), 9);
  else if (sym <= 279) w.code(sym - 256, 7);
  else w.code(0xC0 + (sym - 280), 8);
}

function bucket(value, bases, top) {
  for (let i = 0; i < bases.length; i += 1) {
    const base = bases[i];
    const next = i + 1 < bases.length ? bases[i + 1] : top;
    if (value >= base && value < next) return i;
  }
  return bases.length - 1;
}

function writeMatch(w, len, dist) {
  const li = bucket(len, LEN_BASE, 259);
  writeSymbol(w, 257 + li);
  if (LEN_EXTRA[li] > 0) w.bits(len - LEN_BASE[li], LEN_EXTRA[li]);
  const di = bucket(dist, DIST_BASE, 32769);
  w.code(di, 5);
  if (DIST_EXTRA[di] > 0) w.bits(dist - DIST_BASE[di], DIST_EXTRA[di]);
}

/* One fixed-Huffman block with a hash-chain LZ77 pass in front of it. */
export function deflateRaw(input) {
  const src = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const n = src.length;
  const w = makeBitWriter();
  w.bits(1, 1);
  w.bits(1, 2);
  const head = new Int32Array(HASH_SIZE).fill(-1);
  const prev = new Int32Array(n > 0 ? n : 1).fill(-1);
  const hashAt = (i) => (((src[i] << 10) ^ (src[i + 1] << 5) ^ src[i + 2]) & (HASH_SIZE - 1));
  const insert = (i) => {
    if (i + MIN_MATCH > n) return;
    const h = hashAt(i);
    prev[i] = head[h];
    head[h] = i;
  };
  let i = 0;
  while (i < n) {
    let bestLen = 0;
    let bestDist = 0;
    if (i + MIN_MATCH <= n) {
      const limit = Math.min(MAX_MATCH, n - i);
      let cand = head[hashAt(i)];
      let chain = MAX_CHAIN;
      while (cand >= 0 && chain > 0 && i - cand <= WINDOW) {
        chain -= 1;
        let len = 0;
        while (len < limit && src[cand + len] === src[i + len]) len += 1;
        if (len > bestLen) {
          bestLen = len;
          bestDist = i - cand;
          if (len >= limit) break;
        }
        cand = prev[cand];
      }
    }
    if (bestLen >= MIN_MATCH) {
      writeMatch(w, bestLen, bestDist);
      for (let k = 0; k < bestLen; k += 1) insert(i + k);
      i += bestLen;
    } else {
      insert(i);
      writeSymbol(w, src[i]);
      i += 1;
    }
  }
  writeSymbol(w, 256);
  return w.done();
}

/* zlib wrapper: two byte header whose check byte is chosen the RFC way. */
export function zlibCompress(input) {
  const src = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const body = deflateRaw(src);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(adler32(src), 0);
  return Buffer.concat([Buffer.from([0x78, 0x01]), body, tail]);
}

/* ---- PNG writing --------------------------------------------------- */

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, sum]);
}

export function encodePng(width, height, pixels) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibCompress(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---- input handling ------------------------------------------------ */

export function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (typeof input === 'string') {
    try {
      return fs.readFileSync(input);
    } catch (err) {
      throw new PictureError('FILE_NOT_FOUND', '读不到文件：' + input);
    }
  }
  if (input && typeof input === 'object') {
    if (typeof input.path === 'string') return toBuffer(input.path);
    const keys = ['data', 'buffer', 'png', 'image', 'source'];
    for (const key of keys) {
      if (input[key] != null) return toBuffer(input[key]);
    }
  }
  throw new PictureError('BAD_INPUT', '输入既不是文件路径也不是字节');
}

export function toPixels(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (Array.isArray(input)) return Buffer.from(input);
  if (input && typeof input === 'object' && Array.isArray(input.pixels)) return Buffer.from(input.pixels);
  if (input && typeof input === 'object' && Array.isArray(input.data)) return Buffer.from(input.data);
  throw new PictureError('BAD_PIXELS', '像素必须是 Buffer、Uint8Array 或数字数组');
}

/* ---- PNG reading --------------------------------------------------- */

function parsePng(buf) {
  if (buf.length < 33) throw new PictureError('PNG_TRUNCATED', 'PNG 太短，放不下 IHDR');
  let pos = 8;
  let ihdr = null;
  let palette = null;
  let trns = null;
  let sawEnd = false;
  let crcOk = true;
  const chunks = [];
  const idat = [];
  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8).toString('latin1');
    const dataStart = pos + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buf.length) {
      crcOk = false;
      break;
    }
    const data = buf.subarray(dataStart, dataEnd);
    if (buf.readUInt32BE(dataEnd) !== crc32(buf.subarray(pos + 4, dataEnd))) crcOk = false;
    chunks.push(type);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12]
      };
    } else if (type === 'PLTE') {
      palette = Buffer.from(data);
    } else if (type === 'tRNS') {
      trns = Buffer.from(data);
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      sawEnd = true;
      pos = dataEnd + 4;
      break;
    }
    pos = dataEnd + 4;
  }
  if (!ihdr) throw new PictureError('PNG_NO_IHDR', 'PNG 缺 IHDR 块');
  const channels = PNG_CHANNELS[ihdr.colorType];
  if (!channels) throw new PictureError('PNG_BAD_COLOR_TYPE', '未知 PNG colorType ' + ihdr.colorType);
  return {
    format: 'png',
    width: ihdr.width,
    height: ihdr.height,
    bytes: buf.length,
    bitDepth: ihdr.bitDepth,
    colorType: ihdr.colorType,
    channels,
    colorName: COLOR_TYPE_NAME[ihdr.colorType],
    interlaced: ihdr.interlace !== 0,
    chunks,
    complete: sawEnd,
    crcOk,
    hasPalette: !!palette,
    palette,
    trns,
    idat: Buffer.concat(idat)
  };
}

/* ---- JPEG reading -------------------------------------------------- */

function parseJpeg(buf) {
  const len = buf.length;
  const segments = [];
  let i = 2;
  while (i + 1 < len) {
    if (buf[i] !== 0xFF) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xFF) {
      i += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD9)) {
      i += 2;
      continue;
    }
    if (marker === 0xDA) break;
    if (i + 4 > len) break;
    const segLen = buf.readUInt16BE(i + 2);
    if (segLen < 2) break;
    segments.push(marker.toString(16).toUpperCase());
    const isSof = marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
    if (isSof) {
      if (i + 10 > len) throw new PictureError('JPEG_TRUNCATED', 'SOF 段被截断');
      const precision = buf[i + 4];
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      const components = buf[i + 9];
      const colorType = components === 1 ? 0 : (components === 3 ? 2 : (components === 4 ? 6 : components));
      return {
        format: 'jpeg',
        width,
        height,
        bytes: len,
        bitDepth: precision,
        colorType,
        channels: components,
        colorName: components === 1 ? 'gray' : (components === 3 ? 'ycbcr' : 'cmyk'),
        components,
        sof: 'SOF' + (marker - 0xC0),
        segments
      };
    }
    i += 2 + segLen;
  }
  throw new PictureError('JPEG_NO_SOF', 'JPEG 里没有找到 SOF 段');
}

/* ---- decode: the public header reader ------------------------------ */

export function decode(input) {
  const buf = toBuffer(input);
  if (buf.length < 4) throw new PictureError('EMPTY_INPUT', '输入不足 4 字节');
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) return parsePng(buf);
  if (buf[0] === 0xFF && buf[1] === 0xD8) return parseJpeg(buf);
  if (buf.subarray(0, 3).toString('latin1') === 'GIF') {
    throw new PictureError('UNSUPPORTED_FORMAT', '暂不支持 GIF，只认 PNG 与 JPEG');
  }
  throw new PictureError('UNSUPPORTED_FORMAT', '既不是 PNG 也不是 JPEG');
}

export function tryDecode(input) {
  try {
    return { ok: true, result: decode(input), error: null };
  } catch (err) {
    return { ok: false, result: null, error: (err && err.code) || 'DECODE_FAILED', message: String((err && err.message) || err) };
  }
}

/* ---- PNG pixel recovery -------------------------------------------- */

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const row = y * stride;
    const up = (y - 1) * stride;
    for (let x = 0; x < stride; x += 1) {
      const rawByte = raw[pos + x];
      const a = x >= bpp ? out[row + x - bpp] : 0;
      const b = y > 0 ? out[up + x] : 0;
      const c = (x >= bpp && y > 0) ? out[up + x - bpp] : 0;
      let value;
      if (filter === 0) value = rawByte;
      else if (filter === 1) value = rawByte + a;
      else if (filter === 2) value = rawByte + b;
      else if (filter === 3) value = rawByte + ((a + b) >> 1);
      else if (filter === 4) value = rawByte + paeth(a, b, c);
      else throw new PictureError('PNG_BAD_FILTER', 'PNG 行过滤类型非法：' + filter);
      out[row + x] = value & 0xFF;
    }
    pos += stride;
  }
  return out;
}

export function decodePixels(input) {
  const buf = toBuffer(input);
  const info = decode(buf);
  if (info.format !== 'png') {
    throw new PictureError('DECODE_UNSUPPORTED', info.format.toUpperCase() + ' 只读头部，像素解码需要 PNG');
  }
  if (info.interlaced) throw new PictureError('INTERLACED_UNSUPPORTED', '暂不支持隔行 PNG');
  if (info.bitDepth !== 8 && info.bitDepth !== 16) {
    throw new PictureError('UNSUPPORTED_BIT_DEPTH', '暂不支持位深 ' + info.bitDepth);
  }
  if (info.colorType === 3 && info.bitDepth !== 8) {
    throw new PictureError('UNSUPPORTED_BIT_DEPTH', '调色板 PNG 只支持 8 位');
  }
  if (info.colorType === 3 && !info.palette) throw new PictureError('PNG_NO_PLTE', '调色板 PNG 缺 PLTE');
  if (!info.idat.length) throw new PictureError('PNG_NO_IDAT', 'PNG 缺 IDAT');
  const bpp = Math.max(1, info.channels * (info.bitDepth / 8));
  const stride = info.width * bpp;
  const raw = zlib.inflateSync(info.idat);
  if (raw.length < (stride + 1) * info.height) {
    throw new PictureError('PNG_SHORT_DATA', 'IDAT 解压后长度不足');
  }
  const plane = unfilter(raw, info.width, info.height, bpp);
  const step = info.bitDepth === 16 ? 2 : 1;
  const rgba = Buffer.alloc(info.width * info.height * 4);
  const sample = (x, y, c) => plane[y * stride + x * bpp + c * step];
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const o = (y * info.width + x) * 4;
      const ct = info.colorType;
      if (ct === 6) {
        rgba[o] = sample(x, y, 0);
        rgba[o + 1] = sample(x, y, 1);
        rgba[o + 2] = sample(x, y, 2);
        rgba[o + 3] = sample(x, y, 3);
      } else if (ct === 2) {
        rgba[o] = sample(x, y, 0);
        rgba[o + 1] = sample(x, y, 1);
        rgba[o + 2] = sample(x, y, 2);
        rgba[o + 3] = 255;
      } else if (ct === 0) {
        const g = sample(x, y, 0);
        rgba[o] = g;
        rgba[o + 1] = g;
        rgba[o + 2] = g;
        rgba[o + 3] = 255;
      } else if (ct === 4) {
        const g = sample(x, y, 0);
        rgba[o] = g;
        rgba[o + 1] = g;
        rgba[o + 2] = g;
        rgba[o + 3] = sample(x, y, 1);
      } else {
        const idx = sample(x, y, 0);
        const p = info.palette;
        rgba[o] = p[idx * 3] || 0;
        rgba[o + 1] = p[idx * 3 + 1] || 0;
        rgba[o + 2] = p[idx * 3 + 2] || 0;
        rgba[o + 3] = info.trns && idx < info.trns.length ? info.trns[idx] : 255;
      }
    }
  }
  return { width: info.width, height: info.height, pixels: rgba, info };
}

/* ---- encode / thumbnail -------------------------------------------- */

function fillPixels(width, height, color) {
  const c = Array.isArray(color) ? color : [color, color, color, 255];
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    out[i * 4] = c[0] & 0xFF;
    out[i * 4 + 1] = (c.length > 1 ? c[1] : c[0]) & 0xFF;
    out[i * 4 + 2] = (c.length > 2 ? c[2] : c[0]) & 0xFF;
    out[i * 4 + 3] = (c.length > 3 ? c[3] : 255) & 0xFF;
  }
  return out;
}

export function encode(input) {
  const arg = input || {};
  const width = Math.trunc(Number(arg.width));
  const height = Math.trunc(Number(arg.height));
  if (!Number.isFinite(width) || width <= 0) throw new PictureError('BAD_DIMENSIONS', 'width 必须是正整数');
  if (!Number.isFinite(height) || height <= 0) throw new PictureError('BAD_DIMENSIONS', 'height 必须是正整数');
  let pixels;
  if (arg.pixels != null) pixels = toPixels(arg.pixels);
  else if (arg.rgba != null) pixels = toPixels(arg.rgba);
  else if (arg.color != null) pixels = fillPixels(width, height, arg.color);
  else throw new PictureError('BAD_INPUT', 'encode 需要 pixels、rgba 或 color');
  const need = width * height * 4;
  if (pixels.length !== need) {
    throw new PictureError('BAD_PIXELS', '像素长度 ' + pixels.length + ' 与 ' + width + 'x' + height + ' 不符（应为 ' + need + '）');
  }
  return encodePng(width, height, pixels);
}

export function thumbnail(input, options) {
  const arg = options || {};
  const tw = Math.trunc(Number(arg.width != null ? arg.width : arg.w));
  const th = Math.trunc(Number(arg.height != null ? arg.height : arg.h));
  if (!Number.isFinite(tw) || tw <= 0 || !Number.isFinite(th) || th <= 0) {
    throw new PictureError('BAD_DIMENSIONS', '缩略图需要正整数 width 与 height');
  }
  const src = decodePixels(input);
  const sw = src.width;
  const sh = src.height;
  const out = Buffer.alloc(tw * th * 4);
  for (let y = 0; y < th; y += 1) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / th));
    for (let x = 0; x < tw; x += 1) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / tw));
      const s = (sy * sw + sx) * 4;
      const d = (y * tw + x) * 4;
      out[d] = src.pixels[s];
      out[d + 1] = src.pixels[s + 1];
      out[d + 2] = src.pixels[s + 2];
      out[d + 3] = src.pixels[s + 3];
    }
  }
  return encodePng(tw, th, out);
}

/* ---- the contract surface ------------------------------------------ */

export function capabilities() {
  return {
    id: META.id,
    name: META.name,
    version: META.version,
    features: [
      'png-header-parse',
      'jpeg-sof-scan',
      'png-chunk-crc-verify',
      'png-encode',
      'own-deflate-fixed-huffman',
      'own-crc32-and-adler32',
      'png-pixel-unfilter',
      'nearest-thumbnail',
      'sha256-digest'
    ],
    formats: ['.is-picp', '.is-picpx', '.png', '.jpg', '.jpeg'],
    hosts: [],
    implemented: true
  };
}

export function plan(action, input) {
  const verb = String(action == null ? 'info' : action).trim().toLowerCase();
  const arg = input || {};
  const steps = [];
  const warnings = [];
  if (verb === 'info' || verb === 'decode' || verb === 'probe') {
    steps.push({ kind: 'read', detail: '读取项目文件字节（路径或内存缓冲）' });
    steps.push({ kind: 'sniff', detail: '按 PNG 签名或 JPEG SOI 判定容器' });
    steps.push({ kind: 'parse', detail: '解析 IHDR 块或 SOF0/SOF2 段' });
    steps.push({ kind: 'verify', detail: '逐块复算 CRC32（仅 PNG）' });
    steps.push({ kind: 'hash', detail: '计算 sha256 摘要' });
    if (arg.path == null && arg.data == null) warnings.push('没有给 path 或 data，info 会返回 FILE_NOT_FOUND 或 BAD_INPUT');
  } else if (verb === 'encode') {
    steps.push({ kind: 'validate', detail: '校验宽高为正整数、像素长度等于 宽*高*4' });
    steps.push({ kind: 'filter', detail: '每行前置 filter 0，组成原始扫描线' });
    steps.push({ kind: 'deflate', detail: '自写 fixed-Huffman deflate 压缩成 zlib 流' });
    steps.push({ kind: 'chunk', detail: '拼 IHDR/IDAT/IEND，逐块计算 CRC32' });
    if (arg.width == null || arg.height == null) warnings.push('缺少 width 或 height');
    if (arg.pixels == null && arg.rgba == null && arg.color == null) warnings.push('没有像素来源，需要 pixels/rgba/color 之一');
  } else if (verb === 'thumb' || verb === 'thumbnail') {
    steps.push({ kind: 'decode', detail: '解出源图 RGBA 像素（含反滤波）' });
    steps.push({ kind: 'sample', detail: '最近邻取样到目标尺寸' });
    steps.push({ kind: 'encode', detail: '重新编码为 PNG' });
    if (arg.width == null || arg.height == null) warnings.push('缺少目标 width 或 height');
  } else {
    warnings.push('未知 action：' + verb);
  }
  return { ok: steps.length > 0, action: verb, steps, warnings };
}

function shape(info) {
  const out = {
    format: info.format,
    width: info.width,
    height: info.height,
    bytes: info.bytes,
    bitDepth: info.bitDepth,
    colorType: info.colorType,
    colorName: info.colorName,
    channels: info.channels
  };
  if (info.format === 'png') {
    out.chunks = info.chunks;
    out.crcOk = info.crcOk;
    out.complete = info.complete;
    out.interlaced = info.interlaced;
    out.hasPalette = info.hasPalette;
  } else {
    out.sof = info.sof;
    out.components = info.components;
    out.segments = info.segments;
  }
  return out;
}

export function run(action, input) {
  const verb = String(action == null ? 'info' : action).trim().toLowerCase();
  const arg = input && typeof input === 'object' && !Buffer.isBuffer(input) && !(input instanceof Uint8Array)
    ? input
    : { data: input };
  try {
    if (verb === 'info' || verb === 'decode' || verb === 'probe') {
      const source = arg.data != null ? arg.data : (arg.path != null ? arg.path : arg);
      const buf = toBuffer(source);
      const info = decode(buf);
      const result = shape(info);
      result.sha256 = sha256(buf);
      result.source = typeof source === 'string' ? source : 'memory';
      return { ok: true, action: verb, result };
    }
    if (verb === 'encode') {
      const png = encode(arg);
      const back = decode(png);
      if (typeof arg.out === 'string' && arg.out) fs.writeFileSync(arg.out, png);
      return {
        ok: true,
        action: verb,
        result: {
          format: 'png',
          width: back.width,
          height: back.height,
          bytes: png.length,
          crcOk: back.crcOk,
          sha256: sha256(png),
          out: typeof arg.out === 'string' && arg.out ? arg.out : null,
          png
        }
      };
    }
    if (verb === 'thumb' || verb === 'thumbnail') {
      const source = arg.data != null ? arg.data : (arg.path != null ? arg.path : arg.source);
      if (source == null) throw new PictureError('BAD_INPUT', 'thumb 需要 data 或 path');
      const png = thumbnail(source, { width: arg.width, height: arg.height });
      const back = decode(png);
      if (typeof arg.out === 'string' && arg.out) fs.writeFileSync(arg.out, png);
      return {
        ok: true,
        action: verb,
        result: {
          format: 'png',
          width: back.width,
          height: back.height,
          bytes: png.length,
          sha256: sha256(png),
          out: typeof arg.out === 'string' && arg.out ? arg.out : null,
          png
        }
      };
    }
    return { ok: false, action: verb, error: 'UNKNOWN_ACTION', message: 'PictureCraft 只认 info/encode/thumb' };
  } catch (err) {
    const code = (err && err.code) || 'INTERNAL_ERROR';
    return { ok: false, action: verb, error: code, message: String((err && err.message) || err) };
  }
}

export default { META, capabilities, plan, run, decode, encode, thumbnail };
