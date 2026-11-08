// final-acceptance.mjs — Lead 终验套件：逐项执行并记录退出码/末行，输出 JSON + 汇总表。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const NODE = 'D:\\program\\nodejs\\node.exe';
const ROOT = process.cwd();
const CHECKS = [
  ['archive-selfcheck', ROOT, NODE, ['work\\verify-archive.mjs', 'history\\history.jsonl'], 'ARCHIVE-SELFCHECK-PASS'],
  ['nsi-strict', ROOT + '\\Infinity Cloud\\sourcecode', NODE, ['tools\\nsi-check.mjs', '--strict'], '0 error'],
  ['nsi-selftest', ROOT + '\\Infinity Cloud\\sourcecode', NODE, ['tools\\nsi-check.test.mjs'], 'pass'],
  ['contract', ROOT, NODE, ['shell\\verify-contract.mjs'], 'SELFTEST PASS'],
  ['account-static', ROOT, NODE, ['work\\account-static-check.mjs'], 'ALL 24'],
  ['gate-test', ROOT, NODE, ['work\\gate-test.mjs'], 'GATE-TEST pass=21 fail=0'],
  ['ipm-data', ROOT, NODE, ['InfinityPackageManager\\tools\\data-consistency.test.mjs'], '31/31'],
  ['int-offline', ROOT, NODE, ['cpp\\apps\\int\\int-offline.test.mjs'], '9/9'],
  ['cn-lead-verify', ROOT, NODE, ['work\\cn-lead-verify.mjs', 'web'], 'PASS'],
  ['cn-gitee-verify', ROOT, NODE, ['work\\cn-gitee-verify.mjs'], 'failed: 0'],
  ['site-seo-verify', ROOT, NODE, ['work\\site-seo-verify.mjs'], 'PASS'],
  ['md-render-test', ROOT, NODE, ['work\\md-render-test.mjs'], 'MD-RENDER-TEST pass=41 fail=0'],
  ['site-release-consistency', ROOT, NODE, ['work\\site-release-consistency.mjs'], 'failed: 0'],
  ['gen-releases-check', ROOT, NODE, ['work\\gen-releases-json.mjs', '--check'], 'RELEASES-CHECK-PASS'],
  ['inc-preview', ROOT, 'powershell.exe', ['-NoProfile', '-File', '.\\Infinity Cloud\\preview\\tests\\run-tests.ps1', '-With8s'], 'failures=0'],
  ['ghsync-dry-local', ROOT, NODE, ['work\\ghsync.mjs', '--dry-run'], '0 errors'],
  ['release-set-parity', ROOT, NODE, ['work\\release-set-parity.mjs'], 'RELEASE-SET-PARITY-PASS'],
  ['publish-preflight', ROOT, NODE, ['work\\publish-preflight.mjs', '--skip-remote'], 'PUBLISH-PREFLIGHT PASS'],
  ['sync-e2e', ROOT, NODE, ['work\\sync-e2e-test.mjs'], 'SYNC-E2E-PASS'],
  ['preview-integration', ROOT, NODE, ['work\\preview-integration-audit.mjs'], 'PREVIEW-AUDIT-PASS'],
  ['ghsync-validator', ROOT, NODE, ['work\\ghsync-validator-test.mjs'], 'GHSYNC-VALIDATOR-PASS'],
  ['archive-health', ROOT, NODE, ['work\\archive-health.mjs'], 'ARCHIVE-HEALTH-PASS'],
  ['server-plugins', ROOT, NODE, ['work\\infinityserver-plugins-test.mjs'], 'INFINITYSERVER-PLUGINS-PASS'],
  ['js-layout', ROOT, NODE, ['work\\jslayout\\verify-layout.mjs'], 'LAYOUT-VERIFY 35/35  PASS'],
  ['infinityserver', ROOT, NODE, ['work\\infinityserver-test.mjs'], 'INFINITYSERVER-TEST-PASS'],
  ['infinitystudio', ROOT, NODE, ['work\\infinitystudio-test.mjs'], 'INFINITYSTUDIO-TEST-PASS'],
  ['ipm-nsi-check', ROOT, NODE, ['work\\ipm-nsi-check.mjs'], 'IPM-NSI-CHECK PASS'],
];
const rows = [];
for (const [name, cwd, exe, args, needle] of CHECKS) {
  const t0 = Date.now();
  let out = '', code = 0;
  try {
    out = execFileSync(exe, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { code = typeof e.status === 'number' ? e.status : -1; out = String(e.stdout || '') + String(e.stderr || ''); }
  const tail = out.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' | ').slice(0, 240);
  rows.push({ name, exit: code, ok: code === 0 && out.includes(needle), needle, secs: Math.round((Date.now() - t0) / 100) / 10, tail });
  console.log((rows[rows.length - 1].ok ? 'PASS' : 'FAIL') + '  ' + name + '  exit=' + code + '  ' + rows[rows.length - 1].secs + 's');
}
const summary = { at: new Date().toISOString(), total: rows.length, pass: rows.filter(r => r.ok).length, fail: rows.filter(r => !r.ok).length, rows };
fs.writeFileSync('work\\final-acceptance.json', JSON.stringify(summary, null, 1));
console.log('---');
console.log('FINAL-ACCEPTANCE ' + (summary.fail === 0 ? 'PASS' : 'FAIL') + ' ' + summary.pass + '/' + summary.total);
for (const r of rows.filter(r => !r.ok)) console.log('  FAILED ' + r.name + ' exit=' + r.exit + ' :: ' + r.tail);
