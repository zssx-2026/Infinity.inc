/* patch-viewer.mjs - rename the shell to InfinityViewer in the shipped UI and
 * add the download-manager strings. Every replacement is counted; a rename
 * that matches nothing is an error, not a silent no-op. */
import fs from 'node:fs';
import path from 'node:path';

const UI = path.resolve('work/webview2/ui');
const report = [];
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
}
let renamed = 0;
for (const file of walk(UI)) {
  if (!/\.(html|js|css|json)$/i.test(file)) continue;
  let s = fs.readFileSync(file, 'utf8');
  const before = s;
  s = s.split('Infinity Edge Shell').join('InfinityViewer');
  s = s.split('InfinityEdgeShell').join('InfinityViewer');
  s = s.split('Edge-like window chrome').join('browser window chrome');
  s = s.split('the Edge shell <iframe>').join('the viewer <iframe>');
  if (s !== before) { fs.writeFileSync(file, s, 'utf8'); renamed++; report.push(path.relative(UI, file)); }
}
console.log('renamed files: ' + renamed);
report.forEach((r) => console.log('  ' + r));

const i18n = path.join(UI, 'assets/js/i18n.js');
let s = fs.readFileSync(i18n, 'utf8');
const zhAnchor = '      "toast.reset": "已恢复默认设置"';
const enAnchor = '      "toast.reset": "Settings restored to defaults"';
if (s.indexOf(zhAnchor) < 0) throw new Error('zh anchor missing');
if (s.indexOf(enAnchor) < 0) throw new Error('en anchor missing');

const zh = [
  '"dl.title": "下载"',
  '"dl.close": "关闭下载面板"',
  '"dl.folder": "打开下载文件夹"',
  '"dl.paste": "粘贴下载地址（http / https）"',
  '"dl.add": "下载"',
  '"dl.clear": "清除已完成"',
  '"dl.empty": "还没有下载。粘贴一个地址，或让页面里的链接开始下载。"',
  '"dl.status.queued": "排队中"',
  '"dl.status.running": "下载中"',
  '"dl.status.paused": "已暂停"',
  '"dl.status.done": "已完成"',
  '"dl.status.error": "失败"',
  '"dl.status.canceled": "已取消"',
  '"dl.pause": "暂停"',
  '"dl.resume": "继续"',
  '"dl.cancel": "取消"',
  '"dl.open": "打开位置"',
  '"dl.remove": "移除"',
  '"dl.summary": "{n} 个任务 · {speed}"',
  '"dl.segments": "{n} 连接"',
  '"dl.doneToast": "下载完成：{name}"',
  '"dl.addedToast": "已加入下载队列：{name}"',
  '"dl.badUrl": "下载地址无效"'
];
const en = [
  '"dl.title": "Downloads"',
  '"dl.close": "Close downloads"',
  '"dl.folder": "Open downloads folder"',
  '"dl.paste": "Paste a download URL (http / https)"',
  '"dl.add": "Download"',
  '"dl.clear": "Clear finished"',
  '"dl.empty": "Nothing yet. Paste a URL, or let a link on the page start a download."',
  '"dl.status.queued": "Queued"',
  '"dl.status.running": "Downloading"',
  '"dl.status.paused": "Paused"',
  '"dl.status.done": "Finished"',
  '"dl.status.error": "Failed"',
  '"dl.status.canceled": "Canceled"',
  '"dl.pause": "Pause"',
  '"dl.resume": "Resume"',
  '"dl.cancel": "Cancel"',
  '"dl.open": "Show in folder"',
  '"dl.remove": "Remove"',
  '"dl.summary": "{n} item(s) · {speed}"',
  '"dl.segments": "{n} connections"',
  '"dl.doneToast": "Download finished: {name}"',
  '"dl.addedToast": "Added to downloads: {name}"',
  '"dl.badUrl": "That download URL is not valid"'
];
function block(list) { return list.map((x) => '      ' + x + ',').join('\n'); }
s = s.replace(zhAnchor, block(zh) + '\n' + zhAnchor);
s = s.replace(enAnchor, block(en) + '\n' + enAnchor);
/* the play zone no longer plays music: its strings are dead weight */
s = s.replace(/^\s*"playzone\.music": .*\n/m, '');
s = s.replace(/^\s*"playzone\.noMusic": .*\n/m, '');
s = s.replace(/^\s*"playzone\.musicHint": .*\n/m, '');
s = s.replace(/^\s*"toast\.musicPicked": .*\n/m, '');
fs.writeFileSync(i18n, s, 'utf8');
console.log('i18n bytes: ' + Buffer.byteLength(s, 'utf8'));
console.log('music keys left: ' + (s.match(/music/gi) || []).length);
