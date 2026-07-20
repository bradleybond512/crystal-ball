/**
 * Embedding Cache — content-hash → vector memo (PR 14: Compute Placement +
 * Hygiene).
 *
 * Wraps `embed()` from embedding-provider.ts with an in-memory memo keyed
 * by a fast content hash of the input text so identical text is never
 * re-embedded twice — saves the network round-trip to the neural tier (up
 * to EMBED_TIMEOUT_MS on a cold miss) and the hashed-tier recompute alike.
 *
 * The two hot repeated-text paths this targets:
 *   - episodic-memory.recall()/recallWithContext(): analyst-loop calls
 *     recall() with the same still-unresolved hypothesis statement every
 *     ~5-minute cycle until it resolves.
 *   - episodic-memory.recordEpisode(): the signature-dedupe check happens
 *     *after* embed() is awaited, so a standing pending hypothesis
 *     re-embeds its own summary every cycle just to be discarded by the
 *     dedupe match.
 *
 * Persistence: getMemory/putMemory (IDB reasoning_memory store) with a
 * localStorage bootstrap mirror, following the loaded/writtenSinceLoad
 * guard pattern used across cognition/ (episodic-memory.ts, consolidation.ts).
 * The actual write is a full-cache JSON.stringify (O(cache size), can run
 * into the hundreds of milliseconds near the 5,000-entry cap at real
 * embedding dimensions), so it is never called synchronously from
 * cachedEmbed() — scheduleSave() defers it through idle-scheduler.ts and
 * coalesces any misses that land before the deferred flush actually runs
 * into that single write, so a burst of misses costs one serialize, not N.
 *

 * Trade-off (documented, not hidden): a cache hit freezes whichever tier
 * resolved at write time. If Ollama comes online after a hashed-tier entry
 * is cached, repeat queries of that exact text keep serving the hashed
 * vector until the entry is evicted. This is acceptable for the ephemeral
 * query-embedding use case above; per-episode tier upgrades remain the
 * job of `maybeUpgradeEmbedding()` in embedding-provider.ts, which this
 * cache does not touch.
 *
 * Pure-ish module: no DOM/fetch at import time; every side effect is
 * injectable for tests.
 */

import { embed } from './embedding-provider';
import type { EmbeddingResult } from './embedding-provider';
import { getMemory as idbGetMemory, putMemory as idbPutMemory } from '@/services/reasoning-memory';
import { scheduleIdleWork } from './idle-scheduler';
import type { ScheduleIdleWorkOptions } from './idle-scheduler';

// getMemory/putMemory are IDB-backed. Statically imported (not require()) so
// the persistence path survives the Vite browser bundle; reasoning-memory
// degrades to no-op when IndexedDB is unavailable (pure Node tests).
let _getMemory: (<T>(key: string) => Promise<T | null>) | null = null;
let _putMemory: (<T>(key: string, value: T) => Promise<void>) | null = null;

function lazyLoadIdb(): void {
  if (_getMemory !== null) return;
  _getMemory = idbGetMemory;
  _putMemory = idbPutMemory;
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface EmbeddingCacheStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface EmbeddingCacheOptions {
  /** Override localStorage for tests. Pass null to disable the LS mirror. */
  storage?: EmbeddingCacheStorageLike | null;
  /** Override IDB get for tests. */
  getMemoryFn?: <T>(key: string) => Promise<T | null>;
  /** Override IDB put for tests. */
  putMemoryFn?: <T>(key: string, value: T) => Promise<void>;
  /** Override the underlying embed() call for tests. */
  embedFn?: (text: string) => Promise<EmbeddingResult>;
  /**
   * Override the deferred-save scheduler for tests. Defaults to the real
   * scheduleIdleWork() (idle-time / setTimeout(0) fallback). Tests pass a
   * synchronous `(task) => task()` to make persistence assertions
   * deterministic without waiting on a real tick.
   */
  scheduleIdleWorkFn?: (task: () => void, opts?: ScheduleIdleWorkOptions) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'crystalball-cognition-embed-cache-v1';
export const MAX_CACHE_ENTRIES = 5000;

interface SerializedEntry { vector: number[]; tier: 'neural' | 'hashed'; dim: number }

// ── Module-level singleton state ────────────────────────────────────────────
// Map insertion order doubles as recency order: every hit re-inserts the key
// at the end, so the first key in iteration order is always the LRU victim.

const _cache = new Map<string, SerializedEntry>();
let _loaded = false;
let _writtenSinceLoad = false;

let _storageOverride: EmbeddingCacheStorageLike | null | undefined;
let _getMemoryOverride: (<T>(key: string) => Promise<T | null>) | null = null;
let _putMemoryOverride: (<T>(key: string, value: T) => Promise<void>) | null = null;
let _scheduleOverride: ((task: () => void, opts?: ScheduleIdleWorkOptions) => void) | null = null;

// Coalesce every miss in a burst into a single deferred full-cache
// serialize: save() is O(cache size) (a full JSON.stringify), so calling it
// synchronously on every miss would reintroduce exactly the main-thread-
// blocking cost this PR's idle-scheduler exists to eliminate. `_dirty`
// tracks whether the in-memory cache has changed since the last flush;
// only the first scheduled flush to actually run performs the write, and
// it always reads the *current* live cache (never a stale snapshot), so
// any misses that land between scheduling and flushing are captured too.
let _dirty = false;

// ── Content hash (fast, non-cryptographic — collisions serve a plausible
//    wrong vector, never crash; same acceptance as the djb2 bucket hashing
//    in embedding-provider.ts) ────────────────────────────────────────────────

function hashText(text: string): string {
  let h1 = 0xDE_AD_BE_EF ^ text.length;
  let h2 = 0x41_C6_CE_57 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const ch = text.codePointAt(i) ?? 0;
    h1 = Math.imul(h1 ^ ch, 2_654_435_761);
    h2 = Math.imul(h2 ^ ch, 1_597_334_677);
  }
  h1 = (Math.imul(h1 ^ (h1 >>> 16), 2_246_822_507) ^ Math.imul(h2 ^ (h2 >>> 13), 3_266_489_909)) >>> 0;
  h2 = (Math.imul(h2 ^ (h2 >>> 16), 2_246_822_507) ^ Math.imul(h1 ^ (h1 >>> 13), 3_266_489_909)) >>> 0;
  return `${h1.toString(36)}${h2.toString(36)}`;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function resolveStorage(injected: EmbeddingCacheStorageLike | null | undefined): EmbeddingCacheStorageLike | null {
  if (injected !== undefined) return injected;
  if (_storageOverride !== undefined) return _storageOverride;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as unknown as Record<string, unknown>).localStorage as EmbeddingCacheStorageLike | undefined;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function isValidEntry(e: unknown): e is SerializedEntry {
  if (!e || typeof e !== 'object') return false;
  const s = e as Record<string, unknown>;
  return Array.isArray(s.vector) && (s.tier === 'neural' || s.tier === 'hashed') && typeof s.dim === 'number';
}

function applyLoaded(raw: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (isValidEntry(entry) && !_cache.has(key)) _cache.set(key, entry);
  }
}

function load(storage: EmbeddingCacheStorageLike | null): void {
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
  void getMemFn(STORAGE_KEY).then((raw) => {
    if (_writtenSinceLoad) return;
    applyLoaded(raw);
  });
}

function save(storage: EmbeddingCacheStorageLike | null): void {
  _writtenSinceLoad = true;
  const obj: Record<string, SerializedEntry> = {};
  for (const [k, v] of _cache) obj[k] = v;
  if (storage) {
    try { storage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch { /* quota */ }
  }
  const putMemFn = _putMemoryOverride
    ?? ((key: string, value: unknown) => { lazyLoadIdb(); return _putMemory!<unknown>(key, value); });
  void putMemFn(STORAGE_KEY, obj);
}

/**
 * Defer the full-cache serialize to idle time, coalescing any number of
 * misses that land before the flush actually runs into one write.
 */
function scheduleSave(
  storage: EmbeddingCacheStorageLike | null,
  scheduleFn: (task: () => void, opts?: ScheduleIdleWorkOptions) => void,
): void {
  _dirty = true;
  scheduleFn(() => {
    if (!_dirty) return; // an earlier-scheduled flush already wrote this state
    _dirty = false;
    save(storage);
  });
}

function touch(key: string, entry: SerializedEntry): void {
  _cache.delete(key);
  _cache.set(key, entry);
}

function evictOverCap(): number {
  let evicted = 0;
  while (_cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = _cache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    _cache.delete(oldestKey);
    evicted += 1;
  }
  return evicted;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Content-hash memoized embed(). On a cache hit, returns a fresh
 * Float32Array copy of the memoized vector without calling embed() at all.
 * On a miss, delegates to embed() (or the injected embedFn), stores the
 * result, and evicts the least-recently-used entry when over the 5,000 cap.
 */
export async function cachedEmbed(
  text: string,
  opts: EmbeddingCacheOptions = {},
): Promise<EmbeddingResult> {
  const storage = resolveStorage(opts.storage);
  if (opts.getMemoryFn !== undefined) _getMemoryOverride = opts.getMemoryFn;
  if (opts.putMemoryFn !== undefined) _putMemoryOverride = opts.putMemoryFn;
  if (opts.scheduleIdleWorkFn !== undefined) _scheduleOverride = opts.scheduleIdleWorkFn;
  load(storage);

  const key = hashText(text);
  const cached = _cache.get(key);
  if (cached) {
    touch(key, cached);
    return { vector: new Float32Array(cached.vector), tier: cached.tier, dim: cached.dim };
  }

  const embedFn = opts.embedFn ?? embed;
  const result = await embedFn(text);
  const entry: SerializedEntry = { vector: [...result.vector], tier: result.tier, dim: result.dim };
  _cache.set(key, entry);
  evictOverCap();
  scheduleSave(storage, _scheduleOverride ?? scheduleIdleWork);
  return result;
}

/** Current number of memoized entries (for diagnostics/tests). */
export function getEmbeddingCacheSize(): number {
  return _cache.size;
}

/** Configure module-level overrides (call before tests). */
export function configureEmbeddingCacheForTests(opts: EmbeddingCacheOptions): void {
  _storageOverride = opts.storage === undefined ? undefined : opts.storage;
  _getMemoryOverride = opts.getMemoryFn ?? null;
  _putMemoryOverride = opts.putMemoryFn ?? null;
  _scheduleOverride = opts.scheduleIdleWorkFn ?? null;
}

/** Reset module state for test isolation. */
export function resetEmbeddingCacheForTests(): void {
  _cache.clear();
  _loaded = false;
  _writtenSinceLoad = false;
  _dirty = false;
  _storageOverride = undefined;
  _getMemoryOverride = null;
  _putMemoryOverride = null;
  _scheduleOverride = null;
}

export const __internals = { hashText, MAX_CACHE_ENTRIES };
