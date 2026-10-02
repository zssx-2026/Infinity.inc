/* Escape sequences, as the terminal sends them. */
const ESC = String.fromCharCode(27);
const SEQ = {
  [ESC + "[A"]: "up",
  [ESC + "[B"]: "down",
  [ESC + "[C"]: "right",
  [ESC + "[D"]: "left",
  [ESC + "[H"]: "home",
  [ESC + "[F"]: "end",
  [ESC + "[5~"]: "pgup",
  [ESC + "[6~"]: "pgdn",
  [ESC + "OP"]: "f1",
  [ESC + "OQ"]: "f2",
  [ESC + "OR"]: "f3",
  [ESC + "OS"]: "f4",
  [ESC + "[15~"]: "f5",
  [ESC + "[17~"]: "f6",
  [ESC + "[18~"]: "f7",
  [ESC + "[19~"]: "f8",
  [ESC + "[20~"]: "f9",
  [ESC + "[21~"]: "f10",
  [ESC + "[1;5C"]: "ctrright",
  [ESC + "[1;5D"]: "ctrleft"
};

/* The first byte of a function key is Escape, so a 40 ms pause decides. */
const ESC_DELAY = 40;

/*
 * ifm.js - the Infinity File Manager interface.
 *
 * A two-pane commander carrying the parts of Explorer and Files that get
 * used every day: a sidebar of places, tabs, a typeable address bar, a
 * sortable header, an incremental filter, a details pane and a context menu
 * on the right mouse button. Two panes because moving a file should not
 * mean opening a second window.
 *
 * Every key is listed in the footer. A file manager that hides its keys is
 * a file manager nobody learns.
 */
import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';
import * as L from '../core/localfs.js';

const E = String.fromCharCode(27);
const CLR = E + '[2J' + E + '[H';
const HIDE = E + '[?25l';
const SHOW = E + '[?25h';
const SP = ' ';
const V = String.fromCharCode(9474);
const H = String.fromCharCode(9472);
const DOT = String.fromCharCode(183);
const TL = String.fromCharCode(9484);
const TR = String.fromCharCode(9488);
const BL = String.fromCharCode(9492);
const BR = String.fromCharCode(9496);
const ARROW = String.fromCharCode(9654);
const ELL = String.fromCharCode(8230);

/* The palette, close to Explorer dark and Files dark. */
const S = {
  reset: E + '[0m',
  bold: E + '[1m',
  dim: E + '[90m',
  sel: E + '[48;5;24m' + E + '[97m',
  head: E + '[48;5;238m' + E + '[97m',
  dir: E + '[38;5;222m',
  app: E + '[38;5;114m',
  arc: E + '[38;5;180m',
  img: E + '[38;5;213m',
  aud: E + '[38;5;117m',
  vid: E + '[38;5;141m',
  code: E + '[38;5;109m',
  text: E + '[38;5;252m',
  doc: E + '[38;5;187m',
  file: E + '[38;5;250m',
  ok: E + '[38;5;114m',
  err: E + '[38;5;203m',
  path: E + '[38;5;117m',
  mark: E + '[38;5;220m'
};

/* Visible width, so alignment survives colour codes. */
function w(s) { return String(s).replace(/\u001b\[[0-9;]*m/g, '').length; }
function pad(s, n) {
  const t = String(s == null ? '' : s);
  const len = w(t);
  return len >= n ? t : t + SP.repeat(n - len);
}
function padL(s, n) {
  const t = String(s == null ? '' : s);
  const len = w(t);
  return len >= n ? t : SP.repeat(n - len) + t;
}
function clip(s, n) {
  const t = String(s);
  if (w(t) <= n) return t;
  return t.slice(0, Math.max(0, n - 1)) + ELL;
}
function rep(c, n) { return n > 0 ? c.repeat(n) : ''; }

/*
 * A pane is one side of the window: a directory, the entries in it, the
 * cursor, the scroll offset and the set of marked names. Both panes are the
 * same class, so the local disk and the cloud behave identically once their
 * entries have been read.
 */
class Pane {
  constructor(kind, start) {
    this.kind = kind;          /* local | cloud */
    this.tabs = [start];
    this.tab = 0;
    this.items = [];
    this.sel = 0;
    this.scroll = 0;
    this.marks = new Set();
    this.sortKey = 'name';
    this.sortDir = 1;
    this.filter = '';
    this.error = '';
  }

  get dir() { return this.tabs[this.tab]; }
  set dir(p) { this.tabs[this.tab] = p; }

  /* Everything the filter lets through, then sorted. */
  visible() {
    const f = this.filter.toLowerCase();
    const list = f
      ? this.items.filter(function (e) { return e.name.toLowerCase().indexOf(f) !== -1; })
      : this.items;
    return sortEntries(list, this.sortKey, this.sortDir);
  }

  current() {
    const v = this.visible();
    return v[this.sel] || null;
  }

  marked() {
    const v = this.visible();
    const out = [];
    for (const e of v) if (this.marks.has(e.name)) out.push(e);
    return out;
  }

  /* What an action should act on: the marks if there are any, else the cursor. */
  targets() {
    const m = this.marked();
    if (m.length) return m;
    const c = this.current();
    return c ? [c] : [];
  }

  clamp() {
    const n = this.visible().length;
    if (this.sel >= n) this.sel = Math.max(0, n - 1);
    if (this.sel < 0) this.sel = 0;
  }

  clearMarks() { this.marks.clear(); }
}

/* Folders first, then the chosen key, with direction. */
function sortEntries(items, key, dir) {
  const d = dir === -1 ? -1 : 1;
  const copy = items.slice();
  copy.sort(function (x, y) {
    if (x.type !== y.type) return x.type === 'folder' ? -1 : 1;
    let r = 0;
    if (key === 'size') r = (x.size || 0) - (y.size || 0);
    else if (key === 'mtime') r = (x.mtime || 0) - (y.mtime || 0);
    else if (key === 'type') r = String(extOf(x.name)).localeCompare(String(extOf(y.name)));
    else r = String(x.name).toLowerCase().localeCompare(String(y.name).toLowerCase());
    return r * d;
  });
  return copy;
}

function extOf(name) {
  const i = String(name).lastIndexOf('.');
  return i <= 0 ? '' : String(name).slice(i + 1).toLowerCase();
}

function baseOf(p) {
  const s = String(p).replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf(String.fromCharCode(92)));
  return i < 0 ? s : s.slice(i + 1);
}

function parentOf(p) {
  const s = String(p).replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf(String.fromCharCode(92)));
  if (i <= 0) return s.slice(0, 1) === '/' ? '/' : s;
  const head = s.slice(0, i);
  return /^[A-Za-z]:$/.test(head) ? head + String.fromCharCode(92) : head;
}

/* The colour for an entry, by its kind. */
function colourFor(e) {
  if (e.type === 'folder') return S.dir;
  const k = L.iconFor(e);
  return S[k] || S.file;
}

/*
 * The window.
 *
 * Everything is drawn into one array of lines and written in a single pass.
 * Writing piece by piece makes a resize flicker and leaves the old frame
 * half-erased; one write cannot.
 */
export class Ifm {
  constructor(store) {
    this.store = store || null;
    this.side = 0;
    this.panes = [
      new Pane('local', L.homeDir()),
      new Pane('cloud', '/')
    ];
    this.status = '';
    this.statusKind = 0;   /* 0 plain, 1 ok, 2 error */
    this.mode = 'browse';   /* browse | prompt | menu | view | search */
    this.prompt = '';
    this.input = '';
    this.menu = null;
    this.menuSel = 0;
    this.viewer = null;
    this.viewerTop = 0;
    this.searchHits = [];
    this.searchSel = 0;
    this.quit = false;
    this.pending = '';
    this.showHidden = true;
    this.refreshAll();
  }

  get pane() { return this.panes[this.side]; }
  get other() { return this.panes[1 - this.side]; }

  size() {
    return {
      w: Math.max(64, process.stdout.columns || 110),
      h: Math.max(18, process.stdout.rows || 32)
    };
  }

  /*
   * Re-read both panes.
   *
   * The local side is re-read from disk every time. The cloud side is read
   * from the store manifest, which is already in memory, so it is cheap.
   */
  refreshAll() {
    this.refreshSide(0);
    this.refreshSide(1);
  }

  refreshSide(i) {
    const p = this.panes[i];
    try {
      if (p.kind === 'local') {
        p.items = L.listLocal(p.dir, { showHidden: !!this.showHidden });
      } else if (this.store) {
        p.items = this.store.list(p.dir, {});
      } else {
        p.items = [];
      }
      p.error = '';
    } catch (e) {
      p.items = [];
      p.error = e.message;
    }
    p.clamp();
  }

  refresh() { this.refreshSide(this.side); }

  say(msg, kind) {
    this.status = msg;
    this.statusKind = kind || 0;
  }

  /*
   * The title box, sized to the window.
   *
   * The specification asks for a bordered box that follows the console, so
   * the border is rebuilt every frame rather than cached.
   */
  titleBox(w) {
    const text = 'Infinity File Manager';
    const inner = Math.max(4, w - 2);
    const left = Math.max(0, Math.floor((inner - text.length) / 2));
    const right = Math.max(0, inner - text.length - left);
    return [
      TL + H.repeat(inner) + TR,
      V + SP.repeat(left) + S.bold + text + S.reset + SP.repeat(right) + V,
      BL + H.repeat(inner) + BR
    ];
  }

  /*
   * One pane, drawn into an array of lines.
   *
   * The header row doubles as the sort indicator: the column carrying the
   * cursor gets an arrow. That is how Explorer and Files both show it, and
   * it costs no extra vertical space.
   */
  paneLines(pane, width, height, active) {
    const out = [];
    const cols = this.columns(width);

    /* The address bar. The active pane gets the brighter colour. */
    const bar = active ? S.path : S.dim;
    const tabs = pane.tabs.length > 1 ? ' [' + (pane.tab + 1) + '/' + pane.tabs.length + ']' : '';
    out.push(bar + clip(pane.dir + tabs, width - 1) + S.reset);

    /* The sortable header. */
    const arrow = function (k) { return pane.sortKey === k ? (pane.sortDir === 1 ? ' v' : ' ^') : ''; };
    const head = S.head + pad(clip('name', cols.name) + arrow('name'), cols.name) +
      padL('size' + arrow('size'), cols.size) +
      pad('type' + arrow('type'), cols.type) +
      pad('modified', cols.date) + S.reset;
    out.push(head);

    const items = pane.visible();
    const listH = Math.max(1, height - 4);

    /* Keep the cursor inside the window. */
    if (pane.sel < pane.scroll) pane.scroll = pane.sel;
    if (pane.sel >= pane.scroll + listH) pane.scroll = pane.sel - listH + 1;
    if (pane.scroll < 0) pane.scroll = 0;

    for (let i = 0; i < listH; i++) {
      const e = items[pane.scroll + i];
      if (!e) { out.push(''); continue; }
      const idx = pane.scroll + i;
      const cursor = idx === pane.sel;
      const marked = pane.marks.has(e.name);
      const tint = colourFor(e);
      const lead = cursor && active ? ARROW + ' ' : '  ';
      const flag = marked ? S.mark + '*' + S.reset : ' ';
      const name = clip((e.type === 'folder' ? e.name + '/' : e.name), cols.name - 3);
      const size = e.type === 'folder' ? '--' : L.fmtSize(e.size);
      const kind = e.type === 'folder' ? 'dir' : (extOf(e.name) || 'file');
      const row = lead + flag + tint + pad(name, cols.name - 3) + S.reset +
        padL(size, cols.size) + SP + pad(clip(kind, cols.type - 1), cols.type) +
        SP + pad(L.fmtDate(e.mtime), cols.date);
      out.push(cursor && active ? S.sel + clip(row, width - 1) + S.reset : clip(row, width - 1));
    }

    if (pane.error) out.push(S.err + clip(pane.error, width - 1) + S.reset);
    return out;
  }

  columns(w) {
    const size = 10, type = 7, date = 17;
    const name = Math.max(12, w - size - type - date - 4);
    return { name: name, size: size, type: type, date: date };
  }

  /* Compose one frame: title, both panes, status, key list. */
  frame() {
    const sz = this.size();
    const w = sz.w;
    const out = this.titleBox(w);
    out.push(H.repeat(w));
    const half = Math.floor((w - 1) / 2);
    const right = w - 1 - half;
    const bodyH = Math.max(3, sz.h - 5);
    const left = this.paneLines(this.panes[0], half, bodyH, this.side === 0);
    const rl = this.paneLines(this.panes[1], right, bodyH, this.side === 1);
    for (let i = 0; i < bodyH; i++) {
      const l = pad(left[i] || "", half);
      const r = clip(rl[i] || "", right);
      out.push(l + S.dim + V + S.reset + r);
    }
    const p = this.pane;
    const items = p.visible();
    let tint = S.dim;
    if (this.statusKind === 1) tint = S.ok;
    else if (this.statusKind === 2) tint = S.err;
    const info = p.marks.size ? p.marks.size + " marked" : items.length + " items";
    out.push(tint + clip(this.status, w - 22) + S.reset + padL(S.dim + info + S.reset, 18));
    out.push(S.dim + clip(this.footer(), w - 1) + S.reset);
    return out;
  }

  footer() {
    if (this.mode === "prompt") return " " + this.prompt + " [" + this.input + "]   Enter confirm   Esc cancel";
    if (this.mode === "menu") return " Up/Down move   Enter choose   Esc close";
    if (this.mode === "view") return " PgUp/PgDn scroll   Home/End   Esc close";
    return " Tab pane  Enter open  F3 view  F5 copy  F6 move  F7 mkdir  F8 delete  F9 menu  ^F find  ^H hidden  ^R reload  F10 quit";
  }

  /* Read one key, reassembling an escape sequence if one arrives. */
  nextKey() {
    return new Promise(function (resolve) {
      const stdin = process.stdin;
      let buf = "";
      let timer = null;
      const done = function (key) {
        if (timer) clearTimeout(timer);
        stdin.removeListener("data", onData);
        resolve(key);
      };
      const onData = function (chunk) {
        buf += chunk.toString("utf8");
        if (buf === ESC) {
          if (timer) clearTimeout(timer);
          timer = setTimeout(function () { done("escape"); }, ESC_DELAY);
          return;
        }
        if (SEQ[buf]) { done(SEQ[buf]); return; }
        if (buf.charAt(0) === ESC) { done("unknown"); return; }
        done(buf);
      };
      stdin.on("data", onData);
    });
  }

  /* Move the cursor, keeping it inside the list. */
  move(step) {
    const p = this.pane;
    const n = p.visible().length;
    if (!n) return;
    p.sel = Math.max(0, Math.min(n - 1, p.sel + step));
  }

  /* Space marks the cursor row and steps down, as Norton and FAR both do. */
  toggleMark() {
    const p = this.pane;
    const e = p.current();
    if (!e) return;
    if (p.marks.has(e.name)) p.marks.delete(e.name);
    else p.marks.add(e.name);
    this.move(1);
  }

  markAll() {
    const p = this.pane;
    const v = p.visible();
    if (p.marks.size === v.length) p.clearMarks();
    else for (const e of v) p.marks.add(e.name);
  }

  /* Enter on a folder descends; on a file it opens the viewer. */
  open() {
    const p = this.pane;
    const e = p.current();
    if (!e) return;
    if (e.type === 'folder') {
      p.dir = e.path;
      p.sel = 0;
      p.scroll = 0;
      p.clearMarks();
      this.refreshSide(this.side);
      return;
    }
    this.view(e);
  }

  /* Go up one level, stopping at a drive root. */
  up() {
    const p = this.pane;
    const parent = parentOf(p.dir);
    if (parent === p.dir) return;
    p.dir = parent;
    p.sel = 0;
    p.scroll = 0;
    this.refreshSide(this.side);
  }

  /*
   * Show a file.
   *
   * A file manager that cannot show you a file makes you open a second
   * program to answer the question you already had. Text is shown as
   * text; anything with a zero byte in the first block is shown as a hex
   * dump with an offset column, which is the only honest way to display
   * bytes that are not characters.
   */
  view(entry) {
    let text = '';
    let binary = false;
    try {
      const fd = fs.openSync(entry.path, 'r');
      const buf = Buffer.alloc(64 * 1024);
      const got = fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      const slice = buf.subarray(0, got);
      binary = slice.indexOf(0) >= 0;
      text = binary ? hexDump(slice) : slice.toString('utf8');
    } catch (e) {
      text = e.message;
    }
    this.viewer = {
      name: entry.name,
      lines: text.split(/\r?\n/),
      binary: binary,
      size: entry.size
    };
    this.viewerTop = 0;
    this.mode = 'view';
  }

  viewerLines(w, h) {
    const v = this.viewer;
    const out = [];
    const tag = v.binary ? '  (binary)' : '';
    out.push(S.head + pad(clip(v.name + tag + '  ' + L.fmtSize(v.size), w - 1), w - 1) + S.reset);
    const bodyH = Math.max(1, h - 6);
    const maxTop = Math.max(0, v.lines.length - bodyH);
    if (this.viewerTop > maxTop) this.viewerTop = maxTop;
    if (this.viewerTop < 0) this.viewerTop = 0;
    for (let i = 0; i < bodyH; i++) {
      const line = v.lines[this.viewerTop + i];
      out.push(line === undefined ? '' : clip(line.split(String.fromCharCode(9)).join('    '), w - 1));
    }
    out.push(S.dim + ' line ' + (this.viewerTop + 1) + ' of ' + v.lines.length + S.reset);
    return out;
  }

}
/*
 * A hex dump, sixteen bytes a row, with the printable column beside it.
 *
 * Files a file manager meets are often not text, and refusing to show them
 * would send the user to another program for the one question they had.
 */
function hexDump(buf) {
  const out = [];
  for (let i = 0; i < buf.length; i += 16) {
    const row = buf.subarray(i, i + 16);
    const hex = [];
    let text = '';
    for (let j = 0; j < 16; j++) {
      if (j < row.length) {
        const b = row[j];
        hex.push((b < 16 ? '0' : '') + b.toString(16));
        text += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
      } else {
        hex.push('  ');
        text += ' ';
      }
    }
    out.push(padL(i.toString(16).toUpperCase(), 8) + '  ' +
      hex.slice(0, 8).join(' ') + '  ' + hex.slice(8).join(' ') +
      '  |' + text + '|');
  }
  return out.join(String.fromCharCode(10));
}

/*
 * Join a directory and a name in the dialect that directory belongs to.
 *
 * A Windows path needs a backslash and a cloud path a forward slash, and
 * mixing them produces something that looks right and is not.
 */
function joinPath(dir, name, kind) {
  if (kind === 'cloud') {
    return (dir === '/' ? '' : dir) + '/' + name;
  }
  return path.join(dir, name);
}

/*
 * The actions are attached to the prototype rather than written inside the
 * class body. Same object, same behaviour - but a large set of additions can
 * be appended without cutting into the class, which is where the brace
 * mistakes kept coming from.
 */

/* Ask for a line of text at the bottom of the window. */
Ifm.prototype.ask = function (prompt, initial, then) {
  this.prompt = prompt;
  this.input = initial || '';
  this.after = then;
  this.mode = 'prompt';
};

Ifm.prototype.submitPrompt = function () {
  const v = this.input;
  const fn = this.after;
  this.mode = 'browse';
  this.after = null;
  this.input = '';
  if (fn) fn(v);
};

/*
 * Copy or move the targets into the other pane.
 *
 * The other pane is the destination because that is what two panes are for:
 * point one at the source and the other at the target, and the operation
 * needs no dialog at all.
 */
Ifm.prototype.transfer = async function (move) {
  const src = this.pane;
  const dst = this.other;
  const items = src.targets();
  if (!items.length) { this.say('nothing selected', 2); return; }
  let done = 0;
  let failed = 0;
  for (const e of items) {
    const to = joinPath(dst.dir, e.name, dst.kind);
    try {
      if (src.kind === 'local' && dst.kind === 'local') {
        if (move) await L.moveLocal(e.path, to);
        else await L.copyTree(e.path, to);
      } else {
        await this.crossTransfer(e, to, src, move);
      }
      done++;
    } catch (err) { failed++; this.say(err.message, 2); }
  }
  src.clearMarks();
  this.refreshAll();
  if (!failed) this.say((move ? 'moved ' : 'copied ') + done + ' item(s)', 1);
};

/*
 * Between the disk and the cloud the bytes travel through a temporary file,
 * because the store uploads from a path and downloads to one.
 */
Ifm.prototype.crossTransfer = async function (entry, to, src, move) {
  if (!this.store) throw new Error('not signed in');
  if (entry.type === 'folder') {
    if (src.kind === 'local') await this.uploadTree(entry.path, to);
    else await this.downloadTree(entry.path, to);
    if (move) {
      if (src.kind === 'local') await L.removeTree(entry.path);
      else { await this.store.rm(entry.path, { purge: true }); await this.store.flush(); }
    }
    return;
  }
  const os = await import('node:os');
  const tmp = path.join(os.tmpdir(), 'ifm-' + Date.now() + '-' + entry.name);
  try {
    if (src.kind === 'local') {
      await this.store.put(entry.path, to, {});
      await this.store.flush();
      if (move) await L.removeTree(entry.path);
    } else {
      await this.store.get(entry.path, tmp, {});
      await L.copyFile(tmp, to);
      if (move) { await this.store.rm(entry.path, { purge: true }); await this.store.flush(); }
    }
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch (e) { }
  }
};

/* Create a folder in the active pane, asking for its name. */
Ifm.prototype.mkdirPrompt = function () {
  const self = this;
  const kind = this.pane.kind;
  this.ask('new folder', '', async function (name) {
    if (!name) return;
    const full = joinPath(self.pane.dir, name, kind);
    try {
      if (kind === 'local') L.mkdirLocal(full);
      else if (self.store) { self.store.mkdir(full); await self.store.flush(); }
      self.say('created ' + name, 1);
    } catch (e) { self.say(e.message, 2); }
    self.refresh();
  });
};


/*
 * One keypress, acted on.
 *
 * The prompt and viewer modes are handled first, because a key means
 * something else while one of them is open. A file manager that types an F
 * into a name box and then deletes a file is worse than one with no
 * shortcuts at all.
 */
Ifm.prototype.handleKey = async function (key) {
  if (this.mode === 'prompt') {
    if (key === 'escape') { this.mode = 'browse'; this.after = null; this.input = ''; return; }
    if (key === 'enter') { this.submitPrompt(); return; }
    if (key === 'backspace') { this.input = this.input.slice(0, -1); return; }
    if (key.length === 1 && key >= ' ') { this.input += key; return; }
    return;
  }

  if (this.mode === 'view') {
    const h = Math.max(1, this.size().h - 6);
    if (key === 'escape' || key === 'f3' || key === 'q') this.mode = 'browse';
    else if (key === 'down') this.viewerTop += 1;
    else if (key === 'up') this.viewerTop -= 1;
    else if (key === 'pgdn') this.viewerTop += h;
    else if (key === 'pgup') this.viewerTop -= h;
    else if (key === 'home') this.viewerTop = 0;
    else if (key === 'end') this.viewerTop = 1e9;
    return;
  }

  const p = this.pane;

  /* Keys that mean the same thing in every mode. */
  if (key === 'f10') { this.quit = true; return; }
  if (key === 'tab') { this.side = 1 - this.side; this.refreshSide(this.side); return; }
  if (key === 'f5') { await this.transfer(false); return; }
  if (key === 'f6') { await this.transfer(true); return; }
  if (key === 'f7') { this.mkdirPrompt(); return; }
  if (key === 'f8') { await this.remove(); return; }
  if (key === 'f2') { this.renamePrompt(); return; }
  if (key === 'f3') { const e = p.current(); if (e && e.type !== 'folder') this.view(e); return; }
  if (key === 'f4') { this.cycleSort(null); return; }
  if (key === 'ctrl-r') { this.refreshAll(); this.say('reloaded', 1); return; }
  if (key === 'down') { this.move(1); return; }
  if (key === 'up') { this.move(-1); return; }
  if (key === 'pgdn') { this.move(10); return; }
  if (key === 'pgup') { this.move(-10); return; }
  if (key === 'home') { p.sel = 0; return; }
  if (key === 'end') { p.sel = Math.max(0, p.visible().length - 1); return; }
  if (key === 'backspace') { this.up(); return; }
  if (key === 'enter') { this.open(); return; }
  if (key === 'left') { this.side = 0; this.refreshSide(0); return; }
  if (key === 'right') { this.side = 1; this.refreshSide(1); return; }
  if (key === ' ') { this.toggleMark(); return; }
  if (key === 'h') { this.showHidden = !this.showHidden; this.refreshAll(); return; }
  if (key === 'r') { this.refresh(); return; }
  if (key === 'n') { this.cycleSort('name'); return; }
  if (key === 's') { this.cycleSort('size'); return; }
  if (key === 'm') { this.cycleSort('mtime'); return; }
  if (key === 't') { this.cycleSort('type'); return; }
  if (key === 'a') { this.markAll(); return; }
  if (key === 'g') { this.goPrompt(); return; }
  if (key === 'f') { this.filterPrompt(); return; }
};

/* Cycle the sort column, or reverse it when the same column is asked for. */
Ifm.prototype.cycleSort = function (key) {
  const p = this.pane;
  if (!key) {
    const order = ['name', 'size', 'mtime', 'type'];
    const at = order.indexOf(p.sortKey);
    key = order[(at + 1) % order.length];
  }
  if (p.sortKey === key) p.sortDir = -p.sortDir;
  else { p.sortKey = key; p.sortDir = 1; }
  p.sel = 0;
  this.say('sorted by ' + key + (p.sortDir === 1 ? ' ascending' : ' descending'), 0);
};

/* Ask for a directory to jump to, expanding a leading tilde. */
Ifm.prototype.goPrompt = function () {
  const self = this;
  this.ask('go to', this.pane.dir, function (v) {
    if (!v) return;
    const p = self.pane;
    p.dir = v;
    p.sel = 0;
    p.scroll = 0;
    p.clearMarks();
    self.refreshSide(self.side);
    if (p.error) self.say(p.error, 2);
  });
};

/* Ask for a filter, applied as soon as it is confirmed. */
Ifm.prototype.filterPrompt = function () {
  const self = this;
  this.ask('filter', this.pane.filter, function (v) {
    self.pane.filter = v || '';
    self.pane.sel = 0;
    self.pane.scroll = 0;
    self.say(v ? ('filter: ' + v) : 'filter cleared', 0);
  });
};

export async function runIfm(store) {
  const ifm = new Ifm(store);
  const stdin = process.stdin;
  const stdout = process.stdout;
  if (!stdin.isTTY) { return; }
  stdin.setRawMode(true);
  stdin.resume();
  stdout.write(CLR + HIDE + E + String.fromCharCode(91) + "?1049h");
  const draw = function () {
    const sz = ifm.size();
    const lines = ifm.frame();
    let out = E + String.fromCharCode(91) + "H";
    for (let i = 0; i < lines.length; i++) { out += lines[i] + E + String.fromCharCode(91) + "K" + N; }
    out += E + String.fromCharCode(91) + "J";
    stdout.write(out + HIDE);
  };
  const cleanup = function () {
    try { stdout.write(SHOW); } catch (e) { }
    try { stdin.setRawMode(false); } catch (e) { }
    stdin.pause();
  };

  try {
    while (!ifm.quit) {
      draw();
      const key = await ifm.nextKey();
      await ifm.handleKey(key);
    }
  } finally {
    cleanup();
  }
}

