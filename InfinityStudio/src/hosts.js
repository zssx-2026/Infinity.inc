/*
 * hosts.js - what is actually installed on this machine.
 *
 * Studio leans on things it does not ship: Blender for the heavy geometry,
 * VLC for decoding, Ollama for local inference, VS Code for the Copilot
 * extension host. This module answers one question per host - is it here, and
 * which version - using nothing but the environment it was started in.
 *
 * The equivalent of Get-Command is a PATH walk plus a list of the places the
 * installer is known to put things. Nothing is downloaded, nothing is
 * installed, and a missing host is a normal answer rather than an error: the
 * tree simply greys that component out.
 *
 * Two rules hold throughout:
 *   1. probeHosts() never rejects. A probe that blows up reports found:false
 *      with the reason attached, because a broken host must not take the
 *      component tree down with it.
 *   2. Only console-safe commands are executed. Editor-class hosts (Unity,
 *      Unreal, Audacity) are located by path and their version read from the
 *      path itself, so probing never opens a window.
 *
 * Path patterns may carry {ENV} tokens and * wildcards. Tokens resolve from
 * process.env and a candidate is skipped when a token is unset; wildcards
 * match one path segment and the highest version wins.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

/*
 * The hosts, in the order the settings page lists them. Field by field:
 *
 *   id       the value a component's rea field points at
 *   name     display name
 *   paths    known install locations, {ENV} tokens and * wildcards allowed
 *   args     version arguments; empty means locate only, never execute
 *   commands executable names to look for on PATH
 *   console  true when args are safe to run without a window
 *
 * "args" is what the probe passes when it can run the host. A host with
 * console:false is located by path only - its version is then read from the
 * path segment that carries it, or left null.
 */
export const HOSTS = [
  {
    id: 'node',
    name: 'Node.js',
    commands: ['node.exe', 'node'],
    paths: [
      '{ProgramFiles}/nodejs/node.exe',
      '{ProgramFiles(x86)}/nodejs/node.exe',
      '{LOCALAPPDATA}/Programs/nodejs/node.exe',
      '{APPDATA}/npm/node.exe'
    ],
    args: ['--version'],
    console: true
  },
  {
    id: 'python',
    name: 'Python',
    commands: ['python.exe', 'python3.exe', 'python'],
    paths: [
      '{LOCALAPPDATA}/Programs/Python/Python3*/python.exe',
      '{ProgramFiles}/Python3*/python.exe',
      '{ProgramFiles(x86)}/Python3*/python.exe',
      'C:/Python3*/python.exe'
    ],
    args: ['--version'],
    console: true
  },
  {
    id: 'java',
    name: 'Java',
    commands: ['java.exe', 'java'],
    paths: [
      '{ProgramFiles}/Java/jdk*/bin/java.exe',
      '{ProgramFiles}/Eclipse Adoptium/jdk*/bin/java.exe',
      '{ProgramFiles}/Microsoft/jdk*/bin/java.exe',
      '{ProgramFiles}/Amazon Corretto/jdk*/bin/java.exe',
      '{ProgramFiles(x86)}/Java/jdk*/bin/java.exe'
    ],
    args: ['-version'],
    console: true
  },
  {
    id: 'gcc',
    name: 'GCC',
    commands: ['gcc.exe', 'gcc'],
    paths: [
      '{ProgramFiles}/mingw64/bin/gcc.exe',
      '{ProgramFiles}/MinGW/bin/gcc.exe',
      '{ProgramFiles(x86)}/mingw64/bin/gcc.exe',
      'C:/msys64/mingw64/bin/gcc.exe',
      'C:/mingw64/bin/gcc.exe',
      'C:/TDM-GCC-64/bin/gcc.exe'
    ],
    args: ['--version'],
    console: true
  },
  {
    id: 'dotnet',
    name: '.NET',
    commands: ['dotnet.exe', 'dotnet'],
    paths: ['{ProgramFiles}/dotnet/dotnet.exe', '{ProgramFiles(x86)}/dotnet/dotnet.exe'],
    args: ['--version'],
    console: true
  },
  {
    id: 'git',
    name: 'Git',
    commands: ['git.exe', 'git'],
    paths: [
      '{ProgramFiles}/Git/cmd/git.exe',
      '{ProgramFiles}/Git/bin/git.exe',
      '{LOCALAPPDATA}/Programs/Git/cmd/git.exe',
      '{ProgramFiles(x86)}/Git/cmd/git.exe'
    ],
    args: ['--version'],
    console: true
  },
  {
    id: 'ffmpeg',
    name: 'FFmpeg',
    commands: ['ffmpeg.exe', 'ffmpeg'],
    paths: [
      '{ProgramFiles}/ffmpeg/bin/ffmpeg.exe',
      '{ProgramFiles}/FFmpeg/bin/ffmpeg.exe',
      'C:/ffmpeg/bin/ffmpeg.exe',
      '{LOCALAPPDATA}/Microsoft/WinGet/Links/ffmpeg.exe'
    ],
    args: ['-version'],
    console: true
  },
  {
    id: 'ollama',
    name: 'Ollama',
    commands: ['ollama.exe', 'ollama'],
    paths: [
      '{LOCALAPPDATA}/Programs/Ollama/ollama.exe',
      '{ProgramFiles}/Ollama/ollama.exe',
      '{ProgramFiles(x86)}/Ollama/ollama.exe'
    ],
    args: ['--version'],
    console: true
  },
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    commands: ['code.cmd', 'code.exe', 'code'],
    paths: [
      '{LOCALAPPDATA}/Programs/Microsoft VS Code/Code.exe',
      '{ProgramFiles}/Microsoft VS Code/Code.exe',
      '{ProgramFiles(x86)}/Microsoft VS Code/Code.exe',
      'C:/Program Files/Microsoft VS Code/bin/code.cmd'
    ],
    args: ['--version'],
    console: true
  },
  {
    id: 'blender',
    name: 'Blender',
    commands: ['blender.exe', 'blender'],
    paths: [
      '{ProgramFiles}/Blender Foundation/Blender */blender.exe',
      '{ProgramFiles}/Blender Foundation/Blender/blender.exe',
      '{LOCALAPPDATA}/Programs/Blender Foundation/Blender */blender.exe',
      'C:/Program Files/Blender Foundation/Blender */blender.exe'
    ],
    args: ['--version'],
    console: true
  },
  {
    id: 'vlc',
    name: 'VLC',
    commands: ['vlc.exe', 'vlc'],
    paths: [
      '{ProgramFiles}/VideoLAN/VLC/vlc.exe',
      '{ProgramFiles(x86)}/VideoLAN/VLC/vlc.exe'
    ],
    args: ['--version'],
    console: true
  },
  {
    id: 'unity',
    name: 'Unity',
    commands: [],
    paths: [
      '{ProgramFiles}/Unity/Hub/Editor/*/Editor/Unity.exe',
      '{ProgramFiles}/Unity/Editor/Unity.exe',
      'C:/Program Files/Unity/Hub/Editor/*/Editor/Unity.exe'
    ],
    args: [],
    console: false,
    versionFromPath: true
  },
  {
    id: 'godot',
    name: 'Godot',
    commands: ['godot.exe', 'godot'],
    paths: [
      '{ProgramFiles}/Godot/Godot.exe',
      '{LOCALAPPDATA}/Programs/Godot/Godot.exe',
      '{ProgramFiles}/Godot/Godot_v*_win64.exe'
    ],
    args: ['--version'],
    console: true
  },
  {
    id: 'unreal',
    name: 'Unreal Engine',
    commands: [],
    paths: [
      '{ProgramFiles}/Epic Games/UE_*/Engine/Binaries/Win64/UnrealEditor.exe',
      'C:/Program Files/Epic Games/UE_*/Engine/Binaries/Win64/UnrealEditor.exe'
    ],
    args: [],
    console: false,
    versionFromPath: true
  },
  {
    id: 'audacity',
    name: 'Audacity',
    commands: [],
    paths: [
      '{ProgramFiles}/Audacity/Audacity.exe',
      '{ProgramFiles(x86)}/Audacity/Audacity.exe'
    ],
    args: [],
    console: false
  }
];

/* ---- environment expansion ----------------------------------------- */

const TOKEN = /[{]([A-Za-z0-9_()]+)[}]/g;

/* Resolve {ProgramFiles} and friends. A pattern with an unset token is not a
 * path we can guess at, so it is dropped rather than half-resolved. */
export function expandEnv(pattern, env) {
  const source = env || process.env;
  let missing = false;
  const out = String(pattern).replace(TOKEN, (whole, name) => {
    const value = source[name];
    if (value === undefined || value === '') {
      missing = true;
      return whole;
    }
    return value;
  });
  return missing ? null : out;
}

/* Highest first, so a versioned directory list picks the newest install. */
function naturalCompare(a, b) {
  const split = (s) => String(s).split(/([0-9]+)/).filter((x) => x !== '');
  const x = split(a);
  const y = split(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i += 1) {
    const xn = /^[0-9]+$/.test(x[i]);
    const yn = /^[0-9]+$/.test(y[i]);
    if (xn && yn) {
      const d = Number(x[i]) - Number(y[i]);
      if (d !== 0) return d;
    } else if (x[i] !== y[i]) {
      return x[i] < y[i] ? -1 : 1;
    }
  }
  return x.length - y.length;
}

/* Expand * wildcards one segment at a time. Only whole segments are matched,
 * which is all the installers here need and keeps this readable. */
export function expandWildcard(pattern) {
  const segments = String(pattern).split('/');
  let candidates = [''];
  for (const segment of segments) {
    if (segment === '') continue;
    const next = [];
    for (const base of candidates) {
      if (segment.indexOf('*') === -1) {
        next.push(base ? base + '/' + segment : segment);
        continue;
      }
      const dir = base ? base : '.';
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      const head = segment.slice(0, segment.indexOf('*'));
      const tail = segment.slice(segment.lastIndexOf('*') + 1);
      const matches = entries
        .map((e) => e.name)
        .filter((name) => name.length >= head.length + tail.length && name.startsWith(head) && name.endsWith(tail))
        .sort(naturalCompare)
        .reverse();
      for (const name of matches) next.push(base ? base + '/' + name : name);
    }
    candidates = next;
    if (!candidates.length) return [];
  }
  return candidates;
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/* ---- PATH lookup ---------------------------------------------------- */

function pathExtensions() {
  const raw = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
  const list = raw.split(';').map((x) => x.trim()).filter(Boolean);
  return list.length ? list : ['.EXE'];
}

/* The Get-Command equivalent: walk PATH, and on Windows try the PATHEXT
 * suffixes for a name given without one. */
export function whichOnPath(command, env) {
  const source = env || process.env;
  const raw = source.PATH || source.Path || '';
  const dirs = String(raw).split(path.delimiter).filter(Boolean);
  const name = String(command);
  const hasExt = path.extname(name) !== '';
  const names = hasExt ? [name] : [name, ...pathExtensions().map((ext) => name + ext.toLowerCase())];
  for (const dir of dirs) {
    for (const candidate of names) {
      const full = path.join(dir, candidate);
      if (isFile(full)) return full;
    }
  }
  return null;
}

/* ---- version reading ------------------------------------------------ */

const VERSION_TOKEN = /v?([0-9]+[.][0-9]+(?:[.][0-9A-Za-z-]+)*(?:[+][0-9A-Za-z.-]+)?)/;

export function extractVersion(text) {
  if (!text) return null;
  const m = VERSION_TOKEN.exec(String(text));
  return m ? m[1] : null;
}

/* Version carried by the install path itself, for hosts we must not launch.
 * Unity keeps 2022.3.10f1 as a directory name, Unreal keeps UE_5.4. */
export function versionFromPath(file) {
  const segments = String(file).split('/');
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const found = VERSION_TOKEN.exec(segments[i]);
    if (found) return found[1];
  }
  return null;
}

/* Run a host with its version arguments and read the first version-shaped
 * token from either stream. Resolves to null on any failure - a host that
 * answers oddly is still found, it just has no version. */
function runVersion(file, args, timeout) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    let child;
    try {
      const options = {
        windowsHide: true,
        timeout,
        stdio: ['ignore', 'pipe', 'pipe']
      };
      let command = file;
      if (/[.]c(?:md|bat)$/i.test(file)) {
        options.shell = true;
        command = file.indexOf(' ') === -1 ? file : '"' + file + '"';
      }
      child = spawn(command, args, options);
    } catch {
      return finish(null);
    }
    const chunks = [];
    const collect = (buf) => {
      if (chunks.length < 64) chunks.push(buf.toString('utf8'));
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', () => finish(null));
    child.on('close', () => finish(extractVersion(chunks.join(' '))));
    child.on('exit', () => finish(extractVersion(chunks.join(' '))));
  });
}

/* ---- probing -------------------------------------------------------- */

/* Locate one host. Returns {found, path} without ever throwing. */
export function locateHost(host) {
  const commands = host.commands || [];
  for (const command of commands) {
    const hit = whichOnPath(command);
    if (hit) return { found: true, path: hit, via: 'path-env' };
  }
  for (const pattern of host.paths || []) {
    const expanded = expandEnv(pattern);
    if (!expanded) continue;
    const candidates = expanded.indexOf('*') === -1 ? [expanded] : expandWildcard(expanded);
    for (const candidate of candidates) {
      if (isFile(candidate)) return { found: true, path: candidate, via: 'known-path' };
    }
  }
  return { found: false, path: null, via: null };
}

/* One host, in full. The shape here is the contract: {id, name, found,
 * path, version}. "error" only ever appears alongside found:false. */
export async function probeHost(host, options) {
  const settings = options || {};
  const timeout = settings.timeout === undefined ? 6000 : settings.timeout;
  const record = { id: host.id, name: host.name, found: false, path: null, version: null };
  try {
    const located = locateHost(host);
    record.path = located.path;
    record.found = located.found;
    record.via = located.via;
    if (!located.found) return record;
    const args = Array.isArray(host.args) ? host.args : [];
    const canRun = host.console !== false && args.length > 0;
    if (canRun) record.version = await runVersion(located.path, args, timeout);
    if (!record.version) record.version = versionFromPath(located.path);
    return record;
  } catch (error) {
    record.found = false;
    record.version = null;
    record.error = (error && error.code) || 'PROBE_FAILED';
    return record;
  }
}

/* Every host, in HOSTS order. Never rejects: a probe that fails is reported
 * as found:false with its reason, so the caller can always render the tree. */
export async function probeHosts(options) {
  const settings = options || {};
  const timeout = settings.timeout === undefined ? 6000 : settings.timeout;
  const limit = Math.max(1, settings.concurrency || 4);
  const results = new Array(HOSTS.length);
  let next = 0;

  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= HOSTS.length) return;
      results[index] = await probeHost(HOSTS[index], { timeout });
    }
  };

  const workers = [];
  for (let i = 0; i < Math.min(limit, HOSTS.length); i += 1) workers.push(worker());
  await Promise.all(workers);
  return results;
}

/* The probe as a lookup table, which is what the page wants when it renders
 * a component's host line. */
export async function probeHostMap(options) {
  const list = await probeHosts(options);
  const map = {};
  for (const entry of list) map[entry.id] = entry;
  return map;
}

export function findHost(id) {
  return HOSTS.find((h) => h.id === String(id)) || null;
}
