/*
 * project-smoke.mjs - proves the three project modules do what they claim.
 *
 * Every check here is a real one: bytes are compared, hashes are recomputed,
 * a container is corrupted on purpose and must be caught, a workspace is
 * written to disk and read back, and the association planner is asked to write
 * to the registry with apply left off and then checked to have written nothing.
 *
 *   node work/project-smoke.mjs
 *
 * A live registry write is opt-in only (INFINITY_TEST_REGISTRY=1), because a
 * test that edits HKCU by default is a test that will one day edit a user's
 * machine. When enabled it uses a throwaway ProgID and removes it again.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'InfinityStudio', 'src');

const project = await import(new URL('file://' + path.join(SRC, 'project.js').replace(/\\/g, '/')).href);
const workspaceMod = await import(new URL('file://' + path.join(SRC, 'workspace.js').replace(/\\/g, '/')).href);
const associate = await import(new URL('file://' + path.join(SRC, 'associate.js').replace(/\\/g, '/')).href);

let passed = 0;
let failed = 0;
const failures = [];

function ok(cond, name, detail) {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failed++; failures.push(name + (detail ? ' - ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' - ' + detail : '')); }
  return !!cond;
}

function eq(actual, expected, name) {
  return ok(actual === expected, name, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

function section(title) {
  console.log('\n== ' + title);
}

const TMP = path.join(HERE, '.tmp-project-smoke');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

/* A payload worth compressing: repeated text, a small binary blob, and an
 * empty file - the empty one is the case that breaks naive offset maths. */
function sampleFiles() {
  const text = Buffer.from('Infinity Studio project payload.\n'.repeat(400), 'utf8');
  const blob = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  return [
    { path: 'docs/readme.md', bytes: text },
    { path: 'data/table.bin', bytes: blob },
    { path: 'empty.txt', bytes: Buffer.alloc(0) }
  ];
}

/* ---------------------------------------------------------------- project */

section('project.js - plain container round trip');
const files = sampleFiles();
const plain = project.encodeProject({ component: 'studio', files: files, compressed: false });
ok(Buffer.isBuffer(plain), 'encodeProject returns a Buffer');
eq(plain.toString('latin1', 0, 4), 'ISCP', 'magic is ISCP');
eq(plain.readUInt8(4), 0x01, 'kind byte is 0x01 for plain');

const decodedPlain = project.decodeProject(plain);
ok(decodedPlain.ok, 'decodeProject accepts its own output', decodedPlain.code);
eq(decodedPlain.files.length, 3, 'three files come back');
eq(decodedPlain.header.component, 'studio', 'component survives the round trip');
eq(decodedPlain.header.codec, 'plain', 'header names the codec');
for (const f of files) {
  const back = decodedPlain.files.find((x) => x.path === f.path);
  ok(!!back && Buffer.compare(back.bytes, f.bytes) === 0, 'file bytes identical: ' + f.path);
}
eq(decodedPlain.verified, true, 'decode verified every hash');

const reEncoded = project.encodeProject(decodedPlain);
ok(Buffer.compare(reEncoded, plain) === 0, 're-encoding the decoded project reproduces the same bytes');

const headerOnly = project.projectHeader(plain);
ok(headerOnly.ok, 'projectHeader accepts a Buffer');
eq(headerOnly.header.files.length, 3, 'header lists the files');
eq(headerOnly.payloadBytes, plain.length - headerOnly.headerBytes - project.HEADER_OFFSET, 'payload size is the container minus header');

section('project.js - compressed container');
const packed = project.encodeProject({ component: 'studio', files: files, compressed: true });
eq(packed.readUInt8(4), 0x02, 'kind byte is 0x02 for deflate');
ok(packed.length < plain.length, 'compressed container is smaller (' + packed.length + ' < ' + plain.length + ')');
const decodedPacked = project.decodeProject(packed);
ok(decodedPacked.ok, 'compressed container decodes', decodedPacked.code);
eq(decodedPacked.codec, 'deflate', 'codec is deflate');
eq(decodedPacked.extension, '.is-ccpx', 'extension is .is-ccpx');
for (const f of files) {
  const back = decodedPacked.files.find((x) => x.path === f.path);
  ok(!!back && Buffer.compare(back.bytes, f.bytes) === 0, 'compressed bytes identical: ' + f.path);
}
const emptyPacked = project.encodeProject({ component: 'studio', files: [], compressed: true });
const emptyBack = project.decodeProject(emptyPacked);
ok(emptyBack.ok && emptyBack.files.length === 0, 'an empty project round trips');

section('project.js - corruption is caught, not tolerated');
const tampered = Buffer.from(plain);
const lastByte = tampered.length - 1;
tampered[lastByte] = tampered[lastByte] ^ 0xff;
const tamperResult = project.decodeProject(tampered);
ok(!tamperResult.ok, 'a flipped payload byte is rejected');
eq(tamperResult.code, 'SHA_MISMATCH', 'the rejection names SHA_MISMATCH');
const damaged = files.filter((f) => f.bytes.length > 0).pop().path; /* the last byte belongs to the last non-empty file */
eq(tamperResult.path, damaged, 'the rejection names the damaged file');

const wrongMagic = Buffer.from(plain);
wrongMagic.write('ZIPC', 0, 'latin1');
eq(project.decodeProject(wrongMagic).code, 'BAD_MAGIC', 'a foreign magic is refused');

const truncated = plain.subarray(0, 6);
eq(project.decodeProject(truncated).code, 'TRUNCATED', 'a short buffer is refused');
const shortHeader = plain.subarray(0, project.HEADER_OFFSET + 4);
ok(!project.decodeProject(shortHeader).ok, 'a cut-off header is refused');

const badJson = Buffer.from(plain);
badJson[project.HEADER_OFFSET + 2] = 0x00; /* a NUL inside the header JSON: not parseable, and not a crash */
const mangled = project.decodeProject(badJson);
ok(!mangled.ok, 'a mangled header is refused rather than thrown');
eq(mangled.code, 'BAD_HEADER_JSON', 'the refusal is reported as BAD_HEADER_JSON');

const badKind = Buffer.from(plain);
badKind.writeUInt8(0x09, 4);
eq(project.decodeProject(badKind).code, 'UNKNOWN_KIND', 'an unknown kind byte is refused');

section('project.js - version gate');
const packedHeader = JSON.parse(packed.subarray(project.HEADER_OFFSET, project.HEADER_OFFSET + packed.readUInt32LE(5)).toString('utf8'));
function rebuildWithVersion(buf, version) {
  const hlen = buf.readUInt32LE(5);
  const header = JSON.parse(buf.subarray(project.HEADER_OFFSET, project.HEADER_OFFSET + hlen).toString('utf8'));
  header.version = version;
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const prefix = Buffer.from(buf.subarray(0, project.HEADER_OFFSET));
  prefix.writeUInt32LE(json.length, 5);
  return Buffer.concat([prefix, json, buf.subarray(project.HEADER_OFFSET + hlen)]);
}
eq(packedHeader.version, 2, 'a fresh compressed container is v2');
const oldVersion = project.decodeProject(rebuildWithVersion(packed, 1));
ok(!oldVersion.ok, 'a deflate container claiming v1 is refused');
eq(oldVersion.code, 'CODEC_TOO_OLD', 'the refusal is CODEC_TOO_OLD');
eq(oldVersion.since, 2, 'the refusal says which version the codec needs');
const tooNew = project.decodeProject(rebuildWithVersion(plain, 99));
eq(tooNew.code, 'CONTAINER_TOO_NEW', 'a future container version is refused');

section('project.js - files on disk');
const projectPath = path.join(TMP, 'demo.is-ccp');
const written = project.writeProject(projectPath, { component: 'studio', files: files, compressed: false });
ok(written.ok, 'writeProject writes the container', written.message);
eq(written.path, projectPath, 'writeProject reports the path');
eq(written.bytes, plain.length, 'writeProject reports the size');
eq(fs.readFileSync(projectPath).length, plain.length, 'the file on disk is the encoded length');
ok(fs.readdirSync(TMP).every((n) => !n.includes('.tmp-')), 'no temp file is left behind');

const readBack = project.readProject(projectPath);
ok(readBack.ok, 'readProject reads it back', readBack.code);
eq(readBack.path, projectPath, 'readProject reports the path');
eq(readBack.files.length, 3, 'readProject returns every file');
ok(Buffer.compare(readBack.files[0].bytes, files[0].bytes) === 0, 'readProject returns the same bytes');

const diskHeader = project.projectHeader(projectPath);
ok(diskHeader.ok, 'projectHeader reads a header straight off disk');
eq(diskHeader.header.files.length, 3, 'the on-disk header lists the files');
eq(diskHeader.totalBytes, plain.length, 'the on-disk header knows the file size');
ok(diskHeader.payloadBytes > 0, 'the on-disk header separates payload from header');

const packedPath = path.join(TMP, 'demo.is-ccpx');
const writtenPacked = project.writeProject(packedPath, { component: 'studio', files: files, compressed: true });
ok(writtenPacked.ok, 'writeProject writes a compressed container');
eq(project.projectHeader(packedPath).codec, 'deflate', 'the compressed file is recognised by its kind byte');

const autoExt = project.writeProject(path.join(TMP, 'auto.is-ccpx'), { component: 'studio', files: files });
eq(autoExt.codec, 'deflate', 'writeProject picks the codec from the extension');

/* Corrupt the file on disk, then read it: the failure must name the file. */
const corruptPath = path.join(TMP, 'corrupt.is-ccp');
const corruptBytes = Buffer.from(plain);
corruptBytes[corruptBytes.length - 1] ^= 0xff;
fs.writeFileSync(corruptPath, corruptBytes);
const corruptRead = project.readProject(corruptPath);
ok(!corruptRead.ok, 'a corrupted file on disk fails to read');
eq(corruptRead.code, 'SHA_MISMATCH', 'the on-disk failure is SHA_MISMATCH');
eq(corruptRead.path, corruptPath, 'the on-disk failure names the file');

/* -------------------------------------------------------------- workspace */

section('workspace.js - create, save, load');
const wsPath = path.join(TMP, 'demo.is-ws');
const created = workspaceMod.createWorkspace({ name: 'Demo Workspace', path: wsPath });
ok(created.ok, 'createWorkspace writes a workspace', created.message);
eq(created.path, wsPath, 'createWorkspace reports the path');
ok(fs.existsSync(wsPath), 'the workspace file exists on disk');
eq(created.workspace.format, 'is-ws', 'format is is-ws');
eq(created.workspace.version, 1, 'version is 1');
eq(created.workspace.name, 'Demo Workspace', 'the name is kept');

const loaded = workspaceMod.loadWorkspace(wsPath);
ok(loaded.ok, 'loadWorkspace reads it back', loaded.code);
eq(loaded.workspace.name, 'Demo Workspace', 'the loaded name matches');
eq(loaded.path, wsPath, 'loadWorkspace reports the path');
ok(Array.isArray(loaded.workspace.components) && loaded.workspace.components.length === 0, 'components start empty');

workspaceMod.addComponent(loaded.workspace, 'inc');
workspaceMod.addComponent(loaded.workspace, 'ipm');
workspaceMod.addComponent(loaded.workspace, 'inc');
eq(loaded.workspace.components.length, 2, 'adding the same component twice is a no-op');
workspaceMod.addProject(loaded.workspace, { path: projectPath, component: 'studio', codec: 'plain' });
eq(loaded.workspace.projects.length, 1, 'a project is recorded');
const savedAgain = workspaceMod.saveWorkspace(wsPath, loaded.workspace);
ok(savedAgain.ok, 'saveWorkspace rewrites it', savedAgain.message);
const reloaded = workspaceMod.loadWorkspace(wsPath);
eq(reloaded.workspace.components.join(','), 'inc,ipm', 'components survive the round trip');
eq(reloaded.workspace.projects[0].path, projectPath, 'the project path survives the round trip');
ok(fs.readdirSync(TMP).every((n) => !n.includes('.tmp-')), 'saveWorkspace leaves no temp file behind');

section('workspace.js - refusals');
const badFormat = { format: 'nope', version: 1, name: 'x' };
const badSave = workspaceMod.saveWorkspace(path.join(TMP, 'bad.is-ws'), badFormat);
ok(!badSave.ok, 'saveWorkspace refuses a malformed workspace');
eq(badSave.code, 'BAD_FORMAT', 'the refusal names BAD_FORMAT');
ok(!fs.existsSync(path.join(TMP, 'bad.is-ws')), 'a refused workspace is not written');

const futureWs = { format: 'is-ws', version: 99, name: 'future' };
eq(workspaceMod.validateWorkspace(futureWs).code, 'VERSION_TOO_NEW', 'a future workspace version is refused');
eq(workspaceMod.validateWorkspace({ format: 'is-ws', version: 1, name: '' }).code, 'BAD_FIELD', 'an empty name is refused');
eq(workspaceMod.validateWorkspace({ format: 'is-ws', version: 1, name: 'x', projects: [{ component: 'a' }] }).code, 'BAD_FIELD', 'a project without a path is refused');

const missing = workspaceMod.loadWorkspace(path.join(TMP, 'nope.is-ws'));
ok(!missing.ok, 'loading a missing workspace fails cleanly');
eq(missing.code, 'READ_FAILED', 'the missing-file failure is READ_FAILED');

fs.writeFileSync(path.join(TMP, 'broken.is-ws'), '{ not json');
eq(workspaceMod.loadWorkspace(path.join(TMP, 'broken.is-ws')).code, 'BAD_JSON', 'broken JSON is refused');

const summary = workspaceMod.workspaceSummary(reloaded.workspace);
eq(summary.projects, 1, 'workspaceSummary counts projects');
eq(summary.components.length, 2, 'workspaceSummary lists components');

/* ------------------------------------------------------------ association */

section('associate.js - planning');
const EXE = 'C:\\Program Files\\Infinity Studio\\infinitystudio.exe';
const onePlan = associate.planAssociations(['plain'], { exe: EXE });
eq(onePlan.length, 3, 'one codec plans exactly three operations');
eq(onePlan[0].hive, 'HKEY_CURRENT_USER', 'operations are HKCU only');
eq(onePlan[0].key, 'Software\\Classes\\.is-ccp', 'the extension key is first');
eq(onePlan[0].value, 'InfinityStudio.Project.Plain', 'the extension points at the ProgID');
eq(onePlan[1].key, 'Software\\Classes\\InfinityStudio.Project.Plain', 'the ProgID key is second');
eq(onePlan[2].key, 'Software\\Classes\\InfinityStudio.Project.Plain\\shell\\open\\command', 'the open command is third');
eq(onePlan[2].value, '"' + EXE + '" "%1"', 'the command quotes the exe and %1');
ok(onePlan.every((o) => o.hive === 'HKEY_CURRENT_USER'), 'no operation escapes HKCU');

const twoPlan = associate.planAssociations(associate.DEFAULT_CODECS, { exe: EXE });
eq(twoPlan.length, 6, 'two codecs plan six operations');
eq(twoPlan[3].key, 'Software\\Classes\\.is-ccpx', 'the second codec has its own extension key');
eq(associate.planAssociations(['plain'], {}).length, 0, 'no exe, no plan');
eq(associate.planAssociations(['nope'], { exe: EXE }).length, 0, 'an unknown codec is ignored');

section('associate.js - dry run writes nothing');
const probeKey = 'Software\\Classes\\InfinityStudio.Project.Plain';
const beforeProbe = associate.readValue('HKEY_CURRENT_USER\\' + probeKey);
const dry = associate.applyAssociations(twoPlan, { apply: false });
ok(dry.ok, 'a dry run reports ok');
eq(dry.applied, 0, 'a dry run applies zero operations');
eq(dry.dryRun, true, 'a dry run says so');
eq(dry.ops.length, 6, 'a dry run returns the plan it would have run');
ok(dry.ops.every((o) => o.status === 'planned'), 'every dry-run operation is marked planned');
const afterProbe = associate.readValue('HKEY_CURRENT_USER\\' + probeKey);
eq(afterProbe.found, beforeProbe.found, 'the registry was not touched by the dry run');

const noFlag = associate.applyAssociations(twoPlan);
eq(noFlag.applied, 0, 'omitting the flag is also a dry run');
eq(noFlag.dryRun, true, 'omitting the flag still reports a dry run');

const evil = [{ hive: 'HKLM', key: 'Software\\Classes\\.is-ccp', name: '', value: 'x', action: 'set' }];
const evilResult = associate.applyAssociations(evil, { apply: true });
ok(!evilResult.ok, 'a plan outside HKCU is refused even with apply set');
eq(evilResult.code, 'BAD_HIVE', 'the refusal names BAD_HIVE');
eq(evilResult.applied, 0, 'a refused plan applies nothing');

const outside = [{ hive: 'HKEY_CURRENT_USER', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Run', name: '', value: 'x', action: 'set' }];
eq(associate.applyAssociations(outside, { apply: true }).code, 'BAD_KEY', 'a key outside Software\\Classes is refused');

const removals = associate.planRemovals(['plain']);
eq(removals.length, 5, 'removal plans the five keys it created');
ok(removals.every((o) => o.action === 'delete'), 'every removal is a delete');
ok(removals[0].key.endsWith('\\shell\\open\\command'), 'removals delete deepest first');

section('associate.js - decoding reg.exe output');
ok(associate.decodeRegOutput(Buffer.from('    (默认)    REG_SZ    Infinity Studio 项目\r\n', 'utf8')).includes('Infinity Studio'), 'UTF-8 output decodes');
ok(typeof associate.decodeRegOutput(Buffer.from([0xc4, 0xe3])) === 'string', 'arbitrary bytes never throw');

/* Opt-in live registry check: a throwaway ProgID, written and removed again. */
if (process.env.INFINITY_TEST_REGISTRY === '1') {
  section('associate.js - live registry round trip (opt-in)');
  const liveCodec = { id: 'smoke' + process.pid, ext: '.is-smoke' + process.pid, label: 'Infinity Studio smoke test' };
  const livePlan = associate.planAssociations([liveCodec], { exe: EXE });
  const applied = associate.applyAssociations(livePlan, { apply: true });
  ok(applied.ok, 'apply=true really writes and reads back', JSON.stringify(applied.ops.filter((o) => o.status !== 'ok')));
  eq(applied.applied, 3, 'all three live operations verify');
  const readExtension = associate.readValue('HKEY_CURRENT_USER\\Software\\Classes\\' + liveCodec.ext);
  eq(readExtension.value, liveCodec.ext === undefined ? null : livePlan[0].value, 'the extension value reads back');
  const cleanup = associate.applyAssociations(associate.planRemovals([liveCodec]), { apply: true });
  ok(cleanup.ok, 'the live test removes what it wrote', JSON.stringify(cleanup.ops.filter((o) => o.status !== 'ok')));
  ok(!associate.readValue('HKEY_CURRENT_USER\\Software\\Classes\\' + liveCodec.ext).found, 'the probe key is gone afterwards');
} else {
  console.log('\n== associate.js - live registry round trip (skipped, set INFINITY_TEST_REGISTRY=1 to run)');
}

/* ------------------------------------------------------------------ done */

fs.rmSync(TMP, { recursive: true, force: true });

console.log('\n' + '-'.repeat(56));
console.log('passed: ' + passed + '   failed: ' + failed);
if (failed) {
  for (const f of failures) console.log('  FAILED: ' + f);
  console.log('RESULT: FAIL');
  process.exit(1);
}
console.log('RESULT: PASS');
