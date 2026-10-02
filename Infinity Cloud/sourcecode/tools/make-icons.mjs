/*
 * make-icons.mjs - draw the two application icons and pack them into .ico
 * files. Pure Node: the pixels are computed here and the container is written
 * by hand, so the build needs nothing installed.
 *
 * An ICO is a directory followed by one image per size. Each image is a BITMAP
 * INFO header, the pixel rows bottom-up, and a 1-bit AND mask. Modern Windows
 * ignores the mask when the image has an alpha channel, but it still has to be
 * present and correctly sized or the file is rejected.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const NL = String.fromCharCode(10);
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..', 'assets');

function blend(dst, src, a) {
  return Math.round(dst * (1 - a) + src * a);
}

function drawCloud(x, y, S) {
  // A rounded square with three stacked bars: the cloud mark.
  const cx = S / 2, cy = S / 2;
  const r = S * 0.42;
  const dx = Math.abs(x - cx), dy = Math.abs(y - cy);
  const inside = dx <= r && dy <= r;
  if (!inside) return null;
  const edge = Math.min(r - dx, r - dy);
  const alpha = Math.max(0, Math.min(1, edge / (S * 0.02)));
  // vertical gradient, deep blue to cyan
  const t = (y - (cy - r)) / (2 * r);
  let R = Math.round(28 + 30 * t);
  let G = Math.round(96 + 110 * t);
  let B = Math.round(210 + 40 * t);
  // a white cloud made of three circles
  const blobs = [
    [cx - r * 0.34, cy + r * 0.10, r * 0.34],
    [cx, cy - r * 0.14, r * 0.46],
    [cx + r * 0.38, cy + r * 0.08, r * 0.32],
    [cx, cy + r * 0.30, r * 0.42]
  ];
  let inCloud = false;
  for (const b of blobs) {
    const d = Math.hypot(x - b[0], y - b[1]);
    if (d <= b[2]) { inCloud = true; break; }
    if (d <= b[2] + S * 0.012) {
      const a = 1 - (d - b[2]) / (S * 0.012);
      R = blend(R, 255, a); G = blend(G, 255, a); B = blend(B, 255, a);
      inCloud = true;
    }
  }
  if (inCloud) { R = 246; G = 250; B = 255; }
  return [R, G, B, Math.round(255 * alpha)];
}

function drawFolder(x, y, S) {
  // A folder with a tab, the way Explorer draws one.
  const m = S * 0.10;
  const tabH = S * 0.20;
  const tabW = S * 0.46;
  const bodyTop = m + tabH;
  const bodyBot = S - m;
  const bodyLeft = m;
  const bodyRight = S - m;
  let inBody = x >= bodyLeft && x <= bodyRight && y >= bodyTop && y <= bodyBot;
  let inTab = x >= bodyLeft && x <= bodyLeft + tabW && y >= m && y <= bodyTop;
  if (!inBody && !inTab) return null;
  const edge = Math.min(x - bodyLeft, bodyRight - x, y - m, bodyBot - y);
  const alpha = Math.max(0, Math.min(1, edge / (S * 0.02)));
  const t = (y - m) / (S - 2 * m);
  let R, G, B;
  if (inTab) { R = 240; G = 186; B = 92; }
  else { R = Math.round(250 - 20 * t); G = Math.round(196 - 24 * t); B = Math.round(104 - 20 * t); }
  // a lighter band across the top of the body, so the shape reads as a folder
  if (inBody && y < bodyTop + S * 0.10) { R = blend(R, 255, 0.35); G = blend(G, 255, 0.35); B = blend(B, 255, 0.35); }
  return [R, G, B, Math.round(255 * alpha)];
}

function render(S, kind) {
  const px = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const c = kind === 'inc' ? drawCloud(x + 0.5, y + 0.5, S) : drawFolder(x + 0.5, y + 0.5, S);
      const i = (y * S + x) * 4;
      if (!c) { px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 0; continue; }
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = c[3];
    }
  }
  return px;
}

function icoImage(S, rgba) {
  const hdr = Buffer.alloc(40);
  hdr.writeUInt32LE(40, 0);
  hdr.writeInt32LE(S, 4);
  hdr.writeInt32LE(S * 2, 8);
  hdr.writeUInt16LE(1, 12);
  hdr.writeUInt16LE(32, 14);
  const xor = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const s = ((S - 1 - y) * S + x) * 4;
      const d = (y * S + x) * 4;
      xor[d] = rgba[s + 2];
      xor[d + 1] = rgba[s + 1];
      xor[d + 2] = rgba[s];
      xor[d + 3] = rgba[s + 3];
    }
  }
  const rowBytes = Math.floor((S + 31) / 32) * 4;
  const and = Buffer.alloc(rowBytes * S);
  return Buffer.concat([hdr, xor, and]);
}

function packIco(sizes, kind) {
  const images = sizes.map((S) => icoImage(S, render(S, kind)));
  const dir = Buffer.alloc(6 + 16 * sizes.length);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(sizes.length, 4);
  let off = dir.length;
  for (let i = 0; i < sizes.length; i++) {
    const e = 6 + i * 16;
    dir[e] = sizes[i] >= 256 ? 0 : sizes[i];
    dir[e + 1] = sizes[i] >= 256 ? 0 : sizes[i];
    dir[e + 2] = 0;
    dir[e + 3] = 0;
    dir.writeUInt16LE(1, e + 4);
    dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(images[i].length, e + 8);
    dir.writeUInt32LE(off, e + 12);
    off += images[i].length;
  }
  return Buffer.concat([dir, ...images]);
}

const SIZES = [16, 24, 32, 48, 64, 128];
fs.mkdirSync(OUT, { recursive: true });
for (const kind of ['inc', 'ifm']) {
  const file = path.join(OUT, kind + '.ico');
  fs.writeFileSync(file, packIco(SIZES, kind));
  console.log(kind + '.ico  ' + fs.statSync(file).size + ' bytes');
}
console.log('done' + NL);
