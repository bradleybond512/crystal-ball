/**
 * Alert Normalizer
 *
 * Converts every alert source type in Crystal Ball into a UnifiedAlert.
 * Each normalizer is a pure function: source type in, UnifiedAlert out.
 */

import type { UnifiedAlert, AlertSeverity } from './unified-alerts';
import type { BreakingAlert } from './breaking-news-alerts';
import type { CorrelationSignal } from './correlation';
import type { NWSAlert } from './nws-alerts';
import type { TsunamiAlert } from './tsunami-alerts';
import type { GDACSEvent } from './gdacs';
import type { NearbyHazard } from './proximity-alerts';

// ── Country Centroid Lookup (top 50 by population / geopolitical relevance) ──

const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  'Afghanistan': [33.9, 67.7], 'Algeria': [28, 1.7], 'Argentina': [-38.4, -63.6],
  'Australia': [-25.3, 133.8], 'Bangladesh': [23.7, 90.4], 'Brazil': [-14.2, -51.9],
  'Canada': [56.1, -106.3], 'Chile': [-35.7, -71.5], 'China': [35.9, 104.2],
  'Colombia': [4.6, -74.1], 'DR Congo': [-4, 21.8], 'Egypt': [26.8, 30.8],
  'Ethiopia': [9.1, 40.5], 'France': [46.2, 2.2], 'Germany': [51.2, 10.5],
  'India': [20.6, 78.9], 'Indonesia': [-0.8, 113.9], 'Iran': [32.4, 53.7],
  'Iraq': [33.2, 43.7], 'Israel': [31, 34.9], 'Italy': [41.9, 12.6],
  'Japan': [36.2, 138.3], 'Kenya': [-0.02, 37.9], 'Malaysia': [4.2, 101.9],
  'Mexico': [23.6, -102.6], 'Morocco': [31.8, -7.1], 'Myanmar': [21.9, 95.9],
  'Nepal': [28.4, 84.1], 'Nigeria': [9.1, 8.7], 'North Korea': [40.3, 127.5],
  'Pakistan': [30.4, 69.3], 'Peru': [-9.2, -75], 'Philippines': [12.9, 121.8],
  'Poland': [51.9, 19.1], 'Romania': [45.9, 24.97], 'Russia': [61.5, 105.3],
  'Saudi Arabia': [23.9, 45.1], 'South Africa': [-30.6, 22.9],
  'South Korea': [35.9, 127.8], 'Spain': [40.5, -3.7], 'Sudan': [12.9, 30.2],
  'Syria': [35, 38], 'Taiwan': [23.7, 121], 'Thailand': [15.9, 100.9],
  'Turkey': [39, 35.2], 'Ukraine': [48.4, 31.2], 'United Kingdom': [55.4, -3.4],
  'United States': [37.1, -95.7], 'Venezuela': [6.4, -66.6], 'Vietnam': [14.1, 108.3],
};

/** Best-effort geocode for a country name (case-insensitive substring match). */
function geocodeCountry(name: string | undefined): { lat: number; lon: number } | undefined {
  if (!name) return undefined;
  const lower = name.toLowerCase();
  for (const [country, [lat, lon]] of Object.entries(COUNTRY_CENTROIDS)) {
 if (lower.includes(country.toLowerCase()) || country.toLowerCase().includes(lower)) {
 return { lat, lon };
 }
  }
  return undefined;
}

/** Region centroids for tsunami ocean basins */
const TSUNAMI_REGION_CENTROIDS: Record<string, { lat: number; lon: number }> = {
  Pacific: { lat: 0, lon: -160 },
  Atlantic: { lat: 25, lon: -45 },
};

// ── Breaking News ────────────────────────────────────────────────────────

export function normalizeBreakingAlert(alert: BreakingAlert): UnifiedAlert {
  return {
 id: `bn-${alert.id}`,
 source: 'breaking-news',
 severity: alert.threatLevel,
 title: alert.headline,
 body: `${alert.origin.replace(/_/g, ' ')} · ${alert.source}`,
 timestamp: alert.timestamp.getTime(),
 location: alert.lat != null && alert.lon != null
 ? { lat: alert.lat, lon: alert.lon, label: alert.placeSummary }
 : undefined,
 relevanceScore: 0,
 acknowledged: false,
 pinned: false,
 link: alert.link,
 evidence: alert.evidence,
 raw: alert,
  };
}

// ── Correlation Signals ──────────────────────────────────────────────────

function signalSeverity(confidence: number): AlertSeverity {
  if (confidence > 0.8) return 'high';
  if (confidence > 0.65) return 'medium';
  if (confidence > 0.4) return 'low';
  return 'info';
}

export function normalizeCorrelationSignal(signal: CorrelationSignal): UnifiedAlert {
  // Attempt to geocode from placeSummary (often contains a country name)
  const geo = geocodeCountry(signal.data.placeSummary);
  return {
 id: `cs-${signal.id}`,
 source: 'correlation',
 severity: signalSeverity(signal.confidence),
 title: signal.title,
 body: signal.description,
 timestamp: signal.timestamp.getTime(),
 location: geo ? { lat: geo.lat, lon: geo.lon, label: signal.data.placeSummary } : undefined,
 relevanceScore: 0,
 acknowledged: false,
 pinned: false,
 evidence: signal.evidence,
 raw: signal,
  };
}

// ── NWS Weather Alerts ───────────────────────────────────────────────────

const NWS_SEVERITY_MAP: Record<NWSAlert['severity'], AlertSeverity> = {
  Extreme: 'critical',
  Severe: 'high',
  Moderate: 'medium',
  Minor: 'low',
  Unknown: 'info',
};

export function normalizeNWSAlert(alert: NWSAlert): UnifiedAlert {
  return {
 id: `nws-${alert.id}`,
 source: 'nws',
 severity: NWS_SEVERITY_MAP[alert.severity] ?? 'info',
 title: alert.event,
 body: alert.headline,
 timestamp: new Date(alert.onset).getTime(),
 location: alert.centroid
 ? { lat: alert.centroid[1], lon: alert.centroid[0], label: alert.areaDesc }
 : undefined,
 relevanceScore: 0,
 acknowledged: false,
 pinned: false,
 raw: alert,
  };
}

// ── GDACS Disaster Alerts ────────────────────────────────────────────────

const GDACS_SEVERITY_MAP: Record<GDACSEvent['alertLevel'], AlertSeverity> = {
  Red: 'critical',
  Orange: 'high',
  Green: 'low',
};

const GDACS_TYPE_LABEL: Record<string, string> = {
  EQ: 'Earthquake',
  FL: 'Flood',
  TC: 'Tropical Cyclone',
  VO: 'Volcano',
  WF: 'Wildfire',
  DR: 'Drought',
};

export function normalizeGDACSEvent(event: GDACSEvent): UnifiedAlert {
  const typeLabel = GDACS_TYPE_LABEL[event.eventType] ?? event.eventType;
  return {
 id: `gdacs-${event.id}`,
 source: 'gdacs',
 severity: GDACS_SEVERITY_MAP[event.alertLevel] ?? 'info',
 title: `${typeLabel}: ${event.name}`,
 body: event.severity
 ? `${event.description} · ${event.country} · ${event.severity}`
 : `${event.description} · ${event.country}`,
 timestamp: event.fromDate.getTime(),
 location: event.coordinates
 ? { lat: event.coordinates[1], lon: event.coordinates[0], label: event.country }
 : undefined,
 relevanceScore: 0,
 acknowledged: false,
 pinned: false,
 link: event.url,
 raw: event,
  };
}

// ── Tsunami Alerts ───────────────────────────────────────────────────────

const TSUNAMI_SEVERITY_MAP: Record<TsunamiAlert['severity'], AlertSeverity> = {
  warning: 'critical',
  watch: 'high',
  advisory: 'medium',
  information: 'low',
  'threat-canceled': 'info',
};

export function normalizeTsunamiAlert(alert: TsunamiAlert): UnifiedAlert {
  const regionCentroid = TSUNAMI_REGION_CENTROIDS[alert.region];
  return {
 id: `tsu-${alert.id}`,
 source: 'tsunami',
 severity: TSUNAMI_SEVERITY_MAP[alert.severity] ?? 'info',
 title: alert.title,
 body: `${alert.region} · ${alert.description.slice(0, 200)}`,
 timestamp: alert.pubDate.getTime(),
 location: regionCentroid
 ? { lat: regionCentroid.lat, lon: regionCentroid.lon, label: `${alert.region} Basin` }
 : undefined,
 relevanceScore: 0,
 acknowledged: false,
 pinned: false,
 link: alert.url,
 raw: alert,
  };
}

// ── Proximity Hazards ────────────────────────────────────────────────────

const HAZARD_TYPE_LABEL: Record<NearbyHazard['type'], string> = {
  wildfire: 'Wildfire',
  hazmat: 'Hazmat',
  'oil-spill': 'Oil Spill',
  'air-quality': 'Air Quality',
};

export function normalizeNearbyHazard(hazard: NearbyHazard): UnifiedAlert {
  const typeLabel = HAZARD_TYPE_LABEL[hazard.type] ?? hazard.type;
  return {
 id: `haz-${hazard.id}`,
 source: 'hazard',
 severity: hazard.severity,
 title: `${typeLabel}: ${hazard.title}`,
 body: `${hazard.location} · ${hazard.distanceMiles.toFixed(1)} mi${hazard.evacuationOrder ? ' · EVACUATION ORDER' : ''}`,
 timestamp: hazard.reportedAt.getTime(),
 distanceKm: hazard.distanceMiles * 1.609_34,
 relevanceScore: 0,
 acknowledged: false,
 pinned: false,
 link: hazard.url,
 raw: hazard,
  };
}

// ── Resource Depletion ──────────────────────────────────────────────────

export interface ResourceAlertDetail {
  itemId: string;
  name: string;
  daysLeft: number;
  quantity: number;
  unit: string;
  threshold: 'depleted' | '1-day' | '3-day' | '7-day';
}

export function normalizeResourceAlert(detail: ResourceAlertDetail): UnifiedAlert {
  const severityMap: Record<string, AlertSeverity> = {
 'depleted': 'critical',
 '1-day': 'critical',
 '3-day': 'high',
 '7-day': 'medium',
  };
  return {
 id: `resource-${detail.itemId}-${detail.threshold}`,
 source: 'resource',
 severity: severityMap[detail.threshold] ?? 'medium',
 title: `Resource ${detail.threshold === 'depleted' ? 'depleted' : 'low'}: ${detail.name}`,
 body: detail.threshold === 'depleted'
 ? `${detail.name} is depleted (0 ${detail.unit} remaining)`
 : `${detail.daysLeft.toFixed(1)} days remaining (${detail.quantity} ${detail.unit})`,
 timestamp: Date.now(),
 relevanceScore: 0,
 acknowledged: false,
 pinned: false,
 raw: detail,
  };
}
