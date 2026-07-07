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
import { isCognitionEnabled } from './cognition-settings';
import { isGhostMode } from '@/services/mode-manager';
import { getMemory as idbGetMemory, putMemory as idbPutMemory } from '@/services/reasoning-memory';

// getMemory/putMemory are IDB-backed. Statically imported (not require()) so the
// persistence path survives the Vite browser bundle; reasoning-memory itself
// degrades to no-op when IndexedDB is unavailable (pure Node tests).
let _getMemory: (<T>(key: string) => Promise<T | null>) | null = null;
let _putMemory: (<T>(key: string, value: T) => Promise<void>) | null = null;

function lazyLoadIdb(): void {
  if (_getMemory !== null) return;
  _getMemory = idbGetMemory;
  _putMemory = idbPutMemory;
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
}

export interface Recall {
  episode: Episode;
  similarity: number; // 0–1
  ageDays: number;
  /** "matched on: Black Sea, wheat, escalation" — plan invariant: every score has an explanation. */
  explanation: string;
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
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'crystalball-cognition-episodic-v1';
const MAX_EPISODES = 2000;
const DEFAULT_K = 5;
const MIN_SIM = 0.45;
const MIN_RECALLS_FOR_ANALOG = 3;
const EVENT_NAME = 'cb:episodic-recall';

// ── Module-level singleton state ──────────────────────────────────────────────

const episodes: Episode[] = [];
let loaded = false;
let writtenSinceLoad = false;

// Injected overrides (populated by createEpisodicMemory for tests).
let _storage: EpisodicStorageLike | null | undefined = undefined; // undefined = use globalThis.localStorage
let _getMemoryOverride: (<T>(key: string) => Promise<T | null>) | null = null;
let _putMemoryOverride: (<T>(key: string, value: T) => Promise<void>) | null = null;
let _nowFn: (() => number) = Date.now;

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
  return typeof e.id === 'string' &&
    typeof e.summary === 'string' &&
    typeof e.createdAt === 'number' &&
    Array.isArray(e.vector);
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
  // Kill-switch (Settings → Cognition): same non-persisted stub as Ghost
  // Mode so callers don't crash. Fail-safe ON when the setting is unreadable.
  if (isGhostMode() || !isCognitionEnabled('episodic-recall')) {
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
    vector: [...embResult.vector],
    tier: embResult.tier,
  };

  // Deduplicate by signature before insert.
  if (episode.signature) {
    const existing = episodes.find(ep => ep.signature === episode.signature && ep.resolvedAt === undefined);
    if (existing !== undefined) {
      // Already tracking a pending episode with this signature — return it.
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
export function resolveEpisode(
  id: string,
  outcome: Episode['outcome'],
  note?: string,
): Promise<void> {
  if (isGhostMode()) return Promise.resolve();
  load();
  const ep = episodes.find(e => e.id === id);
  if (!ep) return Promise.resolve();
  ep.resolvedAt = _nowFn();
  ep.outcome = outcome;
  if (note !== undefined) ep.outcomeNote = note.slice(0, 280);

  // Lazily try to upgrade hashed → neural embedding now that we have time.
  if (ep.tier === 'hashed') {
    void maybeUpgradeEmbedding('hashed', ep.summary).then(upgraded => {
      if (upgraded && ep.tier === 'hashed') {
        ep.vector = [...upgraded.vector];
        ep.tier = upgraded.tier;
        save();
      }
    });
  }

  save();
  return Promise.resolve();
}

/**
 * Recall top-K semantically similar past episodes to the given text.
 * Emits a `cb:episodic-recall` event on window when results are non-empty.
 *
 * Opts:
 *   k     - max results (default 5)
 *   kinds - filter by episode kind
 */
export async function recall(
  text: string,
  opts?: { k?: number; kinds?: Episode['kind'][] },
): Promise<Recall[]> {
  // Kill-switch (Settings → Cognition): no recalls while episodic recall is
  // off. Downstream analog scores resolve to null (analog boost disabled).
  if (!isCognitionEnabled('episodic-recall')) return [];
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

  const results = topK(queryVec, corpusVecs, k, MIN_SIM);

  // Extract query entities/domains for explanation (heuristic: parse from text).
  // In real wiring these come from hypothesis-entities; here we approximate.
  const queryTokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2);

  const recalls: Recall[] = results.flatMap(({ id, similarity }) => {
    const ep = episodes.find(e => e.id === id);
    if (ep === undefined) return []; // topK returned an id that's no longer in store (race)
    const nowMs = _nowFn();
    const ageDays = (nowMs - ep.createdAt) / (1000 * 60 * 60 * 24);
    const explanation = buildExplanation(ep, queryTokens, [], similarity);
    return [{ episode: ep, similarity, ageDays, explanation }];
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
  // Kill-switch (Settings → Cognition) — see recall().
  if (!isCognitionEnabled('episodic-recall')) return [];
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

  const results = topK(queryVec, corpusVecs, k, MIN_SIM);

  const recalls: Recall[] = results.flatMap(({ id, similarity }) => {
    const ep = episodes.find(e => e.id === id);
    if (ep === undefined) return [];
    const nowMs = _nowFn();
    const ageDays = (nowMs - ep.createdAt) / (1000 * 60 * 60 * 24);
    const explanation = buildExplanation(ep, queryEntities, queryDomains, similarity);
    return [{ episode: ep, similarity, ageDays, explanation }];
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
 * Plan invariant: every score has an explanation. The explanation is embedded
 * in each Recall's `explanation` field; the caller can surface it in the HUD.
 */
/** Map an episode outcome to a materialization weight in [0, 1]. */
function materializationWeight(outcome: Episode['outcome']): number {
  if (outcome === 'materialized') return 1;
  if (outcome === 'partial') return 0.5;
  return 0; // fizzled | unknown → 0
}

export function analogScoreFor(recalls: readonly Recall[]): number | null {
  const qualified = recalls.filter(r => r.similarity >= MIN_SIM && r.episode.outcome !== undefined);
  if (qualified.length < MIN_RECALLS_FOR_ANALOG) return null;

  let weightedSum = 0;
  let totalWeight = 0;
  for (const r of qualified) {
    const weight = r.similarity;
    const materialized = materializationWeight(r.episode.outcome);
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
  _storage = opts.storage === undefined ? undefined : opts.storage;
  _getMemoryOverride = opts.getMemoryFn ?? null;
  _putMemoryOverride = opts.putMemoryFn ?? null;
  _nowFn = opts.now ?? Date.now;
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
  hypotheses: { statement: string; id: string }[],
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
