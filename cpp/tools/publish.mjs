/*
 * publish.mjs - put the built C++ installers on GitHub.
 *
 * The C++ suite lives in its own repositories (one per application), the way
 * the Node builds already do, so a user downloads exactly one installer.
 *
 * Every request goes through curl. The hand-rolled CONNECT client in the
 * application repositories is bound to a local relay that is not always
 * running; curl picks up the proxy from the environment and reports a real
 * HTTP status instead of an opaque socket error.
 *
 * Usage:  NODE_OPTIONS= node tools/publish.mjs [tag]
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'release', 'v1.0pre3');
const TAG = process.argv[2] || 'v1.0.0-pre3';
const OWNER = 'zssx-2026';

/* package name in the file name -> repository that holds the application */
const REPOS = [
  { package: 'InfinityCloud', repo: 'Infinity-Cloud', product: 'Infinity Cloud' },
  { package: 'InfinityFileManager', repo: 'Infinity-File-Manager', product: 'Infinity File Manager' },
  { package: 'InfinityPackageManager', repo: 'InfinityPackageManager', product: 'InfinityPackageManager' }
];

const token = process.env.EV_GH_TOKEN || '';
if (!token) { console.log('NO TOKEN'); process.exit(1); }

function curl(args) {
  /* stdio must be stated: inheriting stdin makes every spawn fail with EBUSY */
  return execFileSync('curl.exe', ['-sS', '--ssl-no-revoke', '--max-time', '3600'].concat(args),
    { maxBuffer: 256 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function api(method, route, body) {
  const args = ['-X', method,
    '-H', 'Authorization: Bearer ' + token,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'User-Agent: Infinity.Inc',
    '-H', 'X-GitHub-Api-Version: 2022-11-28',
    'https://api.github.com' + route];
  if (body !== undefined) {
    args.push('-H', 'Content-Type: application/json', '--data-binary', JSON.stringify(body));
  }
  let raw = '';
  try { raw = curl(args); } catch (e) { raw = String(e.stdout || '') || String(e.message || ''); }
  try { return { ok: true, data: JSON.parse(raw) }; }
  catch (err) { return { ok: false, raw: raw.slice(0, 400) }; }
}

function fnv1a(buf) {
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i++) { h ^= buf[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

const BODY = [
  '第一个纯 C++ 版本。三个应用各自只有一个 exe 家族，不需要 Node、不需要 Electron、',
  '也不需要任何第三方运行库 —— 导入表里只有 Windows 自带的 DLL。',
  '',
  '· 每个应用 8 个可执行文件，按文件名分派 cli / tui / gui / launcher，管理员孪生用 inx / ifmx / ipmx 前缀',
  '· 安装包体积 ~200-450 KB（此前 Node + Electron 版本约 20 MB 起）',
  '· 安装时注册 HKCU 环境变量并广播 WM_SETTINGCHANGE，卸载时删除',
  '',
  '当前覆盖范围：INC 的凭据、GitHub API 与三种呈现方式；IFM 的本地文件操作；',
  'IPM 的目录查询与摘要校验。云盘本体、WebDAV 服务端、插件系统仍在推进中。'
].join('\n');

const produced = [];
for (const app of REPOS) {
  const file = path.join(OUT, app.package + '_1.0.0-pre3_win64_setup.exe');
  if (!fs.existsSync(file)) throw new Error('missing installer: ' + file);
  const size = fs.statSync(file).size;
  const name = path.basename(file);

  console.log('--- ' + app.repo + '  ' + name + '  ' + size + ' B');

  /* the release, created on first run and reused afterwards */
  let rel = api('GET', '/repos/' + OWNER + '/' + app.repo + '/releases/tags/' + TAG);
  if (rel.ok && rel.data && rel.data.id) {
    console.log('    release exists id=' + rel.data.id);
  } else {
    const c = api('POST', '/repos/' + OWNER + '/' + app.repo + '/releases', {
      tag_name: TAG, name: TAG + '  C++', body: BODY, draft: false, prerelease: true
    });
    if (!c.ok || !c.data || !c.data.id) throw new Error('create release failed: ' + JSON.stringify(c).slice(0, 300));
    rel = c;
    console.log('    release created id=' + rel.data.id);
  }

  /* a same-named asset from an earlier attempt would make GitHub answer 422 */
  const list = api('GET', '/repos/' + OWNER + '/' + app.repo + '/releases/' + rel.data.id + '/assets?per_page=100');
  if (list.ok && Array.isArray(list.data)) {
    for (const a of list.data) {
      if (a.name === name) {
        const d = api('DELETE', '/repos/' + OWNER + '/' + app.repo + '/releases/assets/' + a.id);
        console.log('    removed previous ' + a.name + ' -> ' + (d.ok ? 'ok' : 'fail'));
      }
    }
  }

  const upload = 'https://uploads.github.com/repos/' + OWNER + '/' + app.repo +
    '/releases/' + rel.data.id + '/assets?name=' + encodeURIComponent(name);
  const resp = curl(['-X', 'POST', upload,
    '-H', 'Authorization: Bearer ' + token,
    '-H', 'Content-Type: application/octet-stream',
    '-H', 'User-Agent: Infinity.Inc',
    '--data-binary', '@' + file]);
  let up = null; try { up = JSON.parse(resp); } catch (e) { up = null; }
  if (up && up.id) console.log('    uploaded id=' + up.id + '  stored=' + up.size);
  else { console.log('    UPLOAD FAILED: ' + resp.slice(0, 300)); continue; }

  const v = api('GET', '/repos/' + OWNER + '/' + app.repo + '/releases/tags/' + TAG);
  if (v.ok && v.data && Array.isArray(v.data.assets)) {
    console.log('    release ' + TAG + ' now holds ' + v.data.assets.length + ' asset(s)');
    for (const a of v.data.assets) console.log('      ' + a.name + '  ' + a.size + '  ' + a.state);
  }
  produced.push({
    name: name, size: size, fnv1a: fnv1a(fs.readFileSync(file)),
    repo: OWNER + '/' + app.repo, url: (up && up.browser_download_url) || ''
  });
}

const manifest = { tag: TAG, generated: new Date().toISOString(), assets: produced };
fs.writeFileSync(path.join(OUT, 'release-assets.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log('published ' + produced.length + ' installer(s) as ' + TAG);
