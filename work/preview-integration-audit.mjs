// preview-integration-audit.mjs — INC/IFM 流式预览"是否已并入正式源码树"的取证审计
// 事实源：cpp/apps/inc（INC 权威实现，UI 由 C++ 后端提供）、Infinity File Manager/sourcecode（IFM JS 线）
// 防漂移：Infinity Cloud/preview/ 下的两份 preview.hpp 必须与 cpp/apps/inc/preview.hpp 逐字节一致
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const problems = [];
const facts = {};
const sha = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');
const size = (rel) => fs.statSync(path.join(ROOT, rel)).size;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const count = (rel, rx) => (read(rel).match(rx) || []).length;
const need = (rel) => { if (!fs.existsSync(path.join(ROOT, rel))) { problems.push('missing ' + rel); return false; } return true; };

// 1) INC：权威实现 + 路由注册 + UI 调用
const hppSources = ['cpp/apps/inc/preview.hpp', 'Infinity Cloud/preview/preview.hpp', 'Infinity Cloud/preview/generated/preview.hpp'];
const hashes = {};
for (const f of hppSources) if (need(f)) hashes[f] = { bytes: size(f), sha256: sha(f) };
const uniqueHashes = new Set(Object.values(hashes).map((h) => h.sha256));
facts.previewHpp = hashes;
facts.previewHppInSync = uniqueHashes.size === 1;
if (uniqueHashes.size !== 1) problems.push('preview.hpp copies differ: ' + JSON.stringify(Object.entries(hashes).map(([f, h]) => [f, h.sha256.slice(0, 12)])));
facts.incRoutes = need('cpp/apps/inc/main.cpp') ? count('cpp/apps/inc/main.cpp', /\/api\/preview/g) : 0;
facts.incUiCalls = need('cpp/apps/inc/ui.hpp') ? count('cpp/apps/inc/ui.hpp', /\/api\/preview/g) : 0;
if (facts.incRoutes < 1) problems.push('cpp/apps/inc/main.cpp does not register /api/preview');
if (facts.incUiCalls < 1) problems.push('cpp/apps/inc/ui.hpp does not call /api/preview');
facts.incPreviewSymbols = count('cpp/apps/inc/preview.hpp', /preview/gi);

// 2) IFM：JS 线核心模块 + 服务器接线
facts.ifmCore = need('Infinity File Manager/sourcecode/src/core/preview.js') ? { bytes: size('Infinity File Manager/sourcecode/src/core/preview.js'), sha256: sha('Infinity File Manager/sourcecode/src/core/preview.js') } : null;
const ifmServer = 'Infinity File Manager/sourcecode/src/gui/server.js';
facts.ifmServer = need(ifmServer) ? count(ifmServer, /preview/gi) : 0;
if (facts.ifmServer < 1) problems.push(ifmServer + ' does not wire the preview module');

// 3) 测试入口
facts.tests = {};
for (const t of ['Infinity Cloud/preview/tests/run-tests.ps1', 'Infinity File Manager/bench/preview-http-check.mjs', 'Infinity File Manager/bench/preview-bench.mjs']) {
  facts.tests[t] = need(t) ? size(t) : 0;
}

// 4) 其它线是否缺预览（记录事实，不判失败）
facts.otherLines = {
  'Infinity Cloud/sourcecode (Electron/JS-SEA 线)': count('Infinity Cloud/sourcecode/build/bundle.cjs', /\/api\/preview/g) || 0
};

// 5) 文档中心接线 + 引用文档必须存在（死链即失败）
const docsPages = ['web/infinity/docs/index.html', 'web/infinity/cn/docs/index.html'];
facts.docsHub = {};
let dangling = 0;
for (const pg of docsPages) {
  if (!need(pg)) continue;
  const text = read(pg);
  const refs = [...text.matchAll(/path: '([^']+)'/g)].map((m) => m[1]);
  const missing = refs.filter((r) => !fs.existsSync(path.join(ROOT, r)));
  facts.docsHub[pg] = { entries: refs.length, refs, missing };
  if (missing.length) { dangling += missing.length; problems.push(pg + ' references missing file(s): ' + missing.join(', ')); }
  if (refs.indexOf('docs/FEATURE-streaming-preview.md') < 0) problems.push(pg + ' does not link the streaming-preview document');
}
facts.danglingDocRefs = dangling;
const siteJs = 'web/infinity/assets/site.js';
facts.i18nPreviewKeys = need(siteJs) ? (read(siteJs).match(/^\s*docPreview(Note)?:/gm) || []).length : 0;
if (facts.i18nPreviewKeys !== 4) problems.push('site.js must define docPreview/docPreviewNote in both languages (found ' + facts.i18nPreviewKeys + ' of 4)');

// 6) 站点/文档可见性（事实记录）
const docRefs = ['docs/RELEASE-v1.0pre5.md', 'docs/RELEASE-v1.0pre5-body.md'].filter((d) => fs.existsSync(path.join(ROOT, d))).map((d) => read(d).match(/流式预览|streaming preview/gi) || []).reduce((a, b) => a + b.length, 0);
facts.siteVisibility = { releaseDocMentions: docRefs };

const out = { ok: problems.length === 0, at: new Date().toISOString(), facts, problems };
fs.writeFileSync(path.join(ROOT, 'work/preview-integration-audit.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
console.log(problems.length === 0 ? 'PREVIEW-AUDIT-PASS 三份 preview.hpp 同源同哈希; INC 路由/UI 接线在; IFM 核心+服务器接线在' : 'PREVIEW-AUDIT-FAIL ' + problems.length);
process.exit(problems.length === 0 ? 0 : 1);
