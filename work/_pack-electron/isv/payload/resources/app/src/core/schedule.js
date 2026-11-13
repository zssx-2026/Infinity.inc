/*
 * schedule.js - where the work goes, and how the pool answers load.
 *
 * Chapter 7 gives a scheduler with a consistent-hash ring and load-aware
 * routing, and a resource pool that scales between a low and a high
 * watermark. Both are small enough to write down exactly, and both are the
 * things a deployment actually tunes, so they are kept separate from the
 * cache: the cache decides where a block lives, the scheduler decides which
 * node does the work.
 */

import { createHash } from 'node:crypto';

/* FNV-1a, 32 bit. Small, stable, and identical in every runtime - a ring
 * that hashes differently per process would move every key on restart. */
export function hashKey(key) {
  let h = 0x811c9dc5;
  const s = String(key);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h >>> 0;
}

export class HashRing {
  constructor(nodes, virtual) {
    this.virtual = virtual || 64;
    this.tokens = [];
    this.nodes = new Set();
    for (const n of nodes || []) this.add(n);
  }

  add(node) {
    if (this.nodes.has(node)) return;
    this.nodes.add(node);
    for (let i = 0; i < this.virtual; i++) {
      this.tokens.push({ hash: hashKey(node + '#' + i), node: node });
    }
    this.tokens.sort(function (a, b) { return a.hash - b.hash; });
  }

  remove(node) {
    if (!this.nodes.has(node)) return;
    this.nodes.delete(node);
    this.tokens = this.tokens.filter(function (t) { return t.node !== node; });
  }

  /* Walk the ring clockwise from the key's hash. */
  nodeFor(key) {
    if (!this.tokens.length) return null;
    const h = hashKey(key);
    let i = lowerBound(this.tokens, h);
    if (i >= this.tokens.length) i = 0;
    return this.tokens[i].node;
  }

  /* N distinct nodes, in preference order, for replicas and retries. */
  nodesFor(key, count) {
    const want = Math.min(count || 1, this.nodes.size || 1);
    const out = [];
    const h = hashKey(key);
    let i = lowerBound(this.tokens, h);
    for (let step = 0; step < this.tokens.length && out.length < want; step++) {
      const t = this.tokens[(i + step) % this.tokens.length];
      if (!out.includes(t.node)) out.push(t.node);
    }
    return out;
  }

  size() { return this.nodes.size; }
  list() { return Array.from(this.nodes); }
}

function lowerBound(arr, h) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].hash < h) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/*
 * Load-aware routing, chapter 7.1: pick the candidate with the most headroom
 * rather than the one the ring happens to name first. The ring gives the
 * preference order; the load table decides among them.
 */
export function route(ring, key, load, count) {
  const candidates = ring.nodesFor(key, count || Math.max(1, ring.size()));
  if (!candidates.length) return null;
  let best = candidates[0];
  let bestScore = Infinity;
  for (const n of candidates) {
    const used = (load && load[n]) || 0;
    if (used < bestScore) { bestScore = used; best = n; }
  }
  return best;
}

/*
 * The pool. computeNodes and dpus are modelled as capacities: how many
 * requests a node can carry at once, and how many nodes the pool has. Scale
 * up when utilisation crosses the high watermark, down when it falls below
 * the low one - the two thresholds are not the same number on purpose, so a
 * pool sitting at the boundary does not oscillate.
 */
export class ResourcePool {
  constructor(cfg) {
    this.cfg = cfg;
    this.nodes = cfg.computeNodes;
    this.dpus = cfg.dpus;
    this.coresPerNode = cfg.coresPerNode;
    this.inflight = 0;
    this.history = [];
  }

  capacity() { return this.nodes * this.coresPerNode; }

  utilization() {
    const cap = this.capacity();
    return cap ? this.inflight / cap : 0;
  }

  acquire(n) {
    this.inflight += n || 1;
    return this.inflight;
  }

  release(n) {
    this.inflight = Math.max(0, this.inflight - (n || 1));
    return this.inflight;
  }

  /*
   * Chapter 7.3. Returns the decision, not an action: what the pool would do
   * at this utilisation. The caller decides whether to act on it, which keeps
   * the policy testable without a cluster.
   */
  policy() {
    const s = this.cfg.scheduling;
    const u = this.utilization();
    if (u > (s.highWatermark || 0.9)) return { action: 'scale-out', utilization: u, reason: 'above high watermark' };
    if (u < (s.lowWatermark || 0.7) && this.nodes > 1) return { action: 'scale-in', utilization: u, reason: 'below low watermark' };
    return { action: 'hold', utilization: u, reason: 'within watermarks' };
  }

  /* Apply a scale decision, bounded so a pool cannot be scaled to nothing. */
  scale(delta) {
    const before = this.nodes;
    this.nodes = Math.max(1, Math.min(1024, this.nodes + (delta | 0)));
    if (this.nodes !== before) {
      this.history.push({ at: Date.now(), from: before, to: this.nodes, utilization: this.utilization() });
    }
    return { from: before, to: this.nodes };
  }

  stats() {
    return {
      rackId: this.cfg.rackId,
      nodes: this.nodes,
      dpus: this.dpus,
      coresPerNode: this.coresPerNode,
      capacity: this.capacity(),
      inflight: this.inflight,
      utilization: this.utilization(),
      policy: this.policy().action
    };
  }
}

/* One scheduler: a ring over the current nodes plus the load table. */
export class Scheduler {
  constructor(cfg) {
    this.cfg = cfg;
    this.load = {};
    this.ring = new HashRing(nodeList(cfg.computeNodes, cfg.rackId));
    this.pool = new ResourcePool(cfg);
    this.policy = Object.assign({ strategy: 'load-aware', replicas: 2 }, cfg.scheduling || {});
  }

  /* Rebuild the ring after a scale event, keeping the load that survives. */
  resync() {
    const nodes = nodeList(this.pool.nodes, this.cfg.rackId);
    this.ring = new HashRing(nodes);
    for (const n of Object.keys(this.load)) {
      if (!nodes.includes(n)) delete this.load[n];
    }
    return nodes;
  }

  assign(key) {
    const node = route(this.ring, key, this.load, Math.max(1, Math.min(3, this.pool.nodes)));
    if (!node) return null;
    this.load[node] = (this.load[node] || 0) + 1;
    this.pool.acquire(1);
    return node;
  }

  finish(node) {
    if (node) {
      this.load[node] = Math.max(0, (this.load[node] || 1) - 1);
      this.pool.release(1);
    }
  }

  /* Replica placement: distinct nodes, in ring order. */
  replicas(key, count) {
    return this.ring.nodesFor(key, count || this.policy.replicas || 2);
  }

  setPolicy(patch) {
    this.policy = Object.assign({}, this.policy, patch || {});
    if (patch && patch.replicas) this.policy.replicas = patch.replicas;
    return this.policy;
  }

  stats() {
    return {
      nodes: this.ring.list(),
      load: this.load,
      pool: this.pool.stats(),
      policy: this.policy
    };
  }
}

export function nodeList(count, rackId) {
  const out = [];
  for (let i = 1; i <= Math.max(1, count); i++) {
    out.push((rackId || 'rack') + '-node-' + String(i).padStart(2, '0'));
  }
  return out;
}

/* Stable id for a request, used as req_id in the billing chain. */
export function requestId(key, userId, at) {
  return createHash('sha256')
    .update(String(key) + '|' + String(userId || '-') + '|' + String(at || Date.now()) + '|' + Math.random())
    .digest('hex')
    .slice(0, 16);
}
