const path=require('node:path');
const base=(process.env.INFINITY_EXE_NAME||path.basename(process.execPath)).replace(/\.exe$/i,'').toLowerCase();
const c=base.indexOf('_');
const out={exeName:process.env.INFINITY_EXE_NAME||null, prefix:c<0?null:base.slice(0,c), mode:c<0?null:base.slice(c+1), args:process.argv.slice(2), cwd:process.cwd()};
process.stdout.write(JSON.stringify(out)+'\n');
