/**
 * office.js - Office's capability surface.
 *
 * Office is the document member of the Infinity Studio family: it reads a
 * Markdown file and returns its heading outline, parses a CSV file into rows
 * with a real quote-aware scanner, validates a JSON document, and counts the
 * words in a text file.
 *
 * Everything here is real work on real bytes. outline() genuinely walks the
 * Markdown line by line and keeps fence state so a # inside a code block is
 * not mistaken for a heading; table() genuinely scans the CSV with quote and
 * doubled-quote handling; validate() genuinely parses the JSON; stats()
 * genuinely hashes the file. Nothing is faked.
 *
 * Two rules hold throughout:
 *   1. run() never throws. A missing file, malformed JSON, an unknown action
 *     and an unreadable delimiter all come back as ok:false with an uppercase
 *     snake error code.
 *   2. plan() is pure. It composes the step list and stops there; run() is
 *     the only function that touches the disk.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';

export const META = {
  id: 'office',
  name: 'Office',
  version: '1.0.0-pre5',
  branch: 'office',
  codecs: [
    { ext: '.md', since: '0.42.31' },
    { ext: '.csv', since: '0.42.31' },
    { ext: '.json', since: '0.42.31' },
    { ext: '.txt', since: '0.42.31' }
  ],
  hosts: ['local-files']
};

/* ---------------------------------------------------------------- identity */

export function capabilities() {
  return {
    id: META.id,
    name: META.name,
    version: META.version,
    features: ['md-outline', 'csv-table', 'json-validate', 'text-stats'],
    formats: META.codecs.map((codec) => codec.ext),
    hosts: META.hosts.slice(),
    implemented: true
  };
}

/* ---------------------------------------------------------------- plan */

const ACTION_BY_EXT = { '.md': 'outline', '.csv': 'table', '.json': 'validate', '.txt': 'stats' };

export function plan(action, input) {
  const opts = normalizeInput(input || {});
  const act = String(action || (opts.path ? ACTION_BY_EXT[extOf(opts.path)] : '') || '').toLowerCase();
  const steps = [];
  const warnings = [];

  if (act === 'outline') {
    if (!opts.path) warnings.push('缺少文档路径（path）');
    steps.push({ kind: 'read', detail: '读取 Markdown 文件 ' + (opts.path || '<未指定>') });
    steps.push({ kind: 'scan', detail: '逐行识别 1-6 级标题，跳过围栏代码块内的行' });
    return { ok: warnings.length === 0, action: act, steps, warnings };
  }

  if (act === 'table') {
    if (!opts.path) warnings.push('缺少表格路径（path）');
    steps.push({ kind: 'read', detail: '读取 CSV 文件 ' + (opts.path || '<未指定>') });
    steps.push({ kind: 'scan', detail: '按引号感知扫描字段，支持字段内分隔符、CRLF 与双写引号' });
    return { ok: warnings.length === 0, action: act, steps, warnings };
  }

  if (act === 'validate') {
    if (!opts.path) warnings.push('缺少 JSON 路径（path）');
    steps.push({ kind: 'read', detail: '读取 JSON 文件 ' + (opts.path || '<未指定>') });
    steps.push({ kind: 'parse', detail: '解析 JSON 并返回顶层键与字节数' });
    return { ok: warnings.length === 0, action: act, steps, warnings };
  }

  if (act === 'stats') {
    if (!opts.path) warnings.push('缺少文本路径（path）');
    steps.push({ kind: 'read', detail: '读取文本文件 ' + (opts.path || '<未指定>') });
    steps.push({ kind: 'count', detail: '统计字节、行、词（CJK 逐字计词 + 拉丁词按空白切分）并计算 SHA-256' });
    return { ok: warnings.length === 0, action: act, steps, warnings };
  }

  return { ok: false, action: act || null, steps: [], warnings: ['未知动作：' + String(action)], error: 'UNKNOWN_ACTION' };
}

/* ---------------------------------------------------------------- outline */

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;

function outlineDoc(input) {
  const opts = normalizeInput(input);
  const act = 'outline';
  if (!opts.path) return fail(act, 'MISSING_PATH', '缺少文档路径（path）');

  let text;
  try {
    text = fs.readFileSync(opts.path, 'utf8');
  } catch (err) {
    return fail(act, 'READ_FAILED', '无法读取文档：' + ((err && err.message) || err));
  }

  const lines = text.split(/\r?\n/);
  const headings = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(FENCE_RE);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const match = line.match(HEADING_RE);
    if (!match) continue;
    headings.push({ level: match[1].length, text: match[2].trim(), line: i + 1 });
  }

  return { ok: true, action: act, headings: headings, count: headings.length, lines: lines.length };
}

/* ---------------------------------------------------------------- table */

function detectDelimiter(text) {
  const candidates = [',', ';', '\t'];
  const firstLine = text.split(/\r?\n/)[0] || '';
  let best = ',';
  let bestCount = -1;
  for (const candidate of candidates) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes && ch === candidate) count += 1;
    }
    if (count > bestCount) { best = candidate; bestCount = count; }
  }
  return best;
}

function parseCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delimiter) { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  /* 最后一行没有换行结尾时仍是一条数据行；只有完全空白的尾部才丢弃。 */
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((cells) => !(cells.length === 1 && cells[0].trim() === ''));
}

function tableDoc(input) {
  const opts = normalizeInput(input);
  const act = 'table';
  if (!opts.path) return fail(act, 'MISSING_PATH', '缺少表格路径（path）');

  let text;
  try {
    text = fs.readFileSync(opts.path, 'utf8');
  } catch (err) {
    return fail(act, 'READ_FAILED', '无法读取表格：' + ((err && err.message) || err));
  }

  const delimiter = opts.delimiter ? String(opts.delimiter) : detectDelimiter(text);
  if (![',', ';', '\t'].includes(delimiter)) {
    return fail(act, 'BAD_DELIMITER', '不支持的分隔符：' + delimiter + '（仅支持逗号、分号、制表符）');
  }

  const rows = parseCsv(text, delimiter);
  if (rows.length === 0) return fail(act, 'EMPTY_TABLE', '表格没有数据行');

  const header = rows[0];
  const columns = header.length;
  const ragged = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].length !== columns) ragged.push({ line: i + 1, cells: rows[i].length });
  }

  const out = {
    ok: true,
    action: act,
    delimiter: delimiter === '\t' ? 'tab' : delimiter,
    rows: rows.length,
    columns: columns,
    header: header,
    preview: rows.slice(0, 5),
    ragged: ragged
  };
  if (ragged.length > 0) out.warnings = ['有 ' + ragged.length + ' 行的字段数与表头不一致'];
  return out;
}

/* ---------------------------------------------------------------- validate */

function validateDoc(input) {
  const opts = normalizeInput(input);
  const act = 'validate';
  if (!opts.path) return fail(act, 'MISSING_PATH', '缺少 JSON 路径（path）');

  let bytes;
  try {
    bytes = fs.readFileSync(opts.path);
  } catch (err) {
    return fail(act, 'READ_FAILED', '无法读取 JSON：' + ((err && err.message) || err));
  }

  const text = bytes.toString('utf8');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const message = String((err && err.message) || err);
    const at = message.match(/position (\d+)/i);
    const out = fail(act, 'BAD_JSON', 'JSON 解析失败：' + message);
    if (at) out.position = Number(at[1]);
    return out;
  }

  const isArray = Array.isArray(parsed);
  const keys = isArray ? [] : (parsed && typeof parsed === 'object' ? Object.keys(parsed) : []);
  return {
    ok: true,
    action: act,
    type: isArray ? 'array' : (parsed === null ? 'null' : typeof parsed),
    keys: keys,
    length: isArray ? parsed.length : undefined,
    bytes: bytes.length
  };
}

/* ---------------------------------------------------------------- stats */

const CJK_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/g;

function statsDoc(input) {
  const opts = normalizeInput(input);
  const act = 'stats';
  if (!opts.path) return fail(act, 'MISSING_PATH', '缺少文本路径（path）');

  let bytes;
  try {
    bytes = fs.readFileSync(opts.path);
  } catch (err) {
    return fail(act, 'READ_FAILED', '无法读取文本：' + ((err && err.message) || err));
  }

  const text = bytes.toString('utf8');
  const cjk = (text.match(CJK_RE) || []).length;
  const latin = (text.replace(CJK_RE, ' ').match(/[A-Za-z0-9_'-]+/g) || []).length;
  const lines = text === '' ? 0 : text.split(/\r?\n/).length;

  return {
    ok: true,
    action: act,
    bytes: bytes.length,
    lines: lines,
    words: cjk + latin,
    cjk: cjk,
    latin: latin,
    chars: Array.from(text).length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex')
  };
}

/* ---------------------------------------------------------------- helpers */

function extOf(p) {
  const s = String(p || '').toLowerCase();
  const dot = s.lastIndexOf('.');
  return dot < 0 ? '' : s.slice(dot);
}

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
    if (act === 'outline') return outlineDoc(input || {});
    if (act === 'table') return tableDoc(input || {});
    if (act === 'validate') return validateDoc(input || {});
    if (act === 'stats') return statsDoc(input || {});
    return { ok: false, action: act || null, error: 'UNKNOWN_ACTION', message: '未知动作：' + String(action) };
  } catch (err) {
    return { ok: false, action: act || null, error: 'RUN_FAILED', message: '执行失败：' + ((err && err.message) || err) };
  }
}

export default { META, capabilities, plan, run };
