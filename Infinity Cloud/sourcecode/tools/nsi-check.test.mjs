/*
 * nsi-check.test.mjs - nsi-check.mjs 的负例自测。
 *
 * 每个用例从真实的 installer.nsi 复制一份、做一处"故意的错误"，然后要求
 * 检查器给出预期结论。重点：所有负例都必须让检查器报 error（CLI 退出码 != 0）。
 *
 * 运行：node nsi-check.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { check } from './nsi-check.mjs';

const NL = String.fromCharCode(10);
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..', '..');            // Infinity Cloud
const TEMPLATE = path.join(PROJECT, 'installer.nsi');
const CHECKER = path.join(HERE, 'nsi-check.mjs');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'nsi-check-test-'));

const base = fs.readFileSync(TEMPLATE, 'utf8').replace(/^\uFEFF/, '');

function writeFixture(name, text) {
  const p = path.join(WORK, name + '.nsi');
  fs.writeFileSync(p, text, 'utf8');
  return p;
}
function messages(res) {
  return res.errors.map(function (e) { return e.msg; }).join(' || ');
}
function hasError(res, needle) {
  return res.errors.some(function (e) { return e.msg.indexOf(needle) >= 0; });
}

/* 合成一个最小载荷目录；opts.omit 里的文件不写。 */
function makePayload(dir, opts) {
  const o = opts || {};
  const names = ['inc_cli.exe', 'inc_tui.exe', 'inc_gui.exe', 'inc_launcher.exe',
    'inx_cli.exe', 'inx_tui.exe', 'inx_gui.exe', 'inx_launcher.exe'];
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const n of names) {
    if (o.omit && o.omit.indexOf(n) >= 0) continue;
    fs.writeFileSync(path.join(dir, n), 'stub');
  }
  if (!o.omitIcon) {
    fs.copyFileSync(path.join(PROJECT, 'sourcecode', 'assets', 'inc.ico'), path.join(dir, 'inc.ico'));
  }
  return [{ id: 'synthetic', dir: dir }];
}

const CASES = [
  {
    name: 'valid',
    text: base,
    expectOk: true,
    note: '真实模板原样：必须 0 error（含 makensis 编译）'
  },
  {
    name: 'bad-macro',
    text: base.replace('"Publisher"', '"Publisher"' + NL + '  NoSuchMacro Foo'),
    expectError: 'makensis 编译失败',
    note: 'WriteRegStr 旁边写一个不存在的宏'
  },
  {
    name: 'no-file-directive',
    text: base.replace(/^[ \t]*File \/r ".*\*\.\*".*$/m, ''),
    expectError: '没有任何 File 指令从 @@APP_DIR@@',
    note: '删掉 File /r：makensis 依然 exit 0，只有语义检查能发现'
  },
  {
    name: 'no-write-uninstaller',
    text: base.replace(/^[ \t]*WriteUninstaller.*$/m, ''),
    expectError: '主程序段里没有 WriteUninstaller',
    note: '删掉 WriteUninstaller：makensis 依然 exit 0'
  },
  {
    name: 'no-startmenu-shortcut',
    text: base.replace(/^[ \t]*CreateShortCut "\$SMPROGRAMS.*$/gm, ''),
    expectError: '没有开始菜单快捷方式',
    note: '删掉开始菜单快捷方式：makensis 依然 exit 0'
  },
  {
    name: 'broken-section',
    text: base.slice(0, base.lastIndexOf('SectionEnd')) + base.slice(base.lastIndexOf('SectionEnd') + 'SectionEnd'.length),
    expectError: 'Section 没有 SectionEnd',
    note: '删掉最后一个 SectionEnd'
  },
  {
    name: 'missing-outfile',
    text: base.replace(/^OutFile .*$/m, ''),
    expectError: '缺少必需指令 OutFile',
    note: '删掉 OutFile'
  },
  {
    name: 'unknown-placeholder',
    text: base.replace('CRCCheck off', 'CRCCheck off' + NL + '!define EXTRA "@@BOGUS@@"'),
    expectError: '未知占位符',
    note: '写一个 make-setup.mjs 不会替换的占位符'
  },
  {
    name: 'missing-uninstall-value',
    text: base.replace(/^[ \t]*WriteRegStr HKLM "\$UNINST_KEY_THIS" "UninstallString".*$/m, ''),
    expectError: '卸载项缺少值 UninstallString',
    note: '卸载项少写一个值'
  },
  {
    name: 'unpaired-env-value',
    text: base.replace('  ReadEnvStr $2 "USERNAME"', '  WriteRegStr HKCU "Environment" "bogusvar" "x"' + NL + '  ReadEnvStr $2 "USERNAME"'),
    expectError: '环境变量 bogusvar',
    note: '环境变量写了但卸载时不删'
  },
  {
    name: 'unterminated-string',
    text: base + NL + '!define BROKEN "abc' + NL,
    expectError: '字符串引号没有闭合',
    note: '引号没有闭合'
  },
  {
    name: 'real-template-regression',
    text: null,
    fromFile: true,
    expectOk: true,
    note: '真实 installer.nsi 回归：默认参数必须 exit 0'
  }
];

let pass = 0;
let fail = 0;
const failures = [];

function report(name, ok, detail) {
  if (ok) { pass++; console.log('PASS  ' + name); }
  else { fail++; failures.push(name + ': ' + detail); console.log('FAIL  ' + name + '  ' + detail); }
}

console.log('nsi-check 自测，工作目录 ' + WORK + NL);

/* 1) 正例与语义负例 */
for (const c of CASES) {
  let fixture = TEMPLATE;
  if (!c.fromFile) fixture = writeFixture(c.name, c.text);
  const res = check({
    templatePath: fixture,
    projectRoot: PROJECT,
    makensis: 'C:/Program Files (x86)/NSIS/makensis.exe'
  });
  if (c.expectOk) {
    report(c.name + ' (expect 0 error)', res.ok, 'errors=' + messages(res));
  } else {
    report(c.name + ' (expect error: ' + c.expectError + ')', hasError(res, c.expectError),
      'errors=' + messages(res));
  }
}

/* 2) 载荷缺失类负例（不编译，只测与构建产物的核对） */
{
  const good = makePayload(path.join(WORK, 'payload-good'), {});
  const noIcon = makePayload(path.join(WORK, 'payload-noicon'), { omitIcon: true });
  const noCli = makePayload(path.join(WORK, 'payload-nocli'), { omit: ['inc_cli.exe'] });

  let res = check({ templatePath: TEMPLATE, projectRoot: PROJECT, compile: false, payloadRoots: good });
  report('payload-good (expect 0 error)', res.ok, 'errors=' + messages(res));

  res = check({ templatePath: TEMPLATE, projectRoot: PROJECT, compile: false, payloadRoots: noIcon });
  report('payload-noicon (expect inc.ico error)', hasError(res, '没有 inc.ico'), 'errors=' + messages(res));

  res = check({ templatePath: TEMPLATE, projectRoot: PROJECT, compile: false, payloadRoots: noCli });
  report('payload-nocli (expect inc_cli.exe error)',
    hasError(res, 'inc_cli.exe') && hasError(res, '在载荷里不存在'), 'errors=' + messages(res));
}

/* 3) 编码契约：make-setup.mjs 不再写 BOM 时必须报 error */
{
  const proj = path.join(WORK, 'proj-no-bom');
  fs.mkdirSync(path.join(proj, 'sourcecode', 'tools'), { recursive: true });
  const ms = fs.readFileSync(path.join(PROJECT, 'sourcecode', 'tools', 'make-setup.mjs'), 'utf8')
    .split('uFEFF').join('NO_BOM');
  fs.writeFileSync(path.join(proj, 'sourcecode', 'tools', 'make-setup.mjs'), ms, 'utf8');
  const res = check({ templatePath: TEMPLATE, projectRoot: proj, compile: false, payloadRoots: [] });
  report('no-bom-contract (expect BOM error)', hasError(res, 'UTF-8 BOM'), 'errors=' + messages(res));
}

/* 4) strict：warning 升级为 error。
 *
 * 真实模板在修完缺陷后已经 0 warning，所以这里故意让合成载荷少一个可选的
 * 管理员窗口（inx_gui.exe）来制造一条 warning，再看 --strict 是否把它升级为
 * error；同时保留"干净模板 + strict 必须通过"的正例。 */
{
  const noGui = makePayload(path.join(WORK, 'payload-nogui'), { omit: ['inx_gui.exe'] });
  const res = check({ templatePath: TEMPLATE, projectRoot: PROJECT, compile: false, payloadRoots: noGui, strict: true });
  report('strict (expect warning->error)', hasError(res, 'inx_gui.exe'), 'errors=' + messages(res).slice(0, 200));

  const clean = check({ templatePath: TEMPLATE, projectRoot: PROJECT, compile: false, strict: true });
  report('strict clean template (expect 0 error)', clean.ok, 'errors=' + messages(clean).slice(0, 200));
}

/* 6) 实例模式：make-setup.mjs 生成的 build/setup-stage/setup-*.nsi 也要能 --strict */
{
  const stage = path.join(WORK, 'instproj', 'sourcecode', 'build', 'setup-stage');
  fs.mkdirSync(stage, { recursive: true });
  function makeInstance(name, payloadDir, withBom) {
    const filled = base
      .split('@@VERSION@@').join('v1.0pre5')
      .split('@@OUTFILE@@').join(path.join(WORK, 'setup-' + name + '.exe'))
      .split('@@APP_DIR@@').join(payloadDir)
      .split('@@EXE@@').join('inc_launcher.exe');
    const p = path.join(stage, 'setup-' + name + '.nsi');
    fs.writeFileSync(p, (withBom ? '\uFEFF' : '') + filled, 'utf8');
    return p;
  }
  const okPayload = makePayload(path.join(WORK, 'payload-inst'), {});
  const inst = makeInstance('win64', okPayload[0].dir, true);
  let res = check({ templatePath: inst, projectRoot: PROJECT, strict: true });
  report('instance strict (expect 0 error)', res.ok, 'errors=' + messages(res));

  const noCli = makePayload(path.join(WORK, 'payload-inst-nocli'), { omit: ['inc_cli.exe'] });
  const inst2 = makeInstance('winx86', noCli[0].dir, true);
  res = check({ templatePath: inst2, projectRoot: PROJECT, strict: true });
  report('instance missing payload file (expect error)', hasError(res, 'inc_cli.exe'), 'errors=' + messages(res));

  const inst3 = makeInstance('arm64', okPayload[0].dir, false);
  res = check({ templatePath: inst3, projectRoot: PROJECT, strict: true });
  report('instance without BOM (expect error)', hasError(res, '没有 UTF-8 BOM'), 'errors=' + messages(res));
}

/* 5) CLI 退出码：负例必须 != 0，正例必须 == 0 */
function runCli(args) {
  try {
    execFileSync(process.execPath, [CHECKER].concat(args), { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    return 0;
  } catch (e) {
    return (e.status === undefined || e.status === null) ? -1 : e.status;
  }
}
{
  const good = writeFixture('cli-good', base);
  const badMacro = path.join(WORK, 'bad-macro.nsi');
  const noFile = path.join(WORK, 'no-file-directive.nsi');
  const c1 = runCli(['--template', good, '--root', PROJECT, '--no-compile']);
  report('cli valid -> exit 0', c1 === 0, 'exit=' + c1);
  const c2 = runCli(['--template', badMacro, '--root', PROJECT]);
  report('cli bad-macro -> exit != 0', c2 !== 0, 'exit=' + c2);
  const c3 = runCli(['--template', noFile, '--root', PROJECT, '--no-compile']);
  report('cli no-file-directive -> exit != 0', c3 !== 0, 'exit=' + c3);
  const c4 = runCli(['--template', path.join(WORK, 'nope.nsi')]);
  report('cli missing template -> exit 2', c4 === 2, 'exit=' + c4);
}

console.log(NL + '结果: ' + pass + ' pass, ' + fail + ' fail');
if (failures.length) {
  console.log('失败用例:');
  for (const f of failures) console.log('  - ' + f);
}
fs.rmSync(WORK, { recursive: true, force: true });
process.exitCode = fail ? 1 : 0;
