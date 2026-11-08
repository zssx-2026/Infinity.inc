/*
 * Infinity.Inc - the work behind the gate (verify.js).
 *
 * Three commands, all local: nothing is fetched and nothing is uploaded.
 *
 *   bench  - hash for a fixed slice of time and report the rate, so the page
 *            can pick a difficulty this machine actually finishes in time
 *            instead of guessing and then lowering the bar for slow machines.
 *   start  - search for a nonce whose hash is below the target. The target is
 *            a 32-bit bound, not a count of hex zeros: the expected number of
 *            attempts is 2^32 / target, so difficulty moves continuously and
 *            a machine that hashes twice as fast is asked for twice the work
 *            instead of the same work in half the time.
 *   verify - recompute one (prefix, nonce) pair and say whether it still meets
 *            the target. This is what makes a stored pass a proof rather than
 *            a flag: the page never trusts the numbers it reads back, it
 *            re-hashes them.
 *
 * The hash is SHA-256 over the UTF-8 bytes of prefix + nonce, written out by
 * hand because a worker has no synchronous digest and SubtleCrypto is async
 * per call. The implementation is the ordinary one: message schedule, 64
 * rounds, big-endian length in the last eight bytes.
 */
'use strict';

var K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function utf8(str) {
  var out = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function sha256hex(str) {
  var bytes = utf8(str);
  var bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  var hi = Math.floor(bitLen / 4294967296), lo = bitLen >>> 0;
  bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255);
  bytes.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);

  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var w = new Array(64);
  for (var off = 0; off < bytes.length; off += 64) {
    for (var t = 0; t < 16; t++) {
      var j = off + t * 4;
      w[t] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
    }
    for (t = 16; t < 64; t++) {
      var s0 = (w[t - 15] >>> 7 | w[t - 15] << 25) ^ (w[t - 15] >>> 18 | w[t - 15] << 14) ^ (w[t - 15] >>> 3);
      var s1 = (w[t - 2] >>> 17 | w[t - 2] << 15) ^ (w[t - 2] >>> 19 | w[t - 2] << 13) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (t = 0; t < 64; t++) {
      var S1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
      var ch = (e & f) ^ (~e & g);
      var temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
      var S0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  var out = '';
  for (var i = 0; i < 8; i++) out += ('00000000' + H[i].toString(16)).slice(-8);
  return out;
}

/* The 32-bit value a hash is compared against. Taking the first word of the
 * digest is what makes the target a plain bound: hash32 < target. */
function hash32(hex) { return parseInt(hex.slice(0, 8), 16) >>> 0; }

var running = false;
var nonce = 0;
var hashes = 0;
var prefix = '';
var target = 1;

function solved(hash) {
  running = false;
  self.postMessage({ type: 'solved', prefix: prefix, nonce: nonce, hash: hash, target: target, hashes: hashes });
}

function search() {
  if (!running) return;
  var batch = 0;
  while (batch < 20000) {
    var hash = sha256hex(prefix + nonce);
    hashes++;
    var current = nonce;
    nonce++;
    batch++;
    if (hash32(hash) < target) { solved(hash); return; }
  }
  self.postMessage({ type: 'progress', hashes: hashes });
  setTimeout(search, 0);
}

function bench(ms) {
  var start = Date.now();
  var count = 0;
  var probe = 'bench|';
  while (Date.now() - start < ms) {
    sha256hex(probe + count);
    count++;
  }
  var elapsed = Math.max(1, Date.now() - start);
  self.postMessage({ type: 'bench', rate: Math.round(count * 1000 / elapsed), ms: elapsed, hashes: count });
}

self.onmessage = function (ev) {
  var d = ev.data || {};
  if (d.cmd === 'start') {
    prefix = String(d.prefix || '');
    target = (d.target >>> 0) || 1;
    nonce = 0; hashes = 0; running = true;
    search();
  } else if (d.cmd === 'bench') {
    bench(Math.max(50, Math.min(2000, d.ms || 300)));
  } else if (d.cmd === 'verify') {
    var p = String(d.prefix || '');
    var n = d.nonce >>> 0;
    var t = (d.target >>> 0) || 1;
    var h = sha256hex(p + n);
    self.postMessage({ type: 'verify', ok: hash32(h) < t, hash: h, prefix: p, nonce: n, target: t });
  } else if (d.cmd === 'stop') {
    running = false;
  }
};
