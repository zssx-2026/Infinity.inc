/*
 * dav.js - mount the cloud as a disk.
 *
 * Windows and macOS both speak WebDAV and both can map a WebDAV endpoint to
 * a drive letter, so the shortest path from a cloud drive to a drive letter
 * in Explorer is a small WebDAV server over the same Store the two-pane view
 * already uses. No filesystem driver, no kernel component, nothing to sign.
 *
 * Only the verbs a file manager actually issues are here: OPTIONS for the
 * handshake, PROPFIND for a listing, GET and HEAD for reading, PUT for
 * writing, DELETE for removing, MKCOL for a new folder, MOVE for a rename.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { normPath, baseOf, cacheDirFor } from '../store/store.js';

/* A promise to the client, not a quota enforced here. */
export const DEFAULT_SIZE = 1024 * 1024 * 1024 * 1024;

const AMP = String.fromCharCode(38);
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const DQ = String.fromCharCode(34);
const SQ = String.fromCharCode(39);

/* Escape the five characters XML reserves. */
function xesc(s) {
  return String(s)
    .split(AMP).join(AMP + 'amp;')
    .split(LT).join(AMP + 'lt;')
    .split(GT).join(AMP + 'gt;')
    .split(DQ).join(AMP + 'quot;')
    .split(SQ).join(AMP + 'apos;');
}

/* WebDAV wants ISO 8601 with a literal Z and no milliseconds. */
function iso(ts) {
  return new Date(ts || Date.now()).toISOString().slice(0, 19) + 'Z';
}

function httpDate(ts) {
  return new Date(ts || Date.now()).toUTCString();
}

/* One element with text inside, which is all the XML here needs. */
function tag(name, inner) {
  return LT + name + GT + inner + LT + '/' + name + GT;
}

function xmlHead() {
  return LT + '?xml version=' + DQ + '1.0' + DQ + ' encoding=' + DQ + 'utf-8' + DQ + '?' + GT;
}

function openMulti() {
  return LT + 'D:multistatus xmlns:D=' + DQ + 'DAV:' + DQ + GT;
}

function closeMulti() {
  return LT + '/D:multistatus' + GT;
}

/*
 * One PROPFIND response. Windows reads the display name and the content
 * length; the rest is for other clients.
 */
function propResponse(href, entry) {
  const isDir = entry.type === 'folder';
  const size = isDir ? 0 : (entry.size || 0);
  const props = [];
  props.push(tag('D:displayname', xesc(entry.name)));
  props.push(tag('D:getcontentlength', String(size)));
  props.push(tag('D:getlastmodified', httpDate(entry.mtime)));
  props.push(tag('D:creationdate', iso(entry.ctime)));
  props.push(tag('D:resourcetype', isDir ? LT + 'D:collection/' + GT : ''));
  const out = [];
  out.push('  ' + LT + 'D:response' + GT);
  out.push('    ' + tag('D:href', xesc(href)));
  out.push('    ' + LT + 'D:propstat' + GT);
  out.push('      ' + tag('D:prop', props.join('')));
  out.push('      ' + tag('D:status', 'HTTP/1.1 200 OK'));
  out.push('    ' + LT + '/D:propstat' + GT);
  out.push('  ' + LT + '/D:response' + GT);
  return out.join(String.fromCharCode(10));
}

/*
 * The server. The manifest is read on every request rather than cached,
 * because a file uploaded from the interface while the drive is mounted
 * has to appear in Explorer on the next refresh.
 */
export class DavServer {
  constructor(store, opts) {
    this.store = store;
    this.o = opts || {};
    this.port = this.o.port || 19780;
    this.host = this.o.host || '127.0.0.1';
    this.label = this.o.label || 'Infinity Cloud';
    this.size = this.o.size || DEFAULT_SIZE;
    this.server = null;
  }

  /* The href every response hangs off. Windows needs a trailing slash. */
  hrefFor(cp) {
    if (cp === '/') return '/';
    return cp.split('/').map(function (part, i) {
      return i === 0 ? '' : encodeURIComponent(part);
    }).join('/');
  }

  /*
   * Depth 0 asks about one path; Depth 1 asks about it and its children,
   * and that is what Explorer sends when a folder is opened. A larger
   * depth is answered as 1 rather than refused, because some clients send
   * infinity and then wait forever on an error.
   */
  async propfind(req, res, cp, depth) {
    const self = this.store.stat(cp);
    if (!self && cp !== '/') { res.writeHead(404); res.end(); return; }
    const root = self || { name: this.label, path: '/', type: 'folder', size: 0, mtime: Date.now(), ctime: Date.now() };
    const parts = [propResponse(this.hrefFor(cp), root)];
    if (depth !== '0') {
      for (const k of this.store.list(cp, {})) {
        const child = cp === '/' ? '/' + k.name : cp + '/' + k.name;
        parts.push(propResponse(this.hrefFor(child), k));
      }
    }
    const body = xmlHead() + NL + openMulti() + NL + parts.join(NL) + NL + closeMulti() + NL;
    res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  }

  /*
   * GET with ranges.
   *
   * A media player seeks with a Range header, so a request carrying one
   * gets 206 and only the asked-for slice. The whole file is pulled into
   * the cache either way: a part lives inside a release asset and there is
   * no way to ask GitHub for an offset.
   */
  async get(req, res, cp) {
    const e = this.store.stat(cp);
    if (!e || e.type === 'folder') { res.writeHead(404); res.end(); return; }
    const tmp = path.join(cacheDirFor('dav'), 'dav-' + Date.now() + '-' + baseOf(cp));
    try { await this.store.get(cp, tmp, {}); }
    catch (err) { res.writeHead(500); res.end(String(err.message)); return; }
    const size = fs.statSync(tmp).size;
    const type = guessType(cp);
    const clean = function () { try { fs.unlinkSync(tmp); } catch (x) { } };
    const range = req.headers.range;
    if (range) {
      const m = /bytes=([0-9]*)-([0-9]*)/.exec(range);
      const start = m && m[1] ? parseInt(m[1], 10) : 0;
      const end = m && m[2] ? parseInt(m[2], 10) : size - 1;
      const len = Math.max(0, end - start + 1);
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Length': len,
        'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
        'Accept-Ranges': 'bytes',
        'Last-Modified': httpDate(e.mtime)
      });
      if (req.method === 'HEAD') { res.end(); clean(); return; }
      fs.createReadStream(tmp, { start: start, end: end }).pipe(res).on('close', clean);
      return;
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': size,
      'Accept-Ranges': 'bytes',
      'Last-Modified': httpDate(e.mtime)
    });
    if (req.method === 'HEAD') { res.end(); clean(); return; }
    fs.createReadStream(tmp).pipe(res).on('close', clean);
  }

  /* The body goes to a cache file first: the store uploads from a path. */
  async put(req, res, cp) {
    const tmp = path.join(cacheDirFor('dav'), 'up-' + Date.now() + '-' + baseOf(cp));
    const out = fs.createWriteStream(tmp);
    const done = new Promise(function (resolve, reject) {
      req.pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
      req.on('error', reject);
    });
    try {
      await done;
      await this.store.put(tmp, cp, {});
      await this.store.flush();
      res.writeHead(201);
      res.end();
    } catch (err) {
      res.writeHead(500);
      res.end(String(err.message));
    } finally {
      try { fs.unlinkSync(tmp); } catch (e) { }
    }
  }

  async remove(req, res, cp) {
    try {
      await this.store.rm(cp, { purge: true });
      await this.store.flush();
      res.writeHead(204);
      res.end();
    } catch (err) { res.writeHead(404); res.end(); }
  }

  async mkcol(req, res, cp) {
    if (this.store.stat(cp)) { res.writeHead(405); res.end(); return; }
    this.store.mkdir(cp);
    await this.store.flush();
    res.writeHead(201);
    res.end();
  }

  /*
   * Windows sends the target as a full URL in Destination and an overwrite
   * decision in Overwrite. Both are honoured.
   */
  async move(req, res, cp) {
    const dest = req.headers.destination;
    if (!dest) { res.writeHead(400); res.end(); return; }
    let target = dest;
    try { target = new URL(dest).pathname; } catch (e) { }
    target = normPath(decodeURIComponent(target));
    const overwrite = String(req.headers.overwrite || 'T').toUpperCase() !== 'F';
    const exists = this.store.stat(target);
    if (exists && !overwrite) { res.writeHead(412); res.end(); return; }
    if (exists) await this.store.rm(target, { purge: true });
    const e = this.store.stat(cp);
    if (!e) { res.writeHead(404); res.end(); return; }
    e.path = target;
    e.name = baseOf(target);
    e.modified = Date.now();
    this.store.manifest.files[target] = e;
    delete this.store.manifest.files[cp];
    await this.store.flush();
    res.writeHead(exists ? 204 : 201);
    res.end();
  }

  /* Route one request. */
  async handle(req, res) {
    const url = new URL(req.url, 'http://' + this.host);
    const cp = normPath(decodeURIComponent(url.pathname));
    const method = req.method.toUpperCase();
    if (method === 'OPTIONS') {
      res.writeHead(200, {
        'DAV': '1, 2',
        'MS-Author-Via': 'DAV',
        'Allow': 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL, MOVE'
      });
      res.end();
      return;
    }
    if (method === 'PROPFIND') { await this.propfind(req, res, cp, req.headers.depth || '1'); return; }
    if (method === 'GET' || method === 'HEAD') { await this.get(req, res, cp); return; }
    if (method === 'PUT') { await this.put(req, res, cp); return; }
    if (method === 'DELETE') { await this.remove(req, res, cp); return; }
    if (method === 'MKCOL') { await this.mkcol(req, res, cp); return; }
    if (method === 'MOVE') { await this.move(req, res, cp); return; }
    res.writeHead(405);
    res.end();
  }

  start() {
    const self = this;
    this.server = http.createServer(function (req, res) {
      self.handle(req, res).catch(function (e) {
        try { res.writeHead(500); res.end(String(e.message)); } catch (x) { }
      });
    });
    return new Promise(function (resolve, reject) {
      self.server.on('error', reject);
      self.server.listen(self.port, self.host, function () {
        resolve('http://' + self.host + ':' + self.port + '/');
      });
    });
  }

  stop() {
    if (!this.server) return Promise.resolve();
    const s = this.server;
    this.server = null;
    return new Promise(function (resolve) { s.close(resolve); });
  }
}

/* The content type a client expects, by extension. */
export function guessType(name) {
  const ext = path.extname(name).toLowerCase();
  const map = {
    '.txt': 'text/plain', '.md': 'text/plain', '.json': 'application/json',
    '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.pdf': 'application/pdf',
    '.zip': 'application/zip', '.7z': 'application/x-7z-compressed',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska', '.exe': 'application/octet-stream'
  };
  return map[ext] || 'application/octet-stream';
}

