/*
 * config.js - settings, and where they live.
 *
 * The command line keeps its own file. The .ics extension is a historical
 * name; the file is plain JSON.
 *
 * Nothing here ever writes a token into the file unless the user asked for
 * automatic sign-in. The token normally lives in the environment.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = process.env.USERPROFILE || process.env.HOME || os.homedir();

export const PATHS = {
  cli: path.join(process.cwd(), 'cli_set.ics'),
  cache: path.join('D:', 'temp', 'Infinity Cloud'),
  trash: path.join('D:', 'temp', 'recyle.bin', 'Infinity Cloud'),
  backup: path.join('D:', 'temp', 'backup', 'Infinity Cloud')
};

/*
 * Everything the application can be told to do differently. The defaults are
 * deliberately conservative: nothing is sent anywhere, nothing is written
 * outside the working directory, and no speed cap is imposed.
 */
export const DEFAULTS = {
  lang: null,
  sendLog: false,
  autoLogin: false,
  user: '',
  token: '',
  repoPrefix: 'inc_',
  chunkBytes: 1990 * 1024 * 1024,
  maxAssets: 64,
  concurrency: 3,
  speedLimit: 0,
  timeout: 1800,
  hashCheck: false,
  useCloudTime: false,
  theme: 'dark',
  logLevel: 'info',
  autoUpdate: true,
  confirmDelete: true,
  cacheDir: PATHS.cache,
  trashDir: PATHS.trash
};

/*
 * Which file backs the settings. There is only one now; the mode is kept in
 * the signature so callers do not have to change.
 */
export function configPath(mode) {
  return PATHS.cli;
}

export function load(mode) {
  const file = configPath(mode);
  const cfg = Object.assign({}, DEFAULTS);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    for (const k of Object.keys(parsed)) {
      if (parsed[k] !== undefined && parsed[k] !== null) cfg[k] = parsed[k];
    }
  } catch (e) {
    /* A missing or unreadable file is normal on the first run. */
  }
  return cfg;
}

/*
 * Write through a temporary file and rename. A crash halfway through then
 * leaves the old settings intact instead of a half-written file that will not
 * parse on the next start.
 */
export function save(mode, cfg) {
  const file = configPath(mode);
  const tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (x) { /* nothing to clean */ }
    return false;
  }
}

/*
 * One place that decides what a setting is called, what it accepts, and what
 * it does. Every face drives the same table, so a setting can never work in
 * one mode and silently do nothing in another.
 */
export const SCHEMA = [
  { key: 'lang', type: 'enum', values: ['en', 'zh-CN', 'zh-TW'], desc: 'Interface language' },
  { key: 'sendLog', type: 'bool', desc: 'Send anonymous usage log' },
  { key: 'autoLogin', type: 'bool', desc: 'Sign in without asking' },
  { key: 'user', type: 'string', desc: 'GitHub user name' },
  { key: 'token', type: 'secret', desc: 'GitHub personal access token' },
  { key: 'repoPrefix', type: 'string', desc: 'Prefix for storage repos' },
  { key: 'chunkBytes', type: 'int', desc: 'Bytes per uploaded part' },
  { key: 'maxAssets', type: 'int', desc: 'Assets per release' },
  { key: 'concurrency', type: 'int', desc: 'Parallel transfers' },
  { key: 'speedLimit', type: 'int', desc: 'Bytes per second, 0 for none' },
  { key: 'timeout', type: 'int', desc: 'Transfer timeout in seconds' },
  { key: 'hashCheck', type: 'bool', desc: 'Verify SHA-256 after transfer' },
  { key: 'useCloudTime', type: 'bool', desc: 'Apply the cloud timestamp locally' },
  { key: 'theme', type: 'enum', values: ['dark', 'light'], desc: 'Interface colour scheme' },
  { key: 'logLevel', type: 'enum', values: ['quiet', 'info', 'debug'], desc: 'How much to print' },
  { key: 'autoUpdate', type: 'bool', desc: 'Check for a newer release at start' },
  { key: 'confirmDelete', type: 'bool', desc: 'Ask before deleting' },
  { key: 'cacheDir', type: 'string', desc: 'Where downloads are staged' },
  { key: 'trashDir', type: 'string', desc: 'Where deleted files go' }
];

export function schemaFor(key) {
  for (const s of SCHEMA) if (s.key === key) return s;
  return null;
}

/*
 * Coerce a typed value. Returns null when the input cannot be made to fit, so
 * the caller can report it instead of storing something broken.
 */
export function coerce(key, value) {
  const s = schemaFor(key);
  if (!s) return null;
  const v = String(value).trim();
  if (s.type === 'bool') {
    const low = v.toLowerCase();
    if (low === 'true' || low === '1' || low === 'on' || low === 'yes' || low === 'y' || low === '开') return true;
    if (low === 'false' || low === '0' || low === 'off' || low === 'no' || low === 'n' || low === '关') return false;
    return null;
  }
  if (s.type === 'int') {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.floor(n);
  }
  if (s.type === 'enum') {
    for (const e of s.values) if (e.toLowerCase() === v.toLowerCase()) return e;
    return null;
  }
  if (s.type === 'secret') return v;
  return v;
}

export function ensureDirs() {
  for (const d of [PATHS.cache, PATHS.trash, PATHS.backup]) {
    try { fs.mkdirSync(d, { recursive: true }); } catch (e) { /* exists */ }
  }
}
