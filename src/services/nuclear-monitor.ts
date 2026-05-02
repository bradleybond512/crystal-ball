/**
 * Nuclear Monitoring Service
 *
 * Tracks radiation levels, nuclear facility status, and seismic anomalies
 * that may indicate nuclear activity.
 *
 * Data sources:
 *  - EPA RadNet (radiation monitoring stations) via sidecar proxy
 *  - USGS Earthquake API (filtered for shallow events that match test signatures)
 *  - Known nuclear facility database
 */
import { getApiBaseUrl } from '@/services/runtime';
import { loadProximityConfig, haversineKm } from '@/services/proximity-filter';
import { dataFreshness } from '@/services/data-freshness';

// ── Types ──────────────────────────────────────────────────────────────

export type RadiationLevel = 'normal' | 'elevated' | 'high' | 'critical';
export type FacilityStatus = 'operational' | 'maintenance' | 'shutdown' | 'decommissioned' | 'unknown';

export interface RadNetStation {
  id: string;
  name: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
  gammaGrossCount: number | null; // counts per minute (CPM)
  betaGrossCount: number | null;
  level: RadiationLevel;
  baselineCpm: number;
  deviationPercent: number;
  measuredAt: Date;
  distanceKm: number | null;
}

export interface NuclearFacility {
  id: string;
  name: string;
  type: 'power' | 'research' | 'weapons' | 'enrichment' | 'storage';
  status: FacilityStatus;
  lat: number;
  lon: number;
  country: string;
  state: string;
  capacity_mw: number | null;
  distanceKm: number | null;
}

export interface SeismicAnomaly {
  id: string;
  magnitude: number;
  depth_km: number;
  lat: number;
  lon: number;
  place: string;
  time: Date;
  isTestSignature: boolean;
  nearestFacility: string | null;
  distanceToFacility_km: number | null;
}

export interface NuclearMonitorData {
  stations: RadNetStation[];
  facilities: NuclearFacility[];
  seismicAnomalies: SeismicAnomaly[];
  summary: {
 totalStations: number;
 normalStations: number;
 elevatedStations: number;
 highStations: number;
 criticalStations: number;
 activeReactors: number;
 anomalyCount: number;
  };
  fetchedAt: Date;
}

// ── Cache ──────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
let cache: { data: NuclearMonitorData; fetchedAt: number } | null = null;

// ── Known nuclear facilities ───────────────────────────────────────────

interface FacilitySeed {
  name: string;
  type: NuclearFacility['type'];
  status: FacilityStatus;
  lat: number;
  lon: number;
  country: string;
  state: string;
  mw: number | null;
}

const KNOWN_FACILITIES: FacilitySeed[] = [
  // US Nuclear Power Plants (operational)
  { name: 'Vogtle (Units 1-4)', type: 'power', status: 'operational', lat: 33.14, lon: -81.76, country: 'US', state: 'GA', mw: 4600 },
  { name: 'Palo Verde', type: 'power', status: 'operational', lat: 33.39, lon: -112.86, country: 'US', state: 'AZ', mw: 3937 },
  { name: 'South Texas Project', type: 'power', status: 'operational', lat: 28.8, lon: -96.05, country: 'US', state: 'TX', mw: 2708 },
  { name: 'Braidwood', type: 'power', status: 'operational', lat: 41.24, lon: -88.23, country: 'US', state: 'IL', mw: 2386 },
  { name: 'Byron', type: 'power', status: 'operational', lat: 42.08, lon: -89.28, country: 'US', state: 'IL', mw: 2347 },
  { name: 'Diablo Canyon', type: 'power', status: 'operational', lat: 35.21, lon: -120.85, country: 'US', state: 'CA', mw: 2256 },
  { name: 'Oconee', type: 'power', status: 'operational', lat: 34.79, lon: -82.9, country: 'US', state: 'SC', mw: 2538 },
  { name: 'Browns Ferry', type: 'power', status: 'operational', lat: 34.7, lon: -87.12, country: 'US', state: 'AL', mw: 3475 },
  { name: 'Peach Bottom', type: 'power', status: 'operational', lat: 39.76, lon: -76.27, country: 'US', state: 'PA', mw: 2779 },
  { name: 'Calvert Cliffs', type: 'power', status: 'operational', lat: 38.43, lon: -76.44, country: 'US', state: 'MD', mw: 1756 },
  // International
  { name: 'Zaporizhzhia NPP', type: 'power', status: 'shutdown', lat: 47.51, lon: 34.59, country: 'UA', state: '', mw: 5700 },
  { name: 'Fukushima Daiichi', type: 'power', status: 'decommissioned', lat: 37.42, lon: 141.03, country: 'JP', state: '', mw: 0 },
  { name: 'Chernobyl', type: 'power', status: 'decommissioned', lat: 51.39, lon: 30.1, country: 'UA', state: '', mw: 0 },
  { name: 'Hinkley Point C', type: 'power', status: 'maintenance', lat: 51.21, lon: -3.13, country: 'UK', state: '', mw: 3260 },
  { name: 'Barakah NPP', type: 'power', status: 'operational', lat: 23.96, lon: 52.26, country: 'AE', state: '', mw: 5600 },
  // Nuclear test sites
  { name: 'Punggye-ri Test Site', type: 'weapons', status: 'unknown', lat: 41.28, lon: 129.08, country: 'KP', state: '', mw: null },
  { name: 'Lop Nur Test Site', type: 'weapons', status: 'shutdown', lat: 41.73, lon: 88.37, country: 'CN', state: '', mw: null },
  { name: 'Nevada National Security Site', type: 'weapons', status: 'shutdown', lat: 37, lon: -116.05, country: 'US', state: 'NV', mw: null },
  { name: 'Semipalatinsk', type: 'weapons', status: 'shutdown', lat: 50.44, lon: 77.8, country: 'KZ', state: '', mw: null },
];

// ── Baseline radiation (typical US background gamma CPM) ───────────────

const TYPICAL_GAMMA_CPM = 60; // ~60 CPM is normal background
const ELEVATED_THRESHOLD = 1.5;  // 50% above baseline
const HIGH_THRESHOLD = 3; // 3x baseline
const CRITICAL_THRESHOLD = 10; // 10x baseline

function classifyRadiation(cpm: number, baseline: number): RadiationLevel {
  const ratio = cpm / Math.max(baseline, 1);
  if (ratio >= CRITICAL_THRESHOLD) return 'critical';
  if (ratio >= HIGH_THRESHOLD) return 'high';
  if (ratio >= ELEVATED_THRESHOLD) return 'elevated';
  return 'normal';
}

// ── RadNet stations (known locations) ──────────────────────────────────

interface RadNetSeed { name: string; city: string; state: string; lat: number; lon: number }

const RADNET_STATIONS: RadNetSeed[] = [
  { name: 'RadNet-NYC', city: 'New York', state: 'NY', lat: 40.71, lon: -74.01 },
  { name: 'RadNet-LA', city: 'Los Angeles', state: 'CA', lat: 34.05, lon: -118.24 },
  { name: 'RadNet-CHI', city: 'Chicago', state: 'IL', lat: 41.88, lon: -87.63 },
  { name: 'RadNet-HOU', city: 'Houston', state: 'TX', lat: 29.76, lon: -95.37 },
  { name: 'RadNet-PHX', city: 'Phoenix', state: 'AZ', lat: 33.45, lon: -112.07 },
  { name: 'RadNet-PHL', city: 'Philadelphia', state: 'PA', lat: 39.95, lon: -75.17 },
  { name: 'RadNet-DEN', city: 'Denver', state: 'CO', lat: 39.74, lon: -104.99 },
  { name: 'RadNet-SEA', city: 'Seattle', state: 'WA', lat: 47.61, lon: -122.33 },
  { name: 'RadNet-MIA', city: 'Miami', state: 'FL', lat: 25.76, lon: -80.19 },
  { name: 'RadNet-ATL', city: 'Atlanta', state: 'GA', lat: 33.75, lon: -84.39 },
  { name: 'RadNet-BOS', city: 'Boston', state: 'MA', lat: 42.36, lon: -71.06 },
  { name: 'RadNet-SFO', city: 'San Francisco', state: 'CA', lat: 37.77, lon: -122.42 },
  { name: 'RadNet-DCA', city: 'Washington DC', state: 'DC', lat: 38.91, lon: -77.04 },
  { name: 'RadNet-LAS', city: 'Las Vegas', state: 'NV', lat: 36.17, lon: -115.14 },
  { name: 'RadNet-ANC', city: 'Anchorage', state: 'AK', lat: 61.22, lon: -149.9 },
  { name: 'RadNet-HNL', city: 'Honolulu', state: 'HI', lat: 21.31, lon: -157.86 },
];

// ── Fetch helpers ──────────────────────────────────────────────────────

async function fetchRadNetData(): Promise<RadNetStation[]> {
  const base = getApiBaseUrl();
  const url = `${base}/api/epa-radnet-proxy`;

  const proxConfig = loadProximityConfig();
  const userLat = proxConfig.location?.lat ?? null;
  const userLon = proxConfig.location?.lon ?? null;

  try {
 const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
 if (!res.ok) {
 // Return stations with simulated normal readings if API unavailable
 return buildDefaultStations(userLat, userLon);
 }

 const json = await res.json() as {
 stations?: {
 id?: string;
 name?: string;
 city?: string;
 state?: string;
 lat?: number;
 lon?: number;
 gamma_gross?: number;
 beta_gross?: number;
 measured_at?: string;
 }[];
 };

 const rawStations = json.stations ?? [];
 if (rawStations.length === 0) {
 return buildDefaultStations(userLat, userLon);
 }

 return rawStations.map(s => {
 const gammaCpm = s.gamma_gross ?? null;
 const baseline = TYPICAL_GAMMA_CPM;
 const level = gammaCpm === null ? 'normal' : classifyRadiation(gammaCpm, baseline);
 const deviation = gammaCpm === null ? 0 : ((gammaCpm - baseline) / baseline) * 100;

 let distanceKm: number | null = null;
 if (userLat !== null && userLon !== null && s.lat != null && s.lon != null) {
 distanceKm = haversineKm(userLat, userLon, s.lat, s.lon);
 }

 return {
 id: s.id ?? `radnet-${s.city ?? 'unknown'}`,
 name: s.name ?? `RadNet ${s.city ?? 'Unknown'}`,
 city: s.city ?? 'Unknown',
 state: s.state ?? '',
 lat: s.lat ?? 0,
 lon: s.lon ?? 0,
 gammaGrossCount: gammaCpm,
 betaGrossCount: s.beta_gross ?? null,
 level,
 baselineCpm: baseline,
 deviationPercent: Math.round(deviation * 10) / 10,
 measuredAt: s.measured_at ? new Date(s.measured_at) : new Date(),
 distanceKm,
 };
 });
  } catch {
 return buildDefaultStations(userLat, userLon);
  }
}

function buildDefaultStations(userLat: number | null, userLon: number | null): RadNetStation[] {
  return RADNET_STATIONS.map(s => {
 let distanceKm: number | null = null;
 if (userLat !== null && userLon !== null) {
 distanceKm = haversineKm(userLat, userLon, s.lat, s.lon);
 }
 return {
 id: `radnet-${s.city.toLowerCase().replace(/\s+/g, '-')}`,
 name: s.name,
 city: s.city,
 state: s.state,
 lat: s.lat,
 lon: s.lon,
 gammaGrossCount: null,
 betaGrossCount: null,
 level: 'normal' as RadiationLevel,
 baselineCpm: TYPICAL_GAMMA_CPM,
 deviationPercent: 0,
 measuredAt: new Date(),
 distanceKm,
 };
  });
}

async function fetchSeismicAnomalies(): Promise<SeismicAnomaly[]> {
  const base = getApiBaseUrl();
  // Shallow earthquakes (< 5km) with magnitudes in nuclear test range (4.0-6.5)
  const url = `${base}/api/earthquakes?minmagnitude=4.0&maxmagnitude=6.5&maxdepth=5&limit=50&orderby=time`;

  try {
 const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
 if (!res.ok) return [];

 const json = await res.json() as {
 features?: {
 id?: string;
 properties?: {
 mag?: number;
 place?: string;
 time?: number;
 };
 geometry?: {
 coordinates?: [number, number, number];
 };
 }[];
 };

 const features = json.features ?? [];
 const anomalies: SeismicAnomaly[] = [];

 for (const f of features) {
 const coords = f.geometry?.coordinates;
 if (!coords) continue;

 const lon = coords[0] ?? 0;
 const lat = coords[1] ?? 0;
 const depth = coords[2] ?? 0;
 const mag = f.properties?.mag ?? 0;
 const place = f.properties?.place ?? 'Unknown';
 const timeMs = f.properties?.time ?? Date.now();

 // Nuclear test signature: very shallow (< 2km ideal), specific mag range,
 // and proximity to known test sites
 const isShallow = depth < 2;
 const { nearest, distance } = findNearestFacility(lat, lon, 'weapons');
 const nearTestSite = distance !== null && distance < 100; // within 100km of known test site

 const isTestSignature = isShallow && nearTestSite;

 anomalies.push({
 id: f.id ?? `eq-${timeMs}`,
 magnitude: mag,
 depth_km: depth,
 lat,
 lon,
 place,
 time: new Date(timeMs),
 isTestSignature,
 nearestFacility: nearest,
 distanceToFacility_km: distance,
 });
 }

 // Sort test signatures first
 anomalies.sort((a, b) => {
 if (a.isTestSignature !== b.isTestSignature) return a.isTestSignature ? -1 : 1;
 return b.time.getTime() - a.time.getTime();
 });

 return anomalies;
  } catch {
 return [];
  }
}

function findNearestFacility(lat: number, lon: number, type?: NuclearFacility['type']): { nearest: string | null; distance: number | null } {
  let nearest: string | null = null;
  let minDist = Infinity;

  for (const f of KNOWN_FACILITIES) {
 if (type && f.type !== type) continue;
 const d = haversineKm(lat, lon, f.lat, f.lon);
 if (d < minDist) {
 minDist = d;
 nearest = f.name;
 }
  }

  return {
 nearest: minDist < Infinity ? nearest : null,
 distance: minDist < Infinity ? Math.round(minDist) : null,
  };
}

function buildFacilities(): NuclearFacility[] {
  const proxConfig = loadProximityConfig();
  const userLat = proxConfig.location?.lat ?? null;
  const userLon = proxConfig.location?.lon ?? null;

  return KNOWN_FACILITIES.map((f, i) => {
 let distanceKm: number | null = null;
 if (userLat !== null && userLon !== null) {
 distanceKm = haversineKm(userLat, userLon, f.lat, f.lon);
 }
 return {
 id: `nf-${i}-${f.name.slice(0, 20).replace(/\s+/g, '-').toLowerCase()}`,
 name: f.name,
 type: f.type,
 status: f.status,
 lat: f.lat,
 lon: f.lon,
 country: f.country,
 state: f.state,
 capacity_mw: f.mw,
 distanceKm,
 };
  });
}

// ── Main export ────────────────────────────────────────────────────────

export async function fetchNuclearStatus(): Promise<NuclearMonitorData> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
 return cache.data;
  }

  const [stationsResult, anomaliesResult] = await Promise.allSettled([
 fetchRadNetData(),
 fetchSeismicAnomalies(),
  ]);

  const stations = stationsResult.status === 'fulfilled' ? stationsResult.value : [];
  const seismicAnomalies = anomaliesResult.status === 'fulfilled' ? anomaliesResult.value : [];
  const facilities = buildFacilities();

  // Sort stations: anomalous first, then by proximity
  stations.sort((a, b) => {
 const levelOrder: Record<RadiationLevel, number> = { critical: 0, high: 1, elevated: 2, normal: 3 };
 const diff = levelOrder[a.level] - levelOrder[b.level];
 if (diff !== 0) return diff;
 return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
  });

  const normalStations = stations.filter(s => s.level === 'normal').length;
  const elevatedStations = stations.filter(s => s.level === 'elevated').length;
  const highStations = stations.filter(s => s.level === 'high').length;
  const criticalStations = stations.filter(s => s.level === 'critical').length;
  const activeReactors = facilities.filter(f => f.type === 'power' && f.status === 'operational').length;

  const data: NuclearMonitorData = {
 stations,
 facilities,
 seismicAnomalies,
 summary: {
 totalStations: stations.length,
 normalStations,
 elevatedStations,
 highStations,
 criticalStations,
 activeReactors,
 anomalyCount: seismicAnomalies.filter(a => a.isTestSignature).length,
 },
 fetchedAt: new Date(),
  };

  cache = { data, fetchedAt: Date.now() };
  if (stationsResult.status === 'rejected' && anomaliesResult.status === 'rejected') {
 dataFreshness.recordError('nuclear-monitor', 'both RadNet and seismic anomaly requests rejected');
  } else {
 dataFreshness.recordUpdate('nuclear-monitor', stations.length + seismicAnomalies.length);
  }
  return data;
}
