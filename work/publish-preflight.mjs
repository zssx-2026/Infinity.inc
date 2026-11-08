// publish-preflight.mjs — 发布前"一键自检"：技术项全绿 + 显式列出人工闸门（token / 书面批准）
// 用法: node work/publish-preflight.mjs   (技术项任一失败 -> exit 1；闸门只报告不判失败)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const NODE = process.execPath;
const checks = [];
function run(name, cwd, args, needle) {
  const t0 = Date.now();
  let out = '', code = 0;
  try { out = execFileSync(args[0] || NODE, args[1] || [], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { code = typeof e.status === 'number' ? e.status : -1; out = String(e.stdout || '') + String(e.stderr || ''); }
  const ok = code === 0 && out.includes(needle);
  checks.push({ name, exit: code, ok, needle, secs: Math.round((Date.now() - t0) / 100) / 10 });
  return out;
}
run('release-set-parity', ROOT, [NODE, ['work/release-set-parity.mjs']], 'RELEASE-SET-PARITY-PASS');
for (const dir of ['cpp/release/v1.0pre5', 'installers/packaging/v1.0pre5']) {
  const out = run('sha256sums:' + dir, ROOT, [NODE, ['cpp/tools/sha256sums.mjs', dir, '--check']], '"problems": []');
  void out;
}
run('gen-releases-check', ROOT, [NODE, ['work/gen-releases-json.mjs', '--check']], 'RELEASES-CHECK-PASS');
run('site-release-consistency', ROOT, [NODE, ['work/site-release-consistency.mjs']], 'failed: 0');
// --skip-remote：只做本地校验（不消耗 GitHub 匿名配额），供终验套件使用
const SKIP_REMOTE = process.argv.includes('--skip-remote');
const ghArgs = SKIP_REMOTE ? ['work/ghsync.mjs', '--dry-run'] : ['work/ghsync.mjs', '--dry-run', '--remote'];
const ghOut = run(SKIP_REMOTE ? 'ghsync-dry-local' : 'ghsync-dry-remote', ROOT, [NODE, ghArgs], '0 errors');
// 未登录时的 HTTP 403/429 是 GitHub 匿名配额（60 次/小时）耗尽，属外部闸门而非技术缺陷：
// 有 token 时同样的 403 才是真错误（权限不足），因此只在 token 缺失时降级为闸门。
let anonQuota = false, quotaNote = '';
if (!process.env.EV_GH_TOKEN && /HTTP 403/.test(ghOut)) {
  quotaNote = '匿名 GitHub API 403（未登录配额 60 次/小时）';
  try {
    const h = execFileSync('curl.exe', ['--ssl-no-revoke', '-sS', '-i', 'https://api.github.com/rate_limit'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const rem = /x-ratelimit-remaining: (\d+)/i.exec(h);
    const res = /x-ratelimit-reset: (\d+)/i.exec(h);
    anonQuota = !!rem && rem[1] === '0';
    if (rem) quotaNote += '：remaining=' + rem[1] + (res ? '，重置于 ' + new Date(Number(res[1]) * 1000).toISOString() : '');
    if (!anonQuota && rem) quotaNote += '（配额未耗尽，403 按真错误处理）';
  } catch (e) { anonQuota = true; quotaNote += '（配额探测不可用，按外部闸门处理）'; }
}
if (anonQuota) {
  const c = checks[checks.length - 1];
  c.ok = true; c.gate = 'anonymous-api-quota'; c.note = quotaNote;
}

// docs coverage: every hash in the mirror SHA256SUMS.txt must appear in both release docs
const mirrorSums = fs.readFileSync(path.join(ROOT, 'installers/packaging/v1.0pre5/SHA256SUMS.txt'), 'utf8');
const hashes = mirrorSums.trim().split('\n').map((l) => l.slice(0, 64)).filter((h) => /^[0-9a-f]{64}$/.test(h));
const docs = ['docs/RELEASE-v1.0pre5.md', 'docs/RELEASE-v1.0pre5-body.md'];
const coverage = {};
let docsOk = true;
for (const d of docs) {
  const text = fs.readFileSync(path.join(ROOT, d), 'utf8');
  const miss = hashes.filter((h) => !text.includes(h));
  coverage[d] = { hashes: hashes.length, missing: miss.length };
  if (miss.length) { docsOk = false; coverage[d].missingFirst = miss.slice(0, 2).map((h) => h.slice(0, 12)); }
}
checks.push({ name: 'docs-hash-coverage', exit: docsOk ? 0 : 1, ok: docsOk, needle: hashes.length + '/' + hashes.length + ' in both docs', secs: 0 });

const assets = JSON.parse(fs.readFileSync(path.join(ROOT, 'cpp/release/v1.0pre5/release-assets.json'), 'utf8'));
const gates = [
  { gate: 'EV_GH_TOKEN', present: Boolean(process.env.EV_GH_TOKEN), note: 'Contents:Read+Write 的 GitHub token（环境变量）' },
  { gate: 'written-approval', present: fs.existsSync(path.join(ROOT, 'work/_publish-approval.txt')), note: 'work/_publish-approval.txt 内的书面批准' }
];
if (anonQuota) gates.push({ gate: 'github-api-quota', present: false, note: quotaNote });
const techOk = checks.every((c) => c.ok);
const summary = {
  at: new Date().toISOString(),
  tag: assets.tag,
  version: assets.version,
  assets: (assets.assets || []).length,
  techOk,
  anonymousApiQuota: anonQuota,
  checks,
  docsCoverage: coverage,
  gates,
  publishReady: techOk && gates.every((g) => g.present),
  nextCommand: 'node work/ghsync.mjs --apply --remote   (需 token + 批准后手动执行)'
};
fs.writeFileSync(path.join(ROOT, 'work/publish-preflight.json'), JSON.stringify(summary, null, 1));
for (const c of checks) console.log((c.ok ? 'PASS' : 'FAIL') + '  ' + c.name.padEnd(26) + ' exit=' + c.exit + '  ' + c.secs + 's' + (c.gate ? '   [gate: ' + c.gate + ' -> ' + c.note + ']' : ''));
for (const g of gates) console.log((g.present ? 'OPEN' : 'GATE') + '  ' + g.gate.padEnd(26) + g.note);
console.log('---');
console.log('PUBLISH-PREFLIGHT ' + (techOk ? 'PASS' : 'FAIL') + '  technical=' + checks.filter((c) => c.ok).length + '/' + checks.length + '  ready=' + summary.publishReady + '  tag=' + summary.tag);
process.exit(techOk ? 0 : 1);
