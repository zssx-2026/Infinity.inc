/*
 * config.js - the one place the shape of a rack is written down.
 *
 * Everything downstream - the cache tiers, the billing weights, the
 * scheduler's watermarks - is a function of this table. Keeping it in one
 * module means the simulator, the dashboard and the tests all describe the
 * same machine, and a number that is wrong is wrong in exactly one place.
 *
 * The figures are the ones in docs/InfinityServer.md: the tier table in
 * chapter 1.2 and the billing weights in 2.1.
 */

/* The six tiers, in the order a request walks them. `latencyNs` and
 * `weight` are what the billing and latency arithmetic actually reads;
 * `capacityBytes` is the configured pool size, either from the YAML-ish
 * config file or from these defaults. */
export const TIERS = [
  { id: 'L1', name: 'CPU 片内 SRAM',  latencyNs: 1,            weight: 1,   capacityBytes: 64 * 1024,        kind: 'private' },
  { id: 'L2', name: 'CPU 片内 SRAM',  latencyNs: 10,           weight: 2,   capacityBytes: 2 * 1024 * 1024,  kind: 'private' },
  { id: 'L3', name: 'CPU 片内 SRAM',  latencyNs: 30,           weight: 4,   capacityBytes: 384 * 1024 * 1024, kind: 'shared'  },
  { id: 'L4', name: 'DDR5 + CXL 内存池', latencyNs: 200,       weight: 16,  capacityBytes: 1024 * 1024 * 1024 * 1024, kind: 'pool' },
  { id: 'L5', name: 'NVMe 闪存池',     latencyNs: 100 * 1000,  weight: 64,  capacityBytes: 1024 * 1024 * 1024 * 1024 * 1024, kind: 'pool' },
  { id: 'L6', name: 'SMR/ePMR 磁盘池', latencyNs: 10 * 1000 * 1000, weight: 256, capacityBytes: 4 * 1024 * 1024 * 1024 * 1024 * 1024, kind: 'pool' }
];

export const TIER_IDS = TIERS.map(function (t) { return t.id; });

/* The default rack, chapter 9.1. A deployment overrides only what it has. */
export const DEFAULTS = {
  rackId: 'rack-001',
  computeNodes: 8,
  coresPerNode: 288,
  dpus: 2,
  billing: { baseRate: 0.000001, weights: { L1: 1, L2: 2, L3: 4, L4: 16, L5: 64, L6: 256 } },
  scheduling: {
    hotThreshold: 100,
    coldThreshold: 10,
    highWatermark: 0.9,
    lowWatermark: 0.7,
    prefetchThreshold: 0.6
  },
  limits: { maxBodyBytes: 1024 }
};

const PRIORITY_FACTOR = { high: 1.5, normal: 1.0, low: 0.5 };

export function priorityFactor(p) {
  return PRIORITY_FACTOR[String(p || 'normal').toLowerCase()] || 1.0;
}

/* Chapter 6.2. Bodies at or under the limit cost exactly one unit; anything
 * above it grows linearly, which is the incentive for small requests. */
export function sizeFactor(bytes) {
  const limit = DEFAULTS.limits.maxBodyBytes;
  if (bytes <= limit) return 1.0;
  return bytes / limit;
}

/*
 * Merge a deployment description over the defaults. Only the keys the
 * deployment actually names are replaced, so a config that sets one weight
 * does not silently lose the rest.
 */
export function resolveConfig(overrides) {
  const o = overrides || {};
  const cfg = {
    rackId: o.rackId || DEFAULTS.rackId,
    computeNodes: num(o.computeNodes, DEFAULTS.computeNodes),
    coresPerNode: num(o.coresPerNode, DEFAULTS.coresPerNode),
    dpus: num(o.dpus, DEFAULTS.dpus),
    billing: {
      baseRate: num(o.billing && o.billing.baseRate, DEFAULTS.billing.baseRate),
      weights: Object.assign({}, DEFAULTS.billing.weights, (o.billing && o.billing.weights) || {})
    },
    scheduling: Object.assign({}, DEFAULTS.scheduling, o.scheduling || {}),
    limits: Object.assign({}, DEFAULTS.limits, o.limits || {})
  };
  /* Per-tier capacity comes from the pools when given, in bytes. */
  cfg.tiers = TIERS.map(function (t) {
    const c = o.pools && o.pools[t.id];
    return Object.assign({}, t, { capacityBytes: num(c, t.capacityBytes) });
  });
  return cfg;
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/* The tier table the dashboard draws and the tests assert against. */
export function tierTable(cfg) {
  return cfg.tiers.map(function (t) {
    return {
      id: t.id,
      name: t.name,
      latencyNs: t.latencyNs,
      weight: t.weight,
      kind: t.kind,
      capacityBytes: t.capacityBytes,
      capacityText: human(t.capacityBytes),
      latencyText: humanNs(t.latencyNs)
    };
  });
}

export function human(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + ' ' + units[i];
}

export function humanNs(ns) {
  if (ns < 1000) return ns + ' ns';
  if (ns < 1000 * 1000) return (ns / 1000).toFixed(0) + ' µs';
  return (ns / (1000 * 1000)).toFixed(0) + ' ms';
}
