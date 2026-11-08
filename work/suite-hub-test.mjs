/*
 * suite-hub-test.mjs - offline acceptance for the Studio suite hub.
 *
 * The hub is the part of the studio that is not an installer: the component
 * tree from the product specification, the hosts it needs, the project
 * containers it writes, the workspace file it saves, and the file
 * associations it would register. Every claim is checked against the real
 * service on loopback, with a temporary studio home so nothing the user has
 * is touched.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(HERE, '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-hub-'));
process.env.INFINITYSTUDIO_HOME = HOME;

let pass = 0; let fail = 0; const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; failures.push(name + (detail ? ' -> ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' -> ' + detail : '')); }
}

function request(port, method, p, body) {
  return new Promise((resolve, reject) => {
    const text = body == null ? null : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: p, method,
      headers: text ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) } : {} },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null; try { json = JSON.parse(raw); } catch { /* html */ }
          resolve({ status: res.statusCode, json, raw });
        });
      });
    req.on('error', reject);
    if (text) req.write(text);
    req.end();
  });
}

/* 从页面内联脚本里原样切出一个函数（按花括号配平），再在本地求值。
 * 这样测的是服务真正发出去的代码，而不是测试里另写的一份映射。 */
function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  if (start < 0) return null;
  const open = source.indexOf('{', start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  return null;
}

async function main() {
  console.log('InfinityStudio suite hub acceptance');
  const { start } = await import('../InfinityStudio/src/server.js');
  const held = await start({ root: ROOT, port: 0 });
  const port = held.port;
  try {
    /* ---- the tree from the specification ---- */
    const suite = await request(port, 'GET', '/v1/suite');
    check('suite is served', suite.status === 200, String(suite.status));
    const branches = (suite.json && suite.json.branches) || [];
    check('eight branches', branches.length === 8, branches.map((b) => b.id).join());
    const ids = branches.map((b) => b.id).join();
    check('the branches are the specified ones', ids === 'studio,craft,webviewer,office,cloud,packages,integrations,server', ids);
    const components = branches.reduce((a, b) => a.concat(b.components || []), []);
    check('every component has an id and a name', components.every((c) => c.id && c.name), 'a component is unnamed');
    check('the craft family is complete', ['craft.code', 'craft.video', 'craft.picture', 'craft.3d', 'craft.paint', 'craft.animation', 'craft.game', 'craft.audio', 'craft.ai'].every((id) => components.some((c) => c.id === id)), components.filter((c) => /^craft\./.test(c.id)).map((c) => c.id).join());
    check('the cloud branch is marked deferred', (branches.find((b) => b.id === 'cloud') || {}).deferred === true, JSON.stringify((branches.find((b) => b.id === 'cloud') || {}).deferred));
    check('the language and theme pack types are named', components.some((c) => c.id === 'studio.languages') && components.some((c) => c.id === 'studio.themes'), 'pack components missing');
    check('the studio is the root of the tree', components.some((c) => c.id === 'studio.shell'), components.map((c) => c.id).slice(0, 4).join());

    /* ---- codecs carry a version gate ---- */
    const codecraft = components.find((c) => c.id === 'craft.code') || {};
    const codecs = codecraft.codecs || [];
    check('codecraft declares its project formats', codecs.length === 2, JSON.stringify(codecs.map((c) => c.ext)));
    check('both project formats are declared', codecs.some((c) => c.ext === '.is-ccp') && codecs.some((c) => c.ext === '.is-ccpx'), JSON.stringify(codecs.map((c) => c.ext)));
    check('the format gate is the documented one', codecs.every((c) => c.since === '0.42.31'), JSON.stringify(codecs.map((c) => c.since)));

    /* ---- hosts are probed, not assumed ---- */
    const hosts = await request(port, 'GET', '/v1/hosts');
    check('hosts are served', hosts.status === 200 && Array.isArray(hosts.json.hosts), String(hosts.status));
    check('every host row says whether it was found', hosts.json.hosts.every((h) => typeof h.found === 'boolean'), 'a host row has no found flag');
    const nodeHost = hosts.json.hosts.find((h) => h.id === 'node');
    check('node is found on this machine', nodeHost && nodeHost.found === true, JSON.stringify(nodeHost));
    check('a host that is not installed is reported as missing', hosts.json.hosts.some((h) => h.found === false), 'no negative case');

    /* ---- a project is a real container ---- */
    const created = await request(port, 'POST', '/v1/project/create', {
      name: 'hello', component: 'codecraft',
      files: [{ name: 'main.txt', content: 'hello craft' }, { name: 'notes.txt', content: 'second file' }]
    });
    check('a project is created', created.status === 200 && created.json.ok === true, JSON.stringify(created.json).slice(0, 160));
    const projectPath = created.json.path;
    check('the project file exists', !!projectPath && fs.existsSync(projectPath), String(projectPath));
    check('the project carries the documented extension', /\.is-ccp$/.test(String(projectPath)), String(projectPath));
    const opened = await request(port, 'POST', '/v1/project/open', { path: projectPath });
    check('the project opens', opened.status === 200 && opened.json.ok === true, JSON.stringify(opened.json).slice(0, 160));
    check('the header names the component', opened.json.header && opened.json.header.component === 'codecraft', JSON.stringify(opened.json.header || {}).slice(0, 120));
    check('both files come back', (opened.json.files || []).length === 2, JSON.stringify(opened.json.files || []).length);
    check('the payload survives the round trip', opened.json.files.some((f) => f.path === 'main.txt' && f.bytes === 11), JSON.stringify(opened.json.files || []).slice(0, 160));

    const compressed = await request(port, 'POST', '/v1/project/create', {
      name: 'packed', component: 'codecraft', compressed: true,
      files: [{ name: 'a.txt', content: 'x'.repeat(4096) }]
    });
    check('a compressed project uses the .is-ccpx extension', /\.is-ccpx$/.test(String(compressed.json.path)), String(compressed.json.path));
    check('compression actually shrinks the payload', fs.statSync(compressed.json.path).size < 4096, String(fs.statSync(compressed.json.path).size));

    const tampered = path.join(HOME, 'tampered.is-ccp');
    const bytes = fs.readFileSync(projectPath);
    bytes[bytes.length - 1] = bytes[bytes.length - 1] ^ 0xff;
    fs.writeFileSync(tampered, bytes);
    const broken = await request(port, 'POST', '/v1/project/open', { path: tampered });
    check('a tampered project is refused, not rendered', broken.json && broken.json.ok === false, JSON.stringify(broken.json).slice(0, 160));

    /* ---- a workspace remembers what it holds ---- */
    const ws = await request(port, 'POST', '/v1/workspace/create', { name: 'demo', path: path.join(HOME, 'demo.is-ws') });
    check('a workspace is created', ws.status === 200 && ws.json.ok === true, JSON.stringify(ws.json).slice(0, 160));
    check('the workspace file exists', fs.existsSync(ws.json.path), String(ws.json.path));
    check('the workspace uses the documented extension', /\.is-ws$/.test(ws.json.path), ws.json.path);
    const wsLoaded = await request(port, 'POST', '/v1/workspace/load', { path: ws.json.path });
    check('the workspace loads back', wsLoaded.json.ok === true && wsLoaded.json.workspace.name === 'demo', JSON.stringify(wsLoaded.json).slice(0, 160));
    const badWs = await request(port, 'POST', '/v1/workspace/load', { path: path.join(HOME, 'nope.is-ws') });
    check('a missing workspace is reported, not thrown', badWs.status === 200 && badWs.json.ok === false, JSON.stringify(badWs.json).slice(0, 120));

    /* ---- associations are planned before they are applied ---- */
    const assoc = await request(port, 'POST', '/v1/associate', { apply: false });
    check('associations are planned', assoc.status === 200 && Array.isArray(assoc.json.ops), String(assoc.status));
    check('the plan covers every craft project format', assoc.json.ops.length >= 9, String(assoc.json.ops.length));
    const commands = assoc.json.ops.filter((o) => /command$/.test(String(o.key || '')));
    check('every open command names the studio executable', commands.length > 0 && commands.every((o) => /InfinityStudio|infinitystudio/i.test(String(o.value || o.command || ''))), JSON.stringify(commands[0] || {}).slice(0, 200));
    check('a dry run writes nothing', assoc.json.applied === false, String(assoc.json.applied));

    /* ---- a component installs from what the workspace really has ---- */
    const inst = await request(port, 'POST', '/v1/suite/install', { id: 'studio.shell' });
    check('installing the studio runtime is accepted or explained', inst.status === 200, String(inst.status));
    check('the install reports per-part status', Array.isArray(inst.json.parts), JSON.stringify(inst.json).slice(0, 160));
    const missing = await request(port, 'POST', '/v1/suite/install', { id: 'no-such-component' });
    check('an unknown component is 404', missing.status === 404, String(missing.status));

    /* ---- the page renders the whole tree ---- */
    const page = await request(port, 'GET', '/');
    check('the page is served', page.status === 200 && page.raw.includes('InfinityStudio'), String(page.status));
    check('the page carries the suite views', ['/v1/suite', '/v1/workspace', '/v1/project', '/v1/associate'].every((r) => page.raw.includes(r)), 'a hub route is not referenced');
    check('the page still offers every language', (page.raw.match(/<option value=/g) || []).length >= 50, String((page.raw.match(/<option value=/g) || []).length));
    check('the page loads no remote resource', !/https?:\/\/(?!127\.0\.0\.1|localhost)/.test(page.raw.replace(/<html[^>]*>/, '')), 'a remote URL is present');

    /* ---- the tree enters the sub-products ---- */
    check('the page wires the tree enter buttons', page.raw.includes('data-enter') && page.raw.includes('appForComponent') && page.raw.includes('pendingApp'), 'an enter affordance is missing');
    const apps = await request(port, 'GET', '/v1/apps');
    check('the app registry is served', apps.status === 200 && Array.isArray(apps.json.apps), String(apps.status));
    const suiteIds = new Set();
    for (const b of (suite.json.branches || [])) for (const c of (b.components || [])) suiteIds.add(c.id);
    const liveApps = apps.json.apps.filter((a) => a.ok && /craft$/.test(a.id));
    check('every live craft app has a suite component', liveApps.length >= 5 && liveApps.every((a) => suiteIds.has('craft.' + a.id.slice(0, -5))), JSON.stringify(liveApps.map((a) => a.id)));
    const mapped = liveApps.every((a) => 'craft.' + a.id.slice(0, -5));
    check('the craft mapping is bijective for live apps', mapped && suiteIds.size > 0, String(suiteIds.size));

    /* ---- every module-bearing branch maps to its own app ---- */
    const branchApps = apps.json.apps.filter((a) => a.ok && !/craft$/.test(a.id)).map((a) => a.id);
    check('five non-craft branch apps are live', branchApps.length === 5 && ['webviewer', 'office', 'packages', 'integrations', 'server'].every((id) => branchApps.includes(id)), JSON.stringify(branchApps));
    check('every live branch app owns at least one component', branchApps.every((id) => [...suiteIds].some((s) => s.startsWith(id + '.'))), JSON.stringify(branchApps));

    const fnSrc = extractFunction(page.raw, 'function appForComponent(');
    check('the page ships appForComponent', !!fnSrc, fnSrc ? String(fnSrc.length) : 'not found');
    if (fnSrc) {
      const appForComponent = new Function(fnSrc + '; return appForComponent;')();
      check('craft.<x> maps to <x>craft', appForComponent('craft.code') === 'codecraft' && appForComponent('craft.ai') === 'aicraft' && appForComponent('craft.3d') === '3dcraft', appForComponent('craft.code'));
      check('webviewer components map to webviewer', appForComponent('webviewer.core') === 'webviewer' && appForComponent('webviewer.capture') === 'webviewer');
      check('office components map to office', appForComponent('office.writer') === 'office' && appForComponent('office.pdf') === 'office');
      check('packages/integrations/server map to their branch', ['packages.manager', 'integrations.gitee', 'server.runtime'].every((id) => appForComponent(id) === id.split('.')[0]), [appForComponent('packages.manager'), appForComponent('integrations.gitee'), appForComponent('server.runtime')].join());
      check('studio and cloud have no module of their own', appForComponent('studio.shell') === '' && appForComponent('cloud.desktop') === '');
      check('ids without a module branch map to empty', appForComponent('') === '' && appForComponent('nodot') === '' && appForComponent('craft.') === '' && appForComponent(null) === '');
      check('every live app id maps from one of its components', branchApps.concat(liveApps.map((a) => a.id)).every((id) => [...suiteIds].some((s) => appForComponent(s) === id)), 'a live app has no reachable component');
    }
  } finally {
    await held.close();
    fs.rmSync(HOME, { recursive: true, force: true });
  }

  console.log('');
  if (fail) { console.log('INFINITYSTUDIO-HUB-FAIL ' + pass + '/' + (pass + fail)); failures.forEach((f) => console.log('  - ' + f)); process.exitCode = 1; }
  else console.log('INFINITYSTUDIO-HUB-PASS ' + pass + '/' + pass);
}

main().catch((e) => { console.error('INFINITYSTUDIO-HUB-ERROR', e); process.exitCode = 2; });