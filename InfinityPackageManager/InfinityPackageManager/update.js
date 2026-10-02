#!/usr/bin/env node
'use strict';

const { fetchAll } = require('./src/update-lib');

async function main() {
  const offline = process.argv.indexOf('--offline') !== -1;
  if (offline) { console.log('[ipm] offline mode'); return; }
  console.log('[ipm] fetching releases ...');
  try {
    const r = await fetchAll({ offline: false });
    console.log('[ipm] url.json updated');
    console.log('[ipm] ' + r.releases.length + ' releases, ' + r.fileCount + ' files total');
    if (r.latest) console.log('[ipm] latest version: ' + r.latest.tag);
  } catch (err) {
    console.error('[ipm] update failed: ' + err.message);
    process.exit(2);
  }
}

main();
