/*
 * ipm-nsi-check.mjs - validate the InfinityPackageManager installer template
 * the same way Infinity Cloud's installer.nsi is validated, without running
 * makensis (which is what the "no heavy builds while the user is gaming"
 * rule forbids).
 *
 * IPM keeps its script at InfinityPackageManager/nsis.nsi and fills it from
 * tools/make-setup.mjs, not sourcecode/tools/. nsi-check.mjs therefore needs
 * two things handed to it explicitly:
 *   --template  the generated instance, because the template still holds
 *               @@...@@ placeholders and would be judged as a template
 *               (missing un.onInit, missing $UNINST_KEY_THIS - rules that
 *               only apply to the coexist family Infinity Cloud belongs to)
 *   --instance  so it checks the script that actually ships
 *
 * So this script does the placeholder fill make-setup.mjs does, writes the
 * instance with the UTF-8 BOM makensis requires, and hands it over. It never
 * compiles; nsi-check.mjs is run with --no-compile.
 *
 * Usage: node work/ipm-nsi-check.mjs
 * Exit:  0 = no error (warnings allowed), 1 = error, 2 = environment error
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { spawnSync } from 'node:child_process';

const NL = String.fromCharCode(10);
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(HERE, '..');
const IPM = path.join(WORKSPACE, 'InfinityPackageManager');
const TEMPLATE = path.join(IPM, 'nsis.nsi');
const STAGE = path.join(IPM, 'build', 'setup-stage', 'win64');
const NSI_CHECK = path.join(WORKSPACE, 'Infinity Cloud', 'sourcecode', 'tools', 'nsi-check.mjs');
const OUT = path.join(HERE, '_ipm-nsi');
const NODE = process.execPath;

if (!fs.existsSync(TEMPLATE)) { console.error('missing ' + TEMPLATE); process.exit(2); }
if (!fs.existsSync(NSI_CHECK)) { console.error('missing ' + NSI_CHECK); process.exit(2); }
if (!fs.existsSync(STAGE)) { console.error('missing payload ' + STAGE + ' (run make-setup.mjs first)'); process.exit(2); }

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const version = process.argv[2] || 'v1.0pre5';
const setupPath = path.join(OUT, 'InfinityPackageManager_' + version + '_Setup.exe');
const instance = path.join(OUT, 'setup-win64.nsi');

let filled = fs.readFileSync(TEMPLATE, 'utf8').replace(/^\uFEFF/, '');
filled = filled
  .split('@@VERSION@@').join(version)
  .split('@@OUTFILE@@').join(setupPath)
  .split('@@APP_DIR@@').join(STAGE)
  .split('@@EXE@@').join('ipm_launcher.exe');

const left = ['@@VERSION@@', '@@OUTFILE@@', '@@APP_DIR@@', '@@EXE@@']
  .filter(function (p) { return filled.indexOf(p) >= 0; });
if (left.length) { console.error('unreplaced placeholders: ' + left.join(', ')); process.exit(2); }

fs.writeFileSync(instance, '\uFEFF' + filled, 'utf8');

const r = spawnSync(NODE, [NSI_CHECK, '--instance', '--no-compile',
  '--template', instance, '--root', IPM, '--payload', STAGE], {
  cwd: WORKSPACE, encoding: 'utf8', windowsHide: true, maxBuffer: 67108864,
  env: Object.assign({}, process.env, { NODE_OPTIONS: '' })
});

process.stdout.write(r.stdout || '');
if (r.stderr) process.stdout.write(r.stderr);

const ok = r.status === 0;
process.stdout.write(NL + (ok ? 'IPM-NSI-CHECK PASS' : 'IPM-NSI-CHECK FAIL') + NL);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
