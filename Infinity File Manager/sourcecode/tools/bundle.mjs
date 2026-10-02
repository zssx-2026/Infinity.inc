/*
 * bundle.mjs - the ESM to CommonJS bundler, shared by every build.
 *
 * There is no bundler installed here, so this is it. It stays short because
 * the source is disciplined: one import per line, single quotes, no export
 * default, no dynamic import. Only the shapes actually used are rewritten;
 * anything else is passed through unchanged, so an unfamiliar construct
 * fails the build instead of quietly misbehaving at run time.
 */
import fs from 'node:fs';
import path from 'node:path';

const NL = String.fromCharCode(10);
const SQ = String.fromCharCode(39);

/* The quoted string in a line, or null. Single quotes only, because that is
 * what the source uses; accepting both would mean guessing at apostrophes. */
export function quoted(line) {
  const a = line.indexOf(SQ);
  if (a < 0) return null;
  const b = line.indexOf(SQ, a + 1);
  if (b < 0) return null;
  return { text: line.slice(a + 1, b), at: a };
}

/* Split a binding list on commas that are not inside braces. */
export function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map(function (x) { return x.trim(); }).filter(Boolean);
}

/* Turn "a as b" into "a: b"; leave "a" alone. */
export function aliasToKey(s) {
  const i = s.indexOf(' as ');
  if (i < 0) return s;
  return s.slice(0, i).trim() + ': ' + s.slice(i + 4).trim();
}

function isIdent(c) {
  if (c >= 'a' && c <= 'z') return true;
  if (c >= 'A' && c <= 'Z') return true;
  if (c >= '0' && c <= '9') return true;
  return c === '_' || c === '$';
}

/*
 * Rewrite one ESM module into a CommonJS body.
 *
 * Handled shapes:
 *   import X from 'p';
 *   import { a, b as c } from 'p';
 *   import * as X from 'p';
 *   export function|class|const|let|var NAME ...
 *   export { a, b as c };
 * Everything else is emitted unchanged.
 */
export function transform(text, key, here) {
  const out = [];
  const names = [];
  const fromDir = path.join(here, key);

  const keyFor = (spec) => {
    if (spec.charAt(0) !== '.') return spec;
    const abs = path.resolve(path.dirname(fromDir), spec);
    return path.relative(here, abs).split(path.sep).join('/');
  };

  for (const line of text.split(NL)) {
    const t = line.trim();

    /* A shebang is only legal on the first line of a script, not here. */
    if (t.slice(0, 2) === '#!') { out.push(''); continue; }

    if (t.slice(0, 7) === 'import ' && t.indexOf(' from ') > 0) {
      const q = quoted(t);
      if (q) {
        const fi = t.indexOf(' from ');
        const head = t.slice(7, fi).trim();
        const req = 'require(' + JSON.stringify(keyFor(q.text)) + ');';
        if (head.charAt(0) === '{') {
          const inner = head.slice(1, head.lastIndexOf('}'));
          out.push('const { ' + splitTop(inner).map(aliasToKey).join(', ') + ' } = ' + req);
        } else {
          let name = head;
          if (name.slice(0, 5) === '* as ') name = name.slice(5).trim();
          const comma = name.indexOf(',');
          if (comma > 0) name = name.slice(0, comma).trim();
          out.push('const ' + name + ' = ' + req);
        }
        continue;
      }
    }

    /* export { a, b as c }; contributes names and no code. */
    if (t.slice(0, 8) === 'export {') {
      const inner = t.slice(t.indexOf('{') + 1, t.lastIndexOf('}'));
      for (const s of splitTop(inner)) {
        const i = s.indexOf(' as ');
        names.push(i < 0 ? s : s.slice(i + 4).trim());
      }
      continue;
    }

    /* export <declaration> loses the keyword and registers the name. */
    if (t.slice(0, 7) === 'export ') {
      const rest = t.slice(7);
      const words = ['async function ', 'function ', 'class ', 'const ', 'let ', 'var '];
      let hit = null;
      for (const w of words) {
        if (rest.slice(0, w.length) !== w) continue;
        let j = w.length;
        while (j < rest.length && rest.charAt(j) === ' ') j++;
        let k = j;
        while (k < rest.length && isIdent(rest.charAt(k))) k++;
        if (k > j) hit = rest.slice(j, k);
        break;
      }
      if (hit) { names.push(hit); out.push(rest); continue; }
    }

    out.push(line);
  }

  for (const n of names) out.push('exports.' + n + ' = ' + n + ';');
  return out.join(NL);
}

export function importsOf(text) {
  const out = [];
  for (const line of text.split(NL)) {
    const t = line.trim();
    if (t.slice(0, 7) !== 'import ') continue;
    const q = quoted(t);
    if (q) out.push(q.text);
  }
  return out;
}

/* Walk the import graph from an entry file. Returns a Map of key to source. */
export function collect(entry, here) {
  const files = new Map();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    const key = path.relative(here, file).split(path.sep).join('/');
    if (files.has(key)) continue;
    let text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (e) { throw new Error('cannot read ' + file + ': ' + e.message); }
    files.set(key, text);
    for (const spec of importsOf(text)) {
      if (spec.charAt(0) !== '.') continue;
      const abs = path.resolve(path.dirname(file), spec);
      const k = path.relative(here, abs).split(path.sep).join('/');
      if (!files.has(k)) queue.push(abs);
    }
  }
  return files;
}

/*
 * Emit the registry.
 *
 * Module ids are the same relative paths the collector used, so a require()
 * inside the bundle resolves exactly like the import did in the source. A
 * specifier that is not in the registry falls through to Node's own require,
 * which is how node:fs and friends keep working inside the bundle.
 */
export function bundle(files, entryKey, here) {
  const parts = [];
  parts.push('/* Generated by bundle.mjs. Do not edit. */');
  parts.push('const __nativeRequire = require;');
  parts.push('const __modules = Object.create(null);');
  parts.push('const __cache = Object.create(null);');
  parts.push('function __require(id) {');
  parts.push('  if (__cache[id]) return __cache[id].exports;');
  parts.push('  const factory = __modules[id];');
  parts.push('  if (!factory) return __nativeRequire(id);');
  parts.push('  const m = { exports: {} };');
  parts.push('  __cache[id] = m;');
  parts.push('  factory(m, m.exports, __require);');
  parts.push('  return m.exports;');
  parts.push('}');

  for (const entry of files) {
    const key = entry[0];
    const code = transform(entry[1], key, here);
    parts.push('');
    parts.push('__modules[' + JSON.stringify(key) + '] = function (module, exports, require) {');
    parts.push(code);
    parts.push('};');
  }

  parts.push('');
  parts.push('__require(' + JSON.stringify(entryKey) + ');');
  return parts.join(NL);
}

/* Collect and bundle in one call. */
export function makeBundle(here) {
  const entry = path.join(here, 'src', 'main.js');
  const entryKey = path.relative(here, entry).split(path.sep).join('/');
  const files = collect(entry, here);
  return { files, entryKey, code: bundle(files, entryKey, here) };
}
