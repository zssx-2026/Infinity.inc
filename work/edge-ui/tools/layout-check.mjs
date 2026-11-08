const port=process.argv[2];
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const list=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
const page=list.find(t=>t.type==='page'&&t.webSocketDebuggerUrl);
const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let id=0;const pending=new Map();
ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}};
const send=(method,params)=>new Promise(res=>{const i=++id;pending.set(i,res);ws.send(JSON.stringify({id:i,method,params:params||{}}));});
const ev=async(e)=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});return r.result&&r.result.result?r.result.result.value:null;};
await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});
await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
for (const n of [1,2,3,4,8]) {
  await send('Page.navigate',{url:'file:///D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/work/edge-ui/index.html?tabs='+n+'&cb='+Date.now()});
  await sleep(1100);
  const w=await ev("JSON.stringify(Array.from(document.querySelectorAll('.tab')).map(t=>Math.round(t.getBoundingClientRect().width)))");
  const c=await ev("Math.round(document.getElementById('tabs').getBoundingClientRect().width)+'/'+window.innerWidth");
  console.log('tabs='+n+' container/inner='+c+' widths='+w);
}
ws.close();process.exit(0);