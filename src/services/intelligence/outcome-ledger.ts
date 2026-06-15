/**
 * Outcome Ledger — Phase 3 Learn-stage feedback loop.
 *
 * Records what the user actually did with each alert or situation
 * (dismissed, acted on, escalated, confirmed real, marked false positive,
 * de-escalated) and rolls those signals up into per-domain calibration.
 *
 * Downstream consumers (AttentionAllocator, scoring weights) use the
 * calibration to adjust how aggressively each domain is monitored.
 *
 * Pure module — no DOM, no fetch, no globals at import time. Persists the
 * most-recent 2000 outcomes to `localStorage` under `wm-outcome-ledger`.
 */

import { buildInputHash, getAlgoEvalLedger, type PredictionValue } from './algo-eval-ledger';

// ── Enum allowlists (fix: validate on deserialise, not just cast) ─────

const VALID_OUTCOME_ACTIONS: ReadonlySet<string> = new Set([
  'dismissed',
  'acted-on',
  'escalated',
  'de-escalated',
  'confirmed-real',
  'marked-false-positive',
]);

const VALID_PREDICTED_SEVERITIES: ReadonlySet<string> = new Set([
  'low', 'medium', 'high', 'critical',
]);

export type OutcomeAction =
  | 'dismissed'
  | 'acted-on'
  | 'escalated'
  | 'de-escalated'
  | 'confirmed-real'
  | 'marked-false-positive';

export type PredictedSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface OutcomeRecord {
  id: string;
  alertId?: string;
  situationId?: string;
  domain: string;
  predictedSeverity: PredictedSeverity;
  actualOutcome: OutcomeAction;
  /** Optional snapshot of driver contributions at alert time — used for
   *  per-driver calibration in a future PR. Currently passed through and
   *  surfaced in diagnostics but not yet aggregated. */
  driverScores?: Record<string, number>;
  recordedAt: Date;
  notes?: string;
}

export interface DomainCalibration {
  domain: string;
  totalOutcomes: number;
  falsePositiveRate: number;
  escalationRate: number;
  confirmedRate: number;
  /** Fraction of outcomes where the predicted severity was a reasonable
   *  match for what the user did (confirmed-real or acted-on). */
  severityAccuracy: number;
  /** Suggested delta around 1.0 attention multiplier. Positive = pay more
   *  attention to this domain, negative = pull back. Clamped to [-1, +1]. */
  suggestedWeightDelta: number;
}

export interface OutcomeStats {
  total: number;
  byAction: Record<OutcomeAction, number>;
  byDomain: Record<string, number>;
  overallFalsePositiveRate: number;
}

export type OutcomeListener = (records: OutcomeRecord[]) => void;

// ── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'wm-outcome-ledger';
const MAX_RECORDS = 2000;
const DEFAULT_RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Minimum sample size before a domain's calibration is allowed to move
 *  its attention multiplier away from the neutral 1.0. Below this the
 *  signal is too noisy to act on. */
export const MIN_CALIBRATION_SAMPLES = 5;

const FALSE_POSITIVE_ACTIONS: ReadonlySet<OutcomeAction> = new Set([
  'dismissed',
  'marked-false-positive',
]);

const MATCH_ACTIONS: ReadonlySet<OutcomeAction> = new Set([
  'confirmed-real',
  'acted-on',
]);

// ── Storage helper ────────────────────────────────────────────────────

function safeStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

// ── Serialization ─────────────────────────────────────────────────────

interface PersistedOutcome extends Omit<OutcomeRecord, 'recordedAt'> {
  recordedAt: number;
}

function serialize(records: readonly OutcomeRecord[]): PersistedOutcome[] {
  return records.map((r) => ({
    ...r,
    driverScores: r.driverScores ? { ...r.driverScores } : undefined,
    recordedAt: r.recordedAt.getTime(),
  }));
}

function deserializeEntry(entry: unknown): OutcomeRecord | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const e = entry as PersistedOutcome;
  if (typeof e.id !== 'string' || typeof e.recordedAt !== 'number') return undefined;
  if (typeof e.domain !== 'string') return undefined;
  if (typeof e.predictedSeverity !== 'string') return undefined;
  if (typeof e.actualOutcome !== 'string') return undefined;
  // Reject entries whose action or severity is not in the known-good set —
  // this blocks tampered blobs from injecting unrecognised strings that
  // would corrupt downstream calibration math.
  if (!VALID_OUTCOME_ACTIONS.has(e.actualOutcome)) return undefined;
  if (!VALID_PREDICTED_SEVERITIES.has(e.predictedSeverity)) return undefined;
  return {
    id: e.id,
    alertId: typeof e.alertId === 'string' ? e.alertId : undefined,
    situationId: typeof e.situationId === 'string' ? e.situationId : undefined,
    domain: e.domain,
    predictedSeverity: e.predictedSeverity as PredictedSeverity,
    actualOutcome: e.actualOutcome as OutcomeAction,
    driverScores: e.driverScores ? { ...e.driverScores } : undefined,
    recordedAt: new Date(e.recordedAt),
    notes: typeof e.notes === 'string' ? e.notes : undefined,
  };
}

function deserialize(raw: unknown): OutcomeRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: OutcomeRecord[] = [];
  for (const entry of raw) {
    const parsed = deserializeEntry(entry);
    if (parsed) out.push(parsed);
  }
  return out;
}

// ── Tamper-detection checksum ─────────────────────────────────────────
//
// Non-cryptographic DJB2 hash over the JSON-serialised data array.
// Deters casual localStorage edits — not a substitute for cryptographic
// integrity but raises the bar significantly for an opportunistic attacker.

function djb2(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i += 1) {
    // h = h * 33 ^ char  (classic DJB2 variant)
    h = (((h << 5) + h) ^ (str.codePointAt(i) ?? 0)) >>> 0;
  }
  return h;
}

/** Compute the checksum of a serialised data array. Exported via
 *  `__internals` so tests can verify the round-trip independently. */
function computeChecksum(data: PersistedOutcome[]): number {
  return djb2(JSON.stringify(data));
}

interface PersistedBlob {
  /** Format version. v1 = legacy bare array, v2 = this object. */
  v: 2;
  data: PersistedOutcome[];
  /** DJB2 hash of `JSON.stringify(data)`. */
  cs: number;
}

// ── Calibration math ──────────────────────────────────────────────────

function emptyByAction(): Record<OutcomeAction, number> {
  return {
    dismissed: 0,
    'acted-on': 0,
    escalated: 0,
    'de-escalated': 0,
    'confirmed-real': 0,
    'marked-false-positive': 0,
  };
}

function calibrationFor(domain: string, records: readonly OutcomeRecord[]): DomainCalibration {
  const total = records.length;
  if (total === 0) {
    return {
      domain,
      totalOutcomes: 0,
      falsePositiveRate: 0,
      escalationRate: 0,
      confirmedRate: 0,
      severityAccuracy: 0,
      suggestedWeightDelta: 0,
    };
  }
  let falsePositives = 0;
  let escalations = 0;
  let confirmed = 0;
  let matches = 0;
  for (const r of records) {
    if (FALSE_POSITIVE_ACTIONS.has(r.actualOutcome)) falsePositives += 1;
    if (r.actualOutcome === 'escalated') escalations += 1;
    if (r.actualOutcome === 'confirmed-real') confirmed += 1;
    if (MATCH_ACTIONS.has(r.actualOutcome)) matches += 1;
  }
  const falsePositiveRate = falsePositives / total;
  const escalationRate = escalations / total;
  const confirmedRate = confirmed / total;
  const severityAccuracy = matches / total;
  // Below the sample-size floor the calibration may exist (for display) but
  // it never recommends a weight change — too noisy to act on.
  const suggestedWeightDelta = total < MIN_CALIBRATION_SAMPLES
    ? 0
    : clamp(escalationRate - falsePositiveRate, -1, 1);
  return {
    domain,
    totalOutcomes: total,
    falsePositiveRate,
    escalationRate,
    confirmedRate,
    severityAccuracy,
    suggestedWeightDelta,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ── Ledger ────────────────────────────────────────────────────────────

export interface OutcomeLedgerOptions {
  /** Override Date.now() — useful for deterministic tests. */
  clock?: () => number;
}

export class OutcomeLedger {
  private records: OutcomeRecord[] = [];
  private listeners = new Set<OutcomeListener>();
  private hydrated = false;
  private idCounter = 0;
  private clock: () => number;
  private _tamperDetected = false;

  constructor(options: OutcomeLedgerOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
  }

  /** True when a checksum mismatch was detected during hydration.
   *  Resets to false after a successful persist. */
  wasTamperDetected(): boolean {
    return this._tamperDetected;
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
      if (Array.isArray(parsed)) {
        // v1 legacy bare-array format — accept without checksum.
        this.records = deserialize(parsed);
      } else if (parsed && typeof parsed === 'object' && (parsed as PersistedBlob).v === 2) {
        const blob = parsed as PersistedBlob;
        if (!Array.isArray(blob.data)) return;
        const expected = computeChecksum(blob.data);
        if (blob.cs !== expected) {
          // Tampered or corrupt — discard the blob rather than trust it.
          this._tamperDetected = true;
          return;
        }
        this.records = deserialize(blob.data);
      }
      // Unknown format — start clean (no warn needed; forward-compat case).
    } catch {
      // Corrupt blob — start clean rather than crash on hydrate.
    }
  }

  private persist(): void {
    const store = safeStorage();
    if (!store) return;
    try {
      const data = serialize(this.records);
      const blob: PersistedBlob = { v: 2, data, cs: computeChecksum(data) };
      store.setItem(STORAGE_KEY, JSON.stringify(blob));
      this._tamperDetected = false;
    } catch {
      // Quota or storage disabled — best-effort.
    }
  }

  private nextId(now: number): string {
    this.idCounter += 1;
    return `oc-${now.toString(36)}-${this.idCounter}`;
  }

  private notify(): void {
    const snapshot = this.list();
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  /**
   * Record an outcome. The caller can omit `id` (and `recordedAt` if it
   * wants the ledger's clock to stamp the record).
   */
  record(outcome: Omit<OutcomeRecord, 'id'>): OutcomeRecord {
    this.ensureHydrated();
    const now = this.clock();
    const stamped: OutcomeRecord = {
      ...outcome,
      driverScores: outcome.driverScores ? { ...outcome.driverScores } : undefined,
      id: this.nextId(now),
      recordedAt: outcome.recordedAt ?? new Date(now),
    };
    this.records.push(stamped);
    this.enforceCapacity();
    this.persist();
    this.notify();
    resolveDriverScorerPrediction(stamped);
    return cloneRecord(stamped);
  }

  private enforceCapacity(): void {
    if (this.records.length <= MAX_RECORDS) return;
    // Drop oldest first — outcomes are time-ordered by insertion.
    this.records.splice(0, this.records.length - MAX_RECORDS);
  }

  list(): OutcomeRecord[] {
    this.ensureHydrated();
    return this.records.map((r) => cloneRecord(r));
  }

  getByDomain(domain: string): OutcomeRecord[] {
    this.ensureHydrated();
    return this.records.filter((r) => r.domain === domain).map((r) => cloneRecord(r));
  }

  /** Outcomes recorded within the last `sinceMs` milliseconds. Defaults
   *  to a 7-day window. Passing 0 or a negative value returns the full
   *  ledger so callers can opt out of the time filter. */
  getRecent(sinceMs: number = DEFAULT_RECENT_WINDOW_MS): OutcomeRecord[] {
    this.ensureHydrated();
    if (sinceMs <= 0) return this.list();
    const cutoff = this.clock() - sinceMs;
    return this.records
      .filter((r) => r.recordedAt.getTime() >= cutoff)
      .map((r) => cloneRecord(r));
  }

  getCalibration(domain: string): DomainCalibration {
    this.ensureHydrated();
    const matching = this.records.filter((r) => r.domain === domain);
    return calibrationFor(domain, matching);
  }

  getAllCalibrations(): DomainCalibration[] {
    this.ensureHydrated();
    const byDomain = new Map<string, OutcomeRecord[]>();
    for (const r of this.records) {
      const list = byDomain.get(r.domain);
      if (list) list.push(r);
      else byDomain.set(r.domain, [r]);
    }
    const out: DomainCalibration[] = [];
    for (const [domain, recs] of byDomain) {
      out.push(calibrationFor(domain, recs));
    }
    return out.sort((a, b) => b.totalOutcomes - a.totalOutcomes);
  }

  /**
   * Per-domain attention multiplier centred on 1.0:
   *   high false-positive rate → multiplier < 1 (be less noisy)
   *   high escalation rate     → multiplier > 1 (pay more attention)
   *   fewer than MIN_CALIBRATION_SAMPLES outcomes → 1.0 (neutral)
   *
   * Clamped to [0, 2].
   */
  getWeightRecommendations(): Record<string, number> {
    const calibrations = this.getAllCalibrations();
    const out: Record<string, number> = {};
    for (const cal of calibrations) {
      out[cal.domain] = cal.totalOutcomes < MIN_CALIBRATION_SAMPLES
        ? 1
        : clamp(1 + cal.suggestedWeightDelta, 0, 2);
    }
    return out;
  }

  stats(): OutcomeStats {
    this.ensureHydrated();
    const byAction = emptyByAction();
    const byDomain: Record<string, number> = {};
    let falsePositives = 0;
    for (const r of this.records) {
      byAction[r.actualOutcome] += 1;
      byDomain[r.domain] = (byDomain[r.domain] ?? 0) + 1;
      if (FALSE_POSITIVE_ACTIONS.has(r.actualOutcome)) falsePositives += 1;
    }
    const total = this.records.length;
    return {
      total,
      byAction,
      byDomain,
      overallFalsePositiveRate: total === 0 ? 0 : falsePositives / total,
    };
  }

  subscribe(listener: OutcomeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Test seam — empties the ledger and the persisted blob. */
  resetForTesting(): void {
    this.records = [];
    this.listeners.clear();
    this.idCounter = 0;
    this.hydrated = true;
    const store = safeStorage();
    if (store) {
      try { store.removeItem(STORAGE_KEY); } catch { /* best effort */ }
    }
  }
}

/** Side-effect wiring from outcome → AlgoEvalLedger. Resolves the
 *  most-recent unresolved `driver-scorer` prediction for this alert so
 *  the algorithm-accuracy panel can compute MAE / accuracy / trend over
 *  user feedback. No-op when the record has no alertId (no join key) or
 *  no prediction is waiting on the join key. */
/** Maps an outcome action to the value the AlgoEvalLedger should store
 *  as the prediction's resolution. confirmed-real preserves the
 *  predicted severity (a match); dismissed / marked-false-positive
 *  collapse to the sentinel string; everything else preserves the
 *  predicted severity so escalated / de-escalated don't pollute
 *  accuracy as miscategorisations. */
function resolvedValueFor(record: OutcomeRecord): PredictionValue {
  if (FALSE_POSITIVE_ACTIONS.has(record.actualOutcome)) return 'false-positive';
  return record.predictedSeverity;
}

function resolveDriverScorerPrediction(record: OutcomeRecord): void {
  if (!record.alertId) return;
  const resolvedValue: PredictionValue = resolvedValueFor(record);
  try {
    getAlgoEvalLedger().resolveByInputHash(
      'driver-scorer',
      buildInputHash(record.domain, record.alertId),
      resolvedValue,
    );
  } catch {
    // Singleton hydrate or storage hiccup — never block the outcome record.
  }
}

function cloneRecord(r: OutcomeRecord): OutcomeRecord {
  return {
    ...r,
    driverScores: r.driverScores ? { ...r.driverScores } : undefined,
    recordedAt: new Date(r.recordedAt),
  };
}

// ── Singleton ─────────────────────────────────────────────────────────

let _singleton: OutcomeLedger | null = null;

export function getOutcomeLedger(): OutcomeLedger {
  _singleton ??= new OutcomeLedger();
  return _singleton;
}

/** Test seam — replaces the singleton with a fresh instance. */
export function __resetOutcomeLedgerSingleton(): void {
  _singleton = null;
}

export const __internals = {
  STORAGE_KEY,
  MAX_RECORDS,
  DEFAULT_RECENT_WINDOW_MS,
  calibrationFor,
  computeChecksum,
  VALID_OUTCOME_ACTIONS,
};
