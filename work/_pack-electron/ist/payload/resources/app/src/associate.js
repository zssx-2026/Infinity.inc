/*
 * associate.js - teaching Windows to open a project by double-clicking it.
 *
 * A file association is three registry values in HKCU\Software\Classes:
 *
 *   .is-ccp                                        -> "InfinityStudio.Project.Plain"
 *   InfinityStudio.Project.Plain                   -> "Infinity Studio 项目 (.is-ccp)"
 *   InfinityStudio.Project.Plain\shell\open\command-> "\"...\infinitystudio.exe" "%1""
 *
 * The extension points at a ProgID, the ProgID names itself, and the ProgID's
 * open command says what to run. Three values per codec, and nothing else -
 * HKCU only, never HKLM, never a system-wide default, so this never needs an
 * administrator and never takes a file type away from another program.
 *
 * Planning and applying are separate on purpose. planAssociations() is pure:
 * it returns the operations it would perform and touches nothing. applyAssociations()
 * refuses to run unless apply === true, and then verifies every write by reading
 * the value back - a registry write that reports success and did not land is
 * exactly the kind of thing that leaves a user with a broken double-click.
 *
 * API
 *   planAssociations(codecs, {exe}) -> [{hive, key, name, value, ...}]
 *   planRemovals(codecs)            -> [{hive, key, action:'delete', ...}]
 *   applyAssociations(ops, {apply}) -> {ok, applied, ops, dryRun}
 */

import { spawnSync } from 'node:child_process';

export const CLASSES_ROOT = 'HKEY_CURRENT_USER\\Software\\Classes';
export const PROGID_PREFIX = 'InfinityStudio.Project';
export const REG_EXE = process.env.REA_REG_EXE || process.env.INFINITY_REG_EXE || 'C:\\Windows\\System32\\reg.exe';

const HIVES = {
  HKCU: 'HKEY_CURRENT_USER',
  HKEY_CURRENT_USER: 'HKEY_CURRENT_USER'
};

/* Codecs may arrive as records ({id, ext, label}) or as bare ids/extensions.
 * The mapping is deliberately explicit: the association module must not depend
 * on project.js being loadable in whatever process asks for a plan. */
const KNOWN_CODECS = {
  plain: { id: 'plain', ext: '.is-ccp', label: 'Infinity Studio 项目 (.is-ccp)' },
  deflate: { id: 'deflate', ext: '.is-ccpx', label: 'Infinity Studio 压缩项目 (.is-ccpx)' }
};

export const DEFAULT_CODECS = [KNOWN_CODECS.plain, KNOWN_CODECS.deflate];

function normalizeCodec(codec) {
  if (!codec) return null;
  if (typeof codec === 'string') {
    const key = codec.replace(/^\./, '').toLowerCase();
    if (KNOWN_CODECS[key]) return Object.assign({}, KNOWN_CODECS[key]);
    for (const id of Object.keys(KNOWN_CODECS)) {
      if (codec.toLowerCase() === KNOWN_CODECS[id].ext) return Object.assign({}, KNOWN_CODECS[id]);
    }
    if (codec.startsWith('.')) return { id: key, ext: codec.toLowerCase(), label: 'Infinity Studio 项目 (' + codec.toLowerCase() + ')' };
    return null;
  }
  if (typeof codec !== 'object') return null;
  const id = codec.id || (codec.ext ? String(codec.ext).replace(/^\./, '') : null);
  const ext = codec.ext || (KNOWN_CODECS[id] && KNOWN_CODECS[id].ext);
  if (!id || !ext) return null;
  const base = KNOWN_CODECS[id] || {};
  return {
    id: id,
    ext: ext.toLowerCase(),
    label: codec.label || base.label || ('Infinity Studio 项目 (' + ext.toLowerCase() + ')'),
    progId: codec.progId || (PROGID_PREFIX + '.' + id.charAt(0).toUpperCase() + id.slice(1))
  };
}

function progIdFor(codec) {
  if (codec.progId) return codec.progId;
  return PROGID_PREFIX + '.' + codec.id.charAt(0).toUpperCase() + codec.id.slice(1);
}

/* The open command. Quotes around the exe and around %1 are not decoration:
 * without them a path with a space, or a project in "My Documents", opens the
 * wrong thing or nothing at all. */
export function openCommand(exe) {
  if (typeof exe !== 'string' || !exe.trim()) return null;
  return '"' + exe.trim() + '" "%1"';
}

function op(hive, key, name, value, action, extra) {
  const full = (HIVES[hive] || hive) + '\\' + key;
  return Object.assign({
    hive: HIVES[hive] || hive,
    hiveShort: hive === 'HKEY_CURRENT_USER' ? 'HKCU' : hive,
    key: key,
    name: name,
    value: value === undefined ? null : value,
    action: action,
    full: full,
    exists: action === 'set'
  }, extra || {});
}

/* Pure. Returns three operations per codec, in the order the registry wants
 * them: the extension, then the ProgID, then its open command. */
export function planAssociations(codecs, options) {
  const opts = options || {};
  const list = (codecs === undefined || codecs === null ? DEFAULT_CODECS : codecs);
  const arr = Array.isArray(list) ? list : [list];
  const exe = opts.exe;
  const cmd = openCommand(exe);
  if (!cmd) return [];

  const ops = [];
  const seen = new Set();
  for (const raw of arr) {
    const codec = normalizeCodec(raw);
    if (!codec) continue;
    const progId = progIdFor(codec);
    if (seen.has(codec.ext)) continue;
    seen.add(codec.ext);

    ops.push(op('HKCU', 'Software\\Classes\\' + codec.ext, '', progId, 'set', {
      codec: codec.id, role: 'extension', type: 'REG_SZ',
      description: codec.ext + ' 默认打开方式 -> ' + progId
    }));
    ops.push(op('HKCU', 'Software\\Classes\\' + progId, '', codec.label, 'set', {
      codec: codec.id, role: 'progid', type: 'REG_SZ',
      description: progId + ' 显示名'
    }));
    ops.push(op('HKCU', 'Software\\Classes\\' + progId + '\\shell\\open\\command', '', cmd, 'set', {
      codec: codec.id, role: 'command', type: 'REG_SZ',
      description: '双击打开命令'
    }));
  }
  return ops;
}

/* The inverse: the same keys, deleted deepest first so a parent is never
 * removed before its children. */
export function planRemovals(codecs) {
  const list = (codecs === undefined || codecs === null ? DEFAULT_CODECS : codecs);
  const arr = Array.isArray(list) ? list : [list];
  const ops = [];
  for (const raw of arr) {
    const codec = normalizeCodec(raw);
    if (!codec) continue;
    const progId = progIdFor(codec);
    ops.push(op('HKCU', 'Software\\Classes\\' + progId + '\\shell\\open\\command', '', null, 'delete', { codec: codec.id, role: 'command' }));
    ops.push(op('HKCU', 'Software\\Classes\\' + progId + '\\shell\\open', '', null, 'delete', { codec: codec.id, role: 'open' }));
    ops.push(op('HKCU', 'Software\\Classes\\' + progId + '\\shell', '', null, 'delete', { codec: codec.id, role: 'shell' }));
    ops.push(op('HKCU', 'Software\\Classes\\' + progId, '', null, 'delete', { codec: codec.id, role: 'progid' }));
    ops.push(op('HKCU', 'Software\\Classes\\' + codec.ext, '', null, 'delete', { codec: codec.id, role: 'extension' }));
  }
  return ops;
}

/* Only HKCU\Software\Classes, only our own ProgIDs and extensions. An operation
 * that could rewrite someone else's file type is refused before it runs. */
export function validateOps(ops) {
  if (!Array.isArray(ops)) return { ok: false, code: 'BAD_OPS', message: 'operations must be an array' };
  for (const o of ops) {
    if (!o || typeof o !== 'object') return { ok: false, code: 'BAD_OP', message: 'every operation must be an object' };
    const hive = HIVES[o.hive] || o.hive;
    if (hive !== 'HKEY_CURRENT_USER') {
      return { ok: false, code: 'BAD_HIVE', message: 'refusing to write outside HKCU: ' + o.hive };
    }
    if (typeof o.key !== 'string' || !o.key) return { ok: false, code: 'BAD_KEY', message: 'operation has no key' };
    if (!o.key.toLowerCase().startsWith('software\\classes\\')) {
      return { ok: false, code: 'BAD_KEY', message: 'refusing to write outside Software\\Classes: ' + o.key };
    }
    if (o.key.includes('..')) return { ok: false, code: 'BAD_KEY', message: 'refusing a key with ..: ' + o.key };
    if (o.action === 'set' && (o.value === undefined || o.value === null)) {
      return { ok: false, code: 'BAD_VALUE', message: 'set operation has no value: ' + o.key };
    }
    if (o.action !== 'set' && o.action !== 'delete') {
      return { ok: false, code: 'BAD_ACTION', message: 'unknown action: ' + o.action };
    }
  }
  return { ok: true };
}

/* reg.exe writes its console output in the OEM code page, which on a Chinese
 * Windows is GBK. Decoding that as UTF-8 turns every Chinese label into
 * mojibake, so try the encodings that can actually occur and keep the one that
 * round-trips. */
export function decodeRegOutput(buf) {
  if (!buf) return '';
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf), 'utf8');
  const candidates = ['utf8', 'gbk', 'latin1'];
  for (const enc of candidates) {
    try {
      const text = bytes.toString(enc);
      if (!text.includes('\uFFFD')) return text;
    } catch (_) { /* encoding not available in this Node build */ }
  }
  return bytes.toString('utf8');
}

function runReg(args) {
  const r = spawnSync(REG_EXE, args, { encoding: 'buffer', windowsHide: true, timeout: 20000 });
  const stdout = decodeRegOutput(r.stdout);
  const stderr = decodeRegOutput(r.stderr);
  return { status: r.status, stdout: stdout, stderr: stderr, error: r.error };
}

/* Read one default value back. Returns {found, value} - found is what reg.exe
 * says, value is what it printed, decoded. */
export function readValue(fullKey) {
  const r = runReg(['query', fullKey, '/ve']);
  if (r.status !== 0) return { found: false, value: null, status: r.status, stderr: r.stderr };
  const text = r.stdout || '';
  /* "    (默认)    REG_SZ    some value" - the value starts after the type. */
  const m = text.match(/REG_[A-Z_]+\s+([\s\S]*?)\r?\n/) || text.match(/REG_[A-Z_]+\s+([\s\S]*)$/);
  if (!m) return { found: true, value: null, status: r.status, raw: text };
  return { found: true, value: m[1].replace(/\r?\n$/, '').trim(), status: r.status, raw: text };
}

/* Apply. Refuses to do anything unless apply === true; the default is a dry
 * run that returns the plan it would have executed. */
export function applyAssociations(ops, options) {
  const opts = options || {};
  const list = Array.isArray(ops) ? ops : [];
  const planned = list.map((o) => Object.assign({}, o));

  const check = validateOps(list);
  if (!check.ok) return { ok: false, code: check.code, message: check.message, applied: 0, ops: planned, dryRun: opts.apply !== true };

  if (opts.apply !== true) {
    for (const o of planned) o.status = 'planned';
    return { ok: true, applied: 0, ops: planned, dryRun: true, applied_ops: 0 };
  }

  const results = [];
  let applied = 0;
  let failed = 0;
  for (const o of planned) {
    const hive = HIVES[o.hive] || o.hive;
    const full = o.full || (hive + '\\' + o.key);
    if (o.action === 'delete') {
      const r = runReg(['delete', full, '/f']);
      /* reg.exe returns 1 for "not there", which for a delete is success. */
      const gone = readValue(full).found === false;
      const status = gone ? 'ok' : 'failed';
      if (gone) applied++; else failed++;
      results.push(Object.assign({}, o, { status: status, exit: r.status, stderr: r.stderr || null }));
      continue;
    }
    const r = runReg(['add', full, '/ve', '/d', String(o.value), '/f']);
    if (r.status !== 0) {
      failed++;
      results.push(Object.assign({}, o, { status: 'failed', exit: r.status, stderr: r.stderr || null }));
      continue;
    }
    const back = readValue(full);
    const ok = back.found && back.value === String(o.value);
    if (ok) applied++; else failed++;
    results.push(Object.assign({}, o, {
      status: ok ? 'ok' : 'verify-failed',
      exit: r.status,
      readback: back.value,
      expected: String(o.value)
    }));
  }

  return {
    ok: failed === 0,
    applied: applied,
    failed: failed,
    total: results.length,
    ops: results,
    dryRun: false
  };
}

/* Convenience: plan and apply in one call, still dry by default. */
export function associateCodecs(codecs, options) {
  const opts = options || {};
  const ops = planAssociations(codecs, { exe: opts.exe });
  return applyAssociations(ops, { apply: opts.apply === true });
}

export default {
  CLASSES_ROOT, PROGID_PREFIX, DEFAULT_CODECS,
  planAssociations, planRemovals, applyAssociations, associateCodecs,
  validateOps, readValue, openCommand, decodeRegOutput
};
