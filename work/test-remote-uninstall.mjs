/* uninstall.js 的纯逻辑测试：目录匹配与拒绝条件。
 * 真正的删除动作在 qa-studio-uninstall.ps1 里用装好的产品验，不在这里伪造 exe。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installRoot, installedDirs, findInstalled, listInstalled, uninstallProduct } from '../InfinityStudio/src/uninstall.js';

const checks = [];
function ok(name, pass, detail) { checks.push({ name, pass, detail }); }

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'infinity-uninst-'));
process.env.INFINITY_INSTALL_ROOT = scratch;
fs.mkdirSync(path.join(scratch, 'Infinity Cloud'), { recursive: true });
fs.mkdirSync(path.join(scratch, 'InfinityPackageManager'), { recursive: true });
fs.mkdirSync(path.join(scratch, 'Infinity Studio'), { recursive: true });
fs.writeFileSync(path.join(scratch, 'Infinity Studio', 'Uninstall.exe'), '');

try {
  ok('install root honours the override', installRoot() === scratch, installRoot());
  ok('three directories seen', installedDirs().length === 3, String(installedDirs().length));

  const cloud = findInstalled({ name: 'Infinity Cloud', asset: 'InfinityCloud-setup' });
  ok('spaced name matches', cloud === path.join(scratch, 'Infinity Cloud'), cloud);

  const ipm = findInstalled({ name: 'Infinity Package Manager', asset: 'InfinityPackageManager-setup' });
  ok('spelling difference matches', ipm === path.join(scratch, 'InfinityPackageManager'), ipm);

  const toolbox = findInstalled({ name: 'Infinity Toolbox', asset: 'InfinityToolbox-setup' });
  ok('absent product is null', toolbox === null, String(toolbox));

  const listed = listInstalled([
    { id: 'studio', name: 'Infinity Studio', asset: 'InfinityStudio-setup' },
    { id: 'cloud', name: 'Infinity Cloud', asset: 'InfinityCloud-setup' },
    { id: 'int', name: 'Infinity Toolbox', asset: 'InfinityToolbox-setup' }
  ]);
  ok('listInstalled reports only what is here', listed.length === 2 && listed.map((x) => x.id).join(',') === 'studio,cloud', JSON.stringify(listed.map((x) => x.id)));

  const noExe = await uninstallProduct({ name: 'Infinity Cloud', asset: 'InfinityCloud-setup' });
  ok('missing uninstaller is refused', noExe.ok === false && noExe.error.indexOf('no uninstaller') === 0, JSON.stringify(noExe));

  const self = await uninstallProduct({ name: 'Infinity Studio', asset: 'InfinityStudio-setup' });
  ok('never removes the running installer', self.ok === false && self.error.indexOf('refusing') === 0, JSON.stringify(self));
  ok('refusal leaves the directory alone', fs.existsSync(path.join(scratch, 'Infinity Studio')), 'gone');

  const missing = await uninstallProduct({ name: 'Infinity Toolbox', asset: 'InfinityToolbox-setup' });
  ok('not installed is refused', missing.ok === false && missing.error === 'not installed', JSON.stringify(missing));
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

const failed = checks.filter((c) => !c.pass);
for (const c of checks) console.log((c.pass ? 'ok   ' : 'FAIL ') + c.name + (c.detail !== undefined ? '  [' + c.detail + ']' : ''));
console.log((failed.length ? 'REMOTE-UNINSTALL-TEST FAIL ' : 'REMOTE-UNINSTALL-TEST PASS ') + (checks.length - failed.length) + '/' + checks.length);
process.exit(failed.length ? 1 : 0);
