/**
 * TrustBudgetService — per-domain alert-quota self-throttle.
 *
 * Each domain gets a budget of N alerts per windowMs. Exceeding the
 * budget flips the domain into suppression: subsequent alerts are
 * recorded (with suppressed=true) but not delivered. The budget
 * auto-adjusts when adjustQuota() is called with a recent
 * false-positive rate; high FPR shrinks the quota toward 0.5×base,
 * low FPR (negative correction) expands it toward 2×base.
 *
 * Pure deterministic; no DOM, no fetch. Distinct from
 * src/services/notifications/trust-budget.ts (caller / notification
 * layer) — this service models the upstream throttling decision
 * inside the intelligence layer.
 */

// ── Public types ─────────────────────────────────────────────────────

export interface TrustBudgetConfig {
  domain: string;
  baseQuota: number;
  windowMs: number;
  currentQuota: number;
  adjustmentFactor: number;
  lastAdjustedAt: number;
}

export interface BudgetConsumption {
  id: string;
  domain: string;
  alertId: string;
  consumedAt: number;
  suppressed: boolean;
}

export interface BudgetStatus {
  domain: string;
  quota: number;
  consumed: number;
  remaining: number;
  resetsAt: number;
  suppressionActive: boolean;
}

export interface CheckResult {
  allowed: boolean;
  status: BudgetStatus;
}

export type BudgetListener = (consumption: BudgetConsumption) => void;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface TrustBudgetServiceOptions {
  capacity?: number;
  storage?: StorageLike | null;
  now?: () => number;
}

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_HOUR_MS = 60 * 60_000;
const DEFAULT_CAPACITY = 2000;
export const BUDGETS_STORAGE_KEY = 'wm-trust-budgets';
export const CONSUMPTIONS_STORAGE_KEY = 'wm-trust-consumptions';

const ADJUSTMENT_MIN = 0.5;
const ADJUSTMENT_MAX = 2;

/** Domains with their own baseline quotas. Unknown domains use the
 *  fallback below. */
const DEFAULT_DOMAIN_QUOTAS: Record<string, { baseQuota: number; windowMs: number }> = {
  earthquake:      { baseQuota: 10, windowMs: DEFAULT_HOUR_MS },
  biosurv:         { baseQuota: 10, windowMs: DEFAULT_HOUR_MS },
  weather:         { baseQuota: 10, windowMs: DEFAULT_HOUR_MS },
  maritime:        { baseQuota: 10, windowMs: DEFAULT_HOUR_MS },
  aviation:        { baseQuota: 10, windowMs: DEFAULT_HOUR_MS },
  geopolitical:    { baseQuota: 10, windowMs: DEFAULT_HOUR_MS },
  cyber:           { baseQuota: 10, windowMs: DEFAULT_HOUR_MS },
  wildfire:        { baseQuota: 10, windowMs: DEFAULT_HOUR_MS },
};
const UNKNOWN_DOMAIN_DEFAULT = { baseQuota: 5, windowMs: DEFAULT_HOUR_MS };

// ── Engine ──────────────────────────────────────────────────────────

interface PersistedConsumptions {
  consumptions: BudgetConsumption[];
}

interface PersistedConfigs {
  configs: TrustBudgetConfig[];
}

export class TrustBudgetService {
  private readonly capacity: number;
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly configs = new Map<string, TrustBudgetConfig>();
  private readonly consumptions: BudgetConsumption[] = [];
  private readonly subscribers = new Set<BudgetListener>();
  private idCounter = 0;

  constructor(opts: TrustBudgetServiceOptions = {}) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.clock = opts.now ?? Date.now;
    this.hydrate();
  }

  checkAndConsume(domain: string, alertId: string): CheckResult {
    const config = this.ensureConfig(domain);
    const now = this.clock();
    const windowStart = floorToWindow(now, config.windowMs);
    const consumedNow = this.countConsumedInWindow(domain, windowStart, now, config.windowMs);
    const allowed = consumedNow < config.currentQuota;
    this.idCounter++;
    const record: BudgetConsumption = {
      id: `tb-${now}-${this.idCounter}`,
      domain,
      alertId,
      consumedAt: now,
      suppressed: !allowed,
    };
    this.consumptions.push(record);
    while (this.consumptions.length > this.capacity) this.consumptions.shift();
    this.persistConsumptions();
    for (const cb of this.subscribers) cb(record);
    return {
      allowed,
      status: this.computeStatus(config, now),
    };
  }

  adjustQuota(domain: string, falsePosRate: number): void {
    const config = this.ensureConfig(domain);
    const rawFactor = 1 - falsePosRate;
    const adjustmentFactor = Number(clamp(rawFactor, ADJUSTMENT_MIN, ADJUSTMENT_MAX).toFixed(4));
    const currentQuota = Math.max(1, Math.round(config.baseQuota * adjustmentFactor));
    this.configs.set(domain, {
      ...config,
      adjustmentFactor,
      currentQuota,
      lastAdjustedAt: this.clock(),
    });
    this.persistConfigs();
  }

  resetWindow(domain: string): void {
    const config = this.configs.get(domain) ?? this.ensureConfig(domain);
    const now = this.clock();
    const windowStart = floorToWindow(now, config.windowMs);
    // Remove in-window records for the given domain only.
    const next: BudgetConsumption[] = [];
    for (const rec of this.consumptions) {
      if (rec.domain === domain && rec.consumedAt >= windowStart) continue;
      next.push(rec);
    }
    this.consumptions.length = 0;
    for (const rec of next) this.consumptions.push(rec);
    this.persistConsumptions();
  }

  getStatus(domain: string): BudgetStatus {
    const config = this.ensureConfig(domain);
    return this.computeStatus(config, this.clock());
  }

  getAllStatuses(): BudgetStatus[] {
    const now = this.clock();
    const domains = new Set<string>();
    for (const config of this.configs.values()) domains.add(config.domain);
    for (const rec of this.consumptions) domains.add(rec.domain);
    return [...domains].map((domain) => this.computeStatus(this.ensureConfig(domain), now));
  }

  getConsumptions(domain?: string, limit?: number): BudgetConsumption[] {
    const out: BudgetConsumption[] = [];
    for (let i = this.consumptions.length - 1; i >= 0; i--) {
      const rec = this.consumptions[i]!;
      if (domain && rec.domain !== domain) continue;
      out.push(rec);
      if (limit && out.length >= limit) break;
    }
    return out;
  }

  getConfig(domain: string): TrustBudgetConfig | undefined {
    return this.configs.get(domain);
  }

  subscribe(cb: BudgetListener): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  unsubscribe(cb: BudgetListener): void {
    this.subscribers.delete(cb);
  }

  // ── Internals ─────────────────────────────────────────────────────

  private ensureConfig(domain: string): TrustBudgetConfig {
    const existing = this.configs.get(domain);
    if (existing) return existing;
    const defaults = DEFAULT_DOMAIN_QUOTAS[domain] ?? UNKNOWN_DOMAIN_DEFAULT;
    const config: TrustBudgetConfig = {
      domain,
      baseQuota: defaults.baseQuota,
      windowMs: defaults.windowMs,
      currentQuota: defaults.baseQuota,
      adjustmentFactor: 1,
      lastAdjustedAt: 0,
    };
    this.configs.set(domain, config);
    this.persistConfigs();
    return config;
  }

  private countConsumedInWindow(domain: string, windowStart: number, now: number, windowMs: number): number {
    const windowEnd = windowStart + windowMs;
    let count = 0;
    for (const rec of this.consumptions) {
      if (rec.domain !== domain) continue;
      if (rec.suppressed) continue;
      if (rec.consumedAt < windowStart || rec.consumedAt >= windowEnd) continue;
      if (rec.consumedAt > now) continue;
      count++;
    }
    return count;
  }

  private computeStatus(config: TrustBudgetConfig, now: number): BudgetStatus {
    const windowStart = floorToWindow(now, config.windowMs);
    const consumed = this.countConsumedInWindow(config.domain, windowStart, now, config.windowMs);
    const remaining = Math.max(0, config.currentQuota - consumed);
    return {
      domain: config.domain,
      quota: config.currentQuota,
      consumed,
      remaining,
      resetsAt: windowStart + config.windowMs,
      suppressionActive: consumed >= config.currentQuota,
    };
  }

  private persistConfigs(): void {
    if (!this.storage) return;
    try {
      const serial: PersistedConfigs = { configs: [...this.configs.values()] };
      this.storage.setItem(BUDGETS_STORAGE_KEY, JSON.stringify(serial));
    } catch {
      // Storage failures are non-fatal.
    }
  }

  private persistConsumptions(): void {
    if (!this.storage) return;
    try {
      const serial: PersistedConsumptions = { consumptions: this.consumptions };
      this.storage.setItem(CONSUMPTIONS_STORAGE_KEY, JSON.stringify(serial));
    } catch {
      // Storage failures are non-fatal.
    }
  }

  private hydrate(): void {
    if (!this.storage) return;
    this.hydrateConfigs();
    this.hydrateConsumptions();
  }

  private hydrateConfigs(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(BUDGETS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedConfigs;
      if (!parsed || !Array.isArray(parsed.configs)) return;
      for (const config of parsed.configs) this.configs.set(config.domain, config);
    } catch {
      this.configs.clear();
    }
  }

  private hydrateConsumptions(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(CONSUMPTIONS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedConsumptions;
      if (!parsed || !Array.isArray(parsed.consumptions)) return;
      for (const rec of parsed.consumptions) this.consumptions.push(rec);
      while (this.consumptions.length > this.capacity) this.consumptions.shift();
    } catch {
      this.consumptions.length = 0;
    }
  }
}

// ── Lazy singleton ──────────────────────────────────────────────────

let singleton: TrustBudgetService | undefined;

export function getIntelligenceTrustBudgetService(): TrustBudgetService {
  singleton ??= new TrustBudgetService();
  return singleton;
}

export function resetForTests(): void {
  singleton = undefined;
}

// ── Helpers ─────────────────────────────────────────────────────────

function floorToWindow(now: number, windowMs: number): number {
  if (windowMs <= 0) return now;
  return Math.floor(now / windowMs) * windowMs;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}
