/**
 * Memory Consolidation — episodic → learned schemas (PR 8).
 *
 * A periodic "sleep" pass over resolved episodes: clusters them by vector
 * similarity, distills recurring patterns into LearnedSchema records, and
 * registers strong schemas into the CrisisSignatureLibrary so the existing
 * matching engine surfaces them with zero new UI.
 *
 * Algorithm:
 *   1. Collect all resolved episodes (outcome set, same tier, from episodic-memory).
 *   2. Greedy threshold clustering: pick the unassigned episode with the
 *      highest vector magnitude as seed; assign all unassigned episodes within
 *      cosine similarity ≥ CLUSTER_SIM_THRESHOLD (default 0.60) to its cluster;
 *      repeat until all episodes are assigned. Same-tier-only comparison is
 *      enforced by cosineSimilarity (via vector-index).
 *   3. For clusters with ≥ MIN_CLUSTER_SIZE members AND materialization rate
 *      ≥ HIGH_RATE_THRESHOLD (0.7) OR ≤ LOW_RATE_THRESHOLD (0.3) — i.e.
 *      informative either way — distill a LearnedSchema.
 *   4. Schemas with n ≥ REGISTER_MIN_N (6) members are registered into the
 *      CrisisSignatureLibrary under the id prefix 'learned:' so they are
 *      tagged as machine-learned, not hand-authored.
 *   5. Cap: at most MAX_SCHEMAS (50) learned schemas. When over cap, evict
 *      the schema with the lowest memberCount.
 *   6. Auto-retirement: call recordSchemaOutcome() to log post-registration
 *      hits/misses; when subsequent hit rate drops below RETIRE_THRESHOLD (0.4)
 *      the schema is deregistered from the library and marked retired in the
 *      store. Automatic grading wiring via outcome-ledger lands with PR 12.
 *
 * CrisisSignature registration:
 *   CrisisSignature has no 'source' field. Learned schemas are distinguished
 *   by id prefix 'learned:' and name prefix 'learned: '. The least-invasive
 *   extension: the CrisisSignatureLibrary's addSignature() / removeSignature()
 *   API is used directly; no structural change to the library is needed.
 *   The fingerprint is synthesised from the schema's shared domains/entities
 *   using the 'domain-elevation' and 'entity-spike' feature types that the
 *   library already evaluates.
 *
 * Scheduling:
 *   runConsolidation() is the pure exported entry point (injectable episode
 *   source / clock / registrar for tests). The thin wrapper
 *   scheduleConsolidation() wires the 24 h idle-time trigger
 *   (requestIdleCallback + setTimeout fallback, visibility-guarded, Ghost-Mode-
 *   suppressed). consolidation.ts itself has no globals at import time.
 *
 * Persistence:
 *   IDB key  : crystalball-cognition-schemas-v1
 *   LS mirror: crystalball-cognition-schemas-v1
 *   Pattern  : same loaded/writtenSinceLoad guards as action-memory.ts.
 *
 * Design invariants (house plan):
 *   - Every schema carries provenance (member episode IDs).
 *   - Learned knowledge is falsifiable: retirement path is mandatory.
 *   - No DOM, no fetch, no globals at import time. Pure core, thin wrapper.
 *   - All outputs testable with static fixtures (injectable everything).
 */

import { cosineSimilarity } from './vector-index';
import type { Episode } from './episodic-memory';
import type { CrisisSignature,  } from '../intelligence/crisis-signature-library';

// getMemory/putMemory are IDB-backed; lazy-loaded so pure Node tests run fine.
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

/** A pattern learned by clustering resolved episodes. */
export interface LearnedSchema {
  /** Stable identifier, always prefixed 'learned:'. */
  id: string;
  /** Human-readable pattern description. */
  name: string;
  /** Shared domains across cluster members. */
  domains: string[];
  /** Shared entities across cluster members (present in >50% of members). */
  entities: string[];
  /** Median lead time in hours between episode creation and resolution. */
  medianLeadTimeHours: number;
  /** Fraction of members whose outcome was 'materialized' or 'partial'. */
  materializationRate: number;
  /** Total number of cluster members at distillation time. */
  memberCount: number;
  /** Episode IDs of all cluster members — provenance invariant. */
  memberEpisodeIds: string[];
  /** When this schema was distilled (ms since epoch). */
  distilledAt: number;
  /** Whether the schema has been deregistered due to low subsequent hit rate. */
  retired: boolean;
  /** Subsequent outcomes logged after registration (hit/miss). */
  subsequentOutcomes: { hit: boolean; recordedAt: number }[];
}

/** Summary of one consolidation run. */
export interface ConsolidationReport {
  episodesProcessed: number;
  clustersFound: number;
  schemasDistilled: number;
  schemasRegistered: number;
  schemasRetired: number;
  schemasEvicted: number;
  ranAt: number;
}

// ── Injectable interfaces ─────────────────────────────────────────────────────

/** Minimal episode source interface — injectable for tests. */
export type EpisodeSource = () => readonly Episode[];

/** Minimal registrar interface matching CrisisSignatureLibrary's public API. */
export interface SchemaRegistrar {
  addSignature(sig: CrisisSignature): CrisisSignature;
  removeSignature(id: string): boolean;
}

/** Storage interface for test injection. */
export interface ConsolidationStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Options for runConsolidation — all injectable. */
export interface ConsolidationOptions {
  /** Episode source function (default: getAllEpisodes from episodic-memory). */
  episodeSource?: EpisodeSource;
  /** Crisis signature registrar (default: getCrisisSignatureLibrary()). */
  registrar?: SchemaRegistrar;
  /** Override localStorage for tests. Pass null to disable LS mirror. */
  storage?: ConsolidationStorageLike | null;
  /** Override IDB get for tests. */
  getMemoryFn?: <T>(key: string) => Promise<T | null>;
  /** Override IDB put for tests. */
  putMemoryFn?: <T>(key: string, value: T) => Promise<void>;
  /** Override clock for deterministic tests. */
  now?: () => number;
  /** Cluster cosine similarity threshold (default 0.60). */
  clusterSimThreshold?: number;
  /** Minimum cluster size to distill a schema (default 4). */
  minClusterSize?: number;
  /** Minimum cluster size to register into the library (default 6). */
  registerMinN?: number;
  /** Materialization rate upper bound for "informative" clusters (default 0.7). */
  highRateThreshold?: number;
  /** Materialization rate lower bound for "informative" clusters (default 0.3). */
  lowRateThreshold?: number;
  /** Max stored schemas before eviction (default 50). */
  maxSchemas?: number;
  /** Subsequent hit rate below which a schema is retired (default 0.4). */
  retireThreshold?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'crystalball-cognition-schemas-v1';
const DEFAULT_CLUSTER_SIM = 0.6;
const DEFAULT_MIN_CLUSTER_SIZE = 4;
const DEFAULT_REGISTER_MIN_N = 6;
const DEFAULT_HIGH_RATE = 0.7;
const DEFAULT_LOW_RATE = 0.3;
const DEFAULT_MAX_SCHEMAS = 50;
const DEFAULT_RETIRE_THRESHOLD = 0.4;
const MIN_SUBSEQUENT_FOR_RETIRE = 5;

// ── Module-level singleton state (schema store) ───────────────────────────────

const _schemas: LearnedSchema[] = [];
let _loaded = false;
let _writtenSinceLoad = false;

// Injected overrides
let _storageOverride: ConsolidationStorageLike | null | undefined = undefined;
let _getMemoryOverride: (<T>(key: string) => Promise<T | null>) | null = null;
let _putMemoryOverride: (<T>(key: string, value: T) => Promise<void>) | null = null;

// ── Storage helpers ───────────────────────────────────────────────────────────

function resolveStorage(injected: ConsolidationStorageLike | null | undefined): ConsolidationStorageLike | null {
  if (injected !== undefined) return injected;
  if (_storageOverride !== undefined) return _storageOverride;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as unknown as Record<string, unknown>).localStorage as ConsolidationStorageLike | undefined;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function isValidSchema(s: unknown): s is LearnedSchema {
  if (!s || typeof s !== 'object') return false;
  const sc = s as Record<string, unknown>;
  return typeof sc.id === 'string' &&
    typeof sc.name === 'string' &&
    Array.isArray(sc.memberEpisodeIds) &&
    typeof sc.distilledAt === 'number';
}

function applyLoaded(arr: unknown): void {
  if (!Array.isArray(arr)) return;
  _schemas.length = 0;
  for (const item of arr) {
    if (isValidSchema(item)) _schemas.push(item);
  }
}

function load(storage: ConsolidationStorageLike | null): void {
  if (_loaded) return;
  _loaded = true;
  if (storage) {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw) applyLoaded(JSON.parse(raw) as unknown);
    } catch { /* corrupt — start clean */ }
  }
  const getMemFn: (key: string) => Promise<unknown> = _getMemoryOverride
    ? (key) => (_getMemoryOverride as (k: string) => Promise<unknown>)(key)
    : (key) => { lazyLoadIdb(); return _getMemory!<unknown>(key); };
  void getMemFn(STORAGE_KEY).then((arr) => {
    if (_writtenSinceLoad) return;
    applyLoaded(arr);
  });
}

function save(storage: ConsolidationStorageLike | null): void {
  _writtenSinceLoad = true;
  if (storage) {
    try { storage.setItem(STORAGE_KEY, JSON.stringify(_schemas)); } catch { /* quota */ }
  }
  const putMemFn = _putMemoryOverride
    ?? ((key: string, value: unknown) => { lazyLoadIdb(); return _putMemory!<unknown>(key, value); });
  void putMemFn(STORAGE_KEY, _schemas);
}

// ── Clustering ────────────────────────────────────────────────────────────────

interface Cluster {
  members: Episode[];
}

/**
 * Greedy threshold clustering of episodes by vector cosine similarity.
 * Only compares episodes within the same tier (neural vs hashed).
 * Seed: episode with the highest L2 norm (proxy for most distinct).
 * Assignment: all unassigned episodes within simThreshold of the seed join.
 * Repeat until all assigned.
 */
function clusterEpisodes(episodes: readonly Episode[], simThreshold: number): Cluster[] {
  if (episodes.length === 0) return [];

  // Group by tier first — never compare across tiers (vector-index invariant).
  const byTier = new Map<string, Episode[]>();
  for (const ep of episodes) {
    const group = byTier.get(ep.tier) ?? [];
    group.push(ep);
    byTier.set(ep.tier, group);
  }

  const clusters: Cluster[] = [];

  for (const [, tierEps] of byTier) {
    const unassigned = new Set<number>(tierEps.map((_, i) => i));

    while (unassigned.size > 0) {
      // Pick the unassigned episode with the highest vector L2 norm as seed.
      let seedIdx = -1;
      let bestNorm = -1;
      for (const i of unassigned) {
        const ep = tierEps[i]!;
        let norm = 0;
        for (const v of ep.vector) norm += v * v;
        if (norm > bestNorm) { bestNorm = norm; seedIdx = i; }
      }
      if (seedIdx === -1) break;

      unassigned.delete(seedIdx);
      const seed = tierEps[seedIdx]!;
      const seedVec = new Float32Array(seed.vector);
      const clusterMembers: Episode[] = [seed];

      for (const i of unassigned) {
        const candidate = tierEps[i]!;
        if (candidate.vector.length !== seedVec.length) continue; // dim mismatch — skip
        const sim = cosineSimilarity(seedVec, new Float32Array(candidate.vector));
        if (sim >= simThreshold) {
          clusterMembers.push(candidate);
          unassigned.delete(i);
        }
      }

      clusters.push({ members: clusterMembers });
    }
  }

  return clusters;
}

// ── Schema distillation ───────────────────────────────────────────────────────

/** Median of a sorted numeric array. Returns 0 for empty. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : ((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** Compute materialization rate: fraction with outcome 'materialized' or 'partial'. */
function materializationRate(episodes: readonly Episode[]): number {
  if (episodes.length === 0) return 0;
  let count = 0;
  for (const ep of episodes) {
    if (ep.outcome === 'materialized' || ep.outcome === 'partial') count += 1;
  }
  return count / episodes.length;
}

/** Extract shared domains: those present in every member. */
function sharedDomains(episodes: readonly Episode[]): string[] {
  if (episodes.length === 0) return [];
  const first = episodes[0]!.domains;
  return first.filter(d =>
    episodes.every(ep => ep.domains.includes(d)),
  );
}

/** Extract shared entities: those present in >50% of members. */
function sharedEntities(episodes: readonly Episode[]): string[] {
  if (episodes.length === 0) return [];
  const counts = new Map<string, number>();
  for (const ep of episodes) {
    for (const entity of ep.entities) {
      counts.set(entity, (counts.get(entity) ?? 0) + 1);
    }
  }
  const threshold = episodes.length * 0.5;
  const result: string[] = [];
  for (const [entity, count] of counts) {
    if (count > threshold) result.push(entity);
  }
  return result;
}

/** Compute median lead time in hours from createdAt → resolvedAt. */
function medianLeadTimeHours(episodes: readonly Episode[]): number {
  const times: number[] = [];
  for (const ep of episodes) {
    if (ep.resolvedAt !== undefined) {
      const hrs = (ep.resolvedAt - ep.createdAt) / (1000 * 60 * 60);
      times.push(Math.max(0, hrs));
    }
  }
  return median(times);
}

/** Synthesize a CrisisSignature from a LearnedSchema. */
function schemaToSignature(schema: LearnedSchema): CrisisSignature {
  const fingerprint: CrisisSignature['fingerprint'] = [];

  // Add domain-elevation features for each shared domain.
  for (const domain of schema.domains.slice(0, 3)) {
    fingerprint.push({
      featureType: 'domain-elevation',
      weight: 0.4 / Math.max(1, schema.domains.length),
      params: {
        domain,
        minCount: 3,
        minSeverity: 'MEDIUM',
      },
    });
  }

  // Add entity-spike feature if shared entities exist.
  if (schema.entities.length > 0) {
    fingerprint.push({
      featureType: 'entity-spike',
      weight: 0.3,
      params: { minCount: 2 },
    });
  }

  // Add a time-pattern feature derived from median lead time.
  const windowHours = Math.max(6, Math.min(168, schema.medianLeadTimeHours * 2));
  fingerprint.push({
    featureType: 'time-pattern',
    weight: 0.3,
    params: {
      windowMinutes: Math.round(windowHours * 60),
      minCount: Math.max(3, Math.floor(schema.memberCount / 2)),
    },
  });

  // Normalise weights to sum to 1.
  const totalWeight = fingerprint.reduce((s, f) => s + f.weight, 0);
  if (totalWeight > 0) {
    for (const f of fingerprint) f.weight = Number((f.weight / totalWeight).toFixed(4));
  }

  const rate = schema.materializationRate;
  const description = schema.domains.length > 0
    ? `${schema.domains.join('/')} pattern`
    : 'cross-domain pattern';

  return {
    id: schema.id,
    name: `learned: ${description} (n=${schema.memberCount}, rate=${(rate * 100).toFixed(0)}%)`,
    domain: schema.domains[0] ?? 'unknown',
    fingerprint,
    historicalExamples: schema.memberEpisodeIds.slice(0, 5),
    avgLeadTimeHours: schema.medianLeadTimeHours,
    confidence: Math.min(0.85, 0.4 + schema.memberCount * 0.04),
  };
}

/** Generate a stable schema ID from a cluster (based on sorted episode ids). */
function schemaId(episodes: readonly Episode[]): string {
  const sorted = [...episodes].map(e => e.id).sort((a, b) => a.localeCompare(b));
  // Simple deterministic hash of the sorted IDs.
  let h = 5381;
  for (const id of sorted) {
    for (let i = 0; i < id.length; i++) {
      h = (((h << 5) + h) + (id.codePointAt(i) ?? 0)) >>> 0;
    }
  }
  return `learned:${h.toString(36)}`;
}

// ── Eviction ──────────────────────────────────────────────────────────────────

/** Evict lowest-memberCount schemas when over cap. Returns count evicted. */
function evictOverCap(maxSchemas: number, registrar: SchemaRegistrar | null, storage: ConsolidationStorageLike | null): number {
  if (_schemas.length <= maxSchemas) return 0;
  // Sort by memberCount ascending so lowest-n are first.
  const sorted = [..._schemas].sort((a, b) => a.memberCount - b.memberCount);
  const overflow = _schemas.length - maxSchemas;
  let evicted = 0;
  for (let i = 0; i < overflow; i++) {
    const schema = sorted[i];
    if (!schema) continue;
    const idx = _schemas.findIndex(s => s.id === schema.id);
    if (idx !== -1) _schemas.splice(idx, 1);
    if (registrar) try { registrar.removeSignature(schema.id); } catch { /* best effort */ }
    evicted += 1;
  }
  if (evicted > 0) save(storage);
  return evicted;
}

// ── Retirement ────────────────────────────────────────────────────────────────

/**
 * Record a post-registration hit or miss for a schema.
 * When subsequent hit rate (from MIN_SUBSEQUENT_FOR_RETIRE outcomes) drops
 * below retireThreshold, the schema is retired and deregistered from the
 * library.
 *
 * Note: automatic grading wiring from outcome-ledger lands with PR 12.
 * This entry point lets that wiring plug in without changing the API.
 */
export function recordSchemaOutcome(
  schemaId: string,
  hit: boolean,
  opts?: Pick<ConsolidationOptions, 'registrar' | 'storage' | 'now' | 'retireThreshold'>,
): boolean {
  const storage = resolveStorage(opts?.storage);
  load(storage);

  const schema = _schemas.find(s => s.id === schemaId);
  if (!schema || schema.retired) return false;

  const nowMs = opts?.now ? opts.now() : Date.now();
  schema.subsequentOutcomes.push({ hit, recordedAt: nowMs });

  const retireThreshold = opts?.retireThreshold ?? DEFAULT_RETIRE_THRESHOLD;

  // Check retirement condition.
  let retired = false;
  if (schema.subsequentOutcomes.length >= MIN_SUBSEQUENT_FOR_RETIRE) {
    const hits = schema.subsequentOutcomes.filter(o => o.hit).length;
    const hitRate = hits / schema.subsequentOutcomes.length;
    if (hitRate < retireThreshold) {
      schema.retired = true;
      retired = true;
      const registrar = opts?.registrar ?? getDefaultRegistrar();
      if (registrar) {
        try { registrar.removeSignature(schemaId); } catch { /* best effort */ }
      }
    }
  }

  save(storage);
  return retired;
}

/** Get the schema store (for inspection and retirement wiring). */
export function getAllSchemas(): readonly LearnedSchema[] {
  const storage = resolveStorage(undefined);
  load(storage);
  return [..._schemas];
}

/** Get a single schema by id. */
export function getSchemaById(id: string): LearnedSchema | undefined {
  const storage = resolveStorage(undefined);
  load(storage);
  return _schemas.find(s => s.id === id);
}

// ── Default registrar (lazy, avoids import-time globals) ──────────────────────

function getDefaultRegistrar(): SchemaRegistrar | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../intelligence/crisis-signature-library') as {
      getCrisisSignatureLibrary: () => SchemaRegistrar;
    };
    return mod.getCrisisSignatureLibrary();
  } catch {
    return null;
  }
}

const emptyEpisodeSource: EpisodeSource = () => [];

function getDefaultEpisodeSource(): EpisodeSource {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./episodic-memory') as { getAllEpisodes: () => readonly Episode[] };
    return mod.getAllEpisodes;
  } catch {
    return emptyEpisodeSource;
  }
}

// ── Core consolidation pass ───────────────────────────────────────────────────

/**
 * Run a full consolidation pass over resolved episodes.
 *
 * Pure entry point — all side effects are injectable. Callers in production
 * pass no options (defaults are used); tests pass stubs.
 *
 * Returns a ConsolidationReport summarising what changed.
 */
export function runConsolidation(opts: ConsolidationOptions = {}): Promise<ConsolidationReport> {
  const nowFn = opts.now ?? (() => Date.now());
  const storage = resolveStorage(opts.storage);
  load(storage);

  // Inject IDB overrides for tests.
  if (opts.getMemoryFn !== undefined) _getMemoryOverride = opts.getMemoryFn;
  if (opts.putMemoryFn !== undefined) _putMemoryOverride = opts.putMemoryFn;

  const simThreshold = opts.clusterSimThreshold ?? DEFAULT_CLUSTER_SIM;
  const minClusterSize = opts.minClusterSize ?? DEFAULT_MIN_CLUSTER_SIZE;
  const registerMinN = opts.registerMinN ?? DEFAULT_REGISTER_MIN_N;
  const highRate = opts.highRateThreshold ?? DEFAULT_HIGH_RATE;
  const lowRate = opts.lowRateThreshold ?? DEFAULT_LOW_RATE;
  const maxSchemas = opts.maxSchemas ?? DEFAULT_MAX_SCHEMAS;
  const retireThreshold = opts.retireThreshold ?? DEFAULT_RETIRE_THRESHOLD;

  const episodeSource = opts.episodeSource ?? getDefaultEpisodeSource();
  const registrar = opts.registrar ?? getDefaultRegistrar();

  const ranAt = nowFn();

  // Step 1: collect resolved episodes with a known informative outcome.
  const allEpisodes = episodeSource();
  const resolved = allEpisodes.filter(ep =>
    ep.resolvedAt !== undefined &&
    ep.outcome !== undefined &&
    ep.outcome !== 'unknown' &&
    ep.vector.length > 0,
  );

  if (resolved.length === 0) {
    return Promise.resolve({
      episodesProcessed: 0,
      clustersFound: 0,
      schemasDistilled: 0,
      schemasRegistered: 0,
      schemasRetired: 0,
      schemasEvicted: 0,
      ranAt,
    });
  }

  // Step 2: greedy threshold clustering.
  const clusters = clusterEpisodes(resolved, simThreshold);

  let schemasDistilled = 0;
  let schemasRegistered = 0;

  for (const cluster of clusters) {
    if (cluster.members.length < minClusterSize) continue;

    const rate = materializationRate(cluster.members);
    // Informative gate: rate ≥ highRate OR rate ≤ lowRate.
    if (rate > lowRate && rate < highRate) continue;

    // Distill schema.
    const id = schemaId(cluster.members);

    // Skip if we already have this schema.
    const existing = _schemas.find(s => s.id === id);
    if (existing && !existing.retired) continue;

    const schema: LearnedSchema = {
      id,
      name: '', // filled below
      domains: sharedDomains(cluster.members),
      entities: sharedEntities(cluster.members),
      medianLeadTimeHours: medianLeadTimeHours(cluster.members),
      materializationRate: rate,
      memberCount: cluster.members.length,
      memberEpisodeIds: cluster.members.map(e => e.id),
      distilledAt: ranAt,
      retired: false,
      subsequentOutcomes: [],
    };

    const description = schema.domains.length > 0
      ? schema.domains.join('/')
      : 'cross-domain';
    schema.name = `learned: ${description} (n=${schema.memberCount}, rate=${(rate * 100).toFixed(0)}%)`;

    // Replace retired version or append fresh.
    const retiredIdx = _schemas.findIndex(s => s.id === id && s.retired);
    if (retiredIdx !== -1) {
      _schemas.splice(retiredIdx, 1);
    }
    _schemas.push(schema);
    schemasDistilled += 1;

    // Step 4: register strong schemas (n ≥ registerMinN) into the library.
    if (cluster.members.length >= registerMinN && registrar) {
      const sig = schemaToSignature(schema);
      try {
        registrar.addSignature(sig);
        schemasRegistered += 1;
      } catch { /* library full or invalid — best effort */ }
    }
  }

  // Step 5: enforce cap (evict lowest-n).
  const schemasEvicted = evictOverCap(maxSchemas, registrar, storage);

  // Check retirement for schemas with enough subsequent outcomes.
  let schemasRetired = 0;
  for (const schema of _schemas) {
    if (schema.retired) continue;
    if (schema.subsequentOutcomes.length >= MIN_SUBSEQUENT_FOR_RETIRE) {
      const hits = schema.subsequentOutcomes.filter(o => o.hit).length;
      const hitRate = hits / schema.subsequentOutcomes.length;
      if (hitRate < retireThreshold) {
        schema.retired = true;
        schemasRetired += 1;
        if (registrar) {
          try { registrar.removeSignature(schema.id); } catch { /* best effort */ }
        }
      }
    }
  }

  save(storage);

  return Promise.resolve({
    episodesProcessed: resolved.length,
    clustersFound: clusters.length,
    schemasDistilled,
    schemasRegistered,
    schemasRetired,
    schemasEvicted,
    ranAt,
  });
}

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Reset module state for test isolation. */
export function resetConsolidationForTests(): void {
  _schemas.length = 0;
  _loaded = false;
  _writtenSinceLoad = false;
  _storageOverride = undefined;
  _getMemoryOverride = null;
  _putMemoryOverride = null;
}

/** Configure module-level overrides (call before tests). */
export function configureConsolidationForTests(opts: {
  storage?: ConsolidationStorageLike | null;
  getMemoryFn?: <T>(key: string) => Promise<T | null>;
  putMemoryFn?: <T>(key: string, value: T) => Promise<void>;
}): void {
  if (opts.storage !== undefined) _storageOverride = opts.storage;
  if (opts.getMemoryFn !== undefined) _getMemoryOverride = opts.getMemoryFn;
  if (opts.putMemoryFn !== undefined) _putMemoryOverride = opts.putMemoryFn;
}

// ── Scheduling (thin non-pure wrapper; not imported by pure tests) ────────────

/**
 * Wire a 24 h idle-time consolidation trigger.
 *
 * - requestIdleCallback (with setTimeout fallback) ensures consolidation
 *   runs when the main thread is idle.
 * - Visibility guard: skips if document is hidden (user left the tab).
 * - Ghost Mode guard: skips if isGhostMode() is true.
 * - Subsequent consolidations are re-scheduled after each run.
 *
 * Call once at boot from panel-layout.ts or data-loader.ts.
 * The function is a no-op in Node.js environments (test runner).
 */
export function scheduleConsolidation(): void {
  if (typeof globalThis === 'undefined') return;
  const g = globalThis as Record<string, unknown>;
  if (g.document === undefined) return; // Node.js — skip

  const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 h

  function runWhenIdle(): void {
    const doc = (globalThis as unknown as { document?: { visibilityState?: string } }).document;
    if (doc?.visibilityState === 'hidden') {
      // Re-schedule for next interval.
      scheduleNextRun();
      return;
    }

    // Ghost Mode check — lazy import to avoid global at module load.
    let ghostMode = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mm = require('@/services/mode-manager') as { isGhostMode: () => boolean };
      ghostMode = mm.isGhostMode();
    } catch { /* ignore */ }

    if (ghostMode) {
      scheduleNextRun();
      return;
    }

    void runConsolidation().then(scheduleNextRun).catch(scheduleNextRun);
  }

  function scheduleNextRun(): void {
    const w = globalThis as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
      setTimeout: (cb: () => void, ms: number) => void;
    };
    if (typeof w.requestIdleCallback === 'function') {
      w.requestIdleCallback(runWhenIdle, { timeout: INTERVAL_MS });
    } else {
      w.setTimeout(runWhenIdle, INTERVAL_MS);
    }
  }

  scheduleNextRun();
}

// ── Re-export CrisisSignatureLibraryOptions for convenience (used by registrar type) ──


export {type CrisisSignatureLibraryOptions} from '../intelligence/crisis-signature-library';