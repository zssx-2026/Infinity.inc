const m = (await import('file:///D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/InfinityStudio/src/apps/webviewer.js?v=' + Date.now())).default;
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let pass = 0;
let fail = 0;
function check(desc, cond, extra) {
  if (cond) { pass += 1; console.log('ok   ' + desc); }
  else { fail += 1; console.log('FAIL ' + desc + (extra !== undefined ? ' <- ' + JSON.stringify(extra) : '')); }
}

/* 临时目录固定在工作区内（本环境 os.tmpdir() 可能是相对路径）。 */
const TMP = path.resolve('work', 'tmp-webviewer-smoke-' + Date.now());
fs.mkdirSync(TMP, { recursive: true });

(async () => {
  check('module loads META/capabilities/plan/run', !!m && typeof m.run === 'function' && typeof m.plan === 'function' && typeof m.capabilities === 'function');

  const cap = m.capabilities();
  check('capabilities implemented + id', cap && cap.implemented === true && cap.id === 'webviewer', cap);
  check('capabilities 4 features', Array.isArray(cap.features) && cap.features.length === 4, cap.features);
  check('META codecs .html/.htm/.mhtml', m.META.codecs.map((c) => c.ext).join(',') === '.html,.htm,.mhtml', m.META.codecs);

  // ---- inspect: a real page ----
  const page = path.join(TMP, 'page.html');
  const html = [
    '<!doctype html>',
    '<html><head>',
    '<meta charset="UTF-8">',
    '<title>  Infinity   &amp; Studio  </title>',
    '<link rel="stylesheet" href="a.css">',
    '<link rel="icon" href="favicon.ico">',
    '<script src="one.js"></script>',
    '<script src="two.js"></script>',
    '<script src="one.js"></script>',
    '</head><body>',
    '<a href="https://example.com/x">x</a>',
    '<a href="/local">local</a>',
    '<a href=\'/single-quoted\'>sq</a>',
    '<a href="https://example.com/x">duplicate</a>',
    '<img src="pic.png">',
    '<img src="pic2.png">',
    '</body></html>'
  ].join('\n');
  fs.writeFileSync(page, html);

  const insp = await m.run('inspect', { path: page });
  check('inspect ok', insp && insp.ok === true, insp && insp.error);
  check('inspect title decoded and collapsed', insp.title === 'Infinity & Studio', insp && insp.title);
  check('inspect links deduped to 3', insp.linkCount === 3 && insp.links.length === 3, insp && insp.links);
  check('inspect keeps absolute and relative links', insp.links.includes('https://example.com/x') && insp.links.includes('/local') && insp.links.includes('/single-quoted'), insp && insp.links);
  check('inspect scripts deduped to 2', insp.scripts.length === 2, insp && insp.scripts);
  check('inspect images 2', insp.images.length === 2, insp && insp.images);
  check('inspect stylesheets only rel=stylesheet', insp.stylesheets.length === 1 && insp.stylesheets[0] === 'a.css', insp && insp.stylesheets);
  check('inspect charset utf-8', insp.charset === 'utf-8', insp && insp.charset);
  check('inspect bytes match file', insp.bytes === fs.statSync(page).size, insp && insp.bytes);
  check('inspect lines counted', insp.lines === html.split('\n').length, insp && insp.lines);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(page)).digest('hex');
  check('inspect sha256 matches independent hash', insp.sha256 === digest, insp && insp.sha256);

  // ---- inspect: problems ----
  check('inspect missing -> READ_FAILED', (await m.run('inspect', { path: path.join(TMP, 'nope.html') })).error === 'READ_FAILED');
  check('inspect without path -> MISSING_PATH', (await m.run('inspect', {})).error === 'MISSING_PATH');

  // ---- bookmarks ----
  const good = path.join(TMP, 'bookmarks.json');
  fs.writeFileSync(good, JSON.stringify({ bookmarks: [{ title: 'Hub', url: ' http://127.0.0.1:7621/ ' }, { url: 'https://example.com' }] }));
  const bm = await m.run('bookmarks', { path: good });
  check('bookmarks ok with 2 rows', bm && bm.ok === true && bm.total === 2 && bm.bookmarks.length === 2 && bm.issues.length === 0, bm);
  check('bookmarks url trimmed', bm.bookmarks[0].url === 'http://127.0.0.1:7621/', bm && bm.bookmarks[0]);

  const bad = path.join(TMP, 'bad-bookmarks.json');
  fs.writeFileSync(bad, JSON.stringify({ bookmarks: [{ url: '' }, { title: 42, url: 'https://ok.example' }] }));
  const bmb = await m.run('bookmarks', { path: bad });
  check('bookmarks bad -> ok false, 2 issues', bmb && bmb.ok === false && bmb.issues.length === 2, bmb);
  check('bookmarks keeps the valid row', bmb.bookmarks.length === 1, bmb && bmb.bookmarks);

  const brokenJson = path.join(TMP, 'broken.json');
  fs.writeFileSync(brokenJson, '{not json');
  check('bookmarks bad json -> BAD_JSON', (await m.run('bookmarks', { path: brokenJson })).error === 'BAD_JSON');
  const noArray = path.join(TMP, 'noarray.json');
  fs.writeFileSync(noArray, JSON.stringify({ items: [] }));
  check('bookmarks without array -> BAD_BOOKMARKS', (await m.run('bookmarks', { path: noArray })).error === 'BAD_BOOKMARKS');
  check('bookmarks missing -> READ_FAILED', (await m.run('bookmarks', { path: path.join(TMP, 'nope.json') })).error === 'READ_FAILED');

  // ---- history ----
  const hist = path.join(TMP, 'history.jsonl');
  const histLines = [
    JSON.stringify({ url: 'https://a.example', title: 'A', ts: 1 }),
    '',
    'this-is-not-json',
    JSON.stringify({ title: 'no url' }),
    JSON.stringify({ url: 'https://b.example', title: 'B', ts: 2 }),
    JSON.stringify({ url: 'https://c.example', ts: 3 })
  ];
  fs.writeFileSync(hist, histLines.join('\n'));
  const h = await m.run('history', { path: hist });
  check('history ok', h && h.ok === true, h && h.error);
  check('history total 3 valid rows', h.total === 3 && h.returned === 3, h);
  check('history skipped 2 bad lines', h.skipped === 2, h && h.skipped);
  check('history last keeps order', h.last.length === 3 && h.last[0].url === 'https://a.example' && h.last[2].url === 'https://c.example', h && h.last);
  check('history missing -> READ_FAILED', (await m.run('history', { path: path.join(TMP, 'nope.jsonl') })).error === 'READ_FAILED');

  // ---- plan / unknown ----
  const p = m.plan('inspect', { path: 'x.html' });
  check('plan inspect has 3 steps', p && p.ok === true && p.steps.length === 3, p);
  check('plan inspect warns without path', m.plan('inspect', {}).ok === false);
  check('plan unknown -> UNKNOWN_ACTION', m.plan('ghost', {}).error === 'UNKNOWN_ACTION');
  check('run unknown -> UNKNOWN_ACTION', (await m.run('ghost', {})).error === 'UNKNOWN_ACTION');

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('WEBVIEWER-SMOKE-' + (fail === 0 ? 'PASS ' : 'FAIL ') + pass + '/' + (pass + fail));
  process.exitCode = fail > 0 ? 1 : 0;
})();
