/**
 * Notification Provenance — Phase 4 "why was this alert sent?".
 *
 * Stores the full causal chain for every notification Crystal Ball
 * delivers: the trigger ObservationEvent, the contributing correlation
 * ids, the driver-scorer breakdown, the final score, the threshold it
 * crossed, and whether quiet hours / trust-budget suppressed the
 * delivery. The panel layer turns the record into a human-readable
 * explanation when the user asks "why did this fire?".
 *
 * Pure module — no DOM, no fetch, no globals at import time. Persists
 * the most-recent 500 provenance records under
 * `wm-notification-provenance` (ring buffer, oldest evicted first).
 */

import type { ObservationEvent } from '@/services/intelligence/observation-adapters';

// ── Public types ──────────────────────────────────────────────────────

export interface ProvenanceDriverScore {
  driverId: string;
  /** Normalised [0, 1] score this driver contributed. */
  score: number;
  /** Short human-readable label, e.g. "earthquake magnitude". */
  label: string;
}

export interface ProvenanceRecord {
  notificationId: string;
  title: string;
  domain: string;
  sentAt: number;
  triggerObservation: ObservationEvent;
  correlationIds: string[];
  driverScores: ProvenanceDriverScore[];
  finalScore: number;
  thresholdUsed: number;
  suppressedByQuietHours: boolean;
  suppressedByTrustBudget: boolean;
  explanation: string;
}

export interface NotificationLike {
  /** Stable id. The provenance record is keyed by this. */
  notificationId: string;
  /** Short title shown in the notification surface — used for search +
   *  the panel header line. */
  title: string;
  /** Notification's primary domain. Mirrors the trigger observation's
   *  domain in practice but kept separate so panel-only synthetic
   *  notifications (e.g. compound-risk roll-ups) can carry their own
   *  domain label. */
  domain: string;
  sentAt?: number;
  /** Optional explicit override for the explanation paragraph; when
   *  omitted the service synthesises one from the trigger + scores. */
  explanation?: string;
  suppressedByQuietHours?: boolean;
  suppressedByTrustBudget?: boolean;
}

export type ProvenanceListener = (records: ProvenanceRecord[]) => void;

export interface NotificationProvenanceStats {
  total: number;
  /** Records that were neither suppressed by quiet hours nor by the
   *  trust budget — i.e. would have surfaced to the user. */
  delivered: number;
  /** Records where at least one suppression flag was set. */
  suppressed: number;
  /** Count of records per domain (every domain that appears at least
   *  once is present, including those with only suppressed entries). */
  byDomain: Record<string, number>;
}

// ── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'wm-notification-provenance';
const MAX_RECORDS = 500;

// ── Storage helper ────────────────────────────────────────────────────

function safeStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

// ── Explanation builder ──────────────────────────────────────────────

function pluralS(n: number): string {
  return n === 1 ? '' : 's';
}

function topDriversText(scores: readonly ProvenanceDriverScore[]): string {
  if (scores.length === 0) return 'no driver contributions';
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const top = sorted.slice(0, 2);
  return top.map((d) => `${d.label} ${d.score.toFixed(2)}`).join(' + ');
}

function suppressionFragment(
  byQuietHours: boolean,
  byTrustBudget: boolean,
): string {
  if (byQuietHours && byTrustBudget) {
    return ' (suppressed: quiet hours + trust budget)';
  }
  if (byQuietHours) return ' (suppressed by quiet hours)';
  if (byTrustBudget) return ' (suppressed by trust budget)';
  return '';
}

export function buildExplanation(args: {
  title: string;
  domain: string;
  triggerObservation: ObservationEvent;
  correlationIds: readonly string[];
  driverScores: readonly ProvenanceDriverScore[];
  finalScore: number;
  thresholdUsed: number;
  suppressedByQuietHours: boolean;
  suppressedByTrustBudget: boolean;
}): string {
  const { title, domain, triggerObservation, correlationIds, driverScores,
    finalScore, thresholdUsed, suppressedByQuietHours, suppressedByTrustBudget } = args;
  const trigger = triggerObservation.title || triggerObservation.id;
  const ellipsis = correlationIds.length > 3 ? ', …' : '';
  const corrFragment = correlationIds.length === 0
    ? 'no contributing correlations'
    : `${correlationIds.length} correlation${pluralS(correlationIds.length)} (${correlationIds.slice(0, 3).join(', ')}${ellipsis})`;
  const driverFragment = topDriversText(driverScores);
  const crossedFragment = `final score ${finalScore.toFixed(2)} ≥ threshold ${thresholdUsed.toFixed(2)}`;
  const suppression = suppressionFragment(suppressedByQuietHours, suppressedByTrustBudget);
  return `"${title}" fired on the ${domain} domain. Trigger: "${trigger}" (${triggerObservation.severity}). Driver mix: ${driverFragment}. Linked via ${corrFragment}. ${crossedFragment}${suppression}.`;
}

// ── Search helpers ───────────────────────────────────────────────────

function matchesQuery(record: ProvenanceRecord, query: string): boolean {
  const q = query.toLowerCase();
  return record.title.toLowerCase().includes(q)
    || record.domain.toLowerCase().includes(q)
    || record.explanation.toLowerCase().includes(q);
}

// ── Service ───────────────────────────────────────────────────────────

export interface NotificationProvenanceOptions {
  clock?: () => number;
}

export class NotificationProvenanceService {
  private records: ProvenanceRecord[] = [];
  private listeners = new Set<ProvenanceListener>();
  private hydrated = false;
  private clock: () => number;

  constructor(options: NotificationProvenanceOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
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
      const parsed: unknown = JSON.parse(raw);
      this.records = deserialize(parsed);
    } catch {
      // Corrupt blob — start clean.
    }
  }

  private persist(): void {
    const store = safeStorage();
    if (!store) return;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(this.records));
    } catch {
      // Quota or disabled — best-effort.
    }
  }

  private notify(): void {
    const snapshot = this.records.map((r) => cloneRecord(r));
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  /** Store the full causal chain for a notification. Replaces any
   *  existing record with the same notificationId so retries / re-fires
   *  don't accumulate duplicates. */
  record(
    notification: NotificationLike,
    triggerObservation: ObservationEvent,
    correlationIds: readonly string[],
    driverScores: readonly ProvenanceDriverScore[],
    finalScore: number,
    threshold: number,
  ): ProvenanceRecord {
    this.ensureHydrated();
    const sentAt = notification.sentAt ?? this.clock();
    const suppressedByQuietHours = notification.suppressedByQuietHours ?? false;
    const suppressedByTrustBudget = notification.suppressedByTrustBudget ?? false;
    const explanation = notification.explanation ?? buildExplanation({
      title: notification.title,
      domain: notification.domain,
      triggerObservation,
      correlationIds,
      driverScores,
      finalScore,
      thresholdUsed: threshold,
      suppressedByQuietHours,
      suppressedByTrustBudget,
    });
    const stored: ProvenanceRecord = {
      notificationId: notification.notificationId,
      title: notification.title,
      domain: notification.domain,
      sentAt,
      triggerObservation: cloneObservation(triggerObservation),
      correlationIds: [...correlationIds],
      driverScores: driverScores.map((d) => ({ ...d })),
      finalScore,
      thresholdUsed: threshold,
      suppressedByQuietHours,
      suppressedByTrustBudget,
      explanation,
    };
    // Replace-on-id semantics keep one provenance record per notification.
    const existing = this.records.findIndex((r) => r.notificationId === stored.notificationId);
    if (existing !== -1) this.records.splice(existing, 1);
    this.records.push(stored);
    this.enforceCapacity();
    this.persist();
    this.notify();
    return cloneRecord(stored);
  }

  private enforceCapacity(): void {
    if (this.records.length <= MAX_RECORDS) return;
    this.records.splice(0, this.records.length - MAX_RECORDS);
  }

  getRecord(notificationId: string): ProvenanceRecord | undefined {
    this.ensureHydrated();
    const found = this.records.find((r) => r.notificationId === notificationId);
    return found ? cloneRecord(found) : undefined;
  }

  /** Returns the `limit` most-recently-sent records (newest first). */
  getRecent(limit = 50): ProvenanceRecord[] {
    this.ensureHydrated();
    if (limit <= 0) return [];
    const start = Math.max(0, this.records.length - limit);
    // eslint-disable-next-line unicorn/no-array-reverse
    return this.records.slice(start).map((r) => cloneRecord(r)).reverse();
  }

  /** Every persisted record, newest-first. Defensive copies. */
  getAll(): ProvenanceRecord[] {
    this.ensureHydrated();
    // eslint-disable-next-line unicorn/no-array-reverse
    return this.records.map((r) => cloneRecord(r)).reverse();
  }

  /** Records for a single domain, newest-first. */
  getByDomain(domain: string): ProvenanceRecord[] {
    this.ensureHydrated();
    // eslint-disable-next-line unicorn/no-array-reverse
    return this.records.filter((r) => r.domain === domain).map((r) => cloneRecord(r)).reverse();
  }

  /** Aggregate counts for the panel header: total / delivered /
   *  suppressed (by quiet hours or trust budget) / per-domain breakdown. */
  getStats(): NotificationProvenanceStats {
    this.ensureHydrated();
    const byDomain: Record<string, number> = {};
    let delivered = 0;
    let suppressed = 0;
    for (const r of this.records) {
      byDomain[r.domain] = (byDomain[r.domain] ?? 0) + 1;
      if (r.suppressedByQuietHours || r.suppressedByTrustBudget) suppressed += 1;
      else delivered += 1;
    }
    return { total: this.records.length, delivered, suppressed, byDomain };
  }

  /** Case-insensitive substring search across title / domain / explanation. */
  search(query: string): ProvenanceRecord[] {
    this.ensureHydrated();
    const q = query.trim();
    if (q.length === 0) return [];
    return this.records.filter((r) => matchesQuery(r, q)).map((r) => cloneRecord(r));
  }

  /** Human-readable paragraph for one notification. Returns empty
   *  string when the notification isn't on file. */
  explain(notificationId: string): string {
    const record = this.getRecord(notificationId);
    return record?.explanation ?? '';
  }

  subscribe(listener: ProvenanceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Test seam — empties the store and the persisted blob. */
  resetForTesting(): void {
    this.records = [];
    this.listeners.clear();
    this.hydrated = true;
    const store = safeStorage();
    if (store) {
      try { store.removeItem(STORAGE_KEY); } catch { /* best effort */ }
    }
  }
}

// ── Persistence helpers ──────────────────────────────────────────────

function cloneObservation(obs: ObservationEvent): ObservationEvent {
  return {
    ...obs,
    location: obs.location ? { ...obs.location } : undefined,
    entityIds: [...obs.entityIds],
    tags: [...obs.tags],
  };
}

function cloneRecord(r: ProvenanceRecord): ProvenanceRecord {
  return {
    ...r,
    triggerObservation: cloneObservation(r.triggerObservation),
    correlationIds: [...r.correlationIds],
    driverScores: r.driverScores.map((d) => ({ ...d })),
  };
}

function asValidRecord(entry: unknown): ProvenanceRecord | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const e = entry as ProvenanceRecord;
  if (typeof e.notificationId !== 'string' || typeof e.title !== 'string') return undefined;
  if (typeof e.domain !== 'string' || typeof e.sentAt !== 'number') return undefined;
  if (typeof e.finalScore !== 'number' || typeof e.thresholdUsed !== 'number') return undefined;
  if (!e.triggerObservation || typeof e.triggerObservation !== 'object') return undefined;
  if (!Array.isArray(e.correlationIds) || !Array.isArray(e.driverScores)) return undefined;
  return cloneRecord(e);
}

function deserialize(raw: unknown): ProvenanceRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: ProvenanceRecord[] = [];
  for (const entry of raw) {
    const valid = asValidRecord(entry);
    if (valid) out.push(valid);
  }
  return out;
}

// ── Singleton ─────────────────────────────────────────────────────────

let _singleton: NotificationProvenanceService | null = null;

export function getNotificationProvenanceService(): NotificationProvenanceService {
  _singleton ??= new NotificationProvenanceService();
  return _singleton;
}

/** Test seam — replaces the singleton with a fresh instance. */
export function __resetNotificationProvenanceSingleton(): void {
  _singleton = null;
}

export const __internals = {
  STORAGE_KEY,
  MAX_RECORDS,
  buildExplanation,
  matchesQuery,
};
