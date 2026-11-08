// ghsync-validator-test.mjs — 发布工具的本地校验器自测（无网络：全部 --dry-run 本地模式）
// 夹具建在 cpp/release/ 下并以 _ghst- 前缀命名，测试结束后一律清除（finally 保证）。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const RELEASE_BASE = path.join(ROOT, 'cpp', 'release');
const GOOD = path.join(RELEASE_BASE, 'v1.0pre5');
const problems = [];
const rows = [];

function run(dirName) {
  const env = Object.assign({}, process.env, { INC_RELEASE: dirName, INC_GH_LOG: path.join(ROOT, 'work', '_ghst.log') });
  let out = '', code = 0;
  try { out = execFileSync(process.execPath, ['work/ghsync.mjs', '--dry-run'], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { code = typeof e.status === 'number' ? e.status : -1; out = String(e.stdout || '') + String(e.stderr || ''); }
  return { out, code };
}
function check(name, dirName, expectExit, needles) {
  const r = run(dirName);
  const hits = needles.filter((n) => r.out.indexOf(n) < 0);
  const extra = (expectExit === 0 && r.out.indexOf('DRY RUN complete: 0 errors') < 0);
  const ok = r.code === expectExit && hits.length === 0 && !extra;
  rows.push({ name, exit: r.code, ok, missing: hits });
  console.log((ok ? '  ok   ' : '  FAIL ') + name + ' exit=' + r.code + (ok ? '' : ' missing=' + JSON.stringify(hits).slice(0, 200)));
  if (!ok) problems.push(name + ': exit=' + r.code + ' missing=' + hits.join(' | '));
}
function clone(name) {
  const dst = path.join(RELEASE_BASE, name);
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(GOOD, dst, { recursive: true });
  return dst;
}
const fixtureNames = ['_ghst-badsha', '_ghst-missing', '_ghst-phantom', 'v1.0pre6'];
try {
  const goodAssets = Object.keys(JSON.parse(fs.readFileSync(path.join(GOOD, 'release-assets.json'), 'utf8')).assets || {}).length;
check('good: frozen v1.0pre5 passes', 'v1.0pre5', 0, ['assets: ' + goodAssets]);

  const badSha = clone('_ghst-badsha');
  fs.appendFileSync(path.join(badSha, 'InfinityCloud_1.0.0-pre5_win64_setup.exe'), Buffer.from([0]));
  check('bad-sha: 追加 1 字节被拒', '_ghst-badsha', 1, ['asset size mismatch', 'asset sha256 mismatch']);

  const missing = clone('_ghst-missing');
  fs.rmSync(path.join(missing, 'InfinityGames_1.0.0-pre5_win64_setup.exe'));
  check('missing: 资产文件缺失被拒', '_ghst-missing', 1, ['asset file missing', 'InfinityGames_1.0.0-pre5_win64_setup.exe']);

  const phantom = clone('_ghst-phantom');
  fs.appendFileSync(path.join(phantom, 'name.txt'), 'InfiniteGhost_9.9.9-pre9_win64_setup.exe Infinity.Inc InfiniteGhost setup Infinity.Inc win64\n');
  check('phantom: name.txt 多出清单外的行被拒', '_ghst-phantom', 1, ['name.txt line is not in release-assets.json', 'InfiniteGhost']);
  // 目录名必须能解析出版本 tag（v1.0pre6 -> v1.0.0-pre6），而清单仍声明 v1.0.0-pre5 -> 不符被拒
  const tag = clone('v1.0pre6');
  const manPath = path.join(tag, 'release-assets.json');
  const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
  man.tag = 'v1.0.0-pre5';
  fs.writeFileSync(manPath, JSON.stringify(man, null, 2) + '\n');
  check('tag-mismatch: 目录名与清单 tag 不符被拒', 'v1.0pre6', 1, ['does not match directory', 'v1.0pre6']);
} finally {
  for (const n of fixtureNames) fs.rmSync(path.join(RELEASE_BASE, n), { recursive: true, force: true });
  fs.rmSync(path.join(ROOT, 'work', '_ghst.log'), { force: true });
  // 确认真实发布树完整无损
  const left = fs.readdirSync(RELEASE_BASE).filter((d) => !/^v\d/.test(d));
  if (left.length) problems.push('release dir still holds fixture dirs: ' + left.join(','));
}
console.log(JSON.stringify({ ok: problems.length === 0, tests: rows.length, rows }, null, 1));
console.log(problems.length === 0 ? 'GHSYNC-VALIDATOR-PASS ' + rows.length + '/' + rows.length : 'GHSYNC-VALIDATOR-FAIL ' + problems.length);
process.exit(problems.length === 0 ? 0 : 1);
