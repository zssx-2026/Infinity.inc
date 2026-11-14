/*
 * remote.js - the online half of the studio.
 *
 * A studio that can only install from a developer's workspace is a studio
 * nobody else can run: the sources are not on the user's machine, and asking
 * them to clone the repository first is exactly the "set an environment
 * variable before the program starts" mistake in another shape. So the
 * installable things are the released setups, and the catalog says which ones
 * exist, how large they are and what their sha256 is.
 *
 * Three rules hold this together:
 *   - the catalog comes from the download host, not from this file, so a new
 *     release does not need a new studio;
 *   - every download is hashed and compared before it is run, because running
 *     an installer is the one place where "probably the right file" is not
 *     good enough;
 *   - the installer is run with /S and windowsHide, so installing from the
 *     studio never flashes a console or a second wizard in the user's face.
 *
 * Nothing here downloads anything on its own: fetchCatalog and download are
 * called from the server routes when the user asks for them.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

/* The download host is the account worker the site also links to; the whole
 * point of routing through it is that the real asset URL can move without the
 * studio or the site changing. INFINITY_DL_BASE overrides it for a staging
 * worker or a local test.
 *
 * Two hosts, in order, because a single host is a single point of failure that
 * the user cannot do anything about: workers.dev is SNI-blocked on some
 * networks (measured: TLS reset), pages.dev answers on the same account. The
 * catalog is fetched from whichever host answers first, so a blocked suffix
 * costs a retry and not an unusable studio. */
export const DL_BASES = [
  'https://infinity-downloads.pages.dev',
  'https://infinity-account-auth-worker.zssx2026.workers.dev'
];
export const DEFAULT_DL_BASE = DL_BASES[0];

export function dlBase() {
  const fromEnv = process.env.INFINITY_DL_BASE;
  return String(fromEnv && fromEnv.trim() ? fromEnv.trim() : DEFAULT_DL_BASE).replace(/\/+$/, '');
}

export function dlBases() {
  const fromEnv = process.env.INFINITY_DL_BASE;
  if (fromEnv && fromEnv.trim()) return [fromEnv.trim().replace(/\/+$/, '')];
  return DL_BASES.slice();
}

export function downloadDir() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const dir = path.join(base, 'Infinity', 'Studio', 'downloads');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function sha256File(file) {
  const h = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1024 * 1024);
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      h.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

/* The catalog is small and public: { version, updated, products: [...] }. It is
 * fetched over the same host as the downloads, so a machine that can install
 * anything at all can also read the list. */
export async function fetchCatalog(base) {
  const roots = base ? [String(base).replace(/\/+$/, '')] : dlBases();
  let lastError = null;
  let root = roots[0];
  let data = null;
  for (const candidate of roots) {
    root = candidate;
    try {
      const response = await fetch(candidate + '/api/catalog', {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) throw new Error('catalog HTTP ' + response.status);
      data = await response.json();
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      data = null;
    }
  }
  if (!data) throw lastError || new Error('catalog unavailable');
  const products = Array.isArray(data.products) ? data.products : [];
  const clean = products.map((p) => cleanProduct(p, false)).filter(Boolean);
  /* A studio that cannot install its own sub-products is a download page with a
   * progress bar. The gate keeps them on a second door so the public site never
   * lists them; an older gate without that door simply yields the two setups. */
  const components = await fetchComponents(root);
  return {
    ok: true,
    base: root,
    version: String(data.version || ''),
    updated: String(data.updated || ''),
    products: clean.concat(components)
  };
}

/* One catalog entry, normalised. Both doors (the public setups and Studio's own
 * components) answer in the same shape, so the download and install code has a
 * single input to reason about. */
function cleanProduct(p, component) {
  if (!p || typeof p.asset !== 'string' || !p.asset) return null;
  return {
    id: String(p.id || ''),
    name: String(p.name || p.asset),
    asset: String(p.asset),
    size: Number(p.size) || 0,
    sha256: String(p.sha256 || ''),
    url: String(p.url || ''),
    component: Boolean(component || p.component),
    /* The mirror is the fallback host. Dropping it here is what turned a
     * blocked GitHub into a failed install: the download loop only had the
     * release URL to try, so it gave up after two attempts instead of moving
     * to the host that actually answers on this network. */
    mirror: String(p.mirror || ''),
    /* Extra hosts the catalog wants tried, in order. The gate publishes more
     * than one mirror (an own edge proxy and a public GitHub proxy that is
     * faster from this network), and the downloader should not need a rebuild
     * to learn about a new one. */
    mirrors: (Array.isArray(p.mirrors) ? p.mirrors : [])
      .map((m) => String(m || ''))
      .filter((m, index, all) => m && all.indexOf(m) === index)
  };
}

/* The components door. Not being able to read it is not an error: the studio
 * still installs what the public catalog offers. */
export async function fetchComponents(root) {
  try {
    const response = await fetch(root + '/api/components', {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) return [];
    const data = await response.json();
    const list = Array.isArray(data.products) ? data.products : [];
    return list.map((p) => cleanProduct(p, true)).filter(Boolean);
  } catch (error) {
    return [];
  }
}

/* The name the file is written under. It has to end in .exe: spawn() on Windows
 * refuses a PE image without the extension (ENOENT, which reads like a missing
 * file), and the catalog key ("InfinityServer-setup") is not a file name. The
 * release asset name is the truth; the key is only a fallback. */
export function fileNameOf(product) {
  const fromUrl = (() => {
    try {
      const u = new URL(String(product.url || ''));
      const last = decodeURIComponent(u.pathname.split('/').pop() || '');
      return /\.exe$/i.test(last) ? last : '';
    } catch (error) {
      return '';
    }
  })();
  if (fromUrl) return fromUrl;
  const asset = String(product.asset || 'setup');
  return /\.exe$/i.test(asset) ? asset : asset + '.exe';
}

/* One connection is the wrong shape for these files: the asset host throttles a
 * single stream hard (measured on a 80 MiB setup: ~16 KiB/s single stream while
 * the same host serves ranges fast), and an installer nobody can download in
 * reasonable time is not shipped. So the download asks for ranges when the host
 * says it has them, and writes them at explicit offsets into one .part file.
 * Anything that goes wrong here (no Range support, a short or failed chunk)
 * falls back to the plain single stream below instead of failing the install. */
export const PARALLEL_MIN_BYTES = 8 * 1024 * 1024;
export const PARALLEL_CONNECTIONS = 8;
export const STALL_MS = 90000;
/* Work is split into small segments rather than one range per connection: a
 * single range covering a tenth of the file cannot be retried without throwing
 * away everything it had already fetched, and one slow range holds the whole
 * download open. With segments, a dead or crawling piece is dropped and queued
 * again while the other connections keep moving. */
export const SEGMENT_BYTES = 2 * 1024 * 1024;
export const SEGMENT_RETRIES = 3;
/* "Still moving" is not the same as "working": the last two megabytes of one
 * real download arrived at 1.2 KB/s, which never trips a stall watchdog and
 * turned a 6 minute install into a 30 minute one. A segment whose average rate
 * over the last window is under SLOW_BYTES_PER_SEC is dropped like a failure. */
export const SLOW_WINDOW_MS = 20000;
export const SLOW_BYTES_PER_SEC = 6000;

export async function probeRange(url) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: { accept: '*/*' },
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) return { ranges: false, size: 0 };
    const size = Number(response.headers.get('content-length')) || 0;
    const accepted = String(response.headers.get('accept-ranges') || '').toLowerCase().indexOf('bytes') >= 0;
    return { ranges: accepted && size > 0, size: size };
  } catch (error) {
    return { ranges: false, size: 0 };
  }
}

export async function downloadParallel(url, part, size, onProgress) {
  const handle = await fs.promises.open(part, 'w');
  const segments = [];
  for (let from = 0; from < size; from += SEGMENT_BYTES) {
    segments.push({ from: from, to: Math.min(size - 1, from + SEGMENT_BYTES - 1), tries: 0, written: 0 });
  }

  /* One dead connection must not leave the others running: the first fatal
   * error aborts everything, every worker swallows its own rejection, and the
   * error is rethrown only after all of them have stopped. Letting a job reject
   * after Promise.all has already failed is an unhandled rejection, and in the
   * Electron main process that is a crash dialog, not a log line. */
  const stop = new AbortController();
  let received = 0;
  let fatal = null;
  let lastByteAt = Date.now();
  const watchdog = setInterval(() => {
    if (!fatal && Date.now() - lastByteAt > STALL_MS) {
      fatal = new Error('download stalled for ' + Math.round(STALL_MS / 1000) + 's');
      stop.abort(fatal);
    }
  }, 5000);

  const pull = async (segment) => {
    const controller = new AbortController();
    const forward = () => controller.abort(stop.signal.reason);
    stop.signal.addEventListener('abort', forward, { once: true });
    let offset = segment.from;
    let windowStart = Date.now();
    let windowBytes = 0;
    const slow = setInterval(() => {
      if (Date.now() - windowStart < SLOW_WINDOW_MS) return;
      const rate = windowBytes / ((Date.now() - windowStart) / 1000);
      windowStart = Date.now();
      windowBytes = 0;
      if (rate < SLOW_BYTES_PER_SEC) controller.abort(new Error('segment too slow: ' + Math.round(rate) + ' B/s'));
    }, 5000);
    try {
      const response = await fetch(url, {
        headers: { range: 'bytes=' + segment.from + '-' + segment.to, accept: '*/*' },
        signal: controller.signal
      });
      if (response.status !== 206 || !response.body) throw new Error('range HTTP ' + response.status);
      for await (const chunk of response.body) {
        const buffer = Buffer.from(chunk);
        await handle.write(buffer, 0, buffer.length, offset);
        offset += buffer.length;
        /* A retried segment re-reads bytes it may already have written; counting
         * the high-water mark per segment keeps progress monotonic and never
         * counts the same byte twice. */
        const done = offset - segment.from;
        if (done > segment.written) {
          received += done - segment.written;
          segment.written = done;
          if (onProgress) onProgress(received, size);
        }
        windowBytes += buffer.length;
        lastByteAt = Date.now();
      }
      if (offset !== segment.to + 1) throw new Error('range short: ' + (offset - segment.from) + '/' + (segment.to - segment.from + 1));
    } finally {
      clearInterval(slow);
      stop.signal.removeEventListener('abort', forward);
    }
  };

  const worker = async () => {
    for (;;) {
      if (fatal) return;
      const segment = segments.shift();
      if (!segment) return;
      try {
        await pull(segment);
      } catch (error) {
        if (fatal) return;
        segment.tries += 1;
        if (segment.tries >= SEGMENT_RETRIES) {
          fatal = error;
          stop.abort(error);
          return;
        }
        segments.push(segment);
      }
    }
  };

  try {
    const workers = [];
    const count = Math.min(PARALLEL_CONNECTIONS, segments.length);
    for (let i = 0; i < count; i++) workers.push(worker());
    await Promise.all(workers);
  } finally {
    clearInterval(watchdog);
    await handle.close();
  }
  if (fatal) throw fatal;
  return received;
}

async function downloadSingle(url, part, product, onProgress) {
  const response = await fetch(url, { headers: { accept: '*/*' } });
  if (!response.ok || !response.body) throw new Error('download HTTP ' + response.status + ' for ' + product.asset);
  const total = Number(response.headers.get('content-length')) || product.size || 0;
  const out = fs.createWriteStream(part);
  let received = 0;
  try {
    for await (const chunk of response.body) {
      received += chunk.length;
      if (!out.write(Buffer.from(chunk))) await once(out, 'drain');
      if (onProgress) onProgress(received, total);
    }
    out.end();
    await once(out, 'finish');
  } catch (error) {
    out.destroy();
    fs.rmSync(part, { force: true });
    throw error;
  }
  return received;
}

/* Download one asset. A file already on disk whose hash matches is reused, so a
 * retried install does not pull 80 MiB again. The hash of a fresh download is
 * checked against the catalog before the file is handed to anyone. */
export async function download(product, opts) {
  const o = opts || {};
  const dir = o.dir || downloadDir();
  const target = path.join(dir, fileNameOf(product));
  if (fs.existsSync(target) && product.sha256) {
    const have = sha256File(target);
    if (have === product.sha256) {
      return { ok: true, file: target, bytes: fs.statSync(target).size, cached: true, sha256: have };
    }
    fs.rmSync(target, { force: true });
  }
  const part = target + '.part';
  /* Two hosts, because either one can be the slow or unreachable one on a given
   * day: the release URL (ranges, so it can be pulled in parallel) and the
   * deployment's mirror. Each is tried twice; a hash mismatch is not retried --
   * that is a wrong file, not a bad route. */
  const hosts = [];
  const seen = new Set();
  const addHost = (value) => {
    const url = String(value || '');
    if (!url || seen.has(url)) return;
    seen.add(url);
    hosts.push(url);
  };
  addHost(product.url);
  for (const mirror of product.mirrors || []) addHost(mirror);
  addHost(product.mirror);
  if (!hosts.length) addHost(dlBase() + '/dl/' + encodeURIComponent(product.asset));

  let received = 0;
  let lastError = null;
  for (const url of hosts) {
    for (let attempt = 0; attempt < 2 && !received; attempt++) {
      try {
        const probe = await probeRange(url);
        if (probe.ranges && probe.size >= PARALLEL_MIN_BYTES) {
          try {
            received = await downloadParallel(url, part, probe.size, o.onProgress);
          } catch (error) {
            fs.rmSync(part, { force: true });
            received = await downloadSingle(url, part, product, o.onProgress);
          }
        } else {
          received = await downloadSingle(url, part, product, o.onProgress);
        }
      } catch (error) {
        lastError = error;
        fs.rmSync(part, { force: true });
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (received) break;
  }
  if (!received) throw lastError || new Error('download failed for ' + product.asset);
  const sha = sha256File(part);
  if (product.sha256 && sha !== product.sha256) {
    fs.rmSync(part, { force: true });
    throw new Error('sha256 mismatch for ' + product.asset + ': expected ' + product.sha256 + ', got ' + sha);
  }
  fs.renameSync(part, target);
  return { ok: true, file: target, bytes: received, cached: false, sha256: sha };
}

/* Run a released setup silently. NSIS /S is per-user and needs no elevation;
 * the exit code is the only honest answer to "did it install". */
export function runSetup(file, opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, ['/S'], { windowsHide: true, stdio: 'ignore', detached: false });
    } catch (error) {
      resolve({ ok: false, code: null, error: String((error && error.message) || error) });
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch (error) { /* already gone */ }
      resolve({ ok: false, code: null, error: 'setup did not finish in ' + (o.timeoutMs || 900000) + ' ms' });
    }, o.timeoutMs || 900000);
    child.once('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, error: String((error && error.message) || error) });
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code: code, error: code === 0 ? null : 'setup exit ' + code });
    });
  });
}

/* One job at a time, with a snapshot the page can poll. Installing two setups
 * at once would fight over the same Start Menu folder and the same registry
 * key, so the runner is deliberately serial. */
export function createRemoteInstaller(opts) {
  const o = opts || {};
  const state = {
    running: false,
    phase: 'idle',
    startedAt: null,
    finishedAt: null,
    index: 0,
    total: 0,
    current: null,
    received: 0,
    expected: 0,
    log: [],
    results: [],
    error: null
  };
  const keep = o.logLimit || 200;

  function note(text) {
    state.log.push({ at: Date.now(), text: String(text) });
    if (state.log.length > keep) state.log.splice(0, state.log.length - keep);
  }

  function snapshot() {
    return JSON.parse(JSON.stringify(state));
  }

  async function run(products) {
    state.running = true;
    state.phase = 'start';
    state.startedAt = Date.now();
    state.finishedAt = null;
    state.index = 0;
    state.total = products.length;
    state.results = [];
    state.error = null;
    note('开始安装 ' + products.length + ' 个产品');
    try {
      for (let i = 0; i < products.length; i++) {
        const product = products[i];
        state.index = i + 1;
        state.current = product.asset;
        state.received = 0;
        state.expected = product.size || 0;
        state.phase = 'download';
        note('下载 ' + product.name + '（' + human(product.size) + '）');
        const got = await download(product, {
          dir: o.dir,
          onProgress: (received, total) => {
            state.received = received;
            if (total) state.expected = total;
          }
        });
        note((got.cached ? '已缓存 ' : '下载完成 ') + path.basename(got.file) + ' ' + got.bytes + ' B sha256=' + got.sha256);
        state.phase = 'install';
        note('运行安装程序 ' + path.basename(got.file) + ' /S');
        const done = await runSetup(got.file, { timeoutMs: o.timeoutMs });
        state.results.push({ id: product.id, name: product.name, asset: product.asset, ok: done.ok, code: done.code, error: done.error || null, bytes: got.bytes, sha256: got.sha256 });
        note(done.ok ? '安装完成 ' + product.name : '安装失败 ' + product.name + '：' + (done.error || '未知错误'));
      }
      state.phase = 'done';
    } catch (error) {
      state.phase = 'failed';
      state.error = String((error && error.message) || error);
      note('失败：' + state.error);
    } finally {
      state.running = false;
      state.finishedAt = Date.now();
      state.current = null;
    }
  }

  function start(products) {
    if (state.running) return { ok: false, error: 'installer is already running' };
    if (!Array.isArray(products) || !products.length) return { ok: false, error: 'no products selected' };
    run(products).catch((error) => note('内部错误：' + String((error && error.message) || error)));
    return { ok: true, started: true, total: products.length };
  }

  return { state: state, start: start, snapshot: snapshot };
}

export function human(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let n = Number(bytes) || 0;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(1)) + ' ' + units[i];
}
