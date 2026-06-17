/**
 * Water Quality Monitoring Service
 *
 * Fetches drinking water safety data from:
 *  - EPA SDWIS (Safe Drinking Water Information System) via sidecar proxy
 *  - USGS Water Quality data (waterservices.usgs.gov)
 *
 * Tracks boil water advisories, contamination alerts, and treatment plant outages.
 * Uses proximity-filter for location-based filtering.
 */
import { getApiBaseUrl } from '@/services/runtime';
import { loadProximityConfig, haversineKm } from '@/services/proximity-filter';
import { dataFreshness } from '@/services/data-freshness';

// ── Types ──────────────────────────────────────────────────────────────

export type WaterAlertSeverity = 'safe' | 'advisory' | 'do-not-use';
export type WaterAlertType = 'boil-water' | 'do-not-use' | 'contamination' | 'treatment-outage' | 'general';

export interface WaterAlert {
  id: string;
  type: WaterAlertType;
  severity: WaterAlertSeverity;
  title: string;
  description: string;
  systemName: string;
  state: string;
  issuedAt: Date;
  expiresAt: Date | null;
}

export interface WaterSystem {
  id: string;
  name: string;
  state: string;
  populationServed: number;
  status: WaterAlertSeverity;
  lat: number | null;
  lon: number | null;
  distanceKm: number | null;
  violations: number;
  lastInspection: Date | null;
}

export interface WaterQualityData {
  alerts: WaterAlert[];
  systems: WaterSystem[];
  summary: {
 totalSystems: number;
 safeSystems: number;
 advisorySystems: number;
 doNotUseSystems: number;
  };
  fetchedAt: Date;
}

// ── Cache ──────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
let cache: { data: WaterQualityData; fetchedAt: number } | null = null;

// ── Known water system locations (US major metros) ─────────────────────

interface KnownSystem {
  name: string;
  state: string;
  lat: number;
  lon: number;
  pop: number;
}

const MAJOR_WATER_SYSTEMS: KnownSystem[] = [
  { name: 'New York City DEP', state: 'NY', lat: 40.71, lon: -74.01, pop: 8_300_000 },
  { name: 'Los Angeles DWP', state: 'CA', lat: 34.05, lon: -118.24, pop: 4_000_000 },
  { name: 'Chicago Water Mgmt', state: 'IL', lat: 41.88, lon: -87.63, pop: 2_700_000 },
  { name: 'Houston Public Works', state: 'TX', lat: 29.76, lon: -95.37, pop: 2_300_000 },
  { name: 'Phoenix Water Services', state: 'AZ', lat: 33.45, lon: -112.07, pop: 1_600_000 },
  { name: 'Philadelphia Water Dept', state: 'PA', lat: 39.95, lon: -75.17, pop: 1_600_000 },
  { name: 'San Antonio Water System', state: 'TX', lat: 29.42, lon: -98.49, pop: 1_500_000 },
  { name: 'San Diego Public Utilities', state: 'CA', lat: 32.72, lon: -117.16, pop: 1_400_000 },
  { name: 'Dallas Water Utilities', state: 'TX', lat: 32.78, lon: -96.8, pop: 1_300_000 },
  { name: 'Denver Water', state: 'CO', lat: 39.74, lon: -104.99, pop: 1_500_000 },
  { name: 'Seattle Public Utilities', state: 'WA', lat: 47.61, lon: -122.33, pop: 1_400_000 },
  { name: 'Miami-Dade WASD', state: 'FL', lat: 25.76, lon: -80.19, pop: 2_700_000 },
  { name: 'Atlanta Watershed Mgmt', state: 'GA', lat: 33.75, lon: -84.39, pop: 500_000 },
  { name: 'Boston Water & Sewer', state: 'MA', lat: 42.36, lon: -71.06, pop: 700_000 },
  { name: 'Detroit Water & Sewerage', state: 'MI', lat: 42.33, lon: -83.05, pop: 670_000 },
];

// ── USGS Parameter codes for water quality ─────────────────────────────

const USGS_PARAMS = [
  '00010', // Temperature
  '00300', // Dissolved oxygen
  '00400', // pH
  '00095', // Specific conductance
  '00665', // Phosphorus
  '00631', // Nitrate+Nitrite
];

// ── Fetch helpers ──────────────────────────────────────────────────────

async function fetchUSGSWaterQuality(): Promise<WaterAlert[]> {
  const base = getApiBaseUrl();
  const paramCodes = USGS_PARAMS.join(',');
  const url = `${base}/api/usgs-water-proxy?parameterCd=${paramCodes}&siteStatus=active&period=P1D&siteType=ST`;

  try {
 const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
 if (!res.ok) return [];
 const json = await res.json() as {
 value?: {
 timeSeries?: {
 sourceInfo?: { siteName?: string; geoLocation?: { geogLocation?: { latitude?: number; longitude?: number } } };
 variable?: { variableName?: string; variableCode?: { value?: string }[] };
 values?: { value?: { value?: string; dateTime?: string }[] }[];
 }[];
 };
 };
 if (!json || typeof json !== 'object') return [];

 const alerts: WaterAlert[] = [];
 const series = json.value?.timeSeries ?? [];

 for (const ts of series) {
 const siteName = ts.sourceInfo?.siteName ?? 'Unknown';
 const varName = ts.variable?.variableName ?? '';
 const varCode = ts.variable?.variableCode?.[0]?.value ?? '';
 const latestValues = ts.values?.[0]?.value ?? [];
 const latest = latestValues[latestValues.length - 1];
 if (!latest?.value) continue;

 const val = Number.parseFloat(latest.value);
 if (isNaN(val)) continue;

 // Flag anomalous readings
 let alert: WaterAlert | null = null;

 // pH outside safe range (6.5-8.5)
 if (varCode === '00400' && (val < 5.5 || val > 9.5)) {
 alert = {
 id: `usgs-ph-${siteName.slice(0, 20)}-${Date.now()}`,
 type: 'contamination',
 severity: val < 4 || val > 10 ? 'do-not-use' : 'advisory',
 title: `Abnormal pH (${val.toFixed(1)}) at ${siteName}`,
 description: `pH reading of ${val.toFixed(1)} detected. Safe range is 6.5–8.5.`,
 systemName: siteName,
 state: '',
 issuedAt: new Date(latest.dateTime ?? Date.now()),
 expiresAt: null,
 };
 }

 // Dissolved oxygen critically low (<4 mg/L)
 if (varCode === '00300' && val < 4) {
 alert = {
 id: `usgs-do-${siteName.slice(0, 20)}-${Date.now()}`,
 type: 'contamination',
 severity: val < 2 ? 'do-not-use' : 'advisory',
 title: `Low dissolved oxygen (${val.toFixed(1)} mg/L) at ${siteName}`,
 description: `Dissolved oxygen at ${val.toFixed(1)} mg/L. Levels below 4 mg/L indicate water quality issues.`,
 systemName: siteName,
 state: '',
 issuedAt: new Date(latest.dateTime ?? Date.now()),
 expiresAt: null,
 };
 }

 // High nitrate (> 10 mg/L — EPA MCL)
 if (varCode === '00631' && val > 10) {
 alert = {
 id: `usgs-nitrate-${siteName.slice(0, 20)}-${Date.now()}`,
 type: 'contamination',
 severity: val > 20 ? 'do-not-use' : 'advisory',
 title: `High nitrate (${val.toFixed(1)} mg/L) at ${siteName}`,
 description: `Nitrate at ${val.toFixed(1)} mg/L exceeds EPA MCL of 10 mg/L. ${varName}.`,
 systemName: siteName,
 state: '',
 issuedAt: new Date(latest.dateTime ?? Date.now()),
 expiresAt: null,
 };
 }

 if (alert) {
 alerts.push(alert);
 }
 }

 return alerts;
  } catch {
 return [];
  }
}

async function fetchEPAViolations(): Promise<{ alerts: WaterAlert[]; systems: WaterSystem[] }> {
  const base = getApiBaseUrl();
  const url = `${base}/api/epa-sdwis-proxy?type=violations&is_health_based=Y&compliance_period=current`;

  try {
 const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
 if (!res.ok) return { alerts: [], systems: [] };
 const json = await res.json() as {
 violations?: {
 pwsid?: string;
 pws_name?: string;
 state_code?: string;
 violation_name?: string;
 contaminant_name?: string;
 population_served_count?: number;
 is_health_based_ind?: string;
 compliance_begin_date?: string;
 }[];
 };
 if (!json || typeof json !== 'object') return { alerts: [], systems: [] };

 const violations = json.violations ?? [];
 const alerts: WaterAlert[] = [];
 const systemMap = new Map<string, WaterSystem>();

 for (const v of violations) {
 const pwsid = v.pwsid ?? 'unknown';
 const pwsName = v.pws_name ?? 'Unknown System';
 const state = v.state_code ?? '';
 const violationName = v.violation_name ?? 'Unknown Violation';
 const contaminant = v.contaminant_name ?? '';

 const isHealthBased = v.is_health_based_ind === 'Y';
 const severity: WaterAlertSeverity = isHealthBased ? 'advisory' : 'safe';
 const type: WaterAlertType = contaminant.toLowerCase().includes('coliform') ? 'boil-water' : 'contamination';

 alerts.push({
 id: `epa-${pwsid}-${violationName.slice(0, 20)}`,
 type,
 severity,
 title: `${violationName} — ${pwsName}`,
 description: contaminant ? `Contaminant: ${contaminant}` : violationName,
 systemName: pwsName,
 state,
 issuedAt: v.compliance_begin_date ? new Date(v.compliance_begin_date) : new Date(),
 expiresAt: null,
 });

 if (systemMap.has(pwsid)) {
 const sys = systemMap.get(pwsid)!;
 sys.violations += 1;
 if (severity === 'advisory' && sys.status === 'safe') {
 sys.status = severity;
 }
 } else {
 systemMap.set(pwsid, {
 id: pwsid,
 name: pwsName,
 state,
 populationServed: v.population_served_count ?? 0,
 status: severity,
 lat: null,
 lon: null,
 distanceKm: null,
 violations: 1,
 lastInspection: null,
 });
 }
 }

 return { alerts, systems: [...systemMap.values()] };
  } catch {
 return { alerts: [], systems: [] };
  }
}

function buildLocalSystems(): WaterSystem[] {
  const proxConfig = loadProximityConfig();
  const userLat = proxConfig.location?.lat ?? null;
  const userLon = proxConfig.location?.lon ?? null;

  return MAJOR_WATER_SYSTEMS.map((sys) => {
 let distanceKm: number | null = null;
 if (userLat !== null && userLon !== null) {
 distanceKm = haversineKm(userLat, userLon, sys.lat, sys.lon);
 }
 return {
 id: `local-${sys.state}-${sys.name.slice(0, 20).replace(/\s+/g, '-').toLowerCase()}`,
 name: sys.name,
 state: sys.state,
 populationServed: sys.pop,
 status: 'safe' as WaterAlertSeverity,
 lat: sys.lat,
 lon: sys.lon,
 distanceKm,
 violations: 0,
 lastInspection: null,
 };
  });
}

// ── Main export ────────────────────────────────────────────────────────

export async function fetchWaterQuality(): Promise<WaterQualityData> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
 return cache.data;
  }

  const [usgsAlerts, epaData] = await Promise.allSettled([
 fetchUSGSWaterQuality(),
 fetchEPAViolations(),
  ]);

  const alerts: WaterAlert[] = [
 ...(usgsAlerts.status === 'fulfilled' ? usgsAlerts.value : []),
 ...(epaData.status === 'fulfilled' ? epaData.value.alerts : []),
  ];

  // Merge EPA-reported systems with known major systems
  const epaSystems = epaData.status === 'fulfilled' ? epaData.value.systems : [];
  const localSystems = buildLocalSystems();

  // Overlay EPA violation data onto known systems
  const epaById = new Map(epaSystems.map(s => [s.name.toLowerCase(), s]));
  for (const ls of localSystems) {
 const match = epaById.get(ls.name.toLowerCase());
 if (match) {
 ls.violations = match.violations;
 ls.status = match.status;
 }
  }

  // Add EPA systems not already in the local list
  const localNames = new Set(localSystems.map(s => s.name.toLowerCase()));
  for (const es of epaSystems) {
 if (!localNames.has(es.name.toLowerCase())) {
 localSystems.push(es);
 }
  }

  // Sort by proximity if location is available, otherwise by status
  const proxConfig = loadProximityConfig();
  if (proxConfig.location) {
 localSystems.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  } else {
 const statusOrder: Record<WaterAlertSeverity, number> = { 'do-not-use': 0, advisory: 1, safe: 2 };
 localSystems.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
  }

  // Sort alerts by severity
  const sevOrder: Record<WaterAlertSeverity, number> = { 'do-not-use': 0, advisory: 1, safe: 2 };
  alerts.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);

  const safeSystems = localSystems.filter(s => s.status === 'safe').length;
  const advisorySystems = localSystems.filter(s => s.status === 'advisory').length;
  const doNotUseSystems = localSystems.filter(s => s.status === 'do-not-use').length;

  const data: WaterQualityData = {
 alerts,
 systems: localSystems,
 summary: {
 totalSystems: localSystems.length,
 safeSystems,
 advisorySystems,
 doNotUseSystems,
 },
 fetchedAt: new Date(),
  };

  cache = { data, fetchedAt: Date.now() };
  dataFreshness.recordUpdate('water-quality', alerts.length);
  return data;
}
