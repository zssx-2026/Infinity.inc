// work/gitee-releases.mjs — mirror a release (tag + notes + assets) onto Gitee.
// Gitee needs the tag to exist before a release can point at it, and an empty
// repository cannot hold a tag, so a README is committed first when needed.
//
// usage: node work/gitee-releases.mjs <owner/repo> <tag> <name> <file...> [--branch master]
import fs from 'node:fs';
import path from 'node:path';

const T = process.env['gitee_zssx-1'];
const API = 'https://gitee.com/api/v5';
const q = 'access_token=' + encodeURIComponent(T);
const [repo, tag, name, ...rest] = process.argv.slice(2);
const bi = rest.indexOf('--branch');
const BRANCH = bi >= 0 ? rest[bi + 1] : 'master';
const files = rest.filter((x, i) => x !== '--branch' && rest[i - 1] !== '--branch');
if (!repo || !tag || !name || !T) { console.error('usage: node work/gitee-releases.mjs <owner/repo> <tag> <name> <file...>'); process.exit(2); }

const j = async (m, p, body) => {
  const res = await fetch(API + p + (p.includes('?') ? '&' : '?') + q, { method: m, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const t = await res.text(); let b; try { b = JSON.parse(t); } catch { b = t.slice(0, 200); }
  return { s: res.status, b };
};

const ensureReadme = async () => {
  const got = await j('GET', '/repos/' + repo + '/contents/README.md');
  if (got.s === 200) return 'present';
  const made = await j('POST', '/repos/' + repo + '/contents/README.md', {
    content: Buffer.from('# ' + repo + '\n\nInfinity.Inc mirror.\n').toString('base64'),
    message: 'mirror: initialise', branch: BRANCH,
  });
  return made.s === 201 ? 'created' : 'failed ' + made.s + ' ' + JSON.stringify(made.b).slice(0, 140);
};
const ensureTag = async () => {
  const list = await j('GET', '/repos/' + repo + '/tags');
  if (Array.isArray(list.b) && list.b.some(t => t.name === tag)) return 'present';
  const made = await j('POST', '/repos/' + repo + '/tags', { refs: BRANCH, tag_name: tag, tag_message: tag });
  return made.s <= 201 ? 'created' : 'failed ' + made.s + ' ' + JSON.stringify(made.b).slice(0, 140);
};
const releaseId = async () => {
  const list = await j('GET', '/repos/' + repo + '/releases');
  if (Array.isArray(list.b)) { const hit = list.b.find(r => r.tag_name === tag); if (hit) return hit.id; }
  const made = await j('POST', '/repos/' + repo + '/releases', { tag_name: tag, name, body: 'Infinity.Inc ' + name, target_commitish: BRANCH, prerelease: true });
  if (made.b && made.b.id) return made.b.id;
  console.log('release create failed: ' + made.s + ' ' + JSON.stringify(made.b).slice(0, 180));
  return null;
};

const main = async () => {
  console.log('repo=' + repo + ' branch=' + BRANCH + ' tag=' + tag);
  console.log('readme: ' + await ensureReadme());
  console.log('tag: ' + await ensureTag());
  const id = await releaseId();
  console.log('release id: ' + id);
  if (!id) process.exit(3);
  for (const f of files) {
    if (!fs.existsSync(f)) { console.log('MISSING ' + f); continue; }
    const buf = fs.readFileSync(f);
    const fd = new FormData();
    fd.append('file', new Blob([buf]), path.basename(f));
    const up = await fetch(API + '/repos/' + repo + '/releases/' + id + '/attach_files?' + q, { method: 'POST', body: fd });
    const t = await up.text();
    console.log('attach ' + path.basename(f) + ' (' + buf.length + ' B) -> ' + up.status + ' ' + t.slice(0, 200));
  }
};
main();
