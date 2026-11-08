/*
 * gitee-release-upload.mjs - attach the pre5 setup to a Gitee release.
 *
 * Gitee's attach_files endpoint takes multipart/form-data and the token as a
 * query parameter. Node 24 has fetch + FormData + Blob built in, so no
 * dependency is needed. The token is read from GITEE_TOKEN, which the caller
 * exports before running this - it is never written to disk or printed.
 */
import fs from 'node:fs';
import path from 'node:path';

const OWNER = 'zssx2026';

async function attach(repo, releaseId, file) {
  const token = process.env.GITEE_TOKEN || '';
  if (!token) throw new Error('GITEE_TOKEN is empty');
  if (!fs.existsSync(file)) throw new Error('missing file: ' + file);
  const buf = fs.readFileSync(file);
  const form = new FormData();
  form.append('file', new Blob([buf]), path.basename(file));
  const url = 'https://gitee.com/api/v5/repos/' + OWNER + '/' + repo +
    '/releases/' + releaseId + '/attach_files?access_token=' + token;
  const res = await fetch(url, { method: 'POST', body: form });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 400) };
}

const repo = process.argv[2];
const releaseId = process.argv[3];
const file = process.argv[4];
if (!repo || !releaseId || !file) {
  console.log('usage: node work/gitee-release-upload.mjs <repo> <releaseId> <file>');
  process.exit(2);
}
const r = await attach(repo, releaseId, file);
console.log('UPLOAD ' + repo + ' status=' + r.status);
console.log(r.body);
/* Set the exit code and let the loop drain: process.exit() while a fetch
 * socket is still closing trips a libuv assertion on Windows. */
process.exitCode = r.status >= 200 && r.status < 300 ? 0 : 1;