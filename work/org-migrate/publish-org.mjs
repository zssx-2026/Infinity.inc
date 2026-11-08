#!/usr/bin/env node
/**
 * publish-org.mjs - 把本工作区编译产物迁移到 GitHub 组织 Infinity 下的三个仓库。
 *
 * 设计要点
 *  1. 默认 dry-run：只读探测真实状态并打印计划表，零写入。
 *  2. 加 --apply 才真正调用写接口。
 *  3. 所有写接口前先做一次组织权限探测；无权限立刻退出码 2，绝不重试。
 *  4. 令牌只走环境变量或文件，绝不打印明文；上传走 curl -K - （令牌经 stdin 传入，
 *     不出现在进程命令行里）。
 *  5. 仓库操作一律走 REST API，不用 git 命令（本机 github.com:443 不通）。
 *
 * 用法
 *  node work/org-migrate/publish-org.mjs                     # dry-run（默认）
 *  node work/org-migrate/publish-org.mjs --offline           # dry-run，不联网
 *  node work/org-migrate/publish-org.mjs --probe-org         # 只探测组织权限
 *  node work/org-migrate/publish-org.mjs --apply             # 真正执行（不含大文件）
 *  node work/org-migrate/publish-org.mjs --apply --include-heavy
 *  node work/org-migrate/publish-org.mjs --only=studio --apply
 *  node work/org-migrate/publish-org.mjs --write-sums        # 用实测字节重算 SHA256SUMS.txt
 *
 * 退出码：0 成功 / 1 执行失败 / 2 权限阻塞 / 3 用法或环境错误
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const NL = String.fromCharCode(10);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(HERE, '..', '..');

const ORG = 'Infinity';
const REPO_STUDIO = 'Infinity-Studio';
const REPO_SERVER = 'Infinity-Server';
const REPO_RES = 'Infinity-Resources';
const TAG = 'v1.0.0-pre5';

const UA = 'infinity-org-migrate/1.0';
const API = 'https://api.github.com';
const UPLOAD_API = 'https://uploads.github.com';
const REQ_TIMEOUT_MS = 30000;
const BIG_UPLOAD_TIMEOUT_MS = 7200000;
const CONTENT_API_MAX = 50 * 1024 * 1024;
const SHA_SKIP_ABOVE = 64 * 1024 * 1024;

// ---------------------------------------------------------------- 参数

const argv = process.argv.slice(2);
const opts = {
  apply: false,
  offline: false,
  probeOrgOnly: false,
  includeHeavy: false,
  writeSums: false,
  shaAll: false,
  selfTest: false,
  tokenFile: path.join(WORKSPACE, 'temp', 'ghtoken2.txt'),
  only: null,
};

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--apply') opts.apply = true;
  else if (a === '--dry-run') opts.apply = false;
  else if (a === '--offline') opts.offline = true;
  else if (a === '--probe-org') opts.probeOrgOnly = true;
  else if (a === '--include-heavy') opts.includeHeavy = true;
  else if (a === '--write-sums') opts.writeSums = true;
  else if (a === '--sha-all') opts.shaAll = true;
  else if (a === '--self-test') opts.selfTest = true;
  else if (a.indexOf('--only=') === 0) opts.only = a.slice(7).toLowerCase();
  else if (a.indexOf('--token-file=') === 0) opts.tokenFile = a.slice(13);
  else if (a === '--help' || a === '-h') { printUsage(); process.exit(0); }
  else { console.log('未知参数: ' + a); printUsage(); process.exit(3); }
}

function printUsage() {
  console.log('用法: node work/org-migrate/publish-org.mjs [--apply] [--offline] [--probe-org]');
  console.log('                                    [--include-heavy] [--only=studio|server|resources]');
  console.log('                                    [--write-sums] [--sha-all] [--self-test] [--token-file=<路径>]');
  console.log('默认 dry-run：只读探测并打印计划表，不写任何东西。');
}

// ---------------------------------------------------------------- 输出工具

function dispWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    w += (c >= 0x1100 && (c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6))) ? 2 : 1;
  }
  return w;
}

function pad(s, w) {
  const t = String(s === undefined || s === null ? '' : s);
  const dw = dispWidth(t);
  if (dw >= w) return t;
  return t + ' '.repeat(w - dw);
}

function padL(s, w) {
  const t = String(s === undefined || s === null ? '' : s);
  const dw = dispWidth(t);
  if (dw >= w) return t;
  return ' '.repeat(w - dw) + t;
}

function fmtBytes(n) {
  if (n === undefined || n === null) return '-';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function rel(p) {
  const r = path.relative(WORKSPACE, p);
  return r.split(path.sep).join('/');
}

function maskToken(t) {
  if (!t) return '(空)';
  if (t.length <= 16) return '****';
  return t.slice(0, 11) + '****' + t.slice(-4) + ' (len=' + t.length + ')';
}

function fail(label, res) {
  const body = String(res && res.text !== undefined ? res.text : '').replace(/\r?\n/g, ' ').slice(0, 300);
  console.log('  [FAIL] ' + label + '  HTTP ' + (res ? res.status : '?') + '  ' + body);
}

// ---------------------------------------------------------------- 令牌

function loadToken() {
  const envTok = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  if (envTok) return { token: envTok.trim(), source: 'env GH_TOKEN' };
  if (fs.existsSync(opts.tokenFile)) {
    const t = fs.readFileSync(opts.tokenFile, 'utf8').trim();
    if (t) return { token: t, source: 'file ' + rel(opts.tokenFile) };
  }
  return { token: '', source: '(未找到)' };
}

const tokInfo = loadToken();
const TOKEN = tokInfo.token;

// ---------------------------------------------------------------- HTTP 核心

async function gh(method, apiPath, body) {
  const url = API + apiPath;
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: 'Bearer ' + TOKEN,
    'user-agent': UA,
    'x-github-api-version': '2022-11-28',
  };
  let payload = null;
  if (body !== undefined && body !== null) {
    payload = Buffer.from(JSON.stringify(body), 'utf8');
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(payload.length);
  }
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { method, headers, body: payload, signal: AbortSignal.timeout(REQ_TIMEOUT_MS) });
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch (e) { data = text; }
      return { status: res.status, data, text, url };
    } catch (e) {
      lastErr = e;
      if (attempt === 0 && method === 'GET') continue;
      break;
    }
  }
  return { status: 0, data: null, text: 'NETWORK ERROR: ' + String(lastErr && lastErr.message || lastErr), url };
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// ---------------------------------------------------------------- 组织权限探测

async function probeOrgPermission() {
  const report = { ok: false, reason: '', checks: [], status: {} };

  const who = await gh('GET', '/user');
  report.checks.push({ name: 'GET /user', status: who.status, note: who.data && who.data.login ? ('账号 ' + who.data.login) : '未知' });
  report.status.user = who.status;
  if (who.status !== 200) {
    report.reason = '令牌无效或网络不可达（GET /user = ' + who.status + '）';
    return report;
  }

  const org = await gh('GET', '/orgs/' + ORG);
  report.status.org = org.status;
  report.checks.push({ name: 'GET /orgs/' + ORG, status: org.status, note: org.status === 200 ? '组织存在' : '组织不可见' });

  const mem = await gh('GET', '/user/memberships/orgs');
  report.status.memberships = mem.status;
  const isMember = Array.isArray(mem.data) && mem.data.some(function (m) { return m.organization && m.organization.login === ORG; });
  report.checks.push({ name: 'GET /user/memberships/orgs', status: mem.status, note: isMember ? '当前账号是 ' + ORG + ' 成员' : '当前账号不是 ' + ORG + ' 成员' });
  report.isMember = isMember;

  // 写权限试探：空 body 的 POST。若无 admin 权限 -> 403；若有权限 -> 400/422（缺 name），不会真的建库。
  const probe = await gh('POST', '/orgs/' + ORG + '/repos', {});
  report.status.createProbe = probe.status;
  const msg = probe.data && probe.data.message ? String(probe.data.message) : '';
  let probeNote = '';
  if (probe.status === 403) probeNote = '无组织建库权限：' + msg;
  else if (probe.status === 400 || probe.status === 422) probeNote = '有建库权限（空 body 校验失败，符合预期）';
  else if (probe.status === 201 || probe.status === 200) probeNote = '异常：空 body 竟然创建成功，请人工检查';
  else probeNote = '未预期状态：' + msg;
  report.checks.push({ name: 'POST /orgs/' + ORG + '/repos (空 body 试探)', status: probe.status, note: probeNote });
  report.probeMessage = msg;
  report.ok = probe.status === 400 || probe.status === 422;

  if (!report.ok) {
    if (probe.status === 403) report.reason = '当前令牌账号对组织 ' + ORG + ' 没有 admin 权限，无法创建组织仓库（HTTP 403）';
    else report.reason = '组织建库试探返回 HTTP ' + probe.status + '，无法确认写权限';
  }
  return report;
}

// ---------------------------------------------------------------- 清单

function abs(relPath) { return path.join(WORKSPACE, relPath.split('/').join(path.sep)); }

function buildManifest() {
  const repos = [
    { repo: REPO_STUDIO, private: false, description: 'Infinity Studio / Infinity Server 编译产物分发（仅编译包，不含源码）', group: 'studio' },
    { repo: REPO_SERVER, private: false, description: 'Infinity Server 服务端编译产物（仅编译包，不含源码）', group: 'server' },
    { repo: REPO_RES, private: true, description: 'Infinity Resources：大体积安装包与运行时（私有）', group: 'resources' },
  ];

  const releases = repos.map(function (r) {
    return { repo: r.repo, tag: TAG, name: 'Infinity ' + TAG, body: 'Infinity 产品线 ' + TAG + ' 编译产物。公开仓库仅放编译包，不含源码。', prerelease: true, group: r.group };
  });

  const assets = [
    // ---- Infinity-Studio（公开）：三个安装器 + 清单文件
    { repo: REPO_STUDIO, file: 'cpp/release/v1.0pre5/InfinityCloud_1.0.0-pre5_win64_setup.exe', name: 'InfinityCloud_1.0.0-pre5_win64_setup.exe', group: 'studio', heavy: false },
    { repo: REPO_STUDIO, file: 'cpp/release/v1.0pre5/InfinityPackageManager_1.0.0-pre5_win64_setup.exe', name: 'InfinityPackageManager_1.0.0-pre5_win64_setup.exe', group: 'studio', heavy: false },
    { repo: REPO_STUDIO, file: 'cpp/release/v1.0pre5/InfinityToolbox_1.0.0-pre5_win64_setup.exe', name: 'InfinityToolbox_1.0.0-pre5_win64_setup.exe', group: 'studio', heavy: false },
    { repo: REPO_STUDIO, file: 'cpp/release/v1.0pre5/name.txt', name: 'name.txt', group: 'studio', heavy: false },
    { repo: REPO_STUDIO, file: 'cpp/release/v1.0pre5/release-assets.json', name: 'release-assets.json', group: 'studio', heavy: false },
    { repo: REPO_STUDIO, file: 'cpp/release/v1.0pre5/SHA256SUMS.txt', name: 'SHA256SUMS.txt', group: 'studio', heavy: false },
    // ---- Infinity-Studio（公开）：大件，默认不传
    { repo: REPO_STUDIO, file: 'InfinityStudio/build/win-x64/infinitystudio_gui.exe', name: 'infinitystudio_gui.exe', group: 'studio', heavy: true },
    // ---- Infinity-Server（公开）
    { repo: REPO_SERVER, file: 'InfinityServer/build/win-x64/infinityserver_gui.exe', name: 'infinityserver_gui.exe', group: 'server', heavy: true },
    // ---- Infinity-Resources（私有）：大体积安装包 / 运行时
    { repo: REPO_RES, file: 'dist/ipm.exe', name: 'ipm.exe', group: 'resources', heavy: true },
    { repo: REPO_RES, file: 'dist/aria2c.exe', name: 'aria2c.exe', group: 'resources', heavy: false },
    { repo: REPO_RES, file: 'Infinity Cloud/release/InfinityCloud.exe', name: 'InfinityCloud.exe', group: 'resources', heavy: true },
  ];

  const contents = [
    { repo: REPO_STUDIO, file: 'installers/packaging/v1.0pre5/release-assets.json', path: 'release-assets.json', group: 'studio', heavy: false },
    { repo: REPO_STUDIO, file: 'installers/packaging/v1.0pre5/SHA256SUMS.txt', path: 'SHA256SUMS.txt', group: 'studio', heavy: false },
    { repo: REPO_STUDIO, file: 'installers/packaging/v1.0pre5/icons/inc.ico', path: 'icons/inc.ico', group: 'studio', heavy: false },
    { repo: REPO_STUDIO, file: 'installers/packaging/v1.0pre5/icons/ipm.ico', path: 'icons/ipm.ico', group: 'studio', heavy: false },
  ];

  const keep = function (g) { return !opts.only || g === opts.only; };
  return {
    repos: repos.filter(function (r) { return keep(r.group); }),
    releases: releases.filter(function (r) { return keep(r.group); }),
    assets: assets.filter(function (a) { return keep(a.group); }),
    contents: contents.filter(function (c) { return keep(c.group); }),
  };
}

// ---------------------------------------------------------------- 动作实现

async function ensureRepo(r, apply, owner) {
  const o = owner || ORG;
  const res = await gh('GET', '/repos/' + o + '/' + r.repo);
  if (res.status === 200) {
    const isPrivate = res.data && res.data.private;
    return { status: res.status, existed: true, note: '已存在（' + (isPrivate ? '私有' : '公开') + '）', ok: true };
  }
  if (res.status !== 404) {
    return { status: res.status, existed: false, ok: false, note: 'GET 失败：' + String(res.text).slice(0, 200) };
  }
  if (!apply) return { status: 404, existed: false, ok: true, note: '不存在 → 将创建（' + (r.private ? '私有' : '公开') + '）' };

  const c = owner
    ? await gh('POST', '/user/repos', {
        name: r.repo, private: r.private, description: r.description,
        auto_init: true, has_issues: true, has_wiki: false, has_projects: false,
      })
    : await gh('POST', '/orgs/' + ORG + '/repos', {
        name: r.repo, private: r.private, description: r.description,
        auto_init: true, has_issues: true, has_wiki: false, has_projects: false,
      });
  if (c.status !== 201) {
    return { status: c.status, existed: false, ok: false, note: '创建失败：' + String(c.text).slice(0, 300) };
  }
  return { status: c.status, existed: false, ok: true, note: '已创建 ' + (c.data && c.data.full_name) };
}

async function ensureRelease(r, apply, owner) {
  const o = owner || ORG;
  const res = await gh('GET', '/repos/' + o + '/' + r.repo + '/releases/tags/' + encodeURIComponent(r.tag));
  if (res.status === 200 && res.data && res.data.id) {
    return { status: 200, existed: true, ok: true, id: res.data.id, note: '已存在 id=' + res.data.id };
  }
  if (res.status !== 404) {
    return { status: res.status, existed: false, ok: false, note: 'GET 失败：' + String(res.text).slice(0, 200) };
  }
  if (!apply) return { status: 404, existed: false, ok: true, note: '不存在 → 将创建 tag ' + r.tag };

  const c = await gh('POST', '/repos/' + o + '/' + r.repo + '/releases', {
    tag_name: r.tag,
    name: r.name,
    body: r.body,
    draft: false,
    prerelease: r.prerelease,
  });
  if (c.status !== 201) return { status: c.status, existed: false, ok: false, note: '创建失败：' + String(c.text).slice(0, 300) };
  return { status: c.status, existed: false, ok: true, id: c.data.id, note: '已创建 id=' + c.data.id };
}

function curlUpload(file, url, contentType) {
  const size = fs.statSync(file).size;
  const cfg = [
    'header = "Authorization: Bearer ' + TOKEN + '"',
    'header = "Accept: application/vnd.github+json"',
    'header = "Content-Type: ' + contentType + '"',
    'header = "Content-Length: ' + size + '"',
    'header = "User-Agent: ' + UA + '"',
    'silent',
    'show-error',
    'max-time = ' + Math.floor(BIG_UPLOAD_TIMEOUT_MS / 1000),
    'write-out = "__HTTP__%{http_code}"',
  ].join(NL);

  const args = ['-K', '-', '--url', url, '--data-binary', '@' + file.split(path.sep).join('/')];
  const r = spawnSync('curl.exe', args, {
    input: cfg,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    timeout: BIG_UPLOAD_TIMEOUT_MS + 60000,
  });
  if (r.error) return { status: 0, text: 'curl 启动失败: ' + r.error.message };
  let out = r.stdout || '';
  const idx = out.lastIndexOf('__HTTP__');
  let status = 0;
  let body = out;
  if (idx >= 0) {
    status = Number(out.slice(idx + 8).trim()) || 0;
    body = out.slice(0, idx);
  }
  if (status === 0 && r.stderr) body = body + ' | stderr: ' + r.stderr;
  return { status, text: body, stderr: r.stderr || '' };
}

async function nodeUpload(file, url, contentType) {
  const https = await import('node:https');
  const size = fs.statSync(file).size;
  const u = new URL(url);
  return await new Promise(function (resolve) {
    const req = https.request({
      host: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + TOKEN,
        accept: 'application/vnd.github+json',
        'content-type': contentType,
        'content-length': String(size),
        'user-agent': UA,
      },
    }, function (res) {
      const chunks = [];
      res.on('data', function (d) { chunks.push(d); });
      res.on('end', function () { resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString('utf8') }); });
    });
    req.on('error', function (e) { resolve({ status: 0, text: 'network: ' + e.message }); });
    req.setTimeout(BIG_UPLOAD_TIMEOUT_MS, function () { req.destroy(); resolve({ status: 0, text: 'timeout' }); });
    fs.createReadStream(file).pipe(req);
  });
}

async function uploadAsset(repo, tag, asset, apply, owner) {
  const o = owner || ORG;
  const local = abs(asset.file);
  if (!fs.existsSync(local)) return { ok: false, status: 0, note: '本地文件缺失' };
  const size = fs.statSync(local).size;
  const relRes = await gh('GET', '/repos/' + o + '/' + repo + '/releases/tags/' + encodeURIComponent(tag));
  if (relRes.status !== 200) return { ok: false, status: relRes.status, note: '取 release 失败' };
  const rel = relRes.data;

  const listRes = await gh('GET', '/repos/' + o + '/' + repo + '/releases/' + rel.id + '/assets?per_page=100');
  const list = Array.isArray(listRes.data) ? listRes.data : [];
  const old = list.find(function (x) { return x.name === asset.name; });

  if (!apply) {
    if (old) {
      const same = old.size === size;
      return { ok: true, status: listRes.status, note: '同名资产已存在（' + fmtBytes(old.size) + (same ? '，大小相同→将重传' : '，大小不同→将重传') + '）' };
    }
    return { ok: true, status: 404, note: '待上传（' + fmtBytes(size) + '）' };
  }

  if (old) {
    const d = await gh('DELETE', '/repos/' + o + '/' + repo + '/releases/assets/' + old.id);
    if (d.status !== 204) return { ok: false, status: d.status, note: '删除旧资产失败：' + String(d.text).slice(0, 300) };
  }

  const url = UPLOAD_API + '/repos/' + o + '/' + repo + '/releases/' + rel.id + '/assets?name=' + encodeURIComponent(asset.name);
  let up = curlUpload(local, url, 'application/octet-stream');
  if (up.status === 0) up = await nodeUpload(local, url, 'application/octet-stream');

  if (up.status !== 201) {
    return { ok: false, status: up.status, note: '上传失败：' + String(up.text).slice(0, 300) };
  }
  let j = null;
  try { j = JSON.parse(up.text); } catch (e) { j = null; }
  if (!j || !j.id) return { ok: false, status: 201, note: '响应非 JSON：' + String(up.text).slice(0, 300) };
  if (j.size !== size) return { ok: false, status: 201, note: '字节数不符 本地=' + size + ' 远端=' + j.size };
  return { ok: true, status: 201, note: '已上传 id=' + j.id + ' 远端 ' + fmtBytes(j.size) };
}

async function putFile(repo, item, apply, owner) {
  const o = owner || ORG;
  const local = abs(item.file);
  if (!fs.existsSync(local)) return { ok: false, status: 0, note: '本地文件缺失' };
  const buf = fs.readFileSync(local);
  if (buf.length > CONTENT_API_MAX) {
    return { ok: false, status: 0, note: '超过 Contents API 50MB 限制，改用 release 资产' };
  }
  const apiPath = '/repos/' + o + '/' + repo + '/contents/' + item.path.split('/').map(encodeURIComponent).join('/');
  const cur = await gh('GET', apiPath);

  let sha = null;
  if (cur.status === 200 && cur.data && cur.data.sha) sha = cur.data.sha;
  else if (cur.status !== 404) return { ok: false, status: cur.status, note: 'GET contents 失败：' + String(cur.text).slice(0, 200) };

  if (!apply) {
    return { ok: true, status: cur.status, note: sha ? '已存在 sha=' + String(sha).slice(0, 10) + ' → 将更新' : '待写入（' + fmtBytes(buf.length) + '）' };
  }

  const body = {
    message: 'chore(release): sync ' + item.path + ' for ' + TAG,
    content: buf.toString('base64'),
    branch: 'main',
  };
  if (sha) body.sha = sha;

  let res = await gh('PUT', apiPath, body);
  if (res.status === 422 && sha) {
    // 目标分支可能不是 main，回退到默认分支重试一次
    const repoInfo = await gh('GET', '/repos/' + o + '/' + repo);
    const def = repoInfo.data && repoInfo.data.default_branch ? repoInfo.data.default_branch : 'main';
    if (def !== 'main') { body.branch = def; res = await gh('PUT', apiPath, body); }
  }
  if (res.status !== 200 && res.status !== 201) {
    return { ok: false, status: res.status, note: '写入失败：' + String(res.text).slice(0, 300) };
  }
  const commitSha = res.data && res.data.commit ? res.data.commit.sha : '';
  return { ok: true, status: res.status, note: '已写入 commit ' + String(commitSha).slice(0, 10) };
}

// ---------------------------------------------------------------- SHA256 审计

function sha256File(p) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(p, 'r');
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  try {
    let n;
    while ((n = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) h.update(chunk.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

function readRecordedSums() {
  const map = new Map();
  const p = abs('cpp/release/v1.0pre5/SHA256SUMS.txt');
  if (!fs.existsSync(p)) return map;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
    if (m) map.set(m[2].trim(), m[1]);
  }
  return map;
}

function auditSums(items) {
  const recorded = readRecordedSums();
  const rows = [];
  for (const it of items) {
    const p = abs(it.file);
    if (!fs.existsSync(p)) continue;
    const size = fs.statSync(p).size;
    if (!opts.shaAll && size > SHA_SKIP_ABOVE) { rows.push({ file: it.file, size: size, actual: '(跳过)', recorded: '-', state: '跳过' }); continue; }
    const actual = sha256File(p);
    const base = path.basename(it.file);
    const rec = recorded.get(base) || null;
    let state = '无记录';
    if (rec) state = (rec === actual ? '一致' : '不一致');
    rows.push({ file: it.file, size: size, actual: actual, recorded: rec, state: state });
  }
  return rows;
}

function writeSums(items) {
  const dir = path.join(HERE, 'out');
  fs.mkdirSync(dir, { recursive: true });
  const lines = [];
  for (const it of items) {
    const p = abs(it.file);
    if (!fs.existsSync(p)) continue;
    const size = fs.statSync(p).size;
    if (!opts.shaAll && size > SHA_SKIP_ABOVE) continue;
    lines.push(sha256File(p) + '  ' + path.basename(it.file));
  }
  const target = path.join(dir, 'SHA256SUMS.txt');
  fs.writeFileSync(target, lines.join(NL) + NL, 'utf8');
  console.log('已用实测字节重算校验和: ' + rel(target) + '  (' + lines.length + ' 行)');
  return target;
}

// ---------------------------------------------------------------- 主流程

const T0 = Date.now();

console.log('==============================================================');
console.log(' Infinity 组织迁移工具 publish-org.mjs');
console.log('==============================================================');
console.log('工作区   : ' + WORKSPACE);
console.log('模式     : ' + (opts.apply ? 'APPLY（会真正写远端）' : 'DRY-RUN（只读探测，零写入）') + (opts.offline ? ' + OFFLINE' : ''));
console.log('目标组织 : ' + ORG + '   目标 tag: ' + TAG);
console.log('令牌     : ' + (TOKEN ? maskToken(TOKEN) + '  来源: ' + tokInfo.source : '(缺失)'));
if (opts.only) console.log('仅限分组 : ' + opts.only);
if (opts.includeHeavy) console.log('大文件   : 已允许上传');
console.log('');

if (!TOKEN) {
  console.log('[阻塞] 未找到 GitHub 令牌。');
  console.log('       期望位置: ' + rel(opts.tokenFile));
  console.log('       或设置环境变量 GH_TOKEN / GITHUB_TOKEN。');
  process.exit(3);
}

const manifest = buildManifest();
const heavyCount = manifest.assets.filter(function (a) { return a.heavy; }).length;

// 组织权限探测（--offline 跳过）
let perm = { ok: true, skipped: true, checks: [], reason: '' };
if (!opts.offline) {
  perm = await probeOrgPermission();
  console.log('--- 组织权限探测 ---');
  for (const c of perm.checks) {
    console.log('  ' + pad(c.name, 44) + ' HTTP ' + padL(c.status, 4) + '  ' + c.note);
  }
  console.log('');
}

const BLOCKED = !opts.offline && !perm.ok;

if (opts.probeOrgOnly) {
  if (perm.ok) { console.log('[OK] 组织写权限可用。'); process.exit(0); }
  printBlocked(perm);
  process.exit(2);
}

function printBlocked(p) {
  console.log('--------------------------------------------------------------');
  console.log('[阻塞] 无法在组织 ' + ORG + ' 下创建仓库，迁移写操作全部无法执行。');
  console.log('--------------------------------------------------------------');
  console.log('原因  : ' + p.reason);
  if (p.probeMessage) console.log('GitHub: ' + p.probeMessage);
  console.log('');
  console.log('需要你做的事（二选一）：');
  console.log('  A. 在 https://github.com/orgs/' + ORG + '/people 把账号 zssx-2026 邀请为成员，');
  console.log('     角色设为 Owner（组织仓库创建必须 admin）。接受邀请后重跑本脚本。');
  console.log('  B. 手工在组织下建好三个仓库（' + REPO_STUDIO + ' 公开、' + REPO_SERVER + ' 公开、' + REPO_RES + ' 私有），');
  console.log('     再把令牌账号加为这三个仓库的 admin，然后重跑。');
  console.log('');
  console.log('本脚本不会重试写操作，也不会降级到个人账号建库。');
  console.log('');
}

// 计划表
const W = { idx: 4, act: 10, repo: 28, target: 50, local: 50, size: 10 };
const GAP = '  ';
const TOTAL_W = W.idx + W.act + W.repo + W.target + W.local + W.size + GAP.length * 5 + 8;
const HEAD = padL('序', W.idx) + GAP + pad('动作', W.act) + GAP + pad('仓库', W.repo) + GAP +
  pad('目标', W.target) + GAP + pad('本地文件', W.local) + GAP + pad('大小', W.size) + GAP + '现状';
const SEP = '-'.repeat(TOTAL_W);
console.log('--- 迁移计划（' + (opts.apply ? 'APPLY' : 'DRY-RUN') + '）---');
console.log(HEAD);
console.log(SEP);

const rows = [];
let idx = 0;

function emitRow(act, repo, target, local, size, state) {
  idx++;
  const line = padL(idx, W.idx) + GAP + pad(act, W.act) + GAP + pad(repo, W.repo) + GAP +
    pad(target, W.target) + GAP + pad(local, W.local) + GAP + pad(size, W.size) + GAP + state;
  console.log(line);
  rows.push({ idx: idx, act: act, repo: repo, target: target, local: local, size: size, state: state });
}

const results = [];
const repoState = new Map();

// 1) 仓库
for (const r of manifest.repos) {
  let st = { ok: true, status: 0, note: '未检查（offline）' };
  if (BLOCKED) st = { ok: true, status: 403, note: '阻塞：无组织建库权限，未发起请求' };
  else if (!opts.offline) st = await ensureRepo(r, opts.apply);
  repoState.set(r.repo, st);
  results.push({ kind: 'repo', item: r, res: st });
  emitRow('建仓库', ORG + '/' + r.repo, r.repo + (r.private ? ' [private]' : ' [public]'), '-', '-', 'HTTP ' + (st.status || '-') + ' ' + st.note);
}

// 2) Release（仓库不存在时不再深入探测）
for (const r of manifest.releases) {
  const rs = repoState.get(r.repo);
  let st = { ok: true, status: 0, note: '未检查（offline）' };
  if (BLOCKED) st = { ok: true, status: 403, note: '阻塞：无组织建库权限，未发起请求' };
  else if (!opts.offline && rs && rs.ok && (rs.existed || opts.apply)) st = await ensureRelease(r, opts.apply);
  else if (!opts.offline && rs && !rs.existed && !opts.apply) st = { ok: true, status: 404, note: '仓库不存在，跳过探测' };
  results.push({ kind: 'release', item: r, res: st });
  emitRow('建Release', ORG + '/' + r.repo, r.tag, '-', '-', 'HTTP ' + (st.status || '-') + ' ' + st.note);
}

// 3) Release 资产
for (const a of manifest.assets) {
  const local = abs(a.file);
  const exists = fs.existsSync(local);
  const size = exists ? fs.statSync(local).size : 0;
  let st;
  const rs = repoState.get(a.repo);
  const skipHeavy = a.heavy && !opts.includeHeavy;
  if (!exists) st = { ok: false, status: 0, note: '本地文件缺失' };
  else if (skipHeavy) st = { ok: true, status: 0, note: '大文件：需 --include-heavy，本次跳过' };
  else if (opts.offline) st = { ok: true, status: 0, note: '未检查（offline）' };
  else if (BLOCKED) st = { ok: true, status: 403, note: '阻塞：无组织建库权限，未发起请求' };
  else if (rs && !rs.ok) st = { ok: false, status: rs.status, note: '仓库不可用，跳过' };
  else if (rs && !rs.existed && !opts.apply) st = { ok: true, status: 404, note: '仓库不存在，待建后上传' };
  else st = await uploadAsset(a.repo, TAG, a, opts.apply);
  results.push({ kind: 'asset', item: a, res: st });
  emitRow('传资产', ORG + '/' + a.repo, a.name, a.file, exists ? fmtBytes(size) : '缺失', 'HTTP ' + (st.status || '-') + ' ' + st.note);
}

// 4) Contents
for (const c of manifest.contents) {
  const local = abs(c.file);
  const exists = fs.existsSync(local);
  const size = exists ? fs.statSync(local).size : 0;
  let st;
  const rs = repoState.get(c.repo);
  if (!exists) st = { ok: false, status: 0, note: '本地文件缺失' };
  else if (opts.offline) st = { ok: true, status: 0, note: '未检查（offline）' };
  else if (BLOCKED) st = { ok: true, status: 403, note: '阻塞：无组织建库权限，未发起请求' };
  else if (rs && !rs.ok) st = { ok: false, status: rs.status, note: '仓库不可用，跳过' };
  else if (rs && !rs.existed && !opts.apply) st = { ok: true, status: 404, note: '仓库不存在，待建后写入' };
  else st = await putFile(c.repo, c, opts.apply);
  results.push({ kind: 'content', item: c, res: st });
  emitRow('写文件', ORG + '/' + c.repo, c.path, c.file, exists ? fmtBytes(size) : '缺失', 'HTTP ' + (st.status || '-') + ' ' + st.note);
}

console.log(SEP);

// 4.5) 自检：验证 uploadAsset / putFile 两条写入链路（只写个人仓库，不碰组织）
if (opts.selfTest) {
  console.log('');
  console.log('--- 自检模式（--self-test）：在个人仓库 ' + (process.env.GH_SELF_USER || 'zssx-2026') + '/infinity-api-probe 上验证写入链路 ---');
  const SELF_OWNER = process.env.GH_SELF_USER || 'zssx-2026';
  const SELF_REPO = 'infinity-api-probe';
  const selfRepo = { repo: SELF_REPO, private: true, description: 'api capability probe', group: 'selftest' };

  const sr = await ensureRepo(selfRepo, opts.apply, SELF_OWNER);
  console.log('  ensureRepo   HTTP ' + sr.status + '  ' + sr.note);
  if (!sr.ok) { console.log('  [FAIL] 自检仓库不可用，终止自检。'); process.exit(1); }

  const srel = await ensureRelease({ repo: SELF_REPO, tag: 'selftest', name: 'selftest', body: 'selftest', prerelease: true }, opts.apply, SELF_OWNER);
  console.log('  ensureRelease HTTP ' + srel.status + '  ' + srel.note);
  if (!srel.ok) { console.log('  [FAIL] 自检 release 不可用，终止自检。'); process.exit(1); }

  const sample = 'cpp/release/v1.0pre5/SHA256SUMS.txt';
  const a = await uploadAsset(SELF_REPO, 'selftest', { file: sample, name: 'selftest-SHA256SUMS.txt' }, opts.apply, SELF_OWNER);
  console.log('  uploadAsset  HTTP ' + a.status + '  ' + a.note + (a.ok ? '' : '  <== 失败'));

  const p = await putFile(SELF_REPO, { file: sample, path: 'selftest/SHA256SUMS.txt' }, opts.apply, SELF_OWNER);
  console.log('  putFile      HTTP ' + p.status + '  ' + p.note + (p.ok ? '' : '  <== 失败'));

  const selfOk = a.ok && p.ok;
  console.log('  自检结论     : ' + (selfOk ? 'uploadAsset 与 putFile 均可用' : '存在失败项，需修复'));
  if (!selfOk) process.exitCode = 1;
}

// 5) SHA256 审计
const auditTargets = manifest.assets.filter(function (a) { return a.group === 'studio' && !a.heavy; });
if (auditTargets.length) {
  console.log('');
  console.log('--- 本地 SHA256 与 cpp/release/v1.0pre5/SHA256SUMS.txt 记录比对 ---');
  const audit = auditSums(auditTargets);
  for (const r of audit) {
    const flag = r.state === '不一致' ? '  <== 需重算' : '';
    console.log('  ' + pad(r.state, 8) + ' ' + pad(path.basename(r.file), 52) + ' 实测 ' + String(r.actual).slice(0, 16) + '  记录 ' + (r.recorded ? String(r.recorded).slice(0, 16) : '-') + flag);
  }
  const bad = audit.filter(function (r) { return r.state === '不一致'; });
  if (bad.length) {
    console.log('  [警告] ' + bad.length + ' 个文件的实际字节与 SHA256SUMS.txt 记录不一致；直接上传会让线上校验和对不上。');
    console.log('         先跑 --write-sums 用实测字节重算，再上传。');
  }
  if (opts.writeSums) writeSums(manifest.assets.filter(function (a) { return a.group === 'studio'; }));
}

// 6) 汇总
const okCount = results.filter(function (r) { return r.res.ok; }).length;
const badResults = results.filter(function (r) { return !r.res.ok; });
const skipped = results.filter(function (r) { return r.res.ok && /跳过|未放行/.test(r.res.note); });
const planned = results.filter(function (r) { return r.res.ok && r.res.status === 404; }).length;

console.log('');
console.log('--- 汇总 ---');
console.log('  动作总数   : ' + results.length);
console.log('  可执行     : ' + okCount);
console.log('  待创建     : ' + planned + '（目标侧 404）');
console.log('  跳过       : ' + skipped.length);
console.log('  失败       : ' + badResults.length);
console.log('  大文件闸门 : ' + heavyCount + ' 个资产标 heavy，' + (opts.includeHeavy ? '已放行' : '本次未放行（--include-heavy 才传）'));
console.log('  耗时       : ' + ((Date.now() - T0) / 1000).toFixed(1) + ' s');

if (badResults.length) {
  console.log('');
  console.log('  失败明细:');
  for (const b of badResults) {
    const label = b.item.repo ? (ORG + '/' + b.item.repo) : '';
    const target = b.item.name || b.item.path || b.item.tag || '';
    console.log('    - ' + label + ' ' + target + '  HTTP ' + (b.res.status || '-') + '  ' + b.res.note);
  }
}

const blocked = !opts.offline && !perm.ok;
if (blocked) printBlocked(perm);

console.log('');
if (blocked) {
  console.log('结论: 计划已生成，但写操作被组织权限阻塞（退出码 2）。未对远端做任何修改。');
  process.exit(2);
}
if (badResults.length && opts.apply) {
  console.log('结论: 执行完成但存在失败项（退出码 1）。');
  process.exit(1);
}
console.log(opts.apply ? '结论: 执行完成。' : '结论: DRY-RUN 结束，未对远端做任何修改。加 --apply 才会真正执行。');
process.exit(0);
