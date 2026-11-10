import { execFileSync } from 'node:child_process';
const ORG='Infinity-Studio-craft', REPO='infinity-studio-craft.github.io', API='https://api.github.com';
const out=execFileSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8'});
const TOKEN=out.split(/\r?\n/).find(l=>l.startsWith('password=')).slice(9).trim();
const H={Authorization:'Bearer '+TOKEN,'User-Agent':'infinity-pages',Accept:'application/vnd.github+json','Content-Type':'application/json'};
async function call(m,p,b){const r=await fetch(API+p,{method:m,headers:H,body:b===undefined?undefined:JSON.stringify(b)});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch(e){d={raw:t.slice(0,200)}};return {ok:r.ok,status:r.status,data:d};}
const p=await call('GET','/repos/'+ORG+'/'+REPO+'/pages');
console.log('pages', p.status, JSON.stringify(p.data).slice(0,400));
const b=await call('GET','/repos/'+ORG+'/'+REPO+'/pages/builds/latest');
console.log('build', b.status, JSON.stringify(b.data).slice(0,600));
const nb=await call('POST','/repos/'+ORG+'/'+REPO+'/pages/builds');
console.log('trigger', nb.status, JSON.stringify(nb.data).slice(0,300));
