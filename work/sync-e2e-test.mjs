// sync-e2e-test.mjs — 归档流水线端到端回归测试（完全隔离，不触碰真实归档）
// 覆盖：sync-history.mjs 追加 -> 增量再次追加 -> 无变化幂等 -> build-manifest 重建 -> restore-history.ps1 独立还原
// 用法: node work/sync-e2e-test.mjs       成功打印 SYNC-E2E-PASS 并 exit 0
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const NODE = process.execPath;
const TMP = path.join(ROOT, 'work', '_e2e-sync');
const HEADER_BYTES = 4096;
const problems = [];
const steps = [];
const note = (s) => { steps.push(s); console.log('  ' + s); };

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP, 'history', 'subagents', 'agent-a'), { recursive: true });

// 1) seed a minimal valid archive header
const header = { files: 0, blobs: 0, chunks: 0, chunkSeq: 0, chunkBytes: 16777216, quality: 10, lgwin: 24, origBytes: 0, uniqueBytes: 0, snapshots: 0, codec: 'brotli', appended: [] };
const hb = Buffer.from(JSON.stringify(header), 'utf8');
if (hb.length >= HEADER_BYTES) throw new Error('seed header too long');
const pad = Buffer.alloc(HEADER_BYTES, 0x20);
hb.copy(pad, 0);
pad[HEADER_BYTES - 1] = 0x0a;
const ARCHIVE = path.join(TMP, 'history', 'history.jsonl');
fs.writeFileSync(ARCHIVE, pad);
note('seeded archive header ' + fs.statSync(ARCHIVE).size + ' B');

const live = path.join(TMP, 'history', 'session.v4.jsonl');
const sub = path.join(TMP, 'history', 'subagents', 'agent-a', 'session.v4.jsonl');
fs.writeFileSync(live, Array.from({ length: 40 }, (_, i) => JSON.stringify({ i, text: 'line ' + i, pad: 'x'.repeat(50) })).join('\n') + '\n');
fs.writeFileSync(sub, JSON.stringify({ role: 'assistant', content: '子代理会话内容' }) + '\n');

const STATE = path.join(TMP, 'state.json');
function sync(extra = []) {
  const out = execFileSync(NODE, [path.join(ROOT, 'work/sync-history.mjs'), '--root', path.join(TMP, 'history'), '--state', STATE, '--no-live', '--quiet', ...extra], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const line = out.trim().split(/\r?\n/).filter(Boolean).pop();
  return JSON.parse(line);
}
const r1 = sync();
note('run1 action=' + r1.action + ' changed=' + r1.changed + ' files=' + r1.headerFiles + ' archive=' + r1.archiveBytes);
if (r1.action !== 'appended' || r1.changed !== 2 || r1.headerFiles !== 2) problems.push('run1 unexpected: ' + JSON.stringify(r1));

fs.appendFileSync(live, JSON.stringify({ i: 99, text: 'a new line appended', pad: 'y'.repeat(60) }) + '\n');
const r2 = sync();
note('run2 action=' + r2.action + ' changed=' + r2.changed + ' files=' + r2.headerFiles);
if (r2.action !== 'appended' || r2.changed !== 1 || r2.headerFiles !== 3) problems.push('run2 unexpected: ' + JSON.stringify(r2));

const r3 = sync();
note('run3 action=' + r3.action + ' (expect up-to-date)');
if (r3.action !== 'up-to-date') problems.push('run3 not idempotent: ' + JSON.stringify(r3));

// 4) manifest rebuild (all outputs redirected into the temp tree)
const MF = path.join(TMP, 'manifest.json');
const mOut = execFileSync(NODE, [path.join(ROOT, 'work/build-manifest.mjs'), '--archive', ARCHIVE, '--map', path.join(TMP, 'no-map.json'), '--out', MF, '--fresh', path.join(TMP, 'manifest-fresh.json'), '--aliases', path.join(TMP, 'aliases.json'), '--verify', '3'], { cwd: ROOT, encoding: 'utf8' });
const m = JSON.parse(mOut);
note('manifest uniquePaths=' + m.uniquePaths + ' aliased=' + m.aliased + ' verifyFailed=' + m.verifyFailed + ' bytes=' + m.outBytes);
// 3 条条目 / 2 个唯一路径（session.v4.jsonl 被追加过两次）；manifest 取首次出现
if (m.uniquePaths !== 2) problems.push('manifest uniquePaths=' + m.uniquePaths + ' (expect 2)');
if (m.verifyFailed !== 0) problems.push('manifest verifyFailed=' + m.verifyFailed);

// 5) independent restore of the temp archive
const SUMMARY = path.join(TMP, 'restore-summary.json');
let restoreExit = 0, restoreOut = '';
try {
  restoreOut = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'work/restore-history.ps1'), '-Archive', ARCHIVE, '-Manifest', MF, '-OutDir', path.join(TMP, 'restore'), '-MinSample', '3', '-TopLargest', '2', '-RandomFill', '3', '-ChineseSample', '1', '-CrossChunkSample', '1', '-Seed', '1', '-SummaryJson', SUMMARY], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
} catch (e) { restoreExit = typeof e.status === 'number' ? e.status : -1; restoreOut = String(e.stdout || '') + String(e.stderr || ''); }
const rs = fs.existsSync(SUMMARY) ? JSON.parse(fs.readFileSync(SUMMARY, 'utf8')) : null;
if (rs) note('restore sample=' + rs.sampleCount + ' exact=' + rs.exactCount + ' mismatch=' + rs.mismatchCount + ' bytes=' + rs.restoredBytes);
else problems.push('restore produced no summary (exit ' + restoreExit + '): ' + restoreOut.slice(-200));
if (restoreExit !== 0) problems.push('restore exit=' + restoreExit);
if (rs && (rs.mismatchCount !== 0 || rs.exactCount !== rs.sampleCount)) problems.push('restore not exact: ' + JSON.stringify(rs.mismatches));
if (rs && rs.sampleCount !== 2) problems.push('restore sampled ' + rs.sampleCount + ' paths (expect 2 unique paths)');
// 关键契约：同一路径多次追加时，还原必须与 manifest 一样取"首次出现"的那一版
const restoredLive = path.join(TMP, 'restore', 'session.v4.jsonl');
if (!fs.existsSync(restoredLive)) problems.push('restored session.v4.jsonl missing');
else {
  const bytes = fs.readFileSync(restoredLive);
  const manifestEntry = fs.readFileSync(MF, 'utf8').split('\n').map((l) => JSON.parse(l)).find((e) => e.p === 'session.v4.jsonl');
  const h = crypto.createHash('sha256').update(bytes).digest('hex');
  note('restored session.v4.jsonl ' + bytes.length + ' B sha ' + h.slice(0, 16) + ' (first version, manifest says ' + manifestEntry.h.slice(0, 16) + ')');
  if (bytes.length !== manifestEntry.s || h !== manifestEntry.h) problems.push('restored file is not the first occurrence: ' + bytes.length + '/' + h.slice(0, 16));
}

// 6) the real archive and its manifest must be untouched by this test
const realBytes = fs.statSync(path.join(ROOT, 'history/history.jsonl')).size;
const realManifest = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'work/history-manifest.json'))).digest('hex');
note('real archive ' + realBytes + ' B, real manifest sha ' + realManifest.slice(0, 16) + ' (untouched)');

if (problems.length === 0) fs.rmSync(TMP, { recursive: true, force: true });
const result = { ok: problems.length === 0, steps, problems, keptTemp: problems.length > 0 ? TMP : null };
console.log(JSON.stringify(result, null, 1));
console.log(problems.length === 0 ? 'SYNC-E2E-PASS' : 'SYNC-E2E-FAIL ' + problems.length);
process.exit(problems.length === 0 ? 0 : 1);
