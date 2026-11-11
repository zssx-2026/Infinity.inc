import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';

/* README keeps one copy of the release in two languages. The version strings and
 * the installer byte total are the only numbers in it, so they are rewritten
 * from the release directory instead of by hand: a typo in a 9-digit total is
 * exactly the kind of error a reader would not catch. */
const DIR = 'cpp/release/v1.0pre7';
const files = readdirSync(DIR).filter(function (f) { return f.endsWith('.exe'); });
const total = files.reduce(function (n, f) { return n + statSync(DIR + '/' + f).size; }, 0);
const totalText = String(total).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
console.log('installers ' + files.length + ' total ' + total + ' (' + totalText + ')');

const path = 'README.md';
let text = readFileSync(path, 'utf8');
const before = text;

/* The shell first shipped in pre6; only the release this README describes moves.
 * That sentence is rewritten first so the global version swap cannot date it. */
text = text.replace(
  '窗口由**随包的 Electron 外壳**承载（v1.0.0-pre6 起，外壳随安装包一起\n落盘，不依赖系统里的浏览器内核）',
  '窗口由**随包的 Electron 外壳**承载（v1.0.0-pre6 起随安装包落盘，不依赖系统里的浏览器内核；\nv1.0.0-pre7 起外壳自带标签页条、地址栏、应用侧栏与游玩区，产品页面在框内渲染）'
);
text = text.replace(
  'window is hosted by the **bundled Electron shell** (since v1.0.0-pre6, shipped',
  'window is hosted by the **bundled Electron shell** (since v1.0.0-pre6, shipped'
);

text = text.split('v1.0.0-pre6').join('v1.0.0-pre7');
text = text.split('v1.0pre6').join('v1.0pre7');
text = text.split('252,069,312').join(totalText);

if (text === before) { console.log('README unchanged'); }
writeFileSync(path, text, 'utf8');
console.log('README ' + Buffer.byteLength(text) + ' B, lines ' + text.split('\n').length);
console.log('pre7 mentions ' + (text.match(/pre7/g) || []).length + ', pre6 left ' + (text.match(/pre6/g) || []).length);
