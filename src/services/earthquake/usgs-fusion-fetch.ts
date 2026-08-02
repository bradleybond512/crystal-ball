/**
 * USGS seismic events via the sidecar proxy, for the earthquakes fusion
 * domain's first vote.
 *
 * Deliberately NOT `services/earthquakes.fetchEarthquakes()`, which the map
 * layer uses: that path sits behind a 30 min circuit-breaker cache AND a 30 min
 * server-side cache, and reads the M4.5+ `4.5_day` summary. Since
 * `recordDomainObservations` stamps `lastSuccessAt` at RECORD time rather than
 * from the payload, polling it on a fusion cadence would re-stamp half-hour-old
 * rows as a fresh success — a phantom healthy vote, which is worse than an
 * honest stale one. `/api/earthquakes` is the sidecar's own route: `all_hour`
 * with an `all_day` fallback, no magnitude floor, cached 60 s.
 */
import { getApiBaseUrl } from '@/services/runtime';
import { parseUsgsEvents, type UsgsEvent } from '@/services/earthquake/earthquake-intelligence';

interface UsgsRouteResponse {
  events?: unknown;
  degraded?: boolean;
  error?: string;
}

/**
 * Fail-closed: every non-live outcome throws so the caller records a failing
 * fetch outcome instead of corroborating against a replay.
 *
 * `degraded` is treated as failure even though it covers two different things
 * — the `all_day` fallback feed and a last-good-cache replay. The route does
 * not distinguish them in the payload, and one of the two is stale by
 * construction, so the conservative reading is the only sound one here.
 */
export async function fetchUsgsSeismicForFusion(): Promise<UsgsEvent[]> {
  // 18s: above the sidecar's 15s upstream deadline so a slow upstream fails in
  // the sidecar (recorded properly) rather than racing here.
  const res = await fetch(`${getApiBaseUrl()}/api/earthquakes`, { signal: AbortSignal.timeout(18_000) });
  if (!res.ok) throw new Error(`usgs-earthquakes ${res.status}`);
  const data = (await res.json()) as UsgsRouteResponse | null;
  if (!data || data.error || data.degraded || !Array.isArray(data.events)) {
    throw new Error(data?.error ?? 'usgs-earthquakes malformed or degraded');
  }
  return parseUsgsEvents(data.events);
}
