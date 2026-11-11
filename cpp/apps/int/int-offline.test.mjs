/*
 * int-offline.test.mjs - Infinity Toolbox offline self-test.
 *
 * Runs the CLI face of cpp/build/int.exe (no window) against the .itbt plugin
 * fixtures in _bench/root, with LOCALAPPDATA redirected at that fixture root so
 * nothing touches the real install root:
 *
 *   int --paths                          where it keeps things
 *   int plugin list                      reads item.json + FastBrowser.itbt
 *   int plugin verify FastBrowser        re-hashes the container entries
 *
 * and then checks the plugin record format the Toolbox reads.
 *
 * No network, no download, no install/uninstall, no window.
 * Exit 0 = pass, 1 = fail.
 *
 * Usage: node cpp/apps/int/int-offline.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const INT = path.join(ROOT, 'cpp', 'build', 'int.exe');
const FIXTURE = path.join(HERE, '_bench', 'root');
const env = Object.assign({}, process.env, { LOCALAPPDATA: FIXTURE });
const ANSI = /\u001b\[[0-9;]*m/g;

let checks = 0, failures = 0;
function ok(name, cond, detail) {
  checks++;
  if (!cond) { failures++; console.log('FAIL ' + name + (detail === undefined ? '' : '  >> ' + JSON.stringify(detail))); }
  else console.log('PASS ' + name);
}
function run(args, withEnv) {
  try {
    const stdout = execFileSync(INT, args, { encoding: 'utf8', windowsHide: true, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'], env: withEnv ? env : process.env });
    return { status: 0, stdout: stdout.replace(ANSI, '') };
  } catch (e) {
    return { status: e.status === undefined ? -1 : e.status, stdout: String(e.stdout || '').replace(ANSI, ''), error: String(e.message) };
  }
}

const paths = run(['--paths']);
ok('int --paths exits 0', paths.status === 0, paths.status + ' ' + (paths.error || ''));
ok('int --paths reports version 1.0.0-pre7', paths.stdout.indexOf('1.0.0-pre7') >= 0);

const list = run(['plugin', 'list'], true);
ok('int plugin list exits 0 (sandboxed LOCALAPPDATA)', list.status === 0, list.status + ' ' + (list.error || ''));
ok('int plugin list sees FastBrowser 1.0.0', list.stdout.indexOf('FastBrowser') >= 0 && list.stdout.indexOf('1.0.0') >= 0);
ok('int plugin list marks it installed', /installed/i.test(list.stdout), list.stdout.slice(0, 200));

const verify = run(['plugin', 'verify', 'FastBrowser'], true);
ok('int plugin verify exits 0', verify.status === 0, verify.status + ' ' + (verify.error || ''));
ok('int plugin verify re-hashes 2 entries', /verified 2 entries/i.test(verify.stdout), verify.stdout.slice(0, 200));

const recPath = path.join(FIXTURE, 'Infinity.Inc', 'plugin', 'FastBrowser', 'item.json');
let rec = null;
try { rec = JSON.parse(fs.readFileSync(recPath, 'utf8')); } catch (e) { /* reported below */ }
ok('plugin record carries name/version/filename', !!rec && !!rec.name && !!rec.version && !!rec.filename, rec);
ok('the record and the container agree on the name', !!rec && rec.name === 'FastBrowser', rec && rec.name);

console.log('\n' + (failures ? 'RESULT: FAIL ' : 'RESULT: PASS ') + (checks - failures) + '/' + checks + ' checks');
process.exit(failures ? 1 : 0);
