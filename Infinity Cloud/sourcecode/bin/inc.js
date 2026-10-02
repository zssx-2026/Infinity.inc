#!/usr/bin/env node
/* The shim the PATH entry points at. It only has to find main.js and hand
 * over - keeping it tiny means an update to the app never has to touch the
 * thing that PATH resolves. */
import path from 'node:path';
import url from 'node:url';
const here = path.dirname(url.fileURLToPath(import.meta.url));
await import(url.pathToFileURL(path.join(here, '..', 'src', 'main.js')).href);
