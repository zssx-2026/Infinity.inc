/*
 * cli.js - run the studio installer without a window.
 *
 * Useful on a build machine and in tests: same planner, same routes, no GUI.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from './server.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const port = Number(process.argv[2]) || 7721;
const held = await start({ root: ROOT, port: port });
console.log('InfinityStudio installer on http://127.0.0.1:' + held.port + '/');
const stop = async () => { await held.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
