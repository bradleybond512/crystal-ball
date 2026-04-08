import type { IncidentReport } from './inciweb';
import type { HazmatIncident } from './hazmat-incidents';
import type { OilSpillIncident } from './oil-spill-tracker';
import type { AirQualityReading } from './air-quality';
import { haversineKm, loadProximityConfig } from './proximity-filter';
import { tryInvokeTauri } from './tauri-bridge';
import { isGhostMode } from './mode-manager';

export interface NearbyHazard {
  id: string;
  type: 'wildfire' | 'hazmat' | 'oil-spill' | 'air-quality';
  title: string;
  location: string;
  distanceMiles: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  evacuationOrder: boolean;
  url: string;
  checklist: string[];
  reportedAt: Date;
}

// Per-scenario radii in km (1 mile = 1.60934 km)
const RADII_KM: Record<string, number> = {
  'hazmat-chemical': 40.2, // 25 mi
  'hazmat-pipeline': 80.5, // 50 mi
  'oil-spill': 80.5, // 50 mi
  'wildfire-evac': 40.2, // 25 mi
  'wildfire-no-evac': 80.5,  // 50 mi
  'air-quality': 160.9, // 100 mi
};

const CHECKLISTS: Record<string, string[]> = {
  'hazmat-chemical': [
 'Shelter in place — close windows and HVAC',
 'Avoid the area and do not approach the scene',
 'Do not eat or drink anything potentially contaminated',
 'Follow instructions from local emergency management',
 'Monitor official emergency channels',
  ],
  'hazmat-pipeline': [
 'Evacuate the immediate area',
 'Do not ignite flames or create sparks',
 'Call 911 if you smell gas or see a leak',
 'Move upwind of the incident',
 'Monitor official channels',
  ],
  'oil-spill': [
 'Avoid affected waterways and beaches',
 'Check local water supply advisories before drinking tap water',
 'Keep pets away from affected water',
 'Report wildlife affected by the spill to authorities',
 'Monitor local news for cleanup updates',
  ],
  'wildfire-evac': [
 'EVACUATE NOW — follow the official evacuation route',
 'Take go-bag, medications, and important documents',
 'Do not return until the official all-clear is given',
 'Check on neighbors, especially elderly or disabled',
 'Keep pets and livestock with you',
  ],
  'wildfire-no-evac': [
 'Prepare go-bag and know your evacuation route now',
 'Clear defensible space around your home',
 'Wear N95 outdoors if AQI exceeds 100',
 'Track official containment percentage for updates',
 'Sign up for local emergency alerts if not already enrolled',
  ],
  'air-quality': [
 'Wear N95 or KN95 mask outdoors',
 'Keep windows and doors closed',
 'Set HVAC to recirculate inside air',
 'Avoid outdoor exercise',
 'Check on vulnerable neighbors, elderly, and children',
  ],
};

const ALERT_COOLDOWN_MS = 60 * 60 * 1000;
const STORAGE_KEY = 'crystalball-alerted-hazards';

function loadAlertedIds(): Record<string, number> {
  try {
 const raw = localStorage.getItem(STORAGE_KEY);
 return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch { return {}; }
}

function saveAlertedIds(map: Record<string, number>): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch { /* noop */ }
}

function shouldAlert(id: string, alerted: Record<string, number>): boolean {
  const ts = alerted[id];
  return !ts || Date.now() - ts > ALERT_COOLDOWN_MS;
}

const SEVERITY_ORDER: Record<NearbyHazard['severity'], number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};

class ProximityAlertService {
  private nearbyHazards: NearbyHazard[] = [];

  getNearbyHazards(): NearbyHazard[] {
 return this.nearbyHazards;
  }

  async checkWildfires(incidents: IncidentReport[]): Promise<void> {
 const config = loadProximityConfig();
 if (!config.location) return;
 const { lat: homeLat, lon: homeLon } = config.location;
 const alerted = loadAlertedIds();
 const found: NearbyHazard[] = [];

 for (const inc of incidents) {
 if (inc.lat === null || inc.lon === null) continue;
 const radiusKey = inc.evacuationOrders ? 'wildfire-evac' : 'wildfire-no-evac';
 const distKm = haversineKm(homeLat, homeLon, inc.lat, inc.lon);
 if (distKm > (RADII_KM[radiusKey] ?? 80.5)) continue;

 const distMiles = Math.round((distKm / 1.60934) * 10) / 10;
 found.push({
 id: inc.id,
 type: 'wildfire',
 title: inc.name,
 location: inc.state,
 distanceMiles: distMiles,
 severity: inc.severity,
 evacuationOrder: inc.evacuationOrders,
 url: inc.url,
 checklist: CHECKLISTS[radiusKey] ?? [],
 reportedAt: inc.updatedAt,
 });

 if (shouldAlert(inc.id, alerted) && !isGhostMode()) {
 alerted[inc.id] = Date.now();
 const body = inc.evacuationOrders
 ? `Evacuation order — ${inc.name}, ${inc.state} (${Math.round(distMiles)} mi away)`
 : `${inc.acresBurned?.toLocaleString() ?? '?'} acres, ${inc.percentContained ?? '?'}% contained — ${Math.round(distMiles)} mi away`;
 await tryInvokeTauri<void>('send_notification', {
 title: `Wildfire: ${inc.name}`,
 body,
 sound: inc.evacuationOrders ? 'Basso' : 'Ping',
 });
 }
 }

 saveAlertedIds(alerted);
 this._mergeHazards('wildfire', found);
  }

  async checkHazmat(incidents: HazmatIncident[]): Promise<void> {
 const config = loadProximityConfig();
 if (!config.location) return;
 const { lat: homeLat, lon: homeLon } = config.location;
 const alerted = loadAlertedIds();
 const found: NearbyHazard[] = [];

 for (const inc of incidents) {
 if (inc.lat === null || inc.lon === null) continue;
 const radiusKey = inc.incidentType === 'pipeline' ? 'hazmat-pipeline' : 'hazmat-chemical';
 const distKm = haversineKm(homeLat, homeLon, inc.lat, inc.lon);
 if (distKm > (RADII_KM[radiusKey] ?? 40.2)) continue;

 const distMiles = Math.round((distKm / 1.60934) * 10) / 10;
 found.push({
 id: inc.id,
 type: 'hazmat',
 title: inc.title,
 location: inc.state,
 distanceMiles: distMiles,
 severity: inc.severity,
 evacuationOrder: false,
 url: inc.url,
 checklist: CHECKLISTS[radiusKey] ?? [],
 reportedAt: inc.reportedAt,
 });

 if (shouldAlert(inc.id, alerted) && !isGhostMode()) {
 alerted[inc.id] = Date.now();
 await tryInvokeTauri<void>('send_notification', {
 title: `Hazmat: ${inc.chemical}`,
 body: `${inc.title} — ${Math.round(distMiles)} mi away`,
 sound: inc.severity === 'critical' ? 'Basso' : 'Ping',
 });
 }
 }

 saveAlertedIds(alerted);
 this._mergeHazards('hazmat', found);
  }

  async checkOilSpills(incidents: OilSpillIncident[]): Promise<void> {
 const config = loadProximityConfig();
 if (!config.location) return;
 const { lat: homeLat, lon: homeLon } = config.location;
 const alerted = loadAlertedIds();
 const found: NearbyHazard[] = [];

 for (const inc of incidents) {
 if (!inc.isOpen) continue;
 if (inc.lat === null || inc.lon === null) continue;
 const distKm = haversineKm(homeLat, homeLon, inc.lat, inc.lon);
 if (distKm > (RADII_KM['oil-spill'] ?? 80.5)) continue;

 const distMiles = Math.round((distKm / 1.60934) * 10) / 10;
 found.push({
 id: inc.id,
 type: 'oil-spill',
 title: inc.name,
 location: inc.location || inc.state,
 distanceMiles: distMiles,
 severity: inc.severity,
 evacuationOrder: false,
 url: inc.url,
 checklist: CHECKLISTS['oil-spill'] ?? [],
 reportedAt: inc.openDate,
 });

 if (shouldAlert(inc.id, alerted) && !isGhostMode()) {
 alerted[inc.id] = Date.now();
 await tryInvokeTauri<void>('send_notification', {
 title: `Spill: ${inc.name}`,
 body: `${inc.pollutant || 'Unknown pollutant'} — ${Math.round(distMiles)} mi away`,
 sound: 'Ping',
 });
 }
 }

 saveAlertedIds(alerted);
 this._mergeHazards('oil-spill', found);
  }

  async checkAirQuality(readings: AirQualityReading[]): Promise<void> {
 const config = loadProximityConfig();
 if (!config.location) return;
 const { lat: homeLat, lon: homeLon } = config.location;
 const alerted = loadAlertedIds();
 const found: NearbyHazard[] = [];

 for (const r of readings) {
 if (r.aqi < 151) continue;
 const distKm = haversineKm(homeLat, homeLon, r.lat, r.lon);
 if (distKm > (RADII_KM['air-quality'] ?? 160.9)) continue;

 const distMiles = Math.round((distKm / 1.60934) * 10) / 10;
 const id = `aqi-${r.city}-${r.country}`;
 const severity: NearbyHazard['severity'] =
 r.aqi >= 301 ? 'critical' : r.aqi >= 201 ? 'high' : 'medium';

 found.push({
 id,
 type: 'air-quality',
 title: `Hazardous Air Quality — ${r.city}`,
 location: `${r.city}, ${r.country}`,
 distanceMiles: distMiles,
 severity,
 evacuationOrder: false,
 url: 'https://www.airnow.gov',
 checklist: CHECKLISTS['air-quality'] ?? [],
 reportedAt: r.updatedAt,
 });

 if (shouldAlert(id, alerted) && !isGhostMode()) {
 alerted[id] = Date.now();
 await tryInvokeTauri<void>('send_notification', {
 title: `Air Quality Alert: ${r.city}`,
 body: `AQI ${r.aqi} — ${Math.round(distMiles)} mi away. Wear N95 outdoors.`,
 sound: 'Ping',
 });
 }
 }

 saveAlertedIds(alerted);
 this._mergeHazards('air-quality', found);
  }

  private _mergeHazards(type: NearbyHazard['type'], fresh: NearbyHazard[]): void {
 const others = this.nearbyHazards.filter(h => h.type !== type);
 this.nearbyHazards = [...others, ...fresh].sort((a, b) =>
 (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) ||
 (a.distanceMiles - b.distanceMiles)
 );
  }
}

export const proximityAlertService = new ProximityAlertService();
