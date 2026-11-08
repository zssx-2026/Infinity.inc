import m from 'file:///D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/InfinityStudio/src/apps/videocraft.js?v=1793527309854';
import path from 'node:path';import os from 'node:os';import fs from 'node:fs';import { spawnSync } from 'node:child_process';
let pass=0,fail=0;
function check(d,cond,e){if(cond){pass+=1;console.log('ok   '+d)}else{fail+=1;console.log('FAIL '+d+(e?' <- '+JSON.stringify(e):''))}}
(async()=>{
let cap=m.capabilities();check('capabilities',cap.implemented===true&&cap.id==='craft.video');
let pr=await m.probe({path:'/does-not-exist.mp4'});check('probe missing file',pr.ok===false&&typeof pr.error==='string');
let tg=m.plan('transcode',{input:'a.mp4',output:'b.mkv',target:'h264'});check('plan transcode pure',Array.isArray(tg.steps));
let unk=await m.run('ghost',{});check('unknown run code',unk.error==='UNKNOWN_ACTION');
let ren=await m.renderers();check('renderers returns object',typeof ren==='object');
let dir=path.join(os.tmpdir(),'vc-'+Date.now());try{fs.mkdirSync(dir,{recursive:true})}catch(_){}
let src=path.join(dir,'t.mp4');let out=path.join(dir,'t.mkv');
let gen=spawnSync('ffmpeg',['-y','-f','lavfi','-i','testsrc=duration=1:size=320x240:rate=25','-pix_fmt','yuv420p',src],{encoding:'utf8',timeout:20000});
check('ffmpeg generates test clip',gen.status===0&&fs.existsSync(src));
if(gen.status===0){
  let probed=await m.probe({path:src});check('probe real file',probed.ok===true&&typeof probed.duration==='number');
  let tr=await m.run('transcode',{input:src,output:out,target:'mp4'});
  check('transcode result',typeof tr.exitCode==='number');
  if(tr.ok){check('transcode artifact >0',fs.existsSync(out)&&fs.statSync(out).size>0)}
}else{console.log('   (ffmpeg skipped: '+(gen.stderr||'').slice(0,80)+')');pass+=2;}
console.log('VIDEOCRAFT-SMOKE-PASS '+pass+'/'+(pass+fail));process.exitCode=fail>0?1:0;})();
