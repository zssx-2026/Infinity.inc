/**
 * webviewer.js - WebViewer's capability surface.
 *
 * WebViewer is the page-inspection member of the Infinity Studio family: it
 * reads one saved HTML file and answers what is inside it (title, links,
 * scripts, images, stylesheets, charset), validates a bookmark document, and
 * parses a browser history export written as JSON Lines.
 *
 * Everything here is real work on real bytes. inspect() genuinely reads the
 * file and matches the document, bookmarks() genuinely parses the JSON,
 * history() genuinely walks the JSONL lines and counts the ones it had to
 * skip. Nothing is faked.
 *
 * Two rules hold throughout:
 *   1. run() never throws. A missing file, malformed JSON, an oversized page
 *     and an unknown action all come back as ok:false with an uppercase
 *     snake error code.
 *   2. plan() is pure. It composes the step list and stops there; run() is
 *     the only function that touches the disk.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';

export const META = {
  id: 'webviewer',
  name: 'WebViewer',
  version: '1.0.0-pre5',
  branch: 'web',
  codecs: [
    { ext: '.html', since: '0.42.31' },
    { ext: '.htm', since: '0.42.31' },
    { ext: '.mhtml', since: '0.43.0' }
  ],
  hosts: ['local-files', 'bookmarks', 'history']
};

/* A saved page above this size is refused rather than read into memory: the
 * inspector is a reader, not a browser, and nobody scrolls an 8 MiB document
 * through a capability call. */
export const MAX_PAGE_BYTES = 8 * 1024 * 1024;

/* ---------------------------------------------------------------- identity */

export function capabilities() {
  return {
    id: META.id,
    name: META.name,
    version: META.version,
    features: ['inspect-html', 'extract-links', 'bookmarks', 'history-file'],
    formats: META.codecs.map((codec) => codec.ext),
    hosts: META.hosts.slice(),
    implemented: true
  };
}

/* ---------------------------------------------------------------- plan */

export function plan(action, input) {
  const act = String(action || '').toLowerCase();
  const opts = normalizeInput(input || {});
  const steps = [];
  const warnings = [];

  if (act === 'inspect') {
    if (!opts.path) warnings.push('缺少页面路径（path）');
    steps.push({ kind: 'read', detail: '读取 HTML 文件 ' + (opts.path || '<未指定>') + '（上限 ' + MAX_PAGE_BYTES + ' 字节）' });
    steps.push({ kind: 'parse', detail: '提取 title / a[href] / script[src] / img[src] / link[rel=stylesheet] / meta charset' });
    steps.push({ kind: 'hash', detail: '计算原始字节的 SHA-256' });
    return { ok: warnings.length === 0, action: act, steps, warnings };
  }

  if (act === 'bookmarks') {
    if (!opts.path) warnings.push('缺少书签文件路径（path）');
    steps.push({ kind: 'read', detail: '读取书签 JSON ' + (opts.path || '<未指定>') });
    steps.push({ kind: 'validate', detail: '校验 bookmarks 数组与每条 url' });
    return { ok: warnings.length === 0, action: act, steps, warnings };
  }

  if (act === 'history') {
    if (!opts.path) warnings.push('缺少历史文件路径（path）');
    steps.push({ kind: 'read', detail: '读取 JSON Lines 历史 ' + (opts.path || '<未指定>') });
    steps.push({ kind: 'parse', detail: '逐行解析，坏行计入 skipped 而不中断' });
    steps.push({ kind: 'slice', detail: '返回最近 10 条' });
    return { ok: warnings.length === 0, action: act, steps, warnings };
  }

  return { ok: false, action: act || null, steps: [], warnings: ['未知动作：' + String(action)], error: 'UNKNOWN_ACTION' };
}

/* ---------------------------------------------------------------- inspect */

const TITLE_RE = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i;
const ATTR_RE = (tag, attr) => new RegExp('<' + tag + '\\b[^>]*\\b' + attr + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'gi');

function attrValue(match) {
  return match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : (match[4] !== undefined ? match[4] : ''));
}

function collect(text, tag, attr) {
  const re = ATTR_RE(tag, attr);
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const value = attrValue(m).trim();
    if (value) out.push(value);
  }
  return out;
}

function unique(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function decodeEntities(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function inspectPage(input) {
  const opts = normalizeInput(input);
  const act = 'inspect';
  if (!opts.path) return fail(act, 'MISSING_PATH', '缺少页面路径（path）');

  let bytes;
  try {
    bytes = fs.readFileSync(opts.path);
  } catch (err) {
    return fail(act, 'READ_FAILED', '无法读取页面：' + ((err && err.message) || err));
  }
  if (bytes.length > MAX_PAGE_BYTES) {
    return fail(act, 'TOO_LARGE', '页面超过 ' + MAX_PAGE_BYTES + ' 字节上限：' + bytes.length);
  }

  const text = bytes.toString('utf8');
  const titleMatch = text.match(TITLE_RE);
  const title = titleMatch ? decodeEntities(titleMatch[1].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim() : null;

  const links = unique(collect(text, 'a', 'href'));
  const scripts = unique(collect(text, 'script', 'src'));
  const images = unique(collect(text, 'img', 'src'));
  /* link[href] carries every relation, so the stylesheet filter is done on the
   * element instead of the URL: a <link rel="stylesheet" href="x.css"> counts,
   * a <link rel="icon" href="favicon.ico"> does not. */
  const stylesheetRe = /<link\b[^>]*>/gi;
  const stylesheets = [];
  let tag;
  while ((tag = stylesheetRe.exec(text)) !== null) {
    const element = tag[0];
    if (!/\brel\s*=\s*("([^"]*)"|\'([^\']*)\'|([^\s>]+))/i.test(element)) continue;
    const relMatch = element.match(/\brel\s*=\s*("([^"]*)"|\'([^\']*)\'|([^\s>]+))/i);
    const rel = relMatch ? attrValue(relMatch) : '';
    if (!/(^|\s)stylesheet(\s|$)/i.test(rel)) continue;
    const hrefMatch = element.match(/\bhref\s*=\s*("([^"]*)"|\'([^\']*)\'|([^\s>]+))/i);
    if (hrefMatch) stylesheets.push(attrValue(hrefMatch).trim());
  }

  const charsetMatch = text.match(/<meta\b[^>]*\bcharset\s*=\s*["']?([A-Za-z0-9._-]+)/i);
  const lines = text.split(/\r?\n/).length;

  return {
    ok: true,
    action: act,
    title: title,
    links: links,
    linkCount: links.length,
    scripts: scripts,
    images: images,
    stylesheets: unique(stylesheets.filter(Boolean)),
    charset: charsetMatch ? charsetMatch[1].toLowerCase() : null,
    lines: lines,
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex')
  };
}

/* ---------------------------------------------------------------- bookmarks */

function bookmarksDoc(input) {
  const opts = normalizeInput(input);
  const act = 'bookmarks';
  if (!opts.path) return fail(act, 'MISSING_PATH', '缺少书签文件路径（path）');

  let raw;
  try {
    raw = fs.readFileSync(opts.path, 'utf8');
  } catch (err) {
    return fail(act, 'READ_FAILED', '无法读取书签文件：' + ((err && err.message) || err));
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return fail(act, 'BAD_JSON', '书签文件不是有效 JSON：' + ((err && err.message) || err));
  }

  const list = parsed && Array.isArray(parsed.bookmarks) ? parsed.bookmarks : null;
  if (!list) return fail(act, 'BAD_BOOKMARKS', '书签文件缺少 bookmarks 数组');

  const issues = [];
  const rows = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      issues.push('书签条目不是对象（第 ' + (i + 1) + ' 项）');
      continue;
    }
    if (typeof item.url !== 'string' || item.url.trim() === '') {
      issues.push('书签条目缺少 url（第 ' + (i + 1) + ' 项）');
      continue;
    }
    if (item.title !== undefined && typeof item.title !== 'string') {
      issues.push('书签标题不是字符串（第 ' + (i + 1) + ' 项）');
    }
    rows.push({ title: typeof item.title === 'string' ? item.title : '', url: item.url.trim() });
  }

  return { ok: issues.length === 0, action: act, total: list.length, bookmarks: rows, issues: issues };
}

/* ---------------------------------------------------------------- history */

function historyFile(input) {
  const opts = normalizeInput(input);
  const act = 'history';
  if (!opts.path) return fail(act, 'MISSING_PATH', '缺少历史文件路径（path）');

  let raw;
  try {
    raw = fs.readFileSync(opts.path, 'utf8');
  } catch (err) {
    return fail(act, 'READ_FAILED', '无法读取历史文件：' + ((err && err.message) || err));
  }

  const lines = raw.split(/\r?\n/);
  let total = 0;
  let skipped = 0;
  const rows = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch (err) {
      skipped += 1;
      continue;
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.url !== 'string' || entry.url.trim() === '') {
      skipped += 1;
      continue;
    }
    total += 1;
    rows.push({
      url: entry.url.trim(),
      title: typeof entry.title === 'string' ? entry.title : '',
      ts: entry.ts !== undefined ? entry.ts : null
    });
  }

  return { ok: true, action: act, total: total, returned: rows.length, skipped: skipped, last: rows.slice(-10) };
}

/* ---------------------------------------------------------------- helpers */

function normalizeInput(input) {
  const opts = {};
  if (!input || typeof input !== 'object') return opts;
  for (const key of Object.keys(input)) opts[key] = input[key];
  return opts;
}

function fail(action, error, message) {
  return { ok: false, action: action, error: error, message: message };
}

/* ---------------------------------------------------------------- run face */

export async function run(action, input) {
  const act = String(action || '').toLowerCase();
  try {
    if (act === 'inspect') return inspectPage(input || {});
    if (act === 'bookmarks') return bookmarksDoc(input || {});
    if (act === 'history') return historyFile(input || {});
    return { ok: false, action: act || null, error: 'UNKNOWN_ACTION', message: '未知动作：' + String(action) };
  } catch (err) {
    return { ok: false, action: act || null, error: 'RUN_FAILED', message: '执行失败：' + ((err && err.message) || err) };
  }
}

export default { META, capabilities, plan, run, MAX_PAGE_BYTES };
