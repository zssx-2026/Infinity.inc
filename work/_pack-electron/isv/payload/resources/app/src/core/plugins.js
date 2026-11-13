/*
 * plugins.js - the plugin subsystem (chapter 11 of the book, and the part
 * InfinityStudio drives from the outside).
 *
 * A plugin is a directory. That is the whole contract:
 *
 *   plugins/<id>/plugin.json     the manifest
 *   plugins/<id>/<entry>         an ESM module exporting register()
 *
 * Nothing is downloaded. Installing means copying a directory the user
 * already names, then hashing every byte of what arrived against the
 * manifest - a plugin whose files do not match is removed rather than
 * trusted. The loader is deliberately small: one module, one manifest,
 * a fixed register() shape, and routes the plugin can add.
 *
 * Why a directory rather than a container: the rack is local, the plugins
 * are local, and a format that needs a packer is a format nobody reads.
 * Infinity Toolbox's .itbt is the right answer for a Windows program that
 * ships one file to a user; here the user is the same person who owns the
 * directory, so the directory is the honest unit.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const API_VERSION = 1;

/* What a manifest may say. `files` maps each declared relative path to the
 * sha256 the installer checked; it is the reason a plugin can be re-verified
 * at load time rather than only at install time. */
export function manifestShape() {
  return {
    id: '', name: '', version: '', description: '',
    entry: 'main.js', api: API_VERSION,
    enabled: true, files: {}
  };
}

/* A plugin id becomes a directory name, so it is validated as one. */
export function validId(id) {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
}

/* A relative path inside the plugin directory: no absolute, no drive letter,
 * no traversal, no empty. This is the one check that keeps a manifest from
 * naming anything outside its own folder. */
export function safeRel(p) {
  if (typeof p !== 'string' || !p) return '';
  const s = p.replace(/\\/g, '/');
  if (s.startsWith('/') || /^[a-zA-Z]:/.test(s)) return '';
  const parts = s.split('/');
  if (!parts.length || parts.some((x) => x === '' || x === '.' || x === '..')) return '';
  return parts.join('/');
}

export function sha256File(p) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return h.digest('hex');
}

/* The stored root. It is created on demand: an installation with no plugins
 * yet is a normal state, not an error. */
export class PluginStore {
  constructor(root) {
    this.root = root;
    this.plugins = new Map();   // id -> manifest record
    this.routes = new Map();    // id -> the routes it registered on its last load
    this.loaded = [];
    this.rejected = [];
    this.ensure();
  }

  ensure() {
    fs.mkdirSync(this.root, { recursive: true });
  }

  dir(id) {
    return path.join(this.root, id);
  }

  manifestPath(id) {
    return path.join(this.root, id, 'plugin.json');
  }

  list() {
    const out = [];
    let names;
    try { names = fs.readdirSync(this.root, { withFileTypes: true }); } catch { return out; }
    for (const e of names) {
      if (!e.isDirectory()) continue;
      const rec = this.read(e.name);
      if (rec) out.push(rec);
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  }

  read(id) {
    const mp = this.manifestPath(id);
    if (!fs.existsSync(mp)) return null;
    let raw;
    try { raw = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch { return null; }
    if (!raw || typeof raw !== 'object') return null;
    return {
      id: raw.id || id,
      name: raw.name || raw.id || id,
      version: raw.version || '',
      description: raw.description || '',
      entry: raw.entry || 'main.js',
      api: raw.api == null ? API_VERSION : Number(raw.api),
      enabled: raw.enabled === undefined ? true : !!raw.enabled,
      files: raw.files && typeof raw.files === 'object' ? raw.files : {},
      dir: this.dir(id)
    };
  }

  has(id) {
    return validId(id) && fs.existsSync(this.manifestPath(id));
  }

  /* Copy a directory in, verifying every file against the manifest it
   * carries. Returns the record; throws with a reason a client can show. */
  install(from, opts) {
    const o = opts || {};
    if (!fs.existsSync(from) || !fs.statSync(from).isDirectory()) {
      throw new Error('source is not a directory');
    }
    const srcManifest = path.join(from, 'plugin.json');
    if (!fs.existsSync(srcManifest)) throw new Error('source has no plugin.json');
    let m;
    try { m = JSON.parse(fs.readFileSync(srcManifest, 'utf8')); } catch { throw new Error('source plugin.json is not JSON'); }
    if (!validId(m.id)) throw new Error('manifest id is missing or not a usable directory name');
    if (!m.name || typeof m.name !== 'string') throw new Error('manifest name is required');
    const entry = safeRel(m.entry || 'main.js');
    if (!entry) throw new Error('manifest entry must be a relative file path');
    if (!fs.existsSync(path.join(from, entry))) throw new Error('entry file is missing: ' + entry);
    if (this.has(m.id) && !o.overwrite) {
      throw new Error('already installed: ' + m.id + ' (pass overwrite to replace)');
    }

    /* Hash what is about to be copied, before it is copied. */
    const files = {};
    for (const rel of walkFiles(from)) {
      files[rel] = sha256File(path.join(from, rel));
    }
    const declared = m.files && typeof m.files === 'object' ? m.files : {};
    for (const rel of Object.keys(declared)) {
      if (rel === 'plugin.json') continue;   // see walkFiles: the manifest is not self-hashed
      const safe = safeRel(rel);
      if (!safe || files[safe] === undefined) throw new Error('manifest names a file that is not present: ' + rel);
      if (String(declared[rel]).toLowerCase() !== files[safe]) {
        throw new Error('sha256 mismatch for ' + rel + ' (manifest ' + String(declared[rel]).slice(0, 12) + ' vs ' + files[safe].slice(0, 12) + ')');
      }
    }

    const record = {
      id: m.id,
      name: m.name,
      version: m.version || '',
      description: m.description || '',
      entry: entry,
      api: m.api == null ? API_VERSION : Number(m.api),
      enabled: m.enabled === undefined ? true : !!m.enabled,
      files: files
    };

    const dest = this.dir(m.id);
    const staging = dest + '.staging-' + process.pid;
    const previous = dest + '.previous-' + process.pid;
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(previous, { recursive: true, force: true });
    fs.cpSync(from, staging, { recursive: true });
    /* The manifest on disk records what was actually hashed, so a later
     * load can re-verify without trusting the source again. */
    fs.writeFileSync(path.join(staging, 'plugin.json'), JSON.stringify(record, null, 2) + '\n', 'utf8');
    let hadOld = false;
    if (fs.existsSync(dest)) { fs.renameSync(dest, previous); hadOld = true; }
    fs.renameSync(staging, dest);
    if (hadOld) fs.rmSync(previous, { recursive: true, force: true });
    return this.read(m.id);
  }

  remove(id) {
    if (!this.has(id)) return false;
    const dir = this.dir(id);
    const retired = path.join(this.root, '_removed-' + id + '-' + process.pid);
    fs.renameSync(dir, retired);
    this.plugins.delete(id);
    this.loaded = this.loaded.filter((x) => x.id !== id);
    this.routes.delete(id);
    fs.rmSync(retired, { recursive: true, force: true });
    return true;
  }

  setEnabled(id, on) {
    const rec = this.read(id);
    if (!rec) return null;
    rec.enabled = !!on;
    fs.writeFileSync(this.manifestPath(id), JSON.stringify(rec, null, 2) + '\n', 'utf8');
    return this.read(id);
  }

  /* Re-hash every declared file of every plugin. A plugin that has been
   * edited after it was installed is reported, not silently trusted. */
  verify() {
    const out = [];
    for (const rec of this.list()) {
      const problems = [];
      const entry = safeRel(rec.entry);
      if (!entry) problems.push('entry is not a safe relative path');
      else if (!fs.existsSync(path.join(rec.dir, entry))) problems.push('entry is missing');
      for (const rel of Object.keys(rec.files)) {
        if (rel === 'plugin.json') continue;
        const safe = safeRel(rel);
        if (!safe) { problems.push('unsafe path in manifest: ' + rel); continue; }
        const abs = path.join(rec.dir, safe);
        if (!fs.existsSync(abs)) { problems.push('missing file: ' + rel); continue; }
        const now = sha256File(abs);
        if (String(rec.files[rel]).toLowerCase() !== now) problems.push('sha256 mismatch: ' + rel);
      }
      out.push({ id: rec.id, ok: problems.length === 0, problems: problems });
    }
    return out;
  }
}

/* Every file under a directory, as plugin-relative posix paths, sorted so
 * the manifest is byte-stable across machines. */
export function walkFiles(dir, base) {
  const rel = base || '';
  const out = [];
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    /* plugin.json is the manifest itself: hashing it would hash the file that
     * records the hashes, which can never match after install rewrites it. */
    if (e.name === 'plugin.json') continue;
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const r = rel ? rel + '/' + e.name : e.name;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(abs, r));
    else out.push(r);
  }
  return out.sort();
}

/* Load and register. A plugin that throws during register is reported and
 * left disabled-in-place: one bad plugin must not take the server down. */
export async function loadPlugins(store, ctx) {
  const loaded = [];
  const rejected = [];
  /* Start from an empty route table. A disabled or removed plugin must lose
   * its routes too, and the only way to guarantee that is to rebuild the
   * whole table on every load rather than adding to what is already there. */
  store.routes.clear();
  for (const rec of store.list()) {
    if (!rec.enabled) { rejected.push({ id: rec.id, reason: 'disabled' }); continue; }
    const entry = safeRel(rec.entry);
    if (!entry || !fs.existsSync(path.join(rec.dir, entry))) {
      rejected.push({ id: rec.id, reason: 'entry missing' }); continue;
    }
    if (rec.api !== API_VERSION) {
      rejected.push({ id: rec.id, reason: 'unsupported api ' + rec.api }); continue;
    }
    try {
      const mod = await import(pathToFileURL(path.join(rec.dir, entry)).href);
      if (typeof mod.register !== 'function') {
        rejected.push({ id: rec.id, reason: 'no register() export' }); continue;
      }
      const got = await mod.register(ctx || {}) || {};
      const routes = Array.isArray(got.routes) ? got.routes.filter((r) => r && r.method && r.path && typeof r.handler === 'function') : [];
      for (const r of routes) {
        if (!safeRel(String(r.path).replace(/^\//, '').replace(/\/$/, ''))) {
          throw new Error('route path is not safe: ' + r.path);
        }
      }
      loaded.push({ id: rec.id, name: rec.name, version: rec.version, routes: routes.length });
      store.routes.set(rec.id, routes);
    } catch (e) {
      rejected.push({ id: rec.id, reason: String((e && e.message) || e) });
    }
  }
  store.loaded = loaded;
  store.rejected = rejected;
  return { loaded: loaded, rejected: rejected };
}
