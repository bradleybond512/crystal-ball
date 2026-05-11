/**
 * Vessel-classifier — pure helpers for the Live Vessels tab.
 *
 * Inputs are AIS position rows already cached in the sidecar's
 * aisState.vessels (sourced from aisstream.io). This module:
 *   - Classifies the numeric ITU-R M.1371 ShipType into a
 *     coarse category the panel can color-code
 *   - Decodes the MMSI MID prefix into a flag-state country
 *   - Filters vessels into one of four high-risk zones
 *
 * No fetch, no globals, no DOM.
 */

export type VesselCategory = 'tanker' | 'bulk_carrier' | 'container' | 'military' | 'other';

/**
 * Classify an AIS ShipType integer per ITU-R M.1371.
 * 80–89 are tankers, 70–79 are cargo (we coarse-bucket 70 as
 * bulk_carrier vs containers because AIS doesn't distinguish them
 * — see notes below). 35 is military, 31/32 tug-pilot, 50–59 misc
 * special craft (we keep 35 separately and treat 50–59 as 'other').
 */
export function classifyShipType(shipType: number | undefined | null): VesselCategory {
  if (typeof shipType !== 'number' || !Number.isFinite(shipType)) return 'other';
  // 35 = Military ops. 55 = law enforcement (treat as military for risk).
  if (shipType === 35 || shipType === 55) return 'military';
  // 80–89 = Tanker (Hazardous category A/B/C/D + reserved + tanker no addl info)
  if (shipType >= 80 && shipType <= 89) return 'tanker';
  // 70–79 = Cargo. AIS doesn't distinguish bulk vs container; we
  // approximate with 70/71/72/73/74 → bulk_carrier and 79/78 → container
  // based on common assignments by carriers. Conservative when unknown.
  if (shipType === 79 || shipType === 78) return 'container';
  if (shipType >= 70 && shipType <= 77) return 'bulk_carrier';
  return 'other';
}

// ── Risk zones (axis-aligned bounding boxes from the brief) ──────────────────

export interface RiskZoneBox {
  id: string;
  name: string;
  /** South latitude (inclusive, degrees). */
  south: number;
  /** North latitude (inclusive, degrees). */
  north: number;
  /** West longitude (inclusive, degrees). */
  west: number;
  /** East longitude (inclusive, degrees). */
  east: number;
}

export const RISK_ZONES: readonly RiskZoneBox[] = [
  { id: 'red-sea',         name: 'Red Sea',          south: 12, north: 22, west: 42, east: 50 },
  { id: 'hormuz',           name: 'Strait of Hormuz', south: 25, north: 27, west: 56, east: 58 },
  { id: 'black-sea',        name: 'Black Sea',        south: 41, north: 47, west: 28, east: 42 },
  { id: 'south-china-sea',  name: 'South China Sea',  south: 0,  north: 25, west: 105, east: 122 },
];

/** Returns the zone containing (lat, lon), or null. Boxes are
 *  axis-aligned and don't cross the antimeridian. */
export function zoneForPosition(lat: number, lon: number, zones: readonly RiskZoneBox[] = RISK_ZONES): RiskZoneBox | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  for (const z of zones) {
    if (lat >= z.south && lat <= z.north && lon >= z.west && lon <= z.east) return z;
  }
  return null;
}

// ── MMSI flag-state decoding ─────────────────────────────────────────────────

/**
 * The first 3 digits of a vessel MMSI are the Maritime Identification
 * Digits (MID) assigned by ITU. We carry a lookup for the codes most
 * commonly seen in the four risk zones above; everything else falls
 * through to 'Unknown'.
 *
 * Source: ITU MID list (public).
 */
const MID_TO_FLAG: Record<string, string> = {
  // Middle East / Red Sea / Hormuz
  '422': 'Iran',
  '470': 'United Arab Emirates',
  '473': 'Egypt',
  '561': 'Saudi Arabia',
  '466': 'Kuwait',
  '408': 'Bahrain',
  '425': 'Iraq',
  '443': 'Israel',
  '475': 'Yemen',
  // Black Sea ring
  '273': 'Russia',
  '272': 'Ukraine',
  '271': 'Turkey',
  '264': 'Romania',
  '207': 'Bulgaria',
  '213': 'Georgia',
  // South China Sea ring + flags-of-convenience common in region
  '412': 'China',
  '413': 'China',
  '414': 'China',
  '477': 'Hong Kong',
  '525': 'Indonesia',
  '533': 'Malaysia',
  '563': 'Singapore',
  '548': 'Philippines',
  '574': 'Vietnam',
  '563l': 'Singapore',
  '525l': 'Indonesia',
  // Top open registries (vessels in any zone are very often flagged here)
  '352': 'Panama',
  '353': 'Panama',
  '354': 'Panama',
  '371': 'Panama',
  '372': 'Panama',
  '373': 'Panama',
  '374': 'Panama',
  '538': 'Marshall Islands',
  '636': 'Liberia',
  '637': 'Liberia',
  '477l': 'Hong Kong',
  // Major military senders
  '366': 'United States',
  '367': 'United States',
  '368': 'United States',
  '369': 'United States',
  '232': 'United Kingdom',
  '233': 'United Kingdom',
  '234': 'United Kingdom',
  '235': 'United Kingdom',
};

/** Decode the MID (first 3 digits) of an MMSI string into a flag-state
 *  country name. Returns 'Unknown' when the MID isn't in the lookup. */
export function flagFromMmsi(mmsi: string | undefined | null): string {
  if (typeof mmsi !== 'string' || mmsi.length < 3) return 'Unknown';
  const mid = mmsi.slice(0, 3);
  return MID_TO_FLAG[mid] ?? 'Unknown';
}

// ── Vessel record + filter ───────────────────────────────────────────────────

/**
 * Lightweight shape — matches the fields we get from the sidecar's
 * aisState.vessels Map.
 */
export interface AisVesselRow {
  mmsi: string;
  name?: string;
  lat: number;
  lon: number;
  shipType?: number;
  heading?: number;
  speed?: number;
  course?: number;
  /** Epoch milliseconds. */
  timestamp?: number;
}

export interface ZoneVessel {
  mmsi: string;
  name: string;
  lat: number;
  lon: number;
  speedKnots: number | null;
  headingDeg: number | null;
  shipType: number | null;
  category: VesselCategory;
  flag: string;
  zoneId: string;
  zoneName: string;
  observedAt: number | null;
}

export interface FilterOptions {
  zones?: readonly RiskZoneBox[];
  /** Drop vessels whose timestamp is older than this many ms. */
  maxAgeMs?: number;
  /** Defaults to Date.now(). */
  now?: number;
}

function isStaleRow(r: AisVesselRow, maxAgeMs: number | undefined, now: number): boolean {
  if (!Number.isFinite(maxAgeMs)) return false;
  if (!Number.isFinite(r.timestamp)) return false;
  return now - (r.timestamp as number) > (maxAgeMs as number);
}

function buildZoneVessel(r: AisVesselRow, zone: RiskZoneBox): ZoneVessel {
  return {
    mmsi: r.mmsi,
    name: r.name ?? '',
    lat: r.lat,
    lon: r.lon,
    speedKnots: Number.isFinite(r.speed) ? (r.speed as number) : null,
    headingDeg: Number.isFinite(r.heading) ? (r.heading as number) : null,
    shipType: Number.isFinite(r.shipType) ? (r.shipType as number) : null,
    category: classifyShipType(r.shipType),
    flag: flagFromMmsi(r.mmsi),
    zoneId: zone.id,
    zoneName: zone.name,
    observedAt: Number.isFinite(r.timestamp) ? (r.timestamp as number) : null,
  };
}

function compareByObservedAtDesc(a: ZoneVessel, b: ZoneVessel): number {
  const aT = a.observedAt ?? -Infinity;
  const bT = b.observedAt ?? -Infinity;
  return bT - aT;
}

/**
 * Filter raw AIS rows to those inside a risk zone, decode flag,
 * classify type. Newest-first sorted by observedAt (null at end).
 */
export function filterVesselsInRiskZones(
  rows: readonly AisVesselRow[],
  options: FilterOptions = {},
): ZoneVessel[] {
  const zones = options.zones ?? RISK_ZONES;
  const maxAgeMs = options.maxAgeMs;
  const now = options.now ?? Date.now();
  const out: ZoneVessel[] = [];
  for (const r of rows) {
    if (!r.mmsi) continue;
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
    if (isStaleRow(r, maxAgeMs, now)) continue;
    const zone = zoneForPosition(r.lat, r.lon, zones);
    if (!zone) continue;
    out.push(buildZoneVessel(r, zone));
  }
  out.sort(compareByObservedAtDesc);
  return out;
}

/** Per-zone, per-category histogram. */
export interface VesselSummary {
  byZone: Record<string, number>;
  byCategory: Record<VesselCategory, number>;
  total: number;
}

export function summarizeVessels(vessels: readonly ZoneVessel[]): VesselSummary {
  const byZone: Record<string, number> = {};
  const byCategory: Record<VesselCategory, number> = {
    tanker: 0, bulk_carrier: 0, container: 0, military: 0, other: 0,
  };
  for (const v of vessels) {
    byZone[v.zoneName] = (byZone[v.zoneName] ?? 0) + 1;
    byCategory[v.category] += 1;
  }
  return { byZone, byCategory, total: vessels.length };
}
