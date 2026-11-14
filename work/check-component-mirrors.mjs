// Every product must be fetchable from BOTH mirrors at the exact catalogued size.
// The GitHub direct URL is expected to fail on this host (known SNI/throttle issue),
// so it is reported as WARN and does not fail the run.
const base = 'https://infinity-downloads.pages.dev';
const j = await (await fetch(base + '/api/components')).json();
let fail = 0, warn = 0, checked = 0;
for (const p of j.products) {
  const urls = [...(p.mirrors || []), p.mirror].filter(Boolean);
  const seen = new Set();
  for (const u of urls) {
    if (seen.has(u)) continue; seen.add(u);
    let line = p.asset + ' ' + u.slice(0, 52);
    try {
      const r = await fetch(u, { method: 'HEAD' });
      const len = Number(r.headers.get('content-length') || 0);
      const ok = r.status === 200 && len === p.size;
      checked++;
      if (!ok) fail++;
      line += ' status=' + r.status + ' len=' + len + ' expect=' + p.size + (ok ? ' OK' : ' MISMATCH');
    } catch (e) { fail++; line += ' error=' + e.message; }
    console.log(line);
  }
  try {
    const r = await fetch(p.url, { method: 'HEAD' });
    console.log(p.asset + ' direct status=' + r.status + ' WARN-unreachable-on-this-host');
  } catch (e) { warn++; console.log(p.asset + ' direct error=' + e.message + ' WARN (known: GitHub direct blocked here)'); }
}
console.log('mirrors_checked=' + checked + ' fail=' + fail + ' direct_warn=' + warn);
console.log(fail === 0 ? 'COMPONENT-MIRRORS PASS' : 'COMPONENT-MIRRORS FAIL ' + fail);
process.exit(fail === 0 ? 0 : 1);
