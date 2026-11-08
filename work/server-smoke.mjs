const m = (await import('file:///D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/InfinityStudio/src/apps/server.js?v=' + Date.now())).default;
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

let pass = 0;
let fail = 0;
function check(desc, cond, extra) {
  if (cond) { pass += 1; console.log('ok   ' + desc); }
  else { fail += 1; console.log('FAIL ' + desc + (extra !== undefined ? ' <- ' + JSON.stringify(extra) : '')); }
}

/* 临时目录固定在工作区内（本环境 os.tmpdir() 可能是相对路径）。 */
const TMP = path.resolve('work', 'tmp-server-smoke-' + Date.now());
fs.mkdirSync(TMP, { recursive: true });

function listenOn(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}
function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

(async () => {
  check('module loads META/capabilities/plan/run', !!m && typeof m.run === 'function' && typeof m.plan === 'function' && typeof m.capabilities === 'function');

  const cap = m.capabilities();
  check('capabilities implemented + id', cap && cap.implemented === true && cap.id === 'server', cap);
  check('capabilities features 3', Array.isArray(cap.features) && cap.features.length === 3, cap.features);
  check('META codecs .json/.pid', m.META.codecs.map((c) => c.ext).join(',') === '.json,.pid', m.META.codecs);

  // ---- probe: a real listening socket ----
  const live = net.createServer((sock) => sock.end());
  const livePort = await listenOn(live);
  const hit = await m.run('probe', { port: livePort });
  check('probe live -> alive true', hit && hit.ok === true && hit.alive === true, hit);
  check('probe live latency > 0', typeof hit.latencyMs === 'number' && hit.latencyMs > 0, hit && hit.latencyMs);
  check('probe live echoes port/host', hit.port === livePort && hit.host === '127.0.0.1', hit);

  // ---- probe: the same port after it is closed ----
  await closeServer(live);
  const dead = await m.run('probe', { port: livePort, timeoutMs: 800 });
  check('probe closed -> alive false', dead && dead.ok === true && dead.alive === false, dead);
  check('probe closed reason REFUSED', dead.reason === 'REFUSED', dead);

  // ---- probe: argument validation ----
  check('probe port 0 -> BAD_PORT', (await m.run('probe', { port: 0 })).error === 'BAD_PORT');
  check('probe port 70000 -> BAD_PORT', (await m.run('probe', { port: 70000 })).error === 'BAD_PORT');
  check('probe non-loopback -> BAD_HOST', (await m.run('probe', { port: 80, host: 'example.com' })).error === 'BAD_HOST');
  check('probe localhost allowed', (await m.run('probe', { port: livePort, host: 'localhost', timeoutMs: 500 })).ok === true);

  // ---- pid: a real child process, then really killed ----
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 250));
  const pidLiveFile = path.join(TMP, 'live.pid');
  fs.writeFileSync(pidLiveFile, String(child.pid));
  const pidAlive = await m.run('pid', { path: pidLiveFile });
  check('pid of live child -> alive true', pidAlive && pidAlive.ok === true && pidAlive.alive === true && pidAlive.pid === child.pid, pidAlive);

  const exited = new Promise((r) => child.once('exit', r));
  child.kill();
  await exited;
  await new Promise((r) => setTimeout(r, 200));
  const pidDead = await m.run('pid', { path: pidLiveFile });
  check('pid of killed child -> alive false', pidDead && pidDead.ok === true && pidDead.alive === false, pidDead);

  // ---- pid: file problems ----
  check('pid missing file -> READ_FAILED', (await m.run('pid', { path: path.join(TMP, 'nope.pid') })).error === 'READ_FAILED');
  const badPid = path.join(TMP, 'bad.pid');
  fs.writeFileSync(badPid, 'not-a-pid');
  check('pid bad content -> BAD_PID', (await m.run('pid', { path: badPid })).error === 'BAD_PID');
  const zeroPid = path.join(TMP, 'zero.pid');
  fs.writeFileSync(zeroPid, '0');
  check('pid zero -> BAD_PID', (await m.run('pid', { path: zeroPid })).error === 'BAD_PID');
  check('pid without path -> MISSING_PATH', (await m.run('pid', {})).error === 'MISSING_PATH');

  // ---- manifest ----
  const good = path.join(TMP, 'good.json');
  fs.writeFileSync(good, JSON.stringify({ services: [{ id: 'hub', port: 7621 }, { id: 'studio', port: 7630 }] }));
  const mg = await m.run('manifest', { path: good });
  check('manifest good -> ok, 2 services, 0 issues', mg && mg.ok === true && mg.services === 2 && mg.issues.length === 0, mg);

  const bad = path.join(TMP, 'bad.json');
  fs.writeFileSync(bad, JSON.stringify({ services: [{ id: 'dup', port: 7621 }, { id: 'dup', port: 99999 }] }));
  const mb = await m.run('manifest', { path: bad });
  check('manifest bad -> ok false, exactly 2 issues', mb && mb.ok === false && mb.services === 2 && mb.issues.length === 2, mb);
  check('manifest bad issues mention dup id', mb.issues.some((s) => s.includes('重复')), mb.issues);
  check('manifest bad issues mention port', mb.issues.some((s) => s.includes('端口')), mb.issues);

  const broken = path.join(TMP, 'broken.json');
  fs.writeFileSync(broken, '{not json');
  check('manifest bad json -> BAD_JSON', (await m.run('manifest', { path: broken })).error === 'BAD_JSON');
  const noServices = path.join(TMP, 'noservices.json');
  fs.writeFileSync(noServices, JSON.stringify({ items: [] }));
  check('manifest without services -> BAD_MANIFEST', (await m.run('manifest', { path: noServices })).error === 'BAD_MANIFEST');
  check('manifest missing file -> READ_FAILED', (await m.run('manifest', { path: path.join(TMP, 'nope.json') })).error === 'READ_FAILED');

  // ---- plan / unknown ----
  const p = m.plan('probe', { port: 7621 });
  check('plan probe ok with 2 steps', p && p.ok === true && p.steps.length === 2, p);
  check('plan probe warns on bad port', m.plan('probe', { port: 99999 }).ok === false);
  check('plan unknown -> UNKNOWN_ACTION', m.plan('ghost', {}).error === 'UNKNOWN_ACTION');
  check('run unknown -> UNKNOWN_ACTION', (await m.run('ghost', {})).error === 'UNKNOWN_ACTION');
  check('default host/timeout exported', m.DEFAULT_TCP_HOST === '127.0.0.1' && m.DEFAULT_TIMEOUT_MS === 1500);

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('SERVER-SMOKE-' + (fail === 0 ? 'PASS ' : 'FAIL ') + pass + '/' + (pass + fail));
  process.exitCode = fail > 0 ? 1 : 0;
})();
