/*
 * cli.js - run the console without a window.
 *
 * The Electron shell and this entry point start the same server, so the
 * dashboard is a view onto the same process the tests talk to: nothing the
 * window shows is computed anywhere else.
 */

import { start } from './server.js';

const port = Number(process.argv[2]) || 7711;
const { port: bound, close } = await start({ port: port });
console.log('InfinityServer listening on http://127.0.0.1:' + bound);
console.log('dashboard: http://127.0.0.1:' + bound + '/');

const stop = async () => { await close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
