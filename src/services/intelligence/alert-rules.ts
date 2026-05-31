/**
 * AlertRulesService — user-configurable per-domain alert rules.
 *
 * Pure, deterministic singleton. Tracks three knobs per
 * NotificationDomain so the UI can give operators direct control over
 * notification noise:
 *
 *   - severity threshold  (0..4): suppress anything below this severity
 *   - suppression window (ms):    cooldown before re-alerting the same domain
 *   - domain weight     (0..1):    how heavily a domain contributes to the
 *                                  overall risk score
 *
 * Persists each knob set to its own localStorage key so a corrupt blob
 * can't take down the rest of the configuration. Tests inject `storage`
 * and `clock` to keep the service hermetic.
 */

import type { NotificationDomain } from '@/services/notifications/notification-settings-service';

// ── Public types ─────────────────────────────────────────────────────

/** Numeric severity scale used by the threshold knob. Mirrors the order
 *  of NotificationSeverity (info=0, low=1, medium=2, high=3, critical=4)
 *  so callers can convert between the string + integer worlds without
 *  another lookup table. */
export type SeverityIndex = 0 | 1 | 2 | 3 | 4;

export type AlertRulesPreset = 'all' | 'high-priority' | 'crisis' | 'silent';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface AlertRulesServiceOptions {
  storage?: StorageLike | null;
  clock?: () => number;
}

// ── Constants ────────────────────────────────────────────────────────

export const THRESHOLDS_STORAGE_KEY = 'wm-alert-rules-thresholds';
export const SUPPRESSION_STORAGE_KEY = 'wm-alert-rules-suppression';
export const WEIGHTS_STORAGE_KEY = 'wm-alert-rules-weights';

/** All notification domains the panel can tune. Kept in sync with
 *  notification-settings-service's ALL_DOMAINS — duplicated here to
 *  avoid a runtime import cycle through the panel/Settings stack. */
export const ALL_DOMAINS: readonly NotificationDomain[] = [
  'earthquakes',
  'wildfire',
  'aviation',
  'maritime',
  'biosurveillance',
  'space_weather',
  'infrastructure',
  'geopolitical',
  'weather',
  'cyber',
  'supply',
];

/** Discrete suppression-window options exposed by the UI dropdown.
 *  Listed shortest-first; 0 = no cooldown. */
export const SUPPRESSION_PRESETS_MS: readonly number[] = [
  0,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
  4 * 60 * 60_000,
];

export const DEFAULT_THRESHOLD: SeverityIndex = 2;       // 'medium'
export const DEFAULT_SUPPRESSION_MS = 0;
export const DEFAULT_WEIGHT = 1;                          // unweighted
const MIN_WEIGHT = 0;
const MAX_WEIGHT = 1;
const MIN_THRESHOLD: SeverityIndex = 0;
const MAX_THRESHOLD: SeverityIndex = 4;

// ── Singleton ────────────────────────────────────────────────────────

let singleton: AlertRulesService | null = null;

export function getAlertRulesService(): AlertRulesService {
  singleton ??= new AlertRulesService();
  return singleton;
}

export function __resetAlertRulesServiceSingleton(): void {
  singleton = null;
}

/** Convenience alias for callers used to `<Service>.getInstance()`. */
export const AlertRulesService_ = {
  getInstance: getAlertRulesService,
};

// ── Service ──────────────────────────────────────────────────────────

interface PersistedNumberMap {
  version: 1;
  values: Record<string, number>;
}

export class AlertRulesService {
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private thresholds = new Map<NotificationDomain, SeverityIndex>();
  private suppressionWindows = new Map<NotificationDomain, number>();
  private weights = new Map<NotificationDomain, number>();
  /** Per-domain timestamp of the last alert that *was not* suppressed.
   *  Used by isAlertSuppressed to decide whether a fresh alert falls
   *  inside the cooldown window. */
  private lastAlertAt = new Map<NotificationDomain, number>();
  private hydrated = false;

  constructor(options: AlertRulesServiceOptions = {}) {
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.clock = options.clock ?? (() => Date.now());
  }

  // ── Threshold knob ────────────────────────────────────────────────

  getThreshold(domain: NotificationDomain): SeverityIndex {
    this.ensureHydrated();
    return this.thresholds.get(domain) ?? DEFAULT_THRESHOLD;
  }

  setThreshold(domain: NotificationDomain, minSeverity: number): void {
    this.ensureHydrated();
    const clamped = clampInt(minSeverity, MIN_THRESHOLD, MAX_THRESHOLD) as SeverityIndex;
    this.thresholds.set(domain, clamped);
    this.persistThresholds();
  }

  // ── Suppression-window knob ───────────────────────────────────────

  getSuppressionWindow(domain: NotificationDomain): number {
    this.ensureHydrated();
    return this.suppressionWindows.get(domain) ?? DEFAULT_SUPPRESSION_MS;
  }

  setSuppressionWindow(domain: NotificationDomain, ms: number): void {
    this.ensureHydrated();
    const value = Number.isFinite(ms) && ms >= 0 ? Math.floor(ms) : DEFAULT_SUPPRESSION_MS;
    this.suppressionWindows.set(domain, value);
    this.persistSuppression();
  }

  // ── Domain-weight knob ────────────────────────────────────────────

  getDomainWeight(domain: NotificationDomain): number {
    this.ensureHydrated();
    return this.weights.get(domain) ?? DEFAULT_WEIGHT;
  }

  setDomainWeight(domain: NotificationDomain, weight: number): void {
    this.ensureHydrated();
    const clamped = Number.isFinite(weight) ? clamp(weight, MIN_WEIGHT, MAX_WEIGHT) : DEFAULT_WEIGHT;
    this.weights.set(domain, clamped);
    this.persistWeights();
  }

  // ── Composite query ───────────────────────────────────────────────

  /**
   * `true` when the alert should be suppressed either because the
   * severity is below the per-domain threshold *or* because the last
   * accepted alert for this domain is still inside the cooldown window.
   *
   * Non-suppressed calls also stamp `lastAlertAt[domain] = clock()` so
   * subsequent calls inside the window are correctly gated. The caller
   * is expected to invoke this exactly once per alert decision.
   */
  isAlertSuppressed(domain: NotificationDomain, severity: number): boolean {
    this.ensureHydrated();
    const threshold = this.getThreshold(domain);
    if (severity < threshold) return true;
    const window = this.getSuppressionWindow(domain);
    if (window > 0) {
      const last = this.lastAlertAt.get(domain);
      if (typeof last === 'number' && this.clock() - last < window) return true;
    }
    this.lastAlertAt.set(domain, this.clock());
    return false;
  }

  // ── Quick presets ─────────────────────────────────────────────────

  applyPreset(preset: AlertRulesPreset): void {
    this.ensureHydrated();
    const { threshold, suppressionMs } = presetSettings(preset);
    for (const domain of ALL_DOMAINS) {
      this.thresholds.set(domain, threshold);
      this.suppressionWindows.set(domain, suppressionMs);
    }
    this.persistThresholds();
    this.persistSuppression();
  }

  // ── Test seam ─────────────────────────────────────────────────────

  resetForTesting(): void {
    this.thresholds.clear();
    this.suppressionWindows.clear();
    this.weights.clear();
    this.lastAlertAt.clear();
    this.hydrated = true;
    if (!this.storage) return;
    for (const key of [THRESHOLDS_STORAGE_KEY, SUPPRESSION_STORAGE_KEY, WEIGHTS_STORAGE_KEY]) {
      if (this.storage.removeItem) {
        try { this.storage.removeItem(key); } catch { /* best effort */ }
      } else {
        try { this.storage.setItem(key, JSON.stringify({ version: 1, values: {} })); } catch { /* best effort */ }
      }
    }
  }

  // ── Hydrate / persist ─────────────────────────────────────────────

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    if (!this.storage) return;
    hydrateInto(this.thresholds, this.readMap(THRESHOLDS_STORAGE_KEY), (n) =>
      isValidThreshold(n) ? (n as SeverityIndex) : undefined,
    );
    hydrateInto(this.suppressionWindows, this.readMap(SUPPRESSION_STORAGE_KEY), (n) =>
      Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined,
    );
    hydrateInto(this.weights, this.readMap(WEIGHTS_STORAGE_KEY), (n) =>
      Number.isFinite(n) ? clamp(n, MIN_WEIGHT, MAX_WEIGHT) : undefined,
    );
  }

  private readMap(key: string): Record<string, number> | null {
    if (!this.storage) return null;
    let raw: string | null = null;
    try { raw = this.storage.getItem(key); } catch { return null; }
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as PersistedNumberMap;
      if (parsed?.version !== 1 || !parsed.values || typeof parsed.values !== 'object') return null;
      return parsed.values;
    } catch {
      return null;
    }
  }

  private persistThresholds(): void {
    this.persistMap(THRESHOLDS_STORAGE_KEY, this.thresholds);
  }

  private persistSuppression(): void {
    this.persistMap(SUPPRESSION_STORAGE_KEY, this.suppressionWindows);
  }

  private persistWeights(): void {
    this.persistMap(WEIGHTS_STORAGE_KEY, this.weights);
  }

  private persistMap(key: string, source: Map<NotificationDomain, number>): void {
    if (!this.storage) return;
    const values: Record<string, number> = {};
    for (const [domain, value] of source) values[domain] = value;
    try {
      const payload: PersistedNumberMap = { version: 1, values };
      this.storage.setItem(key, JSON.stringify(payload));
    } catch {
      // Quota / disabled — best effort.
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function presetSettings(preset: AlertRulesPreset): { threshold: SeverityIndex; suppressionMs: number } {
  switch (preset) {
    case 'all': { return { threshold: 0, suppressionMs: 0 }; }
    case 'high-priority': { return { threshold: 3, suppressionMs: 0 }; }
    case 'crisis': { return { threshold: 4, suppressionMs: 0 }; }
    case 'silent': { return { threshold: 5 as unknown as SeverityIndex, suppressionMs: 0 }; }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function isValidThreshold(n: number): boolean {
  return Number.isFinite(n) && n >= MIN_THRESHOLD && n <= 5;
}

function hydrateInto<V>(
  target: Map<NotificationDomain, V>,
  source: Record<string, number> | null,
  coerce: (n: number) => V | undefined,
): void {
  if (!source) return;
  for (const domain of ALL_DOMAINS) {
    const raw = source[domain];
    if (typeof raw !== 'number') continue;
    const value = coerce(raw);
    if (value === undefined) continue;
    target.set(domain, value);
  }
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}

// Exposed for tests that need to peek at internals.
export const __internals = {
  THRESHOLDS_STORAGE_KEY,
  SUPPRESSION_STORAGE_KEY,
  WEIGHTS_STORAGE_KEY,
  presetSettings,
  isValidThreshold,
};
