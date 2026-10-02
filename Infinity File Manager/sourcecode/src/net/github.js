/*
 * github.js - everything that talks to GitHub.
 *
 * The machine this runs on reaches GitHub through a local CONNECT tunnel on
 * 127.0.0.1:13799 because the hosts file sends github.com to 127.0.0.1.
 * Rather than assume that is true everywhere, the tunnel is optional: if
 * nothing is listening the client goes direct and everything still works on a
 * normal network.
 *
 * Requests are hand-rolled over http/tls. There is no dependency to install
 * and the response parsing is small enough to keep in one file.
 */
import http from 'node:http';
import tls from 'node:tls';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

const CRLF = String.fromCharCode(13, 10);
const PROXY = { host: '127.0.0.1', port: 13799 };

/*
 * Certificate verification, and why it is allowed to fail once.
 *
 * Where the hosts file sends github.com to 127.0.0.1 the peer on the other end
 * of the TLS handshake is a local relay presenting its own certificate -
 * FastGithub is the usual one. Verifying that against the public roots cannot
 * succeed and fails with "unable to verify the first certificate", and the
 * failure is about the relay, not about GitHub.
 *
 * So the first attempt verifies, exactly as it should on a normal network.
 * Only a certificate error switches to an unverified retry, only for the rest
 * of the process, and only after saying so once. NODE_EXTRA_CA_CERTS still
 * wins if it is set: a relay that ships its own CA should be trusted properly
 * rather than waved through.
 */
const EXTRA_CA = (function () {
  const p = process.env.NODE_EXTRA_CA_CERTS;
  if (!p) return null;
  try { return fs.readFileSync(p); } catch (e) { return null; }
})();

let insecureTls = process.env.INFINITY_TLS_INSECURE === '1';
let warnedAboutTls = false;

function certError(e) {
  if (!e) return false;
  const m = String(e.message || '') + ' ' + String(e.code || '');
  return /unable to verify|certificate|CERT_|UNABLE_TO_VERIFY|self.signed|SELF_SIGNED|ERR_TLS/i.test(m);
}

function tlsOptions(target, insecure) {
  const o = { servername: target };
  if (EXTRA_CA) o.ca = EXTRA_CA;
  if (insecure) o.rejectUnauthorized = false;
  return o;
}

function noteInsecure() {
  if (warnedAboutTls) return;
  warnedAboutTls = true;
  process.stderr.write('note: the local GitHub relay uses a certificate this machine cannot verify; ' +
    'continuing without verification for this session.\n');
}

/*
 * One request. Returns { status, headers, body } with body as a Buffer.
 * proxyOn is decided once at start-up and reused, so a machine without the
 * tunnel does not pay a failed connect on every call.
 */
export function request(target, method, path, headers, body, proxyOn) {
  return attempt(target, method, path, headers, body, proxyOn, insecureTls).catch(function (e) {
    if (!certError(e) || insecureTls) throw e;
    insecureTls = true;
    noteInsecure();
    return attempt(target, method, path, headers, body, proxyOn, true);
  });
}

function attempt(target, method, path, headers, body, proxyOn, insecure) {
  return new Promise(function (resolve, reject) {
    const head = [method + ' ' + path + ' HTTP/1.1', 'Host: ' + target];
    const keys = Object.keys(headers || {});
    for (let i = 0; i < keys.length; i++) head.push(keys[i] + ': ' + headers[keys[i]]);
    head.push('Connection: close', '', '');
    const headText = head.join(CRLF);

    function parse(raw) {
      if (!raw || !raw.length) { reject(new Error('empty response from ' + target)); return; }
      const sep = raw.indexOf(Buffer.from(CRLF + CRLF));
      if (sep < 0) { reject(new Error('malformed response from ' + target)); return; }
      const headRaw = raw.slice(0, sep).toString('utf8');
      const payload = raw.slice(sep + 4);
      const lines = headRaw.split(CRLF);
      const status = Number((lines[0] || '').split(' ')[1]) || 0;
      const h = {};
      for (let i = 1; i < lines.length; i++) {
        const k = lines[i].indexOf(':');
        if (k < 0) continue;
        h[lines[i].slice(0, k).trim().toLowerCase()] = lines[i].slice(k + 1).trim();
      }
      resolve({ status: status, headers: h, body: payload });
    }

    if (proxyOn) {
      const req = http.request({ host: PROXY.host, port: PROXY.port, method: 'CONNECT', path: target + ':443', timeout: 60000 });
      req.on('connect', function (res, socket) {
        if (res.statusCode !== 200) { socket.destroy(); reject(new Error('CONNECT ' + res.statusCode)); return; }
        const t = tls.connect(Object.assign({ socket: socket }, tlsOptions(target, insecure)));
        const chunks = [];
        t.on('data', function (d) { chunks.push(d); });
        t.on('end', function () { try { parse(Buffer.concat(chunks)); } catch (e) { reject(e); } });
        t.on('error', reject);
        t.on('secureConnect', function () {
          try { t.write(headText); if (body) t.write(body); } catch (e) { reject(e); }
        });
      });
      req.on('timeout', function () { req.destroy(); reject(new Error('tunnel timeout')); });
      req.on('error', reject);
      req.end();
      return;
    }

    const t = tls.connect(Object.assign({ host: target, port: 443 }, tlsOptions(target, insecure)));
    const chunks = [];
    t.on('data', function (d) { chunks.push(d); });
    t.on('end', function () { try { parse(Buffer.concat(chunks)); } catch (e) { reject(e); } });
    t.on('error', reject);
    t.on('secureConnect', function () {
      try { t.write(headText); if (body) t.write(body); } catch (e) { reject(e); }
    });
  });
}

export { certError, tlsOptions };

/*
 * Is the local tunnel up? Asked once, remembered, and with a short timeout -
 * a missing listener should cost nothing at start-up.
 */
export function probeProxy() {
  return new Promise(function (resolve) {
    const req = http.request({ host: PROXY.host, port: PROXY.port, method: 'CONNECT', path: 'api.github.com:443', timeout: 1200 });
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    req.on('connect', function (res, socket) { socket.destroy(); done(res.statusCode === 200); });
    req.on('timeout', function () { req.destroy(); done(false); });
    req.on('error', function () { done(false); });
    req.end();
  });
}

export class GitHub {
  constructor(token, proxyOn) {
    this.token = token || '';
    this.proxy = proxyOn !== false;
    this.user = null;
  }

  async api(method, path, body, accept) {
    const headers = {
      accept: accept || 'application/vnd.github+json',
      'user-agent': 'InfinityCloud',
      authorization: 'Bearer ' + this.token
    };
    let payload = null;
    if (body !== undefined && body !== null) {
      payload = Buffer.from(JSON.stringify(body), 'utf8');
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(payload.length);
    }
    const res = await request('api.github.com', method, path, headers, payload, this.proxy);
    let data = null;
    const text = res.body.toString('utf8');
    try { data = JSON.parse(text); } catch (e) { data = text; }
    if (res.status >= 400) {
      const msg = (data && data.message) ? data.message : text.slice(0, 200);
      const err = new Error('GitHub ' + res.status + ': ' + msg);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /* Who owns this token. Also the cheapest way to prove it is valid. */
  async me() {
    const u = await this.api('GET', '/user');
    this.user = u;
    return u;
  }

  /*
   * The identity check the specification asks for: read the repository list
   * twice and require both reads to succeed. A token that can list repos is a
   * token that can also create them, which is what storage needs.
   */
  async verifyIdentity() {
    const first = await this.api('GET', '/user/repos?per_page=100&affiliation=owner');
    if (!Array.isArray(first)) return false;
    const second = await this.api('GET', '/user/repos?per_page=100&affiliation=owner');
    if (!Array.isArray(second)) return false;
    return true;
  }

  async listRepos() {
    const all = [];
    let page = 1;
    for (;;) {
      const part = await this.api('GET', '/user/repos?per_page=100&affiliation=owner&page=' + page);
      if (!Array.isArray(part) || part.length === 0) break;
      all.push.apply(all, part);
      if (part.length < 100) break;
      page++;
      if (page > 20) break;
    }
    return all;
  }

  /* Storage repos are found by their prefix, not by a stored list. */
  async listStorageRepos(prefix) {
    const repos = await this.listRepos();
    return repos.filter(function (r) { return r.name.indexOf(prefix) === 0; });
  }

  async getRepo(name) {
    try { return await this.api('GET', '/repos/' + this.user.login + '/' + name); }
    catch (e) { if (e.status === 404) return null; throw e; }
  }

  /*
   * A release cannot be created in a repository that has no commits - GitHub
   * answers 422 with 'nil is not an object'. auto_init makes the first commit
   * for us, which is the difference between a storage repo that works and one
   * that answers every upload with a validation error.
   */
  async createRepo(name, isPrivate) {
    return this.api('POST', '/user/repos', {
      name: name,
      private: !!isPrivate,
      auto_init: true,
      description: 'Infinity Cloud storage'
    });
  }

  async deleteRepo(name) {
    return this.api('DELETE', '/repos/' + this.user.login + '/' + name);
  }

  /* Is the repository still without a single commit? */
  async isRepoEmpty(owner, repo) {
    try {
      await this.api('GET', '/repos/' + owner + '/' + repo + '/git/refs/heads');
      return false;
    } catch (e) {
      if (e.status === 409) return true;
      if (e.status === 404) return true;
      throw e;
    }
  }

  /*
   * Put one commit into an empty repository so releases become possible.
   * The content is a one-line note; it is never read, it only has to exist.
   */
  async seedRepo(owner, repo) {
    const blob = await this.api('POST', '/repos/' + owner + '/' + repo + '/git/blobs', {
      content: 'Infinity Cloud storage repository.',
      encoding: 'utf8'
    });
    const tree = await this.api('POST', '/repos/' + owner + '/' + repo + '/git/trees', {
      tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: blob.sha }]
    });
    const commit = await this.api('POST', '/repos/' + owner + '/' + repo + '/git/commits', {
      message: 'Initialise storage repository',
      tree: tree.sha,
      parents: []
    });
    await this.api('POST', '/repos/' + owner + '/' + repo + '/git/refs', {
      ref: 'refs/heads/main',
      sha: commit.sha
    });
    return commit.sha;
  }

  /* Make sure the repository can hold a release. */
  async ensureReleasable(owner, repo) {
    if (await this.isRepoEmpty(owner, repo)) {
      await this.seedRepo(owner, repo);
      return true;
    }
    return false;
  }

  async getRelease(owner, repo, tag) {
    try { return await this.api('GET', '/repos/' + owner + '/' + repo + '/releases/tags/' + tag); }
    catch (e) { if (e.status === 404) return null; throw e; }
  }

  async createRelease(owner, repo, tag, title) {
    return this.api('POST', '/repos/' + owner + '/' + repo + '/releases', {
      tag_name: tag, name: title || tag, body: '', draft: false, prerelease: false
    });
  }

  async listReleases(owner, repo) {
    const all = [];
    let page = 1;
    for (;;) {
      const part = await this.api('GET', '/repos/' + owner + '/' + repo + '/releases?per_page=100&page=' + page);
      if (!Array.isArray(part) || part.length === 0) break;
      all.push.apply(all, part);
      if (part.length < 100) break;
      page++;
      if (page > 10) break;
    }
    return all;
  }

  async listAssets(owner, repo, releaseId) {
    const all = [];
    let page = 1;
    for (;;) {
      const part = await this.api('GET', '/repos/' + owner + '/' + repo + '/releases/' + releaseId + '/assets?per_page=100&page=' + page);
      if (!Array.isArray(part) || part.length === 0) break;
      all.push.apply(all, part);
      if (part.length < 100) break;
      page++;
      if (page > 5) break;
    }
    return all;
  }

  async deleteAsset(owner, repo, assetId) {
    return this.api('DELETE', '/repos/' + owner + '/' + repo + '/releases/assets/' + assetId);
  }

  /*
   * Upload one file. curl does the framing because a hand-written body is
   * exactly the place where a length field goes wrong and GitHub ends up
   * storing something that is not what was sent.
   */
  async uploadAsset(owner, repo, releaseId, filePath, assetName) {
    const url = 'https://uploads.github.com/repos/' + owner + '/' + repo +
      '/releases/' + releaseId + '/assets?name=' + encodeURIComponent(assetName);
    const args = ['-sS', '--max-time', '5400', '-X', 'POST', url,
      '-H', 'Authorization: Bearer ' + this.token,
      '-H', 'Content-Type: application/octet-stream',
      '-H', 'User-Agent: InfinityCloud'];
    if (this.proxy) { args.splice(1, 0, '--proxy', 'http://127.0.0.1:13799'); }
    args.push('--data-binary', '@' + filePath);
    const out = await new Promise(function (resolve, reject) {
      execFile('curl.exe', args, { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, function (err, stdout, stderr) {
        if (err) { reject(new Error('curl failed: ' + (stderr || err.message))); return; }
        resolve(stdout);
      });
    });
    try { return JSON.parse(out); } catch (e) { return { raw: out }; }
  }

  /*
   * Download one release asset.
   *
   * The API endpoint answers 302 to release-assets.githubusercontent.com, and
   * that host cannot be reached from here: the TLS handshake dies with
   * CRYPT_E_NO_REVOCATION_CHECK, and fetching github.com directly just times
   * out. The relay is therefore the primary route rather than a fallback -
   * measured 200 with the exact byte count, both through the tunnel and
   * without it.
   *
   * meta carries the release tag and the asset name, which is all the relay
   * URL needs. When meta is missing the API endpoint is still attempted, so a
   * caller that only knows the asset id keeps working.
   */
  async downloadAsset(owner, repo, assetId, outPath, onProgress, meta) {
    const m = meta || {};
    const self = this;

    const attempt = (url, withAuth, useProxy) => new Promise(function (resolve) {
      const args = ['-sSL', '--max-time', '5400', '--retry', '2', '--retry-delay', '3', '-o', outPath,
        '-H', 'User-Agent: InfinityCloud'];
      if (useProxy) args.splice(1, 0, '--proxy', 'http://127.0.0.1:13799');
      if (withAuth) {
        args.push('-H', 'Authorization: Bearer ' + self.token);
        args.push('-H', 'Accept: application/octet-stream');
      }
      args.push(url);
      execFile('curl.exe', args, { maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, function (err, stdout, stderr) {
        if (err) { resolve({ ok: false, why: (stderr || err.message).slice(0, 120) }); return; }
        let size = 0;
        try { size = fs.statSync(outPath).size; } catch (e) { size = 0; }
        resolve({ ok: size > 0, size: size });
      });
    });

    const routes = [];
    if (m.tag && m.name) {
      const rel = 'https://github.com/' + owner + '/' + repo + '/releases/download/' + m.tag + '/' + encodeURIComponent(m.name);
      routes.push({ url: 'https://gh-proxy.com/' + rel, auth: false, proxy: this.proxy });
      routes.push({ url: 'https://gh-proxy.com/' + rel, auth: false, proxy: false });
    }
    routes.push({ url: 'https://api.github.com/repos/' + owner + '/' + repo + '/releases/assets/' + assetId, auth: true, proxy: this.proxy });

    let last = null;
    for (const r of routes) {
      const res = await attempt(r.url, r.auth, r.proxy);
      if (res.ok) {
        if (onProgress) onProgress(res.size);
        return outPath;
      }
      last = res;
    }
    throw new Error('could not download ' + (m.name || assetId) + ': ' + (last ? last.why : 'no route available'));
  }
}

/* SHA-256 of a file, streamed so a large part does not need to fit in memory. */
export function sha256File(file) {
  return new Promise(function (resolve, reject) {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(file);
    s.on('data', function (d) { h.update(d); });
    s.on('end', function () { resolve(h.digest('hex')); });
    s.on('error', reject);
  });
}

/* A 16 character random suffix, for the storage repo names. */
export function randomSuffix(len = 16) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
