/**
 * Assumption tracker — annotate every model output (score, situation,
 * alert, correlation) with the assumptions it rests on.
 *
 * 7 built-in detectors run inside `annotate()`:
 *   1. missing location           geospatial    critical for geographic domains
 *   2. stale feed data            data-quality  confidence decays with age
 *   3. single-source situation    completeness  fewer than 2 distinct sourceIds
 *   4. temporal-only correlation  causality     temporally-adjacent edge w/o shared location
 *   5. low-confidence edge        model         any edge with confidence < 0.4
 *   6. missing key field          baseline      domain-specific (mag for earthquake, …)
 *   7. no historical baseline     baseline      single-event situation in unfamiliar region
 *
 * Pure deterministic; no DOM, no fetch.
 */

import type { ObservationEvent } from './observation-adapters';
import type { EvidenceEdge, Situation } from './situation-store-v2';

// ── Public types ──────────────────────────────────────────────────────

export type AssumptionCategory =
  | 'data-quality'
  | 'completeness'
  | 'causality'
  | 'baseline'
  | 'model'
  | 'geospatial';

export type ViolationRisk = 'low' | 'medium' | 'high';
export type OutputType = 'score' | 'situation' | 'alert' | 'correlation';

export interface Assumption {
  id: string;
  category: AssumptionCategory;
  statement: string;
  confidence: number;
  isCritical: boolean;
  violationRisk: ViolationRisk;
  affectedOutputIds: string[];
  detectedAt: Date;
}

export interface AnnotatedOutput {
  outputId: string;
  outputType: OutputType;
  assumptions: Assumption[];
  criticalAssumptionCount: number;
  overallConfidence: number;
  caveat: string;
  generatedAt: Date;
}

export interface AssumptionContext {
  observations?: readonly ObservationEvent[];
  situation?: Situation;
  driverScores?: readonly { driverId: string; rawValue: number | null }[];
}

export interface AssumptionStats {
  totalAssumptions: number;
  totalOutputs: number;
  byCategory: Record<AssumptionCategory, number>;
  criticalCount: number;
  highRiskCount: number;
  avgConfidence: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AssumptionTrackerOptions {
  capacity?: number;
  storage?: StorageLike | null;
  now?: () => number;
}

const DEFAULT_CAPACITY = 500;
export const STORAGE_KEY = 'wm-assumption-annotations';

// Domain refresh budgets in ms — drives the "is this observation stale?"
// detector. Defaults reflect Crystal Ball's own polling cadences.
const DOMAIN_REFRESH_BUDGETS_MS: Record<string, number> = {
  earthquake: 5 * 60_000,
  weather: 5 * 60_000,
  wildfire: 30 * 60_000,
  maritime: 10 * 60_000,
  aviation: 60_000,
  biosurveillance: 24 * 60 * 60_000,
  'space-weather': 5 * 60_000,
  cyber: 60 * 60_000,
  sanctions: 24 * 60 * 60_000,
  intelligence: 30 * 60_000,
};
const DEFAULT_REFRESH_BUDGET_MS = 15 * 60_000;

// Domains where missing coordinates makes the output essentially
// unactionable.
const GEOGRAPHIC_DOMAINS = new Set(['earthquake', 'weather', 'wildfire', 'maritime', 'aviation']);

// Per-domain key field that ought to be present in raw payloads. Each
// entry is one logical field; the `paths` array enumerates the
// alternative shapes we'll accept (different adapters land the same
// number under different keys). Used by the missing-key-field detector.
interface KeyField {
  /** Alternative paths through the raw payload — at least one must
   *  resolve to a finite number for the field to count as present. */
  paths: readonly (readonly string[])[];
  /** Human-readable name for the caveat. */
  label: string;
}
const DOMAIN_KEY_FIELDS: Record<string, KeyField[]> = {
  earthquake: [{ paths: [['properties', 'mag'], ['magnitude']], label: 'magnitude' }],
  weather: [{ paths: [['category'], ['stormCategory']], label: 'storm category' }],
  wildfire: [{ paths: [['acres'], ['acresBurned']], label: 'acres burned' }],
  cyber: [{ paths: [['cvss'], ['cvssScore']], label: 'CVSS score' }],
  'space-weather': [{ paths: [['kp'], ['kpIndex']], label: 'Kp index' }],
};

const LOW_CONFIDENCE_EDGE_THRESHOLD = 0.4;

// ── Engine ──────────────────────────────────────────────────────────

interface SerializedOutput extends Omit<AnnotatedOutput, 'generatedAt' | 'assumptions'> {
  generatedAt: number;
  assumptions: (Omit<Assumption, 'detectedAt'> & { detectedAt: number })[];
}

export class AssumptionTracker {
  private readonly capacity: number;
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly subscribers = new Set<(o: AnnotatedOutput) => void>();
  private readonly byId = new Map<string, AnnotatedOutput>();
  /** Insertion-order array used for ring-buffer eviction. */
  private readonly order: string[] = [];

  constructor(opts: AssumptionTrackerOptions = {}) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.clock = opts.now ?? Date.now;
    this.hydrate();
  }

  annotate(outputId: string, outputType: OutputType, context: AssumptionContext): AnnotatedOutput {
    const detectedAt = new Date(this.clock());
    const assumptions: Assumption[] = [];
    const observations = context.observations ?? context.situation?.observations ?? [];
    const edges = context.situation?.edges ?? [];

    detectMissingLocation(observations, outputId, detectedAt, assumptions);
    detectStaleFeed(observations, this.clock(), outputId, detectedAt, assumptions);
    detectMissingKeyField(observations, outputId, detectedAt, assumptions);
    if (context.situation) {
      detectSingleSource(context.situation, outputId, detectedAt, assumptions);
      detectNoHistoricalBaseline(context.situation, outputId, detectedAt, assumptions);
    }
    detectEdgeAssumptions(edges, observations, outputId, detectedAt, assumptions);

    const criticalAssumptionCount = assumptions.filter((a) => a.isCritical).length;
    const overallConfidence = computeOverallConfidence(assumptions);
    const annotation: AnnotatedOutput = {
      outputId,
      outputType,
      assumptions,
      criticalAssumptionCount,
      overallConfidence,
      caveat: buildCaveat(assumptions, outputType),
      generatedAt: detectedAt,
    };

    this.commit(annotation);
    return annotation;
  }

  getAnnotation(outputId: string): AnnotatedOutput | undefined {
    return this.byId.get(outputId);
  }

  getByCategory(category: AssumptionCategory): Assumption[] {
    const out: Assumption[] = [];
    for (const ann of this.byId.values()) {
      for (const a of ann.assumptions) if (a.category === category) out.push(a);
    }
    return out;
  }

  getCritical(): Assumption[] {
    const out: Assumption[] = [];
    for (const ann of this.byId.values()) {
      for (const a of ann.assumptions) if (a.isCritical) out.push(a);
    }
    return out;
  }

  getHighRisk(): Assumption[] {
    const out: Assumption[] = [];
    for (const ann of this.byId.values()) {
      for (const a of ann.assumptions) if (a.violationRisk === 'high') out.push(a);
    }
    return out;
  }

  stats(): AssumptionStats {
    const byCategory: Record<AssumptionCategory, number> = {
      'data-quality': 0,
      completeness: 0,
      causality: 0,
      baseline: 0,
      model: 0,
      geospatial: 0,
    };
    let total = 0;
    let critical = 0;
    let highRisk = 0;
    let confidenceSum = 0;
    for (const ann of this.byId.values()) {
      for (const a of ann.assumptions) {
        total++;
        byCategory[a.category]++;
        if (a.isCritical) critical++;
        if (a.violationRisk === 'high') highRisk++;
        confidenceSum += a.confidence;
      }
    }
    return {
      totalAssumptions: total,
      totalOutputs: this.order.length,
      byCategory,
      criticalCount: critical,
      highRiskCount: highRisk,
      avgConfidence: total > 0 ? Number((confidenceSum / total).toFixed(4)) : 1,
    };
  }

  subscribe(cb: (o: AnnotatedOutput) => void): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  clear(): void {
    this.byId.clear();
    this.order.length = 0;
    this.persist();
  }

  // ── Internals ──────────────────────────────────────────────────────

  private commit(annotation: AnnotatedOutput): void {
    const existed = this.byId.has(annotation.outputId);
    this.byId.set(annotation.outputId, annotation);
    if (!existed) this.order.push(annotation.outputId);
    while (this.order.length > this.capacity) {
      const evictId = this.order.shift();
      if (evictId !== undefined) this.byId.delete(evictId);
    }
    this.persist();
    for (const cb of this.subscribers) cb(annotation);
  }

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SerializedOutput[];
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        const annotation: AnnotatedOutput = {
          ...item,
          generatedAt: new Date(item.generatedAt),
          assumptions: item.assumptions.map((a) => ({ ...a, detectedAt: new Date(a.detectedAt) })),
        };
        this.byId.set(annotation.outputId, annotation);
        this.order.push(annotation.outputId);
        while (this.order.length > this.capacity) {
          const evictId = this.order.shift();
          if (evictId !== undefined) this.byId.delete(evictId);
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
      const serial: SerializedOutput[] = [];
      for (const id of this.order) {
        const ann = this.byId.get(id);
        if (!ann) continue;
        serial.push({
          ...ann,
          generatedAt: ann.generatedAt.getTime(),
          assumptions: ann.assumptions.map((a) => ({ ...a, detectedAt: a.detectedAt.getTime() })),
        });
      }
      this.storage.setItem(STORAGE_KEY, JSON.stringify(serial));
    } catch {
      // Storage failures are non-fatal.
    }
  }
}

// ── Lazy singleton ──────────────────────────────────────────────────

let singleton: AssumptionTracker | undefined;

export function getAssumptionTracker(): AssumptionTracker {
  singleton ??= new AssumptionTracker();
  return singleton;
}

export function resetForTests(): void {
  singleton = undefined;
}

// ── Detectors ───────────────────────────────────────────────────────

function detectMissingLocation(
  observations: readonly ObservationEvent[],
  outputId: string,
  detectedAt: Date,
  out: Assumption[],
): void {
  for (const obs of observations) {
    if (obs.location) continue;
    const isCritical = GEOGRAPHIC_DOMAINS.has(obs.domain);
    out.push({
      id: `assume-geo-${outputId}-${obs.id}`,
      category: 'geospatial',
      statement: `Observation ${obs.id} has no coordinates — assumed not geographically actionable for ${obs.domain}.`,
      confidence: 0.5,
      isCritical,
      violationRisk: isCritical ? 'medium' : 'low',
      affectedOutputIds: [outputId],
      detectedAt,
    });
  }
}

function detectStaleFeed(
  observations: readonly ObservationEvent[],
  now: number,
  outputId: string,
  detectedAt: Date,
  out: Assumption[],
): void {
  for (const obs of observations) {
    const budget = DOMAIN_REFRESH_BUDGETS_MS[obs.domain] ?? DEFAULT_REFRESH_BUDGET_MS;
    const ageMs = Math.max(0, now - obs.timestamp);
    if (ageMs <= budget * 2) continue;
    // Confidence decays linearly from 1.0 at 2× budget to 0.2 at 10× budget.
    const ratio = Math.min(1, (ageMs - budget * 2) / (budget * 8));
    const confidence = Math.max(0.2, Number((1 - 0.8 * ratio).toFixed(3)));
    out.push({
      id: `assume-stale-${outputId}-${obs.id}`,
      category: 'data-quality',
      statement: `Observation ${obs.id} is ${Math.round(ageMs / 60_000)} min old (${obs.domain} refresh budget ${Math.round(budget / 60_000)} min) — assumed still valid.`,
      confidence,
      isCritical: false,
      violationRisk: ageMs > budget * 6 ? 'high' : 'medium',
      affectedOutputIds: [outputId],
      detectedAt,
    });
  }
}

function detectSingleSource(
  situation: Situation,
  outputId: string,
  detectedAt: Date,
  out: Assumption[],
): void {
  const sources = new Set(situation.observations.map((o) => o.sourceId));
  if (sources.size >= 2) return;
  out.push({
    id: `assume-single-source-${outputId}`,
    category: 'completeness',
    statement: `Situation "${situation.name}" backed by only ${sources.size} feed${sources.size === 1 ? '' : 's'} — assumed no contradicting signal exists.`,
    confidence: 0.6,
    isCritical: true,
    violationRisk: 'medium',
    affectedOutputIds: [outputId],
    detectedAt,
  });
}

function detectMissingKeyField(
  observations: readonly ObservationEvent[],
  outputId: string,
  detectedAt: Date,
  out: Assumption[],
): void {
  for (const obs of observations) {
    const fields = DOMAIN_KEY_FIELDS[obs.domain];
    if (!fields) continue;
    for (const field of fields) {
      const present = field.paths.some((p) => hasNumericPath(obs.raw, p));
      if (present) continue;
      out.push({
        id: `assume-missing-${outputId}-${obs.id}-${field.label.replace(/\s+/g, '-')}`,
        category: 'baseline',
        statement: `Observation ${obs.id} missing ${field.label} — assumed median value for ${obs.domain} domain.`,
        confidence: 0.55,
        isCritical: false,
        violationRisk: 'medium',
        affectedOutputIds: [outputId],
        detectedAt,
      });
    }
  }
}

function detectNoHistoricalBaseline(
  situation: Situation,
  outputId: string,
  detectedAt: Date,
  out: Assumption[],
): void {
  // Use the situation's own first-event marker as a proxy for "first
  // event of this type in this region". A situation with exactly one
  // observation, no related domains, and no entity ids is the cleanest
  // signal of "we've never seen this combo before".
  if (situation.observations.length !== 1) return;
  if (situation.relatedDomains.length > 0) return;
  if (situation.entityIds.length > 0) return;
  out.push({
    id: `assume-no-baseline-${outputId}`,
    category: 'baseline',
    statement: `Situation "${situation.name}" has no historical baseline in this region — assumed comparable to past similar events.`,
    confidence: 0.4,
    isCritical: false,
    violationRisk: 'high',
    affectedOutputIds: [outputId],
    detectedAt,
  });
}

function detectEdgeAssumptions(
  edges: readonly EvidenceEdge[],
  observations: readonly ObservationEvent[],
  outputId: string,
  detectedAt: Date,
  out: Assumption[],
): void {
  const obsById = new Map<string, ObservationEvent>();
  for (const o of observations) obsById.set(o.id, o);
  for (const edge of edges) {
    if (edge.confidence < LOW_CONFIDENCE_EDGE_THRESHOLD) {
      out.push({
        id: `assume-low-edge-${outputId}-${edge.sourceEventId}-${edge.targetEventId}`,
        category: 'model',
        statement: `Edge ${edge.sourceEventId} → ${edge.targetEventId} has confidence ${edge.confidence.toFixed(2)} — assumed correlation rule still holds.`,
        confidence: edge.confidence,
        isCritical: false,
        violationRisk: 'high',
        affectedOutputIds: [outputId],
        detectedAt,
      });
    }
    if (edge.type === 'temporally-adjacent' && !sharedLocation(obsById.get(edge.sourceEventId), obsById.get(edge.targetEventId))) {
      out.push({
        id: `assume-temporal-${outputId}-${edge.sourceEventId}-${edge.targetEventId}`,
        category: 'causality',
        statement: `Edge ${edge.sourceEventId} → ${edge.targetEventId} matched on time only (no shared location) — assumed events are causally linked.`,
        confidence: 0.5,
        isCritical: false,
        violationRisk: 'medium',
        affectedOutputIds: [outputId],
        detectedAt,
      });
    }
  }
}

function sharedLocation(a: ObservationEvent | undefined, b: ObservationEvent | undefined): boolean {
  return Boolean(a?.location && b?.location);
}

function hasNumericPath(raw: unknown, path: readonly string[]): boolean {
  let cursor: unknown = raw;
  for (const key of path) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return false;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === 'number' && Number.isFinite(cursor);
}

// ── Confidence + caveat ────────────────────────────────────────────

function computeOverallConfidence(assumptions: readonly Assumption[]): number {
  const critical = assumptions.filter((a) => a.isCritical);
  if (critical.length === 0) return 1;
  let min = 1;
  for (const a of critical) if (a.confidence < min) min = a.confidence;
  return Number(min.toFixed(4));
}

function buildCaveat(assumptions: readonly Assumption[], outputType: OutputType): string {
  if (assumptions.length === 0) {
    return `This ${outputType} rests on no flagged assumptions — all required fields present, feeds fresh.`;
  }
  const critical = assumptions.filter((a) => a.isCritical);
  const showing = critical.length > 0 ? critical : assumptions;
  const noun = critical.length > 0 ? 'critical assumption' : 'assumption';
  const head = `This ${outputType} rests on ${showing.length} ${noun}${pluralS(showing.length)}:`;
  const lines = showing.slice(0, 5).map((a) => `- ${a.statement}`);
  return [head, ...lines].join('\n');
}

function pluralS(n: number): string {
  return n === 1 ? '' : 's';
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}
