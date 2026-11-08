// Functional verification for task-13 additions (sessions + Play Zone + NTP).
const port = process.argv[2];
const base = 'file:///D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/work/edge-ui/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
const nav = async (url) => { await send('Page.navigate', { url }); await sleep(1400); };
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
const out = {};

await nav(base + '?cb=' + Date.now());
out.a_initial = await ev("JSON.stringify({url:window.__InfinityShell.state.tabs[0].url, tabs:window.__InfinityShell.state.tabs.length, ntp:!!document.querySelector('.ntp'), home:window.__InfinityShell.settings.home, pzCount:document.documentElement.getAttribute('data-pz-count'), err:document.documentElement.getAttribute('data-boot-error')||document.documentElement.getAttribute('data-js-error')||null})");

// session: 3 tabs -> save
await ev("window.__InfinityShell.open('inc://cloud','newTab'); window.__InfinityShell.open('inc://toolbox','newTab'); window.__InfinityShell.session.save('verify'); 'ok'");
out.b_snapshot = await ev("(function(){var s=JSON.parse(localStorage.getItem('infinity-shell-session'));return JSON.stringify({v:s.v,windowId:!!s.windowId,active:!!s.activeTabId,tabs:s.tabs.map(function(t){return t.url}),savedAt:!!s.savedAt});})()");
await nav(base + '?cb=' + Date.now());
out.c_restored = await ev("JSON.stringify({tabs:window.__InfinityShell.state.tabs.map(function(t){return t.url}), active:(window.__InfinityShell.state.tabs.filter(function(t){return t.id===window.__InfinityShell.state.activeTab})[0]||{}).url, lazyViews:document.querySelectorAll('.view').length})");

// play zone: single-open enforcement
out.d_pz = await ev("(function(){try{var S=window.__InfinityShell;var a=S.playzone.state.zones[0];S.playzone.open(a.id);var n1=document.documentElement.getAttribute('data-pz-count');var z2=S.playzone.create();S.playzone.open(z2.id);var n2=document.documentElement.getAttribute('data-pz-count');var vis=!document.getElementById('playzone').hidden;var sel=document.getElementById('pzSelect').options.length;S.playzone.close();var n3=document.documentElement.getAttribute('data-pz-count');return JSON.stringify({afterOpen:n1,afterSwitch:n2,panelVisible:vis,zones:sel,afterClose:n3});}catch(e){return 'ERR:'+e.message;}})()");

// NTP-only session still shows the NTP (seed from newtab.html, which has no autosave)
await nav('file:///D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/work/edge-ui/newtab.html');
await ev("localStorage.setItem('infinity-shell-session', JSON.stringify({v:1,windowId:'win-test',savedAt:Date.now(),activeTabId:'x',tabs:[{id:'x',url:'about:home',title:'NTP',kind:'ntp'}]})); 'seeded'");
await nav(base + '?cb=' + Date.now());
out.e_ntpOnly = await ev("JSON.stringify({tabs:window.__InfinityShell.state.tabs.length,url:window.__InfinityShell.state.tabs[0].url,ntp:!!document.querySelector('.ntp'),toast:(document.getElementById('toast')||{}).textContent||''})");

// newtab.html standalone page
await nav('file:///D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/work/edge-ui/newtab.html?theme=light&locale=zh-CN');
out.f_newtab = await ev("JSON.stringify({local:window.__NEWTAB__.local,theme:window.__NEWTAB__.theme,apps:window.__NEWTAB__.apps.length,tiles:document.querySelectorAll('.tile').length,first:window.__NEWTAB__.navigate('inc://cloud').type})");

console.log(JSON.stringify(out, null, 1));
ws.close(); process.exit(0);