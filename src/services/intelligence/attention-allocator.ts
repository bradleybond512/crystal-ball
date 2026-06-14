/**
 * Attention Allocator — Phase 3 Learn-stage attention budget.
 *
 * Reads per-domain calibration from the OutcomeLedger and turns it into
 * a small set of attention multipliers (centred on 1.0). Downstream
 * scorers and refresh schedulers can ask "how much should I weight this
 * domain?" and get a single answer that reflects the user's accumulated
 * dismiss / escalate / confirm history.
 *
 * Pure module — no DOM, no fetch, no globals at import time. Persists
 * the current allocation to `localStorage` under `wm-attention-allocation`
 * so the very first paint after launch already reflects the previous
 * session's learning.
 */

import {
  getOutcomeLedger,
  type OutcomeLedger,
} from './outcome-ledger';

export type AttentionListener = (allocation: Record<string, number>) => void;

const STORAGE_KEY = 'wm-attention-allocation';
const NEUTRAL_MULTIPLIER = 1;
/** Maximum multiplier change allowed per recompute() call per domain.
 *  Limits the speed at which a tampered outcome ledger can shift the
 *  allocation — an attacker needs many recompute cycles to move a
 *  multiplier from 1.0 to 2.0, giving time for anomaly detection. */
export const MAX_RECOMPUTE_STEP = 0.1;

function safeStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

function deserialize(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== 'string' || typeof v !== 'number') continue;
    if (!Number.isFinite(v)) continue;
    // Defensive clamp so a corrupt persisted blob can't push downstream
    // scorers into NaN / runaway territory.
    out[k] = Math.max(0, Math.min(2, v));
  }
  return out;
}

export interface AttentionAllocatorOptions {
  /** Inject a specific ledger — useful for tests. Defaults to the
   *  shared singleton. */
  ledger?: OutcomeLedger;
}

export class AttentionAllocator {
  private allocation: Record<string, number> = {};
  private listeners = new Set<AttentionListener>();
  private hydrated = false;
  private ledger: OutcomeLedger;

  constructor(options: AttentionAllocatorOptions = {}) {
    this.ledger = options.ledger ?? getOutcomeLedger();
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const store = safeStorage();
    if (!store) return;
    let raw: string | null = null;
    try { raw = store.getItem(STORAGE_KEY); } catch { return; }
    if (!raw) return;
    try {
      this.allocation = deserialize(JSON.parse(raw));
    } catch {
      // Corrupt blob — start clean.
    }
  }

  private persist(): void {
    const store = safeStorage();
    if (!store) return;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(this.allocation));
    } catch {
      // Quota or disabled — best-effort.
    }
  }

  private notify(): void {
    const snapshot = this.getAllocation();
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  /** Read-only snapshot of the current per-domain multipliers. */
  getAllocation(): Record<string, number> {
    this.ensureHydrated();
    return { ...this.allocation };
  }

  /** Per-domain multiplier; unknown domains return the neutral 1.0 so
   *  scorers don't have to special-case missing entries. */
  getMultiplier(domain: string): number {
    this.ensureHydrated();
    return this.allocation[domain] ?? NEUTRAL_MULTIPLIER;
  }

  /** Pull the latest weight recommendations from the OutcomeLedger and
   *  replace the current allocation. Each domain's multiplier is clamped
   *  to within ±MAX_RECOMPUTE_STEP of its previous value so a single
   *  tampered-ledger recompute cannot instantly shift any domain to an
   *  extreme. Persists + notifies on change. */
  recompute(): void {
    this.ensureHydrated();
    const raw = this.ledger.getWeightRecommendations();
    // Rate-limit per-domain movement.
    const next: Record<string, number> = {};
    for (const [domain, target] of Object.entries(raw)) {
      const current = this.allocation[domain] ?? NEUTRAL_MULTIPLIER;
      next[domain] = Math.max(
        current - MAX_RECOMPUTE_STEP,
        Math.min(current + MAX_RECOMPUTE_STEP, target),
      );
    }
    if (shallowEqual(this.allocation, next)) return;
    this.allocation = next;
    this.persist();
    this.notify();
  }

  subscribe(listener: AttentionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Test seam — empties allocation, drops listeners, clears storage. */
  resetForTesting(): void {
    this.allocation = {};
    this.listeners.clear();
    this.hydrated = true;
    const store = safeStorage();
    if (store) {
      try { store.removeItem(STORAGE_KEY); } catch { /* best effort */ }
    }
  }
}

function shallowEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

// ── Singleton ─────────────────────────────────────────────────────────

let _singleton: AttentionAllocator | null = null;

export function getAttentionAllocator(): AttentionAllocator {
  _singleton ??= new AttentionAllocator();
  return _singleton;
}

/** Test seam — replaces the singleton with a fresh instance. */
export function __resetAttentionAllocatorSingleton(): void {
  _singleton = null;
}

export const __internals = {
  STORAGE_KEY,
  NEUTRAL_MULTIPLIER,
  MAX_RECOMPUTE_STEP,
};
