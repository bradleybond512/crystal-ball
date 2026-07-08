/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
import type { MilitaryFlight, MilitaryOperator } from '@/types';
import type { SignalType } from '@/utils/analysis-constants';
import { MILITARY_BASES_EXPANDED } from '@/config/bases-expanded';
import { focalPointDetector } from './focal-point-detector';
import { getCountryScore } from './country-instability';

// Foreign military concentration detection - immediate alerts, no baseline needed
interface GeoRegion {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
}

interface OperatorHomeRegions {
  operator: MilitaryOperator;
  country: string;
  homeRegions: string[]; // region IDs where this operator's presence is "normal"
  alertThreshold: number; // minimum aircraft to trigger alert when outside home
}

// Sensitive regions where foreign military concentration is notable
const SENSITIVE_REGIONS: GeoRegion[] = [
  // Middle East / Iran area
  { id: 'persian-gulf', name: 'Persian Gulf', lat: 26.5, lon: 52, radiusKm: 600 },
  { id: 'strait-hormuz', name: 'Strait of Hormuz', lat: 26.5, lon: 56.5, radiusKm: 300 },
  { id: 'iran-border', name: 'Iran Border Region', lat: 33, lon: 47, radiusKm: 400 },
  // Eastern Europe / Russia borders
  { id: 'baltics', name: 'Baltic Region', lat: 56, lon: 24, radiusKm: 400 },
  { id: 'poland-border', name: 'Poland-Belarus Border', lat: 52.5, lon: 23.5, radiusKm: 300 },
  { id: 'black-sea', name: 'Black Sea', lat: 43.5, lon: 34, radiusKm: 500 },
  { id: 'kaliningrad', name: 'Kaliningrad Region', lat: 54.7, lon: 20.5, radiusKm: 250 },
  // Asia-Pacific
  { id: 'taiwan-strait', name: 'Taiwan Strait', lat: 24.5, lon: 119.5, radiusKm: 400 },
  { id: 'south-china-sea', name: 'South China Sea', lat: 14, lon: 114, radiusKm: 800 },
  { id: 'korean-dmz', name: 'Korean DMZ', lat: 38, lon: 127, radiusKm: 300 },
  { id: 'japan-sea', name: 'Sea of Japan', lat: 40, lon: 135, radiusKm: 500 },
  // Arctic / Alaska
  { id: 'alaska-adiz', name: 'Alaska ADIZ', lat: 62, lon: -165, radiusKm: 600 },
  { id: 'arctic-russia', name: 'Arctic (Russian Side)', lat: 72, lon: 70, radiusKm: 800 },
  // Mediterranean / Libya
  { id: 'east-med', name: 'Eastern Mediterranean', lat: 34.5, lon: 33, radiusKm: 500 },
  { id: 'libya-coast', name: 'Libya Coast', lat: 32.5, lon: 15, radiusKm: 400 },
  // Africa
  { id: 'horn-africa', name: 'Horn of Africa', lat: 10, lon: 45, radiusKm: 600 },
  { id: 'sahel', name: 'Sahel Region', lat: 15, lon: 5, radiusKm: 800 },
  // South America
  { id: 'venezuela', name: 'Venezuela', lat: 8, lon: -66, radiusKm: 500 },
];

// Define home regions for major military operators
const OPERATOR_HOMES: OperatorHomeRegions[] = [
  { operator: 'usaf', country: 'USA', homeRegions: ['alaska-adiz'], alertThreshold: 2 },
  { operator: 'usn', country: 'USA', homeRegions: ['alaska-adiz'], alertThreshold: 2 },
  { operator: 'usmc', country: 'USA', homeRegions: ['alaska-adiz'], alertThreshold: 2 },
  { operator: 'usa', country: 'USA', homeRegions: ['alaska-adiz'], alertThreshold: 2 },
  { operator: 'vks', country: 'Russia', homeRegions: ['kaliningrad', 'arctic-russia', 'black-sea'], alertThreshold: 2 },
  { operator: 'plaaf', country: 'China', homeRegions: ['taiwan-strait', 'south-china-sea'], alertThreshold: 2 },
  { operator: 'plan', country: 'China', homeRegions: ['taiwan-strait', 'south-china-sea'], alertThreshold: 2 },
  { operator: 'iaf', country: 'Israel', homeRegions: ['east-med', 'iran-border'], alertThreshold: 2 },
  { operator: 'raf', country: 'UK', homeRegions: ['baltics', 'black-sea'], alertThreshold: 3 },
  { operator: 'faf', country: 'France', homeRegions: ['sahel', 'east-med', 'libya-coast'], alertThreshold: 3 },
  { operator: 'gaf', country: 'Germany', homeRegions: ['baltics'], alertThreshold: 3 },
];

export interface ForeignPresenceAlert {
  id: string;
  operator: MilitaryOperator;
  operatorCountry: string;
  region: GeoRegion;
  aircraftCount: number;
  flights: MilitaryFlight[];
  firstDetected: Date;
}

const activeForeignPresence = new Map<string, ForeignPresenceAlert>();
const seenForeignAlerts = new Set<string>();
// The 2-hour bucket index whose keys currently populate seenForeignAlerts.
// When the bucket rolls over we clear the set so stale buckets aren't retained
// for the whole session (the keys embed the bucket index and were never pruned).
let seenForeignAlertsBucket = -1;
// Evict a foreign-presence entry once its operator/region pair hasn't been
// re-detected within this window (firstDetected is refreshed on every
// re-detection), so the map doesn't retain stale pairs + flight arrays.
const FOREIGN_PRESENCE_TTL_MS = 24 * 60 * 60 * 1000;

export interface MilitaryTheater {
  id: string;
  name: string;
  baseIds: string[];
  centerLat: number;
  centerLon: number;
}

export interface HeadingCoherence {
  /** 0–1: 1 = all aircraft flying same heading, 0 = random */
  coherence: number;
  /** Mean heading in degrees (circular mean) */
  meanHeading: number;
  /** Number of aircraft included in calculation */
  sampleSize: number;
}

export interface SurgeAlert {
  id: string;
  theater: MilitaryTheater;
  type: 'airlift' | 'fighter' | 'reconnaissance';
  currentCount: number;
  baselineCount: number;
  surgeMultiple: number;
  aircraftTypes: Map<string, number>;
  nearbyBases: string[];
  firstDetected: Date;
  lastUpdated: Date;
  /** Heading coherence of aircraft in this surge (if enough samples) */
  headingCoherence?: HeadingCoherence;
}

export interface TheaterTransit {
  flightId: string;
  callsign: string;
  operator: MilitaryOperator;
  fromTheater: string;
  toTheater: string;
  /** When the flight was last seen in the origin theater */
  departedAt: number;
  /** When the flight was first seen in the destination theater */
  arrivedAt: number;
  /** Transit time in minutes */
  transitMinutes: number;
}

export interface TheaterActivity {
  theaterId: string;
  timestamp: number;
  transportCount: number;
  fighterCount: number;
  reconCount: number;
  totalMilitary: number;
  flightIds: string[];
}

const THEATERS: MilitaryTheater[] = [
  {
 id: 'middle-east',
 name: 'Middle East / Persian Gulf',
 baseIds: ['al_udeid', 'ali_al_salem_air_base', 'camp_arifjan', 'camp_buehring', 'kuwait_naval_base',
 'naval_support_activity_bahrain', 'isa_air_base', 'masirah_aira_base', 'rafo_thumrait',
 'al_dhafra_air_base', 'port_of_jebel_ali', 'fujairah_naval_base', 'prince_sultan_air_base',
 'ain_assad_air_base', 'camp_victory', 'naval_support_facility_diego_garcia'],
 centerLat: 27,
 centerLon: 50,
  },
  {
 id: 'europe-east',
 name: 'Eastern Europe',
 baseIds: ['camp_bondsteel', 'aitos_logistics_center', 'bezmer', 'graf_ignatievo'],
 centerLat: 45,
 centerLon: 25,
  },
  {
 id: 'europe-west',
 name: 'Western Europe',
 baseIds: ['ramstein', 'spangdahlem', 'usag_stuttgart', 'raf_lakenheath', 'raf_mildenhall', 'aviano'],
 centerLat: 50,
 centerLon: 8,
  },
  {
 id: 'pacific-west',
 name: 'Western Pacific',
 baseIds: ['kadena_air_base', 'camp_fuji', 'fleet_activities_okinawa', 'yokota', 'misawsa',
 'osan_air_base', 'kunsan_ab', 'us_army_garrison_humphreys', 'andersen_air_force_base'],
 centerLat: 30,
 centerLon: 130,
  },
  {
 id: 'africa-horn',
 name: 'Horn of Africa',
 baseIds: ['camp_lemonnier', 'contingency_location_garoua', 'niger_air_base_201'],
 centerLat: 10,
 centerLon: 40,
  },
];

const SURGE_THRESHOLD = 2;
const BASELINE_WINDOW_HOURS = 48;
const BASELINE_MIN_SAMPLES = 6;
const TRANSPORT_CALLSIGN_PATTERNS = [
  /^RCH/i, /^REACH/i, /^MOOSE/i, /^HERKY/i, /^EVAC/i, /^DUSTOFF/i,
];
const PROXIMITY_RADIUS_KM = 150;

const activityHistory = new Map<string, TheaterActivity[]>();
const activeSurges = new Map<string, SurgeAlert>();
let lastCleanup = Date.now();
const CLEANUP_INTERVAL = 60 * 60 * 1000;
const MAX_HISTORY_HOURS = 72;

// ── Heading coherence (circular variance) ───────────────────────────────────
const DEG2RAD = Math.PI / 180;
const MIN_COHERENCE_SAMPLE = 3;

function computeHeadingCoherence(flights: MilitaryFlight[]): HeadingCoherence | undefined {
  const airborne = flights.filter(f => !f.onGround && f.speed > 50);
  if (airborne.length < MIN_COHERENCE_SAMPLE) return undefined;
  let sinSum = 0;
  let cosSum = 0;
  for (const f of airborne) {
    sinSum += Math.sin(f.heading * DEG2RAD);
    cosSum += Math.cos(f.heading * DEG2RAD);
  }
  const n = airborne.length;
  const rBar = Math.hypot(sinSum, cosSum) / n; // 0 = uniform, 1 = identical
  const meanRad = Math.atan2(sinSum / n, cosSum / n);
  const meanHeading = ((meanRad / DEG2RAD) + 360) % 360;
  return { coherence: rBar, meanHeading: Math.round(meanHeading), sampleSize: n };
}

// ── Inter-theater transit tracking ──────────────────────────────────────────
/** Last known theater per flight ID */
const flightTheaterHistory = new Map<string, { theaterId: string; timestamp: number }>();
const recentTransits: TheaterTransit[] = [];
const TRANSIT_MAX_AGE_MS = 6 * 60 * 60 * 1000; // keep transits for 6h
const TRANSIT_MAX_GAP_MS = 4 * 60 * 60 * 1000;  // max time between theaters to count as transit

function getTheaterForBase(baseId: string): MilitaryTheater | null {
  for (const theater of THEATERS) {
 if (theater.baseIds.includes(baseId)) {
 return theater;
 }
  }
  return null;
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
 Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
 Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearbyBases(lat: number, lon: number): { baseId: string; baseName: string; distance: number }[] {
  const nearby: { baseId: string; baseName: string; distance: number }[] = [];
  for (const base of MILITARY_BASES_EXPANDED) {
 const dist = distanceKm(lat, lon, base.lat, base.lon);
 if (dist <= PROXIMITY_RADIUS_KM) {
 nearby.push({ baseId: base.id, baseName: base.name, distance: dist });
 }
  }
  return nearby.sort((a, b) => a.distance - b.distance);
}

function isTransportFlight(flight: MilitaryFlight): boolean {
  if (flight.aircraftType === 'transport' || flight.aircraftType === 'tanker') {
 return true;
  }
  const callsign = flight.callsign.toUpperCase();
  return TRANSPORT_CALLSIGN_PATTERNS.some(p => p.test(callsign));
}

function classifyFlight(flight: MilitaryFlight): 'transport' | 'fighter' | 'recon' | 'other' {
  if (isTransportFlight(flight)) return 'transport';
  if (flight.aircraftType === 'fighter') return 'fighter';
  if (flight.aircraftType === 'reconnaissance' || flight.aircraftType === 'awacs') return 'recon';
  return 'other';
}

function getTheaterForFlight(flight: MilitaryFlight): MilitaryTheater | null {
  const nearbyBases = findNearbyBases(flight.lat, flight.lon);
  for (const { baseId } of nearbyBases) {
 const theater = getTheaterForBase(baseId);
 if (theater) return theater;
  }
  for (const theater of THEATERS) {
 const dist = distanceKm(flight.lat, flight.lon, theater.centerLat, theater.centerLon);
 if (dist < 1500) return theater;
  }
  return null;
}

function calculateBaseline(theaterId: string): { transport: number; fighter: number; recon: number } {
  const history = activityHistory.get(theaterId) || [];
  const cutoff = Date.now() - BASELINE_WINDOW_HOURS * 60 * 60 * 1000;
  const relevant = history.filter(h => h.timestamp >= cutoff);

  if (relevant.length < BASELINE_MIN_SAMPLES) {
 return { transport: 3, fighter: 2, recon: 1 };
  }

  const avgTransport = relevant.reduce((sum, h) => sum + h.transportCount, 0) / relevant.length;
  const avgFighter = relevant.reduce((sum, h) => sum + h.fighterCount, 0) / relevant.length;
  const avgRecon = relevant.reduce((sum, h) => sum + h.reconCount, 0) / relevant.length;

  return {
 transport: Math.max(2, avgTransport),
 fighter: Math.max(1, avgFighter),
 recon: Math.max(1, avgRecon),
  };
}

function cleanupOldHistory(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;

  const cutoff = now - MAX_HISTORY_HOURS * 60 * 60 * 1000;
  for (const [theaterId, history] of activityHistory) {
 const filtered = history.filter(h => h.timestamp >= cutoff);
 if (filtered.length === 0) {
 activityHistory.delete(theaterId);
 } else {
 activityHistory.set(theaterId, filtered);
 }
  }

  for (const [surgeId, surge] of activeSurges) {
 const age = now - surge.lastUpdated.getTime();
 if (age > 2 * 60 * 60 * 1000) {
 activeSurges.delete(surgeId);
 }
  }
}

// eslint-disable-next-line sonarjs/cognitive-complexity
export function analyzeFlightsForSurge(flights: MilitaryFlight[]): SurgeAlert[] {
  cleanupOldHistory();

  const theaterFlights = new Map<string, MilitaryFlight[]>();
  for (const flight of flights) {
 const theater = getTheaterForFlight(flight);
 if (!theater) continue;
 const existing = theaterFlights.get(theater.id) || [];
 existing.push(flight);
 theaterFlights.set(theater.id, existing);
  }

  const now = Date.now();
  const newAlerts: SurgeAlert[] = [];

  // ── Inter-theater transit detection ──
  for (const [theaterId, theaterFlightList] of theaterFlights) {
    for (const flight of theaterFlightList) {
      const prev = flightTheaterHistory.get(flight.id);
      if (prev && prev.theaterId !== theaterId && now - prev.timestamp < TRANSIT_MAX_GAP_MS) {
        const transitMinutes = Math.round((now - prev.timestamp) / 60_000);
        recentTransits.push({
          flightId: flight.id,
          callsign: flight.callsign,
          operator: flight.operator,
          fromTheater: prev.theaterId,
          toTheater: theaterId,
          departedAt: prev.timestamp,
          arrivedAt: now,
          transitMinutes,
        });
      }
      flightTheaterHistory.set(flight.id, { theaterId, timestamp: now });
    }
  }
  // Prune old transits and stale theater history
  const transitCutoff = now - TRANSIT_MAX_AGE_MS;
  while (recentTransits.length > 0 && recentTransits[0]!.arrivedAt < transitCutoff) {
    recentTransits.shift();
  }
  for (const [fid, entry] of flightTheaterHistory) {
    if (now - entry.timestamp > TRANSIT_MAX_AGE_MS) flightTheaterHistory.delete(fid);
  }

  for (const [theaterId, theaterFlightList] of theaterFlights) {
 const theater = THEATERS.find(t => t.id === theaterId);
 if (!theater) continue;

 let transportCount = 0;
 let fighterCount = 0;
 let reconCount = 0;
 const aircraftTypes = new Map<string, number>();
 const nearbyBasesSet = new Set<string>();
 const transportFlights: MilitaryFlight[] = [];
 const fighterFlights: MilitaryFlight[] = [];

 for (const flight of theaterFlightList) {
 const classification = classifyFlight(flight);
 if (classification === 'transport') { transportCount++; transportFlights.push(flight); }
 else if (classification === 'fighter') { fighterCount++; fighterFlights.push(flight); }
 else if (classification === 'recon') reconCount++;

 const typeKey = flight.aircraftModel || flight.aircraftType || 'unknown';
 aircraftTypes.set(typeKey, (aircraftTypes.get(typeKey) || 0) + 1);

 const nearby = findNearbyBases(flight.lat, flight.lon);
 for (const { baseName } of nearby.slice(0, 3)) {
 nearbyBasesSet.add(baseName);
 }
 }

 const activity: TheaterActivity = {
 theaterId,
 timestamp: now,
 transportCount,
 fighterCount,
 reconCount,
 totalMilitary: theaterFlightList.length,
 flightIds: theaterFlightList.map(f => f.id),
 };

 const history = activityHistory.get(theaterId) || [];
 history.push(activity);
 if (history.length > 200) history.shift();
 activityHistory.set(theaterId, history);

 const baseline = calculateBaseline(theaterId);

 if (transportCount >= baseline.transport * SURGE_THRESHOLD && transportCount >= 5) {
 const surgeId = `airlift-${theaterId}`;
 const surgeMultiple = transportCount / baseline.transport;

 const existing = activeSurges.get(surgeId);
 if (existing) {
 existing.currentCount = transportCount;
 existing.surgeMultiple = surgeMultiple;
 existing.aircraftTypes = aircraftTypes;
 existing.nearbyBases = [...nearbyBasesSet];
 existing.lastUpdated = new Date();
 existing.headingCoherence = computeHeadingCoherence(transportFlights);
 } else {
 const alert: SurgeAlert = {
 id: surgeId,
 theater,
 type: 'airlift',
 currentCount: transportCount,
 baselineCount: Math.round(baseline.transport),
 surgeMultiple,
 aircraftTypes,
 nearbyBases: [...nearbyBasesSet],
 firstDetected: new Date(),
 lastUpdated: new Date(),
 headingCoherence: computeHeadingCoherence(transportFlights),
 };
 activeSurges.set(surgeId, alert);
 newAlerts.push(alert);
 }
 }

 if (fighterCount >= baseline.fighter * SURGE_THRESHOLD && fighterCount >= 4) {
 const surgeId = `fighter-${theaterId}`;
 const surgeMultiple = fighterCount / baseline.fighter;

 if (!activeSurges.has(surgeId)) {
 const alert: SurgeAlert = {
 id: surgeId,
 theater,
 type: 'fighter',
 currentCount: fighterCount,
 baselineCount: Math.round(baseline.fighter),
 surgeMultiple,
 aircraftTypes,
 nearbyBases: [...nearbyBasesSet],
 firstDetected: new Date(),
 lastUpdated: new Date(),
 headingCoherence: computeHeadingCoherence(fighterFlights),
 };
 activeSurges.set(surgeId, alert);
 newAlerts.push(alert);
 }
 }
  }

  return newAlerts;
}

export function getActiveSurges(): SurgeAlert[] {
  return [...activeSurges.values()];
}

export function getTheaterActivity(theaterId: string): TheaterActivity[] {
  return activityHistory.get(theaterId) || [];
}

/** Get recent inter-theater transits (aircraft that moved between theaters). */
export function getRecentTransits(): TheaterTransit[] {
  return [...recentTransits];
}

/** Get transits into a specific theater (force redeployment indicator). */
export function getTransitsToTheater(theaterId: string): TheaterTransit[] {
  return recentTransits.filter(t => t.toTheater === theaterId);
}

// ============ FOREIGN MILITARY CONCENTRATION DETECTION ============

function getRegionForPosition(lat: number, lon: number): GeoRegion | null {
  for (const region of SENSITIVE_REGIONS) {
 const dist = distanceKm(lat, lon, region.lat, region.lon);
 if (dist <= region.radiusKm) {
 return region;
 }
  }
  return null;
}

function isHomeRegion(operator: MilitaryOperator, regionId: string): boolean {
  const config = OPERATOR_HOMES.find(o => o.operator === operator);
  if (!config) return true; // Unknown operator - don't alert
  return config.homeRegions.includes(regionId);
}

function getOperatorThreshold(operator: MilitaryOperator): number {
  const config = OPERATOR_HOMES.find(o => o.operator === operator);
  return config?.alertThreshold ?? 3;
}

function getOperatorCountry(operator: MilitaryOperator): string {
  const config = OPERATOR_HOMES.find(o => o.operator === operator);
  return config?.country ?? 'Unknown';
}

// Drop foreign-presence entries whose operator/region pair hasn't been
// re-detected within the TTL, so the map doesn't retain stale flight arrays.
function pruneStaleForeignPresence(): void {
  const cutoff = Date.now() - FOREIGN_PRESENCE_TTL_MS;
  for (const [key, alert] of activeForeignPresence) {
 if (alert.firstDetected.getTime() < cutoff) activeForeignPresence.delete(key);
  }
}

export function detectForeignMilitaryPresence(flights: MilitaryFlight[]): ForeignPresenceAlert[] {
  const newAlerts: ForeignPresenceAlert[] = [];

  // Group flights by operator and region
  const presenceMap = new Map<string, { operator: MilitaryOperator; region: GeoRegion; flights: MilitaryFlight[] }>();

  for (const flight of flights) {
 const region = getRegionForPosition(flight.lat, flight.lon);
 if (!region) continue;

 // Skip if this is a home region for this operator
 if (isHomeRegion(flight.operator, region.id)) continue;

 const key = `${flight.operator}-${region.id}`;
 const existing = presenceMap.get(key);
 if (existing) {
 existing.flights.push(flight);
 } else {
 presenceMap.set(key, { operator: flight.operator, region, flights: [flight] });
 }
  }

  // Dedup window: keys are bucketed by 2-hour window. Drop the prior bucket's
  // keys on rollover so the set stays bounded over a long session.
  const currentBucket = Math.floor(Date.now() / (2 * 60 * 60 * 1000));
  if (currentBucket !== seenForeignAlertsBucket) {
 seenForeignAlerts.clear();
 seenForeignAlertsBucket = currentBucket;
  }

  pruneStaleForeignPresence();

  // Check for concentrations above threshold
  for (const [key, presence] of presenceMap) {
 const threshold = getOperatorThreshold(presence.operator);
 if (presence.flights.length < threshold) continue;

 // Check if we've already alerted on this (within last 2 hours)
 const alertKey = `${key}-${currentBucket}`;
 if (seenForeignAlerts.has(alertKey)) continue;
 seenForeignAlerts.add(alertKey);

 const alert: ForeignPresenceAlert = {
 id: key,
 operator: presence.operator,
 operatorCountry: getOperatorCountry(presence.operator),
 region: presence.region,
 aircraftCount: presence.flights.length,
 flights: presence.flights,
 firstDetected: new Date(),
 };

 activeForeignPresence.set(key, alert);
 newAlerts.push(alert);
  }

  return newAlerts;
}

// Map operator country names to ISO codes for focal point lookup
const COUNTRY_TO_ISO: Record<string, string> = {
  'USA': 'US',
  'Russia': 'RU',
  'China': 'CN',
  'Israel': 'IL',
  'Iran': 'IR',
  'UK': 'GB',
  'France': 'FR',
  'Germany': 'DE',
  'Taiwan': 'TW',
  'Ukraine': 'UA',
  'Saudi Arabia': 'SA',
};

// Map regions to affected countries (for news correlation)
const REGION_AFFECTED_COUNTRIES: Record<string, string[]> = {
  'persian-gulf': ['IR', 'SA'],
  'strait-hormuz': ['IR'],
  'iran-border': ['IR', 'IL'],
  'baltics': ['RU', 'UA'],
  'poland-border': ['RU', 'UA'],
  'black-sea': ['RU', 'UA'],
  'taiwan-strait': ['TW', 'CN'],
  'south-china-sea': ['CN', 'TW'],
  'east-med': ['IL', 'IR'],
  'alaska-adiz': ['RU'],
};

export function foreignPresenceToSignal(alert: ForeignPresenceAlert): {
  id: string;
  type: SignalType;
  source: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  confidence: number;
  category: string;
  timestamp: Date;
  location?: { lat: number; lon: number; name: string };
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
} {
  const aircraftTypes = new Map<string, number>();
  const callsigns: string[] = [];

  for (const flight of alert.flights) {
 const typeKey = flight.aircraftModel || flight.aircraftType || 'unknown';
 aircraftTypes.set(typeKey, (aircraftTypes.get(typeKey) || 0) + 1);
 callsigns.push(flight.callsign);
  }

  const aircraftList = [...aircraftTypes.entries()]
 .sort((a, b) => b[1] - a[1])
 .slice(0, 3)
 .map(([type, count]) => `${count}x ${type}`)
 .join(', ');

  // Severity based on operator and region sensitivity
  const criticalCombos = [
 ['vks', 'baltics'], ['vks', 'poland-border'], ['vks', 'alaska-adiz'],
 ['plaaf', 'taiwan-strait'], ['plan', 'taiwan-strait'],
 ['usaf', 'iran-border'], ['usn', 'persian-gulf'], ['iaf', 'iran-border'],
  ];

  const isCritical = criticalCombos.some(
 ([op, reg]) => alert.operator === op && alert.region.id === reg
  );

   
  const severity = isCritical ? 'critical' :
 // eslint-disable-next-line sonarjs/no-nested-conditional
 (alert.aircraftCount >= 5 ? 'high' : 'medium');

  const confidence = Math.min(0.95, 0.7 + alert.aircraftCount * 0.05);

  // Gather relevant countries for focal point lookup
  const relevantCountries: string[] = [];
  const operatorISO = COUNTRY_TO_ISO[alert.operatorCountry];
  if (operatorISO) relevantCountries.push(operatorISO);

  const affectedCountries = REGION_AFFECTED_COUNTRIES[alert.region.id] || [];
  for (const iso of affectedCountries) {
 if (!relevantCountries.includes(iso)) {
 relevantCountries.push(iso);
 }
  }

  // Get news correlation from focal point detector
  const newsContext = focalPointDetector.getNewsCorrelationContext(relevantCountries);

  // Build enhanced description with news correlation
  const description = `${alert.aircraftCount} ${alert.operatorCountry} aircraft detected in ${alert.region.name}. ` +
 `${aircraftList}. Callsigns: ${callsigns.slice(0, 4).join(', ')}${callsigns.length > 4 ? '...' : ''}`;

  // Check for critical focal points in affected region
  const focalPointContexts: string[] = [];
  for (const iso of relevantCountries) {
 const fp = focalPointDetector.getFocalPointForCountry(iso);
 if (fp && fp.newsMentions > 0) {
 focalPointContexts.push(`${fp.displayName}: ${fp.newsMentions} news mentions (${fp.urgency})`);
 }
  }

  const metadata: Record<string, unknown> = {
 operator: alert.operator,
 operatorCountry: alert.operatorCountry,
 regionId: alert.region.id,
 regionName: alert.region.name,
 lat: alert.region.lat,
 lon: alert.region.lon,
 aircraftCount: alert.aircraftCount,
 aircraftTypes: Object.fromEntries(aircraftTypes),
 callsigns,
 relevantCountries,
 newsCorrelation: newsContext,
 focalPointContext: focalPointContexts.length > 0 ? focalPointContexts : null,
  };

  return {
 id: `foreign-${alert.id}-${alert.firstDetected.getTime()}`,
 type: 'military_surge',
 source: 'Military Flight Tracking',
 title: `🚨 ${alert.operatorCountry} Military in ${alert.region.name}`,
 description,
 severity,
 confidence,
 category: 'military',
 timestamp: alert.firstDetected,
 location: {
 lat: alert.region.lat,
 lon: alert.region.lon,
 name: alert.region.name,
 },
 data: metadata,
 metadata,
  };
}

export function getActiveForeignPresence(): ForeignPresenceAlert[] {
  return [...activeForeignPresence.values()];
}

// ============ SURGE DETECTION (baseline-based) ============

export function surgeAlertToSignal(surge: SurgeAlert): {
  id: string;
  type: SignalType;
  source: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  confidence: number;
  category: string;
  timestamp: Date;
  location?: { lat: number; lon: number; name: string };
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
} {
  const typeLabels = {
 airlift: '🛫 Military Airlift Surge',
 fighter: '✈️ Fighter Deployment Surge',
 reconnaissance: '🔭 Reconnaissance Surge',
  };

  const aircraftList = [...surge.aircraftTypes.entries()]
 .sort((a, b) => b[1] - a[1])
 .slice(0, 3)
 .map(([type, count]) => `${count}x ${type}`)
 .join(', ');

   
  const severity = surge.surgeMultiple >= 4 ? 'critical' :
 // eslint-disable-next-line sonarjs/no-nested-conditional
 (surge.surgeMultiple >= 3 ? 'high' : 'medium');

  const confidence = Math.min(0.95, 0.6 + (surge.surgeMultiple - 2) * 0.1);

  const transitsIn = getTransitsToTheater(surge.theater.id);
  const metadata = {
 theaterId: surge.theater.id,
 surgeType: surge.type,
 currentCount: surge.currentCount,
 baselineCount: surge.baselineCount,
 surgeMultiple: surge.surgeMultiple,
 aircraftTypes: Object.fromEntries(surge.aircraftTypes),
 nearbyBases: surge.nearbyBases,
 headingCoherence: surge.headingCoherence ?? null,
 transitsIntoTheater: transitsIn.length > 0 ? transitsIn.map(t => ({
   callsign: t.callsign, operator: t.operator,
   from: t.fromTheater, transitMinutes: t.transitMinutes,
 })) : null,
  };

  return {
 id: `surge-${surge.id}-${surge.firstDetected.getTime()}`,
 type: 'military_surge',
 source: 'Military Flight Tracking',
 title: `${typeLabels[surge.type]} - ${surge.theater.name}`,
 description: `${surge.currentCount} ${surge.type} aircraft detected (${surge.surgeMultiple.toFixed(1)}x baseline). ` +
 `${aircraftList}. Near: ${surge.nearbyBases.slice(0, 3).join(', ')}` +
 (surge.headingCoherence && surge.headingCoherence.coherence > 0.7
   ? `. Coordinated heading: ${surge.headingCoherence.meanHeading}° (${(surge.headingCoherence.coherence * 100).toFixed(0)}% coherence)`
   : ''),
 severity,
 confidence,
 category: 'military',
 timestamp: surge.firstDetected,
 location: {
 lat: surge.theater.centerLat,
 lon: surge.theater.centerLon,
 name: surge.theater.name,
 },
 data: metadata,
 metadata,
  };
}

// ============ 7-DAY POSTURE TIME-SERIES ============

type PostureLevel = 'normal' | 'elevated' | 'critical';

export interface PostureSnapshot {
  timestamp: number;
  postureLevel: PostureLevel;
  totalAircraft: number;
  totalVessels: number;
}

const POSTURE_TS_KEY = 'crystalball-theater-posture-7d-v1';
const POSTURE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const POSTURE_MAX_PER_THEATER = 336;

function loadPostureStore(): Record<string, PostureSnapshot[]> {
  try {
    const raw = localStorage.getItem(POSTURE_TS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, PostureSnapshot[]>;
  } catch {
    return {};
  }
}

function savePostureStore(store: Record<string, PostureSnapshot[]>): void {
  try {
    localStorage.setItem(POSTURE_TS_KEY, JSON.stringify(store));
  } catch { /* quota exceeded */ }
}

function recordPostureSnapshot(summary: TheaterPostureSummary): void {
  const store = loadPostureStore();
  const snaps = store[summary.theaterId] ?? [];
  const now = Date.now();

  snaps.push({
    timestamp: now,
    postureLevel: summary.postureLevel,
    totalAircraft: summary.totalAircraft,
    totalVessels: summary.totalVessels,
  });

  const cutoff = now - POSTURE_MAX_AGE_MS;
  const pruned = snaps.filter(s => s.timestamp >= cutoff);
  store[summary.theaterId] = pruned.length > POSTURE_MAX_PER_THEATER
    ? pruned.slice(pruned.length - POSTURE_MAX_PER_THEATER)
    : pruned;

  savePostureStore(store);
}

export function getPostureTimeSeries(theaterId: string): PostureSnapshot[] {
  const store = loadPostureStore();
  return store[theaterId] ?? [];
}

const POSTURE_LEVEL_NUM: Record<string, number> = { normal: 0, elevated: 1, critical: 2 };
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function computeWeekOverWeekTrend(theaterId: string): 'escalating' | 'stable' | 'de-escalating' {
  const snaps = getPostureTimeSeries(theaterId);
  if (snaps.length < 2) return 'stable';

  const now = Date.now();
  const last24h = snaps.filter(s => now - s.timestamp < MS_PER_DAY);
  const prev6d = snaps.filter(s => now - s.timestamp >= MS_PER_DAY && now - s.timestamp < POSTURE_MAX_AGE_MS);

  if (last24h.length === 0 || prev6d.length === 0) return 'stable';

  const recentAvg = last24h.reduce((sum, s) => sum + POSTURE_LEVEL_NUM[s.postureLevel]!, 0) / last24h.length;
  const olderAvg = prev6d.reduce((sum, s) => sum + POSTURE_LEVEL_NUM[s.postureLevel]!, 0) / prev6d.length;
  const diff = recentAvg - olderAvg;

  if (diff > 0.25) return 'escalating';
  if (diff < -0.25) return 'de-escalating';
  return 'stable';
}

function computeDaysAtElevated(theaterId: string): number {
  const snaps = getPostureTimeSeries(theaterId);
  if (snaps.length === 0) return 0;

  const now = Date.now();
  let count = 0;

  for (let d = 0; d < 7; d++) {
    const dayStart = now - (d + 1) * MS_PER_DAY;
    const dayEnd = now - d * MS_PER_DAY;
    const daySnaps = snaps.filter(s => s.timestamp >= dayStart && s.timestamp < dayEnd);
    if (daySnaps.length === 0) continue;
    const elevatedCount = daySnaps.filter(s => s.postureLevel === 'elevated' || s.postureLevel === 'critical').length;
    if (elevatedCount / daySnaps.length > 0.5) count++;
  }

  return count;
}

// ============ THEATER POSTURE AGGREGATION ============

interface PostureTheater {
  id: string;
  name: string;
  shortName: string;
  targetNation: string | null;
  regions: string[];
  bounds: { north: number; south: number; east: number; west: number };
  thresholds: { elevated: number; critical: number };
  navalThresholds: { elevated: number; critical: number };
  strikeIndicators: { minTankers: number; minAwacs: number; minFighters: number };
}

const POSTURE_THEATERS: PostureTheater[] = [
  {
 id: 'iran-theater',
 name: 'Iran Theater',
 shortName: 'IRAN',
 targetNation: 'Iran',
 regions: ['persian-gulf', 'strait-hormuz', 'iran-border'],
 bounds: { north: 42, south: 20, east: 65, west: 30 },
 thresholds: { elevated: 8, critical: 20 },
 navalThresholds: { elevated: 2, critical: 5 },  // Low: AIS coverage poor in Persian Gulf, military vessels go dark
 strikeIndicators: { minTankers: 2, minAwacs: 1, minFighters: 5 },
  },
  {
 id: 'taiwan-theater',
 name: 'Taiwan Strait',
 shortName: 'TAIWAN',
 targetNation: 'Taiwan',
 regions: ['taiwan-strait', 'south-china-sea'],
 bounds: { north: 30, south: 18, east: 130, west: 115 },
 thresholds: { elevated: 6, critical: 15 },
 navalThresholds: { elevated: 4, critical: 10 },
 strikeIndicators: { minTankers: 1, minAwacs: 1, minFighters: 4 },
  },
  {
 id: 'baltic-theater',
 name: 'Baltic Theater',
 shortName: 'BALTIC',
 targetNation: null,
 regions: ['baltics', 'poland-border', 'kaliningrad'],
 bounds: { north: 65, south: 52, east: 32, west: 10 },
 thresholds: { elevated: 5, critical: 12 },
 navalThresholds: { elevated: 3, critical: 8 },
 strikeIndicators: { minTankers: 1, minAwacs: 1, minFighters: 3 },
  },
  {
 id: 'blacksea-theater',
 name: 'Black Sea',
 shortName: 'BLACK SEA',
 targetNation: null,
 regions: ['black-sea'],
 bounds: { north: 48, south: 40, east: 42, west: 26 },
 thresholds: { elevated: 4, critical: 10 },
 navalThresholds: { elevated: 3, critical: 6 },
 strikeIndicators: { minTankers: 1, minAwacs: 1, minFighters: 3 },
  },
  {
 id: 'korea-theater',
 name: 'Korean Peninsula',
 shortName: 'KOREA',
 targetNation: 'North Korea',
 regions: ['korean-dmz', 'sea-of-japan'],
 bounds: { north: 43, south: 33, east: 132, west: 124 },
 thresholds: { elevated: 5, critical: 12 },
 navalThresholds: { elevated: 3, critical: 8 },
 strikeIndicators: { minTankers: 1, minAwacs: 1, minFighters: 3 },
  },
  {
 id: 'south-china-sea',
 name: 'South China Sea',
 shortName: 'SCS',
 targetNation: null,
 regions: ['south-china-sea', 'spratly-islands'],
 bounds: { north: 25, south: 5, east: 121, west: 105 },
 thresholds: { elevated: 6, critical: 15 },
 navalThresholds: { elevated: 4, critical: 10 },
 strikeIndicators: { minTankers: 1, minAwacs: 1, minFighters: 4 },
  },
  {
 id: 'east-med-theater',
 name: 'Eastern Mediterranean',
 shortName: 'E.MED',
 targetNation: null,
 regions: ['eastern-med', 'levant'],
 bounds: { north: 37, south: 33, east: 37, west: 25 },
 thresholds: { elevated: 4, critical: 10 },
 navalThresholds: { elevated: 3, critical: 6 },
 strikeIndicators: { minTankers: 1, minAwacs: 1, minFighters: 3 },
  },
  {
 id: 'israel-gaza-theater',
 name: 'Israel/Gaza',
 shortName: 'GAZA',
 targetNation: 'Gaza',
 regions: ['israel', 'gaza', 'west-bank'],
 bounds: { north: 33, south: 29, east: 36, west: 33 },
 thresholds: { elevated: 3, critical: 8 },
 navalThresholds: { elevated: 2, critical: 5 },
 strikeIndicators: { minTankers: 1, minAwacs: 1, minFighters: 3 },
  },
  {
 id: 'yemen-redsea-theater',
 name: 'Yemen/Red Sea',
 shortName: 'RED SEA',
 targetNation: 'Yemen',
 regions: ['yemen', 'red-sea', 'bab-el-mandeb'],
 bounds: { north: 22, south: 11, east: 54, west: 32 },
 thresholds: { elevated: 4, critical: 10 },
 navalThresholds: { elevated: 3, critical: 8 },
 strikeIndicators: { minTankers: 1, minAwacs: 1, minFighters: 3 },
  },
];

export interface TheaterPostureSummary {
  theaterId: string;
  theaterName: string;
  shortName: string;
  targetNation: string | null;
  // Aircraft counts
  fighters: number;
  tankers: number;
  awacs: number;
  reconnaissance: number;
  transport: number;
  bombers: number;
  drones: number;
  totalAircraft: number;
  // Naval vessel counts (added client-side)
  destroyers: number;
  frigates: number;
  carriers: number;
  submarines: number;
  patrol: number;
  auxiliaryVessels: number;
  totalVessels: number;
  // Combined
  byOperator: Record<string, number>;
  postureLevel: 'normal' | 'elevated' | 'critical';
  strikeCapable: boolean;
  strikeGroupPresent: boolean;
  trend: 'increasing' | 'stable' | 'decreasing';
  changePercent: number;
  weekOverWeekTrend: 'escalating' | 'stable' | 'de-escalating';
  daysAtElevated: number;
  summary: string;
  headline: string;
  centerLat: number;
  centerLon: number;
  // Theater bounds for vessel matching
  bounds?: { north: number; south: number; east: number; west: number };
}

// eslint-disable-next-line sonarjs/cognitive-complexity
export function getTheaterPostureSummaries(flights: MilitaryFlight[]): TheaterPostureSummary[] {
  const summaries: TheaterPostureSummary[] = [];

  for (const theater of POSTURE_THEATERS) {
 const theaterFlights = flights.filter(
 (f) =>
 f.lat >= theater.bounds.south &&
 f.lat <= theater.bounds.north &&
 f.lon >= theater.bounds.west &&
 f.lon <= theater.bounds.east
 );

 const byType = {
 fighters: theaterFlights.filter((f) => f.aircraftType === 'fighter').length,
 tankers: theaterFlights.filter((f) => f.aircraftType === 'tanker').length,
 awacs: theaterFlights.filter((f) => f.aircraftType === 'awacs').length,
 reconnaissance: theaterFlights.filter((f) => f.aircraftType === 'reconnaissance').length,
 transport: theaterFlights.filter((f) => f.aircraftType === 'transport').length,
 bombers: theaterFlights.filter((f) => f.aircraftType === 'bomber').length,
 drones: theaterFlights.filter((f) => f.aircraftType === 'drone').length,
 };

 const total = Object.values(byType).reduce((a, b) => a + b, 0);

 const byOperator: Record<string, number> = {};
 for (const f of theaterFlights) {
 byOperator[f.operator] = (byOperator[f.operator] || 0) + 1;
 }

  
 const postureLevel: 'normal' | 'elevated' | 'critical' =
 total >= theater.thresholds.critical
 ? 'critical'
 // eslint-disable-next-line sonarjs/no-nested-conditional
 : (total >= theater.thresholds.elevated
 ? 'elevated'
 : 'normal');

 const strikeCapable =
 byType.tankers >= theater.strikeIndicators.minTankers &&
 byType.awacs >= theater.strikeIndicators.minAwacs &&
 byType.fighters >= theater.strikeIndicators.minFighters;

 const history = activityHistory.get(theater.id) || [];
 const recent = history.slice(-6);
 const older = history.slice(-12, -6);
 const recentAvg =
 recent.length > 0 ? recent.reduce((a, b) => a + b.totalMilitary, 0) / recent.length : total;
 const olderAvg =
 older.length > 0 ? older.reduce((a, b) => a + b.totalMilitary, 0) / older.length : total;
 const changePercent = olderAvg > 0 ? Math.round(((recentAvg - olderAvg) / olderAvg) * 100) : 0;
  
 const trend: 'increasing' | 'stable' | 'decreasing' =
 // eslint-disable-next-line sonarjs/no-nested-conditional
 changePercent > 10 ? 'increasing' : (changePercent < -10 ? 'decreasing' : 'stable');

 const parts: string[] = [];
 if (byType.fighters > 0) parts.push(`${byType.fighters} fighters`);
 if (byType.tankers > 0) parts.push(`${byType.tankers} tankers`);
 if (byType.awacs > 0) parts.push(`${byType.awacs} AWACS`);
 if (byType.reconnaissance > 0) parts.push(`${byType.reconnaissance} recon`);
 const summary = parts.join(', ') || 'No military aircraft';

  
 const headline =
 postureLevel === 'critical'
 ? `Critical military buildup - ${theater.name}`
 // eslint-disable-next-line sonarjs/no-nested-conditional
 : (postureLevel === 'elevated'
 ? `Elevated military activity - ${theater.name}`
 : `Normal activity - ${theater.name}`);

 summaries.push({
 theaterId: theater.id,
 theaterName: theater.name,
 shortName: theater.shortName,
 targetNation: theater.targetNation,
 // Aircraft
 fighters: byType.fighters,
 tankers: byType.tankers,
 awacs: byType.awacs,
 reconnaissance: byType.reconnaissance,
 transport: byType.transport,
 bombers: byType.bombers,
 drones: byType.drones,
 totalAircraft: total,
 // Vessels (populated client-side)
 destroyers: 0,
 frigates: 0,
 carriers: 0,
 submarines: 0,
 patrol: 0,
 auxiliaryVessels: 0,
 totalVessels: 0,
 // Metadata
 byOperator,
 postureLevel,
 strikeCapable,
 strikeGroupPresent: false,
 trend,
 changePercent,
 weekOverWeekTrend: computeWeekOverWeekTrend(theater.id),
 daysAtElevated: computeDaysAtElevated(theater.id),
 summary,
 headline,
 centerLat: (theater.bounds.north + theater.bounds.south) / 2,
 centerLon: (theater.bounds.east + theater.bounds.west) / 2,
 bounds: theater.bounds,
 });
  }

  for (const s of summaries) {
    recordPostureSnapshot(s);
  }

  return summaries;
}

/**
 * Map theater target nations to ISO2 country codes for CII lookup.
 */
const TARGET_NATION_CODES: Record<string, string> = {
  'Iran': 'IR',
  'Taiwan': 'TW',
  'North Korea': 'KP',
  'Gaza': 'PS',
  'Yemen': 'YE',
};

/**
 * Recalculate posture level after vessels have been merged into summaries.
 * Uses "either triggers" logic: if aircraft OR vessels exceed thresholds, level escalates.
 * CII boost: theaters whose target nation has CII ≥ 70 get elevated, ≥ 85 get critical.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
export function recalcPostureWithVessels(postures: TheaterPostureSummary[]): void {
  for (const p of postures) {
 const theater = POSTURE_THEATERS.find((t) => t.id === p.theaterId);
 if (!theater) continue;

 // eslint-disable-next-line sonarjs/use-type-alias
 const airLevel: 0 | 1 | 2 =
  
 p.totalAircraft >= theater.thresholds.critical ? 2
 // eslint-disable-next-line sonarjs/no-nested-conditional
 : (p.totalAircraft >= theater.thresholds.elevated ? 1 : 0);

 const navalLevel: 0 | 1 | 2 =
  
 p.totalVessels >= theater.navalThresholds.critical ? 2
 // eslint-disable-next-line sonarjs/no-nested-conditional
 : (p.totalVessels >= theater.navalThresholds.elevated ? 1 : 0);

 // CII boost: high instability in target nation elevates theater posture
 let ciiLevel: 0 | 1 | 2 = 0;
 if (theater.targetNation) {
 const code = TARGET_NATION_CODES[theater.targetNation];
 if (code) {
 const cii = getCountryScore(code);
 if (cii !== null) {
 // eslint-disable-next-line sonarjs/no-nested-conditional
 ciiLevel = cii >= 85 ? 2 : (cii >= 70 ? 1 : 0);
 }
 }
 }

 const combined = Math.max(airLevel, navalLevel, ciiLevel) as 0 | 1 | 2;
 // eslint-disable-next-line sonarjs/no-nested-conditional
 p.postureLevel = combined === 2 ? 'critical' : (combined === 1 ? 'elevated' : 'normal');

 // Rebuild headline with combined context
 const parts: string[] = [];
 if (p.totalAircraft > 0) parts.push(`${p.totalAircraft} aircraft`);
 if (p.totalVessels > 0) parts.push(`${p.totalVessels} vessels`);
 const assetSummary = parts.join(' + ') || 'No assets';

  
 p.headline =
 p.postureLevel === 'critical'
 ? `Critical military buildup - ${p.theaterName} (${assetSummary})`
 // eslint-disable-next-line sonarjs/no-nested-conditional
 : (p.postureLevel === 'elevated'
 ? `Elevated military activity - ${p.theaterName} (${assetSummary})`
 : `Normal activity - ${p.theaterName}`);
  }
}

export function getCriticalPostures(flights: MilitaryFlight[]): TheaterPostureSummary[] {
  return getTheaterPostureSummaries(flights).filter(
 (p) => p.postureLevel === 'critical' || (p.postureLevel === 'elevated' && p.strikeCapable)
  );
}
// ── Multi-Theater Coordination ──

export interface MultiTheaterAlert {
  id: string;
  theaters: {
    theaterId: string;
    theaterName: string;
    surgeType: 'airlift' | 'fighter' | 'reconnaissance';
    surgeMultiple: number;
    aircraftCount: number;
  }[];
  coordinationScore: number;
  description: string;
  severity: 'critical';
  timestamp: Date;
}

const COORDINATION_WINDOW_MS = 4 * 60 * 60 * 1000;
const seenMultiTheaterAlerts = new Set<string>();

const NAMED_COMBOS: Record<string, string> = {
  'iran-theater+taiwan-theater': 'Dual-front posturing: Iran + Taiwan',
  'baltic-theater+blacksea-theater': 'European theater-wide mobilization',
  'iran-theater+east-med-theater+yemen-redsea-theater': 'Middle East theater-wide surge',
  'iran-theater+east-med-theater': 'Eastern Mediterranean / Iran corridor surge',
  'baltic-theater+korea-theater': 'NATO / Pacific dual alert',
};

export function detectMultiTheaterCoordination(surges: SurgeAlert[]): MultiTheaterAlert[] {
  if (surges.length < 2) return [];

  const byTheater = new Map<string, SurgeAlert>();
  for (const s of surges) {
    const existing = byTheater.get(s.theater.id);
    if (!existing || s.surgeMultiple > existing.surgeMultiple) {
      byTheater.set(s.theater.id, s);
    }
  }

  if (byTheater.size < 2) return [];

  const sorted = [...byTheater.values()].sort(
    (a, b) => a.firstDetected.getTime() - b.firstDetected.getTime(),
  );
  const earliest = sorted[0]!.firstDetected.getTime();
  const latest = sorted[sorted.length - 1]!.firstDetected.getTime();
  if (latest - earliest > COORDINATION_WINDOW_MS) return [];

  // eslint-disable-next-line sonarjs/no-alphabetical-sort
  const theaterIds = [...byTheater.keys()].sort();
  const dedupeKey = theaterIds.join('+');
  if (seenMultiTheaterAlerts.has(dedupeKey)) return [];
  seenMultiTheaterAlerts.add(dedupeKey);
  const dedupeTimer = setTimeout(() => seenMultiTheaterAlerts.delete(dedupeKey), COORDINATION_WINDOW_MS);
  // Don't hold the Node event loop open in tests (4h delay would hang the process).
  const t = dedupeTimer as unknown as { unref?: () => void };
  if (typeof t?.unref === 'function') t.unref();

  let score = 50;
  score += Math.min(20, (theaterIds.length - 2) * 10);
  if (latest - earliest < 60 * 60 * 1000) score += 10;
  const operators = new Set(surges.map(s => {
    const types = [...s.aircraftTypes.keys()];
    return types.join(',');
  }));
  if (operators.size >= 3) score += 10;
  score = Math.min(100, score);

  const description = NAMED_COMBOS[dedupeKey]
    ?? `Multi-theater coordination: ${sorted.map(s => s.theater.name).join(', ')}`;

  const theaters = sorted.map(s => ({
    theaterId: s.theater.id,
    theaterName: s.theater.name,
    surgeType: s.type,
    surgeMultiple: s.surgeMultiple,
    aircraftCount: s.currentCount,
  }));

  return [{
    id: `multi-theater-${dedupeKey}-${Date.now()}`,
    theaters,
    coordinationScore: score,
    description,
    severity: 'critical' as const,
    timestamp: new Date(),
  }];
}

export function multiTheaterToSignal(alert: MultiTheaterAlert): {
  id: string;
  type: SignalType;
  source: string;
  title: string;
  description: string;
  severity: 'critical';
  confidence: number;
  category: string;
  timestamp: Date;
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
} {
  const theaterDetails = alert.theaters
    .map(t => `${t.theaterName}: ${t.aircraftCount} aircraft (${t.surgeType}, ${t.surgeMultiple.toFixed(1)}x baseline)`)
    .join('; ');

  const metadata = {
    theaters: alert.theaters,
    coordinationScore: alert.coordinationScore,
  };

  return {
    id: alert.id,
    type: 'military_surge' as SignalType,
    source: 'Military Flight Tracking',
    title: alert.description,
    description: `Simultaneous military surges across ${alert.theaters.length} theaters. ${theaterDetails}`,
    severity: 'critical',
    confidence: alert.coordinationScore / 100,
    category: 'military',
    timestamp: alert.timestamp,
    data: metadata,
    metadata,
  };
}
