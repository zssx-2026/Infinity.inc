// Checks the remembered-pass path: the same profile that just passed the gate
// should see the overlay briefly and then the page, without a long wait.
import fs from 'node:fs';
const [warmup, url, tag, port] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
async function state() {
  const r = await send('Runtime.evaluate', { expression: 'JSON.stringify({gate:window.__INFINITY_GATE||null,overlay:!!document.getElementById("infinity-gate")})', returnByValue: true });
  try { return JSON.parse(r.result.result.value); } catch (e) { return null; }
}
await send('Page.enable'); await send('Runtime.enable');

// one full pass first, so this profile has a remembered credential
await send('Page.navigate', { url: warmup });
for (let i = 0; i < 120; i++) { await sleep(100); const w = await state(); if (w && w.gate && w.gate.result === 'shown') break; }

const navAt = Date.now();
await send('Page.navigate', { url });
let first = null;
for (let i = 0; i < 80; i++) { await sleep(30); first = await state(); if (first && first.gate) break; }
const at500 = await (async () => { await sleep(Math.max(0, 500 - (Date.now() - navAt))); return state(); })();
let last = at500;
for (let i = 0; i < 80 && (!last || !last.gate || last.gate.result !== 'shown'); i++) { await sleep(30); last = await state(); }
const out = { tag, url, mode: last && last.gate && last.gate.mode, at500: at500 && { result: at500.gate && at500.gate.result, overlay: at500.overlay }, final: last && last.gate, wallMs: Date.now() - navAt };
fs.writeFileSync('work/_verify-shots/' + tag + '-remembered.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
process.exit(0);
