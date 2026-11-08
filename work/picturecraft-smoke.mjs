import m from 'file:///D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/InfinityStudio/src/apps/picturecraft.js?v=1793527309854';
import path from 'node:path';import os from 'node:os';import fs from 'node:fs';
let pass=0,fail=0;
function check(d,cond,e){if(cond){pass+=1;console.log('ok   '+d)}else{fail+=1;console.log('FAIL '+d+(e?' <- '+JSON.stringify(e):''))}}
(async()=>{
let cap=m.capabilities();check('capabilities',cap.implemented===true&&cap.id==='craft.picture');
let w=4,h=3;let pixels=Buffer.alloc(w*h*4);for(let i=0;i<w*h;i++){pixels[i*4+0]=100;pixels[i*4+1]=150;pixels[i*4+2]=200;pixels[i*4+3]=255;}
let enc;try{enc=m.encode({width:w,height:h,pixels:pixels});}catch(err){fail+=1;console.log('FAIL encode returns buffer <- '+err.code);enc=null;}check('encode returns buffer',Buffer.isBuffer(enc)&&enc.length>0);
let dec;if(enc){try{dec=m.decode(enc);}catch(err){fail+=1;console.log('FAIL decode roundtrip <- '+err.code);dec={ok:false};}}else{dec={ok:false};}check('decode roundtrip',dec.format==='png'&&dec.width===w&&dec.height===h);
let thumb;if(enc){try{thumb=m.thumbnail(enc,{width:2,height:2});}catch(err){fail+=1;console.log('FAIL thumbnail buffer <- '+err.code);thumb=null;}}else{thumb=null;}check('thumbnail buffer',Buffer.isBuffer(thumb)&&thumb.length>0);
let td;if(thumb){try{td=m.decode(thumb);}catch(err){fail+=1;console.log('FAIL thumbnail decode 2x2 <- '+err.code);td={ok:false};}}else{td={ok:false};}check('thumbnail decode 2x2',td.format==='png'&&td.width===2&&td.height===2);
let dir=path.join(os.tmpdir(),'pc-'+Date.now());try{fs.mkdirSync(dir,{recursive:true})}catch(_){}
let fp=path.join(dir,'t.png');fs.writeFileSync(fp,enc);let rb=fs.readFileSync(fp);check('png roundtrip bytes',Buffer.compare(enc,rb)===0);
let mk=await m.run('encode',{width:w,height:h,pixels:pixels});check('run encode',mk.ok===true);
let bad=await m.run('info',{path:'/nope.png'});check('run info missing',bad.ok===false&&typeof bad.error==='string');
console.log('PICTURECRAFT-SMOKE-PASS '+pass+'/'+(pass+fail));process.exitCode=fail>0?1:0;})();
