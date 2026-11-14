/*
 * pipeline.js - the seven stages a request walks, chapter 5.
 *
 *   P(R) = ingest -> parse -> route -> lookup -> fill -> assemble -> bill
 *
 * The stages are separate functions here even though they run in one process,
 * because the whole point of the design is that they are separately measured:
 * the dashboard shows per-stage latency, and a stage that is slow is visible
 * as a stage rather than as a slow request.
 *
 * Latency model, chapter 1.2: a hit at tier L costs the latency of L, a miss
 * costs every tier below it. The number is not a real measurement - there is
 * no rack - but it is the number the architecture claims, so it is the number
 * the machine reports.
 */

import { Cache } from './cache.js';
import { Scheduler, requestId } from './schedule.js';
import { Billing, feeOf } from './billing.js';
import { resolveConfig } from './config.js';

export class InfinityServer {
  constructor(overrides) {
    this.cfg = resolveConfig(overrides);
    this.cache = new Cache(this.cfg);
    this.scheduler = new Scheduler(this.cfg);
    this.billing = new Billing(this.cfg);
    /* Authorised users. Chapter 8: an unauthorised request is refused and,
     * importantly, not billed - a refusal must not appear on someone's bill
     * as a charge for a request that never ran. */
    this.users = new Map();
    this.requests = 0;
    this.refused = 0;
    this.stageTotals = { ingest: 0, parse: 0, route: 0, lookup: 0, fill: 0, assemble: 0, bill: 0 };
    this.hits = 0;
    this.misses = 0;
    this.startedAt = Date.now();
  }

  /* ---- 1. ingest: identity, body size, authorisation ---- */
  ingest(req) {
    const body = req.body == null ? '' : String(req.body);
    const bodySize = Buffer.byteLength(body);
    if (bodySize > this.cfg.limits.maxBodyBytes) {
      /* Oversized bodies are refused here, before any work is done - the
       * size factor exists to discourage them, not to bill for them. */
      return { ok: false, refused: 'body-too-large', bodySize: bodySize };
    }
    const user = this.users.get(req.userId || 'anonymous');
    const anonymousAllowed = (this.cfg.security && this.cfg.security.allowAnonymous) !== false;
    if (!user && !anonymousAllowed) {
      return { ok: false, refused: 'unauthorized', bodySize: bodySize };
    }
    return {
      ok: true,
      key: req.key == null ? '' : String(req.key),
      body: body,
      bodySize: bodySize,
      userId: (user && user.id) || req.userId || 'anonymous',
      priority: (user && user.priority) || req.priority || 'normal',
      op: req.op || 'read',
      write: req.op === 'write' || req.op === 'put'
    };
  }

  /* ---- 2. parse: normalise the request into one canonical shape ---- */
  parse(ingested) {
    return {
      key: ingested.key,
      body: ingested.body,
      bodySize: ingested.bodySize,
      userId: ingested.userId,
      priority: ingested.priority,
      op: ingested.write ? 'write' : 'read'
    };
  }

  /* ---- 3. route: which node, and which replicas ---- */
  routeStage(parsed) {
    const node = this.scheduler.assign(parsed.key || parsed.body);
    return { node: node, replicas: this.scheduler.replicas(parsed.key || parsed.body) };
  }

  /* ---- 4. lookup: is it in the cache ---- */
  lookup(parsed) {
    const key = parsed.key || 'body:' + parsed.body;
    const block = this.cache.get(key);
    if (block) {
      this.cache.touch(block);
      return { key: key, hit: true, block: block, level: block.level };
    }
    return { key: key, hit: false, block: null, level: 6 };
  }

  /*
   * ---- 5. fill: a miss reads through to the bottom tier ----
   * A cold load does not materialise data in L1; it reads from L6 and leaves
   * the block there, so the first access is charged at L6 and later accesses
   * migrate up as the block warms.
   */
  fill(parsed, looked) {
    if (looked.hit) {
      return { level: looked.level, block: looked.block, filled: false };
    }
    const block = this.cache.put(looked.key, parsed.body, {
      bytes: Math.max(1, parsed.bodySize),
      level: 6
    });
    this.misses++;
    return { level: 6, block: block, filled: true };
  }

  /* ---- 6. assemble: the response, and the tier it was served from ---- */
  assemble(parsed, filled, routing) {
    const block = filled.block;
    const level = filled.level || 6;
    const tierId = 'L' + level;
    const tier = this.cfg.tiers[level - 1];
    return {
      key: block ? block.key : (parsed.key || ''),
      level: level,
      tierId: tierId,
      latencyNs: tier ? tier.latencyNs : 0,
      version: block ? block.version : 1,
      hit: !filled.filled,
      node: routing.node,
      replicas: routing.replicas,
      bytes: block ? block.bytes : parsed.bodySize,
      body: block ? block.data : parsed.body
    };
  }

  /* ---- 7. bill: one event per request that was served ---- */
  bill(parsed, response) {
    const f = feeOf(this.cfg, {
      level: response.level,
      bodySize: response.bytes,
      priority: parsed.priority
    });
    const event = this.billing.record({
      requestId: requestId(parsed.key || parsed.body, parsed.userId, Date.now()),
      userId: parsed.userId,
      key: response.key,
      version: response.version,
      level: response.level,
      bodySize: response.bytes,
      priority: parsed.priority
    });
    return { event: event, factors: f };
  }

  /*
   * The whole pipeline. Every stage is timed separately and the totals feed
   * the dashboard; the migration decision runs after the response is built so
   * a slow policy call never delays a request that is already answered.
   */
  handle(req) {
    const t0 = now();
    this.requests++;
    const ingested = this.ingest(req);
    const t1 = now();
    if (!ingested.ok) {
      this.refused++;
      return {
        ok: false,
        refused: ingested.refused,
        billed: false,
        latencyNs: t1 - t0,
        stages: { ingest: t1 - t0 }
      };
    }
    const parsed = this.parse(ingested);
    const t2 = now();
    const routing = this.routeStage(parsed);
    const t3 = now();
    const looked = this.lookup(parsed);
    const t4 = now();
    if (looked.hit) this.hits++;
    const filled = this.fill(parsed, looked);
    const t5 = now();
    const response = this.assemble(parsed, filled, routing);
    const t6 = now();
    const billed = this.bill(parsed, response);
    const t7 = now();

    this.scheduler.finish(routing.node);
    /* Policy runs after the response: temperature migration and capacity
     * eviction are background work, not part of the request path. */
    const migration = this.cache.consider(filled.block);
    const scale = this.scheduler.pool.policy();

    const stages = {
      ingest: t1 - t0, parse: t2 - t1, route: t3 - t2, lookup: t4 - t3,
      fill: t5 - t4, assemble: t6 - t5, bill: t7 - t6
    };
    for (const k of Object.keys(stages)) this.stageTotals[k] += stages[k];

    return {
      ok: true,
      request: {
        key: response.key, op: parsed.op, userId: parsed.userId,
        priority: parsed.priority, bodySize: parsed.bodySize
      },
      cache: {
        hit: response.hit, level: response.level, tierId: response.tierId,
        latencyNs: response.latencyNs, version: response.version,
        bytes: response.bytes, migration: migration
      },
      routing: { node: response.node, replicas: response.replicas },
      billing: { fee: billed.event.fee, factors: billed.factors, event: billed.event },
      pool: { nodes: this.scheduler.pool.nodes, policy: scale.action, utilization: scale.utilization },
      stages: stages,
      latencyNs: t7 - t0
    };
  }

  /* Prefetch, chapter 2.3: the caller predicts a neighbour, the cache lifts
   * it to L4 when the prediction clears the threshold. */
  hint(key, probability, data, bytes) {
    const block = this.cache.prefetch(key, probability, data, bytes);
    return { prefetched: !!block, key: key, probability: probability };
  }

  /* Write path: version bump plus a bill at the tier the write lands in. */
  write(req) {
    return this.handle(Object.assign({}, req, { op: 'write' }));
  }

  addUser(user) {
    this.users.set(user.id, user);
    return user;
  }

  /* Everything the dashboard draws, in one call. */
  stats() {
    const upSec = (Date.now() - this.startedAt) / 1000;
    const served = this.hits + this.misses;
    return {
      rack: {
        id: this.cfg.rackId,
        nodes: this.scheduler.pool.nodes,
        coresPerNode: this.cfg.coresPerNode,
        dpus: this.cfg.dpus,
        cores: this.scheduler.pool.capacity(),
        uptimeSec: upSec
      },
      requests: {
        total: this.requests,
        refused: this.refused,
        served: served,
        hits: this.hits,
        misses: this.misses,
        hitRate: served ? this.hits / served : 0,
        tps: upSec ? served / upSec : 0
      },
      cache: this.cache.stats(),
      billing: this.billing.summary(),
      pool: this.scheduler.pool.stats(),
      scheduler: this.scheduler.stats(),
      stages: this.stageTotals,
      avgStageNs: avgStages(this.stageTotals, Math.max(1, served))
    };
  }

  /* Chapter 10 verification: the invariants, checked against live state. */
  verify() {
    const problems = [];
    const st = this.cache.stats();
    for (const t of st.tiers) {
      if (t.usageBytes > t.capacityBytes) {
        problems.push('tier ' + t.id + ' over capacity: ' + t.usageBytes + ' > ' + t.capacityBytes);
      }
    }
    const chain = this.billing.verify();
    if (!chain.ok) problems.push('billing chain broken at event ' + chain.index);
    return { ok: problems.length === 0, problems: problems, chain: chain };
  }
}

function avgStages(totals, n) {
  const out = {};
  for (const k of Object.keys(totals)) out[k] = totals[k] / n;
  return out;
}

function now() {
  return Number(process.hrtime.bigint());
}

export { Cache, Scheduler };
