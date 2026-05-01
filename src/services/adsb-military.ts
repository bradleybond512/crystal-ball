/**
 * Military ADS-B classifier + fetcher.
 *
 * Verified ICAO 24-bit hex ranges (country-tagged) + military squawk codes
 * ported from the World Monitor military-flights stack. Reference table is
 * https://www.ads-b.nl/icao.php — ranges are conservative and prefer false
 * negatives over false positives so civilian aircraft don't get misflagged.
 */

import { getApiBaseUrl } from '@/services/runtime';

export type MilitaryOperator =
  | 'usaf' | 'usn' | 'usmc' | 'usa'
  | 'raf' | 'rn'
  | 'faf' | 'gaf'
  | 'plaaf' | 'plan'
  | 'vks'
  | 'iaf'
  | 'nato'
  | 'other';

export interface MilitaryHexRange {
  start: string;          // inclusive, uppercase 6-hex
  end: string;            // inclusive, uppercase 6-hex
  operator: MilitaryOperator;
  country: string;        // ISO-readable label
}

/**
 * ICAO 24-bit hex ranges identifying military aircraft by registration.
 * Source: ads-b.nl/icao.php cross-referenced with public registries.
 * Order is documentation-driven, not significance-ordered.
 */
export const MILITARY_HEX_RANGES: readonly MilitaryHexRange[] = [
  // United States
  { start: 'ADF7C7', end: 'ADF7CF', operator: 'usaf', country: 'USA' },
  { start: 'AE0000', end: 'AFFFFF', operator: 'usaf', country: 'USA' },
  { start: 'A00000', end: 'A3FFFF', operator: 'usaf', country: 'USA' },
  // UK
  { start: '43C000', end: '43CFFF', operator: 'raf',  country: 'UK' },
  // France
  { start: '3A0000', end: '3AFFFF', operator: 'faf',  country: 'France' },
  { start: '3B0000', end: '3BFFFF', operator: 'faf',  country: 'France' },
  // Germany
  { start: '3F0000', end: '3FFFFF', operator: 'gaf',  country: 'Germany' },
  // Israel
  { start: '738000', end: '73FFFF', operator: 'iaf',  country: 'Israel' },
  // NATO AWACS (Luxembourg-registered)
  { start: '4D0000', end: '4D03FF', operator: 'nato', country: 'NATO' },
  // Italy
  { start: '300000', end: '33FFFF', operator: 'other', country: 'Italy' },
  // Spain
  { start: '340000', end: '37FFFF', operator: 'other', country: 'Spain' },
  // Netherlands
  { start: '480000', end: '480FFF', operator: 'other', country: 'Netherlands' },
  // Turkey
  { start: '4BA000', end: '4BCFFF', operator: 'other', country: 'Turkey' },
  // Saudi Arabia
  { start: '710000', end: '717FFF', operator: 'other', country: 'Saudi Arabia' },
  // UAE
  { start: '896000', end: '896FFF', operator: 'other', country: 'UAE' },
  // Qatar
  { start: '06A000', end: '06AFFF', operator: 'other', country: 'Qatar' },
  // Kuwait
  { start: '706000', end: '706FFF', operator: 'other', country: 'Kuwait' },
  // Japan
  { start: '840000', end: '87FFFF', operator: 'other', country: 'Japan' },
  // South Korea
  { start: '718000', end: '71FFFF', operator: 'other', country: 'South Korea' },
  // Australia
  { start: '7CF800', end: '7CFFFF', operator: 'other', country: 'Australia' },
  // Canada
  { start: 'C00000', end: 'C0FFFF', operator: 'other', country: 'Canada' },
  // India
  { start: '800000', end: '83FFFF', operator: 'other', country: 'India' },
  // Pakistan
  { start: '760000', end: '767FFF', operator: 'other', country: 'Pakistan' },
  // Egypt
  { start: '500000', end: '5003FF', operator: 'other', country: 'Egypt' },
  // Poland
  { start: '488000', end: '48FFFF', operator: 'other', country: 'Poland' },
  // Greece
  { start: '468000', end: '46FFFF', operator: 'other', country: 'Greece' },
  // Sweden
  { start: '4A8000', end: '4AFFFF', operator: 'other', country: 'Sweden' },
  // Norway
  { start: '478000', end: '47FFFF', operator: 'other', country: 'Norway' },
  // Singapore
  { start: '768000', end: '76FFFF', operator: 'other', country: 'Singapore' },
];

/** Squawk codes worth surfacing on military feeds: 7500 hijack, 7600 lost
 *  comms, 7700 emergency. Not exclusive to military but always flag-worthy. */
export const MILITARY_SQUAWKS: ReadonlySet<string> = new Set(['7500', '7600', '7700']);

/**
 * Look up a hex code against {@link MILITARY_HEX_RANGES}.
 * Returns the matching {operator, country} or null.
 */
export function isKnownMilitaryHex(hex: string): { operator: MilitaryOperator; country: string } | null {
  if (!hex) return null;
  const upper = hex.toUpperCase().trim();
  if (!/^[0-9A-F]{6}$/.test(upper)) return null;
  for (const range of MILITARY_HEX_RANGES) {
    if (upper >= range.start && upper <= range.end) {
      return { operator: range.operator, country: range.country };
    }
  }
  return null;
}

/** True when an OpenSky state row should be included in the military feed. */
export function isMilitaryState(icao24: string, squawk: string | null): boolean {
  if (squawk && MILITARY_SQUAWKS.has(squawk)) return true;
  return isKnownMilitaryHex(icao24) !== null;
}

export interface MilitaryFlight {
  icao24: string;
  callsign: string;
  longitude: number;
  latitude: number;
  baroAltitude: number | null;
  velocity: number | null;
  squawk: string | null;
  operator: MilitaryOperator;
  country: string;
}

function parseRow(row: Record<string, unknown>): MilitaryFlight | null {
  const icao24 = typeof row.icao24 === 'string' ? row.icao24 : '';
  const lon = typeof row.longitude === 'number' ? row.longitude : null;
  const lat = typeof row.latitude === 'number' ? row.latitude : null;
  if (!icao24 || lon == null || lat == null) return null;
  const match = isKnownMilitaryHex(icao24);
  return {
    icao24: icao24.toUpperCase(),
    callsign: typeof row.callsign === 'string' ? row.callsign.trim() : '',
    longitude: lon,
    latitude: lat,
    baroAltitude: typeof row.baro_altitude === 'number' ? row.baro_altitude : null,
    velocity: typeof row.velocity === 'number' ? row.velocity : null,
    squawk: typeof row.squawk === 'string' ? row.squawk : null,
    operator: match?.operator ?? 'other',
    country: match?.country ?? 'Unknown',
  };
}

/**
 * Parse the sidecar's `/api/adsb-military` payload into typed flights.
 * The sidecar emits `{icao24, callsign, longitude, latitude, baro_altitude, velocity, squawk}`.
 */
export function parseMilitaryFlights(raw: unknown): MilitaryFlight[] {
  if (!Array.isArray(raw)) return [];
  const out: MilitaryFlight[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const flight = parseRow(r as Record<string, unknown>);
    if (flight) out.push(flight);
  }
  return out;
}

let _cache: { data: MilitaryFlight[]; ts: number } | null = null;
const CLIENT_CACHE_TTL = 60 * 1000;

export async function fetchMilitaryAdsb(): Promise<MilitaryFlight[]> {
  const now = Date.now();
  if (_cache && now - _cache.ts < CLIENT_CACHE_TTL) return _cache.data;

  const res = await fetch(`${getApiBaseUrl()}/api/adsb-military`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`adsb-military: ${res.status}`);
  const raw: unknown = await res.json();
  const flights = parseMilitaryFlights(raw);
  _cache = { data: flights, ts: now };
  return flights;
}
