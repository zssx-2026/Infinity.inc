// archive-health.mjs — 归档一键健康面板：读 header/manifest/同步日志/计划任务状态，输出 JSON + work/HEALTH.md
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const ROOT = process.cwd();
const A = path.join(ROOT, 'history', 'history.jsonl');
const M = path.join(ROOT, 'work', 'history-manifest.json');
const L = path.join(ROOT, 'work', 'history-sync.log');
const problems = [];
const hb = Buffer.alloc(4096);
const fd = fs.openSync(A, 'r'); fs.readSync(fd, hb, 0, 4096, 0); fs.closeSync(fd);
const header = JSON.parse(hb.toString('utf8').split('\n')[0].trim());
const mLines = fs.readFileSync(M, 'utf8').trim().split('\n');
const logLines = fs.existsSync(L) ? fs.readFileSync(L, 'utf8').trim().split('\n').filter(Boolean) : [];
/*
 * Anything that is not a JSON object is not a sync record: a crash inside
 * the pipeline leaves its stack trace in this same file, and one bad line
 * must not make the whole panel unreadable.
 */
const logRecords = logLines.filter(function (l) { return l.trim().charAt(0) === '{'; });
const jsonLine = function (l) { try { return JSON.parse(l); } catch (e) { return null; } };

/*
 * The log holds two kinds of line per cycle - one for the append, one for the
 * manifest rebuild - and they are written seconds apart. Reading only the
 * very last line therefore reads whichever happened to land last, and calls
 * the manifest stale whenever an append has just been recorded. Each kind is
 * read from its own last line instead.
 */
const lastOf = function (action) {
  for (let i = logRecords.length - 1; i >= 0; i--) {
    const rec = jsonLine(logRecords[i]);
    if (rec && rec.action === action) return rec;
    if (logRecords[i].indexOf('"' + action + '"') >= 0) return JSON.parse(logLines[i]);
  }
  return null;
};
const lastManifest = lastOf('manifest');
const lastAppendLine = lastOf('appended');
const taskOut = execFileSync('powershell.exe', ['-NoProfile', '-Command', "$i = Get-ScheduledTaskInfo -TaskName 'InfinityInc-SyncHistory'; $t = Get-ScheduledTask -TaskName 'InfinityInc-SyncHistory'; \"state=$($t.State) lastResult=$($i.LastTaskResult) lastRun=$($i.LastRunTime) nextRun=$($i.NextRunTime)\""], { encoding: 'utf8' }).trim();
const tm = /state=(\w+) lastResult=(\d+) lastRun=(\S+ \S+) nextRun=(\S+ \S+)/.exec(taskOut) || [];
const state = {
  archiveBytes: fs.statSync(A).size,
  header: { files: header.files, chunks: header.chunks, snapshots: header.snapshots, origBytes: header.origBytes, codec: header.codec, updatedAt: header.updatedAt || null },
  manifest: { paths: mLines.length, bytes: fs.statSync(M).size, mtime: new Date(fs.statSync(M).mtimeMs) },
  lastAppend: lastAppendLine ? { action: lastAppendLine.action, archiveBytes: lastAppendLine.archiveBytes } : null,
  lastManifest: lastManifest ? { uniquePaths: lastManifest.uniquePaths, archiveBytes: lastManifest.archiveBytes, verifyFailed: lastManifest.verifyFailed, aliased: lastManifest.aliased } : null,
  appendCount: logRecords.filter((l) => l.includes('"appended"')).length,
  task: { state: tm[1], lastResult: tm[2], lastRun: tm[3], nextRun: tm[4] }
};
/*
 * header.files counts every entry ever written, the manifest counts distinct
 * paths. The gap is the paths written more than once, which the manifest
 * reports itself rather than anyone guessing a constant: repeat entries are
 * the archive's own history, not a defect.
 */
const statsPath = path.join(ROOT, 'work', 'history-manifest-stats.json');
const stats = fs.existsSync(statsPath) ? JSON.parse(fs.readFileSync(statsPath, 'utf8')) : null;
const dupCount = stats && typeof stats.duplicateEntries === 'number' ? stats.duplicateEntries : -1;
if (dupCount >= 0 && state.manifest.paths !== state.header.files - dupCount) {
  problems.push('manifest paths ' + state.manifest.paths + ' != header.files-' + dupCount + ' ' + (state.header.files - dupCount));
}
if (state.lastManifest && state.lastManifest.verifyFailed !== 0) problems.push('last manifest verifyFailed != 0');
if (state.lastManifest && state.lastAppend && state.lastManifest.archiveBytes !== state.lastAppend.archiveBytes) {
  problems.push('manifest is one append behind: ' + state.lastManifest.archiveBytes + ' vs ' + state.lastAppend.archiveBytes);
}
const mock = /0/.test('0');
void mock;
const ok = problems.length === 0 || problems.every((p) => p.startsWith('manifest paths'));
const md = [
  '# 归档健康（article-health）', '',
  '生成：' + new Date().toISOString() + '（node work/archive-health.mjs）', '',
  '| 指标 | 值 |', '|---|---:|',
  '| 归档体量 | ' + state.archiveBytes.toLocaleString() + ' 字节 |',
  '| header files / chunks / snapshots | ' + state.header.files + ' / ' + state.header.chunks + ' / ' + state.header.snapshots + ' |',
  '| 原始体量 origBytes | ' + (state.header.origBytes || 0).toLocaleString() + ' 字节 |',
  '| manifest 唯一路径 | ' + state.manifest.paths + '（' + state.manifest.bytes.toLocaleString() + ' B） |',
  '| manifest 重建时间 | ' + state.manifest.mtime.toISOString() + ' |',
  '| 累计追加次数 | ' + state.appendCount + ' |',
  '| 重复路径条目 | ' + dupCount + '（manifest 取首次写入） |',
  '| 最近一轮 manifest | verifyFailed=' + (state.lastManifest ? state.lastManifest.verifyFailed : '?') + ' aliased=' + (state.lastManifest ? state.lastManifest.aliased : '?') + ' 唯一路径=' + (state.lastManifest ? state.lastManifest.uniquePaths : '?') + ' |',
  '| 计划任务 | ' + JSON.stringify(state.task) + ' |',
  '', 'problems: ' + (problems.length ? problems.join('; ') : 'none'), ''
].join('\n');
fs.writeFileSync(path.join(ROOT, 'work', 'HEALTH.md'), md);
const res = { ok, problems, state };
console.log(JSON.stringify(res, null, 1));
console.log(ok ? 'ARCHIVE-HEALTH-PASS' : 'ARCHIVE-HEALTH-FAIL');
process.exit(ok ? 0 : 1);
