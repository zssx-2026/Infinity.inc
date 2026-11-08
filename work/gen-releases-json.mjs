// gen-releases-json.mjs - the static release list the download pages read first.
//
// The v1.0pre5 artifacts were frozen twice (task-26/29) and the published bytes
// must not move again, so this script now builds the snapshot OFFLINE from the
// frozen manifest named by version.json (cpp/release/v1.0pre5/release-assets.json):
// the history already recorded in releases.json is preserved and only the frozen
// tag's asset size/digest/url are rewritten from the manifest. No network, no
// curl, no GitHub API - a frozen release has nothing left to fetch.
//
// bundles are the published Infinity-Archive .zst archives recorded in
// work/archive-bundles.json. That file is append-only history, so it still holds
// archives for tags the release list no longer carries (v1.0.0-pre4 was replaced
// by v1.0.0-pre5). Only archives whose repo and tag are still in the release list
// are written, so a re-run cannot resurrect an orphan. The dropped history stays
// in work/archive-bundles.json.
//
//   node work/gen-releases-json.mjs           rebuild releases.json from the frozen manifest
//   node work/gen-releases-json.mjs --check   prove the on-disk snapshot already equals that
//                                             rebuild and that no orphan bundle comes back
import fs from 'node:fs';

const OWNER = 'zssx-2026';
const REPOS = ['Infinity-Cloud', 'Infinity-File-Manager', 'InfinityPackageManager', 'Infinity-Toolbox', 'Infinity-Games', 'InfinityServer'];
const BUNDLES_FILE = 'work/archive-bundles.json';
const OUT_FILE = 'web/infinity/assets/releases.json';
const VERSION_FILE = 'version.json';
const PENDING_TAGS = ['v1.0.0-pre5'];
const BUNDLES_NOTE = 'Archive (.zst) bundles. Only tags still listed in repos are kept; the v1.0.0-pre4 entries were dropped because those release objects were replaced by v1.0.0-pre5 and could never render again (full published history stays in work/archive-bundles.json). No v1.0.0-pre5 bundle exists yet: work/archive/archive-plan.json has no pre5 entry and uploading to Infinity-Archive needs an explicit build+upload step, which this round must not perform. The archive page degrades by design: a version with no bundle shows "the .zst for this platform is not built yet" and links its release files directly (web/infinity/assets/archive.js).';

function readRawBundles() {
  try { return JSON.parse(fs.readFileSync(BUNDLES_FILE, 'utf8')); }
  catch (e) { console.log('no archive-bundles.json yet'); return {}; }
}

/* Keep a bundle only when its repo is in the release list and its tag is one of
 * that repo's current tags. Everything else is orphaned history. */
function filterBundles(repos, raw) {
  const bundles = {};
  const dropped = [];
  for (const repo of Object.keys(raw || {})) {
    const entries = raw[repo] || [];
    const tags = new Set(((repos || {})[repo] || []).map(function (r) { return String(r.tag_name); }));
    const kept = entries.filter(function (b) { return tags.has(String(b.tag)); });
    for (const b of entries) if (!tags.has(String(b.tag))) dropped.push(repo + '  ' + b.tag + '  ' + b.name);
    if (kept.length) bundles[repo] = kept;
  }
  return { bundles: bundles, dropped: dropped };
}

/* Attach the filtered bundles and the explicit "pre5 archive not published yet"
 * annotation, so a regeneration keeps the shape the page and its check expect. */
function attachBundles(data, repos, raw) {
  const filtered = filterBundles(repos, raw);
  data.bundles = filtered.bundles;
  data.bundlesUpdatedAt = new Date().toISOString();
  data.bundlesPendingTags = PENDING_TAGS.slice();
  data.bundlesNote = BUNDLES_NOTE;
  return filtered.dropped;
}

/* The frozen manifest version.json points at. */
function readManifest() {
  const v = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
  const manifestPath = v.releaseDir + '/release-assets.json';
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  if (!assets.length) throw new Error('no assets in ' + manifestPath);
  return { tag: String(manifest.tag || v.tag || ''), manifestPath: manifestPath, assets: assets };
}

/* Rewrite the frozen tag's assets from the manifest, preserving every other
 * field and every other release. Returns the applied repos/names. */
function applyManifest(repos, tag, assets) {
  const byRepo = {};
  for (const a of assets) {
    const repo = String(a.repo).split('/').pop();
    (byRepo[repo] = byRepo[repo] || []).push(a);
  }
  const applied = [];
  const problems = [];
  for (const repo of Object.keys(byRepo)) {
    const list = repos[repo];
    if (!list) { problems.push('repo missing from snapshot: ' + repo); continue; }
    const rel = list.find(function (r) { return String(r.tag_name) === tag; });
    if (!rel) { problems.push('release missing from snapshot: ' + repo + ' ' + tag); continue; }
    rel.assets = rel.assets || [];
    for (const a of byRepo[repo]) {
      let target = rel.assets.find(function (x) { return String(x.name) === String(a.name); });
      if (!target) {
        target = { name: a.name, size: a.size, created_at: rel.published_at || '', browser_download_url: a.url || '', digest: '' };
        rel.assets.push(target);
      }
      target.name = a.name;
      target.size = a.size;
      target.digest = 'sha256:' + a.sha256;
      if (a.url) target.browser_download_url = a.url;
      applied.push(repo + '  ' + a.name);
    }
  }
  return { applied: applied, problems: problems };
}

/* The whole snapshot, deterministically: current history + manifest assets + bundles. */
function build(current, nowIso) {
  const man = readManifest();
  const data = JSON.parse(JSON.stringify(current));
  data.version = 1;
  data.owner = data.owner || OWNER;
  data.generatedAt = nowIso;
  const res = applyManifest(data.repos, man.tag, man.assets);
  if (res.problems.length) throw new Error(res.problems.join('; '));
  if (res.applied.length !== man.assets.length) throw new Error('applied ' + res.applied.length + '/' + man.assets.length + ' manifest assets');
  const dropped = attachBundles(data, data.repos, readRawBundles());
  return { data: data, tag: man.tag, manifestPath: man.manifestPath, assets: man.assets, applied: res.applied, dropped: dropped };
}

/* Every frozen asset in the snapshot must equal the manifest: the 6/6 proof. */
function manifestProblems(current, tag, assets, label) {
  const problems = [];
  const byRepo = {};
  for (const a of assets) { const r = String(a.repo).split('/').pop(); (byRepo[r] = byRepo[r] || []).push(a); }
  let matched = 0;
  for (const repo of Object.keys(byRepo)) {
    const rel = (current.repos[repo] || []).find(function (r) { return String(r.tag_name) === tag; });
    if (!rel) { problems.push('no ' + tag + ' release in ' + repo); continue; }
    for (const a of byRepo[repo]) {
      const got = (rel.assets || []).find(function (x) { return String(x.name) === a.name; });
      const where = label + ': ' + repo + ' ' + a.name;
      if (!got) { problems.push(where + ' missing from snapshot'); continue; }
      const digest = String(got.digest || '').replace(/^sha256:/, '').toLowerCase();
      const wantSha = String(a.sha256).toLowerCase();
      if (Number(got.size) !== Number(a.size)) problems.push(where + ' size ' + got.size + ' != manifest ' + a.size);
      if (digest !== wantSha) problems.push(where + ' sha256 ' + digest + ' != manifest ' + wantSha);
      if (Number(got.size) === Number(a.size) && digest === wantSha) matched++;
    }
  }
  return { problems: problems, matched: matched, total: assets.length };
}

/* Offline proof: the snapshot already equals a rebuild, and no orphan comes back. */
function check() {
  const current = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
  const man = readManifest();
  const problems = [];

  const mm = manifestProblems(current, man.tag, man.assets, 'manifest');
  problems.push.apply(problems, mm.problems);
  console.log('manifest: ' + man.manifestPath + '  tag=' + man.tag + '  assets=' + man.assets.length);
  console.log('snapshot vs frozen manifest (size+sha256): ' + mm.matched + '/' + mm.total);

  for (const repo of Object.keys(current.repos)) if (REPOS.indexOf(repo) < 0) problems.push('unknown repo in snapshot: ' + repo);

  /* A rebuild with the snapshot's own generatedAt must reproduce repos+bundles. */
  const rebuilt = build(current, current.generatedAt).data;
  const strip = function (d) {
    return JSON.stringify({ repos: d.repos, bundles: d.bundles, bundlesPendingTags: d.bundlesPendingTags, bundlesNote: d.bundlesNote });
  };
  if (strip(rebuilt) !== strip(current)) problems.push('rebuild would change the snapshot (repos/bundles differ)');

  /* The bundle orphan proof (kept from the original). */
  const raw = readRawBundles();
  const probe = { repos: current.repos };
  const dropped = attachBundles(probe, current.repos, raw);
  for (const repo of Object.keys(probe.bundles)) {
    const tags = new Set((current.repos[repo] || []).map(function (r) { return String(r.tag_name); }));
    for (const b of probe.bundles[repo]) if (!tags.has(String(b.tag))) problems.push('orphan survived: ' + repo + ' ' + b.tag);
  }
  if (JSON.stringify(probe.bundles) !== JSON.stringify(current.bundles || {})) problems.push('re-run would change bundles');
  if (JSON.stringify(probe.bundlesPendingTags) !== JSON.stringify(current.bundlesPendingTags || [])) problems.push('bundlesPendingTags would be lost');
  if (probe.bundlesNote !== current.bundlesNote) problems.push('bundlesNote would be lost');

  console.log('raw bundles: ' + Object.keys(raw).length + ' repos / ' + Object.values(raw).reduce(function (n, l) { return n + l.length; }, 0) + ' archives');
  console.log('dropped as orphans (' + dropped.length + '):');
  for (const d of dropped) console.log('  ' + d);
  console.log('kept: ' + Object.values(probe.bundles).reduce(function (n, l) { return n + l.length; }, 0) + ' archives in ' + Object.keys(probe.bundles).length + ' repos');
  for (const repo of Object.keys(probe.bundles)) console.log('  ' + repo + ': ' + probe.bundles[repo].map(function (b) { return b.tag + '/' + b.platform; }).join(', '));

  if (problems.length) { for (const p of problems) console.log('PROBLEM ' + p); console.log('RELEASES-CHECK-FAIL'); process.exit(1); }
  console.log('BUNDLES-CHECK-PASS (offline; releases.json not written)');
  console.log('RELEASES-CHECK-PASS ' + mm.matched + '/' + mm.total + ' frozen assets match the manifest; rebuild is a no-op');
}

function main() {
  const current = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
  const built = build(current, new Date().toISOString());
  fs.writeFileSync(OUT_FILE, JSON.stringify(built.data));
  console.log('manifest: ' + built.manifestPath + ' (' + built.assets.length + ' assets, tag ' + built.tag + ')');
  for (const a of built.applied) console.log('  updated ' + a);
  console.log('bundles: ' + Object.keys(built.data.bundles).length + ' repos / ' + Object.values(built.data.bundles).reduce(function (n, l) { return n + l.length; }, 0) + ' archives; dropped ' + built.dropped.length + ' orphan(s)');
  console.log('releases.json bytes=' + fs.statSync(OUT_FILE).size);
}

if (process.argv[2] === '--check') check(); else main();
