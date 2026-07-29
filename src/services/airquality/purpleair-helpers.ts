/**
 * PurpleAir pure helpers — EPA NowCast PM2.5 → AQI conversion, sensor
 * filtering, sorting. No DOM, no fetch — testable with static fixtures
 * under tsx without dragging the Vite-only `@/utils` chain.
 *
 * Formula reference: EPA AQI breakpoints (2024 update, same set AirNow
 * publishes today). https://www.airnow.gov/aqi/aqi-basics/
 */

// ── Types ────────────────────────────────────────────────────────────────

export type AqiCategory =
  | 'good'
  | 'moderate'
  | 'sensitive'
  | 'unhealthy'
  | 'very_unhealthy'
  | 'hazardous';

export interface PurpleAirSensor {
  id: number;
  name: string;
  lat: number;
  lon: number;
  pm25: number;
  /** PurpleAir confidence score (0–100). */
  confidence: number;
  /** location_type from upstream: 0 = outdoor, 1 = indoor. */
  locationType: number;
  /** Last seen (epoch ms). null when source omitted it. */
  lastSeen: number | null;
}

export interface ScoredPurpleAirSensor extends PurpleAirSensor {
  aqi: number;
  category: AqiCategory;
}

// ── Constants ────────────────────────────────────────────────────────────

export const MIN_CONFIDENCE = 50;
export const TOP_N_SENSORS = 500;
export const POLL_INTERVAL_MS = 10 * 60 * 1000;

/**
 * EPA AQI breakpoints for PM2.5 (24-hour standard, 2024 update).
 * Each entry: [pm25_low, pm25_high, aqi_low, aqi_high, category]
 *
 * The final row (>= 325.5) caps AQI at 500 to match EPA's hazardous cap.
 */
const PM25_BREAKPOINTS: readonly [number, number, number, number, AqiCategory][] = [
  [0,   9,   0,   50,  'good'],
  [9.1,   35.4,  51,  100, 'moderate'],
  [35.5,  55.4,  101, 150, 'sensitive'],
  [55.5,  125.4, 151, 200, 'unhealthy'],
  [125.5, 225.4, 201, 300, 'very_unhealthy'],
  [225.5, 325.4, 301, 400, 'hazardous'],
  [325.5, 500.4, 401, 500, 'hazardous'],
];

// ── Pure helpers ─────────────────────────────────────────────────────────

/**
 * Truncate PM2.5 to 1 decimal place — the EPA's own AQI-calculation
 * convention, and the precision the breakpoint table above is defined on
 * (each band's boundary sits on a 1-decimal value, e.g. 9.0/9.1, 35.4/35.5).
 * Truncating to a coarser precision (e.g. 2 decimals) leaves a crack between
 * adjacent bands — a reading like 9.05 truncates to itself, which is greater
 * than the first band's 9.0 ceiling but less than the second band's 9.1
 * floor, so it matches neither and pm25ToAqi silently returns null for a
 * perfectly valid reading. Truncates (not rounds) — 9.99 → 9.9, not 10.0.
 * Negative values clamp to 0; non-finite returns null.
 */
export function truncatePm25(pm25: number): number | null {
  if (!Number.isFinite(pm25)) return null;
  if (pm25 < 0) return 0;
  return Math.trunc(pm25 * 10) / 10;
}

/**
 * Convert a single PM2.5 reading (µg/m³) to US EPA AQI.
 * Returns null if input is invalid.
 *
 * Note: this uses the 24-hr PM2.5 breakpoints. PurpleAir returns
 * instantaneous readings, so the result is a snapshot AQI estimate
 * rather than a true 12-hour NowCast. Fine for "is it bad right now?".
 */
export function pm25ToAqi(pm25: number): number | null {
  const c = truncatePm25(pm25);
  if (c === null) return null;
  if (c >= 500.4) return 500;
  for (const [bpLow, bpHigh, iLow, iHigh] of PM25_BREAKPOINTS) {
    if (c >= bpLow && c <= bpHigh) {
      const aqi = ((iHigh - iLow) / (bpHigh - bpLow)) * (c - bpLow) + iLow;
      return Math.round(aqi);
    }
  }
  return null;
}

export function categoryForAqi(aqi: number): AqiCategory {
  if (aqi <= 50) return 'good';
  if (aqi <= 100) return 'moderate';
  if (aqi <= 150) return 'sensitive';
  if (aqi <= 200) return 'unhealthy';
  if (aqi <= 300) return 'very_unhealthy';
  return 'hazardous';
}

/** Filter to outdoor sensors with usable confidence and finite coords. */
export function filterUsable(sensors: PurpleAirSensor[]): PurpleAirSensor[] {
  return sensors.filter(s => (
    s.locationType === 0
    && s.confidence > MIN_CONFIDENCE
    && Number.isFinite(s.lat)
    && Number.isFinite(s.lon)
    && Number.isFinite(s.pm25)
    && s.pm25 >= 0
  ));
}

/** Score every sensor with AQI + category, sort by PM2.5 desc, cap to topN. */
export function scoreAndRank(
  sensors: PurpleAirSensor[],
  topN: number = TOP_N_SENSORS,
): ScoredPurpleAirSensor[] {
  const scored: ScoredPurpleAirSensor[] = [];
  for (const s of sensors) {
    const aqi = pm25ToAqi(s.pm25);
    if (aqi === null) continue;
    scored.push({ ...s, aqi, category: categoryForAqi(aqi) });
  }
  scored.sort((a, b) => b.pm25 - a.pm25);
  return scored.slice(0, topN);
}

/**
 * Hex color per EPA AQI category. Matches the AirNow public palette so
 * the globe dots and the panel sections share visual language.
 */
export function colorForCategory(category: AqiCategory): string {
  switch (category) {
    case 'good': {           return '#00e400';
    }
    case 'moderate': {       return '#ffff00';
    }
    case 'sensitive': {      return '#ff7e00';
    }
    case 'unhealthy': {      return '#ff0000';
    }
    case 'very_unhealthy': { return '#8f3f97';
    }
    case 'hazardous': {      return '#7e0023';
    }
  }
}

// ── Upstream parsers ─────────────────────────────────────────────────────

/**
 * Parse the v1 authenticated `/sensors` response shape:
 *   { data: [[id, pm2.5, lat, lon, location_type, confidence, name, last_seen], ...],
 *     fields: ['sensor_index', 'pm2.5', 'latitude', 'longitude',
 *              'location_type', 'confidence', 'name', 'last_seen'] }
 *
 * Tolerant: skips rows missing required fields, never throws.
 */
export function parseV1SensorsResponse(payload: unknown): PurpleAirSensor[] {
  if (!isObject(payload)) return [];
  const fields = payload.fields;
  const data = payload.data;
  if (!Array.isArray(fields) || !Array.isArray(data)) return [];
  const idx = {
    id:           fields.indexOf('sensor_index'),
    pm25:         fields.indexOf('pm2.5'),
    lat:          fields.indexOf('latitude'),
    lon:          fields.indexOf('longitude'),
    locationType: fields.indexOf('location_type'),
    confidence:   fields.indexOf('confidence'),
    name:         fields.indexOf('name'),
    lastSeen:     fields.indexOf('last_seen'),
  };
  if (idx.id < 0 || idx.pm25 < 0 || idx.lat < 0 || idx.lon < 0) return [];

  const out: PurpleAirSensor[] = [];
  for (const row of data) {
    const sensor = parseV1Row(row, idx);
    if (sensor) out.push(sensor);
  }
  return out;
}

interface V1FieldIdx {
  id: number; pm25: number; lat: number; lon: number;
  locationType: number; confidence: number; name: number; lastSeen: number;
}

function parseV1Row(row: unknown, idx: V1FieldIdx): PurpleAirSensor | null {
  if (!Array.isArray(row)) return null;
  return makeSensor({
    id:           toNum(row[idx.id]),
    pm25:         toNum(row[idx.pm25]),
    lat:          toNum(row[idx.lat]),
    lon:          toNum(row[idx.lon]),
    locationType: pickIdx(row, idx.locationType, 0),
    confidence:   pickIdx(row, idx.confidence, 100),
    name:         pickName(row, idx.name),
    lastSeen:     idx.lastSeen >= 0 ? toNum(row[idx.lastSeen]) : null,
  });
}

function pickIdx(row: unknown[], i: number, fallback: number): number {
  return i >= 0 ? toNum(row[i]) : fallback;
}

function pickName(row: unknown[], i: number): string {
  if (i < 0) return '';
  const v = row[i];
  return typeof v === 'string' ? v : '';
}

/**
 * Parse the legacy `/json` public endpoint response shape:
 *   { results: [{ ID, Lat, Lon, Type, Conf, PM2_5Value, Label, LastSeen }, ...] }
 * `Type` is "0" (outdoor) or "1" (indoor); `Conf` is a string percentage.
 */
export function parsePublicJsonResponse(payload: unknown): PurpleAirSensor[] {
  if (!isObject(payload)) return [];
  const results = payload.results;
  if (!Array.isArray(results)) return [];
  const out: PurpleAirSensor[] = [];
  for (const row of results) {
    if (!isObject(row)) continue;
    const sensor = makeSensor({
      id:           toNum(row.ID),
      pm25:         toNum(row.PM2_5Value),
      lat:          toNum(row.Lat),
      lon:          toNum(row.Lon),
      locationType: toNum(row.Type),
      confidence:   toNum(row.Conf),
      name:         typeof row.Label === 'string' ? row.Label : '',
      // LastSeen on the legacy endpoint is unix seconds, not ms.
      lastSeen:     row.LastSeen == null ? null : toNum(row.LastSeen) * 1000,
    });
    if (sensor) out.push(sensor);
  }
  return out;
}

// ── Internal ─────────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : Number.NaN;
  }
  return Number.NaN;
}

function makeSensor(parts: {
  id: number;
  pm25: number;
  lat: number;
  lon: number;
  locationType: number;
  confidence: number;
  name: string;
  lastSeen: number | null;
}): PurpleAirSensor | null {
  if (!Number.isFinite(parts.id)) return null;
  if (!Number.isFinite(parts.lat) || !Number.isFinite(parts.lon)) return null;
  if (!Number.isFinite(parts.pm25)) return null;
  return {
    id: parts.id,
    name: parts.name || `Sensor ${parts.id}`,
    lat: parts.lat,
    lon: parts.lon,
    pm25: parts.pm25,
    confidence: Number.isFinite(parts.confidence) ? parts.confidence : 0,
    locationType: Number.isFinite(parts.locationType) ? parts.locationType : 0,
    lastSeen: parts.lastSeen !== null && Number.isFinite(parts.lastSeen) ? parts.lastSeen : null,
  };
}
