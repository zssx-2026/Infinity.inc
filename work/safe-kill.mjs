// work/safe-kill.mjs —— 唯一被授权的清理方式（Lead 2026-10-04 20:50）
// 规则：只杀“命令行里出现我方测试路径”的进程，并且先打印再杀；绝不按进程名批量杀。
// 用法： node work/safe-kill.mjs            (dry-run，只列出候选)
//        node work/safe-kill.mjs --apply    (先打印，再 taskkill /T /F 每个候选 PID)
import { execFileSync } from 'node:child_process';

const OWN = [
  'Infinity.inc\\work\\_account-shots',
  'Infinity.inc\\work\\_token-shots',
  'Infinity.inc\\Chormium',
  'Infinity.inc\\work\\webview2',
  'Infinity.inc\\cpp\\apps',
  'kernel-host.exe',
  'webview2-host.exe',
  'inc_gui.exe',
  'unblock-nsis-test.exe',
];
// 永不触碰（即使用户浏览器命令行恰好含路径）：
const NEVER = /^(msedge|chrome|explorer|SearchHost|fastbrowser|firefox|brave|vivaldi)\.exe$/i;

const ps = [
  "$ErrorActionPreference='SilentlyContinue'",
  "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | ForEach-Object {",
  "  '{0}\t{1}\t{2}' -f $_.ProcessId, $_.Name, ($_.CommandLine -replace '\s+',' ')",
  "}",
].join(';');
const raw = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true });
const rows = raw.split(/\r?\n/).map(l => l.split('\t')).filter(p => p.length === 3 && p[0].trim());
let apply = process.argv.includes('--apply');
const hits = rows.filter(([, name, cmd]) => !NEVER.test(name) && OWN.some(k => cmd.includes(k)));
console.log('candidates: ' + hits.length + '  (dry-run=' + (!apply) + ')');
for (const [pid, name, cmd] of hits) console.log('  pid=' + pid + ' ' + name + ' :: ' + cmd.slice(0, 160));
if (!apply) { console.log('nothing killed. re-run with --apply to kill exactly these PIDs.'); process.exit(0); }
/*
 * KILL-DISABLED-GUARD (Lead 2026-10-06): a blanket --apply is no longer allowed. A kill only
 * happens for PIDs listed line by line in work/_kill-allowlist.txt, and never for a process the
 * Lead did not explicitly name. This exists because a cleanup run must not be able to end the
 * user's own application.
 */
const allowFile = new URL('_kill-allowlist.txt', import.meta.url);
let allowed = [];
try { allowed = (await import('node:fs')).readFileSync(allowFile, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean); } catch { }
if (!allowed.length) { console.log('REFUSED: no work/_kill-allowlist.txt; refusing to kill anything.'); process.exit(1); }
hits = hits.filter(([pid]) => allowed.includes(pid));
if (!hits.length) { console.log('REFUSED: none of the candidates are in the allowlist.'); process.exit(1); }
console.log('allowed kills: ' + hits.length);
for (const [pid] of hits) {
  try { execFileSync('taskkill.exe', ['/T', '/F', '/PID', pid], { stdio: 'ignore', windowsHide: true }); console.log('killed pid=' + pid); }
  catch { console.log('kill failed pid=' + pid + ' (already gone?)'); }
}
