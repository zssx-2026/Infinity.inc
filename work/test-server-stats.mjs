import { InfinityServer } from '../InfinityServer/src/core/pipeline.js';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' :: ' + detail : '')); }
}

const engine = new InfinityServer({ computeNodes: 8, coresPerNode: 288, dpus: 2 });
const s = engine.stats();
check('rack.id present', s.rack.id === 'rack-001', String(s.rack.id));
check('rack.nodes', s.rack.nodes === 8, String(s.rack.nodes));
check('rack.coresPerNode exposed', s.rack.coresPerNode === 288, String(s.rack.coresPerNode));
check('rack.cores = nodes * coresPerNode', s.rack.cores === 8 * 288, String(s.rack.cores));
check('rack.dpus', s.rack.dpus === 2, String(s.rack.dpus));
check('uptime is a number', typeof s.rack.uptimeSec === 'number' && s.rack.uptimeSec >= 0);

const custom = new InfinityServer({ computeNodes: 4, coresPerNode: 64 }).stats();
check('overrides reach the dashboard', custom.rack.nodes === 4 && custom.rack.coresPerNode === 64 && custom.rack.cores === 256,
  JSON.stringify({ n: custom.rack.nodes, c: custom.rack.coresPerNode, total: custom.rack.cores }));

const json = JSON.stringify(s.rack);
check('no undefined in rack payload', json.indexOf('undefined') < 0, json);

console.log('');
console.log('SERVER-STATS-TEST ' + (fail === 0 ? 'PASS' : 'FAIL') + ' ' + pass + '/' + (pass + fail));
if (fail) process.exitCode = 1;
