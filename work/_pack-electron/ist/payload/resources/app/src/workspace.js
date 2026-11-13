/*
 * workspace.js - the .is-ws file: what the Studio has open, and what it knows
 * about the projects it opened.
 *
 * A workspace is a small, honest JSON document. It holds the components the
 * user enabled, the projects they opened (path, component, when) and the file
 * associations they accepted. It holds no bytes and no secrets - the projects
 * themselves live in their own containers.
 *
 *   { format: "is-ws", version: 1, name, created, updated,
 *     components: [], projects: [], associations: [] }
 *
 * Two rules make it safe to hand to a UI that autosaves:
 *   - validate before write: a malformed workspace is refused, not written;
 *   - write atomically (tmp + fsync + rename): a crash mid-save leaves the
 *     previous good workspace in place instead of a truncated one.
 *
 * API
 *   createWorkspace({name, path}) -> {ok, path, workspace}
 *   saveWorkspace(path, workspace)-> {ok, path, bytes, sha256}
 *   loadWorkspace(path)           -> {ok, workspace, path} | {ok:false, code}
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const WORKSPACE_FORMAT = 'is-ws';
export const WORKSPACE_VERSION = 1;
export const WORKSPACE_EXTENSION = '.is-ws';

function fail(code, message, extra) {
  return Object.assign({ ok: false, code: code, message: message }, extra || {});
}

function nowIso() {
  return new Date().toISOString();
}

function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0);
}

/* Structural validation. Deliberately strict about the fields the Studio
 * reads back, and deliberately tolerant about extra ones a newer build may
 * have added - a workspace written by a newer Studio must still open here. */
export function validateWorkspace(ws) {
  if (!ws || typeof ws !== 'object' || Array.isArray(ws)) return fail('BAD_WORKSPACE', 'workspace must be a JSON object');
  if (ws.format !== WORKSPACE_FORMAT) {
    return fail('BAD_FORMAT', 'workspace format is ' + JSON.stringify(ws.format) + ', expected ' + JSON.stringify(WORKSPACE_FORMAT));
  }
  const version = Number(ws.version);
  if (!Number.isInteger(version) || version < 1) return fail('BAD_VERSION', 'workspace version is ' + JSON.stringify(ws.version));
  if (version > WORKSPACE_VERSION) {
    return fail('VERSION_TOO_NEW', 'workspace v' + version + ' is newer than this build (v' + WORKSPACE_VERSION + ')', { version: version });
  }
  if (typeof ws.name !== 'string' || !ws.name.trim()) return fail('BAD_FIELD', 'workspace name must be a non-empty string');
  if (ws.created !== undefined && typeof ws.created !== 'string') return fail('BAD_FIELD', 'workspace created must be an ISO string');
  if (ws.components !== undefined && !isStringArray(ws.components)) return fail('BAD_FIELD', 'workspace components must be an array of component ids');
  if (ws.projects !== undefined && !Array.isArray(ws.projects)) return fail('BAD_FIELD', 'workspace projects must be an array');
  for (const p of ws.projects || []) {
    if (!p || typeof p !== 'object') return fail('BAD_FIELD', 'every project entry must be an object');
    if (typeof p.path !== 'string' || !p.path) return fail('BAD_FIELD', 'every project entry needs a path');
    if (p.component !== undefined && typeof p.component !== 'string') return fail('BAD_FIELD', 'project component must be a string');
  }
  if (ws.associations !== undefined && !Array.isArray(ws.associations)) return fail('BAD_FIELD', 'workspace associations must be an array');
  for (const a of ws.associations || []) {
    if (!a || typeof a !== 'object') return fail('BAD_FIELD', 'every association entry must be an object');
    if (typeof a.ext !== 'string' || !a.ext) return fail('BAD_FIELD', 'every association entry needs an ext');
  }
  return { ok: true };
}

/* Create a workspace in memory, and on disk when a path is given. */
export function createWorkspace(input) {
  const opts = input || {};
  const name = typeof opts.name === 'string' ? opts.name.trim() : '';
  if (!name) return fail('BAD_INPUT', 'createWorkspace needs a name');
  const created = opts.created || nowIso();
  const ws = {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    name: name,
    created: created,
    updated: created,
    components: Array.isArray(opts.components) ? opts.components.slice() : [],
    projects: Array.isArray(opts.projects) ? opts.projects.slice() : [],
    associations: Array.isArray(opts.associations) ? opts.associations.slice() : []
  };
  const check = validateWorkspace(ws);
  if (!check.ok) return check;
  if (!opts.path) return { ok: true, path: null, workspace: ws };

  const written = saveWorkspace(opts.path, ws);
  if (!written.ok) return written;
  return { ok: true, path: written.path, workspace: ws, bytes: written.bytes, sha256: written.sha256 };
}

/* Serialise deterministically: same workspace, same bytes. */
export function serializeWorkspace(ws) {
  const ordered = {
    format: ws.format,
    version: ws.version,
    name: ws.name,
    created: ws.created,
    updated: ws.updated || ws.created,
    components: ws.components || [],
    projects: ws.projects || [],
    associations: ws.associations || []
  };
  return JSON.stringify(ordered, null, 2) + '\n';
}

export function saveWorkspace(filePath, ws) {
  if (typeof filePath !== 'string' || !filePath) return fail('BAD_INPUT', 'saveWorkspace needs a target path');
  const check = validateWorkspace(ws);
  if (!check.ok) return check;

  const text = serializeWorkspace(ws);
  const tmp = filePath + '.tmp-' + process.pid + '-' + Date.now().toString(36);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tmp, text, 'utf8');
    const fd = fs.openSync(tmp, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) { /* best effort */ }
    return fail('WRITE_FAILED', 'cannot write ' + filePath + ': ' + e.message, { path: filePath });
  }
  return {
    ok: true,
    path: filePath,
    bytes: Buffer.byteLength(text, 'utf8'),
    sha256: createHash('sha256').update(text, 'utf8').digest('hex')
  };
}

export function loadWorkspace(filePath) {
  if (typeof filePath !== 'string' || !filePath) return fail('BAD_INPUT', 'loadWorkspace needs a path');
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return fail('READ_FAILED', 'cannot read ' + filePath + ': ' + e.message, { path: filePath });
  }
  let ws;
  try {
    ws = JSON.parse(text);
  } catch (e) {
    return fail('BAD_JSON', 'workspace is not valid JSON: ' + e.message, { path: filePath });
  }
  const check = validateWorkspace(ws);
  if (!check.ok) return Object.assign(check, { path: filePath });
  return { ok: true, path: filePath, workspace: ws };
}

/* Small conveniences the Studio UI uses. They mutate the workspace they are
 * given and return it, so the caller keeps one object to autosave. */
export function addComponent(ws, componentId) {
  if (!ws || typeof componentId !== 'string' || !componentId) return ws;
  ws.components = ws.components || [];
  if (!ws.components.includes(componentId)) ws.components.push(componentId);
  ws.updated = nowIso();
  return ws;
}

export function removeComponent(ws, componentId) {
  if (!ws || !Array.isArray(ws.components)) return ws;
  ws.components = ws.components.filter((c) => c !== componentId);
  ws.updated = nowIso();
  return ws;
}

export function addProject(ws, entry) {
  if (!ws || !entry || typeof entry.path !== 'string' || !entry.path) return ws;
  ws.projects = ws.projects || [];
  const at = ws.projects.findIndex((p) => p.path === entry.path);
  const record = {
    path: entry.path,
    component: entry.component || 'studio',
    added: entry.added || nowIso()
  };
  if (entry.codec !== undefined) record.codec = entry.codec;
  if (entry.bytes !== undefined) record.bytes = entry.bytes;
  if (at >= 0) ws.projects[at] = record;
  else ws.projects.push(record);
  ws.updated = nowIso();
  return ws;
}

export function removeProject(ws, projectPath) {
  if (!ws || !Array.isArray(ws.projects)) return ws;
  ws.projects = ws.projects.filter((p) => p.path !== projectPath);
  ws.updated = nowIso();
  return ws;
}

/* A compact description for the UI: what is in here, without the file list. */
export function workspaceSummary(ws) {
  if (!ws) return null;
  return {
    name: ws.name,
    version: ws.version,
    created: ws.created,
    updated: ws.updated,
    components: (ws.components || []).slice(),
    projects: (ws.projects || []).length,
    associations: (ws.associations || []).length,
    extension: WORKSPACE_EXTENSION
  };
}

export default {
  WORKSPACE_FORMAT, WORKSPACE_VERSION, WORKSPACE_EXTENSION,
  createWorkspace, saveWorkspace, loadWorkspace, validateWorkspace,
  serializeWorkspace, addComponent, removeComponent, addProject, removeProject, workspaceSummary
};
