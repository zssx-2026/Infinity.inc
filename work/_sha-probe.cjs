const fs=require('fs'),crypto=require('crypto');
const src=fs.readFileSync(process.argv[2],'utf8');
const sandbox={postMessage(){}};
const m=new Function('self', src + '\nreturn {sha256hex:sha256hex,hash32:hash32};')(sandbox);
const cases=['','a','abc','infinity-gate|2|abcd|0','中文测试','x'.repeat(200),'infinity-gate|2|ff00aa11|123456'];
const rows=cases.map(s=>{
  const mine=m.sha256hex(s);
  const real=crypto.createHash('sha256').update(s,'utf8').digest('hex');
  return {len:s.length, ok:mine===real, mine, real};
});
fs.writeFileSync(process.argv[3], JSON.stringify({rows, allOk: rows.every(r=>r.ok)}, null, 2));