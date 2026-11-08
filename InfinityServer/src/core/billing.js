/*
 * billing.js - money, and the hash chain that makes it auditable.
 *
 * Chapter 6 fixes one formula:
 *
 *   Fee(R) = BaseRate x Weight(level) x SizeFactor(|body|) x PriorityFactor(priority)
 *
 * and one record shape, BillingEvent, which carries prev_hash and merkle_root
 * so a customer can prove a bill was not edited after the fact. There is no
 * ledger service here, so the chain is computed in-process: every event
 * hashes its own fields plus the hash of the event before it, and the running
 * merkle root covers every event recorded so far.
 */

import { createHash } from 'node:crypto';
import { sizeFactor, priorityFactor } from './config.js';

const GENESIS = '0'.repeat(64);

/* Weight of a tier, from the deployment's weight table (chapter 6.1). */
export function tierWeight(cfg, tierId) {
  const w = cfg.billing.weights[tierId];
  return Number.isFinite(w) ? w : 1;
}

/*
 * The fee for one request. Every factor is returned alongside the total so a
 * customer reading an event can rebuild the number themselves.
 */
export function feeOf(cfg, spec) {
  const level = spec.level || 6;
  const tierId = spec.tierId || ('L' + level);
  const bodySize = Number(spec.bodySize) || 0;
  const priority = spec.priority || 'normal';
  const baseRate = cfg.billing.baseRate;
  const weight = tierWeight(cfg, tierId);
  const sf = sizeFactor(bodySize);
  const pf = priorityFactor(priority);
  const fee = baseRate * weight * sf * pf;
  return {
    fee: fee,
    baseRate: baseRate,
    tierId: tierId,
    level: level,
    weight: weight,
    sizeFactor: sf,
    priorityFactor: pf,
    bodySize: bodySize,
    priority: priority
  };
}

export class Billing {
  constructor(cfg, clock) {
    this.cfg = cfg;
    this.clock = typeof clock === 'function' ? clock : () => Date.now();
    this.events = [];
    this.lastHash = GENESIS;
    this.total = 0;
  }

  /* Record one billable request. Returns the event that was appended. */
  record(spec) {
    const f = feeOf(this.cfg, spec);
    const event = {
      req_id: spec.requestId,
      user_id: spec.userId || 'anonymous',
      data_key: spec.key || null,
      data_version: spec.version != null ? spec.version : 1,
      level: f.level,
      tier_id: f.tierId,
      weight: f.weight,
      timestamp: this.clock(),
      body_size: f.bodySize,
      priority: f.priority,
      fee: f.fee,
      prev_hash: this.lastHash,
      merkle_root: null
    };
    const hash = eventHash(event);
    event.hash = hash;
    this.events.push(event);
    this.lastHash = hash;
    this.total += f.fee;
    /* The root is recomputed over the whole chain, so the event a customer
     * holds commits to every event before it. */
    event.merkle_root = merkleRoot(this.events.map(function (e) { return e.hash; }));
    return event;
  }

  /* Walk the chain: every prev_hash must equal the hash before it. */
  verify() {
    let prev = GENESIS;
    for (let i = 0; i < this.events.length; i++) {
      const e = this.events[i];
      if (e.prev_hash !== prev) return { ok: false, index: i };
      const check = eventHash(e);
      if (check !== e.hash) return { ok: false, index: i, reason: 'hash' };
      prev = e.hash;
    }
    return { ok: true, count: this.events.length };
  }

  /* Totals by tier, and by user, which is what a monthly bill shows. */
  summary() {
    const byTier = {};
    const byUser = {};
    for (const e of this.events) {
      byTier[e.tier_id] = byTier[e.tier_id] || { count: 0, fee: 0 };
      byTier[e.tier_id].count++;
      byTier[e.tier_id].fee += e.fee;
      byUser[e.user_id] = byUser[e.user_id] || { count: 0, fee: 0 };
      byUser[e.user_id].count++;
      byUser[e.user_id].fee += e.fee;
    }
    return {
      events: this.events.length,
      total: this.total,
      byTier: byTier,
      byUser: byUser,
      merkle_root: merkleRoot(this.events.map(function (e) { return e.hash; }))
    };
  }

  list(limit) {
    const n = limit == null ? this.events.length : Math.max(0, Math.min(limit, this.events.length));
    return this.events.slice(this.events.length - n);
  }
}

/*
 * The hash of an event covers its fields and its predecessor, but not its own
 * merkle root - the root is derived from the chain, so it cannot be part of
 * what it is derived from.
 */
export function eventHash(e) {
  const parts = [
    e.req_id, e.user_id, e.data_key, String(e.data_version), String(e.level),
    String(e.weight), String(e.timestamp), String(e.body_size), e.priority,
    feeText(e.fee), e.prev_hash
  ];
  return sha(parts.join('|'));
}

export function merkleRoot(hashes) {
  if (!hashes.length) return GENESIS;
  let level = hashes.slice();
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(level[i + 1] ? sha(level[i] + level[i + 1]) : level[i]);
    }
    level = next;
  }
  return level[0];
}

/* Fees are rounded for display only; the chain hashes the rounded text so
 * what a customer sees is exactly what is committed. */
export function feeText(fee) {
  return fee.toFixed(12);
}

function sha(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}
