/**
 * Pure helpers for the FIRMS thermal-anomaly panel (panel id: `firms-thermal`).
 *
 * NASA FIRMS publishes near-real-time active fire / thermal anomaly detections
 * from VIIRS (Suomi-NPP, NOAA-20) and MODIS. The data is dual-use: it surfaces
 * wildfires AND non-wildfire thermal anomalies (artillery, industrial fires,
 * gas flaring) that cross-correlate with conflict activity.
 *
 * Everything here is input → output pure (no DOM, no fetch, no globals) so it
 * is fully unit-testable with static fixtures. The sidecar mirrors the region /
 * conflict-zone definitions in `local-api-server.mjs` (it is a separate Node
 * process and cannot import this module).
 */

export type FirmsConfidence = 'high' | 'nominal' | 'low';

export interface FirmsHotspot {
  latitude: number;
  longitude: number;
  brightness: number; // bright_ti4 in Kelvin
  frp: number; // fire radiative power in MW
  confidence: FirmsConfidence;
  acqDate: string;
  acqTime: string;
  satellite: string;
  daynight: 'D' | 'N';
}

/** A named geographic box used to bucket hotspots. bbox = [lon_min, lat_min, lon_max, lat_max]. */
export interface RegionDefinition {
  name: string;
  bbox: [number, number, number, number];
  isConflictZone?: boolean;
}

/** A conflict hotspot with an expected baseline anomaly count for the 24h window. */
export interface ConflictZone {
  name: string;
  bbox: [number, number, number, number];
  baseline: number;
}

export interface RegionSummary {
  name: string;
  bbox: [number, number, number, number];
  count: number;
  totalFrp: number;
  highConfidenceCount: number;
  isConflictZone: boolean;
}

export type AnomalySeverity = 'normal' | 'elevated' | 'high' | 'extreme';

export interface ConflictZoneSummary {
  name: string;
  count: number;
  baseline: number;
  totalFrp: number;
  severity: AnomalySeverity;
}

export interface SatelliteCoverage {
  /** Distinct satellite identifiers seen in the data (e.g. `N`, `N20`, `1`). */
  satellites: string[];
  viirsSnpp: boolean;
  noaa20: boolean;
}

export interface FirmsSummary {
  demo: boolean;
  generatedAt: string;
  global: {
    count: number;
    highConfidenceCount: number;
    totalFrp: number; // MW
  };
  regions: RegionSummary[];
  conflictZones: ConflictZoneSummary[];
  satellites: SatelliteCoverage;
}

// ── Static definitions ──────────────────────────────────────────────────────

/**
 * Broad hotspot regions for the "where is the world burning" view.
 * bbox order is [lon_min, lat_min, lon_max, lat_max].
 */
export const REGIONS: RegionDefinition[] = [
  { name: 'Sub-Saharan Africa', bbox: [-20, -35, 52, 15] },
  { name: 'Amazon Basin', bbox: [-80, -20, -44, 6] },
  { name: 'Southeast Asia', bbox: [92, -11, 141, 29] },
  { name: 'Eastern Europe', bbox: [22, 44, 50, 60], isConflictZone: true },
  { name: 'Central Asia', bbox: [46, 35, 88, 56] },
  { name: 'Western North America', bbox: [-130, 30, -100, 60] },
  { name: 'Australia', bbox: [113, -44, 154, -10] },
  { name: 'Middle East', bbox: [34, 12, 63, 42], isConflictZone: true },
];

/**
 * Conflict hotspot bounding boxes for the dual-use cross-reference. `baseline`
 * is a rough expected 24h anomaly count outside active escalation; an observed
 * count well above baseline is the signal we surface. Boxes are intentionally
 * tight around the contested area, not the whole country.
 */
export const CONFLICT_ZONES: ConflictZone[] = [
  { name: 'Eastern Ukraine', bbox: [36, 46.5, 41, 50.5], baseline: 12 },
  { name: 'Sudan', bbox: [22, 9, 39, 22], baseline: 8 },
  { name: 'Gaza', bbox: [34.2, 31.2, 34.6, 31.6], baseline: 1 },
  { name: 'Myanmar', bbox: [92, 9.5, 101.5, 28.5], baseline: 20 },
  { name: 'Syria', bbox: [35.5, 32, 42.5, 37.5], baseline: 6 },
  { name: 'Sahel (Mali–Niger)', bbox: [-12, 11, 16, 20], baseline: 25 },
  { name: 'DR Congo (East)', bbox: [27, -3.5, 30, 1], baseline: 5 },
  { name: 'Yemen', bbox: [42.5, 12.5, 53, 19], baseline: 4 },
  { name: 'Nagorno-Karabakh', bbox: [45.5, 38.8, 47.2, 40.2], baseline: 1 },
  { name: 'Sahel (Burkina Faso)', bbox: [-5.5, 9.5, 2.5, 15.2], baseline: 10 },
];

// ── Parsing ─────────────────────────────────────────────────────────────────

function normalizeConfidence(raw: string): FirmsConfidence {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'h' || v === 'high') return 'high';
  if (v === 'l' || v === 'low') return 'low';
  if (v === 'n' || v === 'nominal') return 'nominal';
  // MODIS reports confidence as a 0–100 integer.
  const num = Number.parseInt(v, 10);
  if (Number.isFinite(num)) {
    if (num >= 80) return 'high';
    if (num >= 30) return 'nominal';
    return 'low';
  }
  return 'nominal';
}

function toFiniteNumber(raw: string): number {
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : Number.NaN;
}

interface ColumnIndices {
  lat: number;
  lon: number;
  bright: number;
  brightModis: number;
  frp: number;
  confidence: number;
  date: number;
  time: number;
  satellite: number;
  daynight: number;
}

/** Resolve a column value by index, returning '' when the column is absent. */
function pickCol(cols: string[], i: number): string {
  if (i === -1) return '';
  return cols[i] ?? '';
}

function resolveColumns(header: string[]): ColumnIndices {
  const idx = (name: string): number => header.indexOf(name);
  return {
    lat: idx('latitude'),
    lon: idx('longitude'),
    bright: idx('bright_ti4'),
    brightModis: idx('brightness'),
    frp: idx('frp'),
    confidence: idx('confidence'),
    date: idx('acq_date'),
    time: idx('acq_time'),
    satellite: idx('satellite'),
    daynight: idx('daynight'),
  };
}

/** Parse one CSV data row into a hotspot, or null when lat/lon are invalid. */
function parseHotspotRow(cols: string[], c: ColumnIndices): FirmsHotspot | null {
  const latitude = toFiniteNumber(pickCol(cols, c.lat));
  const longitude = toFiniteNumber(pickCol(cols, c.lon));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  const brightRaw = c.bright === -1 ? pickCol(cols, c.brightModis) : pickCol(cols, c.bright);
  const brightness = toFiniteNumber(brightRaw);
  const frp = toFiniteNumber(pickCol(cols, c.frp));
  const dn = pickCol(cols, c.daynight);

  return {
    latitude,
    longitude,
    brightness: Number.isFinite(brightness) ? brightness : 0,
    frp: Number.isFinite(frp) ? frp : 0,
    confidence: normalizeConfidence(pickCol(cols, c.confidence)),
    acqDate: pickCol(cols, c.date),
    acqTime: pickCol(cols, c.time),
    satellite: pickCol(cols, c.satellite),
    daynight: dn.toUpperCase() === 'N' ? 'N' : 'D',
  };
}

/**
 * Parse a FIRMS area-CSV response into hotspots. Resolves columns by header
 * name (FIRMS column order is stable but we don't rely on it). Rows with a
 * non-finite latitude/longitude are dropped rather than throwing.
 */
export function parseFirmsCsv(csv: string): FirmsHotspot[] {
  if (typeof csv !== 'string') return [];
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = (lines[0] ?? '').split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase());
  const cols = resolveColumns(header);
  if (cols.lat === -1 || cols.lon === -1) return [];

  const out: FirmsHotspot[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line?.trim()) continue;
    const fields = line.split(',').map((c) => c.trim().replace(/"/g, ''));
    const hotspot = parseHotspotRow(fields, cols);
    if (hotspot) out.push(hotspot);
  }
  return out;
}

// ── Geometry ──────────────────────────────────────────────────────────────--

/** True when (lat, lon) falls within bbox = [lon_min, lat_min, lon_max, lat_max] (inclusive). */
export function isInBbox(lat: number, lon: number, bbox: [number, number, number, number]): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const [lonMin, latMin, lonMax, latMax] = bbox;
  return lon >= lonMin && lon <= lonMax && lat >= latMin && lat <= latMax;
}

// ── Aggregation ─────────────────────────────────────────────────────────────

/** Count / sum hotspots per named region. A hotspot may fall in multiple regions. */
export function aggregateByRegion(
  hotspots: FirmsHotspot[],
  regions: RegionDefinition[],
): RegionSummary[] {
  return regions.map((region) => {
    let count = 0;
    let totalFrp = 0;
    let highConfidenceCount = 0;
    for (const hs of hotspots) {
      if (!isInBbox(hs.latitude, hs.longitude, region.bbox)) continue;
      count++;
      totalFrp += hs.frp;
      if (hs.confidence === 'high') highConfidenceCount++;
    }
    return {
      name: region.name,
      bbox: region.bbox,
      count,
      totalFrp,
      highConfidenceCount,
      isConflictZone: region.isConflictZone === true,
    };
  });
}

/**
 * Severity of an observed anomaly count relative to its baseline. Multipliers:
 *   extreme  ≥ 5× baseline
 *   high     ≥ 3× baseline
 *   elevated ≥ 1.5× baseline
 *   normal   otherwise
 * Baseline is floored to 1 so a zero-baseline box still escalates on activity.
 */
export function getAnomalySeverity(count: number, baseline: number): AnomalySeverity {
  const safeBaseline = Math.max(baseline, 1);
  const ratio = count / safeBaseline;
  if (ratio >= 5) return 'extreme';
  if (ratio >= 3) return 'high';
  if (ratio >= 1.5) return 'elevated';
  return 'normal';
}

/** Aggregate hotspots within each conflict zone, tagged with severity vs baseline. */
export function aggregateConflictZones(
  hotspots: FirmsHotspot[],
  zones: ConflictZone[],
): ConflictZoneSummary[] {
  return zones.map((zone) => {
    let count = 0;
    let totalFrp = 0;
    for (const hs of hotspots) {
      if (!isInBbox(hs.latitude, hs.longitude, zone.bbox)) continue;
      count++;
      totalFrp += hs.frp;
    }
    return {
      name: zone.name,
      count,
      baseline: zone.baseline,
      totalFrp,
      severity: getAnomalySeverity(count, zone.baseline),
    };
  });
}

/** Classify a raw FIRMS satellite token into the SNPP / NOAA-20 coverage flags. */
export function summarizeSatellites(hotspots: FirmsHotspot[]): SatelliteCoverage {
  const seen = new Set<string>();
  let viirsSnpp = false;
  let noaa20 = false;
  for (const hs of hotspots) {
    const tok = (hs.satellite ?? '').trim();
    if (!tok) continue;
    seen.add(tok);
    const up = tok.toUpperCase();
    // FIRMS uses `N`/`Suomi-NPP` for SNPP and `N20`/`NOAA-20`/`1` for NOAA-20.
    if (up === 'N' || up.includes('NPP') || up.includes('SUOMI')) viirsSnpp = true;
    if (up === 'N20' || up.includes('NOAA-20') || up.includes('NOAA20') || up === '1') noaa20 = true;
  }
  return { satellites: [...seen].sort((a, b) => a.localeCompare(b)), viirsSnpp, noaa20 };
}

// ── Formatting ────────────────────────────────────────────────────────────--

/** Format fire radiative power: MW below 1000, GW at/above. */
export function formatFrp(mw: number): string {
  if (!Number.isFinite(mw)) return '0 MW';
  if (mw >= 1000) {
    const gw = mw / 1000;
    return `${gw >= 100 ? Math.round(gw).toString() : gw.toFixed(1)} GW`;
  }
  return `${Math.round(mw)} MW`;
}

export function severityColor(severity: AnomalySeverity): string {
  switch (severity) {
    case 'extreme': {
      return '#ef4444';
    }
    case 'high': {
      return '#f97316';
    }
    case 'elevated': {
      return '#facc15';
    }
    default: {
      return '#9e9e9e';
    }
  }
}

// ── Summary assembly + demo fixture ───────────────────────────────────────--

/** Build the full panel summary from raw hotspots. */
export function summarizeHotspots(
  hotspots: FirmsHotspot[],
  generatedAt: string,
  demo = false,
): FirmsSummary {
  let highConfidenceCount = 0;
  let totalFrp = 0;
  for (const hs of hotspots) {
    if (hs.confidence === 'high') highConfidenceCount++;
    totalFrp += hs.frp;
  }
  return {
    demo,
    generatedAt,
    global: { count: hotspots.length, highConfidenceCount, totalFrp },
    regions: aggregateByRegion(hotspots, REGIONS).sort((a, b) => b.count - a.count),
    conflictZones: aggregateConflictZones(hotspots, CONFLICT_ZONES).sort(
      (a, b) => b.count - a.count,
    ),
    satellites: summarizeSatellites(hotspots),
  };
}

/**
 * Static demo summary so the panel is always usable without a configured
 * NASA_FIRMS_API_KEY. Numbers are representative, not live.
 */
export function buildDemoSummary(generatedAt = '1970-01-01T00:00:00.000Z'): FirmsSummary {
  return {
    demo: true,
    generatedAt,
    global: { count: 14_823, highConfidenceCount: 8102, totalFrp: 892_000 },
    regions: [
      { name: 'Sub-Saharan Africa', bbox: [-20, -35, 52, 15], count: 5203, totalFrp: 312_000, highConfidenceCount: 2950, isConflictZone: false },
      { name: 'Amazon Basin', bbox: [-80, -20, -44, 6], count: 3102, totalFrp: 198_000, highConfidenceCount: 1780, isConflictZone: false },
      { name: 'Southeast Asia', bbox: [92, -11, 141, 29], count: 2891, totalFrp: 142_000, highConfidenceCount: 1610, isConflictZone: false },
      { name: 'Eastern Europe', bbox: [22, 44, 50, 60], count: 1204, totalFrp: 41_000, highConfidenceCount: 540, isConflictZone: true },
      { name: 'Central Asia', bbox: [46, 35, 88, 56], count: 892, totalFrp: 28_000, highConfidenceCount: 401, isConflictZone: false },
      { name: 'Middle East', bbox: [34, 12, 63, 42], count: 421, totalFrp: 19_000, highConfidenceCount: 198, isConflictZone: true },
      { name: 'Western North America', bbox: [-130, 30, -100, 60], count: 388, totalFrp: 22_000, highConfidenceCount: 210, isConflictZone: false },
      { name: 'Australia', bbox: [113, -44, 154, -10], count: 276, totalFrp: 9000, highConfidenceCount: 120, isConflictZone: false },
    ],
    conflictZones: [
      { name: 'Eastern Ukraine', count: 89, baseline: 12, totalFrp: 3400, severity: 'extreme' },
      { name: 'Sudan', count: 34, baseline: 8, totalFrp: 1900, severity: 'high' },
      { name: 'Myanmar', count: 41, baseline: 20, totalFrp: 2100, severity: 'elevated' },
      { name: 'Syria', count: 12, baseline: 6, totalFrp: 600, severity: 'elevated' },
      { name: 'Gaza', count: 2, baseline: 1, totalFrp: 90, severity: 'elevated' },
    ],
    satellites: { satellites: ['N', 'N20'], viirsSnpp: true, noaa20: true },
  };
}
