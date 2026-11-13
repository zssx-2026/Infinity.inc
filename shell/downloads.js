/*
 * downloads.js - the InfinityViewer download manager (IDM-style engine).
 *
 * The browser half of InfinityViewer hands every download to this engine
 * instead of letting Chromium stream it: one URL becomes N byte-range
 * requests written straight into their offsets in a single file, so a slow
 * or stalled connection only costs its own segment. Pausing keeps the bytes
 * already on disk, resuming continues each segment where it stopped, and the
 * unfinished list is written to disk so a restart can pick it up.
 *
 * Everything here is plain Node: no Electron, no network stack of its own
 * beyond node:http/https. main.js owns the window and only forwards frames.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const UA = 'InfinityViewer/1.0 (download manager)';
const MAX_REDIRECTS = 6;
const TICK_MS = 500;

function nowIso() { return new Date().toISOString(); }

/* A file name a Windows volume will accept, taken from the URL or from the
 * server's own Content-Disposition. Nothing else from the response is trusted. */
function safeName(raw, fallback) {
  let name = String(raw || '').replace(/^.*[\\/]/, '');
  try { name = decodeURIComponent(name); } catch (e) { }
  name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '');
  if (!name || name === '.' || name === '..') name = fallback || 'download.bin';
  return name.slice(0, 180);
}

function nameFromDisposition(header) {
  if (!header) return null;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (star) { try { return decodeURIComponent(star[1].trim()); } catch (e) { } }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
}

function request(url, options, redirects) {
  const u = new URL(url);
  const mod = u.protocol === 'https:' ? https : u.protocol === 'http:' ? http : null;
  if (!mod) return Promise.reject(new Error('unsupported scheme: ' + u.protocol));
  const opts = {
    method: (options && options.method) || 'GET',
    protocol: u.protocol,
    hostname: u.hostname,
    port: u.port || undefined,
    path: u.pathname + u.search,
    headers: Object.assign({ 'user-agent': UA, 'accept-encoding': 'identity' }, (options && options.headers) || {})
  };
  return new Promise(function (resolve, reject) {
    const req = mod.request(opts, function (res) {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        const hop = (redirects || 0) + 1;
        if (hop > MAX_REDIRECTS) { reject(new Error('too many redirects')); return; }
        const next = new URL(res.headers.location, url).toString();
        resolve(request(next, options, hop));
        return;
      }
      resolve({ res: res, status: status, url: url });
    });
    req.on('error', reject);
    req.setTimeout(30000, function () { req.destroy(new Error('timeout')); });
    if (options && options.body) req.write(options.body);
    req.end();
  });
}

function head(url) {
  return request(url, { method: 'HEAD' }).then(function (r) {
    r.res.resume();
    if (r.status >= 400) return request(url, { method: 'GET', headers: { range: 'bytes=0-0' } }).then(function (g) {
      const h = g.res.headers; g.res.resume();
      return { headers: h, status: g.status, url: g.url };
    });
    return { headers: r.res.headers, status: r.status, url: r.url };
  });
}

class DownloadManager {
  constructor(opts) {
    this.dir = opts.dir;
    this.stateFile = opts.stateFile;
    this.connections = Math.max(1, opts.connections || 8);
    this.concurrency = Math.max(1, opts.concurrency || 3);
    this.onEvent = opts.onEvent || function () { };
    this.items = [];
    this.seq = 0;
    this.timer = null;
    this.lastBytes = 0;
    this.lastAt = 0;
    this.load();
  }

  /* ---------- persistence ---------- */

  load() {
    try {
      const raw = fs.readFileSync(this.stateFile, 'utf8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        this.items = list.map(function (it) {
          it.status = it.status === 'done' ? 'done' : (it.status === 'canceled' ? 'canceled' : 'paused');
          it.speed = 0; it.eta = null;
          return it;
        });
        this.seq = this.items.reduce(function (m, it) { return Math.max(m, it.seq || 0); }, 0);
      }
    } catch (e) { this.items = []; }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      const list = this.items.map(function (it) {
        return {
          id: it.id, seq: it.seq, url: it.url, name: it.name, file: it.file,
          total: it.total, received: it.received, status: it.status,
          segments: it.segments, error: it.error, createdAt: it.createdAt
        };
      });
      fs.writeFileSync(this.stateFile, JSON.stringify(list, null, 1), 'utf8');
    } catch (e) { }
  }

  /* ---------- snapshot ---------- */

  snapshot() {
    return {
      dir: this.dir,
      items: this.items.map(function (it) {
        return {
          id: it.id, url: it.url, name: it.name, file: it.file,
          total: it.total, received: it.received, status: it.status,
          speed: Math.round(it.speed || 0), eta: it.eta,
          error: it.error || null, createdAt: it.createdAt,
          connections: it.segments ? it.segments.length : 1,
          parts: it.segments ? it.segments.filter(function (s) { return s.done; }).length : 0
        };
      })
    };
  }

  emit() {
    try { this.onEvent(this.snapshot()); } catch (e) { }
  }

  tick() {
    const now = Date.now();
    const total = this.items.reduce(function (n, it) { return n + (it.status === 'running' ? it.received : 0); }, 0);
    if (this.lastAt) {
      const dt = (now - this.lastAt) / 1000;
      const delta = total - this.lastBytes;
      const rate = dt > 0 ? Math.max(0, delta) / dt : 0;
      this.items.forEach(function (it) {
        if (it.status === 'running') {
          it.speed = rate;
          const left = it.total ? it.total - it.received : 0;
          it.eta = it.total && rate > 0 ? Math.round(left / rate) : null;
        } else { it.speed = 0; it.eta = null; }
      });
    }
    this.lastBytes = total;
    this.lastAt = now;
    this.emit();
    if (!this.items.some(function (it) { return it.status === 'running'; })) {
      this.stopTimer();
    }
  }

  startTimer() {
    if (this.timer) return;
    const self = this;
    this.lastAt = 0;
    this.timer = setInterval(function () { self.tick(); }, TICK_MS);
    if (this.timer.unref) this.timer.unref();
  }

  stopTimer() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.emit();
  }

  /* ---------- queue ---------- */

  start(url, name) {
    let parsed;
    try { parsed = new URL(url); } catch (e) { throw new Error('无效的下载地址'); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('只支持 http(s) 下载');
    const id = 'd' + Date.now().toString(36) + (++this.seq);
    const fallback = safeName(parsed.pathname, 'download.bin');
    const item = {
      id: id, seq: this.seq, url: parsed.toString(),
      name: safeName(name || fallback, fallback),
      file: null, total: 0, received: 0, status: 'queued',
      segments: null, error: null, createdAt: nowIso(), speed: 0, eta: null
    };
    this.items.unshift(item);
    this.save();
    this.emit();
    this.pump();
    return item.id;
  }

  find(id) { return this.items.filter(function (it) { return it.id === id; })[0] || null; }

  pump() {
    const active = this.items.filter(function (it) { return it.status === 'running'; }).length;
    let free = this.concurrency - active;
    if (free <= 0) return;
    const self = this;
    this.items.slice().reverse().forEach(function (it) {
      if (free > 0 && it.status === 'queued') { free--; self.run(it); }
    });
  }

  pause(id) {
    const it = this.find(id);
    if (!it || (it.status !== 'running' && it.status !== 'queued')) return false;
    it.status = 'paused';
    this.abort(it);
    this.save(); this.emit(); this.pump();
    return true;
  }

  resume(id) {
    const it = this.find(id);
    if (!it || it.status === 'running' || it.status === 'done') return false;
    it.status = 'queued'; it.error = null;
    this.save(); this.emit(); this.pump();
    return true;
  }

  cancel(id) {
    const it = this.find(id);
    if (!it) return false;
    it.status = 'canceled';
    this.abort(it);
    try { if (it.file) fs.unlinkSync(it.file); } catch (e) { }
    this.save(); this.emit(); this.pump();
    return true;
  }

  remove(id) {
    const it = this.find(id);
    if (!it) return false;
    if (it.status === 'running') { it.status = 'canceled'; this.abort(it); }
    this.items = this.items.filter(function (x) { return x.id !== id; });
    this.save(); this.emit();
    return true;
  }

  clearDone() {
    const self = this;
    this.items = this.items.filter(function (it) { return it.status !== 'done' && it.status !== 'canceled'; });
    self.save(); self.emit();
    return true;
  }

  abort(it) {
    if (it._reqs) {
      it._reqs.forEach(function (r) { try { r.destroy(); } catch (e) { } });
      it._reqs = [];
    }
    if (it._fd != null) { try { fs.closeSync(it._fd); } catch (e) { } it._fd = null; }
  }

  /* ---------- the engine ---------- */

  run(it) {
    const self = this;
    it.status = 'running';
    it.error = null;
    this.startTimer();
    this.emit();

    const proceed = function (meta) {
      if (it.status !== 'running') return;
      const headers = meta.headers || {};
      const len = parseInt(headers['content-length'], 10);
      const total = isFinite(len) && len > 0 ? len : 0;
      const ranges = /bytes/i.test(String(headers['accept-ranges'] || ''));
      it.total = total;
      it.url = meta.url || it.url;
      if (!it.name || it.name === 'download.bin') {
        it.name = safeName(nameFromDisposition(headers['content-disposition']) || it.name, 'download.bin');
      }
      /* A resumed item keeps the file its earlier bytes already live in;
       * picking a fresh name here would strand the partial download and
       * start a second copy beside it. */
      it.file = it.file || self.uniquePath(it.name);
      /* A ranged server and a known size get the parallel path; anything else
       * is streamed once, which is still resumable at the byte level. */
      if (ranges && total > 256 * 1024) self.segmented(it, meta.url, total);
      else self.single(it, meta.url);
    };

    head(it.url).then(proceed).catch(function (err) {
      /* Some servers reject HEAD; fall back to a plain GET and read the
       * headers from it. */
      request(it.url, { method: 'GET', headers: { range: 'bytes=0-0' } }).then(function (r) {
        const meta = { headers: r.res.headers, url: r.url };
        r.res.resume();
        proceed(meta);
      }).catch(function (e2) {
        it.status = 'error';
        it.error = String((e2 && e2.message) || e2);
        self.save(); self.emit(); self.pump();
      });
    });
  }

  uniquePath(name) {
    const base = path.join(this.dir, name);
    if (!fs.existsSync(base)) return base;
    const ext = path.extname(name);
    const stem = path.basename(name, ext);
    for (let i = 2; i < 500; i++) {
      const p = path.join(this.dir, stem + ' (' + i + ')' + ext);
      if (!fs.existsSync(p)) return p;
    }
    return path.join(this.dir, Date.now() + '-' + name);
  }

  segmented(it, url, total) {
    const self = this;
    const n = Math.min(this.connections, Math.max(1, Math.ceil(total / (512 * 1024))));
    const chunk = Math.ceil(total / n);
    if (!it.segments || !it.segments.length) {
      it.segments = [];
      for (let i = 0; i < n; i++) {
        const start = i * chunk;
        const end = i === n - 1 ? total - 1 : start + chunk - 1;
        it.segments.push({ start: start, end: end, pos: start, done: false });
      }
    }
    try {
      fs.mkdirSync(path.dirname(it.file), { recursive: true });
      if (it._fd == null) {
        it._fd = fs.openSync(it.file, fs.existsSync(it.file) ? 'r+' : 'w');
        try { fs.ftruncateSync(it._fd, total); } catch (e) { }
      }
    } catch (e) {
      it.status = 'error'; it.error = '无法写入文件：' + e.message;
      this.save(); this.emit(); return;
    }
    it._reqs = it._reqs || [];
    it.received = it.segments.reduce(function (n2, s) { return n2 + (s.pos - s.start); }, 0);

    const finishIfDone = function () {
      if (it.status !== 'running') return;
      if (!it.segments.every(function (s) { return s.done; })) return;
      try { if (it._fd != null) { fs.closeSync(it._fd); it._fd = null; } } catch (e) { }
      it.status = 'done';
      it.received = total;
      it.speed = 0; it.eta = 0;
      self.save(); self.emit(); self.pump();
    };

    it.segments.forEach(function (seg) {
      if (seg.done) return;
      const attempt = function (tries) {
        if (it.status !== 'running') return;
        if (seg.pos > seg.end) { seg.done = true; finishIfDone(); return; }
        request(url, { headers: { range: 'bytes=' + seg.pos + '-' + seg.end } }).then(function (r) {
          if (r.status === 206 || r.status === 200) {
            const body = r.res;
            it._reqs.push(body);
            body.on('data', function (chunkBuf) {
              if (it.status !== 'running') { body.destroy(); return; }
              const want = Math.min(chunkBuf.length, seg.end - seg.pos + 1);
              try {
                fs.writeSync(it._fd, chunkBuf, 0, want, seg.pos);
              } catch (e) {
                it.status = 'error'; it.error = '写入失败：' + e.message; body.destroy();
                self.save(); self.emit(); return;
              }
              seg.pos += want;
              it.received += want;
              if (seg.pos > seg.end) { seg.done = true; body.destroy(); finishIfDone(); }
            });
            body.on('end', function () {
              if (seg.pos > seg.end) { seg.done = true; finishIfDone(); }
              else if (it.status === 'running') attempt((tries || 0) + 1);
            });
            body.on('error', function () {
              if (it.status === 'running') attempt((tries || 0) + 1);
            });
          } else {
            r.res.resume();
            it.status = 'error'; it.error = '服务器返回 HTTP ' + r.status;
            self.save(); self.emit();
          }
        }).catch(function (e) {
          if (it.status !== 'running') return;
          if ((tries || 0) < 3) setTimeout(function () { attempt((tries || 0) + 1); }, 800 * ((tries || 0) + 1));
          else { it.status = 'error'; it.error = String(e.message || e); self.save(); self.emit(); }
        });
      };
      attempt(0);
    });
  }

  single(it, url) {
    const self = this;
    try {
      fs.mkdirSync(path.dirname(it.file), { recursive: true });
      if (it._fd == null) it._fd = fs.openSync(it.file, fs.existsSync(it.file) ? 'r+' : 'w');
    } catch (e) {
      it.status = 'error'; it.error = '无法写入文件：' + e.message; this.save(); this.emit(); return;
    }
    it.segments = null;
    it._reqs = it._reqs || [];
    const from = it.received || 0;
    const headers = from > 0 ? { range: 'bytes=' + from + '-' } : {};
    request(url, { headers: headers }).then(function (r) {
      if (r.status >= 400) {
        r.res.resume();
        it.status = 'error'; it.error = '服务器返回 HTTP ' + r.status;
        self.save(); self.emit(); return;
      }
      const body = r.res;
      it._reqs.push(body);
      body.on('data', function (buf) {
        if (it.status !== 'running') { body.destroy(); return; }
        try { fs.writeSync(it._fd, buf, 0, buf.length, it.received); } catch (e) {
          it.status = 'error'; it.error = '写入失败：' + e.message; body.destroy();
          self.save(); self.emit(); return;
        }
        it.received += buf.length;
      });
      body.on('end', function () {
        if (it.status !== 'running') return;
        try { if (it._fd != null) { fs.closeSync(it._fd); it._fd = null; } } catch (e) { }
        it.status = 'done';
        if (!it.total) it.total = it.received;
        self.save(); self.emit(); self.pump();
      });
      body.on('error', function (e) {
        if (it.status !== 'running') return;
        it.status = 'error'; it.error = String(e.message || e); self.save(); self.emit();
      });
    }).catch(function (e) {
      it.status = 'error'; it.error = String(e.message || e); self.save(); self.emit();
    });
  }
}

module.exports = { DownloadManager: DownloadManager };
