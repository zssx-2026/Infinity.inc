/*
 * project.js - the project container: many files, one artefact, and the proof
 * that nothing moved.
 *
 * A .is-ccp is a header you can read without unpacking anything, followed by
 * the files themselves laid end to end. The header carries the exact offset and
 * length of every file plus its sha256, so opening a project costs one read of
 * the first few hundred bytes, and trusting it costs one hash per file. A
 * container that cannot prove its own contents is a zip with better manners.
 *
 *   offset  size  field
 *   0       4     magic 'ISCP'
 *   4       1     kind: 0x01 plain payload, 0x02 deflate-raw payload
 *   5       4     u32le header length
 *   9       n     UTF-8 JSON header
 *   9+n     ...   payload (file bytes, in header order)
 *
 * The header is never compressed: that is the whole point of putting it first.
 * Two codecs write the same header and differ only in the payload:
 *
 *   plain    .is-ccp    since v1   payload stored as-is
 *   deflate  .is-ccpx   since v2   payload deflated with zlib deflateRaw
 *
 * 'since' is the container version that introduced the codec. A container
 * claiming deflate at v1 was written by something that did not exist, and the
 * decoder says so instead of guessing: CODEC_TOO_OLD.
 *
 * API
 *   encodeProject({component, files:[{path, bytes}], compressed, version?}) -> Buffer
 *   decodeProject(buf)      -> {ok, header, files:[{path, bytes}], ...} | {ok:false, code, message}
 *   writeProject(file, proj)-> {ok, path, bytes, ...}
 *   readProject(file)       -> decodeProject(file) + {path}
 *   projectHeader(file)     -> {ok, header, ...} without touching the payload
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

export const MAGIC = 'ISCP';
export const FORMAT = 'is-project';
export const CONTAINER_VERSION = 2;
export const HEADER_OFFSET = 9;
export const HEADER_LIMIT = 4 * 1024 * 1024;

export const CODECS = {
  plain: { id: 'plain', ext: '.is-ccp', since: 1, kind: 0x01, label: '明文容器', compressed: false },
  deflate: { id: 'deflate', ext: '.is-ccpx', since: 2, kind: 0x02, label: '压缩容器', compressed: true }
};

const KIND_TO_CODEC = { 0x01: 'plain', 0x02: 'deflate' };

/* Accepts an id ('deflate'), an extension ('.is-ccpx') or a codec record. */
export function codecInfo(codec) {
  if (!codec) return null;
  if (typeof codec === 'object' && codec.id && CODECS[codec.id]) return CODECS[codec.id];
  if (typeof codec === 'string') {
    const key = codec.replace(/^\./, '').toLowerCase();
    if (CODECS[key]) return CODECS[key];
    return codecForExtension(codec);
  }
  return null;
}

export function codecForExtension(target) {
  if (!target) return null;
  const ext = String(target).toLowerCase();
  for (const id of Object.keys(CODECS)) {
    if (ext.endsWith(CODECS[id].ext)) return CODECS[id];
  }
  return null;
}

export function codecForCompressed(compressed) {
  return compressed ? CODECS.deflate : CODECS.plain;
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function fail(code, message, extra) {
  return Object.assign({ ok: false, code: code, message: message }, extra || {});
}

function codedError(code, message, extra) {
  const e = new Error(message);
  e.code = code;
  return Object.assign(e, extra || {});
}

/* A file entry is {path, bytes} - 'data' and 'source' (a real file on disk)
 * are accepted as conveniences. Paths are container-relative and stay as
 * given; the container does not rewrite what the caller chose to name things. */
function collectFiles(files) {
  const out = [];
  if (!Array.isArray(files)) return { ok: false, message: 'files must be an array' };
  for (const f of files) {
    if (!f || typeof f.path !== 'string' || !f.path) {
      return { ok: false, message: 'every file needs a path' };
    }
    let data = f.bytes !== undefined ? f.bytes : f.data;
    if (data === undefined && typeof f.source === 'string') {
      if (!fs.existsSync(f.source)) return { ok: false, message: 'source not found: ' + f.source, path: f.path };
      data = fs.readFileSync(f.source);
    }
    if (data === undefined) return { ok: false, message: 'file has neither bytes nor source: ' + f.path, path: f.path };
    if (typeof data === 'string') data = Buffer.from(data, 'utf8');
    if (!Buffer.isBuffer(data)) data = Buffer.from(data);
    out.push({ path: f.path, bytes: data });
  }
  return { ok: true, files: out };
}

/* Encode. Throws a coded Error on bad input - the return value is the Buffer
 * itself, because that is what a caller writes, hashes or compares. */
export function encodeProject(input) {
  const src = input || {};
  const fromDecoded = !!(src.header && Array.isArray(src.files));

  const collected = collectFiles(src.files);
  if (!collected.ok) throw codedError('BAD_INPUT', collected.message, { path: collected.path });

  let codec;
  if (fromDecoded) {
    codec = codecInfo(src.header.codec) || CODECS.plain;
  } else if (typeof src.compressed === 'boolean') {
    codec = codecForCompressed(src.compressed);
  } else if (src.codec) {
    codec = codecInfo(src.codec);
    if (!codec) throw codedError('UNKNOWN_CODEC', 'unknown codec: ' + src.codec);
  } else if (src.extension) {
    codec = codecForExtension(src.extension) || CODECS.plain;
  } else {
    codec = CODECS.plain;
  }

  let version = fromDecoded ? Number(src.header.version) : Number(src.version);
  if (!Number.isFinite(version) || version < 1) version = CONTAINER_VERSION;
  /* The writer never emits a container that its own decoder would refuse. */
  if (version < codec.since) version = codec.since;

  const created = (fromDecoded ? src.header.created : src.created) || new Date().toISOString();
  const component = (fromDecoded ? src.header.component : src.component) || 'unknown';

  const parts = [];
  const entries = [];
  let offset = 0;
  for (const f of collected.files) {
    const digest = sha256(f.bytes);
    entries.push({ path: f.path, offset: offset, length: f.bytes.length, sha256: digest });
    parts.push(f.bytes);
    offset += f.bytes.length;
  }
  const payload = Buffer.concat(parts);

  /* Fixed key order: the same project must serialise to the same bytes, or
   * "identical" means nothing and diffing two builds is guesswork. */
  const header = {
    format: FORMAT,
    version: version,
    component: component,
    created: created,
    codec: codec.id,
    files: entries
  };
  const headerJson = Buffer.from(JSON.stringify(header), 'utf8');
  if (headerJson.length > HEADER_LIMIT) {
    throw codedError('HEADER_TOO_LARGE', 'header is ' + headerJson.length + ' bytes, limit is ' + HEADER_LIMIT);
  }

  const stored = codec.id === 'deflate' ? deflateRawSync(payload) : payload;
  const prefix = Buffer.alloc(HEADER_OFFSET);
  prefix.write(MAGIC, 0, 'latin1');
  prefix.writeUInt8(codec.kind, 4);
  prefix.writeUInt32LE(headerJson.length, 5);

  return Buffer.concat([prefix, headerJson, stored]);
}

/* Parse the fixed part of the container. Returns the header and where the
 * payload begins, or a typed refusal. Never throws on malformed input. */
function parseContainer(buf, opts) {
  if (!Buffer.isBuffer(buf)) return fail('BAD_INPUT', 'decodeProject expects a Buffer');
  const limit = (opts && opts.headerLimit) || HEADER_LIMIT;
  if (buf.length < HEADER_OFFSET) return fail('TRUNCATED', 'container is ' + buf.length + ' bytes, needs at least ' + HEADER_OFFSET);
  if (buf.toString('latin1', 0, 4) !== MAGIC) {
    return fail('BAD_MAGIC', 'not an Infinity project container: magic is ' + JSON.stringify(buf.toString('latin1', 0, 4)));
  }
  const kind = buf.readUInt8(4);
  const codecId = KIND_TO_CODEC[kind];
  if (!codecId) return fail('UNKNOWN_KIND', 'unknown payload kind 0x' + kind.toString(16).padStart(2, '0'));

  const headerLength = buf.readUInt32LE(5);
  if (headerLength > limit) return fail('HEADER_TOO_LARGE', 'header claims ' + headerLength + ' bytes, limit is ' + limit);
  if (buf.length < HEADER_OFFSET + headerLength) {
    return fail('TRUNCATED_HEADER', 'header claims ' + headerLength + ' bytes but only ' + (buf.length - HEADER_OFFSET) + ' remain');
  }

  const raw = buf.subarray(HEADER_OFFSET, HEADER_OFFSET + headerLength);
  let header;
  try {
    header = JSON.parse(raw.toString('utf8'));
  } catch (e) {
    return fail('BAD_HEADER_JSON', 'header is not valid UTF-8 JSON: ' + e.message);
  }
  if (!header || typeof header !== 'object' || Array.isArray(header)) return fail('BAD_HEADER', 'header must be a JSON object');
  if (header.format !== FORMAT) return fail('BAD_HEADER', 'header format is ' + JSON.stringify(header.format) + ', expected ' + JSON.stringify(FORMAT));
  if (!Array.isArray(header.files)) return fail('BAD_HEADER', 'header.files must be an array');
  if (header.codec !== undefined && header.codec !== codecId) {
    return fail('CODEC_MISMATCH', 'kind byte says ' + codecId + ' but header says ' + JSON.stringify(header.codec));
  }

  return { ok: true, codec: codecId, header: header, headerBytes: headerLength, payloadStart: HEADER_OFFSET + headerLength };
}

/* Decode. Every file is checked against the sha256 in the header; a container
 * that has been edited underneath us fails here, by name, instead of surfacing
 * as a corrupt document somewhere downstream. */
export function decodeProject(buf, opts) {
  const parsed = parseContainer(buf, opts);
  if (!parsed.ok) return parsed;

  const info = CODECS[parsed.codec];
  const header = parsed.header;
  const version = Number(header.version);
  if (!Number.isFinite(version) || version < 1) return fail('BAD_HEADER', 'header version is ' + JSON.stringify(header.version));
  if (version < info.since) {
    return fail('CODEC_TOO_OLD', 'codec ' + info.id + ' needs container v' + info.since + ', this is v' + version, {
      codec: info.id, version: version, since: info.since
    });
  }
  if (version > CONTAINER_VERSION) {
    return fail('CONTAINER_TOO_NEW', 'container v' + version + ' is newer than this decoder (v' + CONTAINER_VERSION + ')', { version: version });
  }

  const stored = buf.subarray(parsed.payloadStart);
  let payload;
  if (info.id === 'deflate') {
    try {
      payload = inflateRawSync(stored);
    } catch (e) {
      return fail('BAD_PAYLOAD', 'deflate payload did not inflate: ' + e.message);
    }
  } else {
    payload = stored;
  }

  const verify = !(opts && opts.verify === false);
  const files = [];
  const seen = new Set();
  let cursor = 0;
  for (let i = 0; i < header.files.length; i++) {
    const e = header.files[i];
    if (!e || typeof e.path !== 'string' || !e.path) return fail('BAD_HEADER', 'file entry ' + i + ' has no path');
    if (seen.has(e.path)) return fail('BAD_HEADER', 'duplicate path in header: ' + e.path, { path: e.path });
    seen.add(e.path);
    if (!Number.isInteger(e.offset) || !Number.isInteger(e.length) || e.offset < 0 || e.length < 0) {
      return fail('BAD_HEADER', 'file entry ' + i + ' has a bad offset/length', { path: e.path });
    }
    if (e.offset < cursor) return fail('BAD_RANGE', 'file ' + e.path + ' overlaps the previous entry', { path: e.path });
    if (e.offset + e.length > payload.length) {
      return fail('TRUNCATED_PAYLOAD', 'file ' + e.path + ' runs past the payload (' + (e.offset + e.length) + ' > ' + payload.length + ')', { path: e.path });
    }
    cursor = e.offset + e.length;
    const bytes = payload.subarray(e.offset, e.offset + e.length);
    const actual = sha256(bytes);
    if (verify && typeof e.sha256 === 'string' && actual !== e.sha256) {
      return fail('SHA_MISMATCH', 'file ' + e.path + ' does not match its header hash', {
        path: e.path, expected: e.sha256, actual: actual
      });
    }
    files.push({ path: e.path, bytes: bytes, offset: e.offset, length: e.length, sha256: e.sha256 || actual, actual: actual });
  }

  return {
    ok: true,
    header: header,
    files: files,
    codec: parsed.codec,
    extension: info.ext,
    compressed: info.compressed,
    version: version,
    payloadBytes: payload.length,
    headerBytes: parsed.headerBytes,
    size: buf.length,
    verified: verify
  };
}

/* The header alone, without inflating or hashing a single file. This is what
 * the UI uses to show a project before opening it. */
export function projectHeader(input, opts) {
  let buf = input;
  let file = null;
  if (typeof input === 'string') {
    file = input;
    let fd;
    try {
      fd = fs.openSync(file, 'r');
      const head = Buffer.alloc(HEADER_OFFSET);
      const got = fs.readSync(fd, head, 0, HEADER_OFFSET, 0);
      if (got < HEADER_OFFSET) return fail('TRUNCATED', 'file is ' + got + ' bytes, needs at least ' + HEADER_OFFSET, { path: file });
      if (head.toString('latin1', 0, 4) !== MAGIC) return fail('BAD_MAGIC', 'not an Infinity project container: ' + file, { path: file });
      const kind = head.readUInt8(4);
      const codecId = KIND_TO_CODEC[kind];
      if (!codecId) return fail('UNKNOWN_KIND', 'unknown payload kind 0x' + kind.toString(16).padStart(2, '0'), { path: file });
      const headerLength = head.readUInt32LE(5);
      const limit = (opts && opts.headerLimit) || HEADER_LIMIT;
      if (headerLength > limit) return fail('HEADER_TOO_LARGE', 'header claims ' + headerLength + ' bytes, limit is ' + limit, { path: file });
      const raw = Buffer.alloc(headerLength);
      const gotHeader = fs.readSync(fd, raw, 0, headerLength, HEADER_OFFSET);
      if (gotHeader < headerLength) return fail('TRUNCATED_HEADER', 'header claims ' + headerLength + ' bytes but only ' + gotHeader + ' remain', { path: file });
      buf = Buffer.concat([head, raw]);
    } catch (e) {
      return fail('READ_FAILED', 'cannot read ' + file + ': ' + e.message, { path: file });
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
  const parsed = parseContainer(buf, opts);
  if (!parsed.ok) return Object.assign(parsed, file ? { path: file } : {});
  const info = CODECS[parsed.codec];
  const totalBytes = file ? fs.statSync(file).size : input.length;
  return {
    ok: true,
    header: parsed.header,
    codec: parsed.codec,
    extension: info.ext,
    compressed: info.compressed,
    version: Number(parsed.header.version),
    headerBytes: parsed.headerBytes,
    payloadBytes: totalBytes - parsed.payloadStart,
    totalBytes: totalBytes,
    path: file || null
  };
}

/* Write atomically: a container half-written over a good one is how a project
 * gets lost. tmp beside the target, then rename over it. */
export function writeProject(filePath, project, opts) {
  if (typeof filePath !== 'string' || !filePath) return fail('BAD_INPUT', 'writeProject needs a target path');

  let buf;
  if (Buffer.isBuffer(project)) {
    buf = project;
  } else if (project && Buffer.isBuffer(project.bytes) && project.header) {
    buf = project.bytes;
  } else if (project && project.header && Array.isArray(project.files)) {
    try {
      buf = encodeProject(project);
    } catch (e) {
      return fail(e.code || 'ENCODE_FAILED', e.message, { path: filePath });
    }
  } else {
    const input = Object.assign({}, project || {});
    if (input.compressed === undefined && !input.codec) {
      const ext = codecForExtension(filePath);
      if (ext) input.compressed = ext.compressed;
    }
    try {
      buf = encodeProject(input);
    } catch (e) {
      return fail(e.code || 'ENCODE_FAILED', e.message, { path: filePath });
    }
  }

  const tmp = filePath + '.tmp-' + process.pid + '-' + Date.now().toString(36);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tmp, buf);
    if (!opts || opts.sync !== false) {
      const fd = fs.openSync(tmp, 'r+');
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) { /* best effort */ }
    return fail('WRITE_FAILED', 'cannot write ' + filePath + ': ' + e.message, { path: filePath });
  }

  const decoded = decodeProject(buf, { verify: false });
  return {
    ok: true,
    path: filePath,
    bytes: buf.length,
    size: buf.length,
    buffer: buf,
    sha256: sha256(buf),
    codec: decoded.ok ? decoded.codec : null,
    extension: decoded.ok ? decoded.extension : codecForExtension(filePath) && codecForExtension(filePath).ext,
    version: decoded.ok ? decoded.version : null,
    files: decoded.ok ? decoded.files.length : 0
  };
}

/* Read a container from disk and decode it. */
export function readProject(filePath, opts) {
  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch (e) {
    return fail('READ_FAILED', 'cannot read ' + filePath + ': ' + e.message, { path: filePath });
  }
  const out = decodeProject(buf, opts);
  if (!out.ok) return Object.assign(out, { path: filePath });
  out.path = filePath;
  out.file = filePath;
  out.sha256 = sha256(buf);
  return out;
}

export default {
  MAGIC, FORMAT, CONTAINER_VERSION, HEADER_OFFSET, HEADER_LIMIT, CODECS,
  encodeProject, decodeProject, writeProject, readProject, projectHeader,
  codecInfo, codecForExtension, codecForCompressed, sha256
};
