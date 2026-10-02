/*
 * build.mjs - turn the source tree into one executable.
 *
 * No bundler is installed here, so this file is the bundler. It stays short
 * because the source is disciplined: one import per line, single quotes, no
 * export default, no dynamic import. Only the shapes actually used are
 * rewritten; anything else is passed through unchanged, so an unfamiliar
 * construct fails the build instead of quietly misbehaving at run time.
 *
 *   1. walk the import graph from src/main.js
 *   2. emit every module into a registry, rewriting import to require
 *   3. produce a SEA blob with node --experimental-sea-config
 *   4. copy the runtime and inject the blob with postject
 *
 * useCodeCache is off. A V8 code cache is tied to the exact build that made
 * it, so a blob carrying one refuses to start on a different Node build -
 * exactly the cross-machine failure this application cannot afford.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execFileSync } from 'node:child_process';

const NL = String.fromCharCode(10);
const SQ = String.fromCharCode(39);

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, 'src', 'main.js');
const BUILD = path.join(HERE, 'build');
const TARGET_NODE = 'D:/temp/tools/node.exe';
const EXE_NAME = 'InfinityCloud.exe';

const POSTJECT = [
  'C:/Users/REDMI/AppData/Roaming/npm/node_modules/postject/dist/cli.js',
  'C:/Users/REDMI/AppData/Roaming/npm/node_modules/postject/cli.js'
].filter(function (p) { return fs.existsSync(p); })[0] || null;

function log(m) { process.stdout.write(m + NL); }

/* The quoted string in a line, or null. Single quotes only, because that is
 * what the source uses; accepting both would mean guessing at apostrophes. */
function quoted(line) {
  const a = line.indexOf(SQ);
  if (a < 0) return null;
  const b = line.indexOf(SQ, a + 1);
  if (b < 0) return null;
  return { text: line.slice(a + 1, b), at: a };
}

/* A relative specifier resolves against its importer; a builtin passes through. */
function keyFor(spec, fromFile) {
  if (spec.charAt(0) !== '.') return spec;
  const abs = path.resolve(path.dirname(fromFile), spec);
  return path.relative(HERE, abs).split(path.sep).join('/');
}

/* Split a binding list on commas that are not inside braces. */
function splitTop(s) {
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
function aliasToKey(s) {
  const i = s.indexOf(' as ');
  if (i < 0) return s;
  return s.slice(0, i).trim() + ': ' + s.slice(i + 4).trim();
}

/* Is this a character that may appear in an identifier? */
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
function transform(text, key) {
  const out = [];
  const names = [];
  const fromDir = path.join(HERE, key);

  for (const line of text.split(NL)) {
    const t = line.trim();

    /* A shebang is only legal on the first line of a script, not here. */
    if (t.slice(0, 2) === '#!') { out.push(''); continue; }

    if (t.slice(0, 7) === 'import ' && t.indexOf(' from ') > 0) {
      const q = quoted(t);
      if (q) {
        const fi = t.indexOf(' from ');
        const head = t.slice(7, fi).trim();
        const req = 'require(' + JSON.stringify(keyFor(q.text, fromDir)) + ');';
        if (head.charAt(0) === '{') {
          const inner = head.slice(1, head.lastIndexOf('}'));
          const binds = splitTop(inner).map(aliasToKey);
          out.push('const { ' + binds.join(', ') + ' } = ' + req);
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

function importsOf(text) {
  const out = [];
  for (const line of text.split(NL)) {
    const t = line.trim();
    if (t.slice(0, 7) !== 'import ') continue;
    const q = quoted(t);
    if (q) out.push(q.text);
  }
  return out;
}

function collect(entry) {
  const files = new Map();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    const key = path.relative(HERE, file).split(path.sep).join('/');
    if (files.has(key)) continue;
    let text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (e) { throw new Error('cannot read ' + file + ': ' + e.message); }
    files.set(key, text);
    for (const spec of importsOf(text)) {
      if (spec.charAt(0) !== '.') continue;
      const k = keyFor(spec, file);
      if (!files.has(k)) queue.push(path.join(HERE, k));
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
function bundle(files, entryKey) {
  const parts = [];
  parts.push('/* Generated by build.mjs. Do not edit. */');
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
    const code = transform(entry[1], key);
    parts.push('');
    parts.push('__modules[' + JSON.stringify(key) + '] = function (module, exports, require) {');
    parts.push(code);
    parts.push('};');
  }

  parts.push('');
  parts.push('__require(' + JSON.stringify(entryKey) + ');');
  return parts.join(NL);
}

/* Run a child process and fail loudly with whatever it printed. */
function run(exe, args, label) {
  try {
    return execFileSync(exe, args, { cwd: HERE, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) || '';
  } catch (e) {
    const msg = String((e.stderr || '') + (e.stdout || '') + (e.message || ''));
    throw new Error(label + ' failed:' + NL + msg.slice(0, 1200));
  }
}

function main() {
  fs.rmSync(BUILD, { recursive: true, force: true });
  fs.mkdirSync(BUILD, { recursive: true });

  const entryKey = path.relative(HERE, ENTRY).split(path.sep).join('/');
  const files = collect(ENTRY);
  log('modules: ' + files.size);
  for (const k of files.keys()) log('  ' + k);

  const code = bundle(files, entryKey);
  const bundlePath = path.join(BUILD, 'bundle.cjs');
  fs.writeFileSync(bundlePath, code, 'utf8');
  log('bundle: ' + code.length + ' B');

  const sea = {
    main: bundlePath,
    output: path.join(BUILD, 'sea-prep.blob'),
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false
  };
  const cfg = path.join(BUILD, 'sea-config.json');
  fs.writeFileSync(cfg, JSON.stringify(sea, null, 2), 'utf8');

  log('generating the blob...');
  run(TARGET_NODE, ['--experimental-sea-config', cfg], 'sea-config');
  const blob = path.join(BUILD, 'sea-prep.blob');
  if (!fs.existsSync(blob)) throw new Error('the blob was not produced');
  log('blob: ' + fs.statSync(blob).size + ' B');

  const exe = path.join(HERE, EXE_NAME);
  fs.copyFileSync(TARGET_NODE, exe);
  log('runtime: ' + fs.statSync(exe).size + ' B');

  if (!POSTJECT) throw new Error('postject was not found');
  log('injecting the blob...');
  run(process.execPath, [POSTJECT, exe, 'NODE_SEA_BLOB', blob,
    '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'], 'postject');
  log('injected: ' + fs.statSync(exe).size + ' B');

  log('');
  log('done.  ' + exe);
}

main();
