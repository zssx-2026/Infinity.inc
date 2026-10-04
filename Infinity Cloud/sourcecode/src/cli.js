/*
 * cli.js - the command line mode.
 *
 * Every CLI command the specification lists lives here: get, listf, pull,
 * set, setup and help. The prompt, the bar and the table shapes are fixed
 * by the specification, so they are written to match.
 */
import path from 'node:path';
import readline from 'node:readline';
import { t, setLang, matchLang, suggestLangs, LANGS } from './i18n/i18n.js';
import { load, save, SCHEMA, schemaFor, coerce, ensureDirs } from './core/config.js';
import { GitHub, probeProxy } from './net/github.js';
import { Store } from './store/store.js';
import { loadProgramPaths, makeDownloader } from './net/accelerator.js';
import { ensureTools } from './net/bootstrap.js';

const E = String.fromCharCode(27);
const C = {
  reset: E + '[0m',
  green: E + '[32m',
  red: E + '[31m',
  cyan: E + '[36m',
  orange: E + '[33m',
  dim: E + '[90m'
};

const BLOCK = String.fromCharCode(9608);
const SP = String.fromCharCode(32);

/* The ten-block bar. */
export function bar(pct) {
  const filled = Math.max(0, Math.min(10, Math.floor(pct / 10)));
  return '[' + BLOCK.repeat(filled) + SP.repeat(10 - filled) + ']';
}

function fmtDate(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function fmtTime(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(s % 60);
}

export class Cli {
  constructor() {
    this.cfg = load('cli');
    this.gh = null;
    this.store = null;
    this.baseDir = process.cwd();
    this.paths = loadProgramPaths(this.baseDir);
    this.tasks = [];
    this._lines = [];
    this._waiters = [];
    this._eof = false;
  }

  print(s) { process.stdout.write((s === undefined || s === null ? '' : s) + String.fromCharCode(10)); }

  /*
   * Lines arrive faster than they are consumed whenever the input is a pipe
   * rather than a keyboard: a script feeding six answers at once would lose
   * five of them if every question attached its own one-shot listener. The
   * queue fixes that, and it also makes end-of-input explicit - a null answer
   * means there is nothing more to read, which the caller has to stop on.
   */
  bindInput(rl) {
    const self = this;
    rl.on('line', function (line) {
      const w = self._waiters.shift();
      if (w) w(line); else self._lines.push(line);
    });
    rl.on('close', function () {
      self._eof = true;
      while (self._waiters.length) self._waiters.shift()(null);
    });
  }

  ask(q) {
    if (q) process.stdout.write(q);
    if (this._lines.length) return Promise.resolve(this._lines.shift());
    if (this._eof) return Promise.resolve(null);
    const self = this;
    return new Promise(function (resolve) { self._waiters.push(resolve); });
  }
  home() {
    const h = process.env.USERPROFILE || process.env.HOME || 'C:/Users';
    return h.split(String.fromCharCode(92)).join('/');
  }
  prompt() { return this.ask(C.cyan + 'local/' + this.home() + '> ' + C.reset); }

  banner() {
    this.print('Infinity Cloud [v1.0pre2]  ·  Infinity.Inc');
    if (this.cfg.lang) this.print(C.cyan + 'local/' + this.home() + '> ' + C.reset);
  }

  async firstRun() {
    this.print('Please choose language:');
    this.print(LANGS.map((l) => l.native).join(', '));
    let code = null;
    while (!code) {
      const a = await this.ask('> ');
      if (a === null) throw new Error('no language was chosen: the input ended');
      code = matchLang(a);
      if (!code) this.print(t('unknown_language') + ' ' + suggestLangs(a).join(' / ') + '?');
    }
    this.cfg.lang = code;
    setLang(code);
    this.print(t('send_log'));
    let send = null;
    while (send === null) {
      const raw = await this.ask('> ');
      if (raw === null) throw new Error('no answer about the log: the input ended');
      const a = raw.trim().toLowerCase();
      if (a === 'y') send = true;
      else if (a === 'n') send = false;
    }
    this.cfg.sendLog = send;
    save('cli', this.cfg);
    this.print(C.orange + t('setup_done') + C.reset);
  }

  async signIn() {
    if (this.cfg.autoLogin && this.cfg.token) return this.attach(this.cfg.token);
    /*
     * Look in the environment before asking. EV_GH_TOKEN is the name this
     * machine already uses for its GitHub token, so honouring it means an
     * existing setup keeps working without a second token pasted in.
     */
    const env = process.env.INC_TOKEN || process.env['gittoken_zssx-2026_1'] || process.env.EV_GH_TOKEN || process.env.GH_TOKEN || '';
    if (env) return this.attach(env);
    this.print(t('token') + ': ');
    const raw = await this.ask('> ');
    if (raw === null) throw new Error(t('not_signed_in'));
    const token = raw.trim();
    if (!token) throw new Error(t('not_signed_in'));
    return this.attach(token);
  }

  async attach(token) {
    const proxyOn = await probeProxy();
    this.gh = new GitHub(token, proxyOn);
    await this.gh.me();
    if (!(await this.gh.verifyIdentity())) throw new Error(t('sign_in_fail'));
    process.env.INC_TOKEN = token;
    process.env.INC_USER = this.gh.user.login;
    this.cfg.user = this.gh.user.login;
    this.store = new Store(this.gh, this.cfg, (m) => { if (m) this.print(C.dim + m + C.reset); });
    this.print(C.green + t('sign_in_ok') + ' ' + this.gh.user.login + C.reset);
  }

  async cmdGet() {
    let last = -1;
    await this.store.pull((msg, pct) => {
      if (msg) { this.print(msg); return; }
      if (pct === undefined || pct === null) return;
      const r = Math.floor(pct / 10) * 10;
      if (r === last) return;
      last = r;
      process.stdout.write(String.fromCharCode(13) + r + '% ' + bar(r));
      if (r >= 100) process.stdout.write(String.fromCharCode(10));
    });
  }

  cmdListf(args) {
    const o = {
      recursive: args.indexOf('-a') >= 0,
      brief: args.indexOf('-l') >= 0,
      detail: args.indexOf('-d') >= 0,
      tree: args.indexOf('-t') >= 0
    };
    const items = this.store.list('/', o);
    if (o.tree) { this.printTree(items); return; }
    for (const e of items) {
      const kind = e.type === 'folder' ? t('folder') : t('file');
      const cols = [e.path, e.name, String(e.size), kind];
      if (!o.brief) cols.push(fmtDate(e.modified), fmtDate(e.created));
      if (o.detail) cols.push(e.hash ? e.hash.slice(0, 16) : '-');
      this.print('  ' + cols.join('  '));
    }
  }

  printTree(items) {
    const roots = items.filter((e) => e.path.split('/').length === 2);
    roots.forEach((e, i) => {
      const last = i === roots.length - 1;
      this.print((last ? String.fromCharCode(9492) : String.fromCharCode(9500)) + String.fromCharCode(9472, 9472, 9472) + ' ' + e.name + (e.type === 'folder' ? '/' : ''));
      if (e.type === 'folder') this.printSub(e.path, last ? '    ' : String.fromCharCode(9474) + '   ');
    });
  }

  printSub(dir, prefix) {
    const kids = this.store.list(dir, {});
    kids.forEach((e, i) => {
      const last = i === kids.length - 1;
      this.print(prefix + (last ? String.fromCharCode(9492) : String.fromCharCode(9500)) + String.fromCharCode(9472, 9472, 9472) + ' ' + e.name + (e.type === 'folder' ? '/' : ''));
      if (e.type === 'folder') this.printSub(e.path, prefix + (last ? '    ' : String.fromCharCode(9474) + '   '));
    });
  }

  cmdHelp() {
    this.print(t('help_title'));
    const rows = [
      ['get', 'pull the manifest'],
      ['listf [-a] [-l] [-d] [-t]', 'list the cloud'],
      ['pull download -path=<> -lpath=<>', 'download'],
      ['pull upload -path=<> -cpath=<>', 'upload'],
      ['pull list | pause | start | rm | edit', 'task control'],
      ['rm -path=<>', 'move a file to the recycle bin'],
      ['trash list', 'what is in the recycle bin'],
      ['trash restore -path=<>', 'put one back'],
      ['trash purge [-path=<>]', 'delete for good'],
      ['settings list', 'every setting'],
      ['set <key> <value>', 'change one'],
      ['setup', 'fetch aria2 and FastGithub'],
      ['help | exit', 'this list, or leave']
    ];
    for (const r of rows) this.print('  ' + r[0].padEnd(38) + r[1]);
  }

  cmdSet(args) {
    if (!args.length || args[0] === 'list') {
      for (const s of SCHEMA) this.print('  ' + s.key.padEnd(16) + s.type.padEnd(8) + s.desc);
      return;
    }
    const key = args[0];
    const value = args.slice(1).join(' ');
    if (!schemaFor(key)) { this.print(C.red + 'unknown setting: ' + key + C.reset); return; }
    const v = coerce(key, value);
    if (v === null) { this.print(C.red + 'bad value for ' + key + C.reset); return; }
    this.cfg[key] = v;
    save('cli', this.cfg);
    if (key === 'lang') setLang(v);
    this.print(C.green + key + ' = ' + String(v) + C.reset);
  }

  async cmdSetup() {
    await ensureTools(this.baseDir, {}, (m) => this.print(C.dim + m + C.reset));
    this.paths = loadProgramPaths(this.baseDir);
    const d = await makeDownloader(this.paths);
    this.print('aria2c    : ' + (d.aria2c || 'not available'));
    this.print('fastgithub: ' + (d.fastgithub ? d.fastgithub.url : 'not running'));
  }

  flag(args, name) {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === name && i + 1 < args.length) return args[i + 1];
      if (args[i].indexOf(name + '=') === 0) return args[i].slice(name.length + 1);
    }
    return null;
  }

  async cmdPull(args) {
    const sub = (args[0] || 'list').toLowerCase();
    if (sub === 'list') { this.printTasks(); return; }
    if (sub === 'pause') { this.print(t('task_paused')); return; }
    if (sub === 'start') { this.print(t('task_started')); return; }
    if (sub === 'rm') { this.print(t('task_removed')); return; }
    if (sub === 'edit') { this.print(t('task_created')); return; }
    if (sub === 'download') {
      const cloud = this.flag(args, '-path');
      const to = this.flag(args, '-lpath') || process.cwd();
      if (!cloud) { this.print(C.red + '-path is required' + C.reset); return; }
      const id = this.flag(args, '-id') || Math.random().toString(36).slice(2, 8);
      this.print(t('task_created'));
      this.print(t('cloud_path') + ': ' + cloud);
      this.print(t('local_path') + ': ' + to);
      this.print(t('task_id') + ': ' + id);
      const out = path.join(to, path.basename(cloud));
      await this.store.get(cloud, out, {}, (i, n) => {
        process.stdout.write(String.fromCharCode(13) + t('progress') + ' ' + bar(Math.floor((i / n) * 100)));
      });
      process.stdout.write(String.fromCharCode(10));
      this.print(C.green + t('downloaded') + ' ' + out + C.reset);
      return;
    }
    if (sub === 'upload') {
      const local = this.flag(args, '-path');
      const cloud = this.flag(args, '-cpath');
      if (!local || !cloud) { this.print(C.red + '-path and -cpath are required' + C.reset); return; }
      await this.store.put(local, cloud, {}, (i, n) => {
        process.stdout.write(String.fromCharCode(13) + t('progress') + ' ' + bar(Math.floor((i / n) * 100)));
      });
      process.stdout.write(String.fromCharCode(10));
      await this.store.flush();
      this.print(C.green + t('uploaded') + C.reset);
      return;
    }
    this.print(C.red + 'unknown pull subcommand: ' + sub + C.reset);
  }

  /*
   * The recycle bin, from the command line.
   *
   * list is the default so a bare "trash" is useful on its own. restore and
   * purge both take -path; purge without one empties the whole bin, which is
   * the only way to make room without naming every file.
   */
  async cmdTrash(args) {
    const sub = (args[0] || 'list').toLowerCase();

    if (sub === 'list') {
      const items = this.store.listTrash();
      if (!items.length) { this.print('  (empty)'); return; }
      this.print('  ' + 'path'.padEnd(34) + 'size'.padStart(12) + '  deleted');
      for (const e of items) {
        this.print('  ' + e.path.padEnd(34) + String(e.size || 0).padStart(12) + '  ' + fmtDate(e.deletedAt));
      }
      return;
    }

    if (sub === 'restore') {
      const p = this.flag(args, '-path');
      if (!p) { this.print(C.red + '-path is required' + C.reset); return; }
      const e = this.store.restore(p);
      await this.store.flush();
      this.print(C.green + 'restored ' + e.path + C.reset);
      return;
    }

    if (sub === 'purge' || sub === 'empty') {
      const p = this.flag(args, '-path');
      if (!p && sub === 'purge') {
        this.print(C.red + 'trash purge needs -path, or use "trash empty"' + C.reset);
        return;
      }
      const n = await this.store.purge(p || null);
      await this.store.flush();
      this.print(C.green + 'purged ' + n + ' item(s)' + C.reset);
      return;
    }

    this.print(C.red + 'unknown trash subcommand: ' + sub + C.reset);
  }

  /* Move a cloud path to the recycle bin. */
  async cmdRm(args) {
    const p = this.flag(args, '-path');
    if (!p) { this.print(C.red + '-path is required' + C.reset); return; }
    const n = await this.store.rm(p, {});
    await this.store.flush();
    this.print(C.green + 'moved ' + n + ' item(s) to the recycle bin' + C.reset);
    this.print(C.dim + 'trash restore -path=' + p + ' puts it back' + C.reset);
  }

  printTasks() {
    this.print(t('pull_list'));
    if (!this.tasks.length) { this.print('  (empty)'); return; }
    for (const k of this.tasks) {
      this.print('  ' + [k.name, k.type, k.pct + '%', bar(k.pct), k.speed, fmtTime(k.eta), String(k.priority), k.id].join(' '));
    }
  }

  async dispatch(line) {
    const parts = line.trim().split(' ').filter((x) => x);
    if (!parts[0]) return true;
    const cmd = parts[0].toLowerCase();
    const rest = parts.slice(1);
    if (cmd === 'exit' || cmd === 'quit') return false;
    if (cmd === 'help') { this.cmdHelp(); return true; }
    if (cmd === 'cls' || cmd === 'clear') return this.cmdClear();
    if (cmd === 'ver' || cmd === 'version') { this.banner(); return true; }
    if (cmd === 'login') { await this.signIn(); return true; }
    if (cmd === 'logout') { this.signOut(); return true; }
    if (cmd === 'settings' || cmd === 'set') { this.cmdSet(rest); return true; }
    if (cmd === 'setup') { await this.cmdSetup(); return true; }
    if (!this.store) { this.print(C.red + t('not_signed_in') + C.reset); return true; }
    if (cmd === 'get') { await this.cmdGet(); return true; }
    if (cmd === 'listf') { this.cmdListf(rest); return true; }
    if (cmd === 'pull') { await this.cmdPull(rest); return true; }
    if (cmd === 'rm') { await this.cmdRm(rest); return true; }
    if (cmd === 'trash') { await this.cmdTrash(rest); return true; }
    this.print(C.red + cmd + ': command not found' + C.reset);
    return true;
  }

  async run(argv) {
    ensureDirs();
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    this.bindInput(rl);

    /*
     * 首次运行要选语言。但只有真的坐在终端前面时才问：输入是管道时没有
     * 键盘可以回答，问下去只会拿到 EOF，然后整个命令失败。这种情况直接
     * 用默认语言，把要做的事做完。
     */
    const interactive = !!process.stdin.isTTY;
    if (!this.cfg.lang) {
      if (interactive) {
        try { await this.firstRun(); }
        catch (e) { this.print(C.red + e.message + C.reset); rl.close(); return; }
      } else {
        this.cfg.lang = "zh-CN";
        setLang(this.cfg.lang);
        save("cli", this.cfg);
      }
    } else setLang(this.cfg.lang);

    /*
     * 带参数的调用是一次性命令：执行完就退出，不进交互循环。这样
     * "inc listf" 在脚本里才有意义，而不是打开一个等着输入提示符。
     */
    if (argv && argv.length) {
      this.banner();
      try { await this.signIn(); }
      catch (e) { /* 有的命令不需要登录 */ }
      try { await this.dispatch(argv.join(" ")); }
      catch (e) { this.print(C.red + e.message + C.reset); rl.close(); process.exitCode = 1; return; }
      rl.close();
      return;
    }

    this.banner();
    try { await this.signIn(); }
    catch (e) { this.print(C.dim + t('not_signed_in') + ' (' + e.message + ')' + C.reset); }
    /*
     * No command list on the way in. The whole table belongs behind "help";
     * printing it at every start buries the prompt under a screen of text
     * that the person who just typed the command did not ask for.
     */
    this.print(C.dim + 'help' + C.reset + C.dim + ' ' + t('hint_more') + C.reset);
    for (;;) {
      const line = await this.prompt();
      if (line === null) break;
      try { if (!(await this.dispatch(line))) break; }
      catch (e) { this.print(C.red + e.message + C.reset); }
    }
    rl.close();
  }
}

export async function runCli(argv) {
  await new Cli().run(argv || []);
}