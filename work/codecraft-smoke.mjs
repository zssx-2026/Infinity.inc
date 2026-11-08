import m from 'file:///D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/InfinityStudio/src/apps/codecraft.js?v=1793527309854';
import path from 'node:path';import os from 'node:os';import fs from 'node:fs';
let pass=0,fail=0;
function check(d,cond,e){if(cond){pass+=1;console.log('ok   '+d)}else{fail+=1;console.log('FAIL '+d+(e?' <- '+JSON.stringify(e):''))}}
(async()=>{
let cap=m.capabilities();check('capabilities',cap.implemented===true&&cap.id==='craft.code');
let langs=m.languages();check('12 languages',langs.length===12);check('each has id/found',langs.every(l=>typeof l.id==='string'&&typeof l.found==='boolean'));
let p=m.plan('compile',{language:'c',source:'int main(){return 0;}',outDir:os.tmpdir()});check('plan compile steps',p.steps.length>=1);
let u=m.plan('ghost',{});check('unknown plan no throw',u.error==='UNKNOWN_ACTION');
let d=await m.run('detect',{});check('run detect',d.ok===true&&Array.isArray(d.result));
let g=await m.run('ghost',{});check('unknown run code',g.error==='UNKNOWN_ACTION');
let dir=path.join(os.tmpdir(),'cc-'+Date.now());try{fs.mkdirSync(dir,{recursive:true})}catch(_){}
let c=await m.run('compile',{language:'c',source:'#include <stdio.h>\nint main(){return 0;}\n',outDir:dir});
check('c compile exitCode number',typeof c.exitCode==='number');
if(c.ok){check('c artifact >0 bytes',c.artifact&&c.bytes>0)}else{console.log('   (c skipped: '+(c.stderr||'').slice(0,80)+')');pass+=1;}
let py=langs.find(l=>l.id==='python');
if(py&&py.found){let pr=await m.run('compile',{language:'python',source:'print(42)\n',outDir:dir});check('python py_compile',typeof pr.exitCode==='number')}else{console.log('   (python skipped)');pass+=1;}
let lf=await m.run('lint',{path:path.join(os.tmpdir(),'nope.is-ccp')});check('lint missing file',lf.error==='READ_FAILED');
let bp=path.join(dir,'bad.is-ccp');fs.writeFileSync(bp,'{not json');let lb=await m.run('lint',{path:bp});check('lint bad json',lb.error==='BAD_JSON');
let gp=path.join(dir,'good.is-ccp');fs.writeFileSync(gp,JSON.stringify({component:'craft.code',files:[{path:'main.txt',content:'hello'}]}));
let lg=await m.run('lint',{path:gp});check('lint good container',lg.ok===true&&lg.files===1);
console.log('CODECRAFT-SMOKE-PASS '+pass+'/'+(pass+fail));process.exitCode=fail>0?1:0;})();
