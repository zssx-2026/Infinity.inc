/*
 * nsi-check.mjs - 真正校验 installer.nsi，而不是"编译一下看看"。
 *
 * 旧版（19 行）有三个致命问题，导致它无论 installer.nsi 写得多离谱都会
 * 以 0 退出（详见 work/nsi-check-report.md）：
 *   1. 只打印 "exit=N"，从不 process.exit(N) —— 调用方（CI/发布）永远看到成功；
 *   2. 直接编译带 @@...@@ 占位符的模板，而不是 make-setup.mjs 生成的
 *      build/setup-stage/setup-<id>.nsi，所以它测的不是真正出货的东西；
 *   3. 只依赖 makensis 的退出码。本机 NSIS 3.12 把编译日志写到控制台
 *      （CONOUT$）而不是 stdout/stderr，execFileSync 什么也抓不到；而且
 *      makensis 语法检查通过并不代表安装器内容完整 —— 删掉 File /r
 *      或 WriteUninstaller，makensis 依然 exit 0。
 *
 * 现在的检查分四层：
 *   A. 静态结构断言：Section/Function 配对、必需指令、必需 Section、
 *      占位符集合、字符串闭合。
 *   B. 语义解析：从 installer.nsi 解析出预期写入的文件名、注册表键、
 *      快捷方式，逐条与 build/setup-stage 的实际载荷核对。
 *   C. 交叉一致性：写过的注册表值必须被卸载段删除（用户私有值除外），
 *      快捷方式必须有对应删除。
 *   D. 真实编译：把占位符替换成最小合成载荷（含真 inc.ico），用 BOM
 *      写盘后交给 makensis；这是唯一能抓住宏/语法/图标错误的步骤。
 *
 * 退出码：0 = 无 error（warning 允许）；1 = 有 error；2 = 用法/环境错误。
 *
 * 用法：
 *   node nsi-check.mjs [--strict] [--no-compile] [--json]
 *                      [--template <installer.nsi>] [--root <Infinity Cloud>]
 *                      [--payload <载荷目录>] [--makensis <makensis.exe>]
 *
 * 负例自测：node nsi-check.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const NL = String.fromCharCode(10);
const BACKTICK = String.fromCharCode(96);
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const DEFAULT_TEMPLATE = path.resolve(HERE, '..', '..', 'installer.nsi');
const DEFAULT_MAKENSIS = 'C:/Program Files (x86)/NSIS/makensis.exe';

/* make-setup.mjs 只替换这四个占位符；出现这四个之外的 @@...@@ 一定是写错了。 */
const PLACEHOLDERS = ['@@VERSION@@', '@@OUTFILE@@', '@@APP_DIR@@', '@@EXE@@'];

/* 这些 $INSTDIR 下的文件是安装器自己生成的，不在载荷里。 */
const GENERATED_IN_INSTDIR = new Set(['Uninstall.exe', 'uninstall.ini', 'hash.ini', 'hash.txt']);

/* 卸载时有意保留的用户私有环境变量（见 installer.nsi 458-466 行的注释）。 */
const USER_OWNED_ENV = new Set(['def_fm', 'proxy_ip', 'user_token-$2', 'cloudhub-$2']);

/* 卸载项必须具备的值；少一个，控制面板里就会出现残缺条目。 */
const UNINSTALL_VALUES = [
  'DisplayName', 'Publisher', 'QuietUninstallString', 'DisplayVersion',
  'UninstallString', 'InstallLocation', 'DisplayIcon', 'NoModify', 'NoRepair'
];

const REG_ROOTS = new Set(['HKLM', 'HKCU', 'HKCR', 'HKU', 'HKCC']);
const QUOTES = ['"', "'", BACKTICK];

/* ------------------------------------------------------------------ */
/* 词法                                                                */
/* ------------------------------------------------------------------ */

/*
 * 去掉注释、标记未闭合的字符串。NSIS 的注释是引号外的 ; 与 #；字符串
 * 定界符有 " ' 和反引号三种，$ 加反斜杠加引号 是转义引号。
 */
function scanLines(text) {
  const out = [];
  const raw = text.split(/\r?\n/);
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    let res = '';
    let q = null;
    for (let j = 0; j < s.length; j++) {
      const c = s[j];
      if (c === '$' && s[j + 1] === '\\' && s[j + 2] === '"') { res += '$\\"'; j += 2; continue; }
      if (q === null && QUOTES.indexOf(c) >= 0) { q = c; res += c; continue; }
      if (q !== null && c === q) { q = null; res += c; continue; }
      if (q === null && (c === ';' || c === '#')) break;
      res += c;
    }
    out.push({ n: i + 1, raw: s, text: res.trim(), unterminated: q !== null });
  }
  return out;
}

/* 拆词：引号被剥掉，token[0] 是指令名。 */
function tokenize(s) {
  const t = [];
  let cur = '';
  let q = null;
  let has = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '$' && s[i + 1] === '\\' && s[i + 2] === '"') { cur += '$\\"'; i += 2; has = true; continue; }
    if (q === null && QUOTES.indexOf(c) >= 0) { q = c; has = true; continue; }
    if (q !== null && c === q) { q = null; continue; }
    if (q === null && /\s/.test(c)) { if (cur || has) { t.push(cur); cur = ''; has = false; } continue; }
    cur += c;
    has = true;
  }
  if (cur || has) t.push(cur);
  return t;
}

/*
 * 解析 installer.nsi 里我们关心的部分。只做语法级扫描，不执行任何宏。
 */
function parseNsi(text) {
  const r = {
    unterminated: [],
    defines: new Map(),
    sections: [],
    functions: [],
    files: [],
    regWrites: [],
    regDeletes: [],
    shortcuts: [],
    deletes: [],
    instdirRefs: [],
    hasRmdir: false
  };
  let cur = null;
  let curFn = null;
  for (const L of scanLines(text)) {
    if (L.unterminated) r.unterminated.push(L.n);
    if (!L.text) continue;
    const t = tokenize(L.text);
    if (!t.length) continue;
    const op = t[0];
    const low = op.toLowerCase();

    if (op === '!define') { if (t[1]) r.defines.set(t[1], t.slice(2).join(' ')); continue; }

    if (low === 'section') {
      const args = t.slice(1).filter(function (x) { return x !== '/o'; });
      cur = { name: args[0] || '', id: args[1] || '', line: L.n, body: [] };
      r.sections.push(cur);
      continue;
    }
    if (low === 'sectionend') { if (cur) { cur.endLine = L.n; } cur = null; continue; }
    if (low === 'function') {
      curFn = { name: t[1] || '', line: L.n };
      r.functions.push(curFn);
      if (cur) cur.body.push(L.text);
      continue;
    }
    if (low === 'functionend') { if (curFn) curFn.endLine = L.n; curFn = null; continue; }

    if (cur) cur.body.push(L.text);

    if (low === 'file') {
      const src = t[t.length - 1];
      r.files.push({ line: L.n, src: src, recursive: t.indexOf('/r') > 0, section: cur ? cur.id || cur.name : '' });
      continue;
    }
    if (low === 'writeregstr' || low === 'writeregdword' || low === 'writeregexpandstr' || low === 'writeregnone') {
      r.regWrites.push({ line: L.n, op: op, root: t[1] || '', key: t[2] || '', value: t[3] || '', data: t[4] || '', section: cur ? cur.id || cur.name : '' });
      continue;
    }
    if (low === 'deleteregvalue') {
      r.regDeletes.push({ line: L.n, root: t[1] || '', key: t[2] || '', value: t[3] || '', section: cur ? cur.id || cur.name : '' });
      continue;
    }
    if (low === 'deleteregkey') {
      r.regDeletes.push({ line: L.n, root: t[t.length - 2] || '', key: t[t.length - 1] || '', value: null, section: cur ? cur.id || cur.name : '' });
      continue;
    }
    if (low === 'createshortcut') {
      r.shortcuts.push({ line: L.n, link: t[1] || '', target: t[2] || '', icon: t[4] || '', section: cur ? cur.id || cur.name : '' });
      continue;
    }
    if (low === 'delete' || low === 'rmdir') {
      r.deletes.push({ line: L.n, op: op, what: t[1] || '', section: cur ? cur.id || cur.name : '' });
      if (low === 'rmdir') r.hasRmdir = true;
      continue;
    }
  }
  return r;
}

/* 把 text 里 $INSTDIR\xxx 的 xxx 收集出来。 */
function collectInstdirRefs(codeLines) {
  const found = new Map();
  const re = /\$INSTDIR\\([^\s"']+)/g;
  for (const L of codeLines) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(L.text)) !== null) {
      const rel = m[1].replace(/[),]+$/, '');
      if (rel && !found.has(rel)) found.set(rel, L.n);
    }
  }
  return found;
}

/* ------------------------------------------------------------------ */
/* 结果收集                                                            */
/* ------------------------------------------------------------------ */

function makeResult() {
  return { errors: [], warnings: [], infos: [], stats: {} };
}
function err(res, msg, where) { res.errors.push({ msg: msg, where: where || '' }); }
function warn(res, msg, where) { res.warnings.push({ msg: msg, where: where || '' }); }
function info(res, msg, where) { res.infos.push({ msg: msg, where: where || '' }); }

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function readText(p) {
  return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
}
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

/* 载荷目录：build/setup-stage 下每个子目录就是一个平台的载荷。 */
function findPayloadRoots(projectRoot) {
  const stage = path.join(projectRoot, 'sourcecode', 'build', 'setup-stage');
  const out = [];
  if (!fs.existsSync(stage)) return out;
  for (const e of fs.readdirSync(stage, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    out.push({ id: e.name, dir: path.join(stage, e.name) });
  }
  return out;
}

/* @@EXE@@ 具体是什么名字，问 make-setup.mjs（SETUPS 里的 exe:）。 */
function resolveExeName(projectRoot, payloadRoots) {
  const ms = path.join(projectRoot, 'sourcecode', 'tools', 'make-setup.mjs');
  if (fs.existsSync(ms)) {
    const m = readText(ms).match(/exe:\s*'([^']+)'/);
    if (m) return m[1];
  }
  for (const pr of payloadRoots) {
    try {
      const hit = fs.readdirSync(pr.dir).find(function (n) { return /_launcher\.exe$/.test(n); });
      if (hit) return hit;
    } catch (e) { /* 忽略 */ }
  }
  return 'inc_launcher.exe';
}

/* 编译时用的真图标：优先源码 assets，其次已有载荷。 */
function resolveIcon(projectRoot, payloadRoots) {
  const cands = [path.join(projectRoot, 'sourcecode', 'assets', 'inc.ico')];
  for (const pr of payloadRoots) cands.push(path.join(pr.dir, 'inc.ico'));
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}

/* ------------------------------------------------------------------ */
/* A. 结构断言                                                         */
/* ------------------------------------------------------------------ */

function checkStructure(res, doc) {
  let depth = 0;
  for (const L of scanLines(doc.text)) {
    if (!L.text) continue;
    const t = tokenize(L.text);
    if (!t.length) continue;
    const low = t[0].toLowerCase();
    if (low === 'section') depth++;
    else if (low === 'sectionend') {
      depth--;
      if (depth < 0) { err(res, '多余的 SectionEnd（没有对应的 Section）', L.n); depth = 0; }
    }
  }
  if (depth > 0) err(res, '有 ' + depth + ' 个 Section 没有 SectionEnd', doc.file);

  let fdepth = 0;
  for (const L of scanLines(doc.text)) {
    if (!L.text) continue;
    const t = tokenize(L.text);
    if (!t.length) continue;
    const low = t[0].toLowerCase();
    if (low === 'function') fdepth++;
    else if (low === 'functionend') {
      fdepth--;
      if (fdepth < 0) { err(res, '多余的 FunctionEnd', L.n); fdepth = 0; }
    }
  }
  if (fdepth > 0) err(res, '有 ' + fdepth + ' 个 Function 没有 FunctionEnd', doc.file);

  for (const n of doc.parsed.unterminated) err(res, '字符串引号没有闭合', n);

  const need = ['OutFile', 'Name', 'InstallDir', 'RequestExecutionLevel', 'WriteUninstaller'];
  const have = new Map();
  for (const L of scanLines(doc.text)) {
    if (!L.text) continue;
    const t = tokenize(L.text);
    if (!t.length) continue;
    const key = t[0].toLowerCase();
    if (!have.has(key)) have.set(key, L.n);
  }
  for (const d of need) if (!have.has(d.toLowerCase())) err(res, '缺少必需指令 ' + d, doc.file);
  if (!have.has('!include')) err(res, '缺少 !include（MUI2.nsh/LogicLib.nsh 等）', doc.file);
  const langs = scanLines(doc.text).filter(function (L) { return /^!insertmacro\s+MUI_LANGUAGE\b/i.test(L.text); });
  if (!langs.length) err(res, '缺少 !insertmacro MUI_LANGUAGE', doc.file);

  const payloadFiles = doc.parsed.files.filter(function (f) {
    if (f.src.indexOf('@@APP_DIR@@') >= 0) return true;
    /* 实例化的 setup-*.nsi 已经把 @@APP_DIR@@ 换成绝对路径，按目录认这条 File /r。 */
    if (doc.instanceDir) {
      const dir = f.src.replace(/[\\/]\*\.\*$/, '');
      return path.resolve(dir) === path.resolve(doc.instanceDir);
    }
    return false;
  });
  if (!payloadFiles.length) {
    err(res, '没有任何 File 指令从 @@APP_DIR@@ 复制载荷 —— 安装器会装上空的程序', doc.file);
  } else {
    for (const f of payloadFiles) {
      if (!f.recursive) err(res, 'File "' + f.src + '" 缺少 /r：载荷含子目录，不递归会漏文件', f.line);
    }
  }
  const mainFile = payloadFiles[0];
  const mainSection = mainFile ? doc.parsed.sections.find(function (s) { return s.id === mainFile.section || s.name === mainFile.section; }) : null;
  if (mainSection) {
    if (mainSection.body.join(NL).toLowerCase().indexOf('writeuninstaller') < 0) {
      err(res, '主程序段里没有 WriteUninstaller —— 装完无法卸载', mainSection.line);
    }
    if (!/sectionin\s+ro/i.test(mainSection.body.join(NL))) warn(res, '主程序段没有 SectionIn RO，用户可以不选它', mainSection.line);
  }

  const un = doc.parsed.sections.filter(function (s) { return s.name.toLowerCase() === 'uninstall'; });
  if (!un.length) err(res, '缺少 Section "Uninstall"', doc.file);
  else if (un.length > 1) err(res, '有 ' + un.length + ' 个 Uninstall 段', un[1].line);
  const unInit = doc.parsed.functions.filter(function (f) { return f.name.toLowerCase() === 'un.oninit'; });
  if (!unInit.length) {
    if (doc.instance && !doc.coexist) info(res, '老家族安装器（无 $LABEL_THIS）不使用 un.onInit 读回卸载信息，跳过该断言', doc.file);
    else err(res, '缺少 Function un.onInit', doc.file);
  }
  if (!doc.parsed.hasRmdir) warn(res, '卸载段没有 RMDir /r $INSTDIR，卸载后目录可能残留', doc.file);
}

/* ------------------------------------------------------------------ */
/* 占位符                                                              */
/* ------------------------------------------------------------------ */

function checkPlaceholders(res, doc) {
  const unknown = new Set();
  const re = /@@[A-Za-z0-9_]+@@/g;
  let m;
  while ((m = re.exec(doc.text)) !== null) if (PLACEHOLDERS.indexOf(m[0]) < 0) unknown.add(m[0]);
  if (unknown.size) err(res, '出现未知占位符：' + Array.from(unknown).join(', ') + '（make-setup.mjs 不会替换它们）', doc.file);
  if (doc.instance) {
    info(res, '实例模式：四个占位符已由 make-setup.mjs 替换，跳过"模板必须含占位符"的断言', doc.file);
    return;
  }
  for (const p of PLACEHOLDERS) {
    if (doc.text.indexOf(p) < 0) err(res, '缺少占位符 ' + p, doc.file);
  }
}

/* ------------------------------------------------------------------ */
/* B. 注册表与快捷方式语义                                             */
/* ------------------------------------------------------------------ */

function checkRegistry(res, doc) {
  for (const w of doc.parsed.regWrites) {
    if (!REG_ROOTS.has(w.root)) err(res, 'WriteReg* 的根 ' + JSON.stringify(w.root) + ' 不是合法注册表根', w.line);
  }
  for (const d of doc.parsed.regDeletes) {
    if (d.value !== null && !REG_ROOTS.has(d.root)) err(res, 'DeleteRegValue 的根 ' + JSON.stringify(d.root) + ' 不合法', d.line);
  }

  const coexistFamily = !(doc.instance && !doc.coexist);
  if (!coexistFamily) info(res, '老家族安装器（无 $LABEL_THIS）用 ${UNINST_KEY}/${HASH_KEY} 而非 *_THIS，跳过共存家族专有断言', doc.file);
  const uninstWrites = doc.parsed.regWrites.filter(function (w) { return w.key === '$UNINST_KEY_THIS'; });
  if (!uninstWrites.length && coexistFamily) {
    err(res, '没有向 $UNINST_KEY_THIS 写卸载项 —— 控制面板里不会出现该程序', doc.file);
  } else if (uninstWrites.length) {
    const values = new Set(uninstWrites.map(function (w) { return w.value; }));
    for (const v of UNINSTALL_VALUES) if (!values.has(v)) err(res, '卸载项缺少值 ' + v, uninstWrites[0].line);
  }

  const hashWrite = doc.parsed.regWrites.some(function (w) { return w.key === '$HASH_KEY_THIS'; });
  const hashDelete = doc.parsed.regDeletes.some(function (d) { return d.key === '$HASH_KEY_THIS'; });
  if (coexistFamily && !hashWrite) err(res, 'HashDir 没有把哈希写进 $HASH_KEY_THIS', doc.file);
  if (coexistFamily && !hashDelete) err(res, '卸载时没有 DeleteRegKey $HASH_KEY_THIS，注册表会残留', doc.file);

  const runWrites = doc.parsed.regWrites.filter(function (w) { return w.key.indexOf('CurrentVersion\\Run') >= 0; });
  for (const w of runWrites) {
    const del = doc.parsed.regDeletes.some(function (d) { return d.key === w.key && d.value === w.value; });
    if (!del) err(res, '自启动 "Run" 值 ' + w.value + ' 写入后没有在卸载里删除', w.line);
  }

  const envWrites = doc.parsed.regWrites.filter(function (w) { return w.root === 'HKCU' && w.key === 'Environment'; });
  const envDeletes = doc.parsed.regDeletes.filter(function (d) { return d.root === 'HKCU' && d.key === 'Environment'; });
  const delNames = new Set(envDeletes.map(function (d) { return d.value; }));
  if (!envWrites.length) warn(res, '没有注册 inc*/inx* 环境变量', doc.file);
  for (const w of envWrites) {
    if (USER_OWNED_ENV.has(w.value)) continue;
    if (!delNames.has(w.value)) err(res, '环境变量 ' + w.value + ' 写入后没有在卸载里 DeleteRegValue，会永久残留', w.line);
  }
}

function expandDefines(s, defines) {
  return s.replace(/\$\{([A-Za-z0-9_]+)\}/g, function (all, name) {
    return defines.has(name) ? defines.get(name).replace(/^"|"$/g, '') : all;
  });
}

function checkShortcuts(res, doc) {
  const sc = doc.parsed.shortcuts;
  if (!sc.length) { err(res, 'installer.nsi 里没有任何 CreateShortCut', doc.file); return; }
  if (!sc.some(function (s) { return s.link.indexOf('$SMPROGRAMS') >= 0; })) err(res, '没有开始菜单快捷方式', doc.file);
  if (!sc.some(function (s) { return s.link.indexOf('$DESKTOP') >= 0; })) err(res, '没有桌面快捷方式', doc.file);

  for (const s of sc) {
    const link = expandDefines(s.link, doc.parsed.defines);
    const dir = link.replace(/\\[^\\]*$/, '');
    const removed = doc.parsed.deletes.some(function (d) {
      const w = expandDefines(d.what, doc.parsed.defines).trim();
      if (d.op.toLowerCase() === 'rmdir') return w === dir || w.replace(/\s*\/r\s*$/i, '').trim() === dir;
      return w === link;
    });
    if (!removed) {
      warn(res, '快捷方式 ' + s.link + ' 创建了，但卸载里找不到同名 Delete/RMDir' +
        '（共存模式下 LABEL_THIS 等于 PRODUCT_NAME 加版本号，与创建时用的 PRODUCT_NAME 不同，桌面会留下死链接）', s.line);
    }
  }
  for (const s of sc) {
    if (s.icon) continue;
    /* 实例模式只核对完整性，"图标用默认值"这种样式选择不计入 strict。 */
    if (doc.instance) info(res, '快捷方式 ' + s.link + ' 没有指定图标参数（实例模式按样式信息处理，不计入 strict）', s.line);
    else warn(res, '快捷方式 ' + s.link + ' 没有指定图标参数', s.line);
  }
}

/* ------------------------------------------------------------------ */
/* C. 与构建产物核对（载荷存在性）                                     */
/* ------------------------------------------------------------------ */

function classifyPayloadRef(rel) {
  if (GENERATED_IN_INSTDIR.has(rel)) return 'generated';
  if (/_gui\.exe$/i.test(rel)) return 'optional-gui';
  if (/^plugins\\/i.test(rel)) return 'optional-plugins';
  return 'required';
}

function checkPayload(res, doc, payloadRoots, exeName) {
  if (!payloadRoots.length) {
    warn(res, '没有找到 build/setup-stage/<平台> 载荷，跳过与构建产物的核对', doc.file);
    return;
  }
  for (const entry of doc.instdirRefs) {
    const rel = entry[0];
    const line = entry[1];
    const kind = classifyPayloadRef(rel);
    if (kind === 'generated') continue;
    const missingIn = [];
    for (const pr of payloadRoots) if (!fs.existsSync(path.join(pr.dir, rel))) missingIn.push(pr.id);
    if (!missingIn.length) continue;
    if (kind === 'required') {
      err(res, 'installer.nsi 引用的 $INSTDIR\\' + rel + ' 在载荷里不存在（' + missingIn.join(', ') + '）', line);
    } else if (kind === 'optional-gui') {
      warn(res, '$INSTDIR\\' + rel + ' 在载荷里不存在（' + missingIn.join(', ') + '）；Electron 外壳未打包时安装器只发命令行，' +
        '但 installer.nsi 仍把它写进环境变量，会指向不存在的文件', line);
    } else {
      warn(res, '$INSTDIR\\' + rel + ' 在载荷里不存在（' + missingIn.join(', ') + '）；make-setup.mjs 目前不暂存 plugins，' +
        '相关环境变量指向不存在的文件', line);
    }
  }

  if (doc.text.indexOf('@@APP_DIR@@\\inc.ico') < 0) {
    if (doc.instance) info(res, '实例脚本没有用载荷图标作 MUI_ICON（样式信息，不计入 strict）', doc.file);
    else warn(res, '模板里没有引用 @@APP_DIR@@\\inc.ico（安装器图标会是 NSIS 默认图标）', doc.file);
  }
  for (const pr of payloadRoots) {
    if (fs.existsSync(path.join(pr.dir, 'inc.ico'))) continue;
    if (doc.instance) info(res, '载荷 ' + pr.id + ' 里没有 inc.ico（该产品不用载荷图标，实例模式下不计入 strict）', doc.file);
    else err(res, '载荷 ' + pr.id + ' 里没有 inc.ico，makensis 会在 MUI_ICON 处失败', doc.file);
  }

  if (doc.text.indexOf('@@EXE@@') >= 0) {
    for (const pr of payloadRoots) {
      if (!fs.existsSync(path.join(pr.dir, exeName))) err(res, '@@EXE@@ = ' + exeName + ' 在载荷 ' + pr.id + ' 里不存在，快捷方式会指向不存在的文件', doc.file);
    }
    info(res, '@@EXE@@ 解析为 ' + exeName, doc.file);
  }
}

/* ------------------------------------------------------------------ */
/* D. 编码契约与生成的 .nsi                                            */
/* ------------------------------------------------------------------ */

function checkEncodingContract(res, doc, projectRoot) {
  if (doc.instance) {
    const b = fs.readFileSync(doc.file);
    const isBom = b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF;
    if (!isBom) err(res, doc.file + ' 没有 UTF-8 BOM，makensis 会按 ANSI 解析', doc.file);
    else info(res, '实例脚本自身带 UTF-8 BOM', doc.file);
  }
  if (!/[^\x00-\x7F]/.test(doc.text)) return;
  const ms = path.join(projectRoot, 'sourcecode', 'tools', 'make-setup.mjs');
  if (!fs.existsSync(ms)) {
    if (doc.instance) info(res, '实例模式：本例的 make-setup.mjs 不在 sourcecode/tools 下（IPM 在 tools/），实例自身 BOM 已单独核对', doc.file);
    else warn(res, '找不到 make-setup.mjs，无法确认生成的 .nsi 是否带 UTF-8 BOM', doc.file);
    return;
  }
  if (readText(ms).indexOf('uFEFF') < 0) {
    err(res, 'installer.nsi 含非 ASCII 文本，而 make-setup.mjs 不再写 UTF-8 BOM —— ' +
      'makensis 会按 ANSI 解析并因 "Bad text encoding" 中止（旧版检查正是踩了这个坑）', ms);
  } else {
    info(res, '编码契约：make-setup.mjs 写 UTF-8 BOM，检查器也用 BOM 编译', doc.file);
  }

  const stage = path.join(projectRoot, 'sourcecode', 'build', 'setup-stage');
  if (!fs.existsSync(stage)) return;
  for (const f of fs.readdirSync(stage)) {
    if (!/^setup-.*\.nsi$/.test(f)) continue;
    const p = path.join(stage, f);
    const buf = fs.readFileSync(p);
    const isBom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
    if (!isBom) err(res, f + ' 没有 UTF-8 BOM，makensis 会按 ANSI 解析', p);
    const txt = buf.toString('utf8');
    for (const ph of PLACEHOLDERS) if (txt.indexOf(ph) >= 0) err(res, f + ' 里残留占位符 ' + ph, p);
    if (!doc.instance && fs.statSync(p).mtimeMs < doc.mtimeMs) {
      warn(res, f + ' 比 installer.nsi 旧，是陈旧产物；发布前请重跑 make-setup.mjs', p);
    }
  }
}

/* ------------------------------------------------------------------ */
/* E. 真实编译                                                         */
/* ------------------------------------------------------------------ */

function checkCompile(res, doc, opts) {
  const makensis = opts.makensis;
  if (!fs.existsSync(makensis)) {
    err(res, '找不到 makensis：' + makensis + '（这是校验语法/宏/图标的唯一手段）', makensis);
    return;
  }
  const icon = resolveIcon(opts.projectRoot, opts.payloadRoots);
  if (!icon) { err(res, '找不到真 inc.ico，无法编译（不能用假图标：makensis 会因为无效 ICO 失败）', doc.file); return; }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'nsi-check-'));
  try {
    const payload = path.join(work, 'payload');
    fs.mkdirSync(payload, { recursive: true });
    for (const rel of doc.instdirRefs.keys()) {
      if (GENERATED_IN_INSTDIR.has(rel)) continue;
      const dst = path.join(payload, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      if (!fs.existsSync(dst)) fs.writeFileSync(dst, 'x');
    }
    fs.copyFileSync(icon, path.join(payload, 'inc.ico'));

    const out = path.join(work, 'setup.exe');
    const filled = doc.text
      .split('@@VERSION@@').join('v0.0.0-nsi-check')
      .split('@@OUTFILE@@').join(out)
      .split('@@APP_DIR@@').join(payload)
      .split('@@EXE@@').join(opts.exeName);
    const nsi = path.join(work, 'check.nsi');
    fs.writeFileSync(nsi, '\uFEFF' + filled, 'utf8');

    let code = 0;
    const t0 = Date.now();
    try {
      execFileSync(makensis, ['/V4', '/O' + out, nsi], { cwd: work, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      code = (e.status === undefined || e.status === null) ? -1 : e.status;
    }
    const ms = Date.now() - t0;
    if (code !== 0) {
      err(res, 'makensis 编译失败，exit=' + code + '（' + ms + ' ms）。注意：本机 makensis 把编译日志写到控制台而不是 stdout/stderr，' +
        '抓不到具体报错；请手工运行 makensis /V4 查看，或用上面的静态错误定位。', doc.file);
    } else {
      const size = fs.existsSync(out) ? fs.statSync(out).size : 0;
      info(res, 'makensis 编译通过（' + ms + ' ms，合成载荷产物 ' + size + ' B）', doc.file);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */
/* 主检查                                                              */
/* ------------------------------------------------------------------ */

export function check(options) {
  const o = options || {};
  const res = makeResult();
  const templatePath = o.templatePath || DEFAULT_TEMPLATE;
  if (!fs.existsSync(templatePath)) {
    err(res, '模板不存在：' + templatePath, templatePath);
    res.stats.template = templatePath;
    res.ok = false;
    return res;
  }
  const buf = fs.readFileSync(templatePath);
  const projectRoot = o.projectRoot || path.dirname(templatePath);
  const text = buf.toString('utf8').replace(/^\uFEFF/, '');
  /*
   * 实例脚本：make-setup.mjs 已经把四个占位符替换掉，文件落在 build/setup-stage/
   * 下、叫 setup-<平台>.nsi。它没有占位符可查，但要按"真实出货脚本"来核对：
   * 结构、快捷方式配对、环境变量配对、以及每个 $INSTDIR\... 引用在载荷里存在。
   */
  const instance = o.instance === true || (
    text.indexOf('@@') < 0 &&
    /[\\/]setup-stage[\\/]setup-[^\\/]+\.nsi$/.test(templatePath)
  );
  let payloadRoots = o.payloadRoots;
  if (!payloadRoots) {
    if (instance) {
      const m = text.match(/^[ \t]*File[ \t]+\/r[ \t]+"([^"\r\n]+)"/mi);
      const dir = m ? path.dirname(m[1]) : '';
      payloadRoots = dir && fs.existsSync(dir) ? [{ id: path.basename(dir), dir: dir }] : [];
    } else {
      payloadRoots = findPayloadRoots(projectRoot);
    }
  }
  const exeName = o.exeName || resolveExeName(projectRoot, payloadRoots);
  const analysis = text.split('@@EXE@@').join(exeName);

  const doc = {
    file: templatePath,
    text: text,
    instance: instance,
    /* 共存家族（用 $LABEL_THIS/$UNINST_KEY_THIS）才适用那批专有断言；
     * 老家族（IPM 的 nsis.nsi，直接写 ${UNINST_KEY}）不算残缺，只是另一套。 */
    coexist: text.indexOf('$LABEL_THIS') >= 0,
    instanceDir: instance && payloadRoots.length ? payloadRoots[0].dir : null,
    mtimeMs: fs.statSync(templatePath).mtimeMs,
    parsed: parseNsi(analysis),
    instdirRefs: collectInstdirRefs(scanLines(analysis))
  };

  res.stats.template = templatePath;
  res.stats.bytes = buf.length;
  res.stats.sha256 = sha256(buf);
  res.stats.lines = text.split(/\r?\n/).length;
  res.stats.sections = doc.parsed.sections.length;
  res.stats.functions = doc.parsed.functions.length;
  res.stats.payloadRoots = payloadRoots.map(function (p) { return p.id; });
  res.stats.regWrites = doc.parsed.regWrites.length;
  res.stats.shortcuts = doc.parsed.shortcuts.length;
  res.stats.exeName = exeName;
  res.stats.instance = instance;

  checkStructure(res, doc);
  checkPlaceholders(res, doc);
  checkRegistry(res, doc);
  checkShortcuts(res, doc);
  checkPayload(res, doc, payloadRoots, exeName);
  checkEncodingContract(res, doc, projectRoot);
  if (doc.instance && o.compile !== false) {
    info(res, '实例模式：跳过真实编译（这份脚本已由 make-setup.mjs 编译成 setup exe）', doc.file);
  }
  if (o.compile !== false && !doc.instance) checkCompile(res, doc, {
    makensis: o.makensis || DEFAULT_MAKENSIS,
    projectRoot: projectRoot, payloadRoots: payloadRoots, exeName: exeName
  });

  if (o.strict) {
    for (const w of res.warnings) res.errors.push({ msg: '[strict] ' + w.msg, where: w.where });
    res.warnings = [];
  }
  res.ok = res.errors.length === 0;
  return res;
}

/* ------------------------------------------------------------------ */
/* 输出与 CLI                                                          */
/* ------------------------------------------------------------------ */

export function format(res) {
  const out = [];
  out.push('nsi-check: ' + res.stats.template);
  if (res.stats.sha256) {
    out.push('  bytes=' + res.stats.bytes + '  sha256=' + res.stats.sha256);
    out.push('  lines=' + res.stats.lines + '  sections=' + res.stats.sections +
      '  functions=' + res.stats.functions + '  regWrites=' + res.stats.regWrites +
      '  shortcuts=' + res.stats.shortcuts + '  @@EXE@@=' + res.stats.exeName);
    out.push('  payload=' + (res.stats.payloadRoots.length ? res.stats.payloadRoots.join(', ') : '(无)'));
    out.push('  mode=' + (res.stats.instance ? 'instance（make-setup 生成的 setup-*.nsi）' : 'template'));
  }
  for (const e of res.errors) out.push('ERROR ' + (e.where ? e.where + ': ' : '') + e.msg);
  for (const w of res.warnings) out.push('WARN  ' + (w.where ? w.where + ': ' : '') + w.msg);
  for (const i of res.infos) out.push('INFO  ' + (i.where ? i.where + ': ' : '') + i.msg);
  out.push(res.ok ? 'OK: ' + res.errors.length + ' error, ' + res.warnings.length + ' warning'
    : 'FAILED: ' + res.errors.length + ' error, ' + res.warnings.length + ' warning');
  return out.join(NL);
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--strict') { o.strict = true; continue; }
    if (a === '--instance') { o.instance = true; continue; }
    if (a === '--no-compile') { o.compile = false; continue; }
    if (a === '--json') { o.json = true; continue; }
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    const eq = a.indexOf('=');
    const key = eq >= 0 ? a.slice(0, eq) : a;
    const val = eq >= 0 ? a.slice(eq + 1) : argv[++i];
    if (key === '--template') o.templatePath = path.resolve(val);
    else if (key === '--root') o.projectRoot = path.resolve(val);
    else if (key === '--payload') o.payloadRoots = [{ id: path.basename(val), dir: path.resolve(val) }];
    else if (key === '--makensis') o.makensis = path.resolve(val);
    else { o.badArg = a; return o; }
  }
  return o;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) {
    process.stdout.write('用法: node nsi-check.mjs [--strict] [--no-compile] [--json]' + NL +
      '       [--template <installer.nsi>] [--root <Infinity Cloud>]' + NL +
      '       [--payload <载荷目录>] [--makensis <makensis.exe>] [--instance]' + NL +
      '       --instance：校验 make-setup.mjs 生成的 build/setup-stage/setup-*.nsi' + NL);
    return 0;
  }
  if (o.badArg) { process.stderr.write('未知参数: ' + o.badArg + NL); return 2; }
  let res;
  try {
    res = check(o);
  } catch (e) {
    process.stderr.write('nsi-check 内部错误: ' + (e && e.stack ? e.stack : e) + NL);
    return 2;
  }
  if (o.json) process.stdout.write(JSON.stringify(res, null, 2) + NL);
  else process.stdout.write(format(res) + NL);
  if (!res.stats.template || !fs.existsSync(res.stats.template)) return 2;
  return res.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(url.fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
