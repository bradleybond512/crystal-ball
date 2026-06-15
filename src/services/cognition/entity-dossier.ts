/**
 * Entity Dossiers — temporal knowledge graph (Cognitive Enhancement PR 5).
 *
 * Persistent per-entity intelligence: activity timeline, co-occurrence graph
 * edges, decayed heat score, and trajectory detection.
 * Answers "what do we know about X, and is X heating up?"
 *
 * Design invariants (house plan):
 *   - Every score has an explanation; trajectory includes evidence (counts per
 *     window), not just the label.
 *   - Stale data reduces confidence (heat decays exponentially — it never
 *     silently disappears).
 *   - Contradictions surface; high heat and a "cooling" trajectory are both
 *     reported as-is.
 *   - Every output is testable with static fixtures (injectable clock/storage;
 *     no DOM, no fetch, no globals at import time).
 *
 * Persistence: localStorage mirror (crystalball-cognition-dossiers-v1) +
 * IDB reasoning_memory, following the loaded/writtenSinceLoad guard pattern
 * from action-memory.ts and operator-model.ts.
 *
 * Ghost Mode: ingestFromHypotheses no-ops; getDossier / getHotEntities reads
 * still work (same pattern as operator-model.ts).
 *
 * Caps:
 *   - 500 dossiers (evict coldest — lowest heat — when exceeded)
 *   - 100 events per entity timeline ring
 *   - Entity-graph caps handled inside entity-graph.ts (2 000 edges)
 */

import type { Hypothesis } from '@/services/analyst-loop';
import {
  extractEntitiesFromText,
  type EntityKind,
} from '@/services/hypothesis-entities';
import {
  recordCoOccurrence,
  neighborsOf,
  type EntityEdge,
} from './entity-graph';
import { isGhostMode } from '@/services/mode-manager';

// ── IDB lazy loader (same pattern as episodic-memory.ts) ─────────────────────

let _getMemory: (<T>(key: string) => Promise<T | null>) | null = null;
let _putMemory: (<T>(key: string, value: T) => Promise<void>) | null = null;

function lazyLoadIdb(): void {
  if (_getMemory !== null) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@/services/reasoning-memory') as {
      getMemory: <T>(key: string) => Promise<T | null>;
      putMemory: <T>(key: string, value: T) => Promise<void>;
    };
    _getMemory = mod.getMemory;
    _putMemory = mod.putMemory;
  } catch {
    _getMemory = () => Promise.resolve(null);
    _putMemory = () => Promise.resolve();
  }
}

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * A single event in an entity's activity timeline.
 * `refId` is the hypothesis/situation ID the event came from.
 */
export interface DossierEvent {
  ts: number;
  kind: string;       // hypothesis kind (e.g. 'cross-domain-cluster')
  refId: string;      // ID of the source hypothesis
  label: string;      // short human-readable label (hypothesis statement prefix)
  severity?: number;  // 0–1 confidence of the source hypothesis (optional)
}

/**
 * Entity type mapping: hypothesis-entities uses 'region' but the plan spec
 * uses 'place' for the dossier entity type. We map 'region' → 'place' on
 * ingest and also support 'org' as an additional kind for forward-compat.
 */
export type DossierEntityType = 'country' | 'ticker' | 'cve' | 'callsign' | 'org' | 'place';

/**
 * Trajectory evidence: raw event counts in each comparison window so the
 * trajectory label always carries its evidence (plan invariant).
 */
export interface TrajectoryEvidence {
  /** Events in the last 7 days. */
  recent7dCount: number;
  /** Events in the prior 21 days (days 7–28). */
  prior21dCount: number;
  /**
   * Rate ratio: recent7dCount/7 divided by prior21dCount/21.
   * null when either window has fewer than MIN_TRAJECTORY_SAMPLES events
   * (min-sample guard).
   */
  rateRatio: number | null;
  /** The comparison window (in days) used for the recent window. */
  recentWindowDays: 7;
  /** The comparison window (in days) used for the prior window. */
  priorWindowDays: 21;
}

export interface EntityDossier {
  /** Canonical entity string, e.g. "RUS" or "BTC-USD" or "CVE-2024-12345". */
  entity: string;
  entityType: DossierEntityType;
  /** Unix-ms timestamp of the first observed event. */
  firstSeen: number;
  /** Unix-ms timestamp of the most recent observed event. */
  lastSeen: number;
  /**
   * Activity timeline ring, capped at MAX_TIMELINE_EVENTS.
   * Most-recent events are at the end of the array.
   */
  timeline: DossierEvent[];
  /**
   * Heat score 0–1. Computed as a sum of decayed weights over all timeline
   * events, normalized to the range [0, 1] relative to MAX_HEAT.
   *
   * Each event contributes weight = exp(−λ × age), where λ = ln(2)/72h.
   * Capped at 1.0.
   */
  heat: number;
  /**
   * Trajectory based on 7-day-vs-prior-21-day event rate comparison.
   * Includes the evidence (counts per window) so the label is not bare.
   */
  trajectory: 'heating' | 'stable' | 'cooling';
  trajectoryEvidence: TrajectoryEvidence;
  /**
   * Top co-occurring entities from entity-graph, sorted by current edge weight.
   * Maximum 5 associates surfaced.
   */
  topAssociates: { entity: string; strength: number }[];
}

// ── Injectable storage interface ──────────────────────────────────────────────

export interface DossierStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface EntityDossierOptions {
  storage?: DossierStorageLike | null;
  getMemoryFn?: <T>(key: string) => Promise<T | null>;
  putMemoryFn?: <T>(key: string, value: T) => Promise<void>;
  now?: () => number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'crystalball-cognition-dossiers-v1';
const MAX_DOSSIERS = 500;
const MAX_TIMELINE_EVENTS = 100;
const MAX_ASSOCIATES = 5;

/**
 * 72-hour exponential half-life for heat decay.
 * λ = ln(2) / halfLifeMs
 */
const HALF_LIFE_MS = 72 * 60 * 60 * 1000;
const DECAY_LAMBDA = Math.LN2 / HALF_LIFE_MS;

/**
 * Normalization ceiling: sum of weights for a perfectly-fresh entity with
 * MAX_TIMELINE_EVENTS events all happening at t=now.  Used to clamp heat
 * to [0, 1].
 */
const MAX_HEAT = MAX_TIMELINE_EVENTS; // each fresh event contributes exp(0)=1

/** Minimum events in a window before trajectory comparison is meaningful. */
const MIN_TRAJECTORY_SAMPLES = 3;

/** Rate ratio above which we call the trajectory 'heating'. */
const HEATING_RATIO_THRESHOLD = 1.5;

/** Rate ratio below which we call the trajectory 'cooling'. */
const COOLING_RATIO_THRESHOLD = 0.67;

// ── State ─────────────────────────────────────────────────────────────────────

/** Map from canonical entity key (e.g. "country:RUS") to EntityDossier. */
const dossiers = new Map<string, EntityDossier>();
let loaded = false;
let writtenSinceLoad = false;

// Injected overrides (populated via configure() for tests).
let _storage: DossierStorageLike | null | undefined = undefined;
let _getMemoryOverride: (<T>(key: string) => Promise<T | null>) | null = null;
let _putMemoryOverride: (<T>(key: string, value: T) => Promise<void>) | null = null;
let _nowFn: () => number = Date.now;

// ── Configuration (injection for tests) ──────────────────────────────────────

/**
 * Configure injectable dependencies. Call before first use in tests.
 * Resets loaded/written state so the store is initialized fresh.
 */
export function configure(opts: EntityDossierOptions): void {
  _storage = opts.storage === undefined ? undefined : opts.storage;
  _getMemoryOverride = opts.getMemoryFn ?? null;
  _putMemoryOverride = opts.putMemoryFn ?? null;
  _nowFn = opts.now ?? Date.now;
  dossiers.clear();
  // Mark as already loaded so subsequent reads do NOT reload from the injected
  // storage (which may still contain data from a prior test run). Tests that
  // want to pre-seed the store should do so via ingestFromHypotheses() after
  // calling configure(), not by relying on the storage auto-load path.
  loaded = true;
  writtenSinceLoad = false;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function resolveStorage(): DossierStorageLike | null {
  if (_storage !== undefined) return _storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as unknown as Record<string, unknown>).localStorage as DossierStorageLike | undefined;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function isValidDossier(d: unknown): d is EntityDossier {
  if (!d || typeof d !== 'object') return false;
  const dd = d as Record<string, unknown>;
  return typeof dd.entity === 'string' &&
    typeof dd.entityType === 'string' &&
    typeof dd.firstSeen === 'number' &&
    typeof dd.lastSeen === 'number' &&
    Array.isArray(dd.timeline) &&
    typeof dd.heat === 'number' &&
    typeof dd.trajectory === 'string';
}

function dossierKey(entityType: DossierEntityType, entity: string): string {
  return `${entityType}:${entity}`;
}

function applyLoaded(arr: EntityDossier[] | null): void {
  if (!Array.isArray(arr)) return;
  dossiers.clear();
  for (const d of arr) {
    if (!isValidDossier(d)) continue;
    dossiers.set(dossierKey(d.entityType, d.entity), d);
  }
}

function load(): void {
  if (loaded) return;
  loaded = true;
  const stor = resolveStorage();
  if (stor) {
    try {
      const raw = stor.getItem(STORAGE_KEY);
      if (raw) applyLoaded(JSON.parse(raw) as EntityDossier[]);
    } catch { /* ignore */ }
  }
  const getMemFn: (key: string) => Promise<EntityDossier[] | null> =
    _getMemoryOverride
      ? (key) => (_getMemoryOverride as (k: string) => Promise<EntityDossier[] | null>)(key)
      : (key) => { lazyLoadIdb(); return _getMemory!<EntityDossier[]>(key); };
  void getMemFn(STORAGE_KEY).then((arr) => {
    if (writtenSinceLoad) return;
    applyLoaded(arr);
  });
}

function save(): void {
  writtenSinceLoad = true;
  const arr = [...dossiers.values()];
  const stor = resolveStorage();
  if (stor) {
    try { stor.setItem(STORAGE_KEY, JSON.stringify(arr)); } catch { /* quota */ }
  }
  const putMemFn: (key: string, value: EntityDossier[]) => Promise<void> =
    _putMemoryOverride
      ? (key, value) => (_putMemoryOverride as (k: string, v: EntityDossier[]) => Promise<void>)(key, value)
      : (key, value) => { lazyLoadIdb(); return _putMemory!(key, value); };
  void putMemFn(STORAGE_KEY, arr);
}

// ── Heat computation ──────────────────────────────────────────────────────────

/**
 * Compute heat score [0, 1] from the timeline ring.
 * Each event contributes exp(−λ × ageMs). Sum is normalized to MAX_HEAT.
 * Exported for tests to verify the half-life math.
 */
export function computeHeat(timeline: readonly DossierEvent[], nowMs: number): number {
  let sum = 0;
  for (const ev of timeline) {
    const ageMs = Math.max(0, nowMs - ev.ts);
    sum += Math.exp(-DECAY_LAMBDA * ageMs);
  }
  return Math.min(1, sum / MAX_HEAT);
}

// ── Trajectory computation ────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Compute trajectory from the timeline ring.
 * Compares the event rate over the last 7 days against the prior 21 days
 * (days 7–28 ago). Includes a min-sample guard: if either window has fewer
 * than MIN_TRAJECTORY_SAMPLES events the label is 'stable' with a null
 * rateRatio (no spurious heating signal from one isolated event).
 */
export function computeTrajectory(
  timeline: readonly DossierEvent[],
  nowMs: number,
): { trajectory: EntityDossier['trajectory']; evidence: TrajectoryEvidence } {
  const recentCutoff = nowMs - 7 * MS_PER_DAY;
  const priorCutoff = nowMs - 28 * MS_PER_DAY;

  let recent7dCount = 0;
  let prior21dCount = 0;
  for (const ev of timeline) {
    if (ev.ts >= recentCutoff) {
      recent7dCount++;
    } else if (ev.ts >= priorCutoff) {
      prior21dCount++;
    }
  }

  const evidence: TrajectoryEvidence = {
    recent7dCount,
    prior21dCount,
    rateRatio: null,
    recentWindowDays: 7,
    priorWindowDays: 21,
  };

  // Min-sample guard: need sufficient data in at least the recent window.
  if (recent7dCount < MIN_TRAJECTORY_SAMPLES && prior21dCount < MIN_TRAJECTORY_SAMPLES) {
    return { trajectory: 'stable', evidence };
  }

  // Compute daily rates.
  const recentRate = recent7dCount / 7;
  // Guard against division by zero: if prior is zero but recent isn't, it's heating.
  if (prior21dCount === 0) {
    if (recent7dCount >= MIN_TRAJECTORY_SAMPLES) {
      evidence.rateRatio = Infinity;
      return { trajectory: 'heating', evidence };
    }
    return { trajectory: 'stable', evidence };
  }
  const priorRate = prior21dCount / 21;
  if (priorRate === 0) {
    return { trajectory: 'stable', evidence };
  }

  const rateRatio = recentRate / priorRate;
  evidence.rateRatio = rateRatio;

  if (rateRatio >= HEATING_RATIO_THRESHOLD) {
    return { trajectory: 'heating', evidence };
  }
  if (rateRatio <= COOLING_RATIO_THRESHOLD) {
    return { trajectory: 'cooling', evidence };
  }
  return { trajectory: 'stable', evidence };
}

// ── Entity-type mapping ───────────────────────────────────────────────────────

/**
 * Map EntityKind (from hypothesis-entities.ts) to DossierEntityType.
 * 'region' in hypothesis-entities.ts corresponds to 'place' in dossier spec.
 */
function toDossierType(kind: EntityKind): DossierEntityType {
  if (kind === 'region') return 'place';
  return kind as DossierEntityType;
}

// ── Eviction ──────────────────────────────────────────────────────────────────

/** Evict the coldest (lowest-heat) dossiers when cap is exceeded. */
function evictIfNeeded(nowMs: number): void {
  if (dossiers.size <= MAX_DOSSIERS) return;
  const sorted = [...dossiers.entries()]
    .map(([key, d]) => ({ key, heat: computeHeat(d.timeline, nowMs) }))
    .sort((a, b) => a.heat - b.heat);
  const toRemove = sorted.slice(0, dossiers.size - MAX_DOSSIERS);
  for (const { key } of toRemove) dossiers.delete(key);
}

// ── Associates helper ─────────────────────────────────────────────────────────

/**
 * Pull top associates from the entity graph for a given canonical entity key.
 * Each returned entry has the partner entity key and current decayed strength.
 */
function buildAssociates(
  canonicalKey: string,
  nowMs: number,
): { entity: string; strength: number }[] {
  const edges: EntityEdge[] = neighborsOf(canonicalKey, MAX_ASSOCIATES);
  return edges.map((e) => {
    const partner = e.a === canonicalKey ? e.b : e.a;
    // Normalize strength to 0–1 by clamping raw decayed weight at 10.
    const decayed = e.weight * Math.exp(-Math.LN2 / HALF_LIFE_MS * Math.max(0, nowMs - e.lastSeen));
    const strength = Math.min(1, decayed / 10);
    return { entity: partner, strength };
  });
}

// ── Core ingest ───────────────────────────────────────────────────────────────

function ingestHypothesis(h: Hypothesis, nowMs: number): void {
  // Build text for entity extraction: statement + evidence labels + region.
  const texts: string[] = [h.statement];
  if (h.region) texts.push(h.region);
  for (const ev of h.evidence) texts.push(ev.label);
  const combined = texts.join(' | ');

  const extracted = extractEntitiesFromText(combined);

  // Also add region as a place entity if present and short enough.
  if (h.region && h.region.length <= 40) {
    const trimmed = h.region.trim();
    if (trimmed && !extracted.some(e => e.kind === 'region' && e.entity === trimmed)) {
      extracted.push({ kind: 'region', entity: trimmed });
    }
  }

  if (extracted.length === 0) return;

  // Record co-occurrence in the entity graph.
  const entityKeys = extracted.map(e => dossierKey(toDossierType(e.kind), e.entity));
  recordCoOccurrence(entityKeys, nowMs);

  // Build the DossierEvent for this hypothesis.
  const event: DossierEvent = {
    ts: nowMs,
    kind: h.kind,
    refId: h.id,
    label: h.statement.slice(0, 100),
    severity: h.confidence,
  };

  // Update each entity's dossier.
  for (const { kind, entity } of extracted) {
    const dType = toDossierType(kind);
    const key = dossierKey(dType, entity);
    const existing = dossiers.get(key);

    if (existing) {
      // Append to timeline ring.
      existing.timeline.push(event);
      if (existing.timeline.length > MAX_TIMELINE_EVENTS) {
        existing.timeline.splice(0, existing.timeline.length - MAX_TIMELINE_EVENTS);
      }
      existing.lastSeen = nowMs;
      // Recompute heat and trajectory.
      existing.heat = computeHeat(existing.timeline, nowMs);
      const { trajectory, evidence } = computeTrajectory(existing.timeline, nowMs);
      existing.trajectory = trajectory;
      existing.trajectoryEvidence = evidence;
      // Associates are rebuilt on read (getDossier) for freshness; here we
      // store a placeholder so the field is always present on the object.
      // getDossier() will refresh it via buildAssociates().
      existing.topAssociates = buildAssociates(key, nowMs);
    } else {
      const timeline: DossierEvent[] = [event];
      const heat = computeHeat(timeline, nowMs);
      const { trajectory, evidence } = computeTrajectory(timeline, nowMs);
      dossiers.set(key, {
        entity,
        entityType: dType,
        firstSeen: nowMs,
        lastSeen: nowMs,
        timeline,
        heat,
        trajectory,
        trajectoryEvidence: evidence,
        topAssociates: [], // populated by buildAssociates on first read
      });
    }
  }
}

// ── Public write API ──────────────────────────────────────────────────────────

/**
 * Ingest a batch of hypotheses into the dossier store.
 * Extracts entities from each hypothesis, updates timelines, heat, trajectory,
 * and the co-occurrence graph.
 *
 * Ghost Mode suppresses all writes (consistent with other learning services).
 * Errors from entity extraction or graph writes are swallowed — this is
 * called fire-and-forget from analyst-loop.
 */
export function ingestFromHypotheses(hs: readonly Hypothesis[]): void {
  if (isGhostMode()) return;
  load();
  const nowMs = _nowFn();
  for (const h of hs) {
    try {
      ingestHypothesis(h, nowMs);
    } catch { /* never let a single hypothesis crash the batch */ }
  }
  evictIfNeeded(nowMs);
  save();
}

// ── Public read API ───────────────────────────────────────────────────────────

/**
 * Return the dossier for an entity key (e.g. "RUS", "BTC-USD", "CVE-2024-12345").
 * Tries an exact match first, then falls back to a scan across all entity types
 * so callers don't need to know the type.
 *
 * The `topAssociates` field is refreshed from the current entity graph state
 * on every getDossier call so the caller always sees the freshest graph data.
 *
 * Returns null if the entity has no dossier.
 */
export function getDossier(entity: string): EntityDossier | null {
  load();
  const nowMs = _nowFn();
  // Try all entity types.
  const types: DossierEntityType[] = ['country', 'ticker', 'cve', 'callsign', 'org', 'place'];
  for (const t of types) {
    const key = dossierKey(t, entity);
    const d = dossiers.get(key);
    if (d) {
      // Refresh heat (in case time has passed without new events).
      d.heat = computeHeat(d.timeline, nowMs);
      // Refresh trajectory.
      const { trajectory, evidence } = computeTrajectory(d.timeline, nowMs);
      d.trajectory = trajectory;
      d.trajectoryEvidence = evidence;
      // Refresh associates from graph.
      d.topAssociates = buildAssociates(key, nowMs);
      return d;
    }
  }
  return null;
}

/**
 * Return the top `limit` hottest entities (highest current heat), sorted
 * descending. Used by Command Center "what to watch next" and AnalystHUD.
 *
 * `limit` defaults to 10.
 */
export function getHotEntities(limit = 10): EntityDossier[] {
  load();
  const nowMs = _nowFn();
  const result = [...dossiers.values()].map(d => {
    // Recompute heat at query time for accurate ordering.
    return { ...d, heat: computeHeat(d.timeline, nowMs) };
  });
  result.sort((a, b) => b.heat - a.heat);
  return limit > 0 ? result.slice(0, limit) : result;
}

/** Return total dossier count (for testing caps). */
export function getDossierCount(): number {
  load();
  return dossiers.size;
}

/** Reset all dossier state (for testing). */
export function resetEntityDossiers(): void {
  dossiers.clear();
  loaded = false;
  writtenSinceLoad = false;
}

/** Export all dossiers as an array (for testing / diagnostics). */
export function getAllDossiers(): EntityDossier[] {
  load();
  return [...dossiers.values()];
}
