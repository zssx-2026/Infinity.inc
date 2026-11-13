/**
 * packages.js - Packages' capability surface.
 *
 * Packages is the dependency inspector of Infinity Studio: it reads a real
 * package.json manifest, counts what a real package-lock.json contains, and
 * rebuilds the node_modules nesting tree straight from the v2/v3 "packages"
 * keys. Every answer comes from real bytes on disk; nothing is faked.
 *
 * Two rules hold throughout:
 *   1. run() never throws. A missing file, broken JSON and an unknown action
 *     all come back as ok:false with an uppercase snake error code.
 *   2. plan() is pure. It composes the reading steps and stops there; run()
 *     is the only function that touches the filesystem, and it never writes.
 */

import fs from 'node:fs';

export const META = {
  id: 'packages',
  name: 'Packages',
  version: '1.0.0-pre5',
  branch: 'packages',
  codecs: [{ ext: 'package.json', since: '0.42.31' }, { ext: 'package-lock.json', since: '0.42.31' }],
  hosts: ['npm']
};

/* ---------------------------------------------------------------- identity */

export function capabilities() {
  return {
    id: META.id,
    name: META.name,
    version: META.version,
    features: ['inspect-manifest', 'lockfile-count', 'dep-tree'],
    formats: META.codecs.map((codec) => codec.ext),
    hosts: META.hosts.slice(),
    implemented: true
  };
}

/* ---------------------------------------------------------------- plan face */

export function plan(action, input) {
  const act = String(action || '').toLowerCase();
  const opts = normalizeInput(input || {});
  const steps = [];
  const warnings = [];

  if (act === 'inspect') {
    if (!opts.path) warnings.push('缺少清单路径（path）');
    steps.push({ kind: 'read', detail: '读取 package.json：' + (opts.path || '<未指定>') });
    steps.push({ kind: 'parse', detail: '解析 name/version/license 并统计 dependencies、devDependencies、peerDependencies 与 scripts' });
    return { ok: warnings.length === 0, action: act, steps, warnings };
  }

  if (act === 'lockfile') {
    if (!opts.path) warnings.push('缺少锁文件路径（path）');
    steps.push({ kind: 'read', detail: '读取 package-lock.json：' + (opts.path || '<未指定>') });
    steps.push({ kind: 'parse', detail: '按 lockfileVersion 统计 packages 键（v2/v3）或递归数 dependencies 树节点（v1）' });
    return { ok: warnings.length === 0, action: act, steps, warnings };
  }

  if (act === 'tree') {
    if (!opts.path) warnings.push('缺少锁文件路径（path）');
    if (opts.maxDepth !== undefined && opts.maxDepth !== null && normalizeMaxDepth(opts.maxDepth) === null) {
      warnings.push('maxDepth 必须是正整数');
    }
    steps.push({ kind: 'read', detail: '读取 package-lock.json：' + (opts.path || '<未指定>') });
    steps.push({ kind: 'build', detail: '由 packages 键重建 node_modules 嵌套依赖树' + (normalizeMaxDepth(opts.maxDepth) ? '（限深 ' + normalizeMaxDepth(opts.maxDepth) + ' 层）' : '') });
    return { ok: warnings.length === 0, action: act, steps, warnings };
  }

  return { ok: false, action: act || null, steps: [], warnings: ['未知动作：' + String(action)], error: 'UNKNOWN_ACTION' };
}

/* ---------------------------------------------------------------- shared helpers */

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeInput(input) {
  const opts = {};
  if (!isPlainObject(input)) return opts;
  for (const key of Object.keys(input)) opts[key] = input[key];
  return opts;
}

function fail(action, error, message) {
  return { ok: false, action, error, message };
}

function countKeys(value) {
  return isPlainObject(value) ? Object.keys(value).length : 0;
}

function strOrNull(value) {
  return typeof value === 'string' ? value : null;
}

function normalizeMaxDepth(value) {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/* ---------------------------------------------------------------- inspect */

function inspect(input) {
  const opts = normalizeInput(input);
  const act = 'inspect';
  if (!opts.path) return fail(act, 'MISSING_PATH', '缺少清单路径（path）');
  let raw;
  try { raw = fs.readFileSync(opts.path); } catch (err) { return fail(act, 'READ_FAILED', '无法读取清单文件：' + err.message); }
  let parsed;
  try { parsed = JSON.parse(raw.toString('utf8')); } catch (err) {
    return { ok: false, action: act, error: 'BAD_JSON', message: '清单不是合法的 JSON：' + err.message };
  }
  if (!isPlainObject(parsed)) return { ok: false, action: act, error: 'BAD_JSON', message: '清单根节点必须是 JSON 对象' };
  return {
    ok: true,
    action: act,
    path: opts.path,
    name: strOrNull(parsed.name),
    version: strOrNull(parsed.version),
    license: strOrNull(parsed.license),
    deps: {
      dependencies: countKeys(parsed.dependencies),
      devDependencies: countKeys(parsed.devDependencies),
      peerDependencies: countKeys(parsed.peerDependencies)
    },
    scripts: isPlainObject(parsed.scripts) ? Object.keys(parsed.scripts) : [],
    engines: isPlainObject(parsed.engines) ? Object.assign({}, parsed.engines) : null
  };
}

/* ---------------------------------------------------------------- lockfile */

function lockfile(input) {
  const opts = normalizeInput(input);
  const act = 'lockfile';
  if (!opts.path) return fail(act, 'MISSING_PATH', '缺少锁文件路径（path）');
  let raw;
  try { raw = fs.readFileSync(opts.path); } catch (err) { return fail(act, 'READ_FAILED', '无法读取锁文件：' + err.message); }
  let parsed;
  try { parsed = JSON.parse(raw.toString('utf8')); } catch (err) {
    return { ok: false, action: act, error: 'BAD_JSON', message: '锁文件不是合法的 JSON：' + err.message };
  }
  if (!isPlainObject(parsed)) return { ok: false, action: act, error: 'BAD_JSON', message: '锁文件根节点必须是 JSON 对象' };
  const version = normalizeLockVersion(parsed.lockfileVersion);
  let mode;
  let packages;
  if (version === 1) {
    /* lockfileVersion 1: the graph lives in "dependencies" and nests through
     * each entry's own "dependencies" object; count every entry once. */
    mode = 'dependencies-tree';
    packages = countDependenciesTree(parsed.dependencies);
  } else if (version >= 2 || (version === null && isPlainObject(parsed.packages))) {
    /* lockfileVersion 2/3: every installed location is one "packages" key,
     * with "" as the virtual project root, which is not a package. */
    mode = 'packages';
    packages = isPlainObject(parsed.packages) ? Object.keys(parsed.packages).filter((key) => key !== '').length : 0;
  } else if (isPlainObject(parsed.dependencies)) {
    /* Unknown/absent version that still carries a v1-shaped graph. */
    mode = 'dependencies-tree';
    packages = countDependenciesTree(parsed.dependencies);
  } else {
    mode = 'packages';
    packages = 0;
  }
  return {
    ok: true,
    action: act,
    path: opts.path,
    lockfileVersion: version,
    mode: mode,
    packages: packages,
    topName: topNameOf(parsed)
  };
}

/* ---------------------------------------------------------------- tree */

function tree(input) {
  const opts = normalizeInput(input);
  const act = 'tree';
  if (!opts.path) return fail(act, 'MISSING_PATH', '缺少锁文件路径（path）');
  const depthLimit = normalizeMaxDepth(opts.maxDepth);
  if (opts.maxDepth !== undefined && opts.maxDepth !== null && depthLimit === null) {
    return fail(act, 'BAD_MAX_DEPTH', 'maxDepth 必须是正整数');
  }
  let raw;
  try { raw = fs.readFileSync(opts.path); } catch (err) { return fail(act, 'READ_FAILED', '无法读取锁文件：' + err.message); }
  let parsed;
  try { parsed = JSON.parse(raw.toString('utf8')); } catch (err) {
    return { ok: false, action: act, error: 'BAD_JSON', message: '锁文件不是合法的 JSON：' + err.message };
  }
  if (!isPlainObject(parsed)) return { ok: false, action: act, error: 'BAD_JSON', message: '锁文件根节点必须是 JSON 对象' };
  const version = normalizeLockVersion(parsed.lockfileVersion);
  const keys = isPlainObject(parsed.packages) ? Object.keys(parsed.packages) : [];

  /* Each "node_modules/a/node_modules/b" key unrolls into the nesting path
   * [a, b]; one more "node_modules/" segment is one deeper level. Keys
   * without a node_modules segment (workspace entries, links) carry no
   * install location and are skipped. A depthLimit stops building below
   * that level, mirroring a shallow "who is installed where" glance. */
  const level0 = new Map();
  for (const key of keys) {
    if (key === '' || !key.includes('node_modules/')) continue;
    const names = segmentsOf(key);
    if (names.length === 0) continue;
    if (depthLimit !== null && names.length > depthLimit) continue;
    let level = level0;
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      let node = level.get(name);
      if (!node) {
        node = { name: name, depth: i + 1, key: null, children: new Map() };
        level.set(name, node);
      }
      if (i === names.length - 1) node.key = key;
      level = node.children;
    }
  }

  const rootNodes = levelToNodes(level0);
  let maxSeen = 0;
  let total = 0;
  (function walk(nodes) {
    for (const node of nodes) {
      total += 1;
      if (node.depth > maxSeen) maxSeen = node.depth;
      walk(node.children);
    }
  })(rootNodes);

  return {
    ok: true,
    action: act,
    path: opts.path,
    lockfileVersion: version,
    roots: rootNodes.map((node) => node.name),
    topCount: rootNodes.length,
    maxDepth: maxSeen,
    total: total,
    tree: rootNodes
  };
}

/* ---------------------------------------------------------------- tree helpers */

function segmentsOf(key) {
  return String(key)
    .split(/node_modules\//)
    .filter((part) => part.length > 0)
    .map((part) => part.replace(/\/+$/, ''))
    .filter((part) => part.length > 0);
}

function levelToNodes(level) {
  const nodes = [];
  for (const node of level.values()) {
    nodes.push({ name: node.name, depth: node.depth, key: node.key, children: levelToNodes(node.children) });
  }
  return nodes;
}

function countDependenciesTree(deps) {
  if (!isPlainObject(deps)) return 0;
  let total = 0;
  const queue = [deps];
  while (queue.length > 0) {
    const level = queue.pop();
    for (const name of Object.keys(level)) {
      const entry = level[name];
      if (!isPlainObject(entry)) continue;
      total += 1;
      if (isPlainObject(entry.dependencies)) queue.push(entry.dependencies);
    }
  }
  return total;
}

function topNameOf(parsed) {
  const rootEntry = isPlainObject(parsed.packages) ? parsed.packages[''] : null;
  if (isPlainObject(rootEntry) && typeof rootEntry.name === 'string') return rootEntry.name;
  return strOrNull(parsed.name);
}

function normalizeLockVersion(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* ---------------------------------------------------------------- run face */

export async function run(action, input) {
  const act = String(action || '').toLowerCase();
  try {
    if (act === 'inspect') return inspect(input || {});
    if (act === 'lockfile') return lockfile(input || {});
    if (act === 'tree') return tree(input || {});
    return { ok: false, action: act || null, error: 'UNKNOWN_ACTION', message: '未知动作：' + String(action) };
  } catch (err) {
    return { ok: false, action: act || null, error: 'RUN_FAILED', message: '执行失败：' + ((err && err.message) || String(err)) };
  }
}

export default { META, capabilities, plan, run };
