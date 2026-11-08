import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const m = (await import('file:///D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/InfinityStudio/src/apps/office.js?v=' + Date.now())).default;

let pass = 0;
let fail = 0;
function check(desc, cond, extra) {
  if (cond) { pass += 1; console.log('ok   ' + desc); }
  else { fail += 1; console.log('FAIL ' + desc + (extra !== undefined ? ' <- ' + JSON.stringify(extra) : '')); }
}

/* 临时目录固定在工作区内（本环境 os.tmpdir() 可能是相对路径）。 */
const TMP = path.resolve('work', 'tmp-office-smoke-' + Date.now());
fs.mkdirSync(TMP, { recursive: true });

(async () => {
  check('module exposes META/capabilities/plan/run', !!m && typeof m.run === 'function' && typeof m.plan === 'function' && typeof m.capabilities === 'function' && !!m.META);

  const cap = m.capabilities();
  check('capabilities implemented + id office', cap && cap.implemented === true && cap.id === 'office', cap);
  check('capabilities 4 features', Array.isArray(cap.features) && cap.features.length === 4, cap.features);
  check('META codecs .md/.csv/.json/.txt', m.META.codecs.map((c) => c.ext).join(',') === '.md,.csv,.json,.txt', m.META.codecs);

  /* ---------------------------------------------------------- outline */
  const md = [
    '# Top',
    'intro',
    '## Section A',
    '```js',
    '# not a heading',
    '```',
    '### Deep ###',
    '~~~',
    '# tilde hidden',
    '~~~',
    '#### Four'
  ].join('\n');
  const mdPath = path.join(TMP, 'doc.md');
  fs.writeFileSync(mdPath, md, 'utf8');

  const out = await m.run('outline', { path: mdPath });
  check('outline ok', out && out.ok === true, out && out.error);
  check('outline finds 4 headings', out.count === 4 && out.headings.length === 4, out && out.headings);
  check('outline levels 1/2/3/4', out.headings.map((h) => h.level).join(',') === '1,2,3,4', out && out.headings.map((h) => h.level));
  check('outline line numbers 1/3/7/11', out.headings.map((h) => h.line).join(',') === '1,3,7,11', out && out.headings.map((h) => h.line));
  check('outline strips trailing hashes', out.headings[2].text === 'Deep', out && out.headings[2]);
  check('outline ignores heading inside backtick fence', !out.headings.some((h) => h.text === 'not a heading'), out && out.headings);
  check('outline ignores heading inside tilde fence', !out.headings.some((h) => h.text === 'tilde hidden'), out && out.headings);
  check('outline counts all 11 lines', out.lines === 11, out && out.lines);
  check('outline missing path -> MISSING_PATH', (await m.run('outline', {})).error === 'MISSING_PATH');
  check('outline missing file -> READ_FAILED', (await m.run('outline', { path: path.join(TMP, 'nope.md') })).error === 'READ_FAILED');
  check('outline on a directory -> READ_FAILED (no throw)', (await m.run('outline', { path: TMP })).error === 'READ_FAILED');

  /* ------------------------------------------------------------ table */
  const csv = [
    'name,note,value',
    'alice,"hello, world",1',
    'bob,"say ""hi""",2'
  ].join('\n');
  const csvPath = path.join(TMP, 'table.csv');
  fs.writeFileSync(csvPath, csv, 'utf8');

  const tab = await m.run('table', { path: csvPath });
  check('table ok', tab && tab.ok === true, tab && tab.error);
  check('table 3 rows / 3 columns', tab.rows === 3 && tab.columns === 3, tab);
  check('table detects comma', tab.delimiter === ',', tab && tab.delimiter);
  check('table header exact', tab.header.join('|') === 'name|note|value', tab && tab.header);
  check('table keeps quoted comma in one field', tab.preview[1][1] === 'hello, world', tab && tab.preview[1]);
  check('table unescapes doubled quotes', tab.preview[2][1] === 'say "hi"', tab && tab.preview[2]);

  const semiPath = path.join(TMP, 'semi.csv');
  fs.writeFileSync(semiPath, 'a;b;c\n1;2;3', 'utf8');
  const semi = await m.run('table', { path: semiPath });
  check('table detects semicolon', semi.ok === true && semi.delimiter === ';' && semi.columns === 3, semi);

  const tabPath = path.join(TMP, 'tab.csv');
  fs.writeFileSync(tabPath, 'x\ty\n1\t2', 'utf8');
  const tabbed = await m.run('table', { path: tabPath });
  check('table reports tab delimiter as tab', tabbed.ok === true && tabbed.delimiter === 'tab' && tabbed.columns === 2, tabbed);

  const crlfPath = path.join(TMP, 'crlf.csv');
  fs.writeFileSync(crlfPath, 'a,b\r\n1,2\r\n', 'utf8');
  const crlf = await m.run('table', { path: crlfPath });
  check('table parses CRLF', crlf.ok === true && crlf.rows === 2 && crlf.preview[1].join('|') === '1|2', crlf);

  const raggedPath = path.join(TMP, 'ragged.csv');
  fs.writeFileSync(raggedPath, 'a,b,c\n1,2', 'utf8');
  const ragged = await m.run('table', { path: raggedPath });
  check('table flags one ragged row', ragged.ok === true && ragged.ragged.length === 1 && Array.isArray(ragged.warnings), ragged);

  const widePath = path.join(TMP, 'wide.csv');
  fs.writeFileSync(widePath, 'a,b\n1,2\n3,4\n5,6\n7,8\n9,10\n11,12', 'utf8');
  const wide = await m.run('table', { path: widePath });
  check('table preview capped at 5 rows', wide.ok === true && wide.rows === 7 && wide.preview.length === 5, wide && wide.preview.length);

  const emptyPath = path.join(TMP, 'empty.csv');
  fs.writeFileSync(emptyPath, '', 'utf8');
  check('table empty file -> EMPTY_TABLE', (await m.run('table', { path: emptyPath })).error === 'EMPTY_TABLE');
  check('table bad delimiter -> BAD_DELIMITER', (await m.run('table', { path: csvPath, delimiter: '|' })).error === 'BAD_DELIMITER');
  check('table missing path -> MISSING_PATH', (await m.run('table', {})).error === 'MISSING_PATH');

  /* --------------------------------------------------------- validate */
  const jsonPath = path.join(TMP, 'obj.json');
  const jsonText = '{"a":1,"b":[2,3]}';
  fs.writeFileSync(jsonPath, jsonText, 'utf8');
  const obj = await m.run('validate', { path: jsonPath });
  check('validate object ok', obj.ok === true && obj.type === 'object', obj);
  check('validate keys in document order', obj.keys.join(',') === 'a,b', obj && obj.keys);
  check('validate byte count matches file', obj.bytes === Buffer.byteLength(jsonText) && obj.bytes === 17, obj && obj.bytes);

  const arrPath = path.join(TMP, 'arr.json');
  fs.writeFileSync(arrPath, '[1,2,3]', 'utf8');
  const arr = await m.run('validate', { path: arrPath });
  check('validate array type + length', arr.ok === true && arr.type === 'array' && arr.length === 3 && arr.keys.length === 0, arr);

  const badPath = path.join(TMP, 'bad.json');
  fs.writeFileSync(badPath, '{"a": }', 'utf8');
  const bad = await m.run('validate', { path: badPath });
  check('validate malformed -> BAD_JSON with message', bad.ok === false && bad.error === 'BAD_JSON' && typeof bad.message === 'string' && bad.message.length > 0, bad);
  check('validate missing path -> MISSING_PATH', (await m.run('validate', {})).error === 'MISSING_PATH');
  check('validate missing file -> READ_FAILED', (await m.run('validate', { path: path.join(TMP, 'nope.json') })).error === 'READ_FAILED');

  /* ------------------------------------------------------------ stats */
  const txtPath = path.join(TMP, 'words.txt');
  const txt = 'Hello world 你好 世界\nsecond line';
  fs.writeFileSync(txtPath, txt, 'utf8');
  const st = await m.run('stats', { path: txtPath });
  check('stats ok', st.ok === true, st && st.error);
  check('stats words 8 (4 latin + 4 CJK)', st.words === 8, st && { words: st.words, cjk: st.cjk, latin: st.latin });
  check('stats splits CJK 4 / latin 4', st.cjk === 4 && st.latin === 4, st && { cjk: st.cjk, latin: st.latin });
  check('stats bytes 37 (25 ASCII + 4x3 CJK)', st.bytes === 37 && st.bytes === Buffer.byteLength(txt), st && st.bytes);
  check('stats lines 2 / chars 29', st.lines === 2 && st.chars === 29, st && { lines: st.lines, chars: st.chars });
  const digest = crypto.createHash('sha256').update(fs.readFileSync(txtPath)).digest('hex');
  check('stats sha256 matches independent hash', st.sha256 === digest, st && st.sha256);

  const zeroPath = path.join(TMP, 'zero.txt');
  fs.writeFileSync(zeroPath, '', 'utf8');
  const zero = await m.run('stats', { path: zeroPath });
  check('stats empty file all zeros', zero.ok === true && zero.bytes === 0 && zero.lines === 0 && zero.words === 0 && zero.chars === 0, zero);

  /* ------------------------------------------------------- plan / run */
  const p = m.plan('outline', { path: 'x.md' });
  check('plan outline ok with 2 steps', p.ok === true && p.action === 'outline' && p.steps.length === 2, p);
  check('plan warns without path', m.plan('outline', {}).ok === false && m.plan('outline', {}).warnings.length === 1);
  check('plan infers action from .csv extension', m.plan('', { path: 'a.csv' }).action === 'table');
  check('plan infers action from .json extension', m.plan('', { path: 'a.json' }).action === 'validate');
  check('plan infers action from .txt extension', m.plan('', { path: 'a.txt' }).action === 'stats');
  check('plan unknown -> UNKNOWN_ACTION', m.plan('ghost', {}).error === 'UNKNOWN_ACTION');
  check('run unknown -> UNKNOWN_ACTION', (await m.run('ghost', {})).error === 'UNKNOWN_ACTION');
  check('run with null input never throws', (await m.run('outline', null)).error === 'MISSING_PATH');
  check('plan is pure (no file created)', !fs.existsSync(path.join(TMP, 'planned.md')));

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('OFFICE-SMOKE-' + (fail === 0 ? 'PASS ' : 'FAIL ') + pass + '/' + (pass + fail));
  process.exitCode = fail > 0 ? 1 : 0;
})();
