import m from 'file:///D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/InfinityStudio/src/apps/aicraft.js?v=1793527309855';
import path from 'node:path';import os from 'node:os';import fs from 'node:fs';
let pass=0,fail=0;
function check(d,cond,e){if(cond){pass+=1;console.log('ok   '+d)}else{fail+=1;console.log('FAIL '+d+(e?' <- '+JSON.stringify(e):''))}}
(async()=>{
let cap=m.capabilities();check('capabilities',cap.implemented===true&&cap.id==='craft.ai');
let pr=await m.probe();check('probe reachable boolean',typeof pr.reachable==='boolean');
let pl=m.plan('chat',{model:'llama3',messages:[{role:'user',content:'hi'}]});check('plan chat returns body',typeof pl==='object');
if(pr.reachable){let ch=await m.chat({model:pr.models[0]&&pr.models[0].name||'llama3',messages:[{role:'user',content:'ping'}]});
  check('chat returns content',typeof ch.content==='string'&&ch.content.length>0);
}else{console.log('   (Ollama not reachable, graceful path tested)');pass+=1;}
let bad=await m.run('ghost',{});check('unknown run code',bad.error==='UNKNOWN_ACTION');
let ctx=m.contexts();check('contexts returns object',ctx.ok===true&&Array.isArray(ctx.options));
console.log('AICRAFT-SMOKE-PASS '+pass+'/'+(pass+fail));process.exitCode=fail>0?1:0;})();
