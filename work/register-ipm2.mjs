// register-ipm2.mjs - create the two new IPM catalogue pages and publish their packages.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

const DIR = 'D:/dev/DeepSeekHarnessWorkspace/Infinity.inc';
const OWNER = 'zssx-2026';
const REPO = 'applications';
const TOKEN = process.env.EV_GH_TOKEN;
if (!TOKEN) { console.error('missing EV_GH_TOKEN'); process.exit(2); }
const log = (...a) => console.log(a.join(' '));

function api(method, path, body) {
  const args = ['-sS', '--ssl-no-revoke', '-X', method,
    '-H', 'Authorization: Bearer ' + TOKEN,
    '-H', 'User-Agent: infinity-inc',
    '-H', 'Accept: application/vnd.github+json',
    'https://api.github.com' + path];
  if (body !== undefined) { args.push('-H', 'Content-Type: application/json', '--data-binary', JSON.stringify(body)); }
  const out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  let j = null; try { j = JSON.parse(out); } catch (e) { }
  return { status: null, data: j, raw: out };
}

function upload(relId, file, name) {
  const out = execFileSync('curl', ['-sS', '--ssl-no-revoke', '-X', 'POST',
    '-H', 'Authorization: Bearer ' + TOKEN,
    '-H', 'Content-Type: application/octet-stream',
    '--data-binary', '@' + file,
    'https://uploads.github.com/repos/' + OWNER + '/' + REPO + '/releases/' + relId + '/assets?name=' + encodeURIComponent(name)
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const j = JSON.parse(out);
  return (j.state === 'uploaded') ? ('ok ' + j.size + ' B id=' + j.id) : ('bad: ' + (j.message || out.slice(0, 200)));
}

const sha256 = (f) => { const c = crypto.createHash('sha256'); c.update(fs.readFileSync(f)); return c.digest('hex'); };

const APPS = [
  {
    tag: 'once-power', title: 'once_power 3.1.3 (Windows x64, portable)',
    zip: DIR + '/work/_ipm2/once_power_3.1.3_win64_port.zip', asset: 'once_power_3.1.3_win64_port.zip',
    line: 'once_power_3.1.3_win64_port.zip Infinity.Inc once_power port Infinity.Inc win64',
    body: 'once_power 3.1.3 - Flutter Windows build, portable package for Infinity Package Manager.\n\nCompany: com.ilgnefz\nPlatform: win64\nInstall kind: port\n\nUnzip and run once_power.exe.',
  },
  {
    tag: 'piik', title: 'Piik 1.0.0 (Windows x64, portable)',
    zip: DIR + '/work/_ipm2/Piik_1.0.0_win64_port.zip', asset: 'Piik_1.0.0_win64_port.zip',
    line: 'Piik_1.0.0_win64_port.zip Infinity.Inc Piik port Infinity.Inc win64',
    body: 'Piik 1.0.0 - portable package for Infinity Package Manager.\n\nPlatform: win64\nInstall kind: port\n\nUnzip and run piik-app.exe.',
  },
];

for (const a of APPS) {
  const bytes = fs.statSync(a.zip).size;
  const hash = sha256(a.zip);
  log('=== ' + a.tag + ' zip=' + bytes + ' sha256=' + hash.slice(0, 16) + '...');
  let rel = api('GET', '/repos/' + OWNER + '/' + REPO + '/releases/tags/' + a.tag);
  if (rel.data && rel.data.id) {
    log('release exists id=' + rel.data.id + ' assets=' + (rel.data.assets || []).map(x => x.name + '(' + x.size + ')').join(','));
  } else {
    rel = api('POST', '/repos/' + OWNER + '/' + REPO + '/releases', { tag_name: a.tag, name: a.title, body: a.body, draft: false, prerelease: false });
    if (!rel.data || !rel.data.id) { log('create failed: ' + rel.raw.slice(0, 300)); continue; }
    log('created id=' + rel.data.id);
  }
  const id = rel.data.id;
  const have = rel.data.assets || [];
  for (const name of [a.asset, 'name.txt']) {
    const dup = have.find(x => x.name === name);
    if (dup) { const d = api('DELETE', '/repos/' + OWNER + '/' + REPO + '/releases/assets/' + dup.id); log('removed old ' + name); }
  }
  log('upload ' + a.asset + ' -> ' + upload(id, a.zip, a.asset));
  const nf = DIR + '/work/_ipm2/name-' + a.tag + '.txt';
  fs.writeFileSync(nf, a.line + '\n', 'utf8');
  log('name.txt bytes=' + fs.statSync(nf).size + ' [' + a.line + ']');
  log('upload name.txt -> ' + upload(id, nf, 'name.txt'));
  const after = api('GET', '/repos/' + OWNER + '/' + REPO + '/releases/tags/' + a.tag);
  for (const x of (after.data.assets || [])) log('  asset ' + x.name + ' size=' + x.size + ' digest=' + (x.digest || '-') + ' url=' + x.browser_download_url);
  fs.writeFileSync(DIR + '/work/_ipm2/' + a.tag + '.json', JSON.stringify({ tag: a.tag, asset: a.asset, size: bytes, sha256: hash, nameTxt: a.line, release: after.data }, null, 1));
}
