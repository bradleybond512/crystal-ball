import { createCircuitBreaker, getCSSColor } from '@/utils';

export interface WeatherAlert {
  id: string;
  event: string;
  severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
  headline: string;
  description: string;
  areaDesc: string;
  onset: Date;
  expires: Date;
  coordinates: [number, number][];
  /** All outer rings of the alert geometry (one per sub-polygon of a
   *  MultiPolygon; a single ring for a Polygon). Present ONLY when the alert
   *  has more than one outer ring — `coordinates` legacy-carries just the
   *  first ring for the map/DeckGL consumers, but personal matching must union
   *  over every ring or a warning whose 2nd+ sub-polygon covers the user reads
   *  as clear. Consumers that do point-in-polygon prefer this when set. */
  polygonRings?: [number, number][][];
  centroid?: [number, number];
  /** UGC zone/county codes the alert applies to (from properties.geocode.UGC).
   *  Used as the geometry-free fallback when an alert has no polygon. */
  ugcZones: string[];
}

interface NWSAlert {
  id: string;
  properties: {
 event: string;
 severity: string;
 headline: string;
 description: string;
 areaDesc: string;
 onset: string;
 expires: string;
 geocode?: { UGC?: string[]; SAME?: string[] };
  };
  geometry?: {
 type: string;
 coordinates: number[][][] | number[][];
  };
}

interface NWSResponse {
  features: NWSAlert[];
}

const NWS_API = 'https://api.weather.gov/alerts/active';
const breaker = createCircuitBreaker<WeatherAlert[]>({ name: 'NWS Weather', cacheTtlMs: 30 * 60 * 1000, persistCache: true });

/** Cap on active alerts retained from the national feed. The feed is
 *  sorted MOST-SEVERE-FIRST before this cap applies, so a busy severe-
 *  weather outbreak can't push the user's own warning out of range. Set
 *  well above a realistic simultaneous-warning count (the old value, 50,
 *  was smaller than a single big outbreak). */
export const MAX_ACTIVE_ALERTS = 200;

/** Higher = more severe. Drives the pre-cap priority sort so Extreme/
 *  Severe products always survive truncation. */
const SEVERITY_RANK: Record<string, number> = {
  Extreme: 4,
  Severe: 3,
  Moderate: 2,
  Minor: 1,
  Unknown: 0,
};

/** Alerts at or above this rank (Severe, Extreme) are never shed by the cap. */
const PROTECTED_SEVERITY_RANK = 3;

/** The severity values NWS actually emits — the keys of the rank table are the
 *  single source of truth. A feature whose severity is outside this set cannot
 *  be classified as severe-or-not, so it must not be allowed to prove clear. */
const RECOGNIZED_SEVERITIES = new Set(Object.keys(SEVERITY_RANK));

/**
 * Filter → prioritize → cap → normalize the raw NWS feature list into
 * `WeatherAlert[]`. Pure and deterministic (given feature timestamps) so
 * the truncation policy is unit-testable without a live fetch.
 *
 * The sort is the safety-critical part: personalization happens
 * DOWNSTREAM of this cap, so if a Severe/Extreme alert over the user is
 * dropped here it can never warn them. Sorting most-severe-first (stable
 * within a severity, so API order is preserved per tier) guarantees the
 * cap only ever sheds the least-severe products.
 */
export function selectAndNormalizeWeatherAlerts(features: readonly NWSAlert[]): WeatherAlert[] {
  const ranked = [...features]
    .filter((alert) => alert.properties.severity !== 'Unknown')
    .sort((a, b) => (SEVERITY_RANK[b.properties.severity] ?? 0) - (SEVERITY_RANK[a.properties.severity] ?? 0));
  // Never shed a Severe/Extreme product — those are the ones that can be over
  // the user, and personalization runs DOWNSTREAM of this cap. Because `ranked`
  // is severe-first, the protected set is a prefix: extend the slice to cover
  // it so the cap only ever trims the Moderate/Minor tail, even in an outbreak
  // with more Severe/Extreme warnings than MAX_ACTIVE_ALERTS.
  const protectedCount = ranked.filter(
    (a) => (SEVERITY_RANK[a.properties.severity] ?? 0) >= PROTECTED_SEVERITY_RANK,
  ).length;
  return ranked
    .slice(0, Math.max(MAX_ACTIVE_ALERTS, protectedCount))
    .map((alert) => {
      const rings = extractPolygonRings(alert.geometry);
      const coords = rings[0] ?? [];
      return {
        id: alert.id,
        event: alert.properties.event,
        severity: alert.properties.severity as WeatherAlert['severity'],
        headline: alert.properties.headline,
        description: alert.properties.description?.slice(0, 500) ?? '',
        areaDesc: alert.properties.areaDesc,
        onset: new Date(alert.properties.onset),
        expires: new Date(alert.properties.expires),
        coordinates: coords,
        // Only carry the multi-ring array when there is genuinely more than the
        // first ring — single-ring alerts stay lean and read `coordinates`.
        polygonRings: rings.length > 1 ? rings : undefined,
        centroid: calculateCentroid(coords),
        ugcZones: alert.properties.geocode?.UGC ?? [],
      };
    });
}

/**
 * True when a normalized alert carries NO way to place it against a saved point:
 * no USABLE polygon ring AND no UGC zone. "Usable" mirrors `alertMatchRings`
 * (weather-exposure.ts), which discards any ring with fewer than three vertices
 * before matching — a 1- or 2-vertex ring places nothing, so `computeAlertExposure`
 * returns a low exposure without throwing and the severe-alert loop never marks
 * matching degraded, letting the clear decision run `confirm_clear` off a severe
 * warning it could not actually evaluate. The loop uses this to route those
 * alerts to `revoke_confirmation` instead. Keeping the >=3 threshold here in
 * lockstep with the matcher is load-bearing: a looser check re-opens the drop.
 * An alert with EITHER a ring of >=3 vertices OR a UGC zone is evaluable (reads
 * false).
 */
export function isAlertSpatiallyUnevaluable(alert: WeatherAlert): boolean {
  const rings = alert.polygonRings && alert.polygonRings.length > 0
    ? alert.polygonRings
    : [alert.coordinates];
  const hasUsableRing = rings.some((ring) => ring.length >= 3);
  return !hasUsableRing && alert.ugcZones.length === 0;
}

/**
 * Turn a parsed NWS active-alerts body into the normalized feed, or THROW when
 * the body is malformed. A successful HTTP 200 whose payload has no `features`
 * array is corrupt, not a clear sky: NWS always returns a `features` array (it
 * is empty only when there are genuinely no active alerts). Returning `[]` on a
 * corrupt body would let the circuit breaker log a live success — the feed then
 * reads fresh and the loader can confirm "all clear" off garbage, the same
 * fail-open we close for failed fetches. Throwing routes the breaker to
 * `unavailable` so the clear is withheld. A VALID empty `features: []` still
 * passes through and legitimately proves clear.
 *
 * Validating the container is not enough: a feature we cannot classify by
 * severity (missing or unrecognized value) would survive normalization as a
 * non-severe alert, skip the severe loop, and reach `confirm_clear` — a
 * fail-open, since that corrupt entry could be masking a Severe warning. Any
 * such feature throws too, on the same fail-closed principle. The valid NWS
 * value 'Unknown' is recognized (well-formed) and passes; it is merely filtered
 * downstream by `selectAndNormalizeWeatherAlerts`.
 */
export function normalizeWeatherAlertsResponse(data: NWSResponse | null | undefined): WeatherAlert[] {
  if (!data || !Array.isArray(data.features)) {
    throw new Error('NWS alerts response missing features array');
  }
  for (const feature of data.features) {
    if (!RECOGNIZED_SEVERITIES.has(feature?.properties?.severity as string)) {
      throw new Error('NWS alert feature has unclassifiable severity');
    }
  }
  return selectAndNormalizeWeatherAlerts(data.features);
}

export async function fetchWeatherAlerts(): Promise<WeatherAlert[]> {
  return breaker.execute(async () => {
 const response = await fetch(NWS_API, {
 headers: { 'User-Agent': 'CrystalBall/1.0' }
 });

 if (!response.ok) throw new Error(`HTTP ${response.status}`);

 return normalizeWeatherAlertsResponse(await response.json() as NWSResponse);
  }, []);
}

export function getWeatherStatus(): string {
  return breaker.getStatus();
}

/** Live | recent-cache | nothing-usable — the breaker's own read of the last
 *  fetch outcome. Mirrors `BreakerDataMode` but narrowed to what the weather
 *  clear decision needs. */
export type WeatherFeedMode = 'live' | 'cached' | 'unavailable';

/** Honest snapshot of the NWS feed's currency, taken straight from the circuit
 *  breaker (not the offline-cache wrapper, which always reports success because
 *  the breaker never throws). `timestamp` is when the underlying data was last
 *  refreshed (epoch ms), or null when nothing has been fetched. */
export interface WeatherFeedState {
  mode: WeatherFeedMode;
  timestamp: number | null;
}

/** The freshness window for a CACHED read to still authorize a clear. Matches
 *  the breaker's `cacheTtlMs` above: cache older than this is too stale to
 *  prove "all clear" over a possible new storm. */
export const WEATHER_FEED_TTL_MS = 30 * 60 * 1000;

/**
 * The current NWS-alerts feed state, read from the circuit breaker's last
 * fetch outcome. The data-loader reads this RIGHT AFTER awaiting the weather
 * fetch so it reflects THIS tick, then feeds it to `isWeatherFeedFresh` to
 * decide whether an empty candidate set is a real "all clear" or just a failed
 * feed that must not clear the chip.
 */
export function getWeatherAlertsFeedState(): WeatherFeedState {
  const { mode, timestamp } = breaker.getDataState();
  return { mode, timestamp };
}

/**
 * Whether the weather feed is current enough to PROVE a clear (drop the
 * personal weather threat). Requires an in-window read for BOTH live and
 * cached modes: a finite timestamp whose age is within `[0, ttlMs]`. `mode`
 * alone is never proof of currency — the breaker can report a `live` read
 * whose timestamp is hours old (no fetch has refreshed it), and a bare
 * `mode:'live'` clear off that stale read re-introduces the "all clear during
 * a storm" fail-open. An `unavailable` feed (failed fetch, no usable cache),
 * a missing/non-finite timestamp, or a future timestamp (clock skew → negative
 * age) all fail closed.
 */
export function isWeatherFeedFresh(
  state: WeatherFeedState,
  now: number = Date.now(),
  ttlMs: number = WEATHER_FEED_TTL_MS,
): boolean {
  if (state.mode === 'unavailable') return false;
  if (state.timestamp === null || !Number.isFinite(state.timestamp)) return false;
  const age = now - state.timestamp;
  return age >= 0 && age <= ttlMs;
}

interface NWSPointZones {
  properties?: { forecastZone?: string; county?: string };
}

/** Derive a location's own UGC codes (forecast zone + county) from NWS
 *  `/points/{lat},{lon}`. The codes are the last path segment of the
 *  `forecastZone` / `county` URLs (e.g. `INZ001`).
 *
 *  Failure semantics matter: this resolver is the DEFAULT behind
 *  `resolveSavedPlaceZonesWithHealth`, whose `degraded` flag lets the clear
 *  decision withhold "all clear" while a place's zones are UNKNOWN. That flag
 *  only flips when the resolver THROWS, so a swallow-and-return-`[]` here would
 *  make `degraded` permanently false and re-open the fail-open it exists to
 *  close. Therefore: THROW on an ambiguous failure (network/timeout/5xx, or a
 *  200 whose payload carries no parseable zone codes — every real NWS point
 *  returns at least a forecastZone, so zero codes means the zones are UNKNOWN,
 *  not a genuinely zone-less place), and return `[]` ONLY on the one honest
 *  empty (404 = NWS has no point here). Callers that want the old best-effort
 *  behavior wrap this in their own try/catch (the adapter does). */
export async function fetchUgcZonesForPoint(lat: number, lon: number): Promise<string[]> {
  const res = await fetch(`https://api.weather.gov/points/${lat},${lon}`, {
    headers: { 'User-Agent': 'CrystalBall/1.0', Accept: 'application/geo+json' },
    signal: AbortSignal.timeout(8000),
  });
  // 404 → this coordinate genuinely has no NWS point (e.g. offshore): an honest
  // empty, not a degradation. Any other non-OK status (5xx, throttling) leaves
  // the zones UNKNOWN — propagate so the caller marks the batch degraded.
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = await res.json() as NWSPointZones;
  const zones = [payload.properties?.forecastZone, payload.properties?.county]
    .map((url) => url?.split('/').pop() ?? '')
    .filter((code) => /^[A-Z]{2}[CZ]\d{3}$/.test(code));
  // A 200 with zero parseable codes is anomalous (every real point returns at
  // least a forecastZone): the zones are UNKNOWN, so throw to mark the batch
  // degraded rather than authorize an all-clear for a zone-only severe alert.
  if (zones.length === 0) throw new Error('NWS /points returned no parseable zone codes');
  return [...new Set(zones)];
}

/**
 * Keep only the finite [lon, lat] vertices of one ring. A corrupt NWS body can
 * carry non-finite coordinates (null / NaN / strings); a ring of such vertices
 * has length >= 3 yet places nothing — point-in-polygon against NaN never
 * matches, so downstream it would read evaluable while silently matching no one
 * and let a severe warning reach a false clear. Sanitizing at this single
 * producer keeps the unevaluable predicate and the polygon matcher — both of
 * which read these rings — honest by construction.
 */
function toFiniteRing(ring?: number[][]): [number, number][] {
  if (!Array.isArray(ring)) return [];
  const out: [number, number][] = [];
  for (const c of ring) {
    const lon = c?.[0];
    const lat = c?.[1];
    if (typeof lon === 'number' && Number.isFinite(lon) && typeof lat === 'number' && Number.isFinite(lat)) {
      out.push([lon, lat]);
    }
  }
  return out;
}

/**
 * Every OUTER ring of the alert geometry: one ring for a Polygon, one ring per
 * sub-polygon for a MultiPolygon. NWS issues MultiPolygon warnings routinely (a
 * single product covering disjoint areas). The old single-ring extraction kept
 * only `coords[0][0]` — the FIRST sub-polygon — so a warning whose 2nd+
 * sub-polygon covered the user matched nothing and read as clear. Interior
 * holes (rings after index 0 within a polygon) are ignored: a warning applies
 * to its whole outer boundary, and honoring holes would only shrink coverage.
 */
function extractPolygonRings(geometry?: NWSAlert['geometry']): [number, number][][] {
  if (!geometry) return [];

  try {
 if (geometry.type === 'Polygon') {
 const coords = geometry.coordinates as unknown as number[][][];
 const ring = toFiniteRing(coords[0]);
 return ring.length > 0 ? [ring] : [];
 }
 if (geometry.type === 'MultiPolygon') {
 const coords = geometry.coordinates as unknown as number[][][][];
 return coords
 .map((poly) => toFiniteRing(poly[0]))
 .filter((ring) => ring.length > 0);
 }
  } catch {
 return [];
  }
  return [];
}

function calculateCentroid(coords: [number, number][]): [number, number] | undefined {
  if (coords.length === 0) return undefined;

  const sum = coords.reduce(
 (acc, [lon, lat]) => [acc[0] + lon, acc[1] + lat],
 [0, 0]
  );

  return [sum[0] / coords.length, sum[1] / coords.length];
}

export function getSeverityColor(severity: WeatherAlert['severity']): string {
  switch (severity) {
 case 'Extreme': { return getCSSColor('--semantic-critical');
 }
 case 'Severe': { return getCSSColor('--semantic-high');
 }
 case 'Moderate': { return getCSSColor('--semantic-elevated');
 }
 case 'Minor': { return getCSSColor('--semantic-elevated');
 }
 default: { return getCSSColor('--text-dim');
 }
  }
}

export interface OpenMeteoConditions {
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
  precipitation: number;
  weatherCode: number;
  isDay: boolean;
  uvIndex: number | null;
  fetchedAt: Date;
  source: 'open-meteo';
}

const _openMeteoCache = new Map<string, { data: OpenMeteoConditions; ts: number }>();
const OPEN_METEO_TTL_MS = 10 * 60 * 1000;

export async function fetchOpenMeteoConditions(
  lat: number,
  lon: number,
): Promise<OpenMeteoConditions | null> {
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = _openMeteoCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < OPEN_METEO_TTL_MS) return cached.data;

  try {
    const url = `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,weather_code,is_day,uv_index` +
      `&wind_speed_unit=kmh&timezone=auto`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const raw = await res.json() as { current?: Record<string, number | boolean | null> };
    if (!raw || typeof raw !== 'object') return null;
    const c = raw.current;
    if (!c) return null;
    const data: OpenMeteoConditions = {
      temperature: typeof c.temperature_2m === 'number' ? c.temperature_2m : 0,
      feelsLike: typeof c.apparent_temperature === 'number' ? c.apparent_temperature : 0,
      humidity: typeof c.relative_humidity_2m === 'number' ? c.relative_humidity_2m : 0,
      windSpeed: typeof c.wind_speed_10m === 'number' ? c.wind_speed_10m : 0,
      windDirection: typeof c.wind_direction_10m === 'number' ? c.wind_direction_10m : 0,
      precipitation: typeof c.precipitation === 'number' ? c.precipitation : 0,
      weatherCode: typeof c.weather_code === 'number' ? c.weather_code : 0,
      isDay: c.is_day === 1,
      uvIndex: typeof c.uv_index === 'number' ? c.uv_index : null,
      fetchedAt: new Date(),
      source: 'open-meteo',
    };
    _openMeteoCache.set(cacheKey, { data, ts: Date.now() });
    return data;
  } catch {
    return null;
  }
}

// ── Site-specific helpers for Data Center Readiness ─────────────

import type { ForecastSlot, SiteAirQuality, ConnectivitySignal } from './datacenter/datacenter-types.ts';

/** WMO weather code → single representative emoji. */
export function wmoCodeEmoji(code: number): string {
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤';
  if (code === 3) return '☁️';
  if (code <= 48) return '🌫';
  if (code <= 57) return '🌦';
  if (code <= 67) return '🌧';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌦';
  if (code <= 86) return '🌨';
  return '⛈';
}

/** Wind direction degrees → 8-point compass abbreviation. */
export function degreesToCompass(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8]!;
}

/** Celsius → Fahrenheit (rounded). */
export function cToF(c: number): number {
  return Math.round(c * 9 / 5 + 32);
}

/** US AQI value → short descriptive label. */
export function aqiLabel(aqi: number): string {
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Sensitive';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very Unhealthy';
  return 'Hazardous';
}

const _forecast24hCache = new Map<string, { data: ForecastSlot[]; ts: number }>();
const FORECAST_TTL_MS = 30 * 60 * 1000;

/** Fetch 4 forecast slots at +0h, +6h, +12h, +18h for a given location. */
export async function fetchSite24hForecast(lat: number, lon: number): Promise<ForecastSlot[]> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = _forecast24hCache.get(key);
  if (cached && Date.now() - cached.ts < FORECAST_TTL_MS) return cached.data;

  try {
    const url = `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,precipitation_probability,weather_code` +
      `&forecast_days=1&timezone=auto`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const raw = await res.json() as {
      hourly?: {
        time?: string[];
        temperature_2m?: number[];
        precipitation_probability?: (number | null)[];
        weather_code?: number[];
      };
    };
    if (!raw || typeof raw !== 'object') return [];
    const h = raw.hourly;
    if (!h?.time?.length) return [];

    const nowHour = new Date().getHours();
    const slots: ForecastSlot[] = [];
    for (const offset of [0, 6, 12, 18]) {
      const idx = (nowHour + offset) % 24;
      if (idx >= (h.temperature_2m?.length ?? 0)) continue;
      slots.push({
        offsetHours: offset,
        tempC: h.temperature_2m?.[idx] ?? 0,
        precipProbabilityPct: h.precipitation_probability?.[idx] ?? 0,
        weatherCode: h.weather_code?.[idx] ?? 0,
      });
    }
    _forecast24hCache.set(key, { data: slots, ts: Date.now() });
    return slots;
  } catch {
    return [];
  }
}

const _aqCache = new Map<string, { data: SiteAirQuality; ts: number }>();
const AQ_TTL_MS = 30 * 60 * 1000;

/** Fetch US AQI + PM2.5 for a specific location via open-meteo air quality API. */
export async function fetchSiteAirQuality(lat: number, lon: number): Promise<SiteAirQuality | null> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = _aqCache.get(key);
  if (cached && Date.now() - cached.ts < AQ_TTL_MS) return cached.data;

  try {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality` +
      `?latitude=${lat}&longitude=${lon}&current=us_aqi,pm2_5`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const raw = await res.json() as { current?: { us_aqi?: number | null; pm2_5?: number | null } };
    if (!raw || typeof raw !== 'object') return null;
    const c = raw.current;
    if (!c) return null;
    const data: SiteAirQuality = {
      usAqi: typeof c.us_aqi === 'number' ? c.us_aqi : null,
      pm25: typeof c.pm2_5 === 'number' ? c.pm2_5 : null,
    };
    _aqCache.set(key, { data, ts: Date.now() });
    return data;
  } catch {
    return null;
  }
}

let _connCache: { data: ConnectivitySignal; ts: number } | null = null;
const CONN_TTL_MS = 5 * 60 * 1000;

/** Check Cloudflare + Fastly status pages and return a blended connectivity signal. */
export async function fetchConnectivitySignal(): Promise<ConnectivitySignal> {
  if (_connCache && Date.now() - _connCache.ts < CONN_TTL_MS) return _connCache.data;

  const [cf, fastly] = await Promise.allSettled([
    fetch('https://www.cloudflarestatus.com/api/v2/summary.json', { signal: AbortSignal.timeout(5000) })
      .then((r) => r.json() as Promise<{ status?: { indicator?: string } }>)
      .then((j) => j.status?.indicator === 'none'),
    fetch('https://www.fastlystatus.com/status.json', { signal: AbortSignal.timeout(5000) })
      .then((r) => r.json() as Promise<{ status?: { indicator?: string } }>)
      .then((j) => j.status?.indicator === 'none'),
  ]);

  const cfOk = cf.status === 'fulfilled' ? cf.value : null;
  const fastlyOk = fastly.status === 'fulfilled' ? fastly.value : null;

  let status: ConnectivitySignal['status'] = 'normal';
  if (cfOk === false || fastlyOk === false) status = 'degraded';
  if (cfOk === false && fastlyOk === false) status = 'outage';

  const data: ConnectivitySignal = { status, cloudflare: cfOk, fastly: fastlyOk };
  _connCache = { data, ts: Date.now() };
  return data;
}
