/*
 * aicraft.js - AICraft, the AI branch of the Craft suite.
 *
 * Everything here talks to a model server the user already runs: Ollama on
 * loopback by default, vLLM when the user points HOST at it. Nothing leaves the
 * machine, nothing is bundled, and nothing is assumed to be installed. Every
 * entry point that touches the network answers with ok:false and a stable error
 * code instead of throwing, because a studio that crashes when Ollama is closed
 * is a studio nobody opens twice.
 *
 * The module also owns the two project formats of this component:
 *   .is-aicp   plain JSON  - prompt sets, model registry entries, pipelines
 *   .is-aicpx  deflated    - same document, zlib raw deflate, magic "ISAICX1"
 *
 * Exports: META, capabilities, plan, run, probe, chat, contexts, models,
 *          encodeProject, decodeProject, writeProject, readProject
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/* ------------------------------------------------------------------ meta -- */

export const META = {
  id: 'craft.ai',
  name: 'AICraft',
  version: '1.0.0-pre5',
  branch: 'craft',
  codecs: [
    { ext: '.is-aicp', since: '0.32.277' },
    { ext: '.is-aicpx', since: '0.32.277' }
  ],
  hosts: ['ollama', 'vllm']
};

export const DEFAULT_HOST = 'http://127.0.0.1:11434';
export const DEFAULT_TIMEOUT_MS = 3000;
export const COMPRESSED_MAGIC = 'ISAICX1';

/* Ollama's own defaults: 2K of room for the answer, and the context windows a
 * machine is realistically able to hold for each model size class. */
export const ANSWER_RESERVE = 2048;
export const CONTEXT_STEPS = [4096, 8192, 32768];

const ERROR_TEXT = {
  HOST_UNREACHABLE: '本机模型服务未响应，请确认 Ollama 或 vLLM 已启动。',
  TIMEOUT: '本机模型服务响应超时。',
  HTTP_ERROR: '本机模型服务返回了错误状态。',
  BAD_RESPONSE: '本机模型服务返回了无法解析的内容。',
  MODEL_REQUIRED: '缺少模型名称。',
  MESSAGES_REQUIRED: '缺少对话消息。',
  BAD_MESSAGES: '对话消息必须是 {role, content} 形式的数组。',
  BAD_ACTION: '不支持的动作。',
  UNKNOWN_ACTION: '不支持的动作。',
  BAD_INPUT: '输入参数格式不正确。',
  BAD_EXT: '只支持 .is-aicp 与 .is-aicpx 两种格式。',
  NOT_FOUND: '文件不存在。',
  BAD_MAGIC: '不是 AICraft 项目文件。',
  BAD_PAYLOAD: '项目内容损坏，无法解析。',
  WRITE_FAILED: '写入项目文件失败。',
  BAD_HOST: '模型服务地址不是合法的 http(s) 地址。'
};

function fail(code, detail, extra) {
  const out = { ok: false, error: code, message: ERROR_TEXT[code] || code };
  if (detail) out.detail = String(detail);
  if (extra) Object.assign(out, extra);
  return out;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/* ------------------------------------------------------------- transport -- */

/* One request, no redirects, no retries. The timer is the only thing keeping a
 * closed port from turning into a hung studio, so it covers connect, headers
 * and body alike. */
function requestJson(url, options) {
  const opts = options || {};
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const method = opts.method || 'GET';
  const bodyText = opts.body === undefined ? null : JSON.stringify(opts.body);
  const headers = { accept: 'application/json' };
  if (bodyText !== null) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(bodyText);
  }

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let req = null;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(payload);
    };

    try {
      req = http.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || 80,
          path: url.pathname + url.search,
          method,
          headers,
          timeout: timeoutMs
        },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => {
            chunks.push(chunk);
            if (chunks.length > 4096) req.destroy(new Error('response too large'));
          });
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if (res.statusCode < 200 || res.statusCode >= 300) {
              return finish(fail('HTTP_ERROR', 'status ' + res.statusCode, { status: res.statusCode }));
            }
            if (!text) return finish({ ok: true, json: null, status: res.statusCode });
            try {
              finish({ ok: true, json: JSON.parse(text), status: res.statusCode });
            } catch (err) {
              finish(fail('BAD_RESPONSE', String(err && err.message)));
            }
          });
          res.on('error', (err) => finish(fail('BAD_RESPONSE', String(err && err.message))));
        }
      );
    } catch (err) {
      return finish(fail('HOST_UNREACHABLE', String(err && err.message)));
    }

    req.on('timeout', () => {
      req.destroy();
      finish(fail('TIMEOUT', 'no answer within ' + timeoutMs + 'ms'));
    });
    req.on('error', (err) => {
      const code = err && err.code ? String(err.code) : '';
      /* A closed port is the ordinary case: the user simply has no Ollama. */
      finish(fail(code === 'ECONNREFUSED' ? 'HOST_UNREACHABLE' : 'HOST_UNREACHABLE', code || String(err && err.message)));
    });

    timer = setTimeout(() => {
      if (req) req.destroy();
      finish(fail('TIMEOUT', 'no answer within ' + timeoutMs + 'ms'));
    }, timeoutMs + 250);
    if (timer && typeof timer.unref === 'function') timer.unref();

    if (bodyText !== null) req.write(bodyText);
    req.end();
  });
}

/* Split a host string into a usable base URL. Anything the URL parser rejects
 * becomes BAD_HOST rather than an exception. */
export function normalizeHost(raw) {
  const candidate = typeof raw === 'string' && raw.trim() ? raw.trim() : DEFAULT_HOST;
  const withScheme = /^https?:\/\//i.test(candidate) ? candidate : 'http://' + candidate;
  let url;
  try {
    url = new URL(withScheme);
  } catch (err) {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.port) url.port = url.protocol === 'https:' ? '443' : '80';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}

function endpoint(host, suffix) {
  const base = normalizeHost(host);
  if (!base) return null;
  return new URL(base.pathname + suffix, base);
}

/* --------------------------------------------------------------- messages -- */

const ROLES = new Set(['system', 'user', 'assistant', 'tool']);

/* Accept both the {role, content} shape and a bare string (treated as a user
 * turn). Unknown roles are rejected instead of silently forwarded, because a
 * typo in a role is the most common way a prompt file stops working. */
export function normalizeMessages(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      out.push({ role: 'user', content: item });
      continue;
    }
    if (!isPlainObject(item)) return null;
    const role = typeof item.role === 'string' ? item.role.toLowerCase() : '';
    if (!ROLES.has(role)) return null;
    if (typeof item.content !== 'string') return null;
    out.push({ role, content: item.content });
  }
  return out;
}

/* --------------------------------------------------------------- contexts -- */

/* Rough parameter count from the on-disk size of the weights. Ollama reports
 * bytes; a 4-bit quantised model is about 0.5 bytes per parameter, which is the
 * only sizing hint available without reading the manifest. */
export function estimateParams(sizeBytes) {
  const bytes = Number(sizeBytes);
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.round(bytes / 0.5);
}

/* The window a model is worth giving: the largest step that still leaves room
 * for the answer, capped by what the model can plausibly hold. */
export function recommendContext(sizeBytes) {
  const params = estimateParams(sizeBytes);
  const usable = params > 0 ? Math.max(CONTEXT_STEPS[0], Math.round(params * 1.5)) : CONTEXT_STEPS[0];
  let chosen = CONTEXT_STEPS[0];
  for (const step of CONTEXT_STEPS) {
    if (step <= usable) chosen = step;
  }
  const answer = Math.min(ANSWER_RESERVE, Math.max(256, Math.round(chosen / 4)));
  return { context: chosen, answer, prompt: chosen - answer, params };
}

/* ------------------------------------------------------------------- probe -- */

/* Ask the host what it has. A closed port is an answer, not a failure: the
 * studio renders "no local models" the same way it renders a list. */
export async function probe(input) {
  const opts = isPlainObject(input) ? input : {};
  const host = opts.host || DEFAULT_HOST;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const target = endpoint(host, '/api/tags');
  if (!target) return { reachable: false, models: [], host: String(host), error: 'BAD_HOST' };

  const res = await requestJson(target, { timeoutMs });
  if (!res.ok) {
    return { reachable: false, models: [], host: target.origin, error: res.error, message: res.message, detail: res.detail };
  }
  const list = res.json && Array.isArray(res.json.models) ? res.json.models : [];
  const models = list.map((m) => ({
    name: String(m && m.name ? m.name : m && m.model ? m.model : ''),
    size: Number(m && m.size) || 0,
    modified: String((m && (m.modified_at || m.modified)) || '')
  })).filter((m) => m.name);
  return { reachable: true, models, host: target.origin, count: models.length };
}

/* ------------------------------------------------------------------ models -- */

/* The registry view of probe(): each model plus the window we would offer it.
 * Kept separate so the UI can show the estimate without a second request. */
export async function models(input) {
  const seen = await probe(input);
  if (!seen.reachable) {
    return { ok: false, error: seen.error || 'HOST_UNREACHABLE', message: seen.message || ERROR_TEXT.HOST_UNREACHABLE, models: [], host: seen.host };
  }
  const rows = seen.models.map((m) => {
    const rec = recommendContext(m.size);
    return {
      name: m.name,
      size: m.size,
      modified: m.modified,
      params: rec.params,
      context: rec.context,
      answer: rec.answer,
      steps: CONTEXT_STEPS.slice()
    };
  });
  return { ok: true, models: rows, count: rows.length, host: seen.host };
}

/* Same data without the network: what we would suggest for a size in bytes. */
export function contexts(input) {
  const opts = isPlainObject(input) ? input : {};
  const size = Number(opts.size) || 0;
  const rec = recommendContext(size);
  const options = CONTEXT_STEPS.map((step) => {
    const answer = Math.min(ANSWER_RESERVE, Math.max(256, Math.round(step / 4)));
    return { context: step, answer, prompt: step - answer, fits: rec.params > 0 ? step <= Math.max(CONTEXT_STEPS[0], Math.round(rec.params * 1.5)) : step === CONTEXT_STEPS[0] };
  });
  return {
    ok: true,
    model: typeof opts.model === 'string' ? opts.model : '',
    size,
    params: rec.params,
    recommended: { context: rec.context, answer: rec.answer, prompt: rec.prompt },
    options
  };
}

/* -------------------------------------------------------------------- plan -- */

/* Build the exact body /api/chat would receive. Pure: no socket is opened, so
 * a caller can show the user what will be sent before anything is sent. */
export function buildChatRequest(input) {
  const opts = isPlainObject(input) ? input : {};
  const model = typeof opts.model === 'string' ? opts.model.trim() : '';
  if (!model) return fail('MODEL_REQUIRED');
  const messages = normalizeMessages(opts.messages);
  if (!messages) return fail(opts.messages === undefined ? 'MESSAGES_REQUIRED' : 'BAD_MESSAGES');

  const body = { model, messages, stream: opts.stream === true };
  const options = {};
  const ctx = Number(opts.num_ctx);
  if (Number.isFinite(ctx) && ctx > 0) options.num_ctx = Math.round(ctx);
  const predict = Number(opts.num_predict);
  if (Number.isFinite(predict) && predict > 0) options.num_predict = Math.round(predict);
  const temperature = Number(opts.temperature);
  if (Number.isFinite(temperature)) options.temperature = temperature;
  if (Object.keys(options).length > 0) body.options = options;
  if (isPlainObject(opts.format)) body.format = opts.format;
  return { ok: true, body, model, messageCount: messages.length, stream: body.stream };
}

/* -------------------------------------------------------------- plan/run -- */

export function plan(action, input) {
  const steps = [];
  const warnings = [];
  const act = typeof action === 'string' ? action.toLowerCase() : '';

  if (act === 'probe') {
    const host = (isPlainObject(input) && input.host) || DEFAULT_HOST;
    steps.push({ kind: 'resolve', detail: '解析宿主地址 ' + host });
    steps.push({ kind: 'request', detail: 'GET ' + host + '/api/tags（超时 3000ms）' });
    steps.push({ kind: 'map', detail: '把 models[] 归一为 {name, size, modified}' });
    steps.push({ kind: 'fallback', detail: '连接失败时返回 reachable:false，不抛异常' });
    return { ok: true, action: 'probe', steps, warnings };
  }

  if (act === 'chat') {
    const built = buildChatRequest(input);
    if (!built.ok) return { ok: false, action: 'chat', steps, warnings, error: built.error, message: built.message };
    steps.push({ kind: 'validate', detail: '校验模型名与 ' + built.messageCount + ' 条消息' });
    steps.push({ kind: 'request', detail: 'POST ' + DEFAULT_HOST + '/api/chat（JSON）' });
    steps.push({ kind: 'collect', detail: '拼接流式或整块的 message.content' });
    steps.push({ kind: 'report', detail: '返回 {ok, model, content, done}' });
    if (built.body.stream) warnings.push('stream:true 时内容分片返回，本模块在内存中拼接为完整文本。');
    if (!built.body.options || built.body.options.num_ctx === undefined) {
      warnings.push('未指定 num_ctx，宿主将使用模型默认上下文窗口。');
    }
    return { ok: true, action: 'chat', steps, warnings, body: built.body };
  }

  if (act === 'contexts') {
    steps.push({ kind: 'estimate', detail: '按权重字节数估算参数量' });
    steps.push({ kind: 'choose', detail: '在 4096 / 8192 / 32768 中取不超过可用窗口的最大档' });
    steps.push({ kind: 'reserve', detail: '预留 2048 token 给回答，其余留给提示词' });
    return { ok: true, action: 'contexts', steps, warnings };
  }

  if (act === 'models') {
    steps.push({ kind: 'probe', detail: '调用 probe() 取模型列表' });
    steps.push({ kind: 'estimate', detail: '为每个模型附上推荐上下文窗口' });
    return { ok: true, action: 'models', steps, warnings };
  }

  if (act === 'export' || act === 'encode') {
    steps.push({ kind: 'serialize', detail: '把项目文档序列化为 UTF-8 JSON' });
    steps.push({ kind: 'compress', detail: '.is-aicpx 用 zlib deflateRaw 压缩并加 ISAICX1 魔数' });
    steps.push({ kind: 'write', detail: '写入目标路径' });
    return { ok: true, action: act, steps, warnings };
  }

  if (act === 'open' || act === 'decode') {
    steps.push({ kind: 'read', detail: '读取文件字节' });
    steps.push({ kind: 'sniff', detail: '按魔数区分 .is-aicp 与 .is-aicpx' });
    steps.push({ kind: 'parse', detail: '解压并 JSON.parse，校验 format 字段' });
    return { ok: true, action: act, steps, warnings };
  }

  return { ok: false, action: act, steps, warnings, error: 'UNKNOWN_ACTION', message: ERROR_TEXT.UNKNOWN_ACTION };
}

/* ---------------------------------------------------------------- project -- */

/* A project document is deliberately boring: a format tag, a version, and the
 * three things this component actually owns - prompts, the model registry and
 * the pipelines that chain them. */
export function makeProject(input) {
  const opts = isPlainObject(input) ? input : {};
  return {
    format: 'is-aicp',
    version: '1.0.0-pre5',
    created: typeof opts.created === 'string' ? opts.created : new Date().toISOString(),
    model: typeof opts.model === 'string' ? opts.model : '',
    prompts: Array.isArray(opts.prompts) ? opts.prompts : [],
    registry: Array.isArray(opts.registry) ? opts.registry : [],
    pipelines: Array.isArray(opts.pipelines) ? opts.pipelines : [],
    settings: isPlainObject(opts.settings) ? opts.settings : {}
  };
}

export function encodeProject(doc, input) {
  const opts = isPlainObject(input) ? input : {};
  const document = isPlainObject(doc) ? doc : makeProject(doc);
  const text = JSON.stringify(document);
  const raw = Buffer.from(text, 'utf8');
  const compress = opts.compress === true || String(opts.ext || '').toLowerCase() === '.is-aicpx';
  if (!compress) return { ok: true, ext: '.is-aicp', bytes: raw, raw: raw.length, stored: raw.length };
  const packed = zlib.deflateRawSync(raw, { level: 9 });
  const bytes = Buffer.concat([Buffer.from(COMPRESSED_MAGIC, 'ascii'), packed]);
  return { ok: true, ext: '.is-aicpx', bytes, raw: raw.length, stored: bytes.length };
}

export function decodeProject(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (buf.length === 0) return fail('BAD_PAYLOAD', 'empty');
  const head = buf.subarray(0, COMPRESSED_MAGIC.length).toString('ascii');
  let text;
  let ext;
  if (head === COMPRESSED_MAGIC) {
    ext = '.is-aicpx';
    try {
      text = zlib.inflateRawSync(buf.subarray(COMPRESSED_MAGIC.length)).toString('utf8');
    } catch (err) {
      return fail('BAD_PAYLOAD', String(err && err.message));
    }
  } else {
    ext = '.is-aicp';
    text = buf.toString('utf8');
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    return fail('BAD_PAYLOAD', String(err && err.message));
  }
  if (!isPlainObject(doc) || doc.format !== 'is-aicp') return fail('BAD_MAGIC');
  return { ok: true, ext, document: doc, bytes: buf.length };
}

export function writeProject(filePath, doc, input) {
  if (typeof filePath !== 'string' || !filePath) return fail('BAD_INPUT', 'path');
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.is-aicp' && ext !== '.is-aicpx') return fail('BAD_EXT', ext);
  const encoded = encodeProject(doc, Object.assign({}, input, { ext }));
  if (!encoded.ok) return encoded;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, encoded.bytes);
  } catch (err) {
    return fail('WRITE_FAILED', String(err && err.message));
  }
  return { ok: true, path: filePath, ext, bytes: encoded.bytes.length, raw: encoded.raw };
}

export function readProject(filePath) {
  if (typeof filePath !== 'string' || !filePath) return fail('BAD_INPUT', 'path');
  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch (err) {
    const code = err && err.code === 'ENOENT' ? 'NOT_FOUND' : 'BAD_PAYLOAD';
    return fail(code, String(err && err.message));
  }
  const decoded = decodeProject(buf);
  if (!decoded.ok) return decoded;
  return { ok: true, path: filePath, ext: decoded.ext, document: decoded.document, bytes: buf.length };
}

/* ------------------------------------------------------------------- chat -- */

/* Send one conversation. Streaming responses are concatenated here so callers
 * get the same shape either way; the trade-off is memory, not correctness, and
 * a 3K-token answer is not worth a second code path. */
export async function chat(input) {
  const opts = isPlainObject(input) ? input : {};
  const built = buildChatRequest(opts);
  if (!built.ok) return built;
  const host = opts.host || DEFAULT_HOST;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const target = endpoint(host, '/api/chat');
  if (!target) return fail('BAD_HOST');

  const res = await requestJson(target, { method: 'POST', body: built.body, timeoutMs });
  if (!res.ok) return fail(res.error, res.detail, { model: built.model });

  const payload = res.json || {};
  const message = isPlainObject(payload.message) ? payload.message : {};
  const content = typeof message.content === 'string' ? message.content : typeof payload.response === 'string' ? payload.response : '';
  return {
    ok: true,
    model: typeof payload.model === 'string' && payload.model ? payload.model : built.model,
    content,
    done: payload.done === undefined ? true : !!payload.done,
    host: target.origin
  };
}

/* -------------------------------------------------------------------- run -- */

export async function run(action, input) {
  const act = typeof action === 'string' ? action.toLowerCase() : '';
  try {
    if (act === 'probe') {
      const result = await probe(input);
      return { ok: true, action: 'probe', result };
    }
    if (act === 'models') {
      const result = await models(input);
      return { ok: result.ok !== false, action: 'models', result, error: result.ok === false ? result.error : undefined };
    }
    if (act === 'contexts') {
      return { ok: true, action: 'contexts', result: contexts(input) };
    }
    if (act === 'chat') {
      const result = await chat(input);
      return { ok: result.ok === true, action: 'chat', result, error: result.ok === true ? undefined : result.error };
    }
    if (act === 'open' || act === 'decode') {
      const file = isPlainObject(input) ? input.path : input;
      const result = readProject(file);
      return { ok: result.ok === true, action: 'open', result, error: result.ok === true ? undefined : result.error };
    }
    if (act === 'export' || act === 'encode') {
      const doc = isPlainObject(input) && input.document ? input.document : makeProject(isPlainObject(input) ? input : {});
      const file = isPlainObject(input) ? input.path : '';
      if (file) {
        const written = writeProject(file, doc, isPlainObject(input) ? input : {});
        return { ok: written.ok === true, action: 'export', result: written, error: written.ok === true ? undefined : written.error };
      }
      const encoded = encodeProject(doc, isPlainObject(input) ? input : {});
      return { ok: encoded.ok === true, action: 'export', result: { ext: encoded.ext, bytes: encoded.bytes.length, raw: encoded.raw, stored: encoded.stored } };
    }
    if (act === 'plan') {
      const built = buildChatRequest(input);
      return { ok: built.ok === true, action: 'plan', result: built, error: built.ok === true ? undefined : built.error };
    }
    return { ok: false, action: act, error: 'UNKNOWN_ACTION', message: ERROR_TEXT.UNKNOWN_ACTION };
  } catch (err) {
    /* run() is the boundary the studio calls: nothing escapes it. */
    return { ok: false, action: act, error: 'BAD_INPUT', message: '执行失败', detail: String(err && err.message) };
  }
}

export function capabilities() {
  return {
    id: META.id,
    name: META.name,
    version: META.version,
    features: [
      'prompt-engineering',
      'local-model-registry',
      'ollama-probe',
      'vllm-compatible',
      'chat-completion',
      'context-estimation',
      'pipeline-planning',
      'project-codec'
    ],
    formats: META.codecs.map((c) => c.ext),
    hosts: META.hosts.slice(),
    implemented: true
  };
}

export default { META, capabilities, plan, run, probe, chat, contexts, models };
