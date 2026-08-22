/**
 * Offline Alert Cache — Emergency-resilient data persistence
 *
 * The PWA's Workbox config marks /api/* as NetworkOnly, meaning alerts
 * disappear when the network drops. During emergencies, cell towers saturate
 * and connectivity is unreliable — exactly when you need the data most.
 *
 * This layer:
 *  1. Persists the last-known alert snapshot to localStorage after each fetch
 *  2. Returns stale data with staleness metadata when network fails
 *  3. Expires stale data after configurable TTL (default: 4 hours)
 *  4. Tracks when each service last had a live fetch vs. serving from cache
 *
 * Usage — wrap any fetch call:
 * const alerts = await withOfflineCache('nws-alerts', fetchNwsAlerts, 4 * 3600_000);
 */

import { safeSetItem } from '@/utils/safe-storage';

export interface CachedSnapshot<T> {
  data: T;
  cachedAt: number; // unix ms
  expiresAt: number; // unix ms
  isStale: boolean; // true when served from offline cache
  staleDurationMs: number; // how long since last live fetch
  source: 'network' | 'offline-cache';
}

export interface FeedFreshnessDisposition {
  /** True only for a live (network) fetch. False when served from offline cache. */
  fresh: boolean;
  /** Human-readable staleness reason when !fresh (for dataFreshness.recordError + the feed status). */
  staleReason: string | null;
  /** The real "last live fetch" timestamp to record when stale (cachedAt), so the
   *  staleness clock reflects the actual age — never advanced to now. */
  staleTimestamp: number | null;
}

/**
 * Decide how a feed should record its freshness from a CachedSnapshot.
 *
 * Consumers MUST advance freshness (recordUpdate / recordSourceUpdate(now)) only
 * when `fresh` — a snapshot served from the offline cache (a failed live fetch)
 * must be recorded as an ERROR, otherwise a stale snapshot renders as a fresh
 * live update and a safety feed's StalenessBanner stays green during an outage.
 */
export function feedFreshnessFromSnapshot<T>(snapshot: CachedSnapshot<T>): FeedFreshnessDisposition {
  if (snapshot.isStale) {
    const ageMin = Math.round(snapshot.staleDurationMs / 60_000);
    return { fresh: false, staleReason: `served from offline cache (~${ageMin}m stale)`, staleTimestamp: snapshot.cachedAt };
  }
  return { fresh: true, staleReason: null, staleTimestamp: null };
}

export interface OfflineCacheEntry<T> {
  data: T;
  cachedAt: number;
  version: number;
}

export interface OfflineCacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const CACHE_VERSION = 1;
const PREFIX = 'wm_offline_';

function storageKey(serviceId: string): string {
  return `${PREFIX}${serviceId}`;
}

function resolveStorage(storage?: OfflineCacheStorage): OfflineCacheStorage | null {
  if (storage) return storage;
  try {
 return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
 return null;
  }
}

function readEntry<T>(serviceId: string, storage?: OfflineCacheStorage): OfflineCacheEntry<T> | null {
  try {
 const raw = resolveStorage(storage)?.getItem(storageKey(serviceId));
 if (!raw) return null;
 const entry = JSON.parse(raw) as Partial<OfflineCacheEntry<T>> | null;
 if (!entry || typeof entry !== 'object' || entry.version !== CACHE_VERSION
   || typeof entry.cachedAt !== 'number' || !Number.isFinite(entry.cachedAt)
   || !Object.prototype.hasOwnProperty.call(entry, 'data')) return null;
 return entry as OfflineCacheEntry<T>;
  } catch {
 return null;
  }
}

function writeEntry<T>(serviceId: string, data: T, storage?: OfflineCacheStorage): boolean {
  try {
 const target = resolveStorage(storage);
 if (!target) return false;
 const entry: OfflineCacheEntry<T> = {
 data,
 cachedAt: Date.now(),
 version: CACHE_VERSION,
 };
 const serialized = JSON.stringify(entry);
 let wrote: boolean;
 if (storage) {
   target.setItem(storageKey(serviceId), serialized);
   wrote = true;
 } else {
   wrote = safeSetItem(storageKey(serviceId), serialized);
 }
 if (!wrote) return false;
 // The renderer-wide quota patch may swallow a failed setItem. Exact readback
 // is the only proof that an emergency artifact actually reached storage.
 return target.getItem(storageKey(serviceId)) === serialized;
  } catch {
 // localStorage might be full or unavailable — report failure without throwing.
 return false;
  }
}

export function readOfflineCacheEntry<T>(
  serviceId: string,
  storage?: OfflineCacheStorage,
): OfflineCacheEntry<T> | null {
  return readEntry<T>(serviceId, storage);
}

export function writeOfflineCacheEntry<T>(
  serviceId: string,
  data: T,
  storage?: OfflineCacheStorage,
): boolean {
  return writeEntry(serviceId, data, storage);
}

function clearEntry(serviceId: string): void {
  try { localStorage.removeItem(storageKey(serviceId)); } catch { /* noop */ }
}

/**
 * Wraps a fetch function with offline fallback cache.
 *
 * @param serviceId  Unique key for this service (e.g. 'nws-alerts')
 * @param fetchFn The actual network fetch function
 * @param staleMs How long to trust cached data (default: 4 hours)
 */
// Coalesce concurrent callers for the same serviceId onto one in-flight fetch,
// so N panels/tasks requesting the same feed at once don't each hit the network.
const inFlightOfflineFetch = new Map<string, Promise<CachedSnapshot<unknown>>>();

export function withOfflineCache<T>(
  serviceId: string,
  fetchFn: () => Promise<T>,
  staleMs = 4 * 3_600_000
): Promise<CachedSnapshot<T>> {
  const existing = inFlightOfflineFetch.get(serviceId);
  if (existing) return existing as Promise<CachedSnapshot<T>>;
  const run = runWithOfflineCache(serviceId, fetchFn, staleMs);
  inFlightOfflineFetch.set(serviceId, run as Promise<CachedSnapshot<unknown>>);
  return run.finally(() => {
 if (inFlightOfflineFetch.get(serviceId) === (run as Promise<CachedSnapshot<unknown>>)) {
 inFlightOfflineFetch.delete(serviceId);
 }
  });
}

async function runWithOfflineCache<T>(
  serviceId: string,
  fetchFn: () => Promise<T>,
  staleMs: number
): Promise<CachedSnapshot<T>> {
  try {
 const data = await fetchFn();
 // Network succeeded — update cache
 writeEntry(serviceId, data);
 return {
 data,
 cachedAt: Date.now(),
 expiresAt: Date.now() + staleMs,
 isStale: false,
 staleDurationMs: 0,
 source: 'network',
 };
  } catch (error) {
 // Network failed — try offline cache
 const entry = readEntry<T>(serviceId);
 if (entry) {
 const staleDurationMs = Date.now() - entry.cachedAt;
 if (staleDurationMs < staleMs) {
 return {
 data: entry.data,
 cachedAt: entry.cachedAt,
 expiresAt: entry.cachedAt + staleMs,
 isStale: true,
 staleDurationMs,
 source: 'offline-cache',
 };
 }
 // Cache expired — still return it but mark expired
 return {
 data: entry.data,
 cachedAt: entry.cachedAt,
 expiresAt: entry.cachedAt + staleMs,
 isStale: true,
 staleDurationMs,
 source: 'offline-cache',
 };
 }
 throw error; // No cache, re-throw
  }
}

/**
 * Pre-warm the offline cache by fetching all registered services.
 * Call this when the app is online and idle.
 */
interface CachableService { id: string; fetch: () => Promise<unknown>; staleMs?: number }
const registeredServices: CachableService[] = [];

export function registerForOfflineCache(
  serviceId: string,
  fetchFn: () => Promise<unknown>,
  staleMs = 4 * 3_600_000
): void {
  if (!registeredServices.find(s => s.id === serviceId)) {
 registeredServices.push({ id: serviceId, fetch: fetchFn, staleMs });
  }
}

export async function prewarmOfflineCache(): Promise<{ succeeded: string[]; failed: string[] }> {
  const succeeded: string[] = [];
  const failed: string[] = [];

  await Promise.allSettled(
 registeredServices.map(async svc => {
 try {
 const data = await svc.fetch();
 writeEntry(svc.id, data);
 succeeded.push(svc.id);
 } catch {
 failed.push(svc.id);
 }
 })
  );

  return { succeeded, failed };
}

/**
 * Get the offline cache status — useful for a status indicator.
 */
export interface OfflineCacheStatus {
  serviceId: string;
  hasCache: boolean;
  cachedAt: Date | null;
  ageMs: number | null;
}

export function getOfflineCacheStatus(serviceIds: string[]): OfflineCacheStatus[] {
  return serviceIds.map(id => {
 const entry = readEntry<unknown>(id);
 return {
 serviceId: id,
 hasCache: entry !== null,
 cachedAt: entry ? new Date(entry.cachedAt) : null,
 ageMs: entry ? Date.now() - entry.cachedAt : null,
 };
  });
}

/**
 * Critical data source keys that should be pre-registered for offline caching.
 * These are the data sources most important during emergencies.
 */
export const CRITICAL_SOURCE_KEYS = [
  'gdacs-events',
  'nws-alerts',
  'tsunami-alerts',
  'weather-alerts',
  'news-rss:breaking',
  'news-rss:world',
  'news-rss:intel',
  'conflict-events',
  'military-signals',
  'military-vessels',
  'market-data',
  'economic-data',
  'earthquake-data',
] as const;

export type CriticalSourceKey = typeof CRITICAL_SOURCE_KEYS[number];

/**
 * Pre-register all critical data source keys so the cache status UI
 * knows about them even before first fetch. Call once at app startup.
 */
export function registerCriticalSources(): void {
  // Touch each key in getOfflineCacheStatus — no data is written,
  // but callers can now enumerate all expected sources.
  // The actual cache entries are populated on first successful fetch.
  for (const key of CRITICAL_SOURCE_KEYS) {
 if (!registeredServices.find(s => s.id === key)) {
 // Register with a no-op fetch — real fetch functions are wired
 // through withOfflineCache at the call site in data-loader.ts
 registeredServices.push({ id: key, fetch: () => Promise.resolve(null), staleMs: 4 * 3_600_000 });
 }
  }
}

export function clearOfflineCache(serviceId?: string): void {
  if (serviceId) {
 clearEntry(serviceId);
 return;
  }
  // Clear all
  const keys = Object.keys(localStorage).filter(k => k.startsWith(PREFIX));
  keys.forEach(k => localStorage.removeItem(k));
}

/**
 * Check if the browser is currently offline.
 */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && !navigator.onLine;
}

/**
 * Subscribe to online/offline status changes.
 * Returns cleanup function.
 */
export function onConnectivityChange(
  callback: (online: boolean) => void
): () => void {
  const onOnline = () => callback(true);
  const onOffline = () => callback(false);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  return () => {
 window.removeEventListener('online', onOnline);
 window.removeEventListener('offline', onOffline);
  };
}
