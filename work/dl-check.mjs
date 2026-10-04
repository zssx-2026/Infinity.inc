
const API='https://api.github.com/repos/zssx-2026/Infinity-Cloud/releases?per_page=30';
const r = await fetch(API,{headers:{Accept:'application/vnd.github+json'}});
console.log('api status ' + r.status);
const rels = await r.json();
const parse=(n)=>{const m=/^(.+?)_([0-9][^_]*)_(win64|win32|x86|arm64|x64)_([a-z]+)\.[a-z0-9]+$/i.exec(n);return m?{v:m[2],p:m[3].toLowerCase(),k:m[4].toLowerCase()}:null;};
for (const rel of rels.slice(0,6)) {
  const rows=(rel.assets||[]).map(a=>({a,p:parse(a.name)})).filter(x=>x.p&&x.p.p==='win64');
  console.log(rel.tag_name+' prerelease='+rel.prerelease+'  win64 files='+rows.length+'  '+rows.map(x=>x.p.k+':'+x.a.name+'('+x.a.size+'B)').join(', '));
}
