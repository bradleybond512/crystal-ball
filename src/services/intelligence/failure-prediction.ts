/**
 * Failure prediction engine — score each ObservationEvent for the
 * probability that it will escalate within a 1h / 6h / 24h horizon.
 *
 * Factors that increase probability:
 *   - high base severity
 *   - rapid recency (< 30min old)
 *   - cross-domain correlation already exists for this observation
 *   - high-volatility domain (earthquake / typhoon / biosurveillance)
 *   - multi-source overlap (another observation in the same batch
 *     shares an entityId — second-source confirmation)
 *   - "unprecedented" tag (no historical baseline)
 *
 * Five domain-specific escalation templates inject a domain-shaped
 * factor describing the expected mode of escalation.
 *
 * Pure deterministic; no DOM, no fetch.
 */

import type { ObservationEvent } from './observation-adapters';

// ── Public types ─────────────────────────────────────────────────────

export type EscalationHorizon = '1h' | '6h' | '24h';

export interface EscalationRisk {
  observationId: string;
  domain: string;
  currentSeverity: string;
  predictedSeverity: string;
  probability: number;
  horizon: EscalationHorizon;
  factors: string[];
  predictedAt: number;
}

/** Injectable lookup against CorrelationStore (or any equivalent).
 *  Production wires the live singleton; tests pass a stub. */
export interface CorrelationLookup {
  hasCorrelation(observationId: string): boolean;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface FailurePredictionEngineOptions {
  capacity?: number;
  storage?: StorageLike | null;
  correlations?: CorrelationLookup;
  now?: () => number;
}

const DEFAULT_CAPACITY = 500;
export const STORAGE_KEY = 'wm-failure-predictions';

// ── Scoring constants ────────────────────────────────────────────────

const SEVERITY_BASE: Record<string, number> = {
  CRITICAL: 0.45,
  HIGH: 0.3,
  MEDIUM: 0.15,
  LOW: 0.05,
  INFO: 0,
};

const SEVERITY_RANK: Record<string, number> = {
  INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4,
};

const SEVERITY_BY_RANK = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const HIGH_VOLATILITY_DOMAINS = new Set([
  'earthquake', 'typhoon', 'tsunami', 'biosurveillance', 'space-weather',
]);

const RECENT_WINDOW_MS = 30 * 60_000;

// Per-domain escalation template strings. Anything not in this map
// still gets a probability score — it just doesn't get a
// domain-shaped factor line.
const DOMAIN_ESCALATION_TEMPLATES: Record<string, string> = {
  earthquake:      'aftershock probability elevated within 24h',
  biosurveillance: 'R0 amplification possible in next 6h',
  weather:         'system intensification trend (pressure-fall)',
  maritime:        'conflict-escalation risk near chokepoint',
  aviation:        'airspace-closure cascade across hub network',
};

// ── Engine ──────────────────────────────────────────────────────────

// Persisted risk has the same shape as EscalationRisk — predictedAt
// is already a number, so no Date conversion is needed on round-trip.
type PersistedRisk = EscalationRisk;

export class FailurePredictionEngine {
  private readonly capacity: number;
  private readonly storage: StorageLike | null;
  private readonly correlations: CorrelationLookup;
  private readonly clock: () => number;
  private readonly byId = new Map<string, EscalationRisk>();
  private readonly order: string[] = [];
  private readonly subscribers = new Set<(batch: EscalationRisk[]) => void>();

  constructor(opts: FailurePredictionEngineOptions = {}) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.correlations = opts.correlations ?? { hasCorrelation: () => false };
    this.clock = opts.now ?? Date.now;
    this.hydrate();
  }

  predict(observations: readonly ObservationEvent[]): EscalationRisk[] {
    const predictedAt = this.clock();
    const multiSourceIds = collectMultiSourceIds(observations);
    const batch = observations.map((obs) =>
      this.scoreOne(obs, predictedAt, multiSourceIds),
    );
    for (const risk of batch) this.commit(risk);
    for (const cb of this.subscribers) cb(batch);
    return batch;
  }

  getAll(): EscalationRisk[] {
    return [...this.byId.values()];
  }

  getHighRisk(): EscalationRisk[] {
    return this.getAll().filter((r) => r.probability > 0.6);
  }

  subscribe(cb: (batch: EscalationRisk[]) => void): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  unsubscribe(cb: (batch: EscalationRisk[]) => void): void {
    this.subscribers.delete(cb);
  }

  clear(): void {
    this.byId.clear();
    this.order.length = 0;
    this.persist();
  }

  // ── Internals ─────────────────────────────────────────────────────

  private scoreOne(obs: ObservationEvent, predictedAt: number, multiSourceIds: ReadonlySet<string>): EscalationRisk {
    const factors: string[] = [];
    let probability = SEVERITY_BASE[obs.severity] ?? 0.1;
    factors.push(`base severity ${obs.severity}`);

    const ageMs = Math.max(0, predictedAt - obs.timestamp);
    if (ageMs <= RECENT_WINDOW_MS) {
      probability += 0.15;
      factors.push(`recent (${Math.round(ageMs / 60_000)} min old)`);
    }

    if (this.correlations.hasCorrelation(obs.id)) {
      probability += 0.15;
      factors.push('cross-domain correlation already detected');
    }

    if (HIGH_VOLATILITY_DOMAINS.has(obs.domain)) {
      // Stronger bonus than the other compounding factors: a fresh
      // earthquake or biosurv signal escalates fast even when the
      // current severity doesn't yet reflect that.
      probability += 0.2;
      factors.push(`high-volatility domain (${obs.domain})`);
    }

    if (multiSourceIds.has(obs.id)) {
      probability += 0.1;
      factors.push('multi-source confirmation (second source reporting)');
    }

    if (obs.tags.includes('unprecedented') || obs.tags.includes('no-baseline')) {
      probability += 0.1;
      factors.push('no historical baseline (unprecedented)');
    }

    const template = DOMAIN_ESCALATION_TEMPLATES[obs.domain];
    if (template) factors.push(template);

    probability = clamp01(probability);
    const horizon = horizonFor(obs.severity, ageMs);
    const predictedSeverity = projectSeverity(obs.severity, probability);

    return {
      observationId: obs.id,
      domain: obs.domain,
      currentSeverity: obs.severity,
      predictedSeverity,
      probability: Number(probability.toFixed(4)),
      horizon,
      factors,
      predictedAt,
    };
  }

  private commit(risk: EscalationRisk): void {
    const existed = this.byId.has(risk.observationId);
    this.byId.set(risk.observationId, risk);
    if (!existed) this.order.push(risk.observationId);
    while (this.order.length > this.capacity) {
      const evict = this.order.shift();
      if (evict !== undefined) this.byId.delete(evict);
    }
    this.persist();
  }

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedRisk[];
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        if (!this.byId.has(item.observationId)) this.order.push(item.observationId);
        this.byId.set(item.observationId, item);
        while (this.order.length > this.capacity) {
          const evict = this.order.shift();
          if (evict !== undefined) this.byId.delete(evict);
        }
      }
    } catch {
      this.byId.clear();
      this.order.length = 0;
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const serial: PersistedRisk[] = [];
      for (const id of this.order) {
        const item = this.byId.get(id);
        if (item) serial.push(item);
      }
      this.storage.setItem(STORAGE_KEY, JSON.stringify(serial));
    } catch {
      // Storage failures are non-fatal.
    }
  }
}

// ── Lazy singleton ──────────────────────────────────────────────────

let singleton: FailurePredictionEngine | undefined;

export function getFailurePredictionEngine(): FailurePredictionEngine {
  singleton ??= new FailurePredictionEngine();
  return singleton;
}

export function resetForTests(): void {
  singleton = undefined;
}

// ── Helpers ─────────────────────────────────────────────────────────

function collectMultiSourceIds(observations: readonly ObservationEvent[]): Set<string> {
  // An observation is "multi-source" if another observation in the same
  // batch shares any entityId AND came from a different sourceId.
  const out = new Set<string>();
  const byEntity = new Map<string, ObservationEvent[]>();
  for (const obs of observations) {
    for (const entityId of obs.entityIds) {
      const list = byEntity.get(entityId);
      if (list) list.push(obs);
      else byEntity.set(entityId, [obs]);
    }
  }
  for (const list of byEntity.values()) {
    if (list.length < 2) continue;
    const distinctSources = new Set(list.map((o) => o.sourceId));
    if (distinctSources.size < 2) continue;
    for (const o of list) out.add(o.id);
  }
  return out;
}

function horizonFor(severity: string, ageMs: number): EscalationHorizon {
  if (severity === 'CRITICAL' && ageMs <= RECENT_WINDOW_MS) return '1h';
  if (severity === 'HIGH') return '6h';
  return '24h';
}

function projectSeverity(current: string, probability: number): string {
  const rank = SEVERITY_RANK[current] ?? 0;
  let bumps = 0;
  if (probability > 0.8) bumps = 2;
  else if (probability > 0.6) bumps = 1;
  const projectedRank = Math.min(SEVERITY_BY_RANK.length - 1, rank + bumps);
  return SEVERITY_BY_RANK[projectedRank] ?? current;
}

function clamp01(n: number): number {
  if (Number.isNaN(n) || n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}
