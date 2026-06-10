/**
 * Episodic Memory — durable episode store with semantic retrieval.
 *
 * Every resolved situation/hypothesis becomes a durable episode with an
 * embedding and an outcome. New hypotheses retrieve top-K similar past
 * episodes (analogScoreFor), and the recall feeds the analogBoost in
 * intelligence/hypothesis-forecast.ts — which today receives analogScore: null.
 *
 * Design invariants (house plan):
 *   - Every score has an explanation listing overlapping entities/domains.
 *   - Stale data reduces confidence rather than disappearing silently.
 *   - Every output is testable with static fixtures (no live fetch in tests).
 *   - Contradictions surface, never averaged away.
 *
 * Persistence: getMemory/putMemory from reasoning-memory.ts (IDB
 * reasoning_memory store on crystalball_db) with a localStorage bootstrap
 * mirror, following the loaded/writtenSinceLoad guard pattern from
 * action-memory.ts. Injectible storage for tests.
 *
 * Ghost Mode: recordEpisode and resolveEpisode no-op when isGhostMode() is
 * true; already-learned state still applies for reads.
 *
 * localStorage key: crystalball-cognition-episodic-v1
 * IDB key: crystalball-cognition-episodic-v1
 * Events: cb:episodic-recall (window, on recall with results)
 */

import { embed, maybeUpgradeEmbedding } from './embedding-provider';
import { topK } from './vector-index';
import type { IndexedVector } from './vector-index';
import { isGhostMode } from '@/services/mode-manager';
import { getTunedParam } from '@/services/algorithms/tunable-params-store';

// getMemory/putMemory are IDB-backed and may not be available in pure Node.js
// tests. The injectible storage option below lets tests bypass them.
let _getMemory: (<T>(key: string) => Promise<T | null>) | null = null;
let _putMemory: (<T>(key: string, value: T) => Promise<void>) | null = null;

function lazyLoadIdb(): void {
  if (_getMemory !== null) return;
  // Dynamic import so tests can run without IDB globals.
  try {
    // This is a synchronous require in practice because the module is already
    // bundled — but we wrap in try/catch so pure Node tests don't crash.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@/services/reasoning-memory') as {
      getMemory: <T>(key: string) => Promise<T | null>;
      putMemory: <T>(key: string, value: T) => Promise<void>;
    };
    _getMemory = mod.getMemory;
    _putMemory = mod.putMemory;
  } catch {
    // In test environments without IDB, fall back to no-op implementations.
    _getMemory = async () => null;
    _putMemory = async () => undefined;
  }
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface Episode {
  id: string;
  kind: 'situation' | 'hypothesis' | 'brief';
  /** Stable signature from hypothesis-feedback.signatureFor where applicable. */
  signature: string;
  /** Text that was embedded (≤ 500 chars). */
  summary: string;
  domains: string[];
  /** Entities extracted from hypothesis-entities. */
  entities: string[];
  region?: string;
  createdAt: number;
  resolvedAt?: number;
  outcome?: 'materialized' | 'fizzled' | 'partial' | 'unknown';
  /** What actually happened (≤ 280 chars). */
  outcomeNote?: string;
  /** Serialized Float32Array as plain number[]. */
  vector: number[];
  tier: 'neural' | 'hashed';
  /**
   * PR 14 — memory hygiene: marks episodes whose hypothesis was refuted by
   * competitive-hypothesis resolution. Contradictory episodes remain retrievable
   * in recall() results but are excluded from analogScoreFor() computations by
   * default (excludeContradictory option, default ON).
   * Contradictions surface rather than being silently dropped — plan invariant.
   */
  contradictory?: boolean;
  /** Human-readable reason for the contradictory flag (≤ 280 chars). */
  contradictoryReason?: string;
}

export interface Recall {
  episode: Episode;
  similarity: number; // 0–1
  ageDays: number;
  /** "matched on: Black Sea, wheat, escalation" — plan invariant: every score has an explanation. */
  explanation: string;
  /**
   * PR 14 — memory hygiene: true when this episode has been marked contradictory
   * (hypothesis refuted by competitive-hypothesis resolution). The episode is still
   * returned in recall results for full visibility; analogScoreFor() excludes it
   * from scoring by default (excludeContradictory option).
   */
  contradictory?: boolean;
}

// ── Injectable storage interface (for tests) ──────────────────────────────────

export interface EpisodicStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface EpisodicMemoryOptions {
  /** Override localStorage for tests. Pass null to disable LS mirror. */
  storage?: EpisodicStorageLike | null;
  /** Override IDB get. Pass a stub for tests. */
  getMemoryFn?: <T>(key: string) => Promise<T | null>;
  /** Override IDB put. Pass a stub for tests. */
  putMemoryFn?: <T>(key: string, value: T) => Promise<void>;
  /** Override Date.now() for deterministic timestamps in tests. */
  now?: () => number;
  /**
   * Override minimum cosine similarity for analog qualification.
   * When set, bypasses the tunable-params-store read so tests stay pure
   * (no localStorage access). Production reads from the tunable store
   * at call time via getTunedParam('episodic-analog', 'minSim', 0.45).
   */
  minSim?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'crystalball-cognition-episodic-v1';
const MAX_EPISODES = 2_000;
const DEFAULT_K = 5;
/** Default minSim — the hardcoded value before this was made tunable.
 *  Production reads from tunable-params-store at call time. Tests inject
 *  via configureForTests({ minSim }) to avoid touching localStorage. */
const DEFAULT_MIN_SIM = 0.45;
const MIN_RECALLS_FOR_ANALOG = 3;
const EVENT_NAME = 'cb:episodic-recall';
/** Dedupe window: same signature + same kind within this many ms → update existing, no new insert. */
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 h

// ── Module-level singleton state ──────────────────────────────────────────────

const episodes: Episode[] = [];
let loaded = false;
let writtenSinceLoad = false;

// Injected overrides (populated by createEpisodicMemory for tests).
let _storage: EpisodicStorageLike | null | undefined = undefined; // undefined = use globalThis.localStorage
let _getMemoryOverride: (<T>(key: string) => Promise<T | null>) | null = null;
let _putMemoryOverride: (<T>(key: string, value: T) => Promise<void>) | null = null;
let _nowFn: (() => number) = Date.now;
/** Injected minSim override (tests only). undefined = read from tunable store. */
let _minSimOverride: number | undefined = undefined;

/** Current effective minSim — reads from the tunable store unless overridden by tests. */
function effectiveMinSim(): number {
  if (_minSimOverride !== undefined) return _minSimOverride;
  return getTunedParam('episodic-analog', 'minSim', DEFAULT_MIN_SIM);
}

// ── ID generation ─────────────────────────────────────────────────────────────

let _idCounter = 0;
function genId(nowMs: number): string {
  _idCounter += 1;
  return `ep-${nowMs.toString(36)}-${_idCounter.toString(36)}`;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function resolveStorage(): EpisodicStorageLike | null {
  if (_storage !== undefined) return _storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as unknown as Record<string, unknown>).localStorage as EpisodicStorageLike | undefined;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function applyLoaded(arr: Episode[] | null): void {
  if (!Array.isArray(arr)) return;
  episodes.length = 0;
  for (const ep of arr) {
    if (isValidEpisode(ep)) episodes.push(ep);
  }
}

function isValidEpisode(ep: unknown): ep is Episode {
  if (!ep || typeof ep !== 'object') return false;
  const e = ep as Record<string, unknown>;
  return typeof e['id'] === 'string' &&
    typeof e['summary'] === 'string' &&
    typeof e['createdAt'] === 'number' &&
    Array.isArray(e['vector']);
}

function load(): void {
  if (loaded) return;
  loaded = true;
  const stor = resolveStorage();
  if (stor) {
    try {
      const raw = stor.getItem(STORAGE_KEY);
      if (raw) applyLoaded(JSON.parse(raw) as Episode[]);
    } catch { /* ignore */ }
  }
  const getMemFn: (key: string) => Promise<Episode[] | null> = _getMemoryOverride
    ? (key) => (_getMemoryOverride as (k: string) => Promise<Episode[] | null>)(key)
    : (key) => { lazyLoadIdb(); return _getMemory!<Episode[]>(key); };
  void getMemFn(STORAGE_KEY).then((arr) => {
    if (writtenSinceLoad) return;
    applyLoaded(arr);
  });
}

function save(): void {
  writtenSinceLoad = true;
  const stor = resolveStorage();
  if (stor) {
    try { stor.setItem(STORAGE_KEY, JSON.stringify(episodes)); } catch { /* quota */ }
  }
  const putMemFn = _putMemoryOverride ?? ((key: string, value: unknown) => { lazyLoadIdb(); return _putMemory!<unknown>(key, value); });
  void putMemFn(STORAGE_KEY, episodes);
}

// ── FIFO eviction (resolved-oldest first, never evict pending) ─────────────────

function evict(): void {
  if (episodes.length <= MAX_EPISODES) return;
  // Sort: resolved episodes (resolvedAt set) before pending, oldest first within each group.
  // We only evict from resolved; if all are pending we still cap at MAX_EPISODES by dropping oldest pending.
  const resolved = episodes
    .map((ep, i) => ({ ep, i }))
    .filter(({ ep }) => ep.resolvedAt !== undefined)
    .sort((a, b) => (a.ep.resolvedAt! - b.ep.resolvedAt!));

  const toEvict = episodes.length - MAX_EPISODES;
  const evictSet = new Set<number>();

  // Evict oldest resolved first.
  for (let j = 0; j < Math.min(toEvict, resolved.length); j++) {
    const item = resolved[j];
    if (item !== undefined) evictSet.add(item.i);
  }

  // If still over cap (all unresolved), evict oldest by createdAt.
  if (evictSet.size < toEvict) {
    const pendingEps = episodes
      .map((ep, i) => ({ ep, i }))
      .filter(({ i }) => !evictSet.has(i))
      .sort((a, b) => a.ep.createdAt - b.ep.createdAt);
    for (let j = 0; evictSet.size < toEvict && j < pendingEps.length; j++) {
      const item = pendingEps[j];
      if (item !== undefined) evictSet.add(item.i);
    }
  }

  // Build new array without evicted indices.
  for (let i = episodes.length - 1; i >= 0; i--) {
    if (evictSet.has(i)) episodes.splice(i, 1);
  }
}

// ── Explanation builder (plan invariant) ──────────────────────────────────────

/**
 * Build a human-readable explanation of why an episode matched the query.
 * Lists overlapping entities and domains between query context and the episode.
 */
function buildExplanation(
  episode: Episode,
  queryEntities: string[],
  queryDomains: string[],
  similarity: number,
): string {
  const overlapEntities = queryEntities.filter(e =>
    episode.entities.some(ee => ee.toLowerCase() === e.toLowerCase()),
  );
  const overlapDomains = queryDomains.filter(d =>
    episode.domains.some(ed => ed.toLowerCase() === d.toLowerCase()),
  );

  const parts: string[] = [];
  if (overlapEntities.length > 0) parts.push(`entities: ${overlapEntities.join(', ')}`);
  if (overlapDomains.length > 0) parts.push(`domains: ${overlapDomains.join(', ')}`);

  const simPct = (similarity * 100).toFixed(0);
  const outcomeStr = episode.outcome ? `; outcome: ${episode.outcome}` : '';
  if (parts.length === 0) {
    return `${simPct}% semantic similarity${outcomeStr}`;
  }
  return `matched on: ${parts.join('; ')} (${simPct}% similarity${outcomeStr})`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Record a new episode. The text is embedded (hashed tier in sync path,
 * neural if sidecar is available). Suppressed when Ghost Mode is active.
 *
 * Returns the fully created Episode (including id, vector, tier).
 */
export async function recordEpisode(
  input: Omit<Episode, 'id' | 'vector' | 'tier'>,
): Promise<Episode> {
  if (isGhostMode()) {
    // Return a non-persisted stub so callers don't crash.
    return {
      ...input,
      id: `ep-ghost-${Date.now()}`,
      vector: [],
      tier: 'hashed',
    };
  }

  load();

  const summary = input.summary.slice(0, 500);
  const embResult = await embed(summary);

  const nowMs = _nowFn();
  const episode: Episode = {
    ...input,
    id: genId(nowMs),
    summary,
    vector: Array.from(embResult.vector),
    tier: embResult.tier,
  };

  // Deduplicate by signature + kind within 24 h window (PR 14 memory hygiene).
  // Same signature + same kind within DEDUPE_WINDOW_MS → update existing episode
  // (refresh summary if changed) instead of inserting a duplicate.
  if (episode.signature) {
    const dedupeCutoff = nowMs - DEDUPE_WINDOW_MS;
    const existing = episodes.find(ep =>
      ep.signature === episode.signature &&
      ep.kind === episode.kind &&
      ep.resolvedAt === undefined &&
      ep.createdAt >= dedupeCutoff,
    );
    if (existing !== undefined) {
      // Already tracking a recent pending episode with this signature+kind.
      // Update the summary if it changed (embedding stays from original insert).
      if (existing.summary !== episode.summary) {
        existing.summary = episode.summary;
        save();
      }
      return existing;
    }
  }

  episodes.push(episode);
  evict();
  save();
  return episode;
}

/**
 * Mark an episode as resolved with an outcome and optional note.
 * Suppressed when Ghost Mode is active.
 */
export async function resolveEpisode(
  id: string,
  outcome: Episode['outcome'],
  note?: string,
): Promise<void> {
  if (isGhostMode()) return;
  load();
  const ep = episodes.find(e => e.id === id);
  if (!ep) return;
  ep.resolvedAt = _nowFn();
  ep.outcome = outcome;
  if (note !== undefined) ep.outcomeNote = note.slice(0, 280);

  // Lazily try to upgrade hashed → neural embedding now that we have time.
  if (ep.tier === 'hashed') {
    void maybeUpgradeEmbedding('hashed', ep.summary).then(upgraded => {
      if (upgraded && ep.tier === 'hashed') {
        ep.vector = Array.from(upgraded.vector);
        ep.tier = upgraded.tier;
        save();
      }
    });
  }

  save();
}

/**
 * Mark an episode as contradictory — its hypothesis was refuted by
 * competitive-hypothesis resolution.
 *
 * PR 14 — memory hygiene entry point. The episode remains in the store
 * and is retrievable via recall() (contradictions surface, never silently
 * dropped — plan invariant). Its `contradictory` flag is set to true so
 * analogScoreFor() excludes it from supportive analog scoring by default.
 *
 * Accepts either an episode id or a signature string. When a signature is
 * passed, all matching unresolved episodes are marked.
 *
 * Wiring: expose this entry point here. Clean hook wiring from
 * competitive-hypothesis.ts lands with PR 6/12 (no ugly injection forced
 * in this PR — the API is available for that wiring to plug into).
 *
 * Not suppressed by Ghost Mode: contradictory marking is a correctness
 * operation on existing state, not a new learning write.
 */
export function markEpisodeContradictory(
  idOrSignature: string,
  reason?: string,
): number {
  load();
  let marked = 0;
  for (const ep of episodes) {
    if (ep.id === idOrSignature || ep.signature === idOrSignature) {
      ep.contradictory = true;
      if (reason !== undefined) ep.contradictoryReason = reason.slice(0, 280);
      marked += 1;
    }
  }
  if (marked > 0) save();
  return marked;
}

/**
 * Recall top-K semantically similar past episodes to the given text.
 * Emits a `cb:episodic-recall` event on window when results are non-empty.
 *
 * Opts:
 *   k                    - max results (default 5)
 *   kinds                - filter by episode kind
 *   excludeContradictory - (PR 14, default true) when true, contradictory episodes
 *                          are still included in the recall results (full visibility,
 *                          plan invariant: contradictions surface, never silently dropped)
 *                          but are flagged recall.contradictory = true. analogScoreFor()
 *                          respects this flag and excludes them from scoring.
 */
export async function recall(
  text: string,
  opts?: { k?: number; kinds?: Episode['kind'][]; excludeContradictory?: boolean },
): Promise<Recall[]> {
  load();

  const k = opts?.k ?? DEFAULT_K;
  const embResult = await embed(text.slice(0, 500));

  const queryVec: IndexedVector = {
    id: '__query__',
    vector: embResult.vector,
    tier: embResult.tier,
  };

  let corpus = episodes;
  if (opts?.kinds && opts.kinds.length > 0) {
    const kindsSet = new Set(opts.kinds);
    corpus = episodes.filter(ep => kindsSet.has(ep.kind));
  }

  const corpusVecs: IndexedVector[] = corpus.map(ep => ({
    id: ep.id,
    vector: new Float32Array(ep.vector),
    tier: ep.tier,
  }));

  const results = topK(queryVec, corpusVecs, k, effectiveMinSim());

  // Extract query entities/domains for explanation (heuristic: parse from text).
  // In real wiring these come from hypothesis-entities; here we approximate.
  const queryTokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2);

  const recalls: Recall[] = results.flatMap(({ id, similarity }) => {
    const ep = episodes.find(e => e.id === id);
    if (ep === undefined) return []; // topK returned an id that's no longer in store (race)
    const nowMs = _nowFn();
    const ageDays = (nowMs - ep.createdAt) / (1000 * 60 * 60 * 24);
    const explanation = buildExplanation(ep, queryTokens, [], similarity);
    const contradictory = ep.contradictory === true;
    return [{ episode: ep, similarity, ageDays, explanation, ...(contradictory ? { contradictory: true } : {}) }];
  });

  if (recalls.length > 0 && typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { recalls, text } }));
    } catch { /* non-browser environments */ }
  }

  return recalls;
}

/**
 * Recall with explicit query entities and domains for richer explanation strings.
 * Preferred over bare recall() when called from analyst-loop where entity
 * extraction results are available.
 */
export async function recallWithContext(
  text: string,
  queryEntities: string[],
  queryDomains: string[],
  opts?: { k?: number; kinds?: Episode['kind'][] },
): Promise<Recall[]> {
  load();

  const k = opts?.k ?? DEFAULT_K;
  const embResult = await embed(text.slice(0, 500));

  const queryVec: IndexedVector = {
    id: '__query__',
    vector: embResult.vector,
    tier: embResult.tier,
  };

  let corpus = episodes;
  if (opts?.kinds && opts.kinds.length > 0) {
    const kindsSet = new Set(opts.kinds);
    corpus = episodes.filter(ep => kindsSet.has(ep.kind));
  }

  const corpusVecs: IndexedVector[] = corpus.map(ep => ({
    id: ep.id,
    vector: new Float32Array(ep.vector),
    tier: ep.tier,
  }));

  const results = topK(queryVec, corpusVecs, k, effectiveMinSim());

  const recalls: Recall[] = results.flatMap(({ id, similarity }) => {
    const ep = episodes.find(e => e.id === id);
    if (ep === undefined) return [];
    const nowMs = _nowFn();
    const ageDays = (nowMs - ep.createdAt) / (1000 * 60 * 60 * 24);
    const explanation = buildExplanation(ep, queryEntities, queryDomains, similarity);
    const contradictory = ep.contradictory === true;
    return [{ episode: ep, similarity, ageDays, explanation, ...(contradictory ? { contradictory: true } : {}) }];
  });

  if (recalls.length > 0 && typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { recalls, text } }));
    } catch { /* non-browser environments */ }
  }

  return recalls;
}

/**
 * Similarity-weighted materialization rate of the top-K recalls.
 *
 * Returns null when fewer than MIN_RECALLS_FOR_ANALOG (3) recalls clear
 * minSim = 0.45 — not enough history to compute a meaningful analog score.
 *
 * Otherwise returns a value in [0, 1] representing how often similar past
 * situations materialized, weighted by their similarity to the current query.
 * This is the value forecastHypothesis(..., analogScore, ...) was designed to receive.
 *
 * PR 14 — memory hygiene: by default, episodes flagged as contradictory
 * (hypothesis refuted by competitive-hypothesis resolution) are excluded from
 * scoring. They remain visible in recall results (contradictions surface, never
 * silently dropped — plan invariant), but do not contribute to the analog score
 * since their materialization outcome is misleading (the hypothesis was refuted,
 * not confirmed). Pass excludeContradictory: false to include them.
 *
 * Plan invariant: every score has an explanation. The explanation is embedded
 * in each Recall's `explanation` field; the caller can surface it in the HUD.
 */
export function analogScoreFor(
  recalls: readonly Recall[],
  opts?: { excludeContradictory?: boolean },
): number | null {
  const excludeContradictory = opts?.excludeContradictory !== false; // default: true
  const qualified = recalls.filter(r =>
    r.similarity >= effectiveMinSim() &&
    r.episode.outcome !== undefined &&
    (!excludeContradictory || !r.contradictory),
  );
  if (qualified.length < MIN_RECALLS_FOR_ANALOG) return null;

  let weightedSum = 0;
  let totalWeight = 0;
  for (const r of qualified) {
    const weight = r.similarity;
    const materialized = r.episode.outcome === 'materialized' ? 1
      : r.episode.outcome === 'partial' ? 0.5
      : 0; // fizzled | unknown → 0
    weightedSum += weight * materialized;
    totalWeight += weight;
  }

  if (totalWeight === 0) return null;
  return weightedSum / totalWeight;
}

// ── Accessors (for wiring + debug) ───────────────────────────────────────────

/** Return all episodes (read-only copy). */
export function getAllEpisodes(): readonly Episode[] {
  load();
  return [...episodes];
}

/** Return episode count. */
export function getEpisodeCount(): number {
  load();
  return episodes.length;
}

/** Return a single episode by id, or null. */
export function getEpisodeById(id: string): Episode | null {
  load();
  return episodes.find(ep => ep.id === id) ?? null;
}

// ── Injectable factory (for tests) ───────────────────────────────────────────

/**
 * Configure the module-level singleton with test-friendly overrides.
 * Call this before importing the module in tests, or call resetForTests()
 * first to clear any accumulated state.
 */
export function configureForTests(opts: EpisodicMemoryOptions): void {
  _storage = opts.storage !== undefined ? opts.storage : undefined;
  _getMemoryOverride = opts.getMemoryFn ?? null;
  _putMemoryOverride = opts.putMemoryFn ?? null;
  _nowFn = opts.now ?? Date.now;
  _minSimOverride = opts.minSim;
}

/** Reset module state for test isolation. */
export function resetForTests(): void {
  episodes.length = 0;
  loaded = false;
  writtenSinceLoad = false;
  _storage = undefined;
  _getMemoryOverride = null;
  _putMemoryOverride = null;
  _nowFn = Date.now;
  _idCounter = 0;
  _minSimOverride = undefined;
}

// ── Module-level analog score cache (for sync forecastAll callers) ────────────

/**
 * Module-level cache: signature → last computed analog score.
 * Updated asynchronously by updateAnalogCache() each analyst cycle.
 * Read synchronously by forecastAll() without converting its sync call chain.
 *
 * This pattern (async update + sync read) avoids converting forecastAll's
 * sync signature to async, which would be invasive across many call sites.
 * The cache is at most one analyst cycle (5 min) stale. Documented here per
 * plan: "if forecastAll's sync signature makes this invasive, instead maintain
 * a module-level cached analog map updated asynchronously each analyst cycle
 * and read synchronously in forecastAll."
 */
const _analogCache = new Map<string, number | null>();

/** Read the cached analog score for a given signature synchronously. */
export function getCachedAnalogScore(signature: string): number | null {
  return _analogCache.get(signature) ?? null;
}

/**
 * Update the analog score cache for a set of hypotheses.
 * Called asynchronously from analyst-loop after each cycle.
 */
export async function updateAnalogCache(
  hypotheses: Array<{ statement: string; id: string }>,
  getSignature: (h: { statement: string; id: string }) => string,
): Promise<void> {
  for (const h of hypotheses) {
    try {
      const recalls = await recall(h.statement, { kinds: ['hypothesis'] });
      const score = analogScoreFor(recalls);
      _analogCache.set(getSignature(h), score);
    } catch {
      // Never let cache update crash the loop.
    }
  }
}

/** Clear analog cache (for tests). */
export function _clearAnalogCacheForTests(): void {
  _analogCache.clear();
}
