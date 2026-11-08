// work/_gitee/test-release.mjs — create a Gitee release and attach one file, to learn the API.
import fs from 'node:fs';
const T = process.env['gitee_zssx-1'];
const API = 'https://gitee.com/api/v5';
const q = 'access_token=' + encodeURIComponent(T);
const REPO = 'zssx2026/infinitytoolbox';
const j = async (m, p, body, raw) => {
  const res = await fetch(API + p + (p.includes('?') ? '&' : '?') + q, { method: m, headers: raw ? raw.headers : (body ? { 'content-type': 'application/json' } : undefined), body: raw ? raw.body : (body ? JSON.stringify(body) : undefined) });
  const t = await res.text(); let b; try { b = JSON.parse(t); } catch { b = t.slice(0, 160); }
  return { s: res.status, b };
};
let r = await j('POST', '/repos/' + REPO + '/releases', { tag_name: 'v1.0.0-pre4', name: 'Infinity Toolbox v1.0.0-pre4', body: 'Infinity Toolbox', target_commitish: 'master', prerelease: true });
console.log('create release -> ' + r.s + ' ' + JSON.stringify(r.b).slice(0, 200));
const id = r.b && r.b.id;
if (!id) { const list = await j('GET', '/repos/' + REPO + '/releases'); console.log('existing releases: ' + (Array.isArray(list.b) ? list.b.map(x => x.id + ':' + x.tag_name).join(', ') : list.s)); }
const releaseId = id || (Array.isArray((await j('GET', '/repos/' + REPO + '/releases')).b) ? (await j('GET', '/repos/' + REPO + '/releases')).b[0]?.id : null);
if (releaseId) {
  const file = 'ITB Tools/out/ZRenamer_2.1.0_win64_other.itbt';
  const buf = fs.readFileSync(file);
  const fd = new FormData();
  fd.append('file', new Blob([buf]), 'ZRenamer_2.1.0_win64_other.itbt');
  const up = await fetch(API + '/repos/' + REPO + '/releases/' + releaseId + '/attach_files?' + q, { method: 'POST', body: fd });
  const t = await up.text();
  console.log('attach -> ' + up.status + ' ' + t.slice(0, 250));
}
