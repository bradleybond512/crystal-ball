import { dataFreshness } from '@/services/data-freshness';

/**
 * Global tropical cyclone / hurricane / typhoon monitoring
 *
 * Sources:
 *  - NHC (National Hurricane Center): Atlantic + East/Central Pacific basins
 * https://www.nhc.noaa.gov/CurrentStorms.json  — real-time active storms
 *  - JTWC (Joint Typhoon Warning Center): West Pacific, Indian Ocean, Southern Hemisphere
 * The current JTWC RSS endpoint is a regional bulletin index, not an observation feed.
 * Observation coverage remains unavailable; linked bulletins are not parsed.
 * (proxied via rss-proxy because metoc.navy.mil blocks CORS)
 *
 * Both are public government data — no API key required.
 */

export type TcBasin =
  | 'atlantic'
  | 'east_pacific'
  | 'central_pacific'
  | 'west_pacific'
  | 'north_indian'
  | 'south_indian'
  | 'south_pacific';

export type TcCategory =
  | 'tropical_depression'
  | 'tropical_storm'
  | 'category_1'
  | 'category_2'
  | 'category_3'
  | 'category_4'
  | 'category_5'
  | 'unknown';

export interface TropicalCyclone {
  id: string;
  name: string;
  basin: TcBasin;
  category: TcCategory;
  windKts: number | null; // maximum sustained winds in knots
  pressureMb: number | null; // minimum central pressure
  lat: number;
  lon: number;
  movement: string; // e.g. "NNW at 12 mph"
  headline: string;
  advisoryTime: Date;
  advisoryUrl: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

// --- NHC current storms JSON ----
const NHC_STORMS_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';

// --- JTWC RSS via proxy (covers West Pacific, Indian Ocean, Southern Hemisphere) ---
const JTWC_RSS = 'https://www.metoc.navy.mil/jtwc/rss/jtwc.rss';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — cyclones are fast-moving
type SourceOutcome = { ok: true; storms: TropicalCyclone[] } | { ok: false; reason: string };
let nhcSnapshot: TropicalCyclone[] = [];
let lastAttempt: { storms: TropicalCyclone[]; settledAt: number } | null = null;
let inFlight: Promise<TropicalCyclone[]> | null = null;

function categoryFromWind(windKts: number): TcCategory {
  if (windKts < 34) return 'tropical_depression';
  if (windKts < 64) return 'tropical_storm';
  if (windKts < 83) return 'category_1';
  if (windKts < 96) return 'category_2';
  if (windKts < 113) return 'category_3';
  if (windKts < 137) return 'category_4';
  return 'category_5';
}

function categoryFromSaffirSimpson(cat: TcCategory): TropicalCyclone['severity'] {
  switch (cat) {
 case 'category_5':
 case 'category_4': { return 'critical';
 }
 case 'category_3':
 case 'category_2': { return 'high';
 }
 case 'category_1':
 case 'tropical_storm': { return 'medium';
 }
 default: { return 'low';
 }
  }
}

interface NhcStorm {
  id: string;
  name: string;
  wallet: string; // advisory package identifier
  atcf: string; // ATCF storm ID (e.g. AL012024)
  dateTime: string;
  lat: string;
  lon: string;
  intensity: string; // wind speed in knots
  pressure: string; // central pressure in mb
  headline: string;
  movement: string;
  type: string; // e.g. "HU", "TS", "TD"
}

interface NhcResponse {
  activeStorms?: NhcStorm[];
}

function basinFromAtcf(atcf: string): TcBasin {
  const prefix = atcf.slice(0, 2).toUpperCase();
  switch (prefix) {
 case 'AL': { return 'atlantic';
 }
 case 'EP': { return 'east_pacific';
 }
 case 'CP': { return 'central_pacific';
 }
 case 'WP': { return 'west_pacific';
 }
 case 'IO': { return 'north_indian';
 }
 case 'SH': { return 'south_pacific';
 }
 case 'SI': { return 'south_indian';
 }
 default: { return 'atlantic';
 }
  }
}

async function fetchNhcStorms(): Promise<SourceOutcome> {
  try {
 const res = await fetch(NHC_STORMS_URL, {
 signal: AbortSignal.timeout(10_000),
 headers: { Accept: 'application/json' },
 });
 if (!res.ok) return { ok: false, reason: 'NHC HTTP failure' };
 const data = (await res.json()) as NhcResponse;
 if (!data || !Array.isArray(data.activeStorms)) return { ok: false, reason: 'NHC response unavailable' };
 const storms = data.activeStorms;

 return { ok: true, storms: storms.map(s => {
 const windKts = Number.parseInt(s.intensity, 10) || null;
 const category = windKts === null ? 'unknown' : categoryFromWind(windKts);
 const lat = Number.parseFloat(s.lat) || 0;
 const lon = Number.parseFloat(s.lon) || 0;
 return {
 id: `nhc-${s.atcf ?? s.id}`,
 name: s.name ?? 'Unknown',
 basin: basinFromAtcf(s.atcf ?? ''),
 category,
 windKts,
 pressureMb: Number.parseInt(s.pressure, 10) || null,
 lat,
 lon,
 movement: s.movement ?? '',
 headline: s.headline ?? '',
 advisoryTime: s.dateTime ? new Date(s.dateTime) : new Date(),
 advisoryUrl: `https://www.nhc.noaa.gov/text/${s.wallet}.shtml`,
 severity: categoryFromSaffirSimpson(category),
 };
 }) };
  } catch {
 return { ok: false, reason: 'NHC response unavailable' };
  }
}

async function fetchJtwcStorms(): Promise<SourceOutcome> {
  try {
    const proxyUrl = `/api/rss-proxy?url=${encodeURIComponent(JTWC_RSS)}`;
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return { ok: false, reason: 'JTWC HTTP failure' };
    await res.text();
    // The current endpoint is a regional bulletin index, not storm observations.
    // Empty or parseable RSS cannot establish authoritative storm absence.
    return { ok: false, reason: 'JTWC observation coverage unavailable' };
  } catch {
    return { ok: false, reason: 'JTWC response unavailable' };
  }
}

async function refreshTropicalCyclones(): Promise<TropicalCyclone[]> {
  const [nhc, jtwc] = await Promise.all([fetchNhcStorms(), fetchJtwcStorms()]);
  if (nhc.ok) nhcSnapshot = nhc.storms;
  const storms = [...nhcSnapshot];
  const severityOrder: Record<TropicalCyclone['severity'], number> = { critical: 0, high: 1, medium: 2, low: 3 };
  storms.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  lastAttempt = { storms, settledAt: Date.now() };
  const failures = [nhc, jtwc].filter((outcome) => !outcome.ok);
  // JTWC has no supported observation-success format in this slice. A valid
  // NHC empty result is source-local success, never complete global coverage.
  dataFreshness.recordError('tropical-cyclones', failures.map((outcome) => outcome.reason).join('; '));
  return storms;
}

export async function fetchTropicalCyclones(): Promise<TropicalCyclone[]> {
  if (inFlight) return inFlight;
  if (lastAttempt && Date.now() - lastAttempt.settledAt < CACHE_TTL_MS) return lastAttempt.storms;
  inFlight = refreshTropicalCyclones();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

export function tcSeverityClass(severity: TropicalCyclone['severity']): string {
  return {
 critical: 'eq-row eq-major',
 high: 'eq-row eq-strong',
 medium: 'eq-row eq-moderate',
 low: 'eq-row',
  }[severity] ?? 'eq-row';
}

export function tcCategoryLabel(category: TcCategory): string {
  return {
 tropical_depression: 'TD',
 tropical_storm: 'TS',
 category_1: 'Cat 1',
 category_2: 'Cat 2',
 category_3: 'Cat 3',
 category_4: 'Cat 4',
 category_5: 'Cat 5',
 unknown: '?',
  }[category] ?? '?';
}
