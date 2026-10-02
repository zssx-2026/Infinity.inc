/*
 * fs-model.js - the file manager view of the world.
 *
 * Infinity File Manager shows the local disk and the cloud at the same time,
 * addressed the same way, so the tree and the copy machinery never have to
 * care which side a path belongs to.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/* The drives Explorer would show. */
export function localRoots() {
  const out = [];
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = letter + ':' + String.fromCharCode(92);
    try { if (fs.existsSync(root)) out.push({ name: letter + ':', path: root, type: 'folder' }); }
    catch (e) { }
  }
  return out;
}

export function homeDir() { return process.env.USERPROFILE || os.homedir(); }

/* One listing. An unreadable folder lists as empty rather than throwing. */
export function listLocal(dir) {
  let es;
  try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return []; }
  const out = [];
  for (const e of es) {
    const p = path.join(dir, e.name);
    let st = null;
    try { st = fs.statSync(p); } catch (x) { continue; }
    out.push({ name: e.name, path: p, type: e.isDirectory() ? 'folder' : 'file', size: e.isDirectory() ? 0 : st.size, modified: st.mtimeMs, created: st.birthtimeMs || st.ctimeMs });
  }
  return sortEntries(out);
}

/* Folders first, then by name, which is what Explorer does by default. */
export function sortEntries(items) {
  return items.slice().sort(function (a, b) {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function fmtSize(n) {
  if (n >= 1099511627776) return (n / 1099511627776).toFixed(2) + ' TB';
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}

export function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/* A three-letter tag so a row is readable without shipping artwork. */
export function iconFor(e) {
  if (e.type === 'folder') return '[+]';
  const n = e.name.toLowerCase();
  if (n.endsWith('.exe') || n.endsWith('.msi')) return '[E]';
  if (n.endsWith('.zip') || n.endsWith('.7z')) return '[Z]';
  if (n.endsWith('.png') || n.endsWith('.jpg') || n.endsWith('.ico')) return '[I]';
  if (n.endsWith('.js') || n.endsWith('.mjs') || n.endsWith('.c')) return '[C]';
  if (n.endsWith('.md') || n.endsWith('.txt') || n.endsWith('.json')) return '[T]';
  return '   ';
}

/* A Windows-style breadcrumb, so each part of the bar can be clickable. */
export function crumbs(p) {
  const parts = String(p).split(/[\\/]+/).filter((x) => x);
  const out = [];
  let acc = '';
  for (const seg of parts) {
    acc = acc ? acc + String.fromCharCode(92) + seg : seg;
    out.push({ label: seg, path: acc });
  }
  return out;
}

export function copyTree(from, to) {
  const st = fs.statSync(from);
  if (!st.isDirectory()) { fs.copyFileSync(from, to); return 1; }
  fs.mkdirSync(to, { recursive: true });
  let n = 0;
  for (const e of fs.readdirSync(from, { withFileTypes: true })) n += copyTree(path.join(from, e.name), path.join(to, e.name));
  return n;
}

export function removeTree(p) {
  let st;
  try { st = fs.lstatSync(p); } catch (e) { return 0; }
  if (!st.isDirectory()) { fs.unlinkSync(p); return 1; }
  let n = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) n += removeTree(path.join(p, e.name));
  fs.rmdirSync(p);
  return n + 1;
}

export function uniqueName(dir, name) {
  let candidate = name;
  let i = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    const dot = name.lastIndexOf('.');
    candidate = dot > 0 ? name.slice(0, dot) + ' (' + i + ')' + name.slice(dot) : name + ' (' + i + ')';
    i++;
  }
  return candidate;
}
