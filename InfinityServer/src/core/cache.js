/*
 * cache.js - the six tier cache: blocks, tiers, migration, versioning.
 *
 * The cache is an in-process model, not a driver: there is no rack to talk
 * to, so what this module has to be is exact about the rules in chapters 2
 * and 7.2 - where a block lives, when it moves, and what a write does to the
 * version number. Everything the simulator and the dashboard show is read
 * from here.
 *
 * A block carries exactly the fields chapter 2.4 gives it:
 *
 *   version      bumped on every write
 *   timestamp    last access, nanoseconds
 *   accessCount  total accesses
 *   level        1..6
 *   flags        dirty / locked / prefetched
 *   data
 */

import { tierWeight } from './billing.js';

export class Cache {
  constructor(cfg, now) {
    this.cfg = cfg;
    this.clock = typeof now === 'function' ? now : () => Date.now() * 1e6;
    this.blocks = new Map();
    /* usage[i] and items[i] are the live bookkeeping for tier i+1. */
    this.usage = [0, 0, 0, 0, 0, 0];
    this.items = [new Set(), new Set(), new Set(), new Set(), new Set(), new Set()];
    this.migrations = 0;
    this.evictions = 0;
    this.next = 1;
  }

  tierCapacity(level) { return this.cfg.tiers[level - 1].capacityBytes; }

  sizeOf(block) { return block.bytes; }

  /* Put a block into a tier without running any policy. Used to seed the
   * cache and by the migration code once it has decided where to go. */
  place(block, level) {
    const i = level - 1;
    if (block.level) this.unplace(block);
    block.level = level;
    this.usage[i] += this.sizeOf(block);
    this.items[i].add(block.key);
  }

  unplace(block) {
    if (!block.level) return;
    const i = block.level - 1;
    this.usage[i] -= this.sizeOf(block);
    if (this.usage[i] < 0) this.usage[i] = 0;
    this.items[i].delete(block.key);
    block.level = 0;
  }

  get(key) { return this.blocks.get(key) || null; }

  has(key) { return this.blocks.has(key); }

  /*
   * Create or refresh a block. `originLevel` is where the data comes from
   * when it is not in the cache at all - a cold load reads through to the
   * bottom tier rather than pretending the value appeared in L1.
   */
  put(key, data, opts) {
    const o = opts || {};
    const bytes = o.bytes != null ? o.bytes : Buffer.byteLength(String(data == null ? '' : data));
    let block = this.blocks.get(key);
    if (!block) {
      block = {
        key: key,
        data: data,
        bytes: Math.max(1, bytes),
        version: 1,
        accessCount: 0,
        timestamp: this.clock(),
        level: 0,
        dirty: false,
        locked: false,
        prefetched: false
      };
      this.blocks.set(key, block);
      this.place(block, o.level || 6);
    } else {
      block.data = data;
      block.bytes = Math.max(1, bytes);
      block.version++;
      block.dirty = true;
      block.timestamp = this.clock();
      if (o.level) this.place(block, o.level);
    }
    if (o.prefetched) block.prefetched = true;
    return block;
  }

  /* A read that found the block: count it, stamp it, and let the policy
   * decide whether the access makes it hot enough to move up. */
  touch(block) {
    block.accessCount++;
    block.timestamp = this.clock();
    return block;
  }

  /*
   * Temperature-driven migration, chapter 7.2. A block hotter than the hot
   * threshold moves one tier up, colder than the cold threshold one tier
   * down; the target must have room under its high watermark, and a tier
   * over its high watermark evicts its coldest block first.
   */
  consider(block) {
    const s = this.cfg.scheduling;
    if (block.locked) return null;
    if (block.accessCount >= s.hotThreshold && block.level > 1) {
      return this.moveToward(block, block.level - 1, s);
    }
    if (block.accessCount > 0 && block.accessCount <= s.coldThreshold && block.level < 6) {
      return this.moveToward(block, block.level + 1, s);
    }
    return null;
  }

  moveToward(block, target, s) {
    if (target < 1 || target > 6) return null;
    const cap = this.tierCapacity(target) * (s.highWatermark || 0.9);
    while (this.usage[target - 1] + this.sizeOf(block) > cap && this.items[target - 1].size) {
      if (!this.evictColdest(target)) break;
    }
    if (this.usage[target - 1] + this.sizeOf(block) > cap) return null;
    const from = block.level;
    this.place(block, target);
    this.migrations++;
    return { key: block.key, from: from, to: target };
  }

  /* Chapter 7.2 capacity trigger: drop the coldest block of a full tier to
   * the next one down. Returns false when there is nothing to drop. */
  evictColdest(level) {
    if (level >= 6) return false;
    let coldest = null;
    for (const key of this.items[level - 1]) {
      const b = this.blocks.get(key);
      if (!b || b.locked) continue;
      if (!coldest || b.timestamp < coldest.timestamp) coldest = b;
    }
    if (!coldest) return false;
    const from = coldest.level;
    this.place(coldest, level + 1);
    this.evictions++;
    return true;
  }

  /* Chapter 2.3 prefetch trigger: a predicted neighbour is lifted to L4 (or
   * L3 when it is already above L4). */
  prefetch(key, probability, data, bytes) {
    const s = this.cfg.scheduling;
    if (probability < (s.prefetchThreshold || 0.6)) return null;
    if (this.has(key)) return null;
    const block = this.put(key, data, { bytes: bytes, level: 4, prefetched: true });
    return block;
  }

  /* Chapter 7.2 on_failure: promote a replica, or rebuild from below. */
  rebuild(keys) {
    let n = 0;
    for (const key of keys) {
      const b = this.blocks.get(key);
      if (!b) continue;
      /* A rebuild is a cold load: the block is back, at the bottom, with the
       * version it had - never a lower one. */
      this.place(b, 6);
      b.dirty = false;
      n++;
    }
    return n;
  }

  /* Everything the dashboard and the invariant checks need, in one read. */
  stats() {
    const cfg = this.cfg;
    return {
      blocks: this.blocks.size,
      migrations: this.migrations,
      evictions: this.evictions,
      tiers: cfg.tiers.map((t, i) => ({
        id: t.id,
        level: i + 1,
        items: this.items[i].size,
        usageBytes: this.usage[i],
        capacityBytes: t.capacityBytes,
        utilization: t.capacityBytes ? this.usage[i] / t.capacityBytes : 0,
        weight: tierWeight(cfg, t.id),
        latencyNs: t.latencyNs
      }))
    };
  }
}
