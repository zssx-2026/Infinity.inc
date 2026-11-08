/**
 * itbt-verify.mjs - 独立 .itbt 容器校验器（Node 侧互证，按 work/ITBT-FORMAT.md 实现）。
 * 用法: node work/itbt-verify.mjs <file.itbt>
 * 输出: 每条 entry 的校验结果 + ITBT-VERIFY-PASS/FAIL 汇总；失败 exitCode=1。
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const file = process.argv[2];
if (!file) { console.error('用法: node work/itbt-verify.mjs <file.itbt>'); process.exit(2); }
const buf = fs.readFileSync(file);
let pass = 0, fail = 0;
function ok(d, cond, extra) { if (cond) { pass++; console.log('ok   ' + d); } else { fail++; console.log('FAIL ' + d + (extra ? ' <- ' + extra : '')); } }

// header
ok('size>=20', buf.length >= 20);
ok('magic ITBT', buf.subarray(0, 4).toString('latin1') === 'ITBT', buf.subarray(0, 4).toString('latin1'));
const version = buf.readUInt16LE(4);
const flags = buf.readUInt16LE(6);
const headerSize = buf.readUInt32LE(8);
const entryCount = buf.readUInt32LE(12);
const totalSize = buf.readUInt32LE(20 - 4 + 4); // offset 20 = u32 totalSize? 规范: offset 16 u32 totalSize
// 规范: offset 16 u32 totalSize; 重新按规范读
const total2 = buf.readUInt32LE(16);
ok('version=1', version === 1, String(version));
ok('totalSize=文件长度', total2 === buf.length, total2 + ' vs ' + buf.length);
let p = 20;
function rdStr() { const n = buf.readUInt16LE(p); p += 2; const s = buf.subarray(p, p + n).toString('utf8'); p += n; return s; }
const name = rdStr(), ver = rdStr(), exe = rdStr();
console.log('plugin: ' + name + ' v' + ver + ' exe=' + exe + ' flags=' + flags + ' headerSize=' + headerSize + ' entries=' + entryCount);
const entries = [];
for (let i = 0; i < entryCount; i++) {
  const pathLen = buf.readUInt16LE(p); p += 2;
  const epath = buf.subarray(p, p + pathLen).toString('utf8'); p += pathLen;
  const off = Number(buf.readBigUInt64LE(p)); p += 8;
  const stored = Number(buf.readBigUInt64LE(p)); p += 8;
  const raw = Number(buf.readBigUInt64LE(p)); p += 8;
  const sha = buf.subarray(p, p + 32).toString('hex'); p += 32;
  const comp = buf[p]; p += 1;
  entries.push({ epath, off, stored, raw, sha, comp });
  ok('entry[' + i + '] 相对路径', !epath.includes('..') && !/^[a-zA-Z]:/.test(epath) && !epath.startsWith('/'), epath);
}
ok('headerSize=entry表结束位置', p === headerSize, p + ' vs ' + headerSize);
let prevEnd = headerSize;
for (const e of entries) {
  ok('entry[' + e.epath + '] offset连续', e.off === prevEnd, e.off + ' vs ' + prevEnd);
  const content = buf.subarray(e.off, e.off + e.stored);
  const digest = crypto.createHash('sha256').update(content).digest('hex');
  ok('entry[' + e.epath + '] sha256', digest === e.sha, digest);
  ok('entry[' + e.epath + '] store模式 raw=stored', e.comp === 0 ? e.raw === content.length : true, e.raw + ' vs ' + content.length);
  prevEnd = e.off + e.stored;
}
ok('payload 到文件尾', prevEnd === buf.length, prevEnd + ' vs ' + buf.length);
ok('item.json 在容器内', entries.some(e => e.epath === 'item.json'));
console.log('ITBT-VERIFY-' + (fail === 0 ? 'PASS ' : 'FAIL ') + pass + '/' + (pass + fail));
process.exitCode = fail > 0 ? 1 : 0;
