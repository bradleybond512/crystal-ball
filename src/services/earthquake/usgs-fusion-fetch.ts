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
 * How far ahead of `generatedAt` the reference instant may sit in the WRONG
 * direction before the age is treated as unestablishable.
 *
 * With both ends of the subtraction now stamped by the same machine this
 * should never trip; a negative age means the origin's own two stamps
 * disagree, and an incoherent pair has to fail closed rather than read as
 * "extremely fresh". 1 s absorbs sub-second rounding between the two stamps.
 */
const MAX_CLOCK_SKEW_MS = 1000;

/**
 * The origin's own "now", used to age the payload.
 *
 * The browser clock is deliberately NOT a fallback here. Measuring a
 * server-stamped `generatedAt` against a client clock mixes two clocks, and
 * the error is asymmetric: a fast client only costs a live vote, but a SLOW
 * client shrinks the computed age and waves a genuine replay past the cap —
 * precisely the phantom healthy vote this module exists to prevent. A slow
 * clock is invisible while the age stays positive, so there is no check that
 * recovers it. Without a server reference the age is unknowable, and unknowable
 * fails closed.
 *
 * `Date` alone is not enough either: an intermediary cache preserves the
 * origin's `Date` and advances `Age` instead, so a CDN replaying a ten-minute-
 * old response reports `Date` unchanged and `Age: 600`. Per RFC 9111 the
 * origin-relative instant of the response as served is `Date + Age`.
 *
 * Neither header is CORS-safelisted, so both ends of this contract had to be
 * arranged, and BOTH routes are reachable cross-origin: the sidecar answers at
 * 127.0.0.1 while the renderer runs at tauri://localhost, and when the sidecar
 * is unavailable `runtime.ts` deliberately falls back to the remote edge route.
 * So the sidecar's final response writer and the edge `getCorsHeaders`
 * (api/_cors.js) both send `Access-Control-Expose-Headers: Date, Age`.
 * Returns null when `Date` is missing or unparseable, or when `Age` is present
 * but not a non-negative integer — a malformed `Age` is a shape this has not
 * been checked against, not a zero.
 */
function originNow(res: Response): number | null {
  const date = res.headers?.get?.('date');
  const parsedDate = date ? Date.parse(date) : Number.NaN;
  if (!Number.isFinite(parsedDate)) return null;
  // A PRESENT-but-empty `Age` is not an absent one. An intermediary that caches
  // for ten minutes while emitting `Age:` blank still preserves the origin's
  // `Date`, so reading blank as absent computes a near-zero age and waves the
  // replay through — the exact hole `Age` was added to close. Only a header
  // that was never sent means "no intermediary".
  const rawAge = res.headers?.get?.('age');
  if (typeof rawAge !== 'string') return parsedDate;
  const age = rawAge.trim();
  if (!/^\d+$/.test(age)) return null;
  return parsedDate + Number(age) * 1000;
}

/**
 * Which `source` values mean the rows were fetched live on this request.
 *
 * An ALLOWLIST, not a denylist: an unrecognized value has to fail closed. The
 * three sidecar values come from `feed-resilience.fetchWithFallback` —
 * `primary` (all_hour), `fallback-N` (all_day, live and a superset of the
 * primary feed, so genuinely usable) and `cached` (a last-good REPLAY, stale by
 * construction, and the one that must never corroborate). The edge function
 * reports `usgs.gov` and has no LAST-GOOD path — it does have a 60 s in-memory
 * TTL replay (api/earthquakes.js), which is what the age cap below covers.
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
 * Fail-closed on everything it can distinguish: a non-2xx response, an error
 * envelope behind a 200, a `source` outside the live allowlist, and a payload
 * whose age is stale or unestablishable all throw, so the caller records a
 * failing fetch outcome instead of corroborating against a replay.
 *
 * What it deliberately does NOT reject is a cache hit inside the age cap. That
 * would turn a payload 10% into the provider's freshness window into a hard
 * failure — the domain loses the vote entirely, which is strictly worse than
 * counting it with an honest age. The cap is where "reusable" ends, not
 * "live".
 */
export async function fetchUsgsSeismicForFusion(): Promise<UsgsEvent[]> {
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
  const serverNow = originNow(res);
  if (serverNow === null) throw new Error('usgs-earthquakes no server time reference');
  const ageMs = serverNow - generatedAt;
  if (ageMs > MAX_PAYLOAD_AGE_MS) {
    throw new Error(`usgs-earthquakes stale replay (${Math.round(ageMs / 1000)}s old)`);
  }
  if (ageMs < -MAX_CLOCK_SKEW_MS) {
    throw new Error(`usgs-earthquakes incoherent timestamps (${Math.round(-ageMs / 1000)}s ahead)`);
  }
  return parseUsgsEvents(normalizeRows(data.events));
}
