/*
 * bootstrap.js - the two tools the cloud wants for speed.
 *
 * Neither tool is required. They are resolved in this order:
 *
 *   1. program.json, written by a previous run
 *   2. the well-known install locations on this machine
 *   3. a download, last, because it costs time and may not be reachable
 *
 * Step 2 matters more than it looks. FastGithub is often already installed and
 * running, and fetching a second copy of a running tool is both slow and
 * confusing. Checking first turns a two-minute download into a stat().
 *
 * Every network attempt has a short ceiling. A bootstrap that hangs is worse
 * than one that fails: the cloud works without either tool, just slower.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

/* Where each tool comes from, and where it is often already installed. */
export const SOURCES = {
  aria2: {
    url: 'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip',
    mirror: 'https://gh-proxy.com/https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip',
    exe: 'aria2c.exe',
    note: 'aria2 1.37.0 (64-bit Windows)',
    known: [
      'D:/program/UUyc/GameViewer/bin/aria2c.exe',
      'C:/Program Files/aria2/aria2c.exe'
    ]
  },
  fastgithub: {
    url: 'https://github.com/dotnetcore/FastGithub/releases/download/2.1.4/fastgithub_win-x64.zip',
    mirror: 'https://gh-proxy.com/https://github.com/dotnetcore/FastGithub/releases/download/2.1.4/fastgithub_win-x64.zip',
    exe: 'fastgithub.exe',
    note: 'FastGithub 2.1.4 (win-x64)',
    known: [
      'D:/program/Fastgithub/fastgithub.exe',
      'C:/Program Files/FastGithub/fastgithub.exe'
    ]
  }
};

/*
 * Fetch one URL. The timeout is deliberately short: a bootstrap step that can
 * hang for half an hour is a bootstrap step that will.
 */
function curl(url, outPath, proxy, seconds) {
  return new Promise(function (resolve) {
    const limit = String(seconds || 120);
    const args = ['-sSL', '--max-time', limit, '--connect-timeout', '15', '-o', outPath];
    if (proxy) args.push('--proxy', proxy);
    args.push(url);
    execFile('curl.exe', args, { maxBuffer: 8 * 1024 * 1024, timeout: (seconds || 120) * 1000 + 15000 }, function (err) {
      if (err) { resolve(false); return; }
      try { resolve(fs.statSync(outPath).size > 1024); } catch (e) { resolve(false); }
    });
  });
}

/* Unpack a zip. 7-Zip when present, tar when not. */
function unzip(zipPath, destDir, sevenZip) {
  return new Promise(function (resolve) {
    fs.mkdirSync(destDir, { recursive: true });
    const tries = [];
    if (sevenZip && fs.existsSync(sevenZip)) tries.push({ exe: sevenZip, args: ['x', zipPath, '-o' + destDir, '-y'] });
    tries.push({ exe: 'tar.exe', args: ['-xf', zipPath, '-C', destDir] });
    let i = 0;
    const next = () => {
      if (i >= tries.length) { resolve(false); return; }
      const t = tries[i++];
      execFile(t.exe, t.args, { maxBuffer: 8 * 1024 * 1024, timeout: 180000 }, function (err) { if (err) next(); else resolve(true); });
    };
    next();
  });
}

/* Find a file anywhere under a directory, a few levels deep. */
function findFile(dir, name, depth) {
  if ((depth || 0) > 4) return null;
  let es;
  try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return null; }
  for (const e of es) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const hit = findFile(p, name, (depth || 0) + 1); if (hit) return hit; }
    else if (e.name.toLowerCase() === name.toLowerCase()) return p;
  }
  return null;
}

/*
 * Make sure one tool exists. Returns its path, or null when it could not be
 * obtained - the caller decides whether that is fatal.
 */
export async function ensureOne(key, baseDir, opts, say) {
  const o = opts || {};
  const spec = SOURCES[key];
  const sayIt = say || function () {};
  const toolsDir = path.join(baseDir, 'program', 'tools');
  const target = path.join(toolsDir, spec.exe);
  if (fs.existsSync(target) && fs.statSync(target).size > 1024) return target;

  /* Somewhere on this machine already? */
  for (const c of spec.known) {
    if (fs.existsSync(c) && fs.statSync(c).size > 1024) {
      sayIt(key + ': using the copy already installed at ' + c);
      try {
        fs.mkdirSync(toolsDir, { recursive: true });
        fs.copyFileSync(c, target);
        return target;
      } catch (e) { return c; }
    }
  }

  /* Not present: download it. Short ceilings on every attempt. */
  fs.mkdirSync(toolsDir, { recursive: true });
  const zip = path.join(toolsDir, key + '.zip');
  sayIt('fetching ' + spec.note);

  let got = false;
  if (o.proxy) got = await curl(spec.mirror, zip, o.proxy, 180);
  if (!got) got = await curl(spec.mirror, zip, null, 180);
  if (!got) got = await curl(spec.url, zip, o.proxy, 180);
  if (!got) { sayIt(key + ': not reachable, continuing without it'); return null; }

  const outDir = path.join(toolsDir, key);
  const ok = await unzip(zip, outDir, o.sevenZip);
  try { fs.unlinkSync(zip); } catch (e) { }
  if (!ok) { sayIt(key + ': the archive would not unpack'); return null; }

  const found = findFile(outDir, spec.exe, 0);
  if (!found) { sayIt(spec.exe + ' was not inside the archive'); return null; }
  if (found !== target) { try { fs.copyFileSync(found, target); } catch (e) { return found; } }
  sayIt(key + ' is ready');
  return target;
}

/*
 * Resolve both tools and record what was found. program.json lets the next run
 * skip the search entirely.
 */
export async function ensureTools(baseDir, opts, say) {
  const o = opts || {};
  const sayIt = say || function () {};
  const manifestPath = path.join(baseDir, 'program.json');
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) { manifest = {}; }

  for (const key of Object.keys(SOURCES)) {
    const have = manifest[key];
    if (have && fs.existsSync(have)) continue;
    const got = await ensureOne(key, baseDir, o, sayIt);
    if (got) manifest[key] = got;
  }

  /* The FastGithub UI sits beside its engine, when both are present. */
  if (manifest.fastgithub) {
    const ui = path.join(path.dirname(manifest.fastgithub), 'FastGithub.UI.exe');
    if (fs.existsSync(ui)) manifest.fastgithubUi = ui;
  }

  try { fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8'); } catch (e) { }
  return manifest;
}
