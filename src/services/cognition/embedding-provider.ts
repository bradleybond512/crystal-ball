/**
 * Embedding Provider — two-tier, local-first embedding adapter.
 *
 * Tier 1 (neural): POST /api/intel-embed (sidecar) → Ollama nomic-embed-text
 *   (768-dim). 10s timeout. Returns 503 when Ollama is absent.
 *
 * Tier 2 (hashed): deterministic 256-dim djb2 hashed bag-of-words embedder,
 *   L2-normalized. Fully offline, test-stable, and used as fallback when the
 *   sidecar is unreachable or returns non-OK.
 *
 * Embedding cache (PR 14):
 *   content-hash (djb2 over normalized text) → vector memoization.
 *   Persisted via reasoning-memory key crystalball-cognition-embed-cache-v1.
 *   Cap 5000 entries; eviction is LRU-ish (evict oldest-accessed when over cap).
 *   Tier safety: a cached hashed-tier vector is NEVER served when neural is
 *   requested/available — on tier upgrade the cache entry is a miss and the
 *   new neural result replaces the old hashed entry.
 *
 * Vectors of different tiers are never compared against each other — the
 * vector-index partitions by tier. When Ollama appears, new episodes get
 * neural vectors; old hashed episodes are lazily re-embedded on access
 * (max 20 per session) to avoid a migration stampede.
 *
 * Pure module: no DOM, no globals at import time. Fetch is guarded behind
 * an async function; tests import embedHashed directly.
 */

import { getApiBaseUrl, isDesktopRuntime } from '@/services/runtime';

// ── Public types ──────────────────────────────────────────────────────────────

export interface EmbeddingResult {
  vector: Float32Array;
  tier: 'neural' | 'hashed';
  dim: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EMBED_ENDPOINT = '/api/intel-embed';
const EMBED_TIMEOUT_MS = 10_000;
const HASHED_DIM = 256;
const NEURAL_DIM = 768; // nomic-embed-text default

// ── Embedding cache (PR 14) ───────────────────────────────────────────────────

const EMBED_CACHE_KEY = 'crystalball-cognition-embed-cache-v1';
const EMBED_CACHE_CAP = 5_000;

interface CacheEntry {
  vector: number[];
  tier: 'neural' | 'hashed';
  dim: number;
  lastAccessed: number;
}

/** In-memory cache: content-hash string → CacheEntry. */
const _embedCache = new Map<string, CacheEntry>();
let _cacheLoaded = false;
let _cacheWrittenSinceLoad = false;

/** IDB access (lazy) — same pattern as episodic-memory.ts. */
let _getMemCache: (<T>(key: string) => Promise<T | null>) | null = null;
let _putMemCache: (<T>(key: string, value: T) => Promise<void>) | null = null;

function lazyLoadCacheIdb(): void {
  if (_getMemCache !== null) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@/services/reasoning-memory') as {
      getMemory: <T>(key: string) => Promise<T | null>;
      putMemory: <T>(key: string, value: T) => Promise<void>;
    };
    _getMemCache = mod.getMemory;
    _putMemCache = mod.putMemory;
  } catch {
    _getMemCache = async () => null;
    _putMemCache = async () => undefined;
  }
}

/**
 * djb2 content hash for a normalized text string → stable cache key.
 * Normalization: lowercase, collapse whitespace, trim.
 */
function contentHash(text: string): string {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  let h = 5381;
  for (let i = 0; i < normalized.length; i++) {
    // eslint-disable-next-line no-bitwise
    h = (((h << 5) + h) + normalized.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

function loadCache(): void {
  if (_cacheLoaded) return;
  _cacheLoaded = true;
  // Bootstrap from IDB asynchronously (same loaded/writtenSinceLoad guard).
  lazyLoadCacheIdb();
  void _getMemCache!<Record<string, CacheEntry>>(EMBED_CACHE_KEY).then((stored) => {
    if (_cacheWrittenSinceLoad || !stored || typeof stored !== 'object') return;
    for (const [k, v] of Object.entries(stored)) {
      if (Array.isArray(v?.vector) && typeof v?.tier === 'string') {
        _embedCache.set(k, v as CacheEntry);
      }
    }
  });
}

function saveCache(): void {
  _cacheWrittenSinceLoad = true;
  lazyLoadCacheIdb();
  const obj: Record<string, CacheEntry> = {};
  for (const [k, v] of _embedCache) obj[k] = v;
  void _putMemCache!<Record<string, CacheEntry>>(EMBED_CACHE_KEY, obj);
}

/** Evict oldest-accessed entries when over cap. */
function evictCacheIfNeeded(): void {
  if (_embedCache.size <= EMBED_CACHE_CAP) return;
  const sorted = [..._embedCache.entries()].sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
  const toRemove = _embedCache.size - EMBED_CACHE_CAP;
  for (let i = 0; i < toRemove; i++) {
    if (sorted[i]) _embedCache.delete(sorted[i]![0]);
  }
}

/**
 * Look up a cached embedding. Returns null on miss or tier mismatch.
 * Tier safety: if the stored tier is 'hashed' but the caller is requesting
 * 'neural' (i.e. neural is now available), treat as a miss so the neural
 * result replaces the stale hashed entry.
 */
function cacheGet(hash: string, requestedTier: 'neural' | 'hashed' | 'any'): EmbeddingResult | null {
  loadCache();
  const entry = _embedCache.get(hash);
  if (!entry) return null;
  // Tier-upgrade miss: never serve hashed when neural is requested.
  if (requestedTier === 'neural' && entry.tier === 'hashed') return null;
  entry.lastAccessed = Date.now();
  return { vector: new Float32Array(entry.vector), tier: entry.tier, dim: entry.dim };
}

function cacheSet(hash: string, result: EmbeddingResult): void {
  _embedCache.set(hash, {
    vector: Array.from(result.vector),
    tier: result.tier,
    dim: result.dim,
    lastAccessed: Date.now(),
  });
  evictCacheIfNeeded();
  saveCache();
}

// ── Cache injection for tests ─────────────────────────────────────────────────

/** Reset the embed cache (tests). */
export function _resetEmbedCacheForTests(): void {
  _embedCache.clear();
  _cacheLoaded = false;
  _cacheWrittenSinceLoad = false;
  _getMemCache = null;
  _putMemCache = null;
}

/** Expose cache size for assertions (tests). */
export function _getEmbedCacheSize(): number {
  return _embedCache.size;
}

/** Inject a cache entry for tests (tier-aware miss testing). */
export function _injectCacheEntry(text: string, result: EmbeddingResult): void {
  const hash = contentHash(text);
  cacheSet(hash, result);
}

// ── Hashed embedder (deterministic, offline) ──────────────────────────────────

/**
 * djb2 hash — maps a string token to a bucket index [0, buckets).
 * Pure arithmetic: no dependencies, no globals.
 */
function djb2(token: string, buckets: number): number {
  let h = 5381;
  for (let i = 0; i < token.length; i++) {
    // eslint-disable-next-line no-bitwise
    h = ((h << 5) + h + token.charCodeAt(i)) >>> 0;
  }
  return h % buckets;
}

/**
 * Tokenize text: lowercase, split on non-alphanumeric, discard empty tokens.
 * Deterministic — same text always produces the same token list.
 */
function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 0);
}

/**
 * L2-normalize a float vector in-place. No-op when norm is 0 to avoid NaN.
 */
function l2NormalizeInPlace(vec: Float32Array): void {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += (vec[i] ?? 0) * (vec[i] ?? 0);
  norm = Math.sqrt(norm);
  if (norm === 0) return;
  for (let i = 0; i < vec.length; i++) { const v = vec[i] ?? 0; vec[i] = v / norm; }
}

/**
 * Deterministic hashed bag-of-words embedder, 256-dim, L2-normalized.
 * Exported separately for tests and sync callers; used as the fallback
 * when the sidecar is unavailable.
 *
 * Quality is below neural embeddings but it is deterministic, offline,
 * and fully test-stable — all unit tests run against this tier only.
 */
export function embedHashed(text: string): EmbeddingResult {
  const vec = new Float32Array(HASHED_DIM);
  const tokens = tokenize(text);
  for (const token of tokens) {
    const bucket = djb2(token, HASHED_DIM);
    vec[bucket] = (vec[bucket] ?? 0) + 1;
  }
  l2NormalizeInPlace(vec);
  return { vector: vec, tier: 'hashed', dim: HASHED_DIM };
}

// ── Neural embedding via sidecar ──────────────────────────────────────────────

interface EmbedResponseShape {
  vector?: unknown;
  error?: unknown;
}

async function tryNeuralEmbedding(text: string): Promise<EmbeddingResult | null> {
  if (!isDesktopRuntime()) return null;
  const base = getApiBaseUrl();
  if (!base) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${EMBED_ENDPOINT}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json() as EmbedResponseShape;
    if (!Array.isArray(json.vector)) return null;
    const raw = json.vector as number[];
    if (raw.length !== NEURAL_DIM) return null;
    const vec = new Float32Array(raw);
    l2NormalizeInPlace(vec);
    return { vector: vec, tier: 'neural', dim: NEURAL_DIM };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Local-first embedding. Tries the sidecar neural path first; falls back
 * to the deterministic hashed embedder when the sidecar is unavailable or
 * returns a non-OK / malformed response.
 *
 * Embedding cache (PR 14): checks content-hash cache before calling the
 * sidecar or hashed embedder. Cache entries record their tier; a cached
 * hashed-tier entry is treated as a miss when neural is now available
 * (tier-upgrade safety — never serve stale lower-quality vectors when
 * better ones can be computed).
 */
export async function embed(text: string): Promise<EmbeddingResult> {
  const hash = contentHash(text);

  // Check whether neural is likely available (desktop runtime with sidecar).
  // We probe neural first so we know the effective requested tier for the cache lookup.
  const neural = await tryNeuralEmbedding(text);
  if (neural !== null) {
    // Neural succeeded — cache it (replacing any stale hashed entry).
    cacheSet(hash, neural);
    return neural;
  }

  // Neural unavailable — check cache for a hashed-tier hit.
  const cached = cacheGet(hash, 'any');
  if (cached !== null) return cached;

  // Cache miss — compute hashed embedding and cache it.
  const hashed = embedHashed(text);
  cacheSet(hash, hashed);
  return hashed;
}

// ── Lazy re-embed on tier upgrade ─────────────────────────────────────────────

/** Track how many hashed→neural re-embeds have been done this session. */
let _reEmbedThisSession = 0;
const RE_EMBED_SESSION_CAP = 20;

/**
 * If Ollama is now available and this episode still has a hashed vector,
 * re-embed it to neural quality. Capped at 20 per session to prevent a
 * stampede when Ollama first appears.
 *
 * Returns the upgraded EmbeddingResult or null if no upgrade occurred.
 */
export async function maybeUpgradeEmbedding(
  currentTier: 'neural' | 'hashed',
  text: string,
): Promise<EmbeddingResult | null> {
  if (currentTier === 'neural') return null;
  if (_reEmbedThisSession >= RE_EMBED_SESSION_CAP) return null;
  const result = await tryNeuralEmbedding(text);
  if (result === null) return null;
  _reEmbedThisSession += 1;
  return result;
}

/** Reset the session re-embed counter (tests / boot). */
export function _resetReEmbedCounterForTests(): void {
  _reEmbedThisSession = 0;
}
