/*
 * store.js - the cloud itself.
 *
 * The whole design rests on one idea: a file system that lives in release
 * assets. Every storage repository is named inc_ followed by sixteen random
 * characters, and every repository holds releases. Each release carries up
 * to sixty-seven assets: up to sixty-four data parts, plus file.json, plus
 * the source archive.
 *
 * file.json is the manifest. It is the only thing that has to be read to
 * know what the cloud contains, which is why "get" pulls manifests and
 * nothing else. Each repository holds one volume of that manifest, and the
 * volumes are merged in order on the way in.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomSuffix, sha256File } from '../net/github.js';
import { PATHS } from '../core/config.js';

export const MANIFEST_NAME = 'file.json';

function emptyManifest() {
  return {
    version: 1,
    volume: 1,
    updated: Date.now(),
    files: {},
    parts: {},
    nextPart: 1,
    repos: [],
    /*
     * Deleted files wait here instead of disappearing.
     *
     * The data parts stay uploaded, so a restore costs nothing but a move
     * back into files. That is the whole point: the expensive half of a
     * delete is the upload, and it has already been paid.
     */
    trash: {},
    trashOrder: []
  };
}

export function normPath(p) {
  const s = String(p || '/').replace(/[\u005C\u002F]+/g, '/');
  const out = [];
  for (const seg of s.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  return '/' + out.join('/');
}

export function parentOf(p) {
  const n = normPath(p);
  if (n === '/') return null;
  const i = n.lastIndexOf('/');
  return i <= 0 ? '/' : n.slice(0, i);
}

export function baseOf(p) {
  const n = normPath(p);
  const i = n.lastIndexOf('/');
  return n.slice(i + 1);
}

export function cacheDirFor(user) {
  const d = path.join(PATHS.cache, user || 'anonymous');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export class Store {
  constructor(gh, cfg, log) {
    this.gh = gh;
    this.cfg = cfg;
    this.log = log || function () {};
    this.owner = gh.user ? gh.user.login : null;
    this.manifest = emptyManifest();
    this.repos = [];
  }

  async pull(log) {
    const say = log || this.log;
    say('pulling manifest...');
    this.repos = await this.gh.listStorageRepos(this.cfg.repoPrefix);
    const merged = emptyManifest();
    let seen = 0;
    const total = this.repos.length;
    for (let i = 0; i < total; i++) {
      const repo = this.repos[i];
      say(null, total ? Math.round((i / total) * 100) : 0);
      let releases = [];
      try { releases = await this.gh.listReleases(this.owner, repo.name); }
      catch (e) { say('skip ' + repo.name + ': ' + e.message); continue; }
      /*
       * Newest volume first. A superseded manifest can linger until its writer
       * deletes it, and the merge below is first-wins, so the newest snapshot
       * has to be seen first or a stale one would shadow it.
       */
      releases = releases.slice().sort(function (a, b) {
        return manifestVolume(b.tag_name) - manifestVolume(a.tag_name);
      });
      for (const rel of releases) {
        const asset = (rel.assets || []).find(function (a) { return a.name === MANIFEST_NAME; });
        if (!asset) continue;
        const tmp = path.join(cacheDirFor(this.owner), repo.name + '-' + rel.id + '.json');
        try {
          await this.gh.downloadAsset(this.owner, repo.name, asset.id, tmp, null,
            { tag: rel.tag_name, name: asset.name });
          mergeManifest(merged, JSON.parse(fs.readFileSync(tmp, 'utf8')));
          seen++;
        } catch (e) { say('bad manifest in ' + repo.name + ' ' + rel.tag_name); }
        try { fs.unlinkSync(tmp); } catch (e) { }
      }
    }
    say(null, 100);
    say('pull done.');
    merged.repos = this.repos.map(function (r) { return r.name; });
    merged.updated = Date.now();
    this.manifest = merged;
    this.log('manifest: ' + Object.keys(merged.files).length + ' files from ' + seen + ' volume(s)');
    return merged;
  }

  /* Find a repository with room, or open a new one. */
  async ensureRepo() {
    for (const r of this.repos) {
      const rels = await this.gh.listReleases(this.owner, r.name);
      if (rels.length < this.cfg.maxAssets) return r.name;
    }
    const name = this.cfg.repoPrefix + randomSuffix(16);
    await this.gh.createRepo(name, false);
    this.repos.push({ name: name });
    this.log('created storage repo ' + name);
    return name;
  }

  async put(localPath, cloudPath, opts, onProgress) {
    const o = opts || {};
    const cp = normPath(cloudPath);
    const size = fs.statSync(localPath).size;
    const hash = await sha256File(localPath);
    const chunk = o.chunkBytes || this.cfg.chunkBytes;
    const count = Math.max(1, Math.ceil(size / chunk));
    const repo = await this.ensureRepo();
    /* A brand-new repository has no commits and cannot hold a release yet. */
    if (this.gh.ensureReleasable) await this.gh.ensureReleasable(this.owner, repo);
    const entryParts = [];
    for (let i = 0; i < count; i++) {
      const start = i * chunk;
      const len = Math.min(chunk, size - start);
      const tag = 'part-' + String(i).padStart(5, '0');
      let rel = await this.gh.getRelease(this.owner, repo, tag);
      if (!rel) rel = await this.gh.createRelease(this.owner, repo, tag, tag);
      /*
       * The full cloud path, not just its base name, goes into the asset
       * name: /a/report.pdf and /b/report.pdf must not share one, or the
       * second upload deletes the first while the manifest still points at
       * it. The hash keeps the name short and unique, the base name keeps it
       * readable.
       */
      const assetName = baseOf(cp) + '.' + shortHash(cp) + '.' + String(i).padStart(5, '0') + '.part';
      const old = (rel.assets || []).find(function (a) { return a.name === assetName; });
      if (old) await this.gh.deleteAsset(this.owner, repo, old.id);
      const slice = path.join(cacheDirFor(this.owner), 'slice-' + Date.now() + '-' + i);
      copyRange(localPath, slice, start, len);
      const up = await this.gh.uploadAsset(this.owner, repo, rel.id, slice, assetName);
      try { fs.unlinkSync(slice); } catch (e) { }
      entryParts.push({ repo: repo, release: tag, asset: assetName, assetId: up.id, start: start, length: len });
      if (onProgress) onProgress(i + 1, count, len);
    }
    const prev = this.manifest.files[cp];
    this.manifest.files[cp] = {
      name: baseOf(cp), path: cp, size: size, hash: hash, type: 'file',
      created: (prev && prev.created) || Date.now(), modified: Date.now(), parts: entryParts
    };
    ensureParents(this.manifest, cp);
    return this.manifest.files[cp];
  }

  async get(cloudPath, outPath, opts, onProgress) {
    const cp = normPath(cloudPath);
    const e = this.manifest.files[cp];
    if (!e) { const err = new Error('file not found: ' + cp); err.code = 'file_not_found'; throw err; }
    if (e.type === 'folder') { const err = new Error('that is a folder'); err.code = 'path_not_found'; throw err; }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const fd = fs.openSync(outPath, 'w');
    try {
      for (let i = 0; i < e.parts.length; i++) {
        const part = e.parts[i];
        const tmp = path.join(cacheDirFor(this.owner), 'part-' + Date.now() + '-' + i);
        await this.gh.downloadAsset(this.owner, part.repo, part.assetId, tmp, null,
          { tag: part.release, name: part.asset });
        const buf = fs.readFileSync(tmp);
        fs.writeSync(fd, buf, 0, buf.length, part.start);
        try { fs.unlinkSync(tmp); } catch (err) { }
        if (onProgress) onProgress(i + 1, e.parts.length, buf.length);
      }
    } finally { fs.closeSync(fd); }
    if (opts && opts.hashCheck) {
      const got = await sha256File(outPath);
      if (got !== e.hash) { const err = new Error('hash mismatch'); err.code = 'hash_mismatch'; throw err; }
    }
    return outPath;
  }

  /*
   * Delete a file, or a folder and everything under it.
   *
   * The default is a move to the recycle bin: the manifest entry leaves
   * files and the uploads stay. Nothing on GitHub is touched, so an
   * accidental delete costs one command to undo.
   *
   * opts.purge deletes the assets for real and cannot be undone.
   */
  async rm(cloudPath, opts) {
    const o = opts || {};
    const cp = normPath(cloudPath);
    const e = this.manifest.files[cp];
    if (!e) { const err = new Error('file not found: ' + cp); err.code = 'file_not_found'; throw err; }

    /* A folder takes its contents with it, and a folder is not a leaf. */
    const victims = [cp];
    if (e.type === 'folder') {
      const prefix = cp === '/' ? '/' : cp + '/';
      for (const key of Object.keys(this.manifest.files)) {
        if (key !== cp && key.indexOf(prefix) === 0) victims.push(key);
      }
    }

    for (const v of victims) {
      const entry = this.manifest.files[v];
      if (!entry) continue;
      if (o.purge) {
        for (const part of entry.parts) {
          try { await this.gh.deleteAsset(this.owner, part.repo, part.assetId); }
          catch (err) { this.log('part already gone: ' + part.asset); }
        }
      } else {
        entry.deletedAt = Date.now();
        entry.originalPath = v;
        this.manifest.trash[v] = entry;
        this.manifest.trashOrder.push(v);
      }
      delete this.manifest.files[v];
    }
    return victims.length;
  }

  /* Everything waiting in the recycle bin, newest first. */
  listTrash() {
    const out = [];
    for (const key of this.manifest.trashOrder) {
      const e = this.manifest.trash[key];
      if (e) out.push(e);
    }
    out.sort(function (a, b) { return (b.deletedAt || 0) - (a.deletedAt || 0); });
    return out;
  }

  /*
   * Put a deleted file back where it was.
   *
   * The path is the one it had when deleted, which is also the key in the
   * trash. A file that has since been recreated at that path is not
   * overwritten: the restore fails so the newer file survives.
   */
  restore(cloudPath) {
    const cp = normPath(cloudPath);
    const e = this.manifest.trash[cp];
    if (!e) { const err = new Error('not in the recycle bin: ' + cp); err.code = 'file_not_found'; throw err; }
    if (this.manifest.files[cp]) {
      const err = new Error('something already lives at ' + cp);
      err.code = 'path_exists';
      throw err;
    }
    delete e.deletedAt;
    delete e.originalPath;
    e.modified = Date.now();
    this.manifest.files[cp] = e;
    delete this.manifest.trash[cp];
    this.manifest.trashOrder = this.manifest.trashOrder.filter(function (k) { return k !== cp; });
    ensureParents(this.manifest, cp);
    return e;
  }

  /*
   * Empty the recycle bin, or one entry from it.
   *
   * This is the only place a delete becomes permanent, which is why it is a
   * separate call rather than a flag on rm.
   */
  async purge(cloudPath) {
    /*
     * Purging a folder takes its whole subtree, the same way rm does. Without
     * this a purge of one directory would leave its children in the bin, and
     * the assets behind them would never be released - the opposite of what
     * the caller asked for.
     */
    let keys;
    if (!cloudPath) {
      keys = this.manifest.trashOrder.slice();
    } else {
      const cp = normPath(cloudPath);
      const prefix = cp === '/' ? '/' : cp + '/';
      keys = this.manifest.trashOrder.filter(function (k) {
        return k === cp || k.indexOf(prefix) === 0;
      });
    }
    let n = 0;
    for (const key of keys) {
      const e = this.manifest.trash[key];
      if (!e) continue;
      for (const part of e.parts) {
        try { await this.gh.deleteAsset(this.owner, part.repo, part.assetId); }
        catch (err) { this.log('part already gone: ' + part.asset); }
      }
      delete this.manifest.trash[key];
      this.manifest.trashOrder = this.manifest.trashOrder.filter(function (k) { return k !== key; });
      n++;
    }
    return n;
  }

  list(cloudPath, opts) {
    const o = opts || {};
    const cp = normPath(cloudPath);
    const out = [];
    for (const key of Object.keys(this.manifest.files)) {
      if (key === cp) continue;
      if (o.recursive) { if (key.indexOf(cp === '/' ? '/' : cp + '/') !== 0) continue; }
      else if (parentOf(key) !== cp) continue;
      out.push(this.manifest.files[key]);
    }
    out.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return out;
  }

  async flush() {
    const repo = await this.ensureRepo();
    if (this.gh.ensureReleasable) await this.gh.ensureReleasable(this.owner, repo);
    /*
     * The replacement manifest is written to a fresh volume, and only then is
     * the previous volume's file.json removed.
     *
     * A release cannot hold two assets with the same name, so a replacement
     * cannot be staged inside the release it replaces - uploading the new
     * file.json would either be rejected or, as the old code did, require
     * deleting the live manifest first and leaving the cloud with none.
     * Moving to a new volume is what lets the new manifest exist before the
     * old one goes away, so a concurrent pull never meets a release that has
     * lost its manifest.
     *
     * The volume tag doubles as a coarse compare-and-swap: two writers that
     * start from the same volume aim at the same tag, so one createRelease or
     * upload fails instead of silently overwriting the other.
     */
    const next = (this.manifest.volume || 1) + 1;
    const tag = 'manifest-v' + next;
    let rel = await this.gh.getRelease(this.owner, repo, tag);
    if (!rel) rel = await this.gh.createRelease(this.owner, repo, tag, tag);
    const tmp = path.join(cacheDirFor(this.owner), MANIFEST_NAME);
    this.manifest.updated = Date.now();
    this.manifest.volume = next;
    fs.writeFileSync(tmp, JSON.stringify(this.manifest), 'utf8');

    /* Upload the replacement before touching the old one. */
    const up = await this.gh.uploadAsset(this.owner, repo, rel.id, tmp, MANIFEST_NAME);
    try { fs.unlinkSync(tmp); } catch (e) { }

    /*
     * Now the superseded manifests can go. Every older manifest this repo
     * still holds is removed rather than only volume next-1, because a repo
     * can carry a stale manifest at a non-adjacent volume once writers have
     * moved between repositories. A failure here leaves an older snapshot
     * behind; pull orders volumes newest-first, so it is shadowed and
     * harmless, and is not worth failing a write that has already succeeded.
     */
    const stale = await this.gh.listReleases(this.owner, repo);
    for (const s of stale) {
      if (manifestVolume(s.tag_name) >= next) continue;
      for (const a of (s.assets || [])) {
        if (a.name !== MANIFEST_NAME) continue;
        try { await this.gh.deleteAsset(this.owner, repo, a.id); } catch (e) { }
        break;
      }
    }
    return up;
  }

  mkdir(cloudPath) {
    const cp = normPath(cloudPath);
    if (this.manifest.files[cp]) return this.manifest.files[cp];
    this.manifest.files[cp] = { name: baseOf(cp), path: cp, size: 0, hash: '', type: 'folder', created: Date.now(), modified: Date.now(), parts: [] };
    ensureParents(this.manifest, cp);
    return this.manifest.files[cp];
  }

  stat(cloudPath) { return this.manifest.files[normPath(cloudPath)] || null; }

  totalBytes() {
    let n = 0;
    for (const k of Object.keys(this.manifest.files)) n += this.manifest.files[k].size || 0;
    return n;
  }
}

/*
 * A stable, short fingerprint of a cloud path. Part asset names are built
 * from it so that two files with the same base name - /a/report.pdf and
 * /b/report.pdf - never land on the same asset name and delete each other.
 * FNV-1a is chosen over the SHA-256 already in the net layer because this is
 * only a naming tie-breaker, not a content check: it must be cheap and
 * deterministic, and a collision would merely reintroduce the bug it fixes,
 * not corrupt data.
 */
function shortHash(s) {
  let h = 1469598103934665603n;
  const prime = 1099511628211n;
  for (const c of Buffer.from(s, 'utf8')) {
    h = ((h ^ BigInt(c)) * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

/*
 * The N in a "manifest-vN" tag, or 0 for anything else. pull sorts releases
 * with it so the newest snapshot is merged first regardless of the order the
 * API happens to return.
 */
function manifestVolume(tag) {
  const p = 'manifest-v';
  if (typeof tag !== 'string' || tag.indexOf(p) !== 0) return 0;
  const n = parseInt(tag.slice(p.length), 10);
  return isNaN(n) ? 0 : n;
}

function mergeManifest(into, doc) {
  if (!doc || typeof doc !== 'object') return;
  const files = doc.files || {};
  for (const k of Object.keys(files)) if (!into.files[k]) into.files[k] = files[k];

  /*
   * The recycle bin merges the same way the live tree does, and for the same
   * reason: a volume that knows about a deleted file is the only place that
   * fact is recorded, so dropping it would make the file unrecoverable.
   */
  const trash = doc.trash || {};
  for (const k of Object.keys(trash)) {
    if (into.trash[k]) continue;
    into.trash[k] = trash[k];
    into.trashOrder.push(k);
  }
  if (doc.volume && doc.volume > into.volume) into.volume = doc.volume;
}

function ensureParents(man, cp) {
  let p = parentOf(cp);
  while (p) {
    if (!man.files[p]) {
      man.files[p] = { name: baseOf(p) || '/', path: p, size: 0, hash: '', type: 'folder', created: Date.now(), modified: Date.now(), parts: [] };
    }
    if (p === '/') break;
    p = parentOf(p);
  }
}

function copyRange(from, to, start, len) {
  const inFd = fs.openSync(from, 'r');
  const outFd = fs.openSync(to, 'w');
  const size = 4 * 1024 * 1024;
  const buf = Buffer.alloc(size);
  let done = 0;
  try {
    while (done < len) {
      const want = Math.min(size, len - done);
      const got = fs.readSync(inFd, buf, 0, want, start + done);
      if (got <= 0) break;
      fs.writeSync(outFd, buf, 0, got);
      done += got;
    }
  } finally { fs.closeSync(inFd); fs.closeSync(outFd); }
}

