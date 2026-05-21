/**
 * AlertFatigueDetector — flag when the user is being overwhelmed by alerts.
 *
 * Records every alert the system raises and the subsequent acknowledgement.
 * Computes a `FatigueReport` over a configurable rolling window combining:
 *   - volume   (alertCount / saturation reference of 50/hr)
 *   - quality  (1 - ackRate)   ← unacknowledged alerts hurt twice: they
 *                                indicate the user has stopped engaging.
 *   - Score = volume × quality, clamped to [0, 1].
 *
 * The recommendation ladder lets the rest of the UI back off intelligently:
 *   - >0.8 → 'escalate-only'  (drop everything but critical)
 *   - >0.5 → 'suppress-low'   (no LOW severity for now)
 *   - >0.3 → 'batch'          (group into a single digest)
 *   - else → 'none'           (normal operation)
 *
 * Pure deterministic; no DOM, no fetch. Storage is `StorageLike`-compatible
 * so tests can swap in an in-memory stub.
 */

// ── Public types ────────────────────────────────────────────────────

export interface AlertRecord {
  id: string;
  domain: string;
  /** 0-100, higher = more severe. Used as a sort/filter signal by callers. */
  severity: number;
  timestamp: number;
  acknowledged: boolean;
}

export type FatigueRecommendation =
  | 'none'
  | 'batch'
  | 'suppress-low'
  | 'escalate-only';

export interface FatigueReport {
  windowMs: number;
  alertCount: number;
  /** Fraction of in-window alerts the user acknowledged. 0 when window is empty. */
  ackRate: number;
  /** Computed score in [0, 1]. Higher = more fatigue. */
  fatigueScore: number;
  recommendation: FatigueRecommendation;
  /** Domain with the most alerts in window. '' when window is empty. */
  topDomain: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AlertFatigueDetectorOptions {
  capacity?: number;
  storage?: StorageLike | null;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

// ── Constants ───────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-alert-fatigue';

const DEFAULT_CAPACITY = 1000;
const DEFAULT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const SATURATION_REFERENCE = 50; // 50 alerts/window = saturated volume
const MINUTE_MS = 60 * 1000;

const THRESHOLD_ESCALATE_ONLY = 0.8;
const THRESHOLD_SUPPRESS_LOW = 0.5;
const THRESHOLD_BATCH = 0.3;

// ── Engine ──────────────────────────────────────────────────────────

interface PersistedStore {
  alerts: AlertRecord[];
}

export class AlertFatigueDetector {
  private static instance: AlertFatigueDetector | undefined;

  private readonly capacity: number;
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly alerts: AlertRecord[] = [];
  private idCounter = 0;

  constructor(opts: AlertFatigueDetectorOptions = {}) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.clock = opts.now ?? Date.now;
    this.hydrate();
  }

  static getInstance(): AlertFatigueDetector {
    AlertFatigueDetector.instance ??= new AlertFatigueDetector();
    return AlertFatigueDetector.instance;
  }

  static resetForTests(): void {
    AlertFatigueDetector.instance = undefined;
  }

  /** Record a new alert. Returns the assigned id for later acknowledge(). */
  recordAlert(domain: string, severity: number): string {
    const now = this.clock();
    this.idCounter++;
    const id = `af-${now}-${this.idCounter}`;
    const clampedSev = clampSeverity(severity);

    this.alerts.push({
      id,
      domain,
      severity: clampedSev,
      timestamp: now,
      acknowledged: false,
    });

    while (this.alerts.length > this.capacity) this.alerts.shift();
    this.persist();
    return id;
  }

  /** Mark an alert as acknowledged. No-op if id is unknown. */
  acknowledge(id: string): void {
    const alert = this.alerts.find((a) => a.id === id);
    if (!alert || alert.acknowledged) return;
    alert.acknowledged = true;
    this.persist();
  }

  /** Read-only snapshot of all recorded alerts (oldest first). */
  getAllAlerts(): readonly AlertRecord[] {
    return [...this.alerts];
  }

  /**
   * Compute the current fatigue report over a rolling window. Score formula:
   *
   *   fatigueScore = clamp01( (alertCount / SATURATION_REFERENCE) × (1 - ackRate) )
   *
   * When the window is empty, ackRate is 0 by convention (no engagement to
   * measure), but alertCount is also 0, so the score collapses to 0 and the
   * recommendation is 'none'.
   */
  getFatigueReport(windowMs: number = DEFAULT_WINDOW_MS): FatigueReport {
    const safeWindow = windowMs > 0 ? windowMs : DEFAULT_WINDOW_MS;
    const windowAlerts = this.alertsInWindow(safeWindow);
    const alertCount = windowAlerts.length;
    const acked = windowAlerts.filter((a) => a.acknowledged).length;
    const ackRate = alertCount === 0 ? 0 : acked / alertCount;
    const volume = alertCount / SATURATION_REFERENCE;
    const quality = 1 - ackRate;
    const fatigueScore = clamp01(volume * quality);

    return {
      windowMs: safeWindow,
      alertCount,
      ackRate,
      fatigueScore,
      recommendation: recommendationFor(fatigueScore),
      topDomain: topDomainOf(windowAlerts),
    };
  }

  /** Alerts-per-minute over the given window. 0 when window is empty. */
  getAlertRate(windowMs: number): number {
    const safeWindow = windowMs > 0 ? windowMs : DEFAULT_WINDOW_MS;
    const count = this.alertsInWindow(safeWindow).length;
    return count / (safeWindow / MINUTE_MS);
  }

  // ── Internals ─────────────────────────────────────────────────────

  private alertsInWindow(windowMs: number): AlertRecord[] {
    const cutoff = this.clock() - windowMs;
    return this.alerts.filter((a) => a.timestamp >= cutoff);
  }

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedStore;
      if (!parsed || !Array.isArray(parsed.alerts)) return;
      for (const a of parsed.alerts) {
        if (isValidPersistedAlert(a)) this.alerts.push(a);
      }
      while (this.alerts.length > this.capacity) this.alerts.shift();
    } catch {
      // Corrupt persisted state is non-fatal; start with an empty ledger.
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const store: PersistedStore = { alerts: this.alerts };
      this.storage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // Storage may be unavailable (private mode, quota); detector keeps
      // working in-memory.
    }
  }
}

// ── Pure helpers ────────────────────────────────────────────────────

export function recommendationFor(score: number): FatigueRecommendation {
  if (score > THRESHOLD_ESCALATE_ONLY) return 'escalate-only';
  if (score > THRESHOLD_SUPPRESS_LOW) return 'suppress-low';
  if (score > THRESHOLD_BATCH) return 'batch';
  return 'none';
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function clampSeverity(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function topDomainOf(alerts: readonly AlertRecord[]): string {
  if (alerts.length === 0) return '';
  const counts = new Map<string, number>();
  for (const a of alerts) counts.set(a.domain, (counts.get(a.domain) ?? 0) + 1);
  let top = '';
  let topCount = -1;
  for (const [domain, count] of counts) {
    // Stable tiebreaker: keep the first-seen domain (insertion order in Map
    // matches first observation order in the alerts array).
    if (count > topCount) {
      top = domain;
      topCount = count;
    }
  }
  return top;
}

function isValidPersistedAlert(a: unknown): a is AlertRecord {
  if (!a || typeof a !== 'object') return false;
  const r = a as Record<string, unknown>;
  return (
    typeof r.id === 'string'
    && typeof r.domain === 'string'
    && typeof r.severity === 'number'
    && typeof r.timestamp === 'number'
    && typeof r.acknowledged === 'boolean'
  );
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}
