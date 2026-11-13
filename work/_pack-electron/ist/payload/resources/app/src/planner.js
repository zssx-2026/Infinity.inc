/*
 * planner.js - from ticked boxes to a list of files with real sizes.
 *
 * A plan is the honest answer to "what will this install, and how big is it".
 * Every entry is resolved against the workspace and measured; anything that is
 * not there is reported as missing rather than counted as if it were. The
 * installer refuses to start on a plan with missing required parts, which is
 * the difference between an installer that fails halfway and one that never
 * starts a job it cannot finish.
 *
 * Where the files come from is not uniform, and pretending otherwise is how an
 * installer ends up shipping something that cannot run:
 *   - a command line face of a Node product is the multi-file layout: a 49 KiB
 *     launcher plus the shared runtime and bundle it needs;
 *   - a window face is a whole Electron shell directory, not one executable;
 *   - a native product (INT / ING) is a single built executable;
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PRODUCTS, WORKLOADS, expand, sourceLayout, FACES } from './catalog.js';

/* The two files a layout launcher cannot run without. They are shared by every
 * face of a product, so they are planned once. */
const SHARED = ['node.exe', 'app.cjs'];

function sha256Of(file) {
  const h = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1024 * 1024);
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      h.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

function measure(root, rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return { from: rel, to: rel, bytes: 0, sha256: null, missing: true };
  const st = fs.statSync(abs);
  return { from: rel, to: rel, bytes: st.size, sha256: sha256Of(abs), missing: false };
}

function walk(root, rel) {
  const out = [];
  const stack = [rel];
  while (stack.length) {
    const cur = stack.pop();
    const abs = path.join(root, cur);
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(r);
      else out.push(r);
    }
  }
  return out.sort();
}

export class Planner {
  constructor(root, target) {
    this.root = root;
    this.target = target || 'win-x64';
  }

  /* One artefact: where it comes from, where it goes, how big it is. */
  resolve(entry) {
    const layout = sourceLayout(entry.product, this.target);
    const out = [];
    if (entry.face === 'gui' && layout.shell && fs.existsSync(path.join(this.root, layout.shell))) {
      /* An Electron window is a directory: the executable is inert without the
       * runtime beside it, so the plan carries the whole tree. */
      for (const r of walk(this.root, layout.shell)) {
        out.push(Object.assign({ product: entry.product, face: entry.face, kind: 'shell' }, measure(this.root, r)));
      }
      return out;
    }
    let dir = layout.layout;
    if (!dir || !fs.existsSync(path.join(this.root, dir, entry.exe))) dir = layout.cpp;
    if (!dir) return [{ from: entry.exe, to: entry.exe, bytes: 0, sha256: null, missing: true, product: entry.product, face: entry.face, kind: 'exe' }];
    const rel = path.join(dir, entry.exe);
    const m = measure(this.root, rel);
    if (m.missing && layout.cpp && layout.cpp !== dir) {
      const alt = path.join(layout.cpp, entry.exe);
      const m2 = measure(this.root, alt);
      out.push(Object.assign({ product: entry.product, face: entry.face, kind: 'exe' }, m2));
      return out;
    }
    out.push(Object.assign({ product: entry.product, face: entry.face, kind: 'exe' }, m));
    return out;
  }

  /* The shared runtime and bundle, for products that ship a layout. */
  sharedFiles(product) {
    const layout = sourceLayout(product, this.target);
    if (!layout.layout) return [];
    const out = [];
    for (const name of SHARED) {
      const r = path.join(layout.layout, name);
      out.push(Object.assign({ product: product, face: null, kind: 'shared', shared: true }, measure(this.root, r)));
    }
    return out;
  }

  /* Build the plan. Returns the file list, the totals, and the parts that
   * could not be found so the UI can say so before anything is copied. */
  plan(workloadIds) {
    const entries = expand(workloadIds, this.target);
    const files = [];
    const seen = new Set();
    const products = new Set(entries.map((e) => e.product));

    for (const p of products) {
      for (const f of this.sharedFiles(p)) {
        if (seen.has(f.from)) continue;
        seen.add(f.from);
        files.push(f);
      }
    }
    for (const e of entries) {
      for (const f of this.resolve(e)) {
        if (seen.has(f.from)) continue;
        seen.add(f.from);
        files.push(f);
      }
    }

    const totalBytes = files.reduce((a, f) => a + (f.missing ? 0 : f.bytes), 0);
    const missing = files.filter((f) => f.missing);
    return {
      target: this.target,
      workloads: WORKLOADS.filter((w) => workloadIds.includes(w.id)).map((w) => ({ id: w.id, name: w.name })),
      products: Array.from(products),
      files: files,
      counts: { files: files.length, present: files.length - missing.length, missing: missing.length },
      totalBytes: totalBytes,
      totalText: human(totalBytes),
      missing: missing.map((f) => f.from),
      /* A required product with nothing to install is an error; a missing
       * optional one is a warning and the rest still installs. */
      blocking: missing.filter((f) => f.product === 'inc').map((f) => f.from)
    };
  }

  /* What is actually available in this workspace, per product and face - the
   * UI greys out what cannot be installed. */
  inventory() {
    const out = [];
    for (const p of PRODUCTS) {
      const layout = sourceLayout(p.id, this.target);
      const faces = {};
      for (const face of (FACES[p.id] || [])) {
        if (face === 'gui' && layout.shell && fs.existsSync(path.join(this.root, layout.shell))) {
          let t = 0;
          for (const r of walk(this.root, layout.shell)) t += fs.statSync(path.join(this.root, r)).size;
          faces[face] = t;
          continue;
        }
        const dirs = [layout.layout, layout.cpp].filter(Boolean);
        let size = 0;
        for (const d of dirs) {
          const abs = path.join(this.root, d, p.id + '_' + face + '.exe');
          if (fs.existsSync(abs)) { size = fs.statSync(abs).size; break; }
        }
        faces[face] = size;
      }
      out.push({ id: p.id, name: p.name, tagline: p.tagline, port: p.port, required: !!p.required, standalone: !!p.standalone, faces: faces });
    }
    return out;
  }
}

/* Apply a plan to a destination: copy every file, then hash what landed and
 * compare it against the plan. An install that copies and does not verify is
 * a claim, not an install. */
export function install(plan, dest) {
  const results = [];
  let bytes = 0;
  for (const f of plan.files) {
    if (f.missing) { results.push({ from: f.from, status: 'missing' }); continue; }
    const src = path.join(plan.root, f.from);
    const to = path.join(dest, f.to);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(src, to);
    const landed = sha256Of(to);
    bytes += fs.statSync(to).size;
    results.push({
      from: f.from,
      to: f.to,
      bytes: fs.statSync(to).size,
      sha256: landed,
      status: landed === f.sha256 ? 'ok' : 'hash-mismatch',
      expected: f.sha256
    });
  }
  const bad = results.filter((r) => r.status !== 'ok');
  return {
    ok: bad.length === 0,
    copied: results.filter((r) => r.status === 'ok').length,
    total: results.length,
    bytes: bytes,
    bytesText: human(bytes),
    failures: bad
  };
}

export function human(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + ' ' + units[i];
}
