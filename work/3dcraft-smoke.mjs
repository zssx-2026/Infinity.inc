import m from 'file:///D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/InfinityStudio/src/apps/3dcraft.js?v=1793527309855';
import path from 'node:path';import os from 'node:os';import fs from 'node:fs';
let pass=0,fail=0;
function check(d,cond,e){if(cond){pass+=1;console.log('ok   '+d)}else{fail+=1;console.log('FAIL '+d+(e?' <- '+JSON.stringify(e):''))}}
let cap=m.capabilities();check('capabilities',cap.implemented===true&&cap.id==='3dcraft');
let obj="v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nf 1 2 3\nf 1 3 4\nf 1 4 2\nf 2 4 3\n";
let po=m.parseObj(obj);check('parseObj cube',po.vertices.length===4&&po.triangleCount===4);
let eo=m.exportObj(po);let po2=m.parseObj(eo);check('exportObj roundtrip',po2.triangleCount===4);
let buf=Buffer.alloc(184);buf.writeUInt32LE(2,80);
let stl;try{stl=m.parseStl(buf);}catch(err){fail+=1;console.log('FAIL parseStl 2 triangles <- '+err.message);stl={ok:false,triangleCount:0};}check('parseStl 2 triangles',stl.triangleCount===2);
let mk=await m.run('stats',{input:'/nope.obj'});check('run stats missing',mk.ok===false&&typeof mk.error==='string');
let unk=await m.run('ghost',{});check('unknown run code',unk.error==='UNKNOWN_ACTION');
let pl=m.plan('convert',{input:'a.obj',output:'b.stl',format:'stl'});check('plan convert steps',pl.steps.length>=1);
console.log('3DCRAFT-SMOKE-PASS '+pass+'/'+(pass+fail));process.exitCode=fail>0?1:0;
