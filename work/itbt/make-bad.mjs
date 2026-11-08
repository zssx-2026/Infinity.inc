// make-bad.mjs - craft containers that are valid on the surface but must be refused.
// Run from the repository root; writes into work/itbt/_sandbox.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

mkdirSync('work/itbt/_sandbox', { recursive: true });

const payload = Buffer.from('not really an exe\n');
const sha = createHash('sha256').update(payload).digest();

function u16(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v & 0xffff, 0); return b; }
function u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); return b; }
function u64(v) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v), 0); return b; }

function build(name, exe, entries, { headerBump = 0 } = {}) {
  const head = Buffer.concat([
    Buffer.from('ITBT'), u16(1), u16(0), u32(0), u32(entries.length), u32(0),
    u16(name.length), Buffer.from(name, 'utf8'),
    u16(1), Buffer.from('1', 'utf8'),
    u16(exe.length), Buffer.from(exe, 'utf8'),
  ]);
  const rows = (at) => Buffer.concat(entries.map(e => {
    const p = Buffer.from(e.path, 'utf8');
    return Buffer.concat([u16(p.length), p, u64(at), u64(payload.length),
                          u64(payload.length), e.sha, Buffer.from([0])]);
  }));
  const headerSize = head.length + rows(0).length + headerBump;
  let at = headerSize;
  const tableRows = [];
  for (const e of entries) {
    const p = Buffer.from(e.path, 'utf8');
    tableRows.push(Buffer.concat([u16(p.length), p, u64(at), u64(payload.length),
                                  u64(payload.length), e.sha, Buffer.from([0])]));
    at += payload.length;
  }
  const header = Buffer.from(head);
  header.writeUInt32LE(headerSize, 8);
  header.writeUInt32LE(headerBump ? headerSize + payload.length : at, 16);
  return Buffer.concat([header, ...tableRows, payload]);
}

writeFileSync('work/itbt/_sandbox/evil-path.itbt',
  build('Evil', 'a.exe', [{ path: '../evil.exe', sha }]));
writeFileSync('work/itbt/_sandbox/absolute-path.itbt',
  build('Evil', 'a.exe', [{ path: '/windows/system32/evil.exe', sha }]));
writeFileSync('work/itbt/_sandbox/bad-header.itbt',
  build('Evil', 'a.exe', [{ path: 'a.exe', sha }], { headerBump: 4 }));
console.log('wrote 3 malformed containers into work/itbt/_sandbox');
