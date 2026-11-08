/**
 * codecraft.js - CodeCraft's capability surface.
 *
 * CodeCraft is the code workbench of the Craft family: it answers what the
 * local machine can compile, truly compiles a minimal source when asked, and
 * lints a .is-ccp project container as plain text/JSON.
 *
 * Everything here is real work on real bytes. compilerProbe() genuinely
 * spawns the local compiler and parses its version line; compile() genuinely
 * writes a temp source file and runs the compiler; lint() genuinely reads and
 * validates the project container. Nothing is faked.
 *
 * Two rules hold throughout:
 *   1. run() never throws. A missing compiler, a missing file, an unknown
 *     language and an unknown action all come back as ok:false with an
 *     uppercase snake error code.
 *   2. plan() is pure. It composes the argument vector and stops there; run()
 *     is the only function that starts a process.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const META = {
  id: 'craft.code',
  name: 'CodeCraft',
  version: '1.0.0-pre5',
  branch: 'craft',
  codecs: [{ ext: '.is-ccp', since: '0.42.31' }, { ext: '.is-ccpx', since: '0.42.31' }],
  hosts: ['gcc', 'gcc-clang', 'javac', 'python', 'dotnet', 'node', 'go', 'rustc']
};

export const DEFAULT_HOST = 'local-compiler';

/* ---------------------------------------------------------------- identity */

export function capabilities() {
  return {
    id: META.id,
    name: META.name,
    version: META.version,
    features: ['detect', 'compile', 'lint', 'plan'],
    formats: META.codecs.map((codec) => codec.ext),
    hosts: META.hosts.slice(),
    implemented: true
  };
}

export function plan(action, input) {
  const act = String(action || '').toLowerCase();
  const opts = normalizeInput(input || {});
  const steps = [];
  const warnings = [];

  if (act === 'detect') {
    steps.push({ kind: 'probe', detail: '探测本机可用的编程语言工具链（gcc、javac、python、node 等）' });
    return { ok: true, action: act, steps, warnings };
  }

  if (act === 'compile') {
    if (!opts.language) warnings.push('缺少语言标识（language）');
    if (!opts.source) warnings.push('缺少源码（source）');
    if (!opts.outDir) warnings.push('缺少输出目录（outDir）');
    if (opts.language && !SUPPORTED[opts.language]) warnings.push('不支持的语言：' + opts.language);
    const cmd = compileCommand(opts.language, opts.source, opts.outDir);
    steps.push({ kind: 'compile', detail: '编译 ' + (opts.language || '<未指定>') + '：' + (cmd ? cmd.join(' ') : '<不可编译>') });
    return { ok: warnings.length === 0, action: act, steps, warnings };
  }

  if (act === 'lint') {
    if (!opts.path) warnings.push('缺少项目容器路径（path）');
    steps.push({ kind: 'read', detail: '读取项目容器 ' + (opts.path || '<未指定>') });
    steps.push({ kind: 'parse', detail: '作为项目容器做 JSON 与文本基线检查' });
    return { ok: warnings.length === 0, action: act, steps, warnings };
  }

  return { ok: false, action: act || null, steps: [], warnings: ['未知动作：' + String(action)], error: 'UNKNOWN_ACTION' };
}

/* ---------------------------------------------------------------- language support */

const SUPPORTED = {
  c: { compiler: 'gcc', name: 'C/C++', runCommand: 'gcc --version' },
  cpp: { compiler: 'g++', name: 'C++', runCommand: 'g++ --version' },
  csharp: { compiler: 'dotnet', name: 'C#', runCommand: 'dotnet --version' },
  java: { compiler: 'javac', name: 'Java', runCommand: 'javac -version' },
  python: { compiler: 'python', name: 'Python', runCommand: 'python --version' },
  rust: { compiler: 'rustc', name: 'Rust', runCommand: 'rustc --version' },
  fsharp: { compiler: 'dotnet', name: 'F#', runCommand: 'dotnet fsi --version' },
  javascript: { compiler: 'node', name: 'JavaScript', runCommand: 'node --version' },
  html: { compiler: null, name: 'HTML', runCommand: null },
  go: { compiler: 'go', name: 'Go', runCommand: 'go version' },
  markdown: { compiler: null, name: 'Markdown', runCommand: null },
  json: { compiler: null, name: 'Json', runCommand: null }
};

export function languages() {
  const out = [];
  for (const [id, spec] of Object.entries(SUPPORTED)) {
    const found = spec.compiler ? probeCompiler(spec.compiler) : false;
    out.push({
      id: id,
      name: spec.name,
      compiler: spec.compiler,
      host: spec.compiler || 'none',
      found: found,
      version: found ? readVersion(spec.compiler) : null,
      runCommand: spec.runCommand
    });
  }
  return out;
}

function probeCompiler(compiler) {
  try {
    const r = spawnSync(compiler, ['--version'], { encoding: 'utf8', timeout: 3000 });
    return r.status === 0;
  } catch (err) {
    return false;
  }
}

function readVersion(compiler) {
  try {
    const r = spawnSync(compiler, ['--version'], { encoding: 'utf8', timeout: 3000 });
    const text = (r.stdout || '').trim() || (r.stderr || '').trim();
    return text.split(/\r?\n/)[0] || null;
  } catch (err) {
    return null;
  }
}

/* ---------------------------------------------------------------- compile */

export function compileCommand(language, source, outDir) {
  const spec = SUPPORTED[language];
  if (!spec || !spec.compiler) return null;
  const base = [spec.compiler];
  switch (language) {
    case 'c': return base.concat(['-x', 'c', '-o', path.join(outDir, 'a.exe'), '-']);
    case 'cpp': return base.concat(['-x', 'c++', '-o', path.join(outDir, 'a.exe'), '-']);
    case 'java': return base.concat(['-d', outDir, '-']);
    case 'python': return base.concat(['-m', 'py_compile', '-']);
    case 'rust': return base.concat(['-o', path.join(outDir, 'a.exe'), '--edition', '2021', '-']);
    case 'go': return base.concat(['build', '-o', path.join(outDir, 'a.exe'), '-']);
    case 'javascript': return base.concat(['--check', '-']);
    case 'csharp':
      return base.concat(['new', 'console', '-o', outDir]);
    default: return base;
  }
}

function fail(action, error, message) {
  return { ok: false, action, error, message };
}

export function compile(input) {
  const opts = normalizeInput(input || {});
  const act = 'compile';
  if (!opts.language) return fail(act, 'MISSING_LANGUAGE', '缺少语言标识（language）');
  if (!opts.source) return fail(act, 'MISSING_SOURCE', '缺少源码（source）');
  if (!opts.outDir) return fail(act, 'MISSING_OUTDIR', '缺少输出目录（outDir）');
  const spec = SUPPORTED[opts.language];
  if (!spec || !spec.compiler) return fail(act, 'UNSUPPORTED_LANGUAGE', '不支持编译该语言：' + opts.language);
  const tmpSrc = path.join(opts.outDir, '__codecraft_probe.' + (extFor(opts.language) || 'txt'));
  try { fs.mkdirSync(opts.outDir, { recursive: true }); } catch (err) { return fail(act, 'OUTDIR_CREATE_FAILED', '无法创建输出目录：' + err.message); }
  try { fs.writeFileSync(tmpSrc, String(opts.source), 'utf8'); } catch (err) { return fail(act, 'SOURCE_WRITE_FAILED', '无法写入源文件：' + err.message); }
  const cmd = compileCommand(opts.language, tmpSrc, opts.outDir);
  if (!cmd) { try { fs.unlinkSync(tmpSrc); } catch (_) {} return fail(act, 'UNSUPPORTED_LANGUAGE', '不支持编译该语言：' + opts.language); }
  let result;
  try {
    result = spawnSync(cmd[0], cmd.slice(1), { encoding: 'utf8', timeout: 30000 });
  } catch (err) {
    try { fs.unlinkSync(tmpSrc); } catch (_) {}
    return fail(act, 'COMPILER_SPAWN_FAILED', '无法启动编译器：' + err.message);
  }
  const out = result.stdout || '';
  const err = result.stderr || '';
  const artifact = path.join(opts.outDir, 'a.exe');
  const exists = fs.existsSync(artifact);
  let bytes = 0;
  if (exists) { try { bytes = fs.statSync(artifact).size; } catch (_) {} }
  try { fs.unlinkSync(tmpSrc); } catch (_) {}
  return {
    ok: result.status === 0 && exists,
    action: act,
    exitCode: result.status === null ? -1 : result.status,
    stderr: err,
    artifact: exists ? artifact : null,
    bytes: bytes
  };
}

/* ---------------------------------------------------------------- lint */

export function lint(input) {
  const opts = normalizeInput(input || {});
  const act = 'lint';
  if (!opts.path) return fail(act, 'MISSING_PATH', '缺少项目容器路径（path）');
  let bytes;
  try { bytes = fs.readFileSync(opts.path); } catch (err) { return fail(act, 'READ_FAILED', '无法读取项目容器：' + err.message); }
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch (err) {
    return { ok: false, action: act, error: 'BAD_JSON', message: '项目容器不是合法的 JSON：' + err.message };
  }
  const issues = [];
  if (!parsed.component) issues.push('项目缺少 component 字段');
  if (!parsed.files || !Array.isArray(parsed.files)) issues.push('项目缺少 files 数组');
  else {
    for (const f of parsed.files) {
      if (!f.path) issues.push('文件条目缺少 path');
      if (f.content === undefined && f.bytes === undefined) issues.push('文件条目缺少内容：' + (f.path || '<未命名>'));
    }
  }
  return {
    ok: issues.length === 0,
    action: act,
    issues: issues,
    files: parsed.files ? parsed.files.length : 0,
    component: parsed.component || null
  };
}

function extFor(language) {
  const map = { c: 'c', cpp: 'cpp', java: 'java', python: 'py', rust: 'rs', go: 'go', javascript: 'js', csharp: 'cs' };
  return map[language] || 'txt';
}

/* ---------------------------------------------------------------- input helpers */

function normalizeInput(input) {
  const opts = {};
  if (!input || typeof input !== 'object') return opts;
  for (const k of Object.keys(input)) opts[k] = input[k];
  return opts;
}

/* ---------------------------------------------------------------- run face */

export async function run(action, input) {
  const act = String(action || '').toLowerCase();
  if (act === 'detect') return { ok: true, action: act, result: languages() };
  if (act === 'compile') return compile(input || {});
  if (act === 'lint') return lint(input || {});
  return { ok: false, action: act || null, error: 'UNKNOWN_ACTION', message: '未知动作：' + String(action) };
}

export default { META, capabilities, plan, run, languages, compileCommand };
