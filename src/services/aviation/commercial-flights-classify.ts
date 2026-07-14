/**
 * Commercial flight classification — pure-deterministic core.
 *
 * Takes a parsed OpenSky `states/all` record (or generic flight tuple) and
 * returns a typed `LiveFlight` with category + emergency-squawk flag. No
 * I/O, no globals, no fetch — everything is unit-testable with static
 * fixtures.
 *
 * Categories:
 *   - military          : known military hex range OR military callsign prefix
 *   - commercial        : known passenger airline ICAO callsign prefix
 *   - cargo             : known cargo airline ICAO callsign prefix
 *   - helicopter        : medical/HEMS/utility helo callsign hints
 *   - general_aviation  : everything else with a position
 *
 * Emergency squawks (7500 hijack, 7600 comms failure, 7700 general) are a
 * separate flag — a commercial 737 with squawk 7700 is still `commercial`,
 * but `emergency` is true and the panel/globe surface it as a red pulse.
 */

import type { AviationNotam, AviationSigmet } from './aviation-intel-types';

export type FlightCategory =
  | 'military'
  | 'commercial'
  | 'cargo'
  | 'helicopter'
  | 'general_aviation';

export type EmergencySquawk = '7500' | '7600' | '7700';

export interface LiveFlight {
  icao24: string;
  callsign: string | null;
  originCountry: string | null;
  category: FlightCategory;
  /** Operator ICAO code resolved from the 3-letter callsign prefix (e.g. "AAL"). */
  operatorIcao: string | null;
  /** Human-friendly operator name when known (e.g. "American Airlines"). */
  operatorName: string | null;
  lat: number;
  lon: number;
  altitudeFt: number | null;
  velocityKts: number | null;
  /** Heading in degrees (0–360). */
  headingDeg: number | null;
  squawk: string | null;
  /** True when squawk is 7500 / 7600 / 7700. */
  emergency: boolean;
  /** Set when emergency=true; null otherwise. */
  emergencySquawk: EmergencySquawk | null;
  onGround: boolean;
  /** Unix ms of last position update from upstream. */
  lastSeen: number;
}

/** Raw OpenSky state tuple — see opensky-network.org/apidoc/rest.html. */
export type OpenSkyStateTuple = readonly [
  string,                 // 0  icao24
  string | null,          // 1  callsign
  string,                 // 2  origin_country
  number | null,          // 3  time_position (sec)
  number,                  // 4  last_contact (sec)
  number | null,          // 5  longitude
  number | null,          // 6  latitude
  number | null,          // 7  baro_altitude (m)
  boolean,                 // 8  on_ground
  number | null,          // 9  velocity (m/s)
  number | null,          // 10 true_track (deg)
  number | null,          // 11 vertical_rate (m/s)
  ...unknown[]
];

// ─── Operator catalogues ────────────────────────────────────────────────────

const PASSENGER_AIRLINES: Record<string, string> = {
  AAL: 'American Airlines',
  DAL: 'Delta Air Lines',
  UAL: 'United Airlines',
  SWA: 'Southwest Airlines',
  JBU: 'JetBlue',
  ASA: 'Alaska Airlines',
  SKW: 'SkyWest',
  RPA: 'Republic Airways',
  ENY: 'Envoy Air',
  ACA: 'Air Canada',
  WJA: 'WestJet',
  BAW: 'British Airways',
  VIR: 'Virgin Atlantic',
  AFR: 'Air France',
  DLH: 'Lufthansa',
  KLM: 'KLM',
  IBE: 'Iberia',
  AZA: 'ITA Airways',
  AUA: 'Austrian Airlines',
  SWR: 'Swiss',
  SAS: 'SAS',
  FIN: 'Finnair',
  THY: 'Turkish Airlines',
  UAE: 'Emirates',
  ETD: 'Etihad',
  QTR: 'Qatar Airways',
  SVA: 'Saudia',
  ELY: 'El Al',
  JAL: 'Japan Airlines',
  ANA: 'All Nippon Airways',
  KAL: 'Korean Air',
  AAR: 'Asiana',
  CES: 'China Eastern',
  CSN: 'China Southern',
  CCA: 'Air China',
  SIA: 'Singapore Airlines',
  CPA: 'Cathay Pacific',
  QFA: 'Qantas',
  ANZ: 'Air New Zealand',
  AMX: 'Aeromexico',
  LAN: 'LATAM',
  TAM: 'TAM',
  AVA: 'Avianca',
  RYR: 'Ryanair',
  EZY: 'easyJet',
  WZZ: 'Wizz Air',
  TRA: 'Transavia',
  THA: 'Thai Airways',
  MAS: 'Malaysia Airlines',
  AIC: 'Air India',
  IGO: 'IndiGo',
  EIN: 'Aer Lingus',
  AEE: 'Aegean Airlines',
};

const CARGO_AIRLINES: Record<string, string> = {
  FDX: 'FedEx Express',
  UPS: 'UPS Airlines',
  ABX: 'ABX Air',
  CKS: 'Kalitta Air',
  GTI: 'Atlas Air',
  CLX: 'Cargolux',
  ABW: 'AirBridgeCargo',
  AAR_F: 'Asiana Cargo',
  EVA: 'EVA Air Cargo',
  CAL: 'China Airlines Cargo',
  CKK: 'China Cargo Airlines',
  GEC: 'Lufthansa Cargo',
  POT: 'Polar Air Cargo',
  SOO: 'Southern Air',
  ICE: 'Icelandair Cargo',
  CTM: 'CMA CGM Air Cargo',
  ABD: 'AirBridge Direct',
  DHX: 'DHL Air',
  BCS: 'European Air Transport',
  GLO: 'Global Crossing Airlines',
};

const MILITARY_CALLSIGN_PREFIXES = new Set([
  // USAF / US Navy / US Army
  'RCH', 'REACH', 'CNV', 'PAT', 'GOLD', 'SHELL', 'TEAL', 'HOMER', 'MAGIC',
  'SENTRY', 'RIVET', 'PYTHON', 'RAGE', 'VIPER', 'EAGLE', 'RAIDER', 'DOOM',
  'BISON', 'ARMY', 'PEDRO', 'DUSTOFF',
  // NATO / RAF / RAAF / RCAF
  'NATO', 'RRR', 'ASCOT', 'RAFAIR', 'AUSY', 'CFC', 'CANFORCE',
  // Generic military patterns
  'MIL', 'NAVY', 'AF',
]);

const HELO_CALLSIGN_HINTS = [
  'HEMS', 'LIFEFLIGHT', 'AIRMED', 'MERCY', 'MEDFLIGHT', 'CARESTAR',
  'CHP', 'COASTGUARD', 'USCG', 'RESCUE',
];

// Verified country-tagged ICAO 24-bit hex ranges. Mirrors the sidecar
// /api/adsb-military filter so renderer + sidecar agree on military.
export const MILITARY_HEX_RANGES: readonly (readonly [string, string])[] = [
  ['ADF7C7', 'ADF7CF'], ['AE0000', 'AFFFFF'], ['A00000', 'A3FFFF'], // USA
  ['43C000', '43CFFF'],                                              // UK
  ['3A0000', '3AFFFF'], ['3B0000', '3BFFFF'],                        // France
  ['3F0000', '3FFFFF'],                                              // Germany
  ['738000', '73FFFF'],                                              // Israel
  ['4D0000', '4D03FF'],                                              // NATO AWACS
  ['300000', '33FFFF'],                                              // Italy
  ['340000', '37FFFF'],                                              // Spain
  ['480000', '480FFF'],                                              // Netherlands
  ['4BA000', '4BCFFF'],                                              // Turkey
  ['710000', '717FFF'],                                              // Saudi Arabia
  ['896000', '896FFF'],                                              // UAE
  ['06A000', '06AFFF'],                                              // Qatar
  ['706000', '706FFF'],                                              // Kuwait
  ['840000', '87FFFF'],                                              // Japan
  ['718000', '71FFFF'],                                              // South Korea
  ['7CF800', '7CFFFF'],                                              // Australia
  ['C00000', 'C0FFFF'],                                              // Canada
  ['800000', '83FFFF'],                                              // India
  ['760000', '767FFF'],                                              // Pakistan
  ['500000', '5003FF'],                                              // Egypt
  ['488000', '48FFFF'],                                              // Poland
  ['468000', '46FFFF'],                                              // Greece
  ['4A8000', '4AFFFF'],                                              // Sweden
  ['478000', '47FFFF'],                                              // Norway
  ['768000', '76FFFF'],                                              // Singapore
];

// ─── Public API ─────────────────────────────────────────────────────────────

export function isMilitaryHex(icao24: string): boolean {
  if (!icao24) return false;
  const upper = icao24.toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(upper)) return false;
  for (const [start, end] of MILITARY_HEX_RANGES) {
    if (upper >= start && upper <= end) return true;
  }
  return false;
}

export function isEmergencySquawk(squawk: string | null | undefined): squawk is EmergencySquawk {
  return squawk === '7500' || squawk === '7600' || squawk === '7700';
}

export function emergencyLabel(squawk: EmergencySquawk): string {
  if (squawk === '7500') return 'Hijack';
  if (squawk === '7600') return 'Comms failure';
  return 'General emergency';
}

/** Strip the trailing flight-number digits to get the ICAO operator prefix. */
export function operatorIcaoFromCallsign(callsign: string | null | undefined): string | null {
  if (!callsign) return null;
  const trimmed = callsign.trim().toUpperCase();
  if (trimmed.length < 3) return null;
  // ICAO operator codes are exactly 3 letters at the start.
  const prefix = trimmed.slice(0, 3);
  if (!/^[A-Z]{3}$/.test(prefix)) return null;
  return prefix;
}

function classifyByCallsign(callsign: string | null): {
  category: FlightCategory | null;
  operatorIcao: string | null;
  operatorName: string | null;
} {
  const prefix = operatorIcaoFromCallsign(callsign);
  if (!prefix) return { category: null, operatorIcao: null, operatorName: null };

  if (PASSENGER_AIRLINES[prefix]) {
    return { category: 'commercial', operatorIcao: prefix, operatorName: PASSENGER_AIRLINES[prefix] };
  }
  if (CARGO_AIRLINES[prefix]) {
    return { category: 'cargo', operatorIcao: prefix, operatorName: CARGO_AIRLINES[prefix] };
  }
  if (MILITARY_CALLSIGN_PREFIXES.has(prefix)) {
    return { category: 'military', operatorIcao: prefix, operatorName: null };
  }
  return { category: null, operatorIcao: prefix, operatorName: null };
}

function callsignHasMilitaryHint(callsign: string | null): boolean {
  if (!callsign) return false;
  const upper = callsign.trim().toUpperCase();
  // Some military callsigns embed the prefix later or use longer words.
  for (const word of MILITARY_CALLSIGN_PREFIXES) {
    if (upper.startsWith(word)) return true;
  }
  return false;
}

function callsignHasHeloHint(callsign: string | null): boolean {
  if (!callsign) return false;
  const upper = callsign.trim().toUpperCase();
  for (const hint of HELO_CALLSIGN_HINTS) {
    if (upper.startsWith(hint)) return true;
  }
  return false;
}

function metersToFeet(m: number | null): number | null {
  if (m === null || !Number.isFinite(m)) return null;
  return Math.round(m * 3.280_84);
}

function metersPerSecToKnots(mps: number | null): number | null {
  if (mps === null || !Number.isFinite(mps)) return null;
  return Math.round(mps * 1.943_84);
}

/**
 * Classify a single OpenSky state tuple into a `LiveFlight`. Returns null
 * when the tuple is missing position data (we can't render or filter
 * something we can't place).
 */
export function classifyFlight(state: OpenSkyStateTuple): LiveFlight | null {
  const icao24 = (state[0] ?? '').toString().toLowerCase().trim();
  if (!icao24) return null;
  const lat = state[6];
  const lon = state[5];
  if (lat === null || lon === null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const callsignRaw = (state[1] ?? '').toString().trim();
  const callsign = callsignRaw.length > 0 ? callsignRaw : null;
  const squawk = (state[14] as string | null | undefined) ?? null;
  const emergency = isEmergencySquawk(squawk);

  const byCallsign = classifyByCallsign(callsign);
  const isMilByHex = isMilitaryHex(icao24);
  const isMilByCallsign = callsignHasMilitaryHint(callsign);

  let category: FlightCategory;
  if (isMilByHex || isMilByCallsign || byCallsign.category === 'military') {
    category = 'military';
  } else if (byCallsign.category === 'cargo') {
    category = 'cargo';
  } else if (byCallsign.category === 'commercial') {
    category = 'commercial';
  } else if (callsignHasHeloHint(callsign)) {
    category = 'helicopter';
  } else {
    category = 'general_aviation';
  }

  return {
    icao24,
    callsign,
    originCountry: (state[2] ?? '').toString().trim() || null,
    category,
    operatorIcao: byCallsign.operatorIcao,
    operatorName: byCallsign.operatorName,
    lat,
    lon,
    altitudeFt: metersToFeet(state[7]),
    velocityKts: metersPerSecToKnots(state[9]),
    headingDeg: typeof state[10] === 'number' && Number.isFinite(state[10]) ? state[10] : null,
    squawk: squawk ?? null,
    emergency,
    emergencySquawk: emergency ? (squawk as EmergencySquawk) : null,
    onGround: state[8] === true,
    lastSeen: typeof state[4] === 'number' ? state[4] * 1000 : Date.now(),
  };
}

/** Classify a full OpenSky `states/all` payload. Skips invalid rows. */
export function classifyFlights(payload: unknown): LiveFlight[] {
  if (!payload || typeof payload !== 'object') return [];
  const states = (payload as { states?: unknown }).states;
  if (!Array.isArray(states)) return [];
  const out: LiveFlight[] = [];
  for (const row of states) {
    if (!Array.isArray(row) || row.length < 15) continue;
    const flight = classifyFlight(row as unknown as OpenSkyStateTuple);
    if (flight) out.push(flight);
  }
  return out;
}

// ─── Aggregation helpers ─────────────────────────────────────────────────────

export interface FlightCategoryCounts {
  military: number;
  commercial: number;
  cargo: number;
  helicopter: number;
  general_aviation: number;
  total: number;
  emergency: number;
  squawk7500: number;
  squawk7600: number;
  squawk7700: number;
}

export function summariseFlights(flights: readonly LiveFlight[]): FlightCategoryCounts {
  const counts: FlightCategoryCounts = {
    military: 0,
    commercial: 0,
    cargo: 0,
    helicopter: 0,
    general_aviation: 0,
    total: flights.length,
    emergency: 0,
    squawk7500: 0,
    squawk7600: 0,
    squawk7700: 0,
  };
  for (const f of flights) {
    counts[f.category] += 1;
    if (f.emergency) {
      counts.emergency += 1;
      if (f.emergencySquawk === '7500') counts.squawk7500 += 1;
      else if (f.emergencySquawk === '7600') counts.squawk7600 += 1;
      else if (f.emergencySquawk === '7700') counts.squawk7700 += 1;
    }
  }
  return counts;
}

// ─── Region & radius filters ─────────────────────────────────────────────────

export interface BoundingBox {
  /** Minimum longitude (-180..180). */
  west: number;
  /** Minimum latitude (-90..90). */
  south: number;
  /** Maximum longitude (-180..180). */
  east: number;
  /** Maximum latitude (-90..90). */
  north: number;
}

export function filterByBoundingBox<T extends { lat: number; lon: number }>(
  flights: readonly T[],
  box: BoundingBox,
): T[] {
  // Treat antimeridian-crossing boxes (west > east) as two halves.
  const crossesAntimeridian = box.west > box.east;
  return flights.filter((f) => {
    if (f.lat < box.south || f.lat > box.north) return false;
    if (crossesAntimeridian) {
      return f.lon >= box.west || f.lon <= box.east;
    }
    return f.lon >= box.west && f.lon <= box.east;
  });
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface SavedPlace {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Radius around the place in km. Required — caller decides. */
  radiusKm: number;
}

export function filterByRadius<T extends { lat: number; lon: number }>(
  flights: readonly T[],
  place: SavedPlace,
): T[] {
  return flights.filter((f) => haversineKm(f, place) <= place.radiusKm);
}

/**
 * Filter to flights within ANY of the supplied saved places' radii.
 * If `places` is empty, returns the input unchanged so the caller can
 * skip the filter entirely when no places are configured.
 */
export function filterByAnyPlace<T extends { lat: number; lon: number }>(
  flights: readonly T[],
  places: readonly SavedPlace[],
): T[] {
  if (places.length === 0) return [...flights];
  return flights.filter((f) =>
    places.some((p) => haversineKm(f, p) <= p.radiusKm),
  );
}

// ─── Cross-reference TFR / SIGMET hazard zones ──────────────────────────────

export interface FlightHazardCrossRef {
  /** TFR NOTAM IDs the flight is currently inside. */
  tfrIds: string[];
  /** SIGMET IDs whose polygon covers the flight position. */
  sigmetIds: string[];
}

/** Inclusive: a flight at exactly TFR radius counts as inside. */
export function isFlightInTfr(
  flight: { lat: number; lon: number },
  tfr: AviationNotam,
): boolean {
  if (!tfr.center) return false;
  const distNm = haversineKm(flight, { lat: tfr.center.lat, lon: tfr.center.lon }) * 0.539_957;
  return distNm <= tfr.center.radiusNm;
}

export function isFlightInSigmet(
  flight: { lat: number; lon: number },
  sigmet: AviationSigmet,
): boolean {
  if (sigmet.polygon.length < 3) return false;
  return pointInPolygon(flight, sigmet.polygon);
}

/** Standard ray-casting point-in-polygon (lon/lat plane, no antimeridian). */
function pointInPolygon(
  pt: { lat: number; lon: number },
  ring: readonly { lat: number; lon: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i]!.lon;
    const yi = ring[i]!.lat;
    const xj = ring[j]!.lon;
    const yj = ring[j]!.lat;
    const intersects =
      yi > pt.lat !== yj > pt.lat &&
      pt.lon < ((xj - xi) * (pt.lat - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function crossReferenceHazards(
  flight: { lat: number; lon: number },
  tfrs: readonly AviationNotam[],
  sigmets: readonly AviationSigmet[],
): FlightHazardCrossRef {
  return {
    tfrIds: tfrs.filter((t) => isFlightInTfr(flight, t)).map((t) => t.id),
    sigmetIds: sigmets.filter((s) => isFlightInSigmet(flight, s)).map((s) => s.id),
  };
}

export function flightsInsideHazardZones(
  flights: readonly LiveFlight[],
  tfrs: readonly AviationNotam[],
  sigmets: readonly AviationSigmet[],
): (LiveFlight & { hazards: FlightHazardCrossRef })[] {
  const out: (LiveFlight & { hazards: FlightHazardCrossRef })[] = [];
  for (const f of flights) {
    const hazards = crossReferenceHazards(f, tfrs, sigmets);
    if (hazards.tfrIds.length > 0 || hazards.sigmetIds.length > 0) {
      out.push({ ...f, hazards });
    }
  }
  return out;
}

// ─── Globe styling (color + arrow head size by category) ─────────────────────

const CATEGORY_HEX: Record<FlightCategory, string> = {
  military: '#ffeb3b',       // matches existing military aircraft yellow accent
  commercial: '#4a9eff',
  cargo: '#9c27b0',
  helicopter: '#8bc34a',
  general_aviation: '#9e9e9e',
};

export function flightCategoryColor(category: FlightCategory): string {
  return CATEGORY_HEX[category];
}

export function flightStyle(flight: LiveFlight): {
  hex: string;
  emergency: boolean;
  pixelSize: number;
} {
  if (flight.emergency) return { hex: '#ff453a', emergency: true, pixelSize: 11 };
  return { hex: CATEGORY_HEX[flight.category], emergency: false, pixelSize: 5 };
}
