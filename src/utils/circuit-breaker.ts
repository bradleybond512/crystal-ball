interface CircuitState {
  failures: number;
  cooldownUntil: number;
  lastError?: string;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export type BreakerDataMode = 'live' | 'cached' | 'unavailable';

export interface BreakerDataState {
  mode: BreakerDataMode;
  timestamp: number | null;
  offline: boolean;
}

export interface CircuitBreakerOptions {
  name: string;
  maxFailures?: number;
  cooldownMs?: number;
  cacheTtlMs?: number;
  /** Persist cache to IndexedDB across page reloads. Default: false.
 *  Opt-in only — cached payloads must be JSON-safe (no Date objects).
 *  Auto-disabled when cacheTtlMs === 0. */
  persistCache?: boolean;
}

const DEFAULT_MAX_FAILURES = 2;
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const PERSISTENT_STALE_CEILING_MS = 24 * 60 * 60 * 1000; // 24h — discard persistent entries older than this


function isDesktopOfflineMode(): boolean {
  if (typeof window === 'undefined') return false;
  const hasTauri = Boolean((window as unknown as { __TAURI__?: unknown }).__TAURI__);
  return hasTauri && typeof navigator !== 'undefined' && navigator.onLine === false;
}

export class CircuitBreaker<T> {
  private state: CircuitState = { failures: 0, cooldownUntil: 0 };
  private cache: CacheEntry<T> | null = null;
  private name: string;
  private maxFailures: number;
  private cooldownMs: number;
  private cacheTtlMs: number;
  private persistEnabled: boolean;
  private persistentLoaded = false;
  private persistentLoadPromise: Promise<void> | null = null;
  private lastDataState: BreakerDataState = { mode: 'unavailable', timestamp: null, offline: false };
  private swrInFlight = false;

  constructor(options: CircuitBreakerOptions) {
 this.name = options.name;
 this.maxFailures = options.maxFailures ?? DEFAULT_MAX_FAILURES;
 this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
 this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
 this.persistEnabled = this.cacheTtlMs === 0
 ? false
 : (options.persistCache ?? false);
  }

  private get persistKey(): string {
 return `breaker:${this.name}`;
  }

  /** Hydrate in-memory cache from persistent storage on first call. */
  private hydratePersistentCache(): Promise<void> {
 if (this.persistentLoaded) return Promise.resolve();
 if (this.persistentLoadPromise) return this.persistentLoadPromise;

 this.persistentLoadPromise = (async () => {
 try {
 const { getPersistentCache } = await import('../services/persistent-cache');
 const entry = await getPersistentCache<T>(this.persistKey);
 // eslint-disable-next-line sonarjs/different-types-comparison
 if (entry?.data === undefined || entry.data === null) return;

 const age = Date.now() - entry.updatedAt;
 if (age > PERSISTENT_STALE_CEILING_MS) return;

 // Only hydrate if in-memory cache is empty (don't overwrite live data)
 if (this.cache === null) {
 this.cache = { data: entry.data, timestamp: entry.updatedAt };
 const withinTtl = (Date.now() - entry.updatedAt) < this.cacheTtlMs;
 this.lastDataState = {
 mode: withinTtl ? 'cached' : 'unavailable',
 timestamp: entry.updatedAt,
 offline: false,
 };
 }
 } catch (error) {
 // eslint-disable-next-line no-console
 console.warn(`[${this.name}] Persistent cache hydration failed:`, error);
 } finally {
 this.persistentLoaded = true;
 this.persistentLoadPromise = null;
 }
 })();

 return this.persistentLoadPromise;
  }

  /** Fire-and-forget write to persistent storage. */
  private writePersistentCache(data: T): void {
 import('../services/persistent-cache').then(({ setPersistentCache }) => {
 setPersistentCache(this.persistKey, data).catch(() => { /* no-op */ });
 }).catch(() => { /* no-op */ });
  }

  /** Fire-and-forget delete from persistent storage. */
  private deletePersistentCache(): void {
 import('../services/persistent-cache').then(({ deletePersistentCache }) => {
 deletePersistentCache(this.persistKey).catch(() => { /* no-op */ });
 }).catch(() => { /* no-op */ });
  }

  isOnCooldown(): boolean {
 if (Date.now() < this.state.cooldownUntil) {
 return true;
 }
 if (this.state.cooldownUntil > 0) {
 this.state = { failures: 0, cooldownUntil: 0 };
 }
 return false;
  }

  getCooldownRemaining(): number {
 return Math.max(0, Math.ceil((this.state.cooldownUntil - Date.now()) / 1000));
  }

  getStatus(): string {
 if (this.lastDataState.offline) {
 return this.lastDataState.mode === 'cached'
 ? 'offline mode (serving cached data)'
 : 'offline mode (live API unavailable)';
 }
 if (this.isOnCooldown()) {
 return `temporarily unavailable (retry in ${this.getCooldownRemaining()}s)`;
 }
 return 'ok';
  }

  getDataState(): BreakerDataState {
 return { ...this.lastDataState };
  }

  getCached(): T | null {
 if (this.cache && Date.now() - this.cache.timestamp < this.cacheTtlMs) {
 return this.cache.data;
 }
 return null;
  }

  getCachedOrDefault(defaultValue: T): T {
 return this.cache?.data ?? defaultValue;
  }

  recordSuccess(data: T): void {
 this.state = { failures: 0, cooldownUntil: 0 };
 this.cache = { data, timestamp: Date.now() };
 this.lastDataState = { mode: 'live', timestamp: Date.now(), offline: false };

 if (this.persistEnabled) {
 this.writePersistentCache(data);
 }
  }

  clearCache(): void {
 this.cache = null;
 this.persistentLoadPromise = null; // orphan any in-flight hydration
 if (this.persistEnabled) {
 this.deletePersistentCache();
 }
  }

  recordFailure(error?: string): void {
 this.state.failures++;
 this.state.lastError = error;
 if (this.state.failures >= this.maxFailures) {
 this.state.cooldownUntil = Date.now() + this.cooldownMs;
 // eslint-disable-next-line no-console
 console.warn(`[${this.name}] On cooldown for ${this.cooldownMs / 1000}s after ${this.state.failures} failures`);
 }
  }

  async execute<R extends T>(
 fn: () => Promise<R>,
 defaultValue: R
  ): Promise<R> {
 const { data } = await this.executeTracked(fn, defaultValue);
 return data;
  }

  // Like execute(), but returns the data paired with a snapshot of the data-state
  // it produced. The snapshot is captured in the SAME synchronous branch as the
  // returned value — there is no await between each branch's lastDataState write
  // and its capture — so it is bound to THIS call's outcome and cannot be
  // contaminated by a concurrent caller mutating the shared lastDataState between
  // this call resolving and a later getDataState() read (the TOCTOU behind the
  // weather "all clear" fail-open). Consumers whose decision depends on currency
  // must use this, not execute() + getDataState().
  async executeTracked<R extends T>(
 fn: () => Promise<R>,
 defaultValue: R
  ): Promise<{ data: R; dataState: BreakerDataState }> {
 const offline = isDesktopOfflineMode();

 // Hydrate from persistent storage on first call (~1-5ms IndexedDB read)
 if (this.persistEnabled && !this.persistentLoaded) {
 await this.hydratePersistentCache();
 }

 if (this.isOnCooldown()) {
 if (import.meta.env.DEV) console.log(`[${this.name}] Currently unavailable, ${this.getCooldownRemaining()}s remaining`); // eslint-disable-line no-console
 const cachedFallback = this.getCached();
 if (cachedFallback !== null) {
 this.lastDataState = { mode: 'cached', timestamp: this.cache?.timestamp ?? null, offline };
 return { data: cachedFallback as R, dataState: { ...this.lastDataState } };
 }
 this.lastDataState = { mode: 'unavailable', timestamp: null, offline };
 return { data: this.getCachedOrDefault(defaultValue) as R, dataState: { ...this.lastDataState } };
 }

 const cached = this.getCached();
 if (cached !== null) {
 this.lastDataState = { mode: 'cached', timestamp: this.cache?.timestamp ?? null, offline };
 return { data: cached as R, dataState: { ...this.lastDataState } };
 }

 // Stale-while-revalidate: if we have stale cached data (outside TTL but
 // within the 24h persistent ceiling), return it instantly and refresh in
 // the background. This prevents "Loading..." on every page reload when
 // the persistent cache is older than the TTL.
 // Skip SWR when cacheTtlMs === 0 (caching disabled) — the breaker may be
 // shared across calls with different request params (e.g. stocks vs commodities),
 // so returning stale data from a different call is wrong.
 if (this.cache !== null && this.cacheTtlMs > 0) {
 this.lastDataState = { mode: 'cached', timestamp: this.cache.timestamp, offline };
 // Fire-and-forget background refresh — skip if circuit breaker is cooling
 // down OR if a previous SWR refresh is already in flight (prevents 20
 // concurrent calls each spawning their own background refresh).
 if (!this.isOnCooldown() && !this.swrInFlight) {
 this.swrInFlight = true;
 fn().then(result => this.recordSuccess(result)).catch(error => {
 // eslint-disable-next-line no-console
 console.warn(`[${this.name}] Background refresh failed:`, error);
 this.recordFailure(String(error));
 }).finally(() => { this.swrInFlight = false; });
 }
 return { data: this.cache.data as R, dataState: { ...this.lastDataState } };
 }

 try {
 const result = await fn();
 this.recordSuccess(result);
 return { data: result, dataState: { ...this.lastDataState } };
 } catch (error) {
 const msg = String(error);
 // eslint-disable-next-line no-console
 console.error(`[${this.name}] Failed:`, msg);
 this.recordFailure(msg);
 this.lastDataState = { mode: 'unavailable', timestamp: null, offline };
 return { data: defaultValue, dataState: { ...this.lastDataState } };
 }
  }
}

// Registry of circuit breakers for global status
const breakers = new Map<string, CircuitBreaker<unknown>>();

export function createCircuitBreaker<T>(options: CircuitBreakerOptions): CircuitBreaker<T> {
  const breaker = new CircuitBreaker<T>(options);
  breakers.set(options.name, breaker as CircuitBreaker<unknown>);
  return breaker;
}

export function getCircuitBreakerStatus(): Record<string, string> {
  const status: Record<string, string> = {};
  breakers.forEach((breaker, name) => {
 status[name] = breaker.getStatus();
  });
  return status;
}

export function isCircuitBreakerOnCooldown(name: string): boolean {
  const breaker = breakers.get(name);
  return breaker ? breaker.isOnCooldown() : false;
}

export function getCircuitBreakerCooldownInfo(name: string): { onCooldown: boolean; remainingSeconds: number } {
  const breaker = breakers.get(name);
  if (!breaker) return { onCooldown: false, remainingSeconds: 0 };
  return {
 onCooldown: breaker.isOnCooldown(),
 remainingSeconds: breaker.getCooldownRemaining()
  };
}

export function removeCircuitBreaker(name: string): void {
  breakers.delete(name);
}

export function clearAllCircuitBreakers(): void {
  breakers.clear();
}
