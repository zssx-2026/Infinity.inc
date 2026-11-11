import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const token = process.env.EV_GH_TOKEN || '';
if (!token) { console.log('NO TOKEN'); process.exit(1); }
const body = fs.readFileSync('docs/RELEASE-v1.0pre7-body.md', 'utf8');
const repos = ['Infinity-Cloud', 'InfinityPackageManager', 'Infinity-Toolbox'];
const tag = 'v1.0.0-pre7';

function curl(args) {
  return execFileSync('curl.exe', ['-sS', '-L', '--retry', '3', '--retry-all-errors', ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const payloadFile = path.join(os.tmpdir(), 'pre7-release-body.json');
fs.writeFileSync(payloadFile, JSON.stringify({ body }), 'utf8');
console.log('body chars=' + body.length + ' bytes=' + Buffer.byteLength(body));

let fail = 0;
for (const repo of repos) {
  const base = 'https://api.github.com/repos/zssx-2026/' + repo;
  const auth = ['-H', 'Authorization: Bearer ' + token, '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28'];
  let id = 0;
  try {
    const rel = JSON.parse(curl([...auth, base + '/releases/tags/' + tag]));
    id = rel.id;
    console.log(repo + ' release id=' + id + ' name=' + JSON.stringify(rel.name) + ' draft=' + rel.draft + ' pre=' + rel.prerelease);
  } catch (e) {
    console.log(repo + ' GET FAIL ' + String(e.message || e).slice(0, 200));
    fail++;
    continue;
  }
  try {
    const out = curl([...auth, '-X', 'PATCH', '--data-binary', '@' + payloadFile, base + '/releases/' + id]);
    const after = JSON.parse(out);
    console.log(repo + ' patched id=' + after.id + ' body chars=' + (after.body || '').length + ' match=' + ((after.body || '') === body));
  } catch (e) {
    console.log(repo + ' PATCH FAIL ' + String(e.message || e).slice(0, 300));
    fail++;
  }
}
fs.rmSync(payloadFile, { force: true });
console.log('fail=' + fail);
process.exit(fail ? 1 : 0);
