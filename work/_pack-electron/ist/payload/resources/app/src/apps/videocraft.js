/*
 * videocraft.js - VideoCraft's capability surface.
 *
 * VideoCraft does not ship a decoder and does not reimplement one. The machine
 * owns the heavy lifting: ffprobe answers what a file is, ffmpeg answers what
 * it can become, and the encoder table answers which silicon is actually wired
 * up. This module is the seam between the timeline UI and those programs.
 *
 * The rules from CONTRACT.md shape every function here:
 *   - Node built-ins only. No package is imported, ever.
 *   - Nothing throws at the caller. A missing tool, a missing file and a
 *     corrupt stream are all ordinary answers, each with its own error code.
 *   - plan() is pure. It composes the argument vector and stops there; run()
 *     is the only function that starts a process.
 *   - Paths are used exactly as handed in. Nothing is joined onto a fixed
 *     prefix, so a caller on any drive gets back what it asked for.
 *
 * The command line is data throughout: every argv is an array, so a filename
 * with a space, a quote or a leading dash never needs escaping.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const NL = String.fromCharCode(10);

/* ---------------------------------------------------------------- identity */

export const META = {
  id: 'craft.video',
  name: 'VideoCraft',
  version: '1.0.0-pre5',
  branch: 'craft',
  codecs: [
    { ext: '.is-vcp', since: '0.30.124' },
    { ext: '.is-vcpx', since: '0.30.124' }
  ],
  /* VLC previews and decodes; ffmpeg (which brings ffprobe with it) does the
   * measuring and the writing. Both are probed, neither is bundled. */
  hosts: ['vlc', 'ffmpeg']
};

/* ---------------------------------------------------------------- targets */

/*
 * What the export dialog offers. Each record is the whole story: the encoder
 * ffmpeg should reach for, the container the extension implies, and the
 * argument block spliced between -i and the output name.
 *
 * The blocks are deliberately conservative - yuv420p so the result plays
 * anywhere, faststart so a browser can seek before the download finishes -
 * because a transcode that only works in ffplay is not a delivery format.
 */
export const TARGETS = {
  h264: {
    id: 'h264',
    label: 'H.264 / AVC',
    kind: 'video',
    container: 'mp4',
    encoder: 'libx264',
    hardware: ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_d3d12va'],
    args: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart']
  },
  hevc: {
    id: 'hevc',
    label: 'H.265 / HEVC',
    kind: 'video',
    container: 'mp4',
    encoder: 'libx265',
    hardware: ['hevc_nvenc', 'hevc_qsv', 'hevc_amf', 'hevc_d3d12va'],
    args: ['-c:v', 'libx265', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-tag:v', 'hvc1', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart']
  },
  av1: {
    id: 'av1',
    label: 'AV1',
    kind: 'video',
    container: 'mp4',
    encoder: 'libaom-av1',
    hardware: ['av1_nvenc', 'av1_qsv', 'av1_amf', 'av1_d3d12va'],
    args: ['-c:v', 'libaom-av1', '-crf', '32', '-b:v', '0', '-cpu-used', '6',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k']
  },
  mp3: {
    id: 'mp3',
    label: 'MP3 音频',
    kind: 'audio',
    container: 'mp3',
    encoder: 'libmp3lame',
    hardware: [],
    args: ['-vn', '-c:a', 'libmp3lame', '-b:a', '192k']
  },
  wav: {
    id: 'wav',
    label: 'WAV 音频',
    kind: 'audio',
    container: 'wav',
    encoder: 'pcm_s16le',
    hardware: [],
    args: ['-vn', '-c:a', 'pcm_s16le']
  },
  copy: {
    id: 'copy',
    label: '直接封装',
    kind: 'copy',
    container: 'mp4',
    encoder: 'copy',
    hardware: [],
    args: ['-c', 'copy']
  }
};

const ALIASES = {
  h264: 'h264', avc: 'h264', x264: 'h264', mp4: 'h264',
  hevc: 'hevc', h265: 'hevc', x265: 'hevc',
  av1: 'av1', av01: 'av1',
  mp3: 'mp3', mpga: 'mp3',
  wav: 'wav', pcm: 'wav', wave: 'wav',
  copy: 'copy', remux: 'copy', passthrough: 'copy'
};

/* The encoders worth naming in the renderers report: one software encoder per
 * codec, the three hardware families the task asks about, and the audio ones
 * the export dialog can pick. */
const WATCHED_ENCODERS = [
  'libx264', 'libx265', 'libaom-av1', 'libsvtav1',
  'h264_nvenc', 'hevc_nvenc', 'av1_nvenc',
  'h264_amf', 'hevc_amf', 'av1_amf',
  'h264_qsv', 'hevc_qsv', 'av1_qsv',
  'h264_d3d12va', 'hevc_d3d12va', 'av1_d3d12va',
  'h264_vaapi', 'h264_videotoolbox',
  'aac', 'libmp3lame', 'libopus', 'libvorbis', 'pcm_s16le', 'flac'
];

/* ------------------------------------------------------------ tool lookup */

const KNOWN_TOOLS = {
  ffmpeg: [
    '{ProgramFiles}/ffmpeg/bin/ffmpeg.exe',
    '{ProgramFiles}/FFmpeg/bin/ffmpeg.exe',
    '{ProgramFiles(x86)}/ffmpeg/bin/ffmpeg.exe',
    'C:/ffmpeg/bin/ffmpeg.exe',
    '{LOCALAPPDATA}/Microsoft/WinGet/Links/ffmpeg.exe',
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/opt/homebrew/bin/ffmpeg'
  ],
  ffprobe: [
    '{ProgramFiles}/ffmpeg/bin/ffprobe.exe',
    '{ProgramFiles}/FFmpeg/bin/ffprobe.exe',
    '{ProgramFiles(x86)}/ffmpeg/bin/ffprobe.exe',
    'C:/ffmpeg/bin/ffprobe.exe',
    '{LOCALAPPDATA}/Microsoft/WinGet/Links/ffprobe.exe',
    '/usr/bin/ffprobe',
    '/usr/local/bin/ffprobe',
    '/opt/homebrew/bin/ffprobe'
  ]
};

/* An explicit override wins and does not fall back: a caller that says where
 * the tool is gets an honest not-found when it is not there, instead of a
 * surprise copy from somewhere else on PATH. */
const ENV_OVERRIDE = { ffmpeg: 'VIDEOCRAFT_FFMPEG', ffprobe: 'VIDEOCRAFT_FFPROBE' };

const ENV_TOKEN = new RegExp('[{]([A-Za-z0-9_()]+)[}]', 'g');

function expandEnv(pattern, env) {
  let missing = false;
  const expanded = String(pattern).replace(ENV_TOKEN, (whole, name) => {
    const value = env[name];
    if (!value) {
      missing = true;
      return '';
    }
    return value;
  });
  if (missing) return null;
  return expanded;
}

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function pathExtensions(env) {
  const raw = env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
  const list = String(raw).split(';').map((x) => x.trim()).filter(Boolean);
  return list.length ? list : ['.EXE'];
}

function whichOnPath(command, env) {
  const raw = env.PATH || env.Path || '';
  const dirs = String(raw).split(path.delimiter).filter(Boolean);
  const name = String(command);
  const hasExt = path.extname(name) !== '';
  const names = hasExt ? [name] : [name].concat(pathExtensions(env).map((ext) => name + ext.toLowerCase()));
  for (const dir of dirs) {
    for (const candidate of names) {
      const full = path.join(dir, candidate);
      if (isFile(full)) return full;
    }
  }
  return null;
}

/* Locate ffmpeg or ffprobe. Never throws; a miss is a normal answer. */
export function resolveTool(name, options) {
  const settings = options || {};
  const env = settings.env || process.env;
  const id = String(name).toLowerCase();
  const record = { id: id, found: false, path: null, via: null };
  const overrideName = ENV_OVERRIDE[id];
  const override = overrideName ? env[overrideName] : '';
  if (override) {
    if (isFile(override)) {
      record.found = true;
      record.path = override;
      record.via = 'env';
      return record;
    }
    record.via = 'env-missing';
    return record;
  }
  const hit = whichOnPath(id === 'ffprobe' ? 'ffprobe' : 'ffmpeg', env);
  if (hit) {
    record.found = true;
    record.path = hit;
    record.via = 'path-env';
    return record;
  }
  for (const pattern of KNOWN_TOOLS[id] || []) {
    const expanded = expandEnv(pattern, env);
    if (!expanded) continue;
    if (isFile(expanded)) {
      record.found = true;
      record.path = expanded;
      record.via = 'known-path';
      return record;
    }
  }
  return record;
}

/* ------------------------------------------------------------- processes */

/*
 * One child process, bounded. stdout and stderr are captured up to a cap so a
 * runaway encoder cannot exhaust memory, and a timeout kills the tree rather
 * than leaving an orphan writing to a handle nobody reads.
 *
 * Resolves - never rejects - to {code, stdout, stderr, timedOut, error}. A
 * spawn failure is code -1 with the errno string in error.
 */
export function runProcess(file, args, options) {
  const settings = options || {};
  const timeout = settings.timeout === undefined ? 30000 : Number(settings.timeout) || 0;
  const cap = settings.captureLimit === undefined ? 1024 * 1024 : Number(settings.captureLimit) || 0;
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let timer = null;
    const out = [];
    const err = [];
    let outBytes = 0;
    let errBytes = 0;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(payload);
    };
    let child;
    try {
      child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      finish({ code: -1, stdout: '', stderr: '', timedOut: false, error: (error && error.code) || 'SPAWN_FAILED' });
      return;
    }
    if (timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }, timeout);
    }
    child.stdout.on('data', (buf) => {
      if (cap > 0 && outBytes >= cap) return;
      outBytes += buf.length;
      out.push(buf.toString('utf8'));
    });
    child.stderr.on('data', (buf) => {
      if (cap > 0 && errBytes >= cap) return;
      errBytes += buf.length;
      err.push(buf.toString('utf8'));
    });
    child.on('error', (error) => {
      finish({ code: -1, stdout: '', stderr: '', timedOut: timedOut, error: (error && error.code) || 'SPAWN_FAILED' });
    });
    child.on('close', (code) => {
      finish({
        code: code === null ? -1 : code,
        stdout: out.join(''),
        stderr: err.join(''),
        timedOut: timedOut,
        error: null
      });
    });
  });
}

/* A short, console-safe tail of an encoder's complaint. The full stream can be
 * megabytes of progress lines; the last few lines are what names the failure. */
function tail(text, limit) {
  const max = limit === undefined ? 1600 : limit;
  const clean = String(text || '').trim();
  if (clean.length <= max) return clean;
  return clean.slice(clean.length - max);
}

/* --------------------------------------------------------------- helpers */

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function toInt(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

/* "30000/1001" is how ffprobe spells 29.97. */
function rateToNumber(value) {
  if (!value) return null;
  const text = String(value);
  const slash = text.indexOf('/');
  if (slash === -1) return toNumber(text);
  const num = toNumber(text.slice(0, slash));
  const den = toNumber(text.slice(slash + 1));
  if (num === null || den === null || den === 0) return null;
  return Math.round((num / den) * 1000) / 1000;
}

export function normalizeTarget(value) {
  const key = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
  if (!key) return null;
  const bare = key.charAt(0) === '.' ? key.slice(1) : key;
  return ALIASES[bare] || (TARGETS[bare] ? bare : null);
}

/* Where the export lands when the caller does not say. Beside the source, with
 * the target folded into the name so a second export never eats the first. */
export function defaultOutput(input, target) {
  const id = normalizeTarget(target) || 'h264';
  const spec = TARGETS[id];
  const source = String(input || '');
  const dir = path.dirname(source);
  const base = path.basename(source, path.extname(source));
  return path.join(dir, base + '.' + id + '.' + spec.container);
}

function sha256File(file) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', () => done(null));
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => done(hash.digest('hex')));
  });
}

/* The argv for one export. Pure: no disk, no process, no clock. */
export function buildTranscodeArgs(options) {
  const settings = options || {};
  const id = normalizeTarget(settings.target) || 'h264';
  const spec = TARGETS[id];
  const args = ['-hide_banner', '-loglevel', 'error'];
  args.push(settings.overwrite === false ? '-n' : '-y');
  if (settings.start !== undefined && settings.start !== null && settings.start !== '') {
    args.push('-ss', String(settings.start));
  }
  if (settings.duration !== undefined && settings.duration !== null && settings.duration !== '') {
    args.push('-t', String(settings.duration));
  }
  args.push('-i', String(settings.input));
  if (settings.scale) args.push('-vf', 'scale=' + String(settings.scale));
  if (settings.encoder) {
    const block = spec.args.slice();
    for (let i = 0; i < block.length - 1; i += 1) {
      if (block[i] === '-c:v' || block[i] === '-c:a') {
        block[i + 1] = String(settings.encoder);
      }
    }
    args.push.apply(args, block);
  } else {
    args.push.apply(args, spec.args);
  }
  args.push(String(settings.output));
  return args;
}

/* ---------------------------------------------------------------- probe */

/*
 * What is this file, really? One ffprobe call, parsed.
 *
 * Returns the format block, the streams, and the two the UI always wants
 * (video and audio) lifted to the top level. Duration is seconds as a float,
 * because every caller would otherwise re-parse the string.
 */
export async function probe(input, options) {
  const settings = options || {};
  const source = typeof input === 'string' ? input : (input && (input.path || input.input)) || '';
  const record = {
    ok: false,
    path: String(source || ''),
    bytes: 0,
    sha256: null,
    tool: null,
    toolVia: null,
    duration: null,
    format: null,
    video: null,
    audio: null,
    streams: [],
    error: null
  };
  if (!source) {
    record.error = 'MISSING_PATH';
    return record;
  }
  let stat;
  try {
    stat = fs.statSync(source);
  } catch {
    record.error = 'FILE_NOT_FOUND';
    return record;
  }
  if (!stat.isFile()) {
    record.error = 'NOT_A_FILE';
    return record;
  }
  record.bytes = stat.size;
  const hashLimit = settings.hashLimit === undefined ? 512 * 1024 * 1024 : Number(settings.hashLimit);
  if (settings.hash !== false && record.bytes <= hashLimit) {
    record.sha256 = await sha256File(source);
  }
  const tool = resolveTool('ffprobe', { env: settings.env });
  record.tool = tool.path;
  record.toolVia = tool.via;
  if (!tool.found) {
    record.error = 'FFPROBE_MISSING';
    return record;
  }
  const result = await runProcess(tool.path, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    source
  ], { timeout: settings.timeout === undefined ? 20000 : settings.timeout });
  if (result.error) {
    record.error = 'FFPROBE_FAILED';
    record.stderr = tail(result.stderr);
    return record;
  }
  if (result.code !== 0) {
    record.error = 'PROBE_FAILED';
    record.exitCode = result.code;
    record.stderr = tail(result.stderr);
    return record;
  }
  let data;
  try {
    data = JSON.parse(result.stdout);
  } catch {
    record.error = 'PROBE_PARSE_FAILED';
    record.stderr = tail(result.stdout, 400);
    return record;
  }
  const format = data && data.format ? data.format : {};
  const streams = Array.isArray(data && data.streams) ? data.streams : [];
  record.streams = streams.map((stream) => ({
    index: stream.index,
    type: stream.codec_type || null,
    codec: stream.codec_name || null,
    profile: stream.profile || null,
    width: stream.width === undefined ? null : stream.width,
    height: stream.height === undefined ? null : stream.height,
    sampleRate: toInt(stream.sample_rate),
    channels: stream.channels === undefined ? null : stream.channels,
    bitRate: toInt(stream.bit_rate),
    duration: toNumber(stream.duration)
  }));
  record.format = {
    formatName: format.format_name || null,
    longName: format.format_long_name || null,
    duration: toNumber(format.duration),
    size: toInt(format.size),
    bitRate: toInt(format.bit_rate),
    tags: format.tags || null
  };
  record.duration = record.format.duration;
  const videoStream = streams.find((stream) => stream.codec_type === 'video');
  const audioStream = streams.find((stream) => stream.codec_type === 'audio');
  if (videoStream) {
    record.video = {
      index: videoStream.index,
      codec: videoStream.codec_name || null,
      profile: videoStream.profile || null,
      width: videoStream.width || null,
      height: videoStream.height || null,
      pixFmt: videoStream.pix_fmt || null,
      fps: rateToNumber(videoStream.r_frame_rate || videoStream.avg_frame_rate),
      bitRate: toInt(videoStream.bit_rate),
      frames: toInt(videoStream.nb_frames),
      duration: toNumber(videoStream.duration)
    };
    if (record.duration === null) record.duration = record.video.duration;
  }
  if (audioStream) {
    record.audio = {
      index: audioStream.index,
      codec: audioStream.codec_name || null,
      channels: audioStream.channels || null,
      sampleRate: toInt(audioStream.sample_rate),
      bitRate: toInt(audioStream.bit_rate),
      duration: toNumber(audioStream.duration)
    };
    if (record.duration === null) record.duration = record.audio.duration;
  }
  record.ok = true;
  return record;
}

/* ------------------------------------------------------------ renderers */

/*
 * Which encoders does this ffmpeg actually have? ffmpeg -encoders prints one
 * line per encoder behind a flags column, and the flags are the only thing
 * that distinguishes a real encoder from a header row. Two companion lists
 * come along: the hardware acceleration methods (cuda, qsv, vulkan, opencl)
 * and the build version, so the settings page can say what it found and where.
 */
function parseEncoders(text) {
  const lines = String(text || '').split(NL);
  const map = {};
  let started = false;
  let total = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!started) {
      if (line.indexOf('------') !== -1) started = true;
      continue;
    }
    const parts = line.split(' ').filter(Boolean);
    if (parts.length < 2) continue;
    const flags = parts[0];
    if (flags.length !== 6) continue;
    const letter = flags.charAt(0);
    if (letter !== 'V' && letter !== 'A' && letter !== 'S') continue;
    const name = parts[1];
    map[name] = {
      present: true,
      kind: letter === 'V' ? 'video' : (letter === 'A' ? 'audio' : 'subtitle'),
      description: parts.slice(2).join(' ')
    };
    total += 1;
  }
  return { map: map, total: total };
}

function parseHwaccels(text) {
  const out = [];
  for (const raw of String(text || '').split(NL)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.charAt(line.length - 1) === ':') continue;
    out.push(line);
  }
  return out;
}

function readVersion(text) {
  const first = String(text || '').split(NL)[0] || '';
  const marker = first.indexOf(' version ');
  if (marker === -1) return first ? first.trim() : null;
  return first.slice(marker + 9).trim();
}

export async function renderers(options) {
  const settings = options || {};
  const report = {
    ok: false,
    ffmpeg: null,
    toolVia: null,
    version: null,
    encoders: {},
    present: [],
    count: 0,
    hwaccels: [],
    backends: {
      software: false,
      nvenc: false,
      amf: false,
      qsv: false,
      d3d12va: false,
      vaapi: false,
      videotoolbox: false
    },
    preferred: {},
    error: null
  };
  const tool = resolveTool('ffmpeg', { env: settings.env });
  report.ffmpeg = tool.path;
  report.toolVia = tool.via;
  if (!tool.found) {
    report.error = 'FFMPEG_MISSING';
    return report;
  }
  const timeout = settings.timeout === undefined ? 20000 : settings.timeout;
  const encoderRun = await runProcess(tool.path, ['-hide_banner', '-encoders'], { timeout: timeout });
  if (encoderRun.error || encoderRun.code !== 0) {
    report.error = 'ENCODERS_FAILED';
    report.stderr = tail(encoderRun.stderr);
    return report;
  }
  const parsed = parseEncoders(encoderRun.stdout + NL + encoderRun.stderr);
  report.count = parsed.total;
  for (const name of WATCHED_ENCODERS) {
    const hit = parsed.map[name];
    report.encoders[name] = hit
      ? { present: true, kind: hit.kind, description: hit.description }
      : { present: false, kind: null, description: null };
    if (hit) report.present.push(name);
  }
  const versionRun = await runProcess(tool.path, ['-hide_banner', '-version'], { timeout: timeout });
  if (versionRun.code === 0) report.version = readVersion(versionRun.stdout);
  const hwRun = await runProcess(tool.path, ['-hide_banner', '-hwaccels'], { timeout: timeout });
  if (hwRun.code === 0) report.hwaccels = parseHwaccels(hwRun.stdout);
  report.backends.software = !!(parsed.map.libx264 || parsed.map.libx265 || parsed.map['libaom-av1'] || parsed.map.libsvtav1);
  report.backends.nvenc = !!(parsed.map.h264_nvenc || parsed.map.hevc_nvenc || parsed.map.av1_nvenc);
  report.backends.amf = !!(parsed.map.h264_amf || parsed.map.hevc_amf || parsed.map.av1_amf);
  report.backends.qsv = !!(parsed.map.h264_qsv || parsed.map.hevc_qsv || parsed.map.av1_qsv);
  report.backends.d3d12va = !!(parsed.map.h264_d3d12va || parsed.map.hevc_d3d12va || parsed.map.av1_d3d12va);
  report.backends.vaapi = !!(parsed.map.h264_vaapi || parsed.map.hevc_vaapi || parsed.map.av1_vaapi);
  report.backends.videotoolbox = !!(parsed.map.h264_videotoolbox || parsed.map.hevc_videotoolbox);
  /* For each target, the encoder the export dialog should pre-select: the
   * hardware one when the machine has it, the software one otherwise. */
  for (const id of Object.keys(TARGETS)) {
    const spec = TARGETS[id];
    let pick = parsed.map[spec.encoder] ? spec.encoder : null;
    let hardwarePick = null;
    for (const candidate of spec.hardware) {
      if (parsed.map[candidate]) { hardwarePick = candidate; break; }
    }
    report.preferred[id] = {
      encoder: hardwarePick || pick,
      hardware: hardwarePick,
      software: pick
    };
  }
  report.ok = true;
  return report;
}

/* ----------------------------------------------------------------- plan */

/*
 * The dry run the export dialog shows before it commits. Pure by contract:
 * no stat, no probe, no clock. What it can tell from the arguments alone it
 * says in steps; anything that would need the disk is a warning instead.
 */
export function plan(action, input) {
  const settings = input || {};
  const name = String(action || '').toLowerCase();
  const steps = [];
  const warnings = [];
  if (name === 'transcode' || name === 'remux' || name === 'export') {
    const id = normalizeTarget(settings.target || (name === 'remux' ? 'copy' : 'h264'));
    const source = settings.input || settings.path || '';
    if (!id) {
      return {
        ok: false,
        action: name,
        steps: steps,
        warnings: warnings,
        error: 'UNKNOWN_TARGET',
        message: '不支持的目标格式：' + String(settings.target)
      };
    }
    if (!source) {
      return {
        ok: false,
        action: name,
        steps: steps,
        warnings: warnings,
        error: 'MISSING_INPUT',
        message: '缺少输入文件路径'
      };
    }
    const spec = TARGETS[id];
    const output = settings.output || defaultOutput(source, id);
    steps.push({ kind: 'resolve', detail: '定位 ffmpeg（PATH、VIDEOCRAFT_FFMPEG 或已知安装路径）' });
    steps.push({ kind: 'input', detail: '读取 ' + String(source) });
    steps.push({
      kind: 'transcode',
      detail: '用 ' + (settings.encoder || spec.encoder) + ' 编码，封装为 ' + spec.container + '（' + spec.label + '）'
    });
    steps.push({ kind: 'output', detail: '写出 ' + String(output) });
    steps.push({ kind: 'verify', detail: '转码后用 probe() 复核时长、编码与字节数' });
    if (spec.kind === 'audio') warnings.push('目标为纯音频，输入的视频轨会被丢弃');
    if (spec.kind === 'copy') warnings.push('直接封装不重编码，输入与输出的容器必须互相兼容');
    const sourceExt = path.extname(String(source)).toLowerCase();
    if (sourceExt && sourceExt !== '.' + spec.container) {
      warnings.push('输入为 ' + sourceExt + '，输出为 .' + spec.container + '，需要重编码而非拷贝');
    }
    if (settings.encoder) warnings.push('已覆盖默认编码器为 ' + String(settings.encoder));
    if (settings.scale) warnings.push('将缩放至 ' + String(settings.scale));
    return {
      ok: true,
      action: name,
      target: id,
      input: String(source),
      output: String(output),
      encoder: settings.encoder || spec.encoder,
      container: spec.container,
      command: buildTranscodeArgs({
        input: String(source),
        output: String(output),
        target: id,
        overwrite: settings.overwrite,
        encoder: settings.encoder,
        scale: settings.scale,
        start: settings.start,
        duration: settings.duration
      }),
      steps: steps,
      warnings: warnings
    };
  }
  if (name === 'probe') {
    const source = settings.input || settings.path || '';
    if (!source) {
      return { ok: false, action: name, steps: steps, warnings: warnings, error: 'MISSING_INPUT', message: '缺少要探测的文件路径' };
    }
    steps.push({ kind: 'resolve', detail: '定位 ffprobe（PATH、VIDEOCRAFT_FFPROBE 或已知安装路径）' });
    steps.push({ kind: 'probe', detail: 'ffprobe -show_format -show_streams ' + String(source) });
    steps.push({ kind: 'parse', detail: '解析时长、编码、分辨率、码率与流列表' });
    return {
      ok: true,
      action: name,
      input: String(source),
      command: ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', String(source)],
      steps: steps,
      warnings: warnings
    };
  }
  if (name === 'renderers') {
    steps.push({ kind: 'resolve', detail: '定位 ffmpeg' });
    steps.push({ kind: 'encoders', detail: 'ffmpeg -hide_banner -encoders 并解析可用编码器' });
    steps.push({ kind: 'hwaccels', detail: 'ffmpeg -hide_banner -hwaccels 并解析硬件加速后端' });
    steps.push({ kind: 'pick', detail: '按目标格式挑选首选编码器（硬件优先）' });
    return {
      ok: true,
      action: name,
      command: ['ffmpeg', '-hide_banner', '-encoders'],
      steps: steps,
      warnings: warnings
    };
  }
  return {
    ok: false,
    action: name || null,
    steps: steps,
    warnings: warnings,
    error: 'UNKNOWN_ACTION',
    message: '未知动作：' + String(action)
  };
}

/* ------------------------------------------------------------------ run */

async function transcode(settings) {
  const options = settings || {};
  const source = options.input || options.path || '';
  const id = normalizeTarget(options.target || options.format || 'h264');
  const envelope = { ok: false, action: 'transcode', result: null, error: null };
  if (!source) {
    envelope.error = 'MISSING_INPUT';
    return envelope;
  }
  if (!id) {
    envelope.error = 'UNKNOWN_TARGET';
    return envelope;
  }
  let stat;
  try {
    stat = fs.statSync(source);
  } catch {
    envelope.error = 'INPUT_NOT_FOUND';
    envelope.result = { input: String(source) };
    return envelope;
  }
  if (!stat.isFile()) {
    envelope.error = 'NOT_A_FILE';
    envelope.result = { input: String(source) };
    return envelope;
  }
  const spec = TARGETS[id];
  const output = String(options.output || defaultOutput(source, id));
  const overwrite = options.overwrite !== false;
  if (!overwrite && fs.existsSync(output)) {
    envelope.error = 'OUTPUT_EXISTS';
    envelope.output = output;
    envelope.result = { input: String(source), output: output };
    return envelope;
  }
  const tool = resolveTool('ffmpeg', { env: options.env });
  if (!tool.found) {
    envelope.error = 'FFMPEG_MISSING';
    envelope.result = { input: String(source), output: output };
    return envelope;
  }
  try {
    fs.mkdirSync(path.dirname(output), { recursive: true });
  } catch {
    envelope.error = 'OUTPUT_DIR_UNWRITABLE';
    envelope.output = output;
    return envelope;
  }
  const args = buildTranscodeArgs({
    input: source,
    output: output,
    target: id,
    overwrite: overwrite,
    encoder: options.encoder,
    scale: options.scale,
    start: options.start,
    duration: options.duration
  });
  const started = Date.now();
  const run = await runProcess(tool.path, args, {
    timeout: options.timeout === undefined ? 600000 : options.timeout
  });
  const elapsed = Date.now() - started;
  let bytes = 0;
  try {
    bytes = fs.statSync(output).size;
  } catch {
    bytes = 0;
  }
  const ok = run.code === 0 && bytes > 0;
  envelope.ok = ok;
  envelope.exitCode = run.code;
  envelope.output = output;
  envelope.bytes = bytes;
  envelope.stderr = tail(run.stderr);
  envelope.command = [tool.path].concat(args);
  envelope.result = {
    target: id,
    encoder: options.encoder || spec.encoder,
    container: spec.container,
    input: String(source),
    output: output,
    exitCode: run.code,
    bytes: bytes,
    durationMs: elapsed,
    timedOut: run.timedOut,
    stderr: tail(run.stderr),
    command: [tool.path].concat(args)
  };
  if (!ok) {
    envelope.error = run.timedOut ? 'TRANSCODE_TIMEOUT' : 'TRANSCODE_FAILED';
  }
  return envelope;
}

/*
 * The one function that starts a process. Everything else either describes
 * what would happen (plan) or reads (probe, renderers).
 */
export async function run(action, input) {
  const name = String(action || '').toLowerCase();
  const settings = input || {};
  if (name === 'probe') {
    const info = await probe(settings.input || settings.path || settings, settings);
    return { ok: info.ok === true, action: 'probe', result: info, error: info.error || undefined };
  }
  if (name === 'renderers') {
    const info = await renderers(settings);
    return { ok: info.ok === true, action: 'renderers', result: info, error: info.error || undefined };
  }
  if (name === 'transcode' || name === 'remux' || name === 'export') {
    const envelope = await transcode(Object.assign({}, settings, {
      target: settings.target || (name === 'remux' ? 'copy' : settings.target)
    }));
    envelope.action = name;
    return envelope;
  }
  return {
    ok: false,
    action: name || null,
    result: null,
    error: 'UNKNOWN_ACTION',
    message: '未知动作：' + String(action)
  };
}

/* --------------------------------------------------------- capabilities */

export function capabilities() {
  return {
    id: META.id,
    name: META.name,
    version: META.version,
    features: ['probe', 'transcode', 'remux', 'renderers', 'plan'],
    formats: META.codecs.map((codec) => codec.ext).concat([
      '.mp4', '.mkv', '.mov', '.webm', '.avi',
      '.mp3', '.wav', '.flac', '.aac', '.ogg'
    ]),
    targets: Object.keys(TARGETS),
    hosts: META.hosts.slice(),
    implemented: true
  };
}

export default {
  META,
  TARGETS,
  capabilities,
  plan,
  run,
  probe,
  renderers,
  resolveTool,
  runProcess,
  buildTranscodeArgs,
  defaultOutput,
  normalizeTarget
};
