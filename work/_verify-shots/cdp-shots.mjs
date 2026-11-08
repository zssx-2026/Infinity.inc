// Drives Edge over the DevTools protocol so the gate can be photographed at
// chosen instants. Evidence tool for task-16; it never writes anything but PNGs
// and one JSON report per run.
import fs from 'node:fs';
import path from 'node:path';

const [normalUrl, timeoutUrl, outDir, tag, port] = process.argv.slice(2);
const PORT = port || '9223';
const out = path.resolve(outDir);
fs.mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch (e) { /* edge still coming up */ }
    await sleep(250);
  }
  throw new Error('no CDP page target');
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
function send(method, params) {
  return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
}
async function shot(file) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  if (!r.result || !r.result.data) throw new Error('capture failed: ' + JSON.stringify(r).slice(0, 200));
  fs.writeFileSync(path.join(out, file), Buffer.from(r.result.data, 'base64'));
  return file;
}
async function gateState() {
  const expr = 'JSON.stringify({gate:window.__INFINITY_GATE||null'
    + ',overlay:!!document.getElementById("infinity-gate")'
    + ',bodyVisibility:document.body?getComputedStyle(document.body).visibility:null'
    + ',title:document.title'
    + ',text:(document.body?document.body.innerText:"").replace(/\\s+/g," ").slice(0,140)})';
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  try { return JSON.parse(r.result.result.value); } catch (e) { return null; }
}

await send('Page.enable');
await send('Runtime.enable');
const report = { tag, normalUrl, timeoutUrl, steps: [] };

// The clock that matters starts when the gate itself starts, not when the
// navigation does: a slow CDN should not be mistaken for gate time.
const navAt = Date.now();
await send('Page.navigate', { url: normalUrl });
let first = null;
for (let i = 0; i < 80; i++) { await sleep(50); first = await gateState(); if (first && first.gate) break; }
const gateAt = (first && first.gate && first.gate.startedAt) ? first.gate.startedAt : navAt;
report.navToGateMs = gateAt - navAt;
const until = (t) => Math.max(0, t - Date.now());
await sleep(until(gateAt + 500));
report.steps.push({ file: await shot(tag + '-01-t0.5s.png'), at: Date.now() - gateAt, state: await gateState() });
await sleep(until(gateAt + 2900));
report.steps.push({ file: await shot(tag + '-02-t2.9s.png'), at: Date.now() - gateAt, state: await gateState() });
await sleep(until(gateAt + 3500));
let s35 = await gateState();
report.steps.push({ file: await shot(tag + '-03-t3.5s.png'), at: Date.now() - gateAt, state: s35 });
for (let i = 0; i < 60 && (!s35 || !s35.gate || s35.gate.result !== 'shown'); i++) {
  await sleep(100);
  s35 = await gateState();
  if (s35 && s35.gate && s35.gate.result === 'shown') {
    await sleep(250);
    report.steps.push({ file: await shot(tag + '-04-revealed.png'), at: Date.now() - gateAt, state: await gateState() });
  }
}
report.gate = await gateState();

await send('Page.navigate', { url: timeoutUrl });
let to = null;
for (let i = 0; i < 90; i++) {
  await sleep(150);
  to = await gateState();
  if (to && to.gate && to.gate.result === 'timeout') break;
}
report.timeout = to;
report.timeoutFile = await shot(tag + '-05-timed-out.png');
fs.writeFileSync(path.join(out, tag + '-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
ws.close();
process.exit(0);
