/**
 * integrations.js - Integrations' capability surface.
 *
 * Integrations is the integration hub of the Infinity Studio app family: it
 * publishes the catalog of supported integration kinds (webhook, smtp, oauth,
 * websocket), signs and verifies webhook payloads with real HMAC via
 * node:crypto (timing-safe comparison), and validates an integrations
 * manifest JSON file on disk.
 *
 * Everything here is real work on real bytes. sign()/verify() genuinely run
 * HMAC-SHA-256/512 over the payload; manifest() genuinely reads and validates
 * the JSON file at the given path. Nothing is faked, and no network request,
 * git command or popup is ever issued.
 *
 * Two rules hold throughout:
 *   1. run() never throws. A missing secret, a missing payload, an unreadable
 *     manifest and an unknown action all come back as ok:false with an
 *     uppercase snake error code and a short Chinese message.
 *   2. plan() is pure. It composes the step list and predictable warnings and
 *     stops there; run() is the only function that touches disk or crypto.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const META = {
  id: 'integrations',
  name: 'Integrations',
  version: '1.0.0-pre5',
  branch: 'integrations',
  codecs: [{ ext: '.json', since: '0.42.31' }],
  hosts: ['webhook', 'smtp', 'oauth', 'websocket']
};

/* ----------------------------------------------------------------- catalog */

// 集成目录：kind -> 必填字段名（'config.x' 表示 config 对象下的子字段）。
const CATALOG = [
  { id: 'webhook', fields: ['id', 'type', 'config', 'config.url'] },
  { id: 'smtp', fields: ['id', 'type', 'config', 'config.host', 'config.port'] },
  { id: 'oauth', fields: ['id', 'type', 'config', 'config.client_id', 'config.client_secret'] },
  { id: 'websocket', fields: ['id', 'type', 'config', 'config.url'] }
];

// 签名支持的算法（缺省 sha256，可选 sha512）。
const ALGORITHMS = ['sha256', 'sha512'];

function normalizeInput(input) {
  return input && typeof input === 'object' ? input : {};
}

function isFilledString(value) {
  return typeof value === 'string' && value.length > 0;
}

function pickAlgorithm(opts) {
  return isFilledString(opts.algorithm) ? opts.algorithm : 'sha256';
}

function fail(error, message) {
  return { ok: false, error, message };
}

function hmacHex(algorithm, secret, payload) {
  return createHmac(algorithm, Buffer.from(secret, 'utf8'))
    .update(Buffer.from(payload, 'utf8'))
    .digest('hex');
}

/* ---------------------------------------------------------------- identity */

export function capabilities() {
  return {
    id: META.id,
    name: META.name,
    version: META.version,
    features: ['catalog', 'webhook-sign', 'webhook-verify', 'manifest-validate'],
    formats: META.codecs.map((codec) => codec.ext),
    hosts: META.hosts.slice(),
    implemented: true
  };
}

/* -------------------------------------------------------------------- plan */

// 纯函数：只描述步骤与可预判的警告，不读盘、不算签名、不抛异常。
export function plan(action, input) {
  const act = String(action || '').toLowerCase();
  const opts = normalizeInput(input);

  if (act === 'catalog') {
    return {
      ok: true,
      action: act,
      steps: [{ kind: 'catalog', detail: '输出 webhook/smtp/oauth/websocket 四类集成的必填字段目录' }],
      warnings: []
    };
  }

  if (act === 'sign') {
    const algorithm = pickAlgorithm(opts);
    const warnings = [];
    if (!isFilledString(opts.secret)) warnings.push('缺少 secret，运行将返回 MISSING_SECRET');
    if (!isFilledString(opts.payload)) warnings.push('缺少 payload，运行将返回 MISSING_PAYLOAD');
    if (!ALGORITHMS.includes(algorithm)) warnings.push('不支持的算法 ' + algorithm + '，运行将返回 INVALID_ALGORITHM');
    return {
      ok: true,
      action: act,
      steps: [{ kind: 'hmac', detail: '用 HMAC-' + algorithm + ' 对 payload 计算十六进制签名' }],
      warnings
    };
  }

  if (act === 'verify') {
    const algorithm = pickAlgorithm(opts);
    const warnings = [];
    if (!isFilledString(opts.secret)) warnings.push('缺少 secret，运行将返回 MISSING_SECRET');
    if (!isFilledString(opts.payload)) warnings.push('缺少 payload，运行将返回 MISSING_PAYLOAD');
    if (!isFilledString(opts.signature)) warnings.push('缺少 signature，运行将返回 MISSING_SIGNATURE');
    if (!ALGORITHMS.includes(algorithm)) warnings.push('不支持的算法 ' + algorithm + '，运行将返回 INVALID_ALGORITHM');
    return {
      ok: true,
      action: act,
      steps: [
        { kind: 'hmac', detail: '用 HMAC-' + algorithm + ' 重算期望签名' },
        { kind: 'compare', detail: 'timingSafeEqual 恒时比对，长度不等直接判不匹配' }
      ],
      warnings
    };
  }

  if (act === 'manifest') {
    const warnings = [];
    if (!isFilledString(opts.path)) warnings.push('缺少 path，运行将返回 MISSING_PATH');
    return {
      ok: true,
      action: act,
      steps: [
        { kind: 'read', detail: '读取并解析 manifest JSON（{ integrations: [...] }）' },
        { kind: 'validate', detail: '校验 id 唯一、type 在 catalog 内、webhook 的 config.url 以 http(s):// 开头' }
      ],
      warnings
    };
  }

  return { ok: false, error: 'UNKNOWN_ACTION' };
}

/* --------------------------------------------------------------------- run */

export async function run(action, input) {
  try {
    const act = String(action || '').toLowerCase();
    const opts = normalizeInput(input);

    if (act === 'catalog') {
      return {
        ok: true,
        kinds: CATALOG.map((kind) => ({ id: kind.id, fields: kind.fields.slice() }))
      };
    }

    if (act === 'sign') {
      if (!isFilledString(opts.secret)) return fail('MISSING_SECRET', '缺少 secret，无法计算签名');
      if (!isFilledString(opts.payload)) return fail('MISSING_PAYLOAD', '缺少 payload，无法计算签名');
      const algorithm = pickAlgorithm(opts);
      if (!ALGORITHMS.includes(algorithm)) {
        return fail('INVALID_ALGORITHM', '不支持的签名算法 ' + algorithm + '，仅支持 sha256/sha512');
      }
      return { ok: true, algorithm, signature: hmacHex(algorithm, opts.secret, opts.payload) };
    }

    if (act === 'verify') {
      if (!isFilledString(opts.secret)) return fail('MISSING_SECRET', '缺少 secret，无法校验签名');
      if (!isFilledString(opts.payload)) return fail('MISSING_PAYLOAD', '缺少 payload，无法校验签名');
      const algorithm = pickAlgorithm(opts);
      if (!ALGORITHMS.includes(algorithm)) {
        return fail('INVALID_ALGORITHM', '不支持的签名算法 ' + algorithm + '，仅支持 sha256/sha512');
      }
      if (!isFilledString(opts.signature)) return fail('MISSING_SIGNATURE', '缺少 signature，无法校验签名');
      const expected = Buffer.from(hmacHex(algorithm, opts.secret, opts.payload), 'hex');
      const provided = Buffer.from(opts.signature, 'hex');
      // 长度不等直接判不匹配，不调用 timingSafeEqual（恒时比较要求等长输入）。
      const match = provided.length === expected.length && timingSafeEqual(provided, expected);
      return { ok: true, match, algorithm };
    }

    if (act === 'manifest') {
      return await validateManifest(opts);
    }

    return fail('UNKNOWN_ACTION', '未知动作：' + String(action));
  } catch (err) {
    return fail('RUN_FAILED', '运行异常：' + (err && err.message ? err.message : String(err)));
  }
}

/* ---------------------------------------------------------------- manifest */

// 真读盘校验 manifest：id 唯一、type 在 catalog 内、webhook 的 config.url 合法。
async function validateManifest(opts) {
  if (!isFilledString(opts.path)) return fail('MISSING_PATH', '缺少 path，无法读取 manifest');

  let raw;
  try {
    raw = await readFile(opts.path, 'utf8');
  } catch (err) {
    const code = err && err.code ? '（' + err.code + '）' : '';
    return fail('READ_FAILED', '读取 manifest 失败' + code + '：' + opts.path);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return fail('PARSE_FAILED', 'manifest 不是合法 JSON：' + (err && err.message ? err.message : String(err)));
  }

  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.integrations)) {
    return fail('INVALID_FORMAT', 'manifest 顶层必须是含 integrations 数组的对象');
  }

  const knownTypes = new Set(CATALOG.map((kind) => kind.id));
  const seenIds = new Set();
  const issues = [];

  data.integrations.forEach((item, index) => {
    const at = '第 ' + (index + 1) + ' 个 integration';
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      issues.push(at + ' 不是对象');
      return;
    }
    const who = isFilledString(item.id) ? ' "' + item.id + '"' : '';
    if (!isFilledString(item.id)) {
      issues.push(at + ' 缺少 id');
    } else if (seenIds.has(item.id)) {
      issues.push(at + who + ' 的 id 重复');
    } else {
      seenIds.add(item.id);
    }
    if (!isFilledString(item.type) || !knownTypes.has(item.type)) {
      issues.push(at + who + ' 的 type ' + (isFilledString(item.type) ? '"' + item.type + '"' : '(缺失)') + ' 不在 catalog 内');
    }
    if (item.type === 'webhook') {
      const cfg = item.config && typeof item.config === 'object' && !Array.isArray(item.config) ? item.config : null;
      const url = cfg ? cfg.url : undefined;
      if (!isFilledString(url) || !/^https?:\/\//i.test(url)) {
        issues.push(at + who + ' 是 webhook 但 config.url 缺失或未以 http:// / https:// 开头');
      }
    }
  });

  return { ok: issues.length === 0, integrations: data.integrations.length, issues };
}

export default { META, capabilities, plan, run };
