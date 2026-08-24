/**
 * Situation Store v2 — named, evidence-backed Situations aggregated from
 * raw ObservationEvents through the CorrelateEngine.
 *
 * Inputs (Phase 3):
 *   - `ObservationEvent` (observation-adapters.ts) — normalized signals.
 *   - `CorrelateEngine.correlate()` (correlate-engine.ts) — produces
 *     `CorrelatedPair[]` with typed edges + confidences.
 *   - `EntityRegistry` (entity-registry.ts) — resolves observation
 *     `entityIds[]` into canonical Entity rows.
 *
 * Output: a stable, persistable set of `Situation` objects, each with:
 *   - One human-readable name + summary
 *   - Observations + typed EvidenceEdges (the evidence graph)
 *   - Resolved entity ids
 *   - Confidence + severity rolled up from the contributing facts
 *   - status: 'watching' (singleton observation) → 'active' (correlated)
 *     → 'resolved' (all observations >48h stale)
 *
 * Pure module — no DOM, no fetch, no globals at import time. Persists
 * the most-recent 200 situations to `localStorage` under
 * `wm-situation-store-v2`.
 */

import {
  CorrelateEngine,
  type CorrelatedPair,
  type CorrelationResult,
  type EdgeType,
} from './correlate-engine';
import { builtInCorrelationRules } from './built-in-correlation-rules';
import {
  recordCorrelationBatch,
  registerCorrelationRuntime,
  type CorrelationRuntimeMode,
} from '../correlation/correlation-liveness';
import { resolve as resolveEntity } from './entity-registry';
import type { ObservationEvent } from './observation-adapters';
import { getSourceTrust } from '../source-trust';
import type { AlertSource } from '../unified-alerts';

// ── Public types ──────────────────────────────────────────────────────

export type EvidenceEdgeType =
  | 'caused_by'
  | 'co-located'
  | 'temporally-adjacent'
  | 'contradicts'
  | 'confirms';

export interface EvidenceEdge {
  type: EvidenceEdgeType;
  sourceEventId: string;
  targetEventId: string;
  confidence: number;
  /** ID of the CorrelationRule that produced this edge, when applicable. */
  ruleId?: string;
}

export type SituationSeverity = 'low' | 'medium' | 'high' | 'critical';
export type SituationStatus = 'active' | 'watching' | 'resolved';

export interface SituationLocation {
  lat: number;
  lon: number;
  radiusKm: number;
}

export interface Situation {
  id: string;
  name: string;
  domain: string;
  relatedDomains: string[];
  severity: SituationSeverity;
  status: SituationStatus;
  summary: string;
  observations: ObservationEvent[];
  edges: EvidenceEdge[];
  entityIds: string[];
  /** 0..1 confidence the situation is real, weighted by edge strengths. */
  confidence: number;
  startedAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
  location?: SituationLocation;
  tags: string[];
}

export interface SituationFilter {
  status?: SituationStatus;
  domain?: string;
  minSeverity?: SituationSeverity;
  /** Only include situations updated at or after this epoch ms. */
  sinceMs?: number;
}

export interface SituationStats {
  total: number;
  active: number;
  watching: number;
  resolved: number;
  byDomain: Record<string, number>;
}

export type SituationListener = (situations: Situation[]) => void;

export interface SituationMutationSnapshot {
  id: string;
  name: string;
  domain: string;
  relatedDomains: string[];
  severity: SituationSeverity;
  status: SituationStatus;
  summary: string;
  entityIds: string[];
  confidence: number;
  startedAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
  location?: SituationLocation;
  tags: string[];
  observationCount: number;
  edgeCount: number;
}

export interface SituationMutationReceipt {
  kind: 'created' | 'updated' | 'resolved' | 'removed';
  situationId: string;
  situation: SituationMutationSnapshot;
  observationIds: string[];
}

export interface SituationIngestResult {
  status: 'changed' | 'unchanged';
  mutations: SituationMutationReceipt[];
}

export type SituationMutationListener = (result: SituationIngestResult) => void;
export type SituationViewScheduler = (callback: () => void) => (() => void) | void;

// ── Constants + helpers ───────────────────────────────────────────────

const STORAGE_KEY = 'wm-situation-store-v2';
const MAX_SITUATIONS = 200;
const STALE_AFTER_MS = 48 * 60 * 60 * 1000;
const MERGE_DISTANCE_KM = 500;
const MERGE_TIME_MS = 6 * 60 * 60 * 1000;
const PERSISTENCE_WINDOW_MS = 1000;
const VIEW_FANOUT_CAP_MS = 100;

const SEVERITY_RANK: Record<SituationSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const EDGE_TYPE_MAP: Record<EdgeType, EvidenceEdgeType> = {
  'causal-candidate': 'caused_by',
  'co-located': 'co-located',
  'temporally-adjacent': 'temporally-adjacent',
  contradicts: 'contradicts',
};

const EARTH_KM = 6371;
const DEG2RAD = Math.PI / 180;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return EARTH_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function safeStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

// ── Severity + confidence rollups ─────────────────────────────────────

/**
 * Map an observation adapter's `sourceId` onto the AlertSource trust
 * vocabulary so the severity rollup can weight by source reliability.
 * Unmapped sources fall through to getSourceTrust's own default (0.7).
 */
const OBSERVATION_SOURCE_TO_ALERT_SOURCE: Record<string, AlertSource> = {
  'usgs-earthquake': 'earthquake',
  'nws-alerts': 'nws',
  'aviation-track': 'aviation-hazard',
  'ais-disruption': 'maritime',
  'inciweb-wildfire': 'fire',
  'swpc-space-weather': 'space-weather',
};

/** Minimum source trust for a lone CRITICAL observation to escalate a Situation. */
const CRITICAL_TRUST_FLOOR = 0.7;

function trustForObservation(o: ObservationEvent): number {
  const mapped = OBSERVATION_SOURCE_TO_ALERT_SOURCE[o.sourceId];
  return mapped ? getSourceTrust(mapped) : 0.7;
}

function severityFromObservations(observations: readonly ObservationEvent[]): SituationSeverity {
  if (observations.length === 0) return 'low';
  let hasHigh = false;
  let hasMedium = false;
  const criticalObs: ObservationEvent[] = [];
  for (const o of observations) {
    if (o.severity === 'CRITICAL') criticalObs.push(o);
    else if (o.severity === 'HIGH') hasHigh = true;
    else if (o.severity === 'MEDIUM') hasMedium = true;
  }
  // Source-trust-weighted CRITICAL rollup. Escalate the whole Situation to
  // critical only when there is genuine corroboration or a trusted source:
  //   - ≥2 CRITICAL observations from DISTINCT sources (independent agreement), or
  //   - any CRITICAL observation from a high-trust source (trust ≥ floor).
  // Counting observations alone is not enough — a single noisy low-trust feed
  // can emit multiple CRITICALs, so we key independence on distinct sourceIds.
  const distinctCriticalSources = new Set(criticalObs.map((o) => o.sourceId));
  if (distinctCriticalSources.size >= 2) return 'critical';
  if (criticalObs.some((o) => trustForObservation(o) >= CRITICAL_TRUST_FLOOR)) {
    return 'critical';
  }
  // Remaining low-trust single-source CRITICALs (or any HIGH) fall through to 'high'.
  if (hasHigh || criticalObs.length >= 1) return 'high';
  if (hasMedium || observations.length >= 2) return 'medium';
  return 'low';
}

function statusFromContext(
  observations: readonly ObservationEvent[],
  edges: readonly EvidenceEdge[],
  now: number,
): SituationStatus {
  if (observations.length === 0) return 'resolved';
  const newest = observations.reduce((m, o) => Math.max(m, o.timestamp), 0);
  if (now - newest > STALE_AFTER_MS) return 'resolved';
  if (edges.length > 0 || observations.length >= 2) return 'active';
  return 'watching';
}

function confidenceFromEdges(edges: readonly EvidenceEdge[], observationCount: number): number {
  if (edges.length === 0) {
    // Lone observation — anchor confidence on the existence of the signal.
    return observationCount > 0 ? 0.5 : 0;
  }
  // Weighted average of edge confidences, biased upward when many
  // independent edges agree. Capped at 0.99 — a Situation built from
  // correlations is never "proven", only "well-supported".
  const sum = edges.reduce((acc, e) => acc + e.confidence, 0);
  const avg = sum / edges.length;
  const breadthBonus = Math.min(0.2, edges.length * 0.03);
  return Math.min(0.99, Number((avg + breadthBonus).toFixed(4)));
}

// ── Name + summary generation ─────────────────────────────────────────

function regionLabel(location?: SituationLocation): string {
  if (!location) return 'unknown region';
  const lat = location.lat.toFixed(1);
  const lon = location.lon.toFixed(1);
  return `${lat}°, ${lon}°`;
}

function primaryDomain(observations: readonly ObservationEvent[]): string {
  if (observations.length === 0) return 'unknown';
  // Pick the most severe observation's domain; ties broken by newest.
  const ranked = [...observations].sort((a, b) => {
    const sevA = severityWeight(a.severity);
    const sevB = severityWeight(b.severity);
    if (sevB !== sevA) return sevB - sevA;
    return b.timestamp - a.timestamp;
  });
  return ranked[0]!.domain;
}

function severityWeight(severity: ObservationEvent['severity']): number {
  switch (severity) {
    case 'CRITICAL': { return 4;
    }
    case 'HIGH': {     return 3;
    }
    case 'MEDIUM': {   return 2;
    }
    case 'LOW': {      return 1;
    }
    default: {         return 0;
    }
  }
}

function relatedDomainsFor(
  primary: string,
  observations: readonly ObservationEvent[],
): string[] {
  const all = dedupeStrings(observations.map((o) => o.domain));
  return all.filter((d) => d !== primary);
}

function generateName(observations: readonly ObservationEvent[], location?: SituationLocation): string {
  const primary = primaryDomain(observations);
  const related = relatedDomainsFor(primary, observations);
  const region = regionLabel(location);
  const suffix = related.length > 0 ? ` (${[primary, ...related].join('+')})` : '';
  return `${primary} event — ${region}${suffix}`;
}

function pluralS(count: number): string {
  return count === 1 ? '' : 's';
}

function generateSummary(observations: readonly ObservationEvent[], edges: readonly EvidenceEdge[]): string {
  if (observations.length === 0) return 'No observations.';
  const ranked = [...observations].sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity));
  const lead = ranked[0]!;
  const others = observations.length - 1;
  const tail = others === 0
    ? ''
    : ` + ${others} related observation${pluralS(others)}`;
  const evidenceFragment = edges.length === 0
    ? ''
    : ` linked by ${edges.length} evidence edge${pluralS(edges.length)}`;
  return `${lead.title}${tail}${evidenceFragment}.`;
}

// ── Location aggregation ──────────────────────────────────────────────

function locationFromObservations(
  observations: readonly ObservationEvent[],
): SituationLocation | undefined {
  const located = observations.filter((o): o is ObservationEvent & { location: NonNullable<ObservationEvent['location']> } => !!o.location);
  if (located.length === 0) return undefined;
  // Centroid + max-extent radius.
  const lat = located.reduce((acc, o) => acc + o.location.lat, 0) / located.length;
  const lon = located.reduce((acc, o) => acc + o.location.lon, 0) / located.length;
  const maxRadius = located.reduce((acc, o) => {
    const d = haversineKm(lat, lon, o.location.lat, o.location.lon) + (o.location.radiusKm ?? 0);
    return Math.max(acc, d);
  }, 0);
  return { lat, lon, radiusKm: Math.max(maxRadius, 1) };
}

// ── Tag + entity rollups ──────────────────────────────────────────────

function aggregateTags(observations: readonly ObservationEvent[]): string[] {
  const tags = new Set<string>();
  for (const o of observations) {
    for (const t of o.tags) tags.add(t);
  }
  return [...tags];
}

function aggregateEntityIds(observations: readonly ObservationEvent[]): string[] {
  const ids = new Set<string>();
  for (const o of observations) {
    for (const id of o.entityIds) {
      const resolved = resolveEntity(id);
      ids.add(resolved?.id ?? id);
    }
  }
  return [...ids];
}

// ── Group correlated pairs + lone observations into draft Situations ──

interface DraftSituation {
  observations: ObservationEvent[];
  edges: EvidenceEdge[];
}

/**
 * Exported for the ACC-501 correlation benchmark, which pins the PROJECTED
 * evidence-edge type per emission rather than only the engine's raw `edgeType`.
 * Inverting a row of `EDGE_TYPE_MAP` — `'causal-candidate'` to `contradicts` —
 * produced real situation edges asserting the opposite relationship while every
 * number in the benchmark, digest included, stayed identical.
 */
export function pairToEdge(pair: CorrelatedPair): EvidenceEdge {
  return {
    type: EDGE_TYPE_MAP[pair.edgeType],
    sourceEventId: pair.eventA.id,
    targetEventId: pair.eventB.id,
    confidence: pair.confidence,
    ruleId: pair.ruleId,
  };
}

/**
 * Union-find over correlated pairs + lone observations. Two pairs are
 * connected when they share at least one observation. Lone observations
 * become singleton groups.
 */
function groupPairsByConnectivity(
  observations: readonly ObservationEvent[],
  pairs: readonly CorrelatedPair[],
): DraftSituation[] {
  const obsById = new Map<string, ObservationEvent>();
  for (const o of observations) obsById.set(o.id, o);

  const parent = new Map<string, string>();
  const ensure = (id: string): string => {
    if (!parent.has(id)) parent.set(id, id);
    return id;
  };
  const find = (id: string): string => {
    ensure(id);
    let cur = parent.get(id)!;
    while (cur !== parent.get(cur)) cur = parent.get(cur)!;
    parent.set(id, cur);
    return cur;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const o of observations) ensure(o.id);
  for (const p of pairs) {
    ensure(p.eventA.id);
    ensure(p.eventB.id);
    union(p.eventA.id, p.eventB.id);
  }

  const buckets = new Map<string, DraftSituation>();
  for (const o of observations) {
    const root = find(o.id);
    let bucket = buckets.get(root);
    if (!bucket) {
      bucket = { observations: [], edges: [] };
      buckets.set(root, bucket);
    }
    bucket.observations.push(o);
  }
  for (const p of pairs) {
    const root = find(p.eventA.id);
    const bucket = buckets.get(root);
    if (!bucket) continue;
    // Guard against missing observations on the bucket — both events
    // should already be there because we ensured + unioned above.
    if (!bucket.observations.some((o) => o.id === p.eventA.id) && obsById.has(p.eventA.id)) {
      bucket.observations.push(obsById.get(p.eventA.id)!);
    }
    if (!bucket.observations.some((o) => o.id === p.eventB.id) && obsById.has(p.eventB.id)) {
      bucket.observations.push(obsById.get(p.eventB.id)!);
    }
    bucket.edges.push(pairToEdge(p));
  }
  return [...buckets.values()];
}

function meetsSeverity(severity: SituationSeverity, minimum?: SituationSeverity): boolean {
  if (!minimum) return true;
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[minimum];
}

// ── Persistence ───────────────────────────────────────────────────────

interface PersistedSituation extends Omit<Situation, 'startedAt' | 'updatedAt' | 'resolvedAt'> {
  startedAt: number;
  updatedAt: number;
  resolvedAt?: number;
}

function serialize(situations: readonly Situation[]): PersistedSituation[] {
  return situations.map((s) => ({
    ...s,
    observations: [...s.observations],
    edges: [...s.edges],
    entityIds: [...s.entityIds],
    tags: [...s.tags],
    relatedDomains: [...s.relatedDomains],
    location: s.location ? { ...s.location } : undefined,
    startedAt: s.startedAt.getTime(),
    updatedAt: s.updatedAt.getTime(),
    resolvedAt: s.resolvedAt?.getTime(),
  }));
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function deserializeEntry(entry: unknown): Situation | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const e = entry as PersistedSituation;
  if (typeof e.id !== 'string' || typeof e.startedAt !== 'number') return undefined;
  const updatedRaw = typeof e.updatedAt === 'number' ? e.updatedAt : e.startedAt;
  const resolvedAt = typeof e.resolvedAt === 'number' ? new Date(e.resolvedAt) : undefined;
  return {
    id: e.id,
    name: e.name ?? '',
    domain: e.domain ?? 'unknown',
    relatedDomains: asArray<string>(e.relatedDomains),
    severity: (e.severity ?? 'low') as SituationSeverity,
    status: (e.status ?? 'watching') as SituationStatus,
    summary: e.summary ?? '',
    observations: asArray<ObservationEvent>(e.observations),
    edges: asArray<EvidenceEdge>(e.edges),
    entityIds: asArray<string>(e.entityIds),
    confidence: typeof e.confidence === 'number' ? e.confidence : 0,
    startedAt: new Date(e.startedAt),
    updatedAt: new Date(updatedRaw),
    resolvedAt,
    location: e.location ? { ...e.location } : undefined,
    tags: asArray<string>(e.tags),
  };
}

function deserialize(raw: unknown): Situation[] {
  if (!Array.isArray(raw)) return [];
  const out: Situation[] = [];
  for (const entry of raw) {
    const parsed = deserializeEntry(entry);
    if (parsed) out.push(parsed);
  }
  return out;
}

// ── Store ─────────────────────────────────────────────────────────────

export interface SituationRegimeProvider {
  /** Confidence factor for a domain pair; 1 = neutral, boost-only. */
  factorFor(domainA: string, domainB: string): number;
  /** Time-window multiplier for a rule's domains; 1 = neutral. */
  windowMultiplierFor(ruleDomains: readonly string[]): number;
}

export interface SituationStoreV2Options {
  engine?: CorrelateEngine;
  /** Override Date.now() — useful for deterministic tests. */
  clock?: () => number;
  /** Runtime diagnostics are opt-in except for the live singleton. */
  diagnosticsMode?: CorrelationRuntimeMode | 'disabled';
  persistenceScheduler?: (callback: () => void, delayMs: number) => (() => void) | void;
}

export class SituationStoreV2 {
  private situations: Situation[] = [];
  private observationIds = new Set<string>();
  private listeners = new Set<SituationListener>();
  private mutationListeners = new Set<SituationMutationListener>();
  private viewListeners = new Map<SituationListener, {
    scheduler: SituationViewScheduler;
    pending: boolean;
    cancel?: () => void;
  }>();
  private hydrated = false;
  private engine: CorrelateEngine;
  private clock: () => number;
  private idCounter = 0;
  private pairListener?: (pairs: readonly CorrelatedPair[]) => void;
  private readonly pairListeners = new Set<(pairs: readonly CorrelatedPair[]) => void>();
  private reliabilityProvider?: (ruleId: string) => number;
  private regimeProvider?: SituationRegimeProvider;
  private readonly persistenceScheduler: NonNullable<SituationStoreV2Options['persistenceScheduler']>;
  private cancelPersist?: () => void;
  private lifecycleCleanup?: () => void;

  constructor(options: SituationStoreV2Options = {}) {
    this.engine = options.engine ?? this.defaultEngine();
    this.clock = options.clock ?? (() => Date.now());
    this.persistenceScheduler = options.persistenceScheduler
      ?? ((callback, delayMs) => {
        const timer = setTimeout(callback, delayMs);
        return () => clearTimeout(timer);
      });
    if (options.diagnosticsMode && options.diagnosticsMode !== 'disabled') {
      registerCorrelationRuntime(this.engine, options.diagnosticsMode);
      this.installLifecycleFlush();
    }
  }

  private defaultEngine(): CorrelateEngine {
    // Late-bound providers so the calibration + regime loops can be
    // wired after construction (bootstrap order independence).
    const engine = new CorrelateEngine({
      reliabilityFor: (ruleId) => this.reliabilityProvider?.(ruleId) ?? 1,
      regimeFactorFor: (a, b) =>
        this.regimeProvider?.factorFor(a.domain, b.domain) ?? 1,
      windowMultiplierFor: (rule) =>
        this.regimeProvider?.windowMultiplierFor(rule.domains) ?? 1,
    });
    for (const rule of builtInCorrelationRules) engine.registerRule(rule);
    return engine;
  }

  /** Observe every CorrelatedPair batch the engine emits during ingest —
   *  the correlation calibration loop records them as predictions.
   *  Single-slot setter (undefined clears); for additional consumers use
   *  addPairListener. Listener errors are isolated. */
  setPairListener(listener?: (pairs: readonly CorrelatedPair[]) => void): void {
    this.pairListener = listener;
  }

  /** Multi-consumer pair observation (e.g. pair persistence). Returns an
   *  unsubscribe function. */
  addPairListener(listener: (pairs: readonly CorrelatedPair[]) => void): () => void {
    this.pairListeners.add(listener);
    return () => this.pairListeners.delete(listener);
  }

  /** Install the per-rule learned reliability multiplier consulted by the
   *  default engine's confidence model. Undefined → neutral. */
  setReliabilityProvider(provider?: (ruleId: string) => number): void {
    this.reliabilityProvider = provider;
  }

  /** Install the BOCPD regime-coupling provider (confidence factor per
   *  domain pair + window multiplier per rule). Undefined → neutral. */
  setRegimeProvider(provider?: SituationRegimeProvider): void {
    this.regimeProvider = provider;
  }

  /** The live engine — used by the learned-rule cadence to sync mined
   *  `learned:*` rules. Built-in rules are managed here, not by callers. */
  getEngine(): CorrelateEngine {
    return this.engine;
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
      this.situations = deserialize(JSON.parse(raw));
      this.rebuildObservationIndex();
    } catch {
      // Corrupt blob — start clean.
    }
  }

  // Coalesces a burst of mutations into one JSON.stringify write on the next
  // microtask (in-memory state stays synchronous); fixes the renderer-hang
  // stringify storm.
  private persistScheduled = false;
  private schedulePersist(): void {
    if (this.persistScheduled) return;
    this.persistScheduled = true;
    this.cancelPersist = this.persistenceScheduler(() => {
      this.persistScheduled = false;
      this.cancelPersist = undefined;
      this.persist();
    }, PERSISTENCE_WINDOW_MS) ?? undefined;
  }

  private persist(): void {
    const store = safeStorage();
    if (!store) return;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(serialize(this.situations)));
    } catch {
      // Quota or disabled — non-critical.
    }
  }

  flushPersistence(): void {
    if (!this.persistScheduled) return;
    this.cancelPersist?.();
    this.cancelPersist = undefined;
    this.persistScheduled = false;
    this.persist();
  }

  private installLifecycleFlush(): void {
    const target = globalThis as typeof globalThis & {
      addEventListener?: (type: string, listener: () => void) => void;
      removeEventListener?: (type: string, listener: () => void) => void;
      document?: { hidden?: boolean; addEventListener?: (type: string, listener: () => void) => void; removeEventListener?: (type: string, listener: () => void) => void };
    };
    const onPageHide = this.flushPersistence.bind(this);
    const onVisibility = (): void => {
      if (target.document?.hidden) this.flushPersistence();
    };
    target.addEventListener?.('pagehide', onPageHide);
    target.addEventListener?.('beforeunload', onPageHide);
    target.document?.addEventListener?.('visibilitychange', onVisibility);
    this.lifecycleCleanup = () => {
      target.removeEventListener?.('pagehide', onPageHide);
      target.removeEventListener?.('beforeunload', onPageHide);
      target.document?.removeEventListener?.('visibilitychange', onVisibility);
    };
  }

  private nextId(now: number): string {
    this.idCounter += 1;
    return `sit-v2-${now.toString(36)}-${this.idCounter}`;
  }

  private notify(result: SituationIngestResult): void {
    for (const listener of this.mutationListeners) {
      try { listener(result); } catch { /* listener crash isolation */ }
    }
    if (this.listeners.size > 0) {
      const snapshot = this.list();
      for (const listener of this.listeners) {
        try { listener(snapshot); } catch { /* listener crash isolation */ }
      }
    }
    for (const [listener, state] of this.viewListeners) {
      if (state.pending) continue;
      state.pending = true;
      state.cancel = state.scheduler(() => {
        state.pending = false;
        state.cancel = undefined;
        if (!this.viewListeners.has(listener)) return;
        try { listener(this.list()); } catch { /* listener crash isolation */ }
      }) ?? undefined;
    }
  }

  /** Ingest a batch of ObservationEvents. Runs CorrelateEngine to find
   *  evidence edges, then merges results into existing open situations
   *  or creates new ones. Auto-resolves stale situations. */
  ingest(observations: readonly ObservationEvent[]): SituationIngestResult {
    this.ensureHydrated();
    if (observations.length === 0) return this.resolveStaleOnly();
    const unique = [...new Map(observations.map((observation) => [observation.id, observation])).values()];
    const novel = unique.filter((observation) => !this.observationIds.has(observation.id));
    if (novel.length === 0) return unchangedResult();
    const replayTarget = this.findReplayTarget(unique);
    const correlatedAt = this.clock();
    const correlation = this.engine.correlate(novel, new Date(correlatedAt));
    recordCorrelationBatch(this.engine, novel.length, correlation.pairs, correlatedAt);
    this.publishPairs(correlation.pairs);
    const mutations = this.applyDrafts(novel, correlation.pairs, replayTarget);
    if (mutations.length === 0) return unchangedResult();
    const result = changedResult(mutations);
    this.schedulePersist();
    this.notify(result);
    return result;
  }

  publishIncrementalCorrelation(
    current: ObservationEvent,
    history: readonly ObservationEvent[],
  ): CorrelationResult {
    const correlatedAt = this.clock();
    const result = this.engine.correlateIncremental(
      current,
      history,
      new Date(correlatedAt),
    );
    recordCorrelationBatch(
      this.engine,
      result.observationsConsidered,
      result.pairs,
      correlatedAt,
    );
    this.publishPairs(result.pairs);
    return result;
  }

  private resolveStaleOnly(): SituationIngestResult {
    const resolved = this.autoResolveStale();
    if (resolved.length === 0) return unchangedResult();
    const result = changedResult(resolved.map((situation) => this.receipt('resolved', situation, [])));
    this.schedulePersist();
    this.notify(result);
    return result;
  }

  private findReplayTarget(observations: readonly ObservationEvent[]): Situation | undefined {
    const replayedIds = new Set(
      observations
        .filter((observation) => this.observationIds.has(observation.id))
        .map((observation) => observation.id),
    );
    const referenced = this.situations.filter((situation) =>
      situation.observations.some((existing) => replayedIds.has(existing.id)),
    );
    return referenced.length === 1 ? referenced[0] : undefined;
  }

  private publishPairs(pairs: readonly CorrelatedPair[]): void {
    if (pairs.length === 0) return;
    for (const listener of this.pairListeners) {
      try { listener(pairs); } catch { /* listener crash isolation */ }
    }
    if (this.pairListener) {
      try { this.pairListener(pairs); } catch { /* listener crash isolation */ }
    }
  }

  private applyDrafts(
    observations: readonly ObservationEvent[],
    pairs: readonly CorrelatedPair[],
    replayTarget?: Situation,
  ): SituationMutationReceipt[] {
    const mutations: SituationMutationReceipt[] = [];
    for (const draft of groupPairsByConnectivity(observations, pairs)) {
      const mutation = this.mergeOrCreate(draft, replayTarget);
      if (mutation) mutations.push(mutation);
    }
    for (const resolved of this.autoResolveStale()) {
      if (!mutations.some((mutation) => mutation.situationId === resolved.id)) {
        mutations.push(this.receipt('resolved', resolved, []));
      }
    }
    for (const removed of this.enforceCapacity()) {
      mutations.push(this.receipt('removed', removed, []));
    }
    return mutations;
  }

  private mergeOrCreate(
    draft: DraftSituation,
    replayTarget?: Situation,
  ): SituationMutationReceipt | undefined {
    const now = this.clock();
    const match = replayTarget && this.isReplayCompatible(replayTarget, draft)
      ? replayTarget
      : this.findMergeTarget(draft);
    if (match) {
      if (!this.mergeIntoExisting(match, draft, now)) return undefined;
      return this.receipt('updated', match, draft.observations.map((observation) => observation.id));
    }
    const situation = this.buildSituation(draft, now);
    this.situations.push(situation);
    for (const observation of situation.observations) this.observationIds.add(observation.id);
    return this.receipt('created', situation, draft.observations.map((observation) => observation.id));
  }

  private receipt(
    kind: SituationMutationReceipt['kind'],
    situation: Situation,
    observationIds: string[],
  ): SituationMutationReceipt {
    return {
      kind,
      situationId: situation.id,
      observationIds,
      situation: {
        id: situation.id,
        name: situation.name,
        domain: situation.domain,
        relatedDomains: [...situation.relatedDomains],
        severity: situation.severity,
        status: situation.status,
        summary: situation.summary,
        entityIds: [...situation.entityIds],
        confidence: situation.confidence,
        startedAt: new Date(situation.startedAt),
        updatedAt: new Date(situation.updatedAt),
        resolvedAt: situation.resolvedAt ? new Date(situation.resolvedAt) : undefined,
        location: situation.location ? { ...situation.location } : undefined,
        tags: [...situation.tags],
        observationCount: situation.observations.length,
        edgeCount: situation.edges.length,
      },
    };
  }

  private findMergeTarget(draft: DraftSituation): Situation | undefined {
    const draftIds = new Set(draft.observations.map((o) => o.id));
    for (const existing of this.situations) {
      if (existing.status === 'resolved') continue;
      // Shared observation → merge.
      if (existing.observations.some((o) => draftIds.has(o.id))) return existing;
      // Same place + time window → merge.
      if (existing.location && this.isWithinMergeWindow(existing, draft)) return existing;
    }
    return undefined;
  }

  private isReplayCompatible(existing: Situation, draft: DraftSituation): boolean {
    const existingDomains = new Set([existing.domain, ...existing.relatedDomains]);
    if (!draft.observations.some((observation) => existingDomains.has(observation.domain))) return false;
    const newest = draft.observations.reduce((latest, observation) =>
      Math.max(latest, observation.timestamp), 0);
    if (Math.abs(existing.updatedAt.getTime() - newest) > MERGE_TIME_MS) return false;
    const draftLocation = locationFromObservations(draft.observations);
    if (!existing.location && !draftLocation) return true;
    if (!existing.location || !draftLocation) return false;
    return haversineKm(
      existing.location.lat,
      existing.location.lon,
      draftLocation.lat,
      draftLocation.lon,
    ) <= MERGE_DISTANCE_KM;
  }

  private isWithinMergeWindow(existing: Situation, draft: DraftSituation): boolean {
    const draftLocation = locationFromObservations(draft.observations);
    if (!draftLocation || !existing.location) return false;
    const distance = haversineKm(
      existing.location.lat, existing.location.lon,
      draftLocation.lat, draftLocation.lon,
    );
    if (distance > MERGE_DISTANCE_KM) return false;
    const draftNewest = draft.observations.reduce((m, o) => Math.max(m, o.timestamp), 0);
    return Math.abs(existing.updatedAt.getTime() - draftNewest) <= MERGE_TIME_MS;
  }

  private buildSituation(draft: DraftSituation, now: number): Situation {
    const observations = [...draft.observations];
    const edges = [...draft.edges];
    const location = locationFromObservations(observations);
    const tags = aggregateTags(observations);
    const entityIds = aggregateEntityIds(observations);
    const domain = primaryDomain(observations);
    const relatedDomains = relatedDomainsFor(domain, observations);
    const severity = severityFromObservations(observations);
    const status = statusFromContext(observations, edges, now);
    const confidence = confidenceFromEdges(edges, observations.length);
    return {
      id: this.nextId(now),
      name: generateName(observations, location),
      domain,
      relatedDomains,
      severity,
      status,
      summary: generateSummary(observations, edges),
      observations,
      edges,
      entityIds,
      confidence,
      startedAt: new Date(observations.reduce((m, o) => Math.min(m, o.timestamp), now)),
      updatedAt: new Date(now),
      resolvedAt: status === 'resolved' ? new Date(now) : undefined,
      location,
      tags,
    };
  }

  private mergeIntoExisting(target: Situation, draft: DraftSituation, now: number): boolean {
    const seenObs = new Set(target.observations.map((o) => o.id));
    const newObs = draft.observations.filter((o) => !seenObs.has(o.id));
    const observations = [...target.observations, ...newObs];

    const seenEdge = new Set(target.edges.map((e) => edgeKey(e)));
    const newEdges = draft.edges.filter((e) => !seenEdge.has(edgeKey(e)));
    if (newObs.length === 0 && newEdges.length === 0) return false;
    const edges = [...target.edges, ...newEdges];

    const location = locationFromObservations(observations);
    const severity = severityFromObservations(observations);
    const status = statusFromContext(observations, edges, now);
    const confidence = confidenceFromEdges(edges, observations.length);
    const domain = primaryDomain(observations);

    Object.assign(target, {
      observations,
      edges,
      location,
      severity,
      status,
      confidence,
      domain,
      relatedDomains: relatedDomainsFor(domain, observations),
      summary: generateSummary(observations, edges),
      name: generateName(observations, location),
      tags: aggregateTags(observations),
      entityIds: aggregateEntityIds(observations),
      updatedAt: new Date(now),
      resolvedAt: status === 'resolved' ? (target.resolvedAt ?? new Date(now)) : undefined,
    } satisfies Partial<Situation>);
    for (const observation of newObs) this.observationIds.add(observation.id);
    return true;
  }

  private autoResolveStale(): Situation[] {
    const now = this.clock();
    const resolved: Situation[] = [];
    for (const s of this.situations) {
      if (s.status === 'resolved') continue;
      const newest = s.observations.reduce((m, o) => Math.max(m, o.timestamp), 0);
      if (newest === 0) continue;
      if (now - newest > STALE_AFTER_MS) {
        s.status = 'resolved';
        s.resolvedAt = new Date(now);
        s.updatedAt = new Date(now);
        resolved.push(s);
      }
    }
    return resolved;
  }

  private enforceCapacity(): Situation[] {
    if (this.situations.length <= MAX_SITUATIONS) return [];
    // Drop oldest (by updatedAt) resolved first; then oldest overall.
    this.situations.sort((a, b) => {
      if (a.status === 'resolved' && b.status !== 'resolved') return -1;
      if (b.status === 'resolved' && a.status !== 'resolved') return 1;
      return a.updatedAt.getTime() - b.updatedAt.getTime();
    });
    const removed = this.situations.splice(0, this.situations.length - MAX_SITUATIONS);
    this.rebuildObservationIndex();
    return removed;
  }

  private rebuildObservationIndex(): void {
    this.observationIds.clear();
    for (const situation of this.situations) {
      for (const observation of situation.observations) this.observationIds.add(observation.id);
    }
  }

  list(): Situation[] {
    this.ensureHydrated();
    // Return a defensive copy so callers can't mutate internal state.
    return this.situations.map((s) => cloneSituation(s));
  }

  getSituations(filter?: SituationFilter): Situation[] {
    this.ensureHydrated();
    return this.situations
      .filter((s) => this.matchesFilter(s, filter))
      .map((s) => cloneSituation(s));
  }

  private matchesFilter(s: Situation, filter?: SituationFilter): boolean {
    if (!filter) return true;
    if (filter.status && s.status !== filter.status) return false;
    if (filter.domain && s.domain !== filter.domain) return false;
    if (!meetsSeverity(s.severity, filter.minSeverity)) return false;
    if (filter.sinceMs !== undefined && s.updatedAt.getTime() < filter.sinceMs) return false;
    return true;
  }

  getSituation(id: string): Situation | undefined {
    this.ensureHydrated();
    const s = this.situations.find((x) => x.id === id);
    return s ? cloneSituation(s) : undefined;
  }

  getActive(): Situation[] {
    return this.getSituations({ status: 'active' });
  }

  subscribe(listener: SituationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeMutations(listener: SituationMutationListener): () => void {
    this.mutationListeners.add(listener);
    return () => this.mutationListeners.delete(listener);
  }

  subscribeView(
    listener: SituationListener,
    scheduler: SituationViewScheduler = defaultViewScheduler,
  ): () => void {
    const state = { scheduler, pending: false, cancel: undefined as (() => void) | undefined };
    this.viewListeners.set(listener, state);
    return () => {
      state.cancel?.();
      this.viewListeners.delete(listener);
    };
  }

  stats(): SituationStats {
    this.ensureHydrated();
    const byDomain: Record<string, number> = {};
    let active = 0;
    let watching = 0;
    let resolved = 0;
    for (const s of this.situations) {
      byDomain[s.domain] = (byDomain[s.domain] ?? 0) + 1;
      if (s.status === 'active') active += 1;
      else if (s.status === 'watching') watching += 1;
      else if (s.status === 'resolved') resolved += 1;
    }
    return { total: this.situations.length, active, watching, resolved, byDomain };
  }

  /** Test seam — empties the store and the persisted blob. */
  resetForTesting(): void {
    this.cancelPersist?.();
    this.cancelPersist = undefined;
    this.persistScheduled = false;
    this.situations = [];
    this.observationIds.clear();
    this.listeners.clear();
    this.mutationListeners.clear();
    for (const state of this.viewListeners.values()) state.cancel?.();
    this.viewListeners.clear();
    this.lifecycleCleanup?.();
    this.lifecycleCleanup = undefined;
    this.idCounter = 0;
    this.hydrated = true;
    const store = safeStorage();
    if (store) {
      try { store.removeItem(STORAGE_KEY); } catch { /* best effort */ }
    }
  }
}

function unchangedResult(): SituationIngestResult {
  return { status: 'unchanged', mutations: [] };
}

function changedResult(mutations: SituationMutationReceipt[]): SituationIngestResult {
  return { status: 'changed', mutations };
}

function defaultViewScheduler(callback: () => void): () => void {
  let done = false;
  const run = (): void => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    callback();
  };
  const timer = setTimeout(run, VIEW_FANOUT_CAP_MS);
  const requestFrame = (globalThis as { requestAnimationFrame?: (cb: () => void) => number }).requestAnimationFrame;
  const cancelFrame = (globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame;
  const frame = requestFrame?.(run);
  return () => {
    done = true;
    clearTimeout(timer);
    if (frame !== undefined) cancelFrame?.(frame);
  };
}

function edgeKey(edge: EvidenceEdge): string {
  const [a, b] = edge.sourceEventId < edge.targetEventId
    ? [edge.sourceEventId, edge.targetEventId]
    : [edge.targetEventId, edge.sourceEventId];
  return `${edge.type}|${a}|${b}|${edge.ruleId ?? ''}`;
}

function cloneSituation(s: Situation): Situation {
  return {
    ...s,
    observations: s.observations.map((o) => ({ ...o, entityIds: [...o.entityIds], tags: [...o.tags] })),
    edges: s.edges.map((e) => ({ ...e })),
    entityIds: [...s.entityIds],
    tags: [...s.tags],
    relatedDomains: [...s.relatedDomains],
    location: s.location ? { ...s.location } : undefined,
    startedAt: new Date(s.startedAt),
    updatedAt: new Date(s.updatedAt),
    resolvedAt: s.resolvedAt ? new Date(s.resolvedAt) : undefined,
  };
}

// ── Singleton ─────────────────────────────────────────────────────────

let _singleton: SituationStoreV2 | null = null;

export function getSituationStoreV2(): SituationStoreV2 {
  _singleton ??= new SituationStoreV2({ diagnosticsMode: 'live' });
  return _singleton;
}

/** Test seam — replaces the singleton with a fresh instance. */
export function __resetSituationStoreV2Singleton(): void {
  _singleton?.flushPersistence();
  _singleton = null;
}

// ── Exposed helpers for diagnostics + tests ──────────────────────────

export const __internals = {
  severityFromObservations,
  statusFromContext,
  generateName,
  generateSummary,
  groupPairsByConnectivity,
  locationFromObservations,
  haversineKm,
  STALE_AFTER_MS,
  MERGE_DISTANCE_KM,
  MERGE_TIME_MS,
  MAX_SITUATIONS,
  PERSISTENCE_WINDOW_MS,
  VIEW_FANOUT_CAP_MS,
};
