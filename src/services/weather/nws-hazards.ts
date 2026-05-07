/**
 * NWS / NHC / USDM / NSIDC weather-hazard intelligence — PR 1.
 *
 * This module is the parser + facade layer for four hazard data
 * sources. The actual HTTPS fetch and CORS proxying happen in the
 * sidecar (`/api/weather/{alerts,tropical,drought,seaice}`). The
 * pure parsers here are unit-tested with static fixtures.
 *
 * Sources:
 *   • NWS active alerts            (api.weather.gov/alerts/active)
 *   • NHC current storms + tracks  (nhc.noaa.gov/CurrentStorms.json)
 *   • US Drought Monitor           (usdm.climate.unl.edu/data/tabular)
 *   • NSIDC Arctic sea-ice extent  (sidads.colorado.edu daily CSV)
 *
 * Existing top-level files (`src/services/weather.ts`,
 * `src/services/tropical-cyclones.ts`) cover overlapping pieces of
 * the alert and tropical data. This module is the unified
 * "weather hazards" view used by the new WeatherHazardPanel and
 * the globe overlays.
 */

import { getApiBaseUrl } from '../runtime.ts';

// ── Severity filter ───────────────────────────────────────────────────

const HIGH_SEVERITY = new Set(['Extreme', 'Severe']);

const FILTERED_EVENT_PREFIXES = [
  'Tornado Warning',
  'Hurricane Warning',
  'Flash Flood Warning',
  'Winter Storm Warning',
  'Tropical Storm Warning',
  'Severe Thunderstorm Warning',
  'Blizzard Warning',
  'Ice Storm Warning',
  'Storm Surge Warning',
  'Extreme Wind Warning',
];

// ── NWS alert types ───────────────────────────────────────────────────

export type AlertSeverity = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
export type AlertCertainty = 'Observed' | 'Likely' | 'Possible' | 'Unlikely' | 'Unknown';
export type AlertUrgency = 'Immediate' | 'Expected' | 'Future' | 'Past' | 'Unknown';

export interface NwsHazardAlert {
  id: string;
  event: string;
  severity: AlertSeverity;
  certainty: AlertCertainty;
  urgency: AlertUrgency;
  headline: string;
  areaDesc: string;
  sent: string;
  expires: string;
  /** Geo: present when the upstream feature included a geometry. */
  geometry?: AlertGeometry;
  /** Color category for UI rendering. */
  category: AlertCategory;
}

export type AlertGeometry =
  | { kind: 'Polygon'; rings: number[][][] }
  | { kind: 'MultiPolygon'; polygons: number[][][][] }
  | { kind: 'Point'; lng: number; lat: number };

export type AlertCategory = 'tornado' | 'hurricane' | 'flood' | 'winter' | 'thunderstorm' | 'other';

/** Map an alert event string → category. Used by both the panel and
 *  the globe overlay to choose a color. */
export function categorizeAlertEvent(event: string): AlertCategory {
  const e = event.toLowerCase();
  if (e.includes('tornado')) return 'tornado';
  if (e.includes('hurricane') || e.includes('tropical') || e.includes('storm surge')) return 'hurricane';
  if (e.includes('flood')) return 'flood';
  if (e.includes('winter') || e.includes('blizzard') || e.includes('ice storm') || e.includes('snow')) return 'winter';
  if (e.includes('thunderstorm')) return 'thunderstorm';
  return 'other';
}

/** Color (hex) per category. */
export const ALERT_CATEGORY_COLOR: Record<AlertCategory, string> = {
  tornado: '#dc2626',       // red
  hurricane: '#9333ea',     // purple
  flood: '#2563eb',         // blue
  winter: '#0d9488',        // teal
  thunderstorm: '#f59e0b',  // amber
  other: '#6b7280',         // gray
};

/** Coerce an unknown value to string without triggering the
 *  "[object Object]" footgun for non-primitive values. */
function toStr(x: unknown, fallback = ''): string {
  if (typeof x === 'string') return x;
  if (typeof x === 'number' || typeof x === 'boolean') return String(x);
  return fallback;
}

// ── NWS alert parser ──────────────────────────────────────────────────

/** Parse a raw NWS GeoJSON FeatureCollection into severity-filtered
 *  hazard alerts. */
export function parseNwsAlerts(raw: unknown): NwsHazardAlert[] {
  const features = extractFeatures(raw);
  const out: NwsHazardAlert[] = [];
  for (const f of features) {
    const props = (f as { properties?: Record<string, unknown> }).properties ?? {};
    const event = toStr(props.event);
    const severity = normalizeSeverity(props.severity);
    // Allow severity Moderate but only for events explicitly in the
    // high-impact warning list (NWS sometimes labels Tornado Warning
    // as Moderate during routine reissues).
    if (!HIGH_SEVERITY.has(severity) && !matchesFilteredEventPrefix(event)) continue;
    out.push({
      id: toStr(props.id),
      event,
      severity,
      certainty: normalizeCertainty(props.certainty),
      urgency: normalizeUrgency(props.urgency),
      headline: toStr(props.headline),
      areaDesc: toStr(props.areaDesc),
      sent: toStr(props.sent),
      expires: toStr(props.expires),
      geometry: extractAlertGeometry((f as { geometry?: unknown }).geometry),
      category: categorizeAlertEvent(event),
    });
  }
  return out;
}

function matchesFilteredEventPrefix(event: string): boolean {
  for (const prefix of FILTERED_EVENT_PREFIXES) {
    if (event.startsWith(prefix)) return true;
  }
  return false;
}

function extractFeatures(raw: unknown): unknown[] {
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as { features?: unknown };
  return Array.isArray(r.features) ? r.features : [];
}

function normalizeSeverity(x: unknown): AlertSeverity {
  const s = toStr(x);
  if (s === 'Extreme' || s === 'Severe' || s === 'Moderate' || s === 'Minor') return s;
  return 'Unknown';
}
function normalizeCertainty(x: unknown): AlertCertainty {
  const s = toStr(x);
  if (s === 'Observed' || s === 'Likely' || s === 'Possible' || s === 'Unlikely') return s;
  return 'Unknown';
}
function normalizeUrgency(x: unknown): AlertUrgency {
  const s = toStr(x);
  if (s === 'Immediate' || s === 'Expected' || s === 'Future' || s === 'Past') return s;
  return 'Unknown';
}

function extractAlertGeometry(geom: unknown): AlertGeometry | undefined {
  if (!geom || typeof geom !== 'object') return undefined;
  const g = geom as { type?: string; coordinates?: unknown };
  if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
    return { kind: 'Polygon', rings: g.coordinates as number[][][] };
  }
  if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
    return { kind: 'MultiPolygon', polygons: g.coordinates as number[][][][] };
  }
  if (g.type === 'Point' && Array.isArray(g.coordinates)) {
    const [lng, lat] = g.coordinates as number[];
    if (typeof lng === 'number' && typeof lat === 'number') {
      return { kind: 'Point', lng, lat };
    }
  }
  return undefined;
}

// ── Tropical (NHC) types ──────────────────────────────────────────────

export type TropicalCategory =
  | 'TD'      // tropical depression
  | 'TS'      // tropical storm
  | 'HU1' | 'HU2' | 'HU3' | 'HU4' | 'HU5'
  | 'PT'      // post-tropical
  | 'unknown';

export interface NhcStorm {
  id: string;
  name: string;
  classification: string;
  category: TropicalCategory;
  basin: 'AL' | 'EP' | 'CP' | 'WP' | 'IO' | 'SH' | 'unknown';
  /** Current center. */
  position: { lat: number; lng: number };
  /** Maximum sustained wind, mph. */
  intensityMph: number;
  /** Min central pressure, mb. */
  pressureMb?: number;
  /** Movement: direction in degrees (0-360) + speed mph. */
  movement?: { headingDeg: number; speedMph: number };
  advisoryNumber: string;
  publicAdvisoryUrl?: string;
  forecastTrackUrl?: string;
}

/** Parse the NHC CurrentStorms.json payload. */
export function parseNhcStorms(raw: unknown): NhcStorm[] {
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as { activeStorms?: unknown };
  if (!Array.isArray(r.activeStorms)) return [];
  const out: NhcStorm[] = [];
  for (const s of r.activeStorms) {
    if (!s || typeof s !== 'object') continue;
    const x = s as Record<string, unknown>;
    const lat = parseNumeric(x.latitudeNumeric ?? x.latitude);
    const lng = parseNumeric(x.longitudeNumeric ?? x.longitude);
    if (lat === null || lng === null) continue;
    const intensity = parseNumeric(x.intensity) ?? 0;
    const classification = toStr(x.classification);
    const idCandidate = toStr(x.id) || toStr(x.binNumber) || `${toStr(x.basin, 'AL')}-${toStr(x.atcfID)}`;
    out.push({
      id: idCandidate,
      name: toStr(x.name, 'unnamed'),
      classification,
      category: stormCategoryFor(classification, intensity),
      basin: normalizeBasin(x.basin),
      position: { lat, lng },
      intensityMph: intensity,
      pressureMb: parseNumeric(x.pressure) ?? undefined,
      movement: parseMovement(x.movementDir, x.movementSpeed),
      advisoryNumber: toStr(x.advNum),
      publicAdvisoryUrl: typeof x.publicAdvisory === 'string' ? x.publicAdvisory : undefined,
      forecastTrackUrl: typeof x.forecastTrack === 'string' ? x.forecastTrack : undefined,
    });
  }
  return out;
}

function parseNumeric(x: unknown): number | null {
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  if (typeof x === 'string') {
    const v = Number.parseFloat(x);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

function normalizeBasin(x: unknown): NhcStorm['basin'] {
  const s = toStr(x).toUpperCase();
  if (s === 'AL' || s === 'EP' || s === 'CP' || s === 'WP' || s === 'IO' || s === 'SH') return s;
  return 'unknown';
}

function parseMovement(dir: unknown, speed: unknown): NhcStorm['movement'] {
  const headingDeg = parseNumeric(dir);
  const speedMph = parseNumeric(speed);
  if (headingDeg === null || speedMph === null) return undefined;
  return { headingDeg, speedMph };
}

/** Saffir-Simpson-style category from classification text + intensity.
 *  Used by the panel + the globe billboard. */
export function stormCategoryFor(classification: string, intensityMph: number): TropicalCategory {
  const c = classification.toUpperCase();
  if (c.startsWith('PT') || c.includes('POST')) return 'PT';
  if (c.startsWith('TD') || c.includes('DEPRESSION')) return 'TD';
  // Saffir-Simpson:
  if (intensityMph >= 157) return 'HU5';
  if (intensityMph >= 130) return 'HU4';
  if (intensityMph >= 111) return 'HU3';
  if (intensityMph >= 96) return 'HU2';
  if (intensityMph >= 74) return 'HU1';
  if (c.startsWith('TS') || c.includes('STORM') || intensityMph >= 39) return 'TS';
  return 'unknown';
}

// ── Hurricane track parser (KMZ/GeoJSON) ──────────────────────────────

export interface HurricaneTrack {
  stormId: string;
  forecastPoints: { lat: number; lng: number; advisoryHour: number; intensityMph?: number }[];
  /** The "cone of uncertainty" polygon. */
  uncertaintyCone: number[][] | null;
}

/** Parse the NHC forecast track GeoJSON. The NHC publishes track
 *  forecasts as GeoJSON Feature objects with multiple geometry layers
 *  (line, points, cone). */
export function parseHurricaneTrack(raw: unknown, stormId: string): HurricaneTrack | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { features?: unknown };
  if (!Array.isArray(r.features)) return null;
  const points: HurricaneTrack['forecastPoints'] = [];
  let cone: number[][] | null = null;
  for (const f of r.features) {
    if (!f || typeof f !== 'object') continue;
    const geom = (f as { geometry?: { type?: string; coordinates?: unknown } }).geometry;
    const props = (f as { properties?: Record<string, unknown> }).properties ?? {};
    if (!geom) continue;
    const point = extractTrackPoint(geom, props, points.length);
    if (point) {
      points.push(point);
      continue;
    }
    const polygon = extractTrackCone(geom);
    if (polygon) cone = polygon;
  }
  if (points.length === 0 && cone === null) return null;
  return { stormId, forecastPoints: points, uncertaintyCone: cone };
}

function extractTrackPoint(
  geom: { type?: string; coordinates?: unknown },
  props: Record<string, unknown>,
  pointIndex: number,
): HurricaneTrack['forecastPoints'][number] | null {
  if (geom.type !== 'Point' || !Array.isArray(geom.coordinates)) return null;
  const [lng, lat] = geom.coordinates as number[];
  if (typeof lng !== 'number' || typeof lat !== 'number') return null;
  return {
    lat,
    lng,
    advisoryHour: parseNumeric(props.FLDATELBL ?? props.HOUR) ?? pointIndex * 12,
    intensityMph: parseNumeric(props.MAXWIND) ?? undefined,
  };
}

function extractTrackCone(geom: { type?: string; coordinates?: unknown }): number[][] | null {
  if (geom.type !== 'Polygon' || !Array.isArray(geom.coordinates)) return null;
  const ring = (geom.coordinates as unknown[][])[0];
  return Array.isArray(ring) ? (ring as number[][]) : null;
}

// ── Drought Monitor types ─────────────────────────────────────────────

/** Per-USDM-week record: D0–D4 = % of US area in each drought severity. */
export interface DroughtSnapshot {
  weekDate: string;          // YYYY-MM-DD
  noneFraction: number;      // 0..1
  d0Fraction: number;        // abnormally dry
  d1Fraction: number;        // moderate
  d2Fraction: number;        // severe
  d3Fraction: number;        // extreme
  d4Fraction: number;        // exceptional
}

/** Parse the USDM CSV (two-column header: MapDate, then percent
 *  values). The CSV uses category percentages where each row is a
 *  weekly snapshot for one state — the "co_usdm.csv" path is for
 *  CONUS rollup, not Colorado. */
export function parseDroughtCsv(csv: string): DroughtSnapshot[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0]!.split(',').map((s) => s.trim().toLowerCase());
  const idxMap: Record<string, number> = {};
  for (const [idx, name] of header.entries()) idxMap[name] = idx;
  const out: DroughtSnapshot[] = [];
  for (const raw of lines.slice(1)) {
    const cells = raw.split(',').map((s) => s.trim());
    if (cells.length < header.length) continue;
    const date = cells[idxMap.mapdate ?? 0] ?? '';
    if (!date) continue;
    const fNone = pctToFraction(cells[idxMap.none ?? 1]);
    const f0 = pctToFraction(cells[idxMap.d0 ?? 2]);
    const f1 = pctToFraction(cells[idxMap.d1 ?? 3]);
    const f2 = pctToFraction(cells[idxMap.d2 ?? 4]);
    const f3 = pctToFraction(cells[idxMap.d3 ?? 5]);
    const f4 = pctToFraction(cells[idxMap.d4 ?? 6]);
    out.push({
      weekDate: normalizeDroughtDate(date),
      noneFraction: fNone,
      d0Fraction: f0,
      d1Fraction: f1,
      d2Fraction: f2,
      d3Fraction: f3,
      d4Fraction: f4,
    });
  }
  return out;
}

function pctToFraction(x: string | undefined): number {
  if (!x) return 0;
  const v = Number.parseFloat(x);
  if (!Number.isFinite(v)) return 0;
  if (v > 1.5) return v / 100;
  return v;
}

function normalizeDroughtDate(s: string): string {
  // USDM CSV emits YYYYMMDD or M/D/YYYY; normalize to ISO.
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [m, d, y] = s.split('/');
    return `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
  }
  return s;
}

/** Pick the most recent snapshot from a list (by ISO weekDate). */
export function latestDroughtSnapshot(rows: readonly DroughtSnapshot[]): DroughtSnapshot | undefined {
  if (rows.length === 0) return undefined;
  let best = rows[0]!;
  for (const r of rows) if (r.weekDate > best.weekDate) best = r;
  return best;
}

// ── NSIDC sea-ice types ───────────────────────────────────────────────

export interface SeaIceSnapshot {
  date: string;            // YYYY-MM-DD
  extentMillionKm2: number;
  /** 1981-2010 climatological median for this day-of-year. */
  medianMillionKm2?: number;
  anomalyMillionKm2?: number;
  /** True when the extent ties or sets the all-time record low for
   *  this day-of-year across the time series. */
  isRecordLow: boolean;
}

/** Parse the NSIDC daily sea-ice CSV. Format (as of 2024):
 *    Year, Month, Day, Extent, Missing, Source Data
 *  Optional climatology columns may follow.
 */
export function parseSeaIceCsv(csv: string): SeaIceSnapshot[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 3) return [];
  // Skip the unit-header rows (some NSIDC files have 2 header lines).
  const dataStart = findSeaIceDataStart(lines);
  const out: SeaIceSnapshot[] = [];
  for (const raw of lines.slice(dataStart)) {
    const cells = raw.split(',').map((s) => s.trim());
    if (cells.length < 4) continue;
    const yr = Number.parseInt(cells[0] ?? '', 10);
    const mo = Number.parseInt(cells[1] ?? '', 10);
    const dy = Number.parseInt(cells[2] ?? '', 10);
    const extent = Number.parseFloat(cells[3] ?? '');
    if (!Number.isFinite(yr) || !Number.isFinite(mo) || !Number.isFinite(dy) || !Number.isFinite(extent)) continue;
    if (extent < 0) continue;
    out.push({
      date: `${String(yr).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(dy).padStart(2, '0')}`,
      extentMillionKm2: extent,
      isRecordLow: false,
    });
  }
  return computeSeaIceClimatology(out);
}

function findSeaIceDataStart(lines: readonly string[]): number {
  for (const [idx, line] of lines.entries()) {
    const cells = line.split(',').map((s) => s.trim());
    const yr = Number.parseInt(cells[0] ?? '', 10);
    if (Number.isFinite(yr) && yr >= 1900 && yr <= 2200) return idx;
  }
  return 1;
}

/** Compute per-day-of-year median (1981-2010) + anomaly + record-low
 *  flag. Mutates and returns the same array. */
export function computeSeaIceClimatology(rows: SeaIceSnapshot[]): SeaIceSnapshot[] {
  const medianByDoy = buildMedianByDoy(rows);
  const minByDoy = buildMinByDoy(rows);
  for (const r of rows) {
    const key = doyKey(r.date);
    if (!key) continue;
    const median = medianByDoy.get(key);
    if (typeof median === 'number') {
      r.medianMillionKm2 = median;
      r.anomalyMillionKm2 = r.extentMillionKm2 - median;
    }
    const min = minByDoy.get(key);
    if (typeof min === 'number' && Math.abs(r.extentMillionKm2 - min) < 0.005) {
      r.isRecordLow = true;
    }
  }
  return rows;
}

function doyKey(date: string): string | null {
  const [, mo, dy] = date.split('-');
  return mo && dy ? `${mo}-${dy}` : null;
}

function buildMedianByDoy(rows: readonly SeaIceSnapshot[]): Map<string, number> {
  const byDoy = new Map<string, number[]>();
  for (const r of rows) {
    const [yr] = r.date.split('-');
    const yearNum = Number(yr);
    if (yearNum < 1981 || yearNum > 2010) continue;
    const key = doyKey(r.date);
    if (!key) continue;
    const list = byDoy.get(key) ?? [];
    list.push(r.extentMillionKm2);
    byDoy.set(key, list);
  }
  const out = new Map<string, number>();
  for (const [key, list] of byDoy) {
    const sorted = [...list].sort((a, b) => a - b);
    out.set(key, sorted[Math.floor(sorted.length / 2)] ?? 0);
  }
  return out;
}

function buildMinByDoy(rows: readonly SeaIceSnapshot[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const key = doyKey(r.date);
    if (!key) continue;
    const cur = out.get(key);
    if (cur === undefined || r.extentMillionKm2 < cur) out.set(key, r.extentMillionKm2);
  }
  return out;
}

export function latestSeaIceSnapshot(rows: readonly SeaIceSnapshot[]): SeaIceSnapshot | undefined {
  if (rows.length === 0) return undefined;
  let best = rows[0]!;
  for (const r of rows) if (r.date > best.date) best = r;
  return best;
}

// ── Fetcher facades ───────────────────────────────────────────────────

export interface WeatherHazardSnapshot {
  alerts: NwsHazardAlert[];
  storms: NhcStorm[];
  drought: DroughtSnapshot | undefined;
  seaIce: SeaIceSnapshot | undefined;
  fetchedAt: number;
}

const DEFAULT_TIMEOUT_MS = 12_000;

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`fetch ${url} failed: ${resp.status}`);
  return resp.json();
}

/** Fetch active alerts via the sidecar proxy. */
export async function fetchHazardAlerts(): Promise<NwsHazardAlert[]> {
  const url = `${getApiBaseUrl()}/api/weather/alerts`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const data = await fetchJson(url, ctrl.signal);
    if (Array.isArray(data)) return data as NwsHazardAlert[];
    return parseNwsAlerts(data);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchTropicalStorms(): Promise<NhcStorm[]> {
  const url = `${getApiBaseUrl()}/api/weather/tropical`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const data = await fetchJson(url, ctrl.signal);
    if (Array.isArray(data)) return data as NhcStorm[];
    return parseNhcStorms(data);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchDroughtSnapshot(): Promise<DroughtSnapshot | undefined> {
  const url = `${getApiBaseUrl()}/api/weather/drought`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const data = await fetchJson(url, ctrl.signal);
    if (data && typeof data === 'object' && 'weekDate' in (data as object)) {
      return data as DroughtSnapshot;
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchSeaIceSnapshot(): Promise<SeaIceSnapshot | undefined> {
  const url = `${getApiBaseUrl()}/api/weather/seaice`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const data = await fetchJson(url, ctrl.signal);
    if (data && typeof data === 'object' && 'date' in (data as object)) {
      return data as SeaIceSnapshot;
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchWeatherHazardSnapshot(now: number = Date.now()): Promise<WeatherHazardSnapshot> {
  const [alerts, storms, drought, seaIce] = await Promise.all([
    fetchHazardAlerts(),
    fetchTropicalStorms(),
    fetchDroughtSnapshot(),
    fetchSeaIceSnapshot(),
  ]);
  return { alerts, storms, drought, seaIce, fetchedAt: now };
}

// ── Polling cadence (consumed by the panel host) ──────────────────────

export const WEATHER_HAZARD_POLLING_MS = {
  /** NWS alerts: 2 minute cadence. */
  alerts: 2 * 60 * 1000,
  /** Tropical storms: 30 minute cadence. */
  tropical: 30 * 60 * 1000,
  /** Drought: daily. */
  drought: 24 * 60 * 60 * 1000,
  /** Sea ice: daily. */
  seaIce: 24 * 60 * 60 * 1000,
} as const;
