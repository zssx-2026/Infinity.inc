/*
 * build-layout.mjs - produce a multi file layout for one product.
 *
 * The old layout put a whole Node runtime inside every executable. Six names
 * meant six runtimes on disk, about 462 MiB for win-x64 alone, all of them
 * wrapped around the same 145 KiB of code. This builder produces the layout
 * that replaces it:
 *
 *   <dir>/node.exe        the runtime, shared, once
 *   <dir>/app.cjs         the bundle, once
 *   <dir>/ifm_gui.exe     a 49 KiB launcher that runs the two above
 *   <dir>/ifm_cli.exe     ...
 *   ...                   one per name
 *
 * Disk falls from six runtimes to one, and the executable that carries the
 * product's name is finally small enough to read.
 *
 * Nothing here touches the frozen v1.0pre5 release assets: the output goes
 * to build/layout, next to the old build/out but not over it.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const NL = String.fromCharCode(10);
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(HERE, '..', '..');

/* The face each mode presents. cli and launcher keep the console they were
 * typed into; gui must not flash one, so it takes the windowed build. */
const FACES = [
  { mode: 'cli',      face: 'console' },
  { mode: 'gui',      face: 'window'  },
  { mode: 'launcher', face: 'console' },
  { mode: 'tui',      face: 'console' }
];

const PRODUCTS = {
  ifm: {
    root: path.join(WORKSPACE, 'Infinity File Manager', 'sourcecode'),
    prefixes: ['ifm', 'ifmx'],
    modes: ['cli', 'gui', 'launcher']
  },
  inc: {
    root: path.join(WORKSPACE, 'Infinity Cloud', 'sourcecode'),
    prefixes: ['inc', 'inx'],
    modes: ['cli', 'tui', 'gui', 'launcher']
  },
  ipm: {
    root: path.join(WORKSPACE, 'InfinityPackageManager'),
    prefixes: ['ipm', 'ipmx'],
    modes: ['cli', 'tui', 'launcher'],
    /*
     * IPM has no source tree left - tools/build-all.mjs says so outright:
     * "The source tree is gone; what survives is bundle.js". There is no
     * tools/bundle.mjs to call, so the shipped bundle is the code.
     */
    bundle: path.join(WORKSPACE, 'InfinityPackageManager', 'InfinityPackageManager', 'bundle.js')
  }
};

/* Only win-x64 can be linked today: the compiler at hand builds 64 bit
 * Windows and nothing else. The other platforms keep the layout they
 * already have rather than being silently changed into something untested. */
const TARGETS = [
  { id: 'win-x64', runtime: path.join(WORKSPACE, 'temp', 'tools', 'runtimes', 'win-x64', 'node-v22.11.0-win-x64', 'node.exe') }
];

function log(m) { process.stdout.write(m + NL); }

async function build(productKey, opts) {
  const product = PRODUCTS[productKey];
  if (!product) throw new Error('unknown product: ' + productKey);

  const launcherDir = HERE;
  const report = { product: productKey, targets: [], ok: true };

  /* Two ways to get the code: most products are bundled from source here;
   * a product whose source is gone hands over a finished bundle file. */
  let made;
  if (product.bundle) {
    if (!fs.existsSync(product.bundle)) throw new Error('bundle missing: ' + product.bundle);
    made = { code: fs.readFileSync(product.bundle, 'utf8'), files: new Map() };
    log(productKey + ': bundle ' + made.code.length + ' B (shipped file ' + product.bundle + ')');
  } else {
    const bundleMaker = path.join(product.root, 'tools', 'bundle.mjs');
    if (!fs.existsSync(bundleMaker)) throw new Error('no bundler at ' + bundleMaker);
    const { makeBundle } = await import('file:///' + bundleMaker.split(path.sep).join('/'));
    made = makeBundle(product.root);
    log(productKey + ': bundle ' + made.code.length + ' B (' + made.files.size + ' modules)');
  }

  for (const t of TARGETS) {
    const dir = path.join(product.root, 'build', 'layout', t.id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    if (!fs.existsSync(t.runtime)) throw new Error('runtime missing: ' + t.runtime);
    fs.copyFileSync(t.runtime, path.join(dir, 'node.exe'));
    fs.writeFileSync(path.join(dir, 'app.cjs'), made.code, 'utf8');

    const names = [];
    for (const p of product.prefixes) {
      for (const m of product.modes) {
        const face = FACES.filter(function (f) { return f.mode === m; })[0];
        if (!face) throw new Error('no face for mode ' + m);
        const from = path.join(launcherDir, 'launcher-' + face.face + '.exe');
        if (!fs.existsSync(from)) throw new Error('launcher not built: ' + from);
        const to = path.join(dir, p + '_' + m + '.exe');
        fs.copyFileSync(from, to);
        names.push({ name: p + '_' + m + '.exe', face: face.face, size: fs.statSync(to).size });
      }
    }

    const files = fs.readdirSync(dir);
    let bytes = 0;
    for (const f of files) bytes += fs.statSync(path.join(dir, f)).size;
    report.targets.push({ id: t.id, dir: dir, files: files.length, bytes: bytes, names: names });
    log('  ' + t.id.padEnd(8) + files.length + ' files  ' + bytes + ' B  (' + (bytes / 1048576).toFixed(1) + ' MiB)');
  }

  return report;
}

const args = process.argv.slice(2);
const only = args.filter(function (a) { return PRODUCTS[a]; });
const list = only.length ? only : Object.keys(PRODUCTS);
const all = [];
for (const k of list) all.push(await build(k));

log('');
for (const r of all) {
  for (const t of r.targets) {
    const noRuntime = t.bytes - fs.statSync(path.join(t.dir, 'node.exe')).size;
    log(r.product + ' ' + t.id + ': without the shared runtime ' + noRuntime + ' B (' + (noRuntime / 1024).toFixed(0) + ' KiB)');
  }
}
log('BUILD-LAYOUT OK ' + all.length + ' product(s)');
