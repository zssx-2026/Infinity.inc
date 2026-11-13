/**
 * server.js - Server's capability surface.
 *
 * Server is the service-operations member of the Infinity Studio sub-product
 * family: it probes whether a local TCP service is listening, checks whether
 * the process behind a .pid file is still alive, and validates a .json service
 * manifest ({"services":[{"id","port"}]}) for the hub.
 *
 * Everything here is real work on real bytes. probe() genuinely opens a TCP
 * socket to 127.0.0.1 (or an explicitly passed loopback host) and measures
 * the handshake; pid() genuinely reads the pid file and signals the process
 * with signal 0; manifest() genuinely reads and validates the JSON document.
 *
 * One contract exception is used here and only here: this module may touch
 * the network in order to probe LOCAL services. probe() therefore refuses
 * any host outside the loopback allowlist (127.0.0.1 / localhost / ::1) and
 * never connects to the outside world.
 *
 * Two rules hold throughout:
 *   1. run() never throws. A missing file, a malformed pid, an invalid port
 *     and an unknown action all come back as ok:false with an uppercase
 *     snake error code.
 *   2. plan() is pure. It composes the step list and stops there; run() is
 *     the only function that opens a socket or reads a file.
 */

import net from 'node:net';
import fs from 'node:fs';

export const META = {
  id: 'server',
  name: 'Server',
  version: '1.0.0-pre5',
  branch: 'server',
  codecs: [{ ext: '.json', since: '0.42.31' }, { ext: '.pid', since: '0.42.31' }],
  hosts: ['local-services']
};

export const DEFAULT_TCP_HOST = '127.0.0.1';
export const DEFAULT_TIMEOUT_MS = 1500;

/* ---------------------------------------------------------------- identity */

export function capabilities() {
  return {
    id: META.id,
    name: META.name,
    version: META.version,
    features: ['tcp-probe', 'pid-liveness', 'service-manifest'],
    formats: META.codecs.map((codec) => codec.ext),
    hosts: META.hosts.slice(),
    implemented: true
  };
}

export function plan(action, input) {
  const act = String(action || '').toLowerCase();
  const opts = normalizeInput(input || {});
  const steps = [];
  const warnings = [];

  if (act === 'probe') {
    const port = Number(opts.port);
    if (opts.port === undefined || opts.port === null || opts.port === '') warnings.push('缺少端口（port）');
    else if (!isPort(port)) warnings.push('端口无效（须为 1-65535 的整数）：' + String(opts.port));
    const host = normalizeLoopbackHost(opts.host);
    if (host === null) warnings.push('仅允许探测本机回环地址（127.0.0.1 / localhost / ::1）：' + String(opts.host));
    steps.push({ kind: 'tcp', detail: '连接本机 TCP 服务 ' + (host || DEFAULT_TCP_HOST) + ':' + (isPort(port) ? port : '<无效端口>') });
    steps.push({ kind: 'measure', detail: '测量 TCP 握手耗时（默认超时 ' + DEFAULT_TIMEOUT_MS + 'ms）' });
    return { ok: warnings.length === 0, action: act, steps, warnings };
  }

  if (act === 'pid') {
    if (!opts.path) warnings.push('缺少 pid 文件路径（path）');
    steps.push({ kind: 'read', detail: '读取 pid 文件 ' + (opts.path || '<未指定>') });
    steps.push({ kind: 'signal', detail: '以 0 号信号探测进程存活（process.kill(pid, 0)）' });
    return { ok: warnings.length === 0, action: act, steps, warnings };
  }

  if (act === 'manifest') {
    if (!opts.path) warnings.push('缺少服务清单路径（path）');
    steps.push({ kind: 'read', detail: '读取服务清单 ' + (opts.path || '<未指定>') });
    steps.push({ kind: 'parse', detail: '解析 JSON，校验 services 的 id 唯一性与 port（1-65535 整数）' });
    return { ok: warnings.length === 0, action: act, steps, warnings };
  }

  return { ok: false, action: act || null, steps: [], warnings: ['未知动作：' + String(action)], error: 'UNKNOWN_ACTION' };
}

/* ---------------------------------------------------------------- helpers */

function isPort(value) {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1']);

function normalizeLoopbackHost(raw) {
  if (raw === undefined || raw === null) return DEFAULT_TCP_HOST;
  const text = String(raw).trim().toLowerCase();
  if (!text) return DEFAULT_TCP_HOST;
  return LOOPBACK_HOSTS.has(text) ? text : null;
}

function normalizeInput(input) {
  const opts = {};
  if (!input || typeof input !== 'object') return opts;
  for (const k of Object.keys(input)) opts[k] = input[k];
  return opts;
}

function fail(action, error, message) {
  return { ok: false, action, error, message };
}

/* ---------------------------------------------------------------- probe */

export function probe(input) {
  const opts = normalizeInput(input);
  const act = 'probe';
  const port = Number(opts.port);
  if (!isPort(port)) return fail(act, 'BAD_PORT', '端口无效（须为 1-65535 的整数）：' + String(opts.port));
  const host = normalizeLoopbackHost(opts.host);
  if (!host) return fail(act, 'BAD_HOST', '仅允许探测本机回环地址（127.0.0.1 / localhost / ::1）');
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (opts.timeoutMs !== undefined && opts.timeoutMs !== null && opts.timeoutMs !== '') {
    const t = Number(opts.timeoutMs);
    if (Number.isFinite(t) && t > 0) timeoutMs = t;
  }
  const startedAt = process.hrtime.bigint();
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let timer = null;
    let settled = false;
    const finish = (out) => {
      if (settled) return;
      settled = true;
      if (timer) { clearTimeout(timer); timer = null; }
      try { socket.destroy(); } catch (_) { /* 收尾失败不影响结果 */ }
      resolve(out);
    };
    const timeoutOut = () => ({ ok: true, action: act, alive: false, reason: 'TIMEOUT', port: port, host: host, timeoutMs: timeoutMs });
    timer = setTimeout(() => finish(timeoutOut()), timeoutMs + 50);
    socket.on('error', () => { /* 兜底：迟到的 error 事件不冒泡 */ });
    socket.once('error', (err) => {
      const code = err && err.code ? String(err.code).toUpperCase() : 'UNKNOWN';
      const reason = code === 'ECONNREFUSED' ? 'REFUSED' : (code === 'ETIMEDOUT' ? 'TIMEOUT' : 'ERROR');
      const out = { ok: true, action: act, alive: false, reason: reason, port: port, host: host, code: code };
      if (reason === 'ERROR') out.message = '连接失败：' + ((err && err.message) || String(err));
      finish(out);
    });
    socket.setTimeout(timeoutMs);
    socket.once('timeout', () => finish(timeoutOut()));
    socket.once('connect', () => {
      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
      finish({ ok: true, action: act, alive: true, latencyMs: Math.max(0.001, Math.round(ms * 1000) / 1000), port: port, host: host });
    });
    try {
      socket.connect(port, host);
    } catch (err) {
      finish({ ok: true, action: act, alive: false, reason: 'ERROR', port: port, host: host, code: 'CONNECT_THROWN', message: '连接失败：' + ((err && err.message) || String(err)) });
    }
  });
}

/* ---------------------------------------------------------------- pid liveness */

export function pidLiveness(input) {
  const opts = normalizeInput(input);
  const act = 'pid';
  if (!opts.path) return fail(act, 'MISSING_PATH', '缺少 pid 文件路径（path）');
  let text;
  try {
    text = fs.readFileSync(opts.path, 'utf8');
  } catch (err) {
    return fail(act, 'READ_FAILED', '无法读取 pid 文件：' + ((err && err.message) || err));
  }
  const raw = String(text).trim();
  const shown = raw.length > 32 ? raw.slice(0, 32) + '…' : raw;
  if (!/^\d+$/.test(raw)) return fail(act, 'BAD_PID', 'pid 文件内容不是有效进程号：' + shown);
  const pid = Number(raw);
  if (!Number.isSafeInteger(pid) || pid < 1) return fail(act, 'BAD_PID', 'pid 文件内容不是有效进程号：' + shown);
  let alive;
  let restricted = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch (err) {
    const code = err && err.code ? String(err.code).toUpperCase() : '';
    if (code === 'ESRCH') {
      alive = false;
    } else if (code === 'EPERM') {
      alive = true;
      restricted = true;
    } else {
      return fail(act, 'LIVENESS_CHECK_FAILED', '进程探活失败：' + ((err && err.message) || err));
    }
  }
  const out = { ok: true, action: act, pid: pid, alive: alive };
  if (restricted) out.restricted = true;
  return out;
}

/* ---------------------------------------------------------------- manifest */

export function manifestCheck(input) {
  const opts = normalizeInput(input);
  const act = 'manifest';
  if (!opts.path) return fail(act, 'MISSING_PATH', '缺少服务清单路径（path）');
  let bytes;
  try {
    bytes = fs.readFileSync(opts.path);
  } catch (err) {
    return fail(act, 'READ_FAILED', '无法读取服务清单：' + ((err && err.message) || err));
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (err) {
    return fail(act, 'BAD_JSON', '服务清单不是有效 JSON：' + ((err && err.message) || err));
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail(act, 'BAD_MANIFEST', '服务清单顶层须为对象');
  }
  if (!Array.isArray(parsed.services)) {
    return fail(act, 'BAD_MANIFEST', '服务清单缺少 services 数组');
  }
  const issues = [];
  const seen = new Set();
  for (let i = 0; i < parsed.services.length; i++) {
    const svc = parsed.services[i];
    if (!svc || typeof svc !== 'object' || Array.isArray(svc)) {
      issues.push('服务条目不是对象（第 ' + (i + 1) + ' 项）');
      continue;
    }
    if (typeof svc.id !== 'string' || svc.id.trim() === '') {
      issues.push('服务条目缺少 id（第 ' + (i + 1) + ' 项）');
    } else if (seen.has(svc.id)) {
      issues.push('服务 id 重复：' + svc.id + '（第 ' + (i + 1) + ' 项）');
    } else {
      seen.add(svc.id);
    }
    if (!isPort(svc.port)) issues.push('服务端口无效（须为 1-65535 的整数）：' + String(svc.port));
  }
  return { ok: issues.length === 0, action: act, services: parsed.services.length, issues: issues };
}

/* ---------------------------------------------------------------- run face */

export async function run(action, input) {
  const act = String(action || '').toLowerCase();
  try {
    if (act === 'probe') return await probe(input || {});
    if (act === 'pid') return pidLiveness(input || {});
    if (act === 'manifest') return manifestCheck(input || {});
    return { ok: false, action: act || null, error: 'UNKNOWN_ACTION', message: '未知动作：' + String(action) };
  } catch (err) {
    return { ok: false, action: act || null, error: 'RUN_FAILED', message: '执行失败：' + ((err && err.message) || err) };
  }
}

export default { META, capabilities, plan, run, probe, pidLiveness, manifestCheck, DEFAULT_TCP_HOST, DEFAULT_TIMEOUT_MS };
