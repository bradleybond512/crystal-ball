/**
 * Correlation store — bounded ring buffer for CorrelatedPair output.
 *
 * Deduplicates by (ruleId, eventA.id, eventB.id) so the same pair never
 * lands twice. Optional persistence seam writes the buffer to
 * `localStorage['wm-correlation-store']` after every mutation; tests
 * pass an in-memory `StorageLike`.
 *
 * Pure: no DOM, no fetch.
 */

import type { CorrelatedPair, EdgeType } from './correlate-engine';

const DEFAULT_CAPACITY = 500;
export const STORAGE_KEY = 'wm-correlation-store';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CorrelationStoreOptions {
  capacity?: number;
  storage?: StorageLike | null;
}

export interface CorrelationStats {
  total: number;
  byRule: Record<string, number>;
  byEdgeType: Record<EdgeType, number>;
}

interface SerializedPair extends Omit<CorrelatedPair, 'detectedAt'> {
  detectedAt: number;
}

function makeKey(p: { ruleId: string; eventA: { id: string }; eventB: { id: string } }): string {
  // Symmetric: same key regardless of A/B order.
  const [first, second] = p.eventA.id < p.eventB.id ? [p.eventA.id, p.eventB.id] : [p.eventB.id, p.eventA.id];
  return `${p.ruleId}|${first}|${second}`;
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}

export class CorrelationStore {
  private readonly capacity: number;
  private readonly storage: StorageLike | null;
  private buffer: CorrelatedPair[] = [];
  private readonly keys = new Set<string>();

  constructor(opts: CorrelationStoreOptions = {}) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.hydrate();
  }

  add(pair: CorrelatedPair): boolean {
    const key = makeKey(pair);
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    this.buffer.push(pair);
    if (this.buffer.length > this.capacity) {
      const dropped = this.buffer.shift();
      if (dropped) this.keys.delete(makeKey(dropped));
    }
    this.persist();
    return true;
  }

  /** Most-recent pairs first. When `limitMs` is supplied, drops anything
   *  detected more than `limitMs` before `now`. */
  getRecent(limitMs?: number, now: number = Date.now()): readonly CorrelatedPair[] {
    const cutoff = limitMs === undefined ? Number.NEGATIVE_INFINITY : now - limitMs;
    const out: CorrelatedPair[] = [];
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      const p = this.buffer[i];
      if (p && p.detectedAt.getTime() >= cutoff) out.push(p);
    }
    return out;
  }

  getByDomains(domains: readonly string[]): readonly CorrelatedPair[] {
    const set = new Set(domains);
    return this.buffer.filter((p) => set.has(p.eventA.domain) || set.has(p.eventB.domain));
  }

  getByEdgeType(edgeType: EdgeType): readonly CorrelatedPair[] {
    return this.buffer.filter((p) => p.edgeType === edgeType);
  }

  stats(): CorrelationStats {
    const byRule: Record<string, number> = {};
    const byEdgeType: Record<EdgeType, number> = {
      'co-located': 0,
      'temporally-adjacent': 0,
      'causal-candidate': 0,
      contradicts: 0,
    };
    for (const p of this.buffer) {
      byRule[p.ruleId] = (byRule[p.ruleId] ?? 0) + 1;
      byEdgeType[p.edgeType]++;
    }
    return { total: this.buffer.length, byRule, byEdgeType };
  }

  clear(): void {
    this.buffer = [];
    this.keys.clear();
    this.persist();
  }

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SerializedPair[];
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        const pair: CorrelatedPair = { ...item, detectedAt: new Date(item.detectedAt) };
        const key = makeKey(pair);
        if (this.keys.has(key)) continue;
        this.keys.add(key);
        this.buffer.push(pair);
        if (this.buffer.length > this.capacity) {
          const dropped = this.buffer.shift();
          if (dropped) this.keys.delete(makeKey(dropped));
        }
      }
    } catch {
      // Corrupted storage — start clean.
      this.buffer = [];
      this.keys.clear();
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const serial: SerializedPair[] = this.buffer.map((p) => ({
        ...p,
        detectedAt: p.detectedAt.getTime(),
      }));
      this.storage.setItem(STORAGE_KEY, JSON.stringify(serial));
    } catch {
      // Storage failures (quota, security) are non-fatal.
    }
  }
}

// ── Lazy singleton for app code (tests use the class directly) ──────

let singleton: CorrelationStore | undefined;

export function getCorrelationStore(): CorrelationStore {
  singleton ??= new CorrelationStore();
  return singleton;
}

export function resetForTests(): void {
  singleton = undefined;
}
