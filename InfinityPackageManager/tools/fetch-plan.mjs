/*
 * fetch-plan.mjs - turn the winget package index into a download plan.
 *
 * winget-pkgs is the Windows package index: every package it knows about has a
 * directory under manifests/ holding a version file, a locale file and an
 * installer file. The installer file carries the two things this needs - the
 * real download URL and the SHA256 of the bytes behind it - so the catalogue
 * is built from published facts rather than from guesswork.
 *
 * The index is large enough that GitHub truncates a recursive tree request, so
 * this works from whatever the truncated listing returned. That listing already
 * holds more than a thousand distinct packages, which is the target.
 *
 * Two stages, and the first is the expensive one:
 *
 *   1. fetch every package's installer manifest, in parallel, through curl
 *   2. parse them into plan.json - one row per package with url and hash
 *
 * Nothing is downloaded here. This only decides what to download.
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const NL = String.fromCharCode(10);
const QUOTE1 = String.fromCharCode(39);
const QUOTE2 = String.fromCharCode(34);

const TREE = 'D:/temp/winget-tree.json';
const DIR = 'D:/temp/manifests';
const PLAN = 'D:/temp/plan.json';
const RAW = 'https://gh-proxy.com/https://raw.githubusercontent.com/microsoft/winget-pkgs/master/';

if (!fs.existsSync(TREE)) {
  process.stdout.write('the index is missing: ' + TREE + NL);
  process.exit(1);
}

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const tree = JSON.parse(fs.readFileSync(TREE, 'utf8'));

/*
 * One row per package, keeping the newest version. Without this a package with
 * forty releases would contribute forty catalogue entries.
 */
const latest = new Map();
let scanned = 0;
for (const x of tree.tree) {
  if (!x.path) continue;
  if (x.path.slice(-14) !== 'installer.yaml') continue;
  scanned++;
  const parts = x.path.split('/');
  if (parts.length < 6) continue;
  const key = parts[1] + '/' + parts[2] + '/' + parts[3];
  const ver = parts[4];
  const cur = latest.get(key);
  if (!cur || ver > cur.ver) latest.set(key, { ver: ver, path: x.path });
}

const keys = Array.from(latest.keys()).sort();
process.stdout.write('manifests ' + scanned + '  packages ' + keys.length + NL);

/*
 * curl reads the whole job from a config file rather than from the command
 * line: a thousand packages would be three thousand arguments and would not
 * fit in a Windows command line. Parallel is what makes this minutes rather
 * than hours.
 */
const cfg = [];
keys.forEach(function (k, i) {
  const row = latest.get(k);
  cfg.push('url = ' + QUOTE2 + RAW + row.path + QUOTE2);
  cfg.push('output = ' + QUOTE2 + DIR + '/' + i + '.yaml' + QUOTE2);
});
fs.writeFileSync(DIR + '/curl.cfg', cfg.join(NL) + NL, 'utf8');

process.stdout.write('fetching...' + NL);
try {
  execFileSync('curl.exe', ['-sS', '--parallel', '--parallel-max', '12', '--ssl-no-revoke',
    '--max-time', '900', '-K', DIR + '/curl.cfg'], { stdio: 'ignore', maxBuffer: 67108864 });
} catch (e) {
  process.stdout.write('curl reported ' + String(e.message).slice(0, 120) + NL);
}

/* Strip the quote characters a YAML scalar may carry. */
function bare(s) {
  return s.split(QUOTE1).join('').split(QUOTE2).join('').trim();
}

/*
 * Read one top-level field. The manifests are shallow YAML, so a line scan is
 * both sufficient and safer than a pattern - nothing has to survive an
 * escaping layer.
 */
function field(text, name) {
  const want = name + ':';
  for (const line of text.split(NL)) {
    const t = line.trim();
    if (t.slice(0, want.length) !== want) continue;
    return bare(t.slice(want.length));
  }
  return '';
}

/*
 * The hash belongs to the URL directly above it. Taking the first pair in file
 * order avoids picking up a second architecture that appears further down.
 */
function firstPair(text) {
  let url = '';
  for (const line of text.split(NL)) {
    const t = line.trim();
    if (t.indexOf('InstallerUrl:') === 0) {
      url = bare(t.slice('InstallerUrl:'.length));
    } else if (url && t.indexOf('InstallerSha256:') === 0) {
      const sha = bare(t.slice('InstallerSha256:'.length));
      if (sha.length === 64) return { url: url, sha256: sha };
    }
  }
  return null;
}

const rows = [];
let parsed = 0;
let rejected = 0;
for (let i = 0; i < keys.length; i++) {
  const file = DIR + '/' + i + '.yaml';
  if (!fs.existsSync(file)) continue;
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { continue; }
  if (text.indexOf('PackageIdentifier') < 0) continue;
  parsed++;

  const pair = firstPair(text);
  if (!pair) { rejected++; continue; }

  const parts = keys[i].split('/');
  const id = field(text, 'PackageIdentifier') || (parts[1] + '.' + parts[2]);
  const version = field(text, 'PackageVersion') || latest.get(keys[i]).ver;

  /*
   * The catalogue has exactly two kinds: setup and port. Every winget entry is
   * an installer, so all of them map to setup. port would mean a bare archive
   * with no installer, which winget does not describe.
   */
  rows.push({
    key: keys[i],
    name: id,
    version: version,
    company: field(text, 'Publisher') || parts[2],
    type: 'setup',
    url: pair.url,
    sha256: pair.sha256.toLowerCase()
  });
}

/*
 * The file name has to be unique inside one GitHub release, and winget ids are
 * unique, so the id plus version plus the original extension is enough.
 */
for (const r of rows) {
  let ext = '.exe';
  const lower = r.url.split('?')[0].toLowerCase();
  for (const e of ['.msi', '.msixbundle', '.msix', '.appx', '.exe', '.zip']) {
    if (lower.slice(-e.length) === e) { ext = e; break; }
  }
  r.fileName = r.name.replace(/[^A-Za-z0-9._-]/g, '_') + '_' +
    r.version.replace(/[^A-Za-z0-9._-]/g, '_') + ext;
}

/*
 * Two packages can resolve to one file name when a publisher reuses an id
 * across architectures. A release cannot hold two assets with one name, so the
 * later duplicate is dropped rather than overwriting the earlier one.
 */
const seen = new Set();
const unique = [];
let dupes = 0;
for (const r of rows) {
  if (seen.has(r.fileName)) { dupes++; continue; }
  seen.add(r.fileName);
  unique.push(r);
}

fs.writeFileSync(PLAN, JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: 'microsoft/winget-pkgs',
  packages: unique.length,
  entries: unique
}, null, 1) + NL, 'utf8');

process.stdout.write('parsed ' + parsed + '  usable ' + unique.length +
  '  rejected ' + rejected + '  duplicate names ' + dupes + NL);
process.stdout.write('plan written to ' + PLAN + '  ' + fs.statSync(PLAN).size + ' B' + NL);
