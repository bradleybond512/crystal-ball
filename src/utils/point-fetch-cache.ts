/**
 * Tiny TTL cache for slow-changing point-forecast endpoints (per-saved-place
 * weather / marine / flood forecasts, keyed by URL i.e. by lat,lon). These
 * update hourly at best, so refetching the full payload every refresh cycle is
 * wasted bandwidth. Only successful, parseable responses are cached; failures
 * return null and are not cached.
 *
 * NOT for safety-critical alerts — NWS warnings have their own dedicated path
 * with freshness/failure guards. This is supplementary forecast data only.
 */
const cache = new Map<string, { at: number; data: unknown }>();
const MAX_ENTRIES = 64;

export async function fetchJsonCached<T>(url: string, ttlMs: number): Promise<T | null> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let data: T;
  try {
    data = await response.json() as T;
  } catch {
    return null;
  }

  if (cache.size >= MAX_ENTRIES && !cache.has(url)) {
    let oldestKey: string | undefined;
    let oldestAt = Infinity;
    for (const [k, v] of cache) {
      if (v.at < oldestAt) { oldestAt = v.at; oldestKey = k; }
    }
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(url, { at: Date.now(), data });
  return data;
}
