// work/_gitee/probe-applications.mjs
const T = process.env['gitee_zssx-1'];
const API = 'https://gitee.com/api/v5';
const q = 'access_token=' + encodeURIComponent(T);
const j = async (p, m = 'GET') => { const r = await fetch(API + p + (p.includes('?') ? '&' : '?') + q, { method: m }); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t.slice(0, 120); } return { s: r.status, b }; };
const apps = await j('/repos/zssx2026/applications');
console.log('applications repo status=' + apps.s + '  full_name=' + (apps.b.full_name || '?') + '  default=' + (apps.b.default_branch || '?') + '  html=' + (apps.b.html_url || '?'));
const rel = await j('/repos/zssx2026/applications/releases');
console.log('releases status=' + rel.s + ' count=' + (Array.isArray(rel.b) ? rel.b.length : 'n/a'));
if (Array.isArray(rel.b)) for (const r of rel.b.slice(0, 10)) console.log('  tag=' + r.tag_name + ' name=' + r.name + ' assets=' + ((r.assets || []).length));
const branches = await j('/repos/zssx2026/applications/branches');
console.log('branches=' + (Array.isArray(branches.b) ? branches.b.map(x => x.name).join(',') : branches.s));
const tree = await j('/repos/zssx2026/applications/git/trees/master?recursive=1');
console.log('tree status=' + tree.s + ' entries=' + (tree.b && tree.b.tree ? tree.b.tree.length : 'n/a') + ' truncated=' + (tree.b && tree.b.truncated));
if (tree.b && tree.b.tree) for (const e of tree.b.tree.slice(0, 12)) console.log('  ' + e.path);
// attachment upload API existence probe (GET only, no side effect)
for (const p of ['/repos/zssx2026/applications/releases/1/attach_files', '/repos/zssx2026/applications/pages']) {
  const r = await j(p);
  console.log('probe ' + p + ' -> ' + r.s);
}
