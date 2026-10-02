/*
 * tui.js - the full-screen mode.
 *
 * The layout is the one the specification draws: a bordered title, a
 * horizontal rule, a left column of pages and a right pane that changes
 * with the selected page. Every box is redrawn from the terminal size, so
 * resizing the window reflows the whole interface.
 *
 * Arrow keys move, Enter selects, Tab switches pane, Escape goes back.
 * The screen is drawn into one buffer and written in a single call, which
 * is what stops it flickering.
 */
import readline from 'node:readline';
import { t, setLang, LANGS } from '../i18n/i18n.js';
import { load, save, ensureDirs } from '../core/config.js';
import { GitHub, probeProxy } from '../net/github.js';
import { Store } from '../store/store.js';

const ESC = String.fromCharCode(27);
const CLR = ESC + '[2J' + ESC + '[H';
const HIDE = ESC + '[?25l';
const SHOW = ESC + '[?25h';

const PAGES = [
  { id: 'main', key: 'main_menu' },
  { id: 'signin', key: 'sign_in' },
  { id: 'mine', key: 'mine' },
  { id: 'settings', key: 'settings' },
  { id: 'messages', key: 'messages' }
];

function repeat(ch, n) { return n > 0 ? ch.repeat(n) : ''; }

/* Fit a title into a rule of a given width, centred, with the corners. */
function topBorder(width, title) {
  const inner = width - 2;
  const label = title.length > inner ? title.slice(0, inner) : title;
  const left = Math.floor((inner - label.length) / 2);
  const right = inner - label.length - left;
  return String.fromCharCode(9484) + repeat(String.fromCharCode(9472), left) + label + repeat(String.fromCharCode(9472), right) + String.fromCharCode(9484).replace(String.fromCharCode(9484), String.fromCharCode(9488));
}

export class Tui {
  constructor() {
    this.cfg = load('tui');
    this.page = 0;
    this.field = 0;
    this.inputs = { user: '', token: '' };
    this.typing = null;
    this.rows = [];
    this.gh = null;
    this.store = null;
  }

  size() {
    const c = process.stdout.columns || 80;
    const r = process.stdout.rows || 25;
    return { w: Math.max(40, c), h: Math.max(12, r) };
  }

  draw() {
    const s = this.size();
    const out = [CLR + HIDE];
    const title = ' Infinity Cloud [v1.0pre2] ';
    out.push(this.box(s.w, title));
    out.push(String.fromCharCode(9472).repeat(s.w));
    const left = 14;
    const right = s.w - left - 1;
    const body = s.h - 4;
    const lines = this.paneLines(right);
    for (let i = 0; i < body; i++) {
      const nav = i < PAGES.length ? this.navLine(i) : '';
      const pad = repeat(' ', Math.max(0, left - [...nav].length));
      out.push(String.fromCharCode(9474) + pad + nav + String.fromCharCode(9474) + (lines[i] || '').padEnd(right) + String.fromCharCode(9474));
    }
    process.stdout.write(out.join(String.fromCharCode(10)));
  }

  box(width, title) {
    const inner = width - 2;
    const label = title.length > inner ? title.slice(0, inner) : title;
    const left = Math.floor((inner - label.length) / 2);
    const right = inner - label.length - left;
    return String.fromCharCode(9484) + repeat(String.fromCharCode(9472), left) + label + repeat(String.fromCharCode(9472), right) + String.fromCharCode(9488);
  }

  navLine(i) {
    const mark = (i === this.page) ? String.fromCharCode(9654) + ' ' : '  ';
    return mark + t(PAGES[i].key);
  }

  paneLines(width) {
    const page = PAGES[this.page].id;
    if (page === 'main') return this.mainPane(width);
    if (page === 'signin') return this.signinPane(width);
    if (page === 'settings') return this.settingsPane(width);
    if (page === 'mine') return this.minePane(width);
    return this.messagesPane(width);
  }

  mainPane(width) {
    const out = [];
    out.push(' ' + t('search_placeholder') + ': [' + repeat(' ', Math.max(4, width - 20)) + ']');
    out.push('');
    out.push('  ' + [t('col_name'), t('col_size'), t('col_modified')].join('   ') + '');
    for (const e of this.rows) out.push('  ' + e.name + '   ' + e.size + '   ' + e.modified);
    return out;
  }

  signinPane(width) {
    const out = [];
    const field = (label, key) => {
      const v = this.typing === key ? this.inputs[key] : repeat(String.fromCharCode(9608), this.inputs[key].length);
      return '  ' + label + ': [' + v.padEnd(Math.max(4, width - 16)) + ']';
    };
    out.push('  ' + t('sign_in_title'));
    out.push(field(t('username'), 'user'));
    out.push(field(t('token'), 'token'));
    out.push('  [' + (this.cfg.autoLogin ? String.fromCharCode(9608) : ' ') + '] ' + t('auto_login'));
    out.push('  ' + t('forgot_token') + '   ' + t('no_account'));
    return out;
  }

  settingsPane() {
    const out = [];
    out.push('  ' + t('language'));
    for (const l of LANGS) {
      const on = this.cfg.lang === l.code;
      out.push('  ' + (on ? String.fromCharCode(9654) + ' ' : '  ') + l.native);
    }
    out.push('');
    out.push('  ' + t('send_log_opt') + ': ' + (this.cfg.sendLog ? t('on') : t('off')));
    out.push('  ' + t('settings_hint'));
    return out;
  }

  minePane() {
    const out = [];
    out.push('  ' + (this.cfg.user ? t('sign_in_ok') + ' ' + this.cfg.user : t('not_signed_in')));
    out.push('  ' + t('no_repo'));
    return out;
  }

  messagesPane() {
    return ['  ' + t('settings_hint')];
  }

  async signIn() {
    const token = this.inputs.token || this.cfg.token;
    if (!token) return;
    const proxyOn = await probeProxy();
    this.gh = new GitHub(token, proxyOn);
    await this.gh.me();
    await this.gh.verifyIdentity();
    this.cfg.user = this.gh.user.login;
    if (this.cfg.autoLogin) this.cfg.token = token;
    save('tui', this.cfg);
    this.store = new Store(this.gh, this.cfg, function () {});
  }

  key(str, key) {
    if (key.ctrl && key.name === 'c') { this.quit(); return; }
    if (this.typing) {
      if (key.name === 'return') { this.typing = null; return; }
      if (key.name === 'backspace') { this.inputs[this.typing] = this.inputs[this.typing].slice(0, -1); return; }
      if (str && str.length === 1 && str >= ' ') this.inputs[this.typing] += str;
      return;
    }
    if (key.name === 'up') this.page = (this.page + PAGES.length - 1) % PAGES.length;
    else if (key.name === 'down') this.page = (this.page + 1) % PAGES.length;
    else if (key.name === 'return') {
      const id = PAGES[this.page].id;
      if (id === 'signin') this.typing = this.field === 0 ? 'user' : 'token';
      if (id === 'settings') {
        const i = LANGS.findIndex((l) => l.code === this.cfg.lang);
        this.cfg.lang = LANGS[(i + 1) % LANGS.length].code;
        setLang(this.cfg.lang);
        save('tui', this.cfg);
      }
    } else if (key.name === 'tab') this.field = (this.field + 1) % 2;
  }

  quit() {
    process.stdout.write(SHOW + CLR);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.exit(0);
  }

  async run() {
    ensureDirs();
    if (this.cfg.lang) setLang(this.cfg.lang);
    if (!process.stdin.isTTY) { console.log('Infinity Cloud needs an interactive terminal for TUI mode.'); return; }
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.on('keypress', (str, key) => { this.key(str, key || {}); this.draw(); });
    process.stdout.on('resize', () => this.draw());
    this.draw();
  }
}

export async function runTui() {
  const tui = new Tui();
  await tui.run();
}

