/*
 * uninstall.js - removing what the studio installed.
 *
 * A studio that can install but never remove is a one-way door: the user ends
 * up uninstalling by hand from Settings, and the next release leaves orphans
 * behind. So every product the remote catalog installs can be removed from the
 * same table.
 *
 * The installers are NSIS and per-user, so the removal is the shipped
 * Uninstall.exe run with /S. Two details matter:
 *   - _?=<dir> tells NSIS not to copy itself to %TEMP% first, which is what
 *     makes the exit code mean "the removal finished" instead of "the copy
 *     started";
 *   - the uninstaller can exit 0 before the directory is gone, so the honest
 *     answer is the directory disappearing, not the exit code alone.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

/* Same per-user root the NSIS scripts install into (RequestExecutionLevel user,
 * $LOCALAPPDATA\Programs\Infinity.Inc\<Product>). INFINITY_INSTALL_ROOT
 * exists so a test can point at a scratch tree instead of the real one. */
export function installRoot() {
  const override = String(process.env.INFINITY_INSTALL_ROOT || '').trim();
  if (override) return override;
  const local = String(process.env.LOCALAPPDATA || '').trim() || path.join(process.env.USERPROFILE || '.', 'AppData', 'Local');
  return path.join(local, 'Programs', 'Infinity.Inc');
}

function norm(value) {
  return String(value === undefined || value === null ? '' : value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/* "Infinity Cloud" (catalog) and "InfinityCloud" (directory) are the same
 * product; the comparison must not depend on which spelling reached us. */
export function installedDirs() {
  let entries;
  try { entries = fs.readdirSync(installRoot(), { withFileTypes: true }); } catch (error) { return []; }
  return entries.filter((e) => e.isDirectory()).map((e) => ({ name: e.name, dir: path.join(installRoot(), e.name) }));
}

export function findInstalled(product) {
  const names = [product && product.name, product && product.asset, product && product.id]
    .map(norm).filter(Boolean);
  const dirs = installedDirs();
  for (const entry of dirs) {
    if (names.indexOf(norm(entry.name)) >= 0) return entry.dir;
  }
  /* Fall back to a prefix match so "InfinityPackageManager" still matches a
   * directory the installer named with spaces. */
  for (const entry of dirs) {
    const n = norm(entry.name);
    if (names.some((want) => want && (n.startsWith(want) || want.startsWith(n)))) return entry.dir;
  }
  return null;
}

export function listInstalled(products) {
  const out = [];
  for (const product of products || []) {
    const dir = findInstalled(product);
    if (dir) out.push({ id: product.id, asset: product.asset, name: product.name, dir: dir });
  }
  return out;
}

function waitGone(dir, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (!fs.existsSync(dir)) { resolve(true); return; }
      if (Date.now() - started > timeoutMs) { resolve(false); return; }
      setTimeout(tick, 500);
    };
    tick();
  });
}

/* Uninstall one product. Never throws: the caller is a route that has to answer
 * with a status either way. */
export async function uninstallProduct(product, opts) {
  const o = opts || {};
  const dir = findInstalled(product);
  if (!dir) return { ok: false, error: 'not installed', asset: product && product.asset };
  const exe = path.join(dir, 'Uninstall.exe');
  if (!fs.existsSync(exe)) return { ok: false, error: 'no uninstaller in ' + dir, dir: dir };
  /* Removing the running studio would kill the process that is answering. */
  if (norm(path.basename(dir)) === 'infinitystudio') {
    return { ok: false, error: 'refusing to uninstall the running installer', dir: dir };
  }
  const code = await new Promise((resolve) => {
    let child;
    try {
      child = spawn(exe, ['/S', '_?=' + dir], { windowsHide: true, stdio: 'ignore', cwd: dir });
    } catch (error) {
      resolve(-1);
      return;
    }
    const timer = setTimeout(() => { try { child.kill(); } catch (error) { /* gone */ } resolve(-2); }, o.timeoutMs || 300000);
    child.once('error', () => { clearTimeout(timer); resolve(-1); });
    child.once('exit', (c) => { clearTimeout(timer); resolve(c === null ? -1 : c); });
  });
  const gone = await waitGone(dir, o.waitMs || 60000);
  return { ok: gone, asset: product && product.asset, dir: dir, code: code, removed: gone };
}
