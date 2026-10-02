/*
 * localfs.js - the local side of the file manager.
 *
 * Everything that touches the real disk lives here, so the UI never has to
 * know whether it is looking at C: or at a mount point. Each entry carries
 * the same shape the cloud side produces, which is what lets one panel
 * renderer draw both panes.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/* Which drive letters respond. A missing letter is skipped, never an error. */
export function drives() {
  if (process.platform !== 'win32') return ['/'];;
  const out = [];
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i) + ':' + path.sep;
    try {
      fs.accessSync(letter);
      out.push(letter);
    } catch (e) { }
  }
  return out.length ? out : ['C:' + path.sep];
}

export function homeDir() {
  return os.homedir() || (process.platform === 'win32' ? 'C:' + path.sep : '/');
}

export function isHidden(name) {
  return name.length > 1 && name.charAt(0) === '.';
}

export function statLocal(p) {
  const s = fs.statSync(p);
  const name = path.basename(p) || p;
  return {
    name: name,
    path: p,
    type: s.isDirectory() ? 'folder' : 'file',
    size: s.isDirectory() ? 0 : s.size,
    mtime: s.mtimeMs,
    ctime: s.birthtimeMs || s.ctimeMs,
    hidden: isHidden(name)
  };
}

/*
 * Read one directory.
 *
 * A symbolic link is followed for its type but not for its size, so a link
 * that points nowhere still appears in the list instead of vanishing.
 */
export function listLocal(dir, opts) {
  const o = opts || {};
  const out = [];
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { return out; }
  for (const name of names) {
    if (!o.showHidden && isHidden(name)) continue;
    const p = path.join(dir, name);
    let s;
    try { s = fs.lstatSync(p); } catch (e) { continue; }
    if (s.isSymbolicLink()) { try { s = fs.statSync(p); } catch (e) { } }
    out.push({
      name: name,
      path: p,
      type: s.isDirectory() ? 'folder' : 'file',
      size: s.isDirectory() ? 0 : s.size,
      mtime: s.mtimeMs,
      ctime: s.birthtimeMs || s.ctimeMs,
      hidden: isHidden(name)
    });
  }
  return out;
}

/* Sorting is by key and direction, and folders always lead. */
export function sortEntries(items, key, dir) {
  const k = key || 'name';
  const d = dir === -1 ? -1 : 1;
  const copy = items.slice();
  copy.sort(function (a, b) {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    let r = 0;
    if (k === 'size') r = (a.size || 0) - (b.size || 0);
    else if (k === 'mtime') r = (a.mtime || 0) - (b.mtime || 0);
    else if (k === 'ctime') r = (a.ctime || 0) - (b.ctime || 0);
    else r = String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase());
    return r * d;
  });
  return copy;
}

export function mkdirLocal(p) { fs.mkdirSync(p, { recursive: true }); return p; }
export function renameLocal(from, to) { fs.renameSync(from, to); return to; }

/* A name that does not collide, by appending " (2)", " (3)" and so on. */
export function uniqueName(dir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  let n = 2;
  while (fs.existsSync(candidate) && n < 9999) {
    candidate = path.join(dir, stem + ' (' + n + ')' + ext);
    n++;
  }
  return candidate;
}

export function fmtSize(n) {
  const v = Number(n) || 0;
  if (v < 1024) return v + ' B';
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let x = v / 1024;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return (x < 10 ? x.toFixed(1) : String(Math.round(x))) + ' ' + units[i];
}

export function fmtDate(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const pad = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/* The class of a name, which decides its colour in the list. */
export function iconFor(entry) {
  if (entry.type === 'folder') return 'dir';
  const ext = path.extname(entry.name).toLowerCase();
  if (['.exe', '.msi', '.bat', '.cmd', '.com', '.sh', '.app'].indexOf(ext) >= 0) return 'app';
  if (['.zip', '.7z', '.rar', '.tar', '.gz', '.xz', '.zst', '.iso'].indexOf(ext) >= 0) return 'arc';
  if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico'].indexOf(ext) >= 0) return 'img';
  if (['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'].indexOf(ext) >= 0) return 'aud';
  if (['.mp4', '.mkv', '.avi', '.mov', '.webm', '.wmv'].indexOf(ext) >= 0) return 'vid';
  if (['.js', '.ts', '.mjs', '.cjs', '.py', '.java', '.c', '.cpp', '.h', '.cs', '.go', '.rs', '.json', '.xml', '.yml', '.yaml'].indexOf(ext) >= 0) return 'code';
  if (['.txt', '.md', '.log', '.ini', '.cfg', '.conf'].indexOf(ext) >= 0) return 'text';
  if (['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'].indexOf(ext) >= 0) return 'doc';
  return 'file';
}

/* A streaming copy, so a multi-gigabyte file never enters memory. */
export function copyFile(from, to) {
  const size = 4 * 1024 * 1024;
  const buf = Buffer.alloc(size);
  const inFd = fs.openSync(from, 'r');
  const outFd = fs.openSync(to, 'w');
  try {
    for (;;) {
      const got = fs.readSync(inFd, buf, 0, size, null);
      if (got <= 0) break;
      fs.writeSync(outFd, buf, 0, got);
    }
  } finally {
    fs.closeSync(inFd);
    fs.closeSync(outFd);
  }
  try {
    const s = fs.statSync(from);
    fs.utimesSync(to, s.atime, s.mtime);
  } catch (e) { }
}

/*
 * Copy a file or a whole tree.
 *
 * onProgress receives (files, bytes, currentPath) and may return the string
 * "cancel" to stop. Returning a value rather than throwing is deliberate:
 * a cancelled copy leaves the files already written in place, which is what
 * a user who pressed escape expects to find.
 */
export function copyTree(from, to, onProgress) {
  const stats = { files: 0, bytes: 0 };
  const stop = { value: false };
  walkCopy(from, to, stats, onProgress, stop);
  stats.cancelled = stop.value;
  return stats;
}

function walkCopy(from, to, stats, onProgress, stop) {
  if (stop.value) return;
  let s;
  try { s = fs.statSync(from); } catch (e) { return; }
  if (s.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const n of fs.readdirSync(from)) {
      if (stop.value) return;
      walkCopy(path.join(from, n), path.join(to, n), stats, onProgress, stop);
    }
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  copyFile(from, to);
  stats.files++;
  stats.bytes += s.size;
  if (onProgress && onProgress(stats.files, stats.bytes, from) === 'cancel') stop.value = true;
}

export function moveLocal(from, to, onProgress) {
  try {
    fs.renameSync(from, to);
    return { files: 1, bytes: fs.statSync(to).size, renamed: true };
  } catch (e) {
    /* Across volumes a rename fails, so fall back to copy then delete. */
    const stats = copyTree(from, to, onProgress);
    removeTree(from);
    return stats;
  }
}

export function removeTree(p, onProgress) {
  let n = 0;
  let s;
  try { s = fs.lstatSync(p); } catch (e) { return 0; }
  if (s.isDirectory()) {
    for (const name of fs.readdirSync(p)) n += removeTree(path.join(p, name), onProgress);
    fs.rmdirSync(p);
  } else {
    fs.unlinkSync(p);
    n = 1;
  }
  if (onProgress) onProgress(n, 0, p);
  return n;
}

/* Every file under root whose name contains the text, case-insensitive. */
export function searchLocal(root, text, opts) {
  const o = opts || {};
  const limit = o.limit || 5000;
  const needle = String(text || '').toLowerCase();
  const out = [];
  const stack = [root];
  while (stack.length && out.length < limit) {
    const dir = stack.pop();
    let names;
    try { names = fs.readdirSync(dir); } catch (e) { continue; }
    for (const name of names) {
      const p = path.join(dir, name);
      let s;
      try { s = fs.lstatSync(p); } catch (e) { continue; }
      if (s.isDirectory()) { stack.push(p); continue; }
      if (!needle || name.toLowerCase().indexOf(needle) >= 0) {
        out.push({
          name: name, path: p, type: 'file', size: s.size,
          mtime: s.mtimeMs, ctime: s.birthtimeMs || s.ctimeMs, hidden: isHidden(name)
        });
      }
      if (out.length >= limit) break;
    }
  }
  return out;
}

