/**
 * Trust Budget — per-domain rolling alert quota that auto-tightens on
 * high false-positive rates and loosens on high acted-on rates.
 *
 * Pure store + injectable Storage + injectable OutcomeStatsProvider so
 * tests run without a DOM and so the production wiring can plug in any
 * outcome source (notification-audit dismissals, forecast-calibration
 * hit rates, or a future dedicated outcome ledger).
 *
 * Storage shape: persisted to localStorage at STORAGE_KEY with budgets
 * keyed by domain. Dates serialized as ISO strings; numbers are stored
 * verbatim.
 */

// ── Public types ─────────────────────────────────────────────────────────

export interface DomainBudget {
  domain: string;
  baseQuota: number;
  currentQuota: number;
  used: number;
  windowStartMs: number;
  exhausted: boolean;
  lastAdjustedAt: Date;
  adjustmentReason: string;
}

export interface TrustBudgetSnapshot {
  takenAt: Date;
  domains: DomainBudget[];
  globalUsed: number;
  globalQuota: number;
  exhaustedDomains: string[];
}

export interface OutcomeStats {
  domain: string;
  total: number;
  falsePositives: number;
  actedOn: number;
}

export interface OutcomeStatsProvider {
  getOutcomeStats(domain: string): OutcomeStats | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface TrustBudgetService {
  canSend(domain: string): boolean;
  consume(domain: string): void;
  recharge(domain: string): void;
  rechargeAll(): void;
  adjustQuotas(): void;
  getSnapshot(): TrustBudgetSnapshot;
  getBudget(domain: string): DomainBudget;
  getAllBudgets(): DomainBudget[];
  subscribe(cb: (snapshot: TrustBudgetSnapshot) => void): () => void;
}

export interface TrustBudgetOptions {
  storage?: StorageLike | null;
  outcomeProvider?: OutcomeStatsProvider | null;
  now?: () => number;
  baseQuota?: number;
}

// ── Constants ────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-trust-budget';
export const DEFAULT_BASE_QUOTA = 3;
export const QUOTA_MIN = 0.5;
export const QUOTA_MAX = 10;
const WINDOW_MS = 60 * 60_000;
const MIN_OUTCOMES_FOR_ADJUST = 5;
const FP_THRESHOLD = 0.6;
const ACTED_THRESHOLD = 0.4;
const REDUCE_FACTOR = 0.7;
const INCREASE_FACTOR = 1.3;

// ── Helpers ──────────────────────────────────────────────────────────────

function resolveLocalStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function clampQuota(n: number): number {
  return Math.max(QUOTA_MIN, Math.min(QUOTA_MAX, n));
}

function cloneBudget(b: DomainBudget): DomainBudget {
  return {
    ...b,
    lastAdjustedAt: new Date(b.lastAdjustedAt),
  };
}

interface PersistedBudget {
  domain: string;
  baseQuota: number;
  currentQuota: number;
  used: number;
  windowStartMs: number;
  exhausted: boolean;
  lastAdjustedAt: string;
  adjustmentReason: string;
}

function serializeBudget(b: DomainBudget): PersistedBudget {
  return {
    domain: b.domain,
    baseQuota: b.baseQuota,
    currentQuota: b.currentQuota,
    used: b.used,
    windowStartMs: b.windowStartMs,
    exhausted: b.exhausted,
    lastAdjustedAt: b.lastAdjustedAt.toISOString(),
    adjustmentReason: b.adjustmentReason,
  };
}

function deserializeBudget(raw: unknown): DomainBudget | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.domain !== 'string') return null;
  const baseQuota = Number(r.baseQuota);
  const currentQuota = Number(r.currentQuota);
  const used = Number(r.used);
  const windowStartMs = Number(r.windowStartMs);
  if (!Number.isFinite(baseQuota) || !Number.isFinite(currentQuota)
    || !Number.isFinite(used) || !Number.isFinite(windowStartMs)) return null;
  const lastAdjustedAt = typeof r.lastAdjustedAt === 'string'
    ? new Date(r.lastAdjustedAt) : new Date();
  if (Number.isNaN(lastAdjustedAt.getTime())) return null;
  return {
    domain: r.domain,
    baseQuota,
    currentQuota,
    used,
    windowStartMs,
    exhausted: !!r.exhausted,
    lastAdjustedAt,
    adjustmentReason: typeof r.adjustmentReason === 'string' ? r.adjustmentReason : '',
  };
}

function freshBudget(domain: string, baseQuota: number, nowMs: number): DomainBudget {
  return {
    domain,
    baseQuota,
    currentQuota: baseQuota,
    used: 0,
    windowStartMs: nowMs,
    exhausted: false,
    lastAdjustedAt: new Date(nowMs),
    adjustmentReason: 'Initial budget at base quota.',
  };
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createTrustBudgetService(options: TrustBudgetOptions = {}): TrustBudgetService {
  const storage = resolveLocalStorage(options.storage);
  const clock = options.now ?? (() => Date.now());
  const baseQuotaCfg = options.baseQuota ?? DEFAULT_BASE_QUOTA;
  const outcomeProvider = options.outcomeProvider ?? null;
  const budgets = new Map<string, DomainBudget>();
  const listeners = new Set<(s: TrustBudgetSnapshot) => void>();

  rehydrate(budgets, storage);

  function persist(): void {
    if (!storage) return;
    try {
      const payload = [...budgets.values()].map((b) => serializeBudget(b));
      storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch { /* quota / private-mode — non-critical */ }
  }

  function notify(): void {
    const snapshot = buildSnapshot();
    for (const cb of listeners) {
      try { cb(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  function ensureBudget(domain: string): DomainBudget {
    let b = budgets.get(domain);
    if (!b) {
      b = freshBudget(domain, baseQuotaCfg, clock());
      budgets.set(domain, b);
    }
    return b;
  }

  function autoRecharge(b: DomainBudget): void {
    if (clock() - b.windowStartMs > WINDOW_MS) {
      b.used = 0;
      b.windowStartMs = clock();
      b.exhausted = false;
    }
  }

  function buildSnapshot(): TrustBudgetSnapshot {
    const domains = [...budgets.values()].map((b) => cloneBudget(b));
    const globalUsed = domains.reduce((s, b) => s + b.used, 0);
    const globalQuota = domains.reduce((s, b) => s + b.currentQuota, 0);
    const exhaustedDomains = domains.filter((b) => b.exhausted).map((b) => b.domain);
    return { takenAt: new Date(clock()), domains, globalUsed, globalQuota, exhaustedDomains };
  }

  function applyAdjustment(b: DomainBudget): void {
    if (!outcomeProvider) return;
    const stats = outcomeProvider.getOutcomeStats(b.domain);
    if (!stats || stats.total < MIN_OUTCOMES_FOR_ADJUST) return;
    const fpRate = stats.total > 0 ? stats.falsePositives / stats.total : 0;
    const actedRate = stats.total > 0 ? stats.actedOn / stats.total : 0;
    let next = b.currentQuota;
    let reason = '';
    if (fpRate > FP_THRESHOLD) {
      next = clampQuota(b.currentQuota * REDUCE_FACTOR);
      reason = `High false-positive rate (${(fpRate * 100).toFixed(0)}%) → quota reduced to ${next.toFixed(1)}.`;
    } else if (actedRate > ACTED_THRESHOLD) {
      next = clampQuota(b.currentQuota * INCREASE_FACTOR);
      reason = `Alerts valuable (${(actedRate * 100).toFixed(0)}% acted on) → quota raised to ${next.toFixed(1)}.`;
    } else {
      return; // neutral zone or low signal — leave unchanged
    }
    if (next === b.currentQuota) {
      // Already at a bound; still record the audit trail timestamp.
      b.lastAdjustedAt = new Date(clock());
      b.adjustmentReason = reason;
      return;
    }
    b.currentQuota = next;
    b.lastAdjustedAt = new Date(clock());
    b.adjustmentReason = reason;
    if (b.used < b.currentQuota) b.exhausted = false;
  }

  return {
    canSend(domain): boolean {
      const b = ensureBudget(domain);
      autoRecharge(b);
      return b.used < b.currentQuota;
    },

    consume(domain): void {
      const b = ensureBudget(domain);
      autoRecharge(b);
      b.used += 1;
      if (b.used >= b.currentQuota) b.exhausted = true;
      persist();
      notify();
    },

    recharge(domain): void {
      const b = ensureBudget(domain);
      b.used = 0;
      b.windowStartMs = clock();
      b.exhausted = false;
      persist();
      notify();
    },

    rechargeAll(): void {
      const now = clock();
      for (const b of budgets.values()) {
        b.used = 0;
        b.windowStartMs = now;
        b.exhausted = false;
      }
      persist();
      notify();
    },

    adjustQuotas(): void {
      for (const b of budgets.values()) applyAdjustment(b);
      persist();
      notify();
    },

    getSnapshot(): TrustBudgetSnapshot {
      return buildSnapshot();
    },

    getBudget(domain): DomainBudget {
      return cloneBudget(ensureBudget(domain));
    },

    getAllBudgets(): DomainBudget[] {
      return [...budgets.values()].map((b) => cloneBudget(b));
    },

    subscribe(cb): () => void {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
  };
}

function rehydrate(budgets: Map<string, DomainBudget>, storage: StorageLike | null): void {
  if (!storage) return;
  let raw: string | null;
  try { raw = storage.getItem(STORAGE_KEY); }
  catch { return; }
  if (!raw) return;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return; }
  if (!Array.isArray(parsed)) return;
  for (const p of parsed) {
    const b = deserializeBudget(p);
    if (b) budgets.set(b.domain, b);
  }
}

// ── Lazy singleton ───────────────────────────────────────────────────────

let _singleton: TrustBudgetService | null = null;

export function getTrustBudgetService(): TrustBudgetService {
  _singleton ??= createTrustBudgetService();
  return _singleton;
}

export function _resetTrustBudgetSingletonForTests(): void {
  _singleton = null;
}
