/*
 * publish-electron.mjs - put the Electron setups on GitHub Releases.
 *
 * The C++ line publishes through cpp/tools/publish.mjs, which owns its own
 * release directory and asset naming. The Electron line has two products with
 * one asset each and no name.txt, so it gets its own small publisher instead of
 * being bent into the other one's shape.
 *
 * Usage:
 *   node tools/publish-electron.mjs studio|server [--tag v1.0.0-pre8] [--dry-run]
 *
 * The token comes from GH_TOKEN (never printed, never written). Repositories are
 * created on first publish, and an asset of the same name is replaced rather
 * than duplicated, so re-running after a rebuild converges on the same state.
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const ROOT = process.cwd();
const OWNER = 'zssx-2026';

const PRODUCTS = {
  studio: {
    repo: 'Infinity-Studio',
    product: 'Infinity Studio',
    file: 'cpp/release/v1.0pre8/InfinityStudio_1.0.0-pre8_win64_setup.exe',
    tag: 'v1.0.0-pre8',
    title: 'Infinity Studio 1.0.0-pre8',
    body: [
      'Infinity Studio - the one installer for the Infinity line.',
      '',
      '- Silent per-user install: no elevation, no second wizard.',
      '- The studio installs the released products itself (catalog + sha256 check).',
      '- First launch asks for nothing but a token if you use a private repository.',
      '',
      'Download through https://infinity-studio-craft.github.io/ so the link can move',
      'without this file changing.'
    ].join('\n')
  },
  server: {
    repo: 'Infinity-Server',
    product: 'Infinity Server',
    file: 'cpp/release/v1.0pre8/InfinityServer_1.0.0-pre8_win64_setup.exe',
    tag: 'v1.0.0-pre8',
    title: 'Infinity Server 1.0.0-pre8',
    body: [
      'Infinity Server - the rack console.',
      '',
      '- Silent per-user install; listens on 127.0.0.1:7711 after start.',
      '- Ships its own Electron runtime, so nothing else has to be installed first.',
      '',
      'Download through https://infinity-studio-craft.github.io/.'
    ].join('\n')
  }
};

const args = process.argv.slice(2);
const which = args[0];
const dry = args.indexOf('--dry-run') >= 0;
const tagArg = args.indexOf('--tag');
const spec = PRODUCTS[which];
if (!spec) {
  console.log('usage: node tools/publish-electron.mjs studio|server [--tag <tag>] [--dry-run]');
  process.exit(2);
}
const tag = tagArg > 0 ? args[tagArg + 1] : spec.tag;
const token = String(process.env.GH_TOKEN || '').trim();
if (!token && !dry) { console.log('NO TOKEN (set GH_TOKEN)'); process.exit(1); }

const file = path.join(ROOT, spec.file);
if (!fs.existsSync(file)) { console.log('missing asset: ' + spec.file); process.exit(3); }
const size = fs.statSync(file).size;
const name = path.basename(file);
console.log('repo  ' + OWNER + '/' + spec.repo);
console.log('tag   ' + tag);
console.log('asset ' + name + ' (' + size + ' B)');

const headers = {
  accept: 'application/vnd.github+json',
  'user-agent': 'infinity-publisher',
  authorization: 'Bearer ' + token,
  'x-github-api-version': '2022-11-28'
};

async function call(method, url, body, extra) {
  const init = { method: method, headers: Object.assign({}, headers, extra || {}) };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
  return { status: res.status, data: data };
}

function uploadStream(target, baseHeaders, file, size) {
  return new Promise(function (resolve, reject) {
    const url = new URL(target);
    const req = https.request({
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: Object.assign({}, baseHeaders, {
        'content-type': 'application/octet-stream',
        'content-length': String(size)
      })
    }, function (res) {
      const chunks = [];
      res.on('data', function (chunk) { chunks.push(chunk); });
      res.on('end', function () {
        resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    req.setTimeout(600000, function () { req.destroy(new Error('upload timeout')); });
    const stream = fs.createReadStream(file, { highWaterMark: 256 * 1024 });
    stream.on('error', reject);
    stream.pipe(req);
  });
}

async function main() {
  if (dry) {
    const got = await call('GET', 'https://api.github.com/repos/' + OWNER + '/' + spec.repo);
    console.log('repo status=' + got.status);
    if (got.status === 200) {
      const rel = await call('GET', 'https://api.github.com/repos/' + OWNER + '/' + spec.repo + '/releases/tags/' + tag);
      console.log('release status=' + rel.status + (rel.status === 200 ? ' id=' + rel.data.id : ''));
      if (rel.status === 200) {
        const names = (rel.data.assets || []).map(function (a) { return a.name + ':' + a.size; });
        console.log('assets ' + (names.length ? names.join(', ') : 'none'));
      }
    }
    return;
  }
  const repoUrl = 'https://api.github.com/repos/' + OWNER + '/' + spec.repo;
  let got = await call('GET', repoUrl);
  if (got.status === 404) {
    const created = await call('POST', 'https://api.github.com/user/repos', {
      name: spec.repo,
      description: spec.product + ' releases',
      private: false,
      has_issues: false,
      has_wiki: false,
      auto_init: false
    });
    if (created.status !== 201) { console.log('create repo failed ' + created.status + ' ' + JSON.stringify(created.data)); process.exit(4); }
    console.log('repo created ' + created.data.full_name);
  } else if (got.status !== 200) {
    console.log('repo lookup failed ' + got.status);
    process.exit(4);
  }

  /* GitHub refuses to create a release in a repository with no commits, and a
   * freshly created release repository is exactly that. One README commit makes
   * it releasable without turning it into a source repository. */
  const readme = await call('GET', repoUrl + '/contents/README.md');
  if (readme.status === 404) {
    const put = await call('PUT', repoUrl + '/contents/README.md', {
      message: 'chore: initial commit',
      content: Buffer.from('# ' + spec.product + '\n\nRelease assets live in Releases; this repository carries no source.\n').toString('base64')
    });
    console.log('readme created status=' + put.status);
  }

  let release = null;
  const relGet = await call('GET', repoUrl + '/releases/tags/' + tag);
  if (relGet.status === 200) release = relGet.data;
  else if (relGet.status === 404) {
    const made = await call('POST', repoUrl + '/releases', {
      tag_name: tag,
      name: spec.title,
      body: spec.body,
      draft: false,
      prerelease: true
    });
    if (made.status !== 201) { console.log('create release failed ' + made.status + ' ' + JSON.stringify(made.data)); process.exit(5); }
    release = made.data;
    console.log('release created id=' + release.id);
  } else {
    console.log('release lookup failed ' + relGet.status);
    process.exit(5);
  }

  for (const asset of release.assets || []) {
    if (asset.name === name) {
      const del = await call('DELETE', repoUrl + '/releases/assets/' + asset.id);
      console.log('removed old asset id=' + asset.id + ' status=' + del.status);
    }
  }

  /* Stream the asset instead of reading it into a Buffer: an 80 MiB setup read
   * whole needs 80 MiB of contiguous memory, and on a loaded machine that is
   * exactly the allocation that fails with "Failed to allocate memory".
   * It also has to go out through https.request rather than fetch: the uploads
   * host rejects a chunked body with "Bad Content-Length", so the length is
   * declared up front and the file is piped into the request. */
  const uploadUrl = 'https://uploads.github.com/repos/' + OWNER + '/' + spec.repo + '/releases/' + release.id + '/assets?name=' + encodeURIComponent(name);
  const res = await uploadStream(uploadUrl, headers, file, size);
  const text = res.text;
  let up = null;
  try { up = JSON.parse(text); } catch (e) { up = { raw: text }; }
  if (res.status !== 201) { console.log('upload failed ' + res.status + ' ' + text.slice(0, 400)); process.exit(6); }
  console.log('asset uploaded id=' + up.id + ' size=' + up.size + ' digest=' + (up.digest || ''));
  console.log('url ' + up.browser_download_url);
}

main().catch(function (error) {
  console.log('ERROR ' + String((error && error.stack) || error));
  process.exit(9);
});