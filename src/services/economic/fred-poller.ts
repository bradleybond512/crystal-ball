/**
 * FRED + OFR FSI poller — augments the existing /api/economic-stress
 * sidecar route with additional time-series data.
 *
 * Pure helpers only. The actual hourly fetch lives in the sidecar
 * (where the FRED_API_KEY env var is scoped).
 *
 * Series we add:
 *   - DCOILBRENTEU         (Brent crude, FRED)
 *   - GOLDAMGBD228NLBM     (Gold AM London bullion, FRED)
 *   - VIXCLS               (CBOE VIX, FRED)
 *   - DEXUSEU              (USD/EUR exchange rate, FRED)
 *   - OFR_FSI              (OFR Financial Stress Index, financialresearch.gov)
 */

// ── Public types ───────────────────────────────────────────────────────

export interface FredObservation {
  date: string;     // YYYY-MM-DD
  value: number | null;
}

export interface FredSeriesHistory {
  seriesId: string;
  observations: FredObservation[];
  /** Most recent non-null value. Null when the series has no values. */
  latestValue: number | null;
  /** Date of the latest non-null value, or null. */
  latestDate: string | null;
}

export interface OfrFsiResponse {
  mnemonic: string;
  observations: FredObservation[];
  latestValue: number | null;
  latestDate: string | null;
}

// ── FRED parsing ───────────────────────────────────────────────────────

/**
 * Parse a FRED `series/observations` JSON response. The shape is
 *   { observations: [ { date, value }, … ] }
 * with values as strings; "." means missing.
 */
export function parseFredObservationsResponse(
  raw: unknown,
  seriesId: string,
): FredSeriesHistory {
  const obs = collectFredObservations(raw);
  const latest = pickLatestObservation(obs);
  return { seriesId, observations: obs, ...latest };
}

function collectFredObservations(raw: unknown): FredObservation[] {
  if (!raw || typeof raw !== 'object') return [];
  const observations = (raw as Record<string, unknown>).observations;
  if (!Array.isArray(observations)) return [];
  const obs: FredObservation[] = [];
  for (const item of observations) {
    const parsed = parseObservationRow(item);
    if (parsed) obs.push(parsed);
  }
  return obs;
}

function parseObservationRow(item: unknown): FredObservation | null {
  if (!item || typeof item !== 'object') return null;
  const r = item as Record<string, unknown>;
  const date = typeof r.date === 'string' ? r.date : null;
  if (!date) return null;
  return { date, value: parseFredValue(r.value) };
}

function pickLatestObservation(
  obs: readonly FredObservation[],
): { latestValue: number | null; latestDate: string | null } {
  let latestValue: number | null = null;
  let latestDate: string | null = null;
  for (const observation of obs) {
    if (observation.value === null) continue;
    if (latestDate === null || observation.date > latestDate) {
      latestDate = observation.date;
      latestValue = observation.value;
    }
  }
  return { latestValue, latestDate };
}

function parseFredValue(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  if (value === '.' || value.length === 0) return null;
  const num = Number.parseFloat(value);
  return Number.isFinite(num) ? num : null;
}

// ── FRED URL builder ───────────────────────────────────────────────────

export interface FredUrlOptions {
  seriesId: string;
  apiKey: string;
  limit?: number;
  sortOrder?: 'asc' | 'desc';
}

export function buildFredObservationsUrl(options: FredUrlOptions): string {
  const params = new URLSearchParams();
  params.set('series_id', options.seriesId);
  params.set('api_key', options.apiKey);
  params.set('limit', String(options.limit ?? 90));
  params.set('sort_order', options.sortOrder ?? 'desc');
  params.set('file_type', 'json');
  return `https://api.stlouisfed.org/fred/series/observations?${params.toString()}`;
}

// ── OFR FSI parsing ────────────────────────────────────────────────────

/**
 * Parse the OFR FSI response. OFR's series/get endpoint returns a JSON
 * envelope with the structure (best-effort):
 *   {
 *     mnemonic: "OFR_FSI",
 *     observations: [ { date: "YYYY-MM-DD", value: number | null }, … ]
 *   }
 * Some OFR endpoints return arrays of [date, value] tuples; we handle
 * both. Tolerant — drops malformed rows rather than throwing.
 */
export function parseOfrFsiResponse(raw: unknown, mnemonic = 'OFR_FSI'): OfrFsiResponse {
  const observations = collectOfrObservations(raw);
  const latest = pickLatestObservation(observations);
  return { mnemonic, observations, ...latest };
}

function collectOfrObservations(raw: unknown): FredObservation[] {
  if (Array.isArray(raw)) return ofrFromArray(raw);
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.observations)) return ofrFromArray(obj.observations);
  if (Array.isArray(obj.data)) return ofrFromArray(obj.data);
  return [];
}

function ofrFromArray(arr: readonly unknown[]): FredObservation[] {
  const out: FredObservation[] = [];
  for (const item of arr) {
    const parsed = parseOfrRow(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

function parseOfrRow(item: unknown): FredObservation | null {
  if (Array.isArray(item) && item.length >= 2) {
    const date = typeof item[0] === 'string' ? item[0] : null;
    if (!date) return null;
    return { date, value: parseFredValue(item[1]) };
  }
  if (item && typeof item === 'object') {
    const r = item as Record<string, unknown>;
    const date = typeof r.date === 'string' ? r.date : null;
    if (!date) return null;
    return { date, value: parseFredValue(r.value) };
  }
  return null;
}

// ── Series catalog ─────────────────────────────────────────────────────

export const ECONOMIC_STRESS_FRED_SERIES = [
  'DCOILBRENTEU',
  'GOLDAMGBD228NLBM',
  'VIXCLS',
  'DEXUSEU',
] as const;

export type EconomicStressSeriesId = (typeof ECONOMIC_STRESS_FRED_SERIES)[number];

export const OFR_FSI_URL = 'https://data.financialresearch.gov/v1/series/get?mnemonic=OFR_FSI';

// ── Test hooks ─────────────────────────────────────────────────────────

export const __INTERNAL = { parseFredValue };
