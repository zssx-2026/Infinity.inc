/**
 * packages-smoke.mjs - real-work smoke for the Packages module.
 *
 * Writes a real package.json and real package-lock.json files (v3 and v1)
 * into an os.tmpdir() sandbox, then drives inspect/lockfile/tree through the
 * live module and checks every returned number against what was written.
 * Negative cases (broken JSON, missing file, unknown action) must come back
 * as ok:false with the exact error codes.
 *
 * Last line: PACKAGES-SMOKE-PASS n/n (exit 1 when any check failed).
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/* Cache-busting import of the module under test. The dynamic form is used
 * because a static import cannot concatenate the ?v= buster onto the
 * module specifier. */
const m = await import('file:///D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/InfinityStudio/src/apps/packages.js?v=' + Date.now());

let pass = 0, fail = 0;
function check(d, cond, e) { if (cond) { pass += 1; console.log('ok   ' + d); } else { fail += 1; console.log('FAIL ' + d + (e ? ' <- ' + JSON.stringify(e) : '')); } }

(async () => {
  /* identity face */
  const cap = m.capabilities();
  check('capabilities implemented=true', cap.implemented === true && cap.id === 'packages', cap);
  check('capabilities features/formats/hosts', Array.isArray(cap.features) && cap.features.length === 3 && cap.formats.length === 2 && cap.hosts.length === 1 && cap.hosts[0] === 'npm', cap);

  const meta = m.META;
  check('META id/version/branch/codecs', !!meta && meta.id === 'packages' && meta.version === '1.0.0-pre5' && meta.branch === 'packages' && Array.isArray(meta.codecs) && meta.codecs.length === 2 && meta.codecs[0].ext === 'package.json', meta);
  check('default export carries the four faces', !!m.default && typeof m.default.capabilities === 'function' && typeof m.default.plan === 'function' && typeof m.default.run === 'function' && !!m.default.META, m.default && Object.keys(m.default));

  /* plan face (pure, no filesystem) */
  const p = m.plan('inspect', { path: 'demo/package.json' });
  check('plan inspect has steps', p.ok === true && p.steps.length >= 1 && Array.isArray(p.warnings), p);
  const pu = m.plan('ghost', {});
  check('plan unknown action', pu.ok === false && pu.error === 'UNKNOWN_ACTION', pu);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-smoke-'));
  try {
    /* inspect: a real package.json with 2 deps + 1 devDep + scripts */
    const manifestPath = path.join(dir, 'package.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
      name: 'demo-app',
      version: '1.2.3',
      license: 'MIT',
      dependencies: { a: '^1.0.0', b: '~2.1.0' },
      devDependencies: { tap: '^3.0.0' },
      peerDependencies: {},
      scripts: { test: 'node test.js', build: 'node build.js' },
      engines: { node: '>=18' }
    }, null, 2), 'utf8');
    const ins = await m.run('inspect', { path: manifestPath });
    check('inspect ok + action', ins.ok === true && ins.action === 'inspect', ins);
    check('inspect name/version/license', ins.name === 'demo-app' && ins.version === '1.2.3' && ins.license === 'MIT', ins);
    check('inspect dep counts 2/1/0', !!ins.deps && ins.deps.dependencies === 2 && ins.deps.devDependencies === 1 && ins.deps.peerDependencies === 0, ins.deps);
    check('inspect scripts names', Array.isArray(ins.scripts) && ins.scripts.length === 2 && ins.scripts.includes('test') && ins.scripts.includes('build'), ins.scripts);
    check('inspect engines passthrough', !!ins.engines && ins.engines.node === '>=18', ins.engines);

    /* lockfile v3 + tree over the same real file */
    const lockPath = path.join(dir, 'package-lock.json');
    fs.writeFileSync(lockPath, JSON.stringify({
      name: 'demo-app',
      version: '1.2.3',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { name: 'demo-app', version: '1.2.3', dependencies: { a: '^1.0.0', c: '^3.0.0' } },
        'node_modules/a': { version: '1.0.0' },
        'node_modules/a/node_modules/b': { version: '2.0.0' },
        'node_modules/c': { version: '3.0.0' }
      }
    }, null, 2), 'utf8');
    const lf = await m.run('lockfile', { path: lockPath });
    check('lockfile v3 ok/version', lf.ok === true && lf.lockfileVersion === 3, lf);
    check('lockfile v3 packages=3 (root excluded)', lf.packages === 3, lf);
    check('lockfile v3 topName', lf.topName === 'demo-app', lf);

    const tr = await m.run('tree', { path: lockPath });
    check('tree ok', tr.ok === true, tr);
    check('tree roots=2 (a,c)', Array.isArray(tr.roots) && tr.roots.length === 2 && tr.roots.includes('a') && tr.roots.includes('c'), tr.roots);
    check('tree topCount=2 maxDepth=2 total=3', tr.topCount === 2 && tr.maxDepth === 2 && tr.total === 3, { topCount: tr.topCount, maxDepth: tr.maxDepth, total: tr.total });
    check('tree rebuilt nesting a>b', !!tr.tree && tr.tree.length === 2 && tr.tree[0].name === 'a' && tr.tree[0].children.length === 1 && tr.tree[0].children[0].name === 'b' && tr.tree[0].children[0].depth === 2, tr.tree);
    const tr1 = await m.run('tree', { path: lockPath, maxDepth: 1 });
    check('tree maxDepth=1 prunes deep nodes', tr1.ok === true && tr1.total === 2 && tr1.maxDepth === 1 && tr1.tree[0].children.length === 0, { total: tr1.total, maxDepth: tr1.maxDepth });

    /* lockfile v1: recursive dependencies-tree count */
    const lock1Path = path.join(dir, 'package-lock.v1.json');
    fs.writeFileSync(lock1Path, JSON.stringify({
      name: 'demo-app',
      version: '1.2.3',
      lockfileVersion: 1,
      dependencies: {
        a: { version: '1.0.0', dependencies: { b: { version: '2.0.0' } } },
        c: { version: '3.0.0' }
      }
    }, null, 2), 'utf8');
    const lf1 = await m.run('lockfile', { path: lock1Path });
    check('lockfile v1 recursive count=3', lf1.ok === true && lf1.lockfileVersion === 1 && lf1.packages === 3, lf1);

    /* negative cases: bad JSON, missing file, unknown action */
    const badPath = path.join(dir, 'bad-package.json');
    fs.writeFileSync(badPath, '{not json', 'utf8');
    const insBad = await m.run('inspect', { path: badPath });
    check('inspect bad json -> BAD_JSON', insBad.ok === false && insBad.error === 'BAD_JSON', insBad);
    const lfBad = await m.run('lockfile', { path: badPath });
    check('lockfile bad json -> BAD_JSON', lfBad.ok === false && lfBad.error === 'BAD_JSON', lfBad);

    const insMiss = await m.run('inspect', { path: path.join(dir, 'nope', 'package.json') });
    check('inspect missing -> READ_FAILED', insMiss.ok === false && insMiss.error === 'READ_FAILED', insMiss);
    const lfMiss = await m.run('lockfile', { path: path.join(dir, 'nope-lock.json') });
    check('lockfile missing -> READ_FAILED', lfMiss.ok === false && lfMiss.error === 'READ_FAILED', lfMiss);

    const ghost = await m.run('ghost', {});
    check('run unknown action -> UNKNOWN_ACTION', ghost.ok === false && ghost.error === 'UNKNOWN_ACTION', ghost);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }

  console.log('PACKAGES-SMOKE-PASS ' + pass + '/' + (pass + fail));
  process.exitCode = fail > 0 ? 1 : 0;
})();
