#!/usr/bin/env node
// range-server.mjs - a local stand-in for the signed CDN URL GitHub's asset API
// hands out, for the preview tests.
//
// It answers GET /<name> from --root, supports "Range: bytes=a-b" with 206 and
// the right slice, can fail the first N requests of every path (retry tests)
// and can delay a path (timeout tests). Every request is appended, one JSON
// object per line, to --log, because the chunk size, the number of attempts and
// the tail offset are properties of the wire and the test reads them there.
//
// Usage:
//   node range-server.mjs [--root DIR] [--port N] [--log FILE] [--fail-first N]
//                         [--max-span N] [--delay name=ms] [--delay-all ms]
//
// Prints one line, "LISTENING <port>", once it is accepting, then stays up
// until it is killed (taskkill /PID <pid> /T /F).

import { createServer } from 'node:http';
import { appendFileSync, createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = {
    root: join(here, '_fixtures'),
    port: 0,
    log: join(here, '_out', 'requests.jsonl'),
    failFirstAll: 0,
    failFirst: new Map(),
    maxSpan: 262144,
    delayAll: 0,
    delay: new Map()
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') opts.root = argv[++i];
    else if (a === '--port') opts.port = Number(argv[++i]);
    else if (a === '--log') opts.log = argv[++i];
    else if (a === '--fail-first') {
      const v = String(argv[++i]);
      const eq = v.lastIndexOf('=');
      if (eq < 0) opts.failFirstAll = Number(v);
      else opts.failFirst.set(v.slice(0, eq), Number(v.slice(eq + 1)));
    }
    else if (a === '--max-span') opts.maxSpan = Number(argv[++i]);
    else if (a === '--delay-all') opts.delayAll = Number(argv[++i]);
    else if (a === '--delay') {
      const v = String(argv[++i]);
      const eq = v.lastIndexOf('=');
      opts.delay.set(v.slice(0, eq), Number(v.slice(eq + 1)));
    }
  }
  opts.root = resolve(opts.root);
  mkdirSync(dirname(resolve(opts.log)), { recursive: true });
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const counts = new Map();
let n = 0;

function log(entry) {
  appendFileSync(opts.log, JSON.stringify(entry) + '\n');
}

function sendJson(res, status, message) {
  const body = Buffer.from(JSON.stringify({ error: message }));
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': body.length });
  res.end(body);
}

const server = createServer((req, res) => {
  const started = Date.now();
  const raw = (req.url || '/').split('?')[0].replace(/^\/+/, '');
  const name = decodeURIComponent(raw);
  const file = resolve(opts.root, name);
  const entry = { n: ++n, ts: started, method: req.method, path: name, range: req.headers.range || '', status: 0, sent: 0, span: 0, violation: false };

  if (req.method !== 'GET') { entry.status = 405; log(entry); return sendJson(res, 405, 'method not allowed'); }
  if (!file.startsWith(opts.root + sep) && file !== opts.root) { entry.status = 403; log(entry); return sendJson(res, 403, 'outside the root'); }
  if (!existsSync(file) || !statSync(file).isFile()) { entry.status = 404; log(entry); return sendJson(res, 404, 'no such fixture'); }

  const count = (counts.get(name) || 0) + 1;
  counts.set(name, count);
  const delayMs = opts.delay.has(name) ? opts.delay.get(name) : opts.delayAll;

  const finish = () => {
    const failLimit = opts.failFirst.has(name) ? opts.failFirst.get(name) : opts.failFirstAll;
    if (failLimit > 0 && count <= failLimit) {
      entry.status = 503;
      log(entry);
      return sendJson(res, 503, 'staged failure ' + count + ' of ' + failLimit);
    }
    const size = statSync(file).size;
    let status = 200, start = 0, end = size - 1;
    const range = String(req.headers.range || '').trim();
    if (range) {
      const m = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!m) { entry.status = 416; log(entry); return sendJson(res, 416, 'bad range'); }
      start = Number(m[1]);
      end = m[2] === '' ? size - 1 : Number(m[2]);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= size || end < start) {
        entry.status = 416; log(entry); return sendJson(res, 416, 'range outside the file');
      }
      if (end >= size) end = size - 1;
      const span = end - start + 1;
      if (span > opts.maxSpan) {
        entry.status = 416; entry.span = span; entry.violation = true;
        log(entry);
        return sendJson(res, 416, 'span ' + span + ' exceeds ' + opts.maxSpan);
      }
      status = 206;
    }
    const length = end - start + 1;
    const headers = {
      'Content-Type': 'application/octet-stream',
      'Content-Length': length,
      'Accept-Ranges': 'bytes'
    };
    if (status === 206) headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size;
    entry.status = status;
    entry.start = start;
    entry.end = end;
    entry.span = length;
    entry.sent = length;
    // The record is written as soon as the answer is decided: a client that
    // gave up and closed the socket must still be visible in the log.
    log(entry);
    res.writeHead(status, headers);
    if (length === 0) return res.end();
    const stream = createReadStream(file, { start, end });
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  };

  if (delayMs > 0) setTimeout(finish, delayMs); else finish();
});

server.listen(opts.port, '127.0.0.1', () => {
  console.log('LISTENING ' + server.address().port);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { server.close(); } catch (e) {} process.exit(0); });
}
