const base = 'https://infinity-account-auth-worker.zssx2026.workers.dev';
try {
  const r = await fetch(base + '/healthz', { signal: AbortSignal.timeout(25000) });
  console.log('healthz status=' + r.status + ' body=' + (await r.text()).slice(0, 200));
} catch (e) { console.log('healthz ERROR ' + e.message + ' | ' + (e.cause && e.cause.message)); }
