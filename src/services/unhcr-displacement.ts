/* eslint-disable sonarjs/different-types-comparison, unicorn/no-array-callback-reference */
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
/**
 * UNHCR Refugee Population & Displacement Data
 *
 * Fetches country-level refugee and IDP counts from UNHCR's public Population
 * Statistics API (https://api.unhcr.org/population/v1/population/). Data is
 * low-cadence (annual updates) so we cache for 24 hours.
 *
 * The data feeds into Country Instability Index (CII) as an additional
 * displacement signal for regions with active humanitarian crises.
 *
 * NOTE: The public UNHCR endpoint may require a CORS proxy in the browser
 * context. The Tauri build can likely bypass CORS, but web builds may need
 * the Node.js sidecar (port 46123) to relay. Wire via sidecar when enabling
 * in production.
 */

import { createCircuitBreaker } from '@/utils';
import { iso3ToIso2Code } from './country-geometry';

const UNHCR_POPULATION_ENDPOINT = 'https://api.unhcr.org/population/v1/population/';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — annual-cadence data

export interface UNHCRPopulationRecord {
  year: number;
  countryOriginCode: string; // ISO 3-letter
  countryOriginName: string;
  countryAsylumCode: string;
  countryAsylumName: string;
  refugees: number;
  asylumSeekers: number;
  idps: number;
  returnees: number;
  statelessPersons: number;
  othersOfConcern: number;
}

export interface DisplacementSummary {
  countryCode: string; // ISO 2-letter
  countryName: string;
  totalDisplaced: number;
  refugeesFromCountry: number;
  refugeesInCountry: number;
  idpsInCountry: number;
  year: number;
  severity: 'critical' | 'high' | 'moderate' | 'low';
}

/**
 * Fallback ISO-3 → ISO-2 mapping for the ~20 countries with the most
 * displacement. Only used if `iso3ToIso2Code` from country-geometry returns
 * null (e.g. if geometry data has not been loaded yet).
 */
const FALLBACK_ISO3_TO_ISO2: Record<string, string> = {
  SYR: 'SY', VEN: 'VE', UKR: 'UA', AFG: 'AF', SDN: 'SD',
  SSD: 'SS', MMR: 'MM', COD: 'CD', SOM: 'SO', ERI: 'ER',
  CAF: 'CF', ETH: 'ET', IRQ: 'IQ', LBN: 'LB', TUR: 'TR',
  JOR: 'JO', PAK: 'PK', BGD: 'BD', COL: 'CO', RWA: 'RW',
};

function resolveIso2(iso3: string): string | null {
  const upper = iso3.trim().toUpperCase();
  return iso3ToIso2Code(upper) ?? FALLBACK_ISO3_TO_ISO2[upper] ?? null;
}

export function classifyDisplacementSeverity(total: number): DisplacementSummary['severity'] {
  if (total >= 1_000_000) return 'critical';
  if (total >= 250_000) return 'high';
  if (total >= 50_000) return 'moderate';
  return 'low';
}

interface RawUnhcrRow {
  year?: number | string;
  coo_iso?: string; // country of origin ISO-3
  coo_name?: string;
  coa_iso?: string; // country of asylum ISO-3
  coa_name?: string;
  refugees?: number | string;
  asylum_seekers?: number | string;
  idps?: number | string;
  returned_refugees?: number | string;
  stateless?: number | string;
  ooc?: number | string;
}

function toNum(v: number | string | undefined): number {
  if (v === undefined || v === null || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeRow(row: RawUnhcrRow): UNHCRPopulationRecord {
  return {
    year: Number(row.year) || new Date().getFullYear(),
    countryOriginCode: (row.coo_iso || '').toUpperCase(),
    countryOriginName: row.coo_name || '',
    countryAsylumCode: (row.coa_iso || '').toUpperCase(),
    countryAsylumName: row.coa_name || '',
    refugees: toNum(row.refugees),
    asylumSeekers: toNum(row.asylum_seekers),
    idps: toNum(row.idps),
    returnees: toNum(row.returned_refugees),
    statelessPersons: toNum(row.stateless),
    othersOfConcern: toNum(row.ooc),
  };
}

const populationBreaker = createCircuitBreaker<UNHCRPopulationRecord[]>({
  name: 'UNHCR Population',
  cacheTtlMs: CACHE_TTL_MS,
  persistCache: true,
});

export async function fetchUNHCRPopulation(year?: number): Promise<UNHCRPopulationRecord[]> {
  const targetYear = year ?? new Date().getFullYear();
  return populationBreaker.execute(async () => {
    const url = `${UNHCR_POPULATION_ENDPOINT}?year=${targetYear}&limit=1000`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`UNHCR API ${response.status}`);
    const payload = await response.json() as { items?: RawUnhcrRow[]; data?: RawUnhcrRow[] };
    if (!payload || typeof payload !== 'object') return [];
    const rows = Array.isArray(payload.items) ? payload.items : Array.isArray(payload.data) ? payload.data : [];
    return rows.map(normalizeRow);
  }, []);
}

export async function fetchDisplacementSummaries(year?: number): Promise<DisplacementSummary[]> {
  const records = await fetchUNHCRPopulation(year);
  if (records.length === 0) return [];

  // Aggregate by country (using asylum country code as the anchor, plus
  // country-of-origin roll-ups for refugees-from counts).
  const byCountry = new Map<string, DisplacementSummary>();

  const ensure = (iso3: string, name: string, yr: number): DisplacementSummary | null => {
    if (!iso3) return null;
    const iso2 = resolveIso2(iso3);
    if (!iso2) return null;
    let entry = byCountry.get(iso2);
    if (!entry) {
      entry = {
        countryCode: iso2,
        countryName: name,
        totalDisplaced: 0,
        refugeesFromCountry: 0,
        refugeesInCountry: 0,
        idpsInCountry: 0,
        year: yr,
        severity: 'low',
      };
      byCountry.set(iso2, entry);
    }
    return entry;
  };

  for (const r of records) {
    // Refugees-from: aggregate by country-of-origin
    const originEntry = ensure(r.countryOriginCode, r.countryOriginName, r.year);
    if (originEntry) {
      originEntry.refugeesFromCountry += r.refugees + r.asylumSeekers;
    }

    // Refugees-in + IDPs: aggregate by country-of-asylum
    const asylumEntry = ensure(r.countryAsylumCode, r.countryAsylumName, r.year);
    if (asylumEntry) {
      asylumEntry.refugeesInCountry += r.refugees;
      asylumEntry.idpsInCountry += r.idps;
    }
  }

  for (const entry of byCountry.values()) {
    entry.totalDisplaced = entry.refugeesFromCountry + entry.refugeesInCountry + entry.idpsInCountry;
    entry.severity = classifyDisplacementSeverity(entry.totalDisplaced);
  }

  return [...byCountry.values()].sort((a, b) => b.totalDisplaced - a.totalDisplaced);
}

/**
 * CII wiring (future): call `fetchDisplacementSummaries()` on the same 24h
 * cadence used by other low-cadence sources, build a Map keyed by ISO-2,
 * and — when `summary.severity === 'critical'` (totalDisplaced >= 1M) — push
 * a `displacement_surge` annotation onto the country's score profile WITHOUT
 * altering the numeric score. CountryData in country-instability.ts already
 * carries a numeric `displacementOutflow`; this annotation is purely
 * descriptive for UI surfacing. Not auto-wired to avoid perturbing CII.
 */
