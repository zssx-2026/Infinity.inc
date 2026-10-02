/*
 * ifm.js - Infinity File Manager.
 *
 * A two-pane commander: local disk on the left, the cloud on the right, F5
 * copies between them. Two panes beat one because moving a file should not
 * require opening a second window. The chrome follows Explorer and Files:
 * an address bar, a sortable header, a status bar with counts and sizes.
 */
import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';
import * as M from './fs-model.js';

const E = String.fromCharCode(27);
const CLR = E + '[2J' + E + '[H';
const HIDE = E + '[?25l';
const SHOW = E + '[?25h';
const SP = String.fromCharCode(32);
const V = String.fromCharCode(9474);
const H = String.fromCharCode(9472);

const S = {
  reset: E + '[0m',
  bold: E + '[1m',
  dim: E + '[90m',
  bar: E + '[48;5;236m',
  sel: E + '[48;5;24m' + E + '[97m',
  head: E + '[48;5;238m' + E + '[97m',
  folder: E + '[38;5;222m',
  file: E + '[38;5;252m',
  ok: E + '[38;5;114m',
  err: E + '[38;5;203m',
  path: E + '[38;5;117m'
};

function pad(s, n) { const t = String(s); return t.length >= n ? t.slice(0, n) : t + SP.repeat(n - t.length); }
function padL(s, n) { const t = String(s); return t.length >= n ? t : SP.repeat(n - t.length) + t; }
function rep(c, n) { return n > 0 ? c.repeat(n) : ''; }

export class Ifm {
  constructor(store) {
    this.store = store || null;
    this.side = 0;
    this.local = M.homeDir();
    this.cloud = '/';
    this.lItems = []; this.cItems = [];
    this.lSel = 0; this.cSel = 0;
    this.lScroll = 0; this.cScroll = 0;
    this.lMark = new Set(); this.cMark = new Set();
    this.sortKey = 'name'; this.sortDir = 1;
    this.showHidden = false;
    this.status = ''; this.statusKind = 0;
    this.typing = false; this.input = '';
    this.quit = false;
    this.refreshLocal();
    this.refreshCloud();
  }

  size() {
    return { w: Math.max(60, process.stdout.columns || 100), h: Math.max(16, process.stdout.rows || 30) };
  }

  refreshLocal() {
    const all = M.listLocal(this.local);
    this.lItems = M.sortEntries(all.filter((e) => this.showHidden || e.name.charAt(0) !== '.'));
    this.applySort(this.lItems);
    if (this.lSel >= this.lItems.length) this.lSel = Math.max(0, this.lItems.length - 1);
  }

  refreshCloud() {
    if (!this.store) { this.cItems = []; return; }
    const raw = this.store.list(this.cloud, {}).map((e) => ({
      name: e.name, path: e.path, type: e.type, size: e.size || 0,
      modified: e.modified, created: e.created, hash: e.hash
    }));
    this.cItems = M.sortEntries(raw);
    this.applySort(this.cItems);
    if (this.cSel >= this.cItems.length) this.cSel = Math.max(0, this.cItems.length - 1);
  }

  applySort(items) {
    const k = this.sortKey, d = this.sortDir;
    items.sort(function (a, b) {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      if (k === 'size') return (a.size - b.size) * d;
      if (k === 'modified') return ((a.modified || 0) - (b.modified || 0)) * d;
      return a.name.localeCompare(b.name) * d;
    });
  }

  active() { return this.side === 0 ? this.lItems : this.cItems; }
  activeSel() { return this.side === 0 ? this.lSel : this.cSel; }
  setSel(v) { if (this.side === 0) this.lSel = v; else this.cSel = v; }
  activeDir() { return this.side === 0 ? this.local : this.cloud; }
  marks() { return this.side === 0 ? this.lMark : this.cMark; }
  say(msg, kind) { this.status = msg; this.statusKind = kind || 0; }

  draw() {
    const s = this.size();
    const out = [CLR + HIDE];
    out.push(this.titleBar(s.w));
    out.push(this.addressBar(s.w));
    out.push(this.headerRow(s.w));
    const listH = s.h - 7;
    for (let i = 0; i < listH; i++) out.push(this.row(s.w, i));
    out.push(this.detailLine(s.w));
    out.push(this.functionBar(s.w));
    out.push(this.statusBar(s.w));
    process.stdout.write(out.join(String.fromCharCode(10)));
  }

  titleBar(w) {
    const t = ' Infinity File Manager ';
    const mode = this.store ? 'cloud connected' : 'cloud offline';
    const left = Math.max(0, Math.floor((w - 2 - t.length) / 2));
    const right = Math.max(0, w - 2 - t.length - left);
    return S.head + String.fromCharCode(9484) + rep(H, left) + S.bold + t + S.reset + S.head + rep(H, right) + String.fromCharCode(9488) + S.dim + SP + mode + SP + S.reset;
  }

  addressBar(w) {
    let bar = SP;
    if (this.typing) bar += S.path + this.input + S.reset + String.fromCharCode(9608);
    else if (this.side === 0) bar += S.path + this.local + S.reset;
    else bar += S.path + 'inc://' + this.cloud + S.reset;
    return S.bar + pad(bar, w) + S.reset;
  }

  headerRow(w) {
    const half = Math.floor((w - 3) / 2);
    const arrow = (k) => this.sortKey === k ? (this.sortDir > 0 ? String.fromCharCode(9650) : String.fromCharCode(9660)) : SP;
    const one = SP + pad('Name' + arrow('name'), half - 13) + padL('Size' + arrow('size'), 10) + SP;
    return S.head + pad(one, half) + V + pad(one, half) + S.reset;
  }

  row(w, i) {
    const half = Math.floor((w - 3) / 2);
    const left = this.cell(this.lItems, this.lSel, this.lScroll, i, half, this.side === 0, this.lMark);
    const right = this.cell(this.cItems, this.cSel, this.cScroll, i, half, this.side === 1, this.cMark);
    return left + S.dim + V + S.reset + right;
  }

  cell(items, sel, scroll, i, width, isActive, marks) {
    const idx = scroll + i;
    if (idx >= items.length) return S.bar + rep(SP, width) + S.reset;
    const e = items[idx];
    const tag = M.iconFor(e);
    const name = pad(e.name, width - 14);
    const size = e.type === 'folder' ? '     <DIR>' : padL(M.fmtSize(e.size), 10);
    const line = tag + SP + name + SP + size + SP;
    let style = e.type === 'folder' ? S.folder : S.file;
    if (isActive && idx === sel) style = S.sel;
    else if (isActive && marks.has(e.name)) style = S.bar + S.ok;
    return style + pad(line, width) + S.reset;
  }

  detailLine(w) {
    const e = this.active()[this.activeSel()];
    let text = SP;
    if (e) {
      text += (e.type === 'folder' ? 'Folder' : M.fmtSize(e.size)) + '   ' + M.fmtDate(e.modified);
      if (e.hash) text += '   ' + e.hash.slice(0, 16);
    }
    return S.bar + S.dim + pad(text, w) + S.reset;
  }

  functionBar(w) {
    const k = this.side === 0
      ? ' F3 View   F5 Copy >   F6 Move >   F7 Mkdir   F8 Delete   F10 Quit'
      : ' F3 View   F5 Copy <   F6 Move <   F7 Mkdir   F8 Delete   F10 Quit';
    return S.head + pad(k, w) + S.reset;
  }

  statusBar(w) {
    const items = this.active();
    const bytes = items.reduce((n, e) => n + (e.size || 0), 0);
    const marks = this.marks();
    const picked = marks.size ? marks.size + ' selected' : 'none selected';
    const msg = this.status || (items.length + ' items   ' + M.fmtSize(bytes) + '   ' + picked);
    const style = this.statusKind === 2 ? S.err : (this.statusKind === 1 ? S.ok : S.dim);
    return style + pad(SP + msg, w) + S.reset;
  }

  navigate(e) {
    if (!e) return;
    if (e.type !== 'folder') { this.say(e.name + '   ' + M.fmtSize(e.size) + '   ' + M.fmtDate(e.modified)); return; }
    if (this.side === 0) { this.local = e.path; this.lSel = 0; this.lScroll = 0; this.refreshLocal(); }
    else { this.cloud = e.path; this.cSel = 0; this.cScroll = 0; this.refreshCloud(); }
    this.say('');
  }

  goUp() {
    if (this.side === 0) {
      const up = M.parentLocal(this.local);
      if (up) { this.local = up; this.lSel = 0; this.lScroll = 0; this.refreshLocal(); }
    } else {
      const parts = this.cloud.split('/').filter((x) => x);
      parts.pop();
      this.cloud = '/' + parts.join('/');
      this.cSel = 0; this.cScroll = 0; this.refreshCloud();
    }
  }

  async transfer(move) {
    const from = this.side;
    const items = this.active();
    const marks = this.marks();
    const picked = marks.size ? items.filter((e) => marks.has(e.name)) : (items[this.activeSel()] ? [items[this.activeSel()]] : []);
    if (!picked.length) { this.say('nothing to copy', 2); return; }
    if (!this.store) { this.say('cloud is offline', 2); return; }
    let done = 0;
    for (const e of picked) {
      if (e.type !== 'file') { this.say('folders are not transferred yet: ' + e.name, 2); continue; }
      try {
        if (from === 0) {
          const cp = (this.cloud === '/' ? '' : this.cloud) + '/' + e.name;
          this.say('uploading ' + e.name);
          await this.store.put(e.path, cp, {}, (i, n) => this.say('uploading ' + e.name + ' ' + Math.floor((i / n) * 100) + '%'));
        } else {
          const out = M.uniqueName(this.local, e.name);
          this.say('downloading ' + e.name);
          await this.store.get(e.path, path.join(this.local, out), {}, (i, n) => this.say('downloading ' + e.name + ' ' + Math.floor((i / n) * 100) + '%'));
        }
        if (move) await this.store.rm(e.path);
        done++;
      } catch (err) { this.say('failed on ' + e.name + ': ' + err.message, 2); }
    }
    if (from === 0 && done) await this.store.flush();
    this.lMark.clear(); this.cMark.clear();
    this.refreshLocal(); this.refreshCloud();
    if (done) this.say((move ? 'moved ' : 'copied ') + done + ' item(s)', 1);
  }

  mkdir() {
    if (this.side === 0) {
      const uniq = M.uniqueName(this.local, 'New folder');
      try { fs.mkdirSync(path.join(this.local, uniq)); this.refreshLocal(); this.say('created ' + uniq, 1); }
      catch (e) { this.say(e.message, 2); }
    } else if (this.store) {
      this.store.mkdir((this.cloud === '/' ? '' : this.cloud) + '/New folder');
      this.refreshCloud();
      this.say('created New folder', 1);
    }
  }

  async remove() {
    const items = this.active();
    const marks = this.marks();
    const picked = marks.size ? items.filter((e) => marks.has(e.name)) : (items[this.activeSel()] ? [items[this.activeSel()]] : []);
    if (!picked.length) { this.say('nothing to delete', 2); return; }
    let n = 0;
    for (const e of picked) {
      try { if (this.side === 0) n += M.removeTree(e.path); else if (this.store) { await this.store.rm(e.path); n++; } }
      catch (err) { this.say(err.message, 2); }
    }
    if (this.side === 1 && this.store) await this.store.flush();
    this.lMark.clear(); this.cMark.clear();
    this.refreshLocal(); this.refreshCloud();
    this.say('deleted ' + n + ' item(s)', 1);
  }

  async key(str, key) {
    const k = key || {};
    if (k.ctrl && k.name === 'c') { this.quit = true; return; }
    if (this.typing) {
      if (k.name === 'return') {
        const v = this.input.trim();
        this.typing = false;
        if (v) { if (this.side === 0) { this.local = v; this.refreshLocal(); } else { this.cloud = v; this.refreshCloud(); } }
        this.draw(); return;
      }
      if (k.name === 'escape') { this.typing = false; this.draw(); return; }
      if (k.name === 'backspace') { this.input = this.input.slice(0, -1); this.draw(); return; }
      if (str && str.length === 1 && str >= SP) { this.input += str; this.draw(); }
      return;
    }

    const items = this.active();
    let sel = this.activeSel();

    if (k.name === 'tab') this.side = this.side === 0 ? 1 : 0;
    else if (k.name === 'up') sel = Math.max(0, sel - 1);
    else if (k.name === 'down') sel = Math.min(items.length - 1, sel + 1);
    else if (k.name === 'pageup') sel = Math.max(0, sel - 15);
    else if (k.name === 'pagedown') sel = Math.min(items.length - 1, sel + 15);
    else if (k.name === 'home') sel = 0;
    else if (k.name === 'end') sel = Math.max(0, items.length - 1);
    else if (k.name === 'return') this.navigate(items[sel]);
    else if (k.name === 'backspace') this.goUp();
    else if (k.name === 'space') {
      const marks = this.marks();
      const e = items[sel];
      if (e) { if (marks.has(e.name)) marks.delete(e.name); else marks.add(e.name); }
      sel = Math.min(items.length - 1, sel + 1);
    }
    else if (k.name === 'f3') { const e = items[sel]; if (e) this.navigate(e); }
    else if (k.name === 'f5') await this.transfer(false);
    else if (k.name === 'f6') await this.transfer(true);
    else if (k.name === 'f7') this.mkdir();
    else if (k.name === 'f8') await this.remove();
    else if (k.name === 'f10') { this.quit = true; return; }
    else if (str === 'c') { this.sortKey = 'name'; this.sortDir = -this.sortDir; this.refreshLocal(); this.refreshCloud(); }
    else if (str === 's') { this.sortKey = 'size'; this.sortDir = -this.sortDir; this.refreshLocal(); this.refreshCloud(); }
    else if (str === 'd') { this.sortKey = 'modified'; this.sortDir = -this.sortDir; this.refreshLocal(); this.refreshCloud(); }
    else if (str === 'h') { this.showHidden = !this.showHidden; this.refreshLocal(); }
    else if (str === 'g') { this.typing = true; this.input = this.activeDir(); }
    else if (str === 'r') { this.refreshLocal(); this.refreshCloud(); this.say('refreshed', 1); }

    this.setSel(sel);
    const view = this.size().h - 7;
    if (this.side === 0) {
      if (this.lSel < this.lScroll) this.lScroll = this.lSel;
      if (this.lSel >= this.lScroll + view) this.lScroll = this.lSel - view + 1;
    } else {
      if (this.cSel < this.cScroll) this.cScroll = this.cSel;
      if (this.cSel >= this.cScroll + view) this.cScroll = this.cSel - view + 1;
    }
    this.draw();
  }

  async run() {
    if (!process.stdin.isTTY) { console.log('Infinity File Manager needs an interactive terminal.'); return; }
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.on('keypress', (str, key) => {
      this.key(str, key || {}).then(() => { if (this.quit) this.stop(); }).catch(() => { if (this.quit) this.stop(); });
    });
    process.stdout.on('resize', () => this.draw());
    this.draw();
  }

  stop() {
    process.stdout.write(SHOW + CLR);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.exit(0);
  }
}

export async function runIfm(store) {
  await new Ifm(store).run();
}
