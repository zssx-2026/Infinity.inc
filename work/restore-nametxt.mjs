import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync, statSync } from 'node:fs';

const token = process.env.EV_GH_TOKEN;
if (!token) { console.log('NO TOKEN'); process.exit(1); }
const API = 'https://api.github.com';
const OWNER = 'zssx-2026', REPO = 'applications', TAG = 'application-inc';
const DEST = 'cpp/release/v1.0pre6/name.txt';
const WANT = '7fca9475aa4bda6b9e71d91db41343eac7658f9296ec7fb76774b8776aefdc37';

function api(route) {
  const raw = execFileSync('curl.exe', ['-sS', '--ssl-no-revoke', '-H', 'Authorization: Bearer ' + token,
    '-H', 'Accept: application/vnd.github+json', '-H', 'User-Agent: Infinity.Inc',
    '-H', 'X-GitHub-Api-Version: 2022-11-28', '--max-time', '120', API + route],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(raw);
}

const rel = api('/repos/' + OWNER + '/' + REPO + '/releases/tags/' + TAG);
const asset = (rel.assets || []).find(a => a.name === 'name.txt');
if (!asset) { console.log('name.txt asset not found'); process.exit(2); }
console.log('asset id=' + asset.id + ' size=' + asset.size + ' url=' + asset.url);

execFileSync('curl.exe', ['-sS', '-L', '--ssl-no-revoke', '-H', 'Authorization: Bearer ' + token,
  '-H', 'Accept: application/octet-stream', '-H', 'User-Agent: Infinity.Inc',
  '--max-time', '300', '-o', DEST, asset.url], { stdio: ['ignore', 'pipe', 'pipe'] });

const buf = execFileSync('node', ['-e', 'process.stdout.write(require("fs").readFileSync(process.argv[1]).toString("base64"))', DEST], { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });
const bytes = Buffer.from(buf, 'base64');
const sha = createHash('sha256').update(bytes).digest('hex');
console.log('restored bytes=' + bytes.length + ' sha256=' + sha);
console.log('match=' + (sha === WANT) + ' size=' + statSync(DEST).size);
console.log('--- content ---');
console.log(bytes.toString('utf8'));
