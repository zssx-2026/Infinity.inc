/* sysinfo - a read-only window on the host, via node:os only. */
import os from 'node:os';

export function register(ctx) {
  return {
    routes: [
      {
        method: 'GET', path: 'os',
        handler: async () => ({
          platform: os.platform(),
          arch: os.arch(),
          cpus: os.cpus().length,
          totalmem: os.totalmem(),
          freemem: os.freemem(),
          uptime: Math.floor(os.uptime()),
          node: process.version
        })
      }
    ]
  };
}
