/*
 * test-studio-clean.mjs - what Studio says on a machine that has no workspace.
 *
 * A fresh install has no payload directories, and the honest answer is "these
 * parts are not here", not a plan full of zero-byte files that fails halfway.
 * This drives the service headlessly (no window) with an empty root and checks
 * that: inventory reports nothing available, a desktop plan is reported missing
 * and blocking, and the install route refuses with 409 instead of copying air.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { start } from '../InfinityStudio/src/server.js';

const checks = [];
const ok = (name, pass, detail) => checks.push({ name, pass, detail });

const empty = path.join(os.tmpdir(), 'infinity-studio-clean-' + process.pid);
fs.mkdirSync(empty, { recursive: true });

const { port, close } = await start({ port: 0, root: empty });
const base = 'http://127.0.0.1:' + port;
const getJson = async (p) => (await fetch(base + p)).json();
const post = async (p, body) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

try {
  const w = await getJson('/v1/workloads');
  ok('workloads listed', Array.isArray(w.workloads) && w.workloads.length === 5, String(w.workloads && w.workloads.length));
  ok('products listed', Array.isArray(w.products) && w.products.length === 4, String(w.products && w.products.length));
  const anyFace = w.products.some((p) => Object.values(p.faces || {}).some((n) => n > 0));
  ok('nothing available on an empty root', anyFace === false, JSON.stringify(w.products.map((p) => p.faces)));

  const plan = await post('/v1/plan', { workloads: ['desktop'] });
  ok('plan returns 200', plan.status === 200, plan.status);
  ok('plan counts every file missing', plan.body.counts.missing === plan.body.counts.files && plan.body.counts.files > 0, JSON.stringify(plan.body.counts));
  ok('plan reports blocking parts', plan.body.blocking.length > 0, String(plan.body.blocking.length));
  ok('plan total is zero bytes', plan.body.totalBytes === 0, String(plan.body.totalBytes));

  const inst = await post('/v1/install', { workloads: ['desktop'], dest: path.join(empty, 'out') });
  ok('install refuses with 409', inst.status === 409, inst.status);
  ok('refusal names the missing parts', inst.body.error === 'required artefact missing' && Array.isArray(inst.body.missing) && inst.body.missing.length > 0, JSON.stringify(inst.body.error));
  ok('nothing was written', !fs.existsSync(path.join(empty, 'out')), 'dest created');

  const suite = await getJson('/v1/suite');
  ok('suite tree still renders', Array.isArray(suite.branches) && suite.branches.length > 0, String(suite.branches && suite.branches.length));
  const apps = await getJson('/v1/apps');
  ok('apps registry answers', Array.isArray(apps.apps) && apps.apps.length > 0, String(apps.apps && apps.apps.length));
  const health = await getJson('/v1/health');
  ok('health ok', health.ok === true, JSON.stringify(health).slice(0, 80));
} finally {
  await close();
  fs.rmSync(empty, { recursive: true, force: true });
}

const failed = checks.filter((c) => !c.pass);
for (const c of checks) console.log((c.pass ? 'ok   ' : 'FAIL ') + c.name + (c.detail !== undefined ? '  [' + c.detail + ']' : ''));
console.log('STUDIO-CLEAN ' + (failed.length ? 'FAIL' : 'PASS') + ' ' + (checks.length - failed.length) + '/' + checks.length);
process.exitCode = failed.length ? 1 : 0;
