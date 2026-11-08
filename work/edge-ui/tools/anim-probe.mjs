// Reads the shell's own #animProbe JSON for each ?anim-demo=1 frozen phase
// over the DevTools protocol. Evidence helper for task-13; writes nothing.
// Usage: node tools/anim-probe.mjs <port> <fileUrlBase>
const [port = '9231', baseUrl] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const phases = [
  ['newtab', 120], ['newtab', 250],
  ['close', 60], ['close', 160],
  ['switch', 110], ['switch', 210],
  ['drag', 200], ['drag', 380]
];

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch (e) { /* browser still starting */ }
    await sleep(250);
  }
  throw new Error('no CDP page target on ' + port);
}

const page = await target();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result && r.result.result ? r.result.result.value : null;
};

await send('Page.enable');
await send('Runtime.enable');
const out = {};
for (const [phase, at] of phases) {
  const url = baseUrl + '?anim-demo=1&freeze=1&phase=' + phase + '&at=' + at;
  await send('Page.navigate', { url });
  await sleep(1600);
  const probe = await evalJs("(document.getElementById('animProbe')||{}).textContent || null");
  out[phase + '@' + at] = probe ? JSON.parse(probe) : { error: 'no probe' };
}
console.log(JSON.stringify(out, null, 1));
ws.close();
process.exit(0);
