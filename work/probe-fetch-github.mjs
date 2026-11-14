const url = 'https://github.com/zssx-2026/Infinity-Server/releases/download/v1.0.0-pre8/InfinityServer_1.0.0-pre8_win64_setup.exe';
for (const [label, opts] of [['HEAD manual', { method: 'HEAD', redirect: 'manual' }], ['HEAD follow', { method: 'HEAD' }], ['GET range manual', { headers: { range: 'bytes=0-1023' }, redirect: 'manual' }]]) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(20000) }, opts));
    console.log(label + ': status=' + r.status + ' ms=' + (Date.now() - t0) + ' len=' + r.headers.get('content-length') + ' ranges=' + r.headers.get('accept-ranges') + ' loc=' + String(r.headers.get('location')).slice(0, 80));
  } catch (e) {
    console.log(label + ': ERROR ' + String((e && e.message) || e) + ' ms=' + (Date.now() - t0) + ' cause=' + String(e && e.cause && e.cause.message));
  }
}
