/**
 * USGS seismic events via the `/api/earthquakes` proxy, for the earthquakes
 * fusion domain's first vote.
 *
 * Deliberately NOT `services/earthquakes.fetchEarthquakes()`, which the map
 * layer uses: that path sits behind a 30 min circuit-breaker cache AND a 30 min
 * server-side cache, and reads the M4.5+ `4.5_day` summary. Since
 * `recordDomainObservations` stamps `lastSuccessAt` at RECORD time rather than
 * from the payload, polling it on a fusion cadence would re-stamp half-hour-old
 * rows as a fresh success — a phantom healthy vote, which is worse than an
 * honest stale one.
 *
 * `/api/earthquakes` is served by two DIFFERENT implementations with two
 * different payload shapes, and this module has to handle both:
 *
 *  - desktop, `src-tauri/sidecar/local-api-server.mjs` — `all_hour` with an
 *    `all_day` fallback, no magnitude floor, FLATTENED rows, cached 60 s.
 *  - web, `api/earthquakes.js` (edge fn) — `2.5_day` by default, so an M2.5
 *    floor over 24 h, RAW GeoJSON features, cached 60 s.
 *
 * Handing the web payload straight to `parseUsgsEvents` yields zero rows (it
 * reads `row.magnitude`/`row.lat`, which live under `properties`/`geometry` in
 * a raw feature), and zero rows is recorded as a failure — so before this was
 * normalized, the web build had no USGS vote at all rather than a degraded one.
 */
import { getApiBaseUrl } from '@/services/runtime';
import { parseUsgsEvents, type UsgsEvent } from '@/services/earthquake/earthquake-intelligence';

interface UsgsRouteResponse {
  events?: unknown;
  degraded?: boolean;
  source?: unknown;
  /** ISO instant of the UPSTREAM fetch, frozen into each route's cache. */
  generatedAt?: unknown;
  error?: unknown;
  reason?: unknown;
}

/**
 * How old the payload may be, measured from the upstream fetch.
 *
 * `source` cannot detect a replay on its own: both routes cache the whole
 * envelope for 60 s, so a cache HIT still reports 'primary' / 'fallback-N' /
 * 'usgs.gov'. Since `recordDomainObservations` stamps `lastSuccessAt` at RECORD
 * time, a second caller inside that window (the globe heatmap and the nuclear
 * monitor both hit this route) would re-stamp minute-old rows as a fresh
 * success — the phantom healthy vote, just on a shorter clock. The allowlist
 * rules out a LAST-GOOD replay; this rules out a TTL replay.
 *
 * 150 s = 2.5x the 60 s TTL both routes use. Wide enough that no legitimate
 * cache hit is ever rejected, and it fails closed if either TTL is later raised
 * past 2.5 min. It also stays at a quarter of the provider's 10 min
 * freshnessTtlMs, so a re-stamp can never claim more than 25% of the window
 * it is asserting freshness over.
 */
const MAX_PAYLOAD_AGE_MS = 150_000;

/**
 * Which `source` values mean the rows were fetched live on this request.
 *
 * An ALLOWLIST, not a denylist: an unrecognized value has to fail closed. The
 * three sidecar values come from `feed-resilience.fetchWithFallback` —
 * `primary` (all_hour), `fallback-N` (all_day, live and a superset of the
 * primary feed, so genuinely usable) and `cached` (a last-good REPLAY, stale by
 * construction, and the one that must never corroborate). The edge function
 * reports `usgs.gov` and has no replay path at all.
 *
 * This is why `degraded` alone is not the test: the sidecar sets it for both
 * `fallback-N` and `cached`, so rejecting on it discarded live all_day rows.
 */
const LIVE_SOURCES = /^(?:primary|usgs\.gov|fallback-\d+)$/;

/** Raw GeoJSON feature → the flat row shape `parseUsgsEvents` reads. */
function flattenFeature(f: Record<string, unknown>): Record<string, unknown> | null {
  const p = (f.properties ?? {}) as Record<string, unknown>;
  const coords = (f.geometry as { coordinates?: unknown } | undefined)?.coordinates;
  if (!Array.isArray(coords)) return null;
  const [lon, lat, depth] = coords as unknown[];
  return {
    id: f.id ?? p.code ?? null,
    magnitude: p.mag ?? null,
    magnitudeType: p.magType ?? null,
    place: p.place ?? null,
    time: p.time ?? null,
    depth: depth ?? null,
    lat, lon,
    url: p.url ?? null,
    tsunami: p.tsunami ?? 0,
  };
}

/** Accepts either payload shape; a raw feature is recognizable by its geometry. */
function normalizeRows(events: readonly unknown[]): unknown[] {
  return events.map((e) => {
    const row = e as Record<string, unknown>;
    return row && typeof row === 'object' && 'geometry' in row && 'properties' in row
      ? flattenFeature(row)
      : row;
  }).filter(Boolean);
}

/**
 * Fail-closed: every non-live outcome throws so the caller records a failing
 * fetch outcome instead of corroborating against a replay.
 */
export async function fetchUsgsSeismicForFusion(now: number = Date.now()): Promise<UsgsEvent[]> {
  // 35s, not 18s: the sidecar gives EACH attempt a 15s deadline, so a tick that
  // times out on all_hour and then succeeds on all_day legitimately takes just
  // over 30s. A shorter client abort would reject those live rows as a failure.
  const res = await fetch(`${getApiBaseUrl()}/api/earthquakes`, { signal: AbortSignal.timeout(35_000) });
  if (!res.ok) throw new Error(`usgs-earthquakes ${res.status}`);
  const data = (await res.json()) as UsgsRouteResponse | null;
  if (!data || data.error || data.reason || !Array.isArray(data.events)) {
    // Only a STRING reason is echoed: the envelope is untrusted, and an object
    // there would stringify to '[object Object]' — noise, not a diagnosis.
    const reason = [data?.error, data?.reason].find((v) => typeof v === 'string');
    throw new Error(reason ?? 'usgs-earthquakes malformed');
  }
  // Absent `source` is rejected too: both implementations always send one, so a
  // payload without it is a shape this module has not been checked against.
  if (typeof data.source !== 'string' || !LIVE_SOURCES.test(data.source)) {
    throw new Error(`usgs-earthquakes not live (source=${String(data.source)})`);
  }
  // Absent or unparseable `generatedAt` is rejected too: both routes always
  // send it, so a payload without one is an unrecognized shape whose age
  // cannot be established — and an unknown age has to fail closed.
  const generatedAt = typeof data.generatedAt === 'string' ? Date.parse(data.generatedAt) : Number.NaN;
  if (!Number.isFinite(generatedAt)) throw new Error('usgs-earthquakes missing generatedAt');
  const ageMs = now - generatedAt;
  if (ageMs > MAX_PAYLOAD_AGE_MS) {
    throw new Error(`usgs-earthquakes stale replay (${Math.round(ageMs / 1000)}s old)`);
  }
  return parseUsgsEvents(normalizeRows(data.events));
}
