/*
 * apps/index.js - the sub-product registry.
 *
 * Every craft application lives in its own module next to this file. They are
 * loaded lazily and individually: a half-finished module must never take the
 * whole hub down, so a failed import is reported as a row with ok:false rather
 * than thrown at the caller.
 *
 * A module is usable when it exports capabilities() and run(). plan() is
 * optional and reported as such; META is optional but preferred because it
 * carries the codecs and hosts the tree already knows about.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* The order is the order the page renders them in: the code workbench first,
 * then the media craft tools, then the model client. Anything not listed here
 * is still discovered from disk, appended alphabetically. */
export const PREFERRED_ORDER = [
  'codecraft',
  'videocraft',
  'picturecraft',
  '3dcraft',
  'paintcraft',
  'animationcraft',
  'gamecraft',
  'audiocraft',
  'aicraft',
  'webviewer',
  'office',
  'packages',
  'integrations',
  'server'
];

const cache = new Map();

export function discover() {
  let names = [];
  try {
    names = fs.readdirSync(HERE)
      .filter((name) => name.endsWith('.js'))
      .filter((name) => name !== 'index.js')
      .map((name) => name.slice(0, -3));
  } catch (err) {
    return [];
  }
  const rank = (id) => {
    const at = PREFERRED_ORDER.indexOf(id);
    return at < 0 ? PREFERRED_ORDER.length : at;
  };
  return names.sort((a, b) => (rank(a) - rank(b)) || a.localeCompare(b));
}

export async function load(id) {
  const key = String(id || '').trim();
  if (!key) return { ok: false, id: key, error: 'MISSING_ID' };
  if (!/^[A-Za-z0-9_-]+$/.test(key)) return { ok: false, id: key, error: 'BAD_ID' };
  if (cache.has(key)) return cache.get(key);
  const file = path.join(HERE, key + '.js');
  let row;
  try {
    if (!fs.existsSync(file)) throw new Error('module not present');
    const mod = await import(pathToFileURL(file).href);
    const api = mod && (mod.default || mod);
    const hasCaps = typeof api.capabilities === 'function';
    const hasRun = typeof api.run === 'function';
    row = {
      ok: hasCaps && hasRun,
      id: key,
      file: file,
      meta: (mod && mod.META) || (api && api.META) || null,
      hasCapabilities: hasCaps,
      hasPlan: typeof api.plan === 'function',
      hasRun: hasRun,
      api: api,
      error: hasCaps && hasRun ? null : 'INCOMPLETE_MODULE'
    };
  } catch (err) {
    row = { ok: false, id: key, file: file, meta: null, hasCapabilities: false,
      hasPlan: false, hasRun: false, api: null, error: String((err && err.message) || err) };
  }
  cache.set(key, row);
  return row;
}

export async function list() {
  const ids = discover();
  const rows = [];
  for (const id of ids) {
    const row = await load(id);
    let caps = null;
    if (row.ok) {
      try { caps = row.api.capabilities(); } catch (err) { caps = null; }
    }
    rows.push({
      id: id,
      ok: row.ok,
      error: row.error,
      name: (caps && caps.name) || (row.meta && row.meta.name) || id,
      version: (caps && caps.version) || (row.meta && row.meta.version) || null,
      branch: (row.meta && row.meta.branch) || null,
      formats: (caps && caps.formats) || ((row.meta && row.meta.codecs) || []).map((c) => c.ext),
      hosts: (caps && caps.hosts) || (row.meta && row.meta.hosts) || [],
      features: (caps && caps.features) || [],
      implemented: !!(caps && caps.implemented),
      hasPlan: row.hasPlan,
      hasRun: row.hasRun
    });
  }
  return rows;
}

export async function call(id, action, input) {
  const row = await load(id);
  if (!row.ok) return { ok: false, id: id, action: action, error: row.error || 'MODULE_UNAVAILABLE' };
  const verb = String(action || 'capabilities').trim();
  try {
    if (verb === 'capabilities') return { ok: true, id: id, action: verb, result: row.api.capabilities() };
    if (verb === 'plan') {
      if (!row.hasPlan) return { ok: false, id: id, action: verb, error: 'PLAN_UNSUPPORTED' };
      const planned = row.api.plan(input && input.action, input || {});
      return { ok: planned.ok !== false, id: id, action: verb, result: planned };
    }
    const done = await row.api.run(verb, input || {});
    return { ok: done.ok !== false, id: id, action: verb, result: done };
  } catch (err) {
    return { ok: false, id: id, action: verb, error: String((err && err.message) || err) };
  }
}

export function resetCache() {
  cache.clear();
}

export default { PREFERRED_ORDER, discover, load, list, call, resetCache };
