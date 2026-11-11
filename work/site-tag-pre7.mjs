import { readFileSync, writeFileSync } from 'node:fs';
const p = 'web/infinity/assets/site.js';
let s = readFileSync(p, 'utf8');
const before = s.length;
s = s.replace(/\*\s*Keep in step with cpp\/release\/v1\.0pre\d+\/release-assets\.json/, '* Keep in step with cpp/release/v1.0pre7/release-assets.json');
s = s.replace(/var RELEASE_TAG = '[^']*';/, "var RELEASE_TAG = 'v1.0.0-pre7';");
writeFileSync(p, s, 'utf8');
console.log('bytes ' + before + ' -> ' + s.length);
console.log('tag ' + /var RELEASE_TAG = '[^']*';/.exec(s)[0]);
