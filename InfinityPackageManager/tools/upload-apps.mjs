/* upload-apps.mjs - publish the downloaded packages as IPM releases. */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ghApi } from '../release/gh-client.mjs';

const N = String.fromCharCode(10);
const OWNER = 'zssx-2026';
const REPO = 'applications';
const RELAY = 'http://127.0.0.1:13799';
const DIR = 'D:/temp/apps';
const PER = 400;

const token = process.env.EV_GH_TOKEN || '';
if (!token) { process.stdout.write('NO TOKEN' + N); process.exit(1); }

/* Every package that finished downloading, newest plan order preserved. */
const plan = JSON.parse(fs.readFileSync('D:/temp/plan.json', 'utf8'));
const have = [];
for (const e of plan.entries) {
  const f = DIR + '/' + e.fileName;
  let size = 0;
  try { size = fs.statSync(f).size; } catch (err) { continue; }
  if (!size) continue;
  e.size = size;
  e.file = f;
  have.push(e);
}
process.stdout.write('packages on disk: ' + have.length + N);

function nameTxt(batch) {
  const out = [];
  for (const e of batch) {
    const company = String(e.company || 'null').replace(/[^A-Za-z0-9._-]/g, '') || 'null';
    const name = String(e.name).replace(/[^A-Za-z0-9._-]/g, '') || 'pkg';
    /* 第六列是目标平台。winget 只收录 Windows 包，所以这里的取值是 windows；
     * INC 和 IFM 会写精确的 win64 / winx86 / win-arm64。 */
    const platform = e.platform || 'windows';
    out.push(e.fileName + ' ' + e.version + ' ' + name + ' setup ' + company + ' ' + platform);
  }
  return out.join(N) + N;
}

/*
 * Upload one file. curl rather than a hand-built body: GitHub counts the
 * bytes itself, and a body assembled in JavaScript once produced a
 * Content-Length three times the real file.
 */
function put(releaseId, file, assetName) {
  const url = 'https://uploads.github.com/repos/' + OWNER + '/' + REPO +
    '/releases/' + releaseId + '/assets?name=' + encodeURIComponent(assetName);
  try {
    const out = execFileSync('curl.exe', [
      '-sS', '--proxy', RELAY, '--max-time', '7200',
      '-X', 'POST', url,
      '-H', 'Authorization: Bearer ' + token,
      '-H', 'Content-Type: application/octet-stream',
      '-H', 'User-Agent: InfinityPackageManager',
      '--data-binary', '@' + file
    ], { maxBuffer: 67108864, encoding: 'utf8' });
    const j = JSON.parse(out);
    return j && j.id ? true : false;
  } catch (e) { return false; }
}

/*
 * Walk the packages in waves of 400 - the release cap is 1000 assets and
 * name.txt takes one of them, so 400 leaves room to retry a failure.
 *
 * Progress is written after every wave, so a restart picks up where it
 * stopped instead of re-uploading 80 GiB.
 */
const PROG = 'D:/temp/upload-progress.json';
let start = 0;
if (fs.existsSync(PROG)) {
  try {
    const p = JSON.parse(fs.readFileSync(PROG, 'utf8'));
    if (p.next) start = p.next;
  } catch (e) { }
}

process.stdout.write('starting at package ' + start + N);

for (let i = start; i < have.length; i += PER) {
  const batch = have.slice(i, i + PER);
  const index = Math.floor(i / PER) + 1;
  /*
   * The tag carries application, which is what makes ipm get see this
   * release at all. The index keeps two releases apart.
   */
  const tag = 'application-' + String(index).padStart(3, '0');

  const g = await ghApi('api.github.com', token, 'GET',
    '/repos/' + OWNER + '/' + REPO + '/releases/tags/' + tag);
  let rel = (g.status === 200 && g.data && g.data.id) ? g.data : null;
  if (!rel) {
    const c = await ghApi('api.github.com', token, 'POST',
      '/repos/' + OWNER + '/' + REPO + '/releases', {
      tag_name: tag, name: tag, body: '', draft: false, prerelease: false
    });
    rel = c.data;
    process.stdout.write('release ' + tag + ' created ' + rel.id + N);
  }

  /*
   * Everything already attached, across every page.
   *
   * A wave holds 400 packages and GitHub returns 100 assets per page, so a
   * single unpaginated read would report only the first quarter as present.
   * The rest would be uploaded a second time, and the duplicate names would
   * be rejected by GitHub mid-wave - which looks like a network failure and
   * is not.
   */
  const live = new Set();
  const ex = { data: [] };
  for (let page = 1; page <= 20; page++) {
    const got = await ghApi('api.github.com', token, 'GET',
      '/repos/' + OWNER + '/' + REPO + '/releases/' + rel.id + '/assets?per_page=100&page=' + page);
    if (!Array.isArray(got.data) || !got.data.length) break;
    for (const a of got.data) { live.add(a.name); ex.data.push(a); }
    if (got.data.length < 100) break;
  }

  let ok = 0, skip = 0, fail = 0;
  for (const e of batch) {
    if (live.has(e.fileName)) { skip++; continue; }
    if (put(rel.id, e.file, e.fileName)) ok++; else fail++;
    if ((ok + fail) % 25 === 0) {
      process.stdout.write('  wave ' + index + '  ' + ok + ' ok, ' + fail + ' failed' + N);
    }
  }

  /*
   * name.txt is uploaded last. Until it lands, ipm get sees a release with
   * assets but no catalogue, and the packages in it are invisible - so a
   * half-finished wave never shows up as a half-finished catalogue.
   */
  const txt = DIR + '/name-' + index + '.txt';
  fs.writeFileSync(txt, nameTxt(batch), 'utf8');
  if (live.has('name.txt')) {
    const old = (ex.data || []).find(function (a) { return a.name === 'name.txt'; });
    if (old) {
      await ghApi('api.github.com', token, 'DELETE',
        '/repos/' + OWNER + '/' + REPO + '/releases/assets/' + old.id);
    }
  }
  put(rel.id, txt, 'name.txt');

  fs.writeFileSync(PROG, JSON.stringify({
    next: i + batch.length, wave: index, updatedAt: new Date().toISOString()
  }, null, 1) + N, 'utf8');

  process.stdout.write('wave ' + index + ': ' + batch.length +
    ' packages, ' + ok + ' ok, ' + skip + ' already there, ' + fail + ' failed' + N);
}

process.stdout.write('DONE' + N);
