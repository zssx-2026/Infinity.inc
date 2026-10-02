/*
 * accelerator.js - the two things that make transfers fast.
 *
 * Neither tool is assumed to exist on the machine. bootstrap.js fetches them
 * into <baseDir>/program/tools and records the paths in program.json; this
 * module reads that manifest and uses what it finds.
 *
 * FastGithub supplies the route to GitHub. aria2c does the downloading, and
 * it is worth using for one reason: it fetches a file in parallel segments,
 * which on a throttled link is the difference between minutes and hours. It
 * also resumes, which is what makes a dropped connection survivable.
 *
 * Nothing here is required. When a tool is missing the caller falls back to
 * curl through the ordinary route and every feature still works.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';

/* Read program.json beside the working directory. */
export function loadProgramPaths(baseDir) {
  const out = { aria2c: null, fastgithub: null, fastgithubUi: null, sevenZip: null };
  try {
    const raw = fs.readFileSync(path.join(baseDir, 'program.json'), 'utf8');
    const parsed = JSON.parse(raw);
    for (const k of Object.keys(out)) {
      if (typeof parsed[k] === 'string' && fs.existsSync(parsed[k])) out[k] = parsed[k];
    }
  } catch (e) { /* no manifest yet: everything stays null */ }
  const tools = path.join(baseDir, 'program', 'tools');
  if (!out.aria2c) {
    const p = path.join(tools, 'aria2c.exe');
    if (fs.existsSync(p)) out.aria2c = p;
  }
  if (!out.fastgithub) {
    const p = path.join(tools, 'fastgithub.exe');
    if (fs.existsSync(p)) out.fastgithub = p;
  }
  return out;
}

/* Is something listening on a port? */
export function portOpen(port, host) {
  return new Promise(function (resolve) {
    const s = net.connect({ port: port, host: host || '127.0.0.1' });
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; try { s.destroy(); } catch (e) { } resolve(v); } };
    s.setTimeout(700);
    s.on('connect', function () { done(true); });
    s.on('timeout', function () { done(false); });
    s.on('error', function () { done(false); });
  });
}

/* The ports FastGithub has used across its versions. */
export async function findFastGithub() {
  for (const port of [38457, 38458, 7890, 10809]) {
    if (await portOpen(port)) return { port: port, url: 'http://127.0.0.1:' + port };
  }
  return null;
}

/* Start FastGithub if it is present and not already listening. */
export function startFastGithub(exePath) {
  return new Promise(function (resolve) {
    if (!exePath || !fs.existsSync(exePath)) { resolve(false); return; }
    try {
      const child = spawn(exePath, [], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      resolve(true);
    } catch (e) { resolve(false); }
  });
}

/*
 * Download one URL with aria2c.
 *
 *   -x  connections per server
 *   -s  segments
 *   -k  minimum segment size, so a small file is not split pointlessly
 *   -c  continue a partial file
 */
export function ariaDownload(aria2c, url, outPath, opts, onProgress) {
  return new Promise(function (resolve, reject) {
    const o = opts || {};
    if (!aria2c || !fs.existsSync(aria2c)) { reject(new Error('aria2c not available')); return; }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const args = [
      '--dir=' + path.dirname(outPath),
      '--out=' + path.basename(outPath),
      '--continue=true',
      '--max-connection-per-server=' + (o.connections || 8),
      '--split=' + (o.splits || 8),
      '--min-split-size=' + (o.minSplit || '1M'),
      '--summary-interval=1',
      '--console-log-level=warn',
      '--download-result=hide',
      '--file-allocation=none'
    ];
    const headers = o.headers || {};
    for (const k of Object.keys(headers)) args.push('--header=' + k + ': ' + headers[k]);
    if (o.proxy) args.push('--all-proxy=' + o.proxy);
    if (o.speedLimit) args.push('--max-overall-download-limit=' + o.speedLimit);
    args.push(url);

    const child = spawn(aria2c, args, { windowsHide: true });
    let err = '';
    child.stderr.on('data', function (d) { err += d.toString(); });
    child.stdout.on('data', function (d) {
      if (!onProgress) return;
      const text = d.toString();
      const m = text.match(/(\d+)%/);
      const s = text.match(/([0-9.]+[KMG]iB)\/s/);
      if (m) onProgress({ pct: Number(m[1]), speed: s ? s[1] : '' });
    });
    child.on('error', reject);
    child.on('close', function (code) {
      if (code === 0 && fs.existsSync(outPath)) resolve(outPath);
      else reject(new Error('aria2c exited ' + code + ': ' + err.slice(0, 200)));
    });
  });
}

/*
 * What a transfer should use right now: the tools that exist and the route
 * that is actually open.
 */
export async function makeDownloader(paths) {
  const fast = await findFastGithub();
  return {
    aria2c: paths.aria2c && fs.existsSync(paths.aria2c) ? paths.aria2c : null,
    fastgithub: fast,
    proxy: fast ? fast.url : null
  };
}

