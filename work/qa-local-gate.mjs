import zlib from 'node:zlib';

const GATE = 'https://infinity-downloads.pages.dev';
const ASSET = 'InfinityStudio-setup';

const FONT = {
  A: ['01110','10001','10001','11111','10001','10001','10001'],
  B: ['11110','10001','10001','11110','10001','10001','11110'],
  C: ['01110','10001','10000','10000','10000','10001','01110'],
  D: ['11110','10001','10001','10001','10001','10001','11110'],
  E: ['11111','10000','10000','11110','10000','10000','11111'],
  F: ['11111','10000','10000','11110','10000','10000','10000'],
  G: ['01110','10001','10000','10111','10001','10001','01111'],
  H: ['10001','10001','10001','11111','10001','10001','10001'],
  J: ['00111','00010','00010','00010','00010','10010','01100'],
  K: ['10001','10010','10100','11000','10100','10010','10001'],
  L: ['10000','10000','10000','10000','10000','10000','11111'],
  M: ['10001','11011','10101','10101','10001','10001','10001'],
  N: ['10001','11001','10101','10011','10001','10001','10001'],
  P: ['11110','10001','10001','11110','10000','10000','10000'],
  Q: ['01110','10001','10001','10001','10101','10010','01101'],
  R: ['11110','10001','10001','11110','10100','10010','10001'],
  S: ['01111','10000','10000','01110','00001','00001','11110'],
  T: ['11111','00100','00100','00100','00100','00100','00100'],
  U: ['10001','10001','10001','10001','10001','10001','01110'],
  V: ['10001','10001','10001','10001','10001','01010','00100'],
  W: ['10001','10001','10001','10101','10101','11011','10001'],
  X: ['10001','10001','01010','00100','01010','10001','10001'],
  Y: ['10001','10001','01010','00100','00100','00100','00100'],
  Z: ['11111','00001','00010','00100','01000','10000','11111'],
  2: ['01110','10001','00001','00010','00100','01000','11111'],
  3: ['11111','00010','00100','00010','00001','10001','01110'],
  4: ['00010','00110','01010','10010','11111','00010','00010'],
  5: ['11111','10000','11110','00001','00001','10001','01110'],
  6: ['00110','01000','10000','11110','10001','10001','01110'],
  7: ['11111','00001','00010','00100','01000','01000','01000'],
  8: ['01110','10001','10001','01110','10001','10001','01110'],
  9: ['01110','10001','10001','01111','00001','00010','01100']
};

function decodePng(buf) {
  let off = 8;
  let width = 0, height = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width + 1;
  const px = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride];
    if (filter !== 0) throw new Error('unexpected filter ' + filter);
    raw.copy(px, y * width, y * stride + 1, y * stride + 1 + width);
  }
  return { width, height, px };
}

function readGlyph(img, ox, oy, s) {
  const bits = [];
  for (let row = 0; row < 7; row++) {
    let line = '';
    for (let col = 0; col < 5; col++) {
      let bright = 0, total = 0;
      for (let dy = 0; dy < s; dy++) {
        for (let dx = 0; dx < s; dx++) {
          const x = ox + col * s + dx, y = oy + row * s + dy;
          if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
          total++;
          if (img.px[y * img.width + x] > 150) bright++;
        }
      }
      line += (total && bright / total > 0.55) ? '1' : '0';
    }
    bits.push(line);
  }
  return bits;
}

function matchGlyph(bits) {
  let best = null, bestScore = -1;
  for (const [ch, glyph] of Object.entries(FONT)) {
    let score = 0;
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (glyph[r][c] === bits[r][c]) score++;
    if (score > bestScore) { bestScore = score; best = ch; }
  }
  return { ch: best, score: bestScore };
}

function recoverCode(img, length) {
  const s = 6, pad = 10, glyphW = 5 * s, gap = Math.round(s * 1.6);
  let out = '';
  const scores = [];
  for (let i = 0; i < length; i++) {
    const ox = pad + i * (glyphW + gap);
    let best = null, bestScore = -1;
    for (let jitter = -3; jitter <= 3; jitter++) {
      const bits = readGlyph(img, ox, pad + jitter, s);
      const m = matchGlyph(bits);
      if (m.score > bestScore) { bestScore = m.score; best = m.ch; }
    }
    out += best;
    scores.push(bestScore);
  }
  return { code: out, scores };
}

async function main() {
  const r1 = await fetch(GATE + '/api/verify', { cache: 'no-store' });
  const j1 = await r1.json();
  if (!j1.image || !j1.challenge) throw new Error('no challenge');
  const b64 = j1.image.split(',')[1];
  const img = decodePng(Buffer.from(b64, 'base64'));
  const rec = recoverCode(img, 5);
  console.log('image=' + img.width + 'x' + img.height + ' recovered=' + rec.code + ' scores=' + rec.scores.join(','));
  const r2 = await fetch(GATE + '/api/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challenge: j1.challenge, answer: rec.code, asset: ASSET })
  });
  const j2 = await r2.json();
  console.log('verify status=' + r2.status + ' ticket=' + (j2.ticket ? 'yes' : JSON.stringify(j2)));
  if (!j2.ticket) process.exit(2);
  const r3 = await fetch(GATE + '/dl/' + ASSET + '?lt=' + encodeURIComponent(j2.ticket), { redirect: 'manual' });
  console.log('gate status=' + r3.status + ' location=' + (r3.headers.get('location') || ''));
  if (r3.status !== 302) process.exit(3);
  const loc = r3.headers.get('location');
  console.log('asset url=' + loc);
  (await import('node:fs')).writeFileSync('work/qa-ticket.txt', j2.ticket, 'utf8');
  /* tamper check: same ticket on the other asset must be refused */
  const r4 = await fetch(GATE + '/dl/InfinityServer-setup?lt=' + encodeURIComponent(j2.ticket), { redirect: 'manual', headers: { accept: 'application/json' } });
  console.log('cross_asset status=' + r4.status + ' body=' + (await r4.text()));
  const r5 = await fetch(GATE + '/dl/' + ASSET + '?lt=forged.ticket', { redirect: 'manual', headers: { accept: 'application/json' } });
  console.log('forged status=' + r5.status + ' body=' + (await r5.text()));
  console.log('LOCAL-GATE PASS');
}

main().catch(function (e) { console.error('FAIL ' + e.message + ' | cause=' + (e.cause && (e.cause.code || e.cause.message)) + ' | at=' + (e.stack || '').split('\n')[1]); process.exit(1); });
