import type { NaturalEvent, NaturalEventCategory } from '@/types';
import { fetchGDACSEvents, type GDACSEvent } from './gdacs';

interface EonetGeometry {
  magnitudeValue?: number;
  magnitudeUnit?: string;
  date: string;
  type: string;
  coordinates: [number, number];
}

interface EonetSource {
  id: string;
  url: string;
}

interface EonetCategory {
  id: string;
  title: string;
}

interface EonetEvent {
  id: string;
  title: string;
  description: string | null;
  closed: string | null;
  categories: EonetCategory[];
  sources: EonetSource[];
  geometry: EonetGeometry[];
}

interface EonetResponse {
  title: string;
  events: EonetEvent[];
}

const EONET_API_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events';

const CATEGORY_ICONS: Record<NaturalEventCategory, string> = {
  severeStorms: '🌀',
  wildfires: '🔥',
  volcanoes: '🌋',
  earthquakes: '🔴',
  floods: '🌊',
  landslides: '⛰️',
  drought: '☀️',
  dustHaze: '🌫️',
  snow: '❄️',
  tempExtremes: '🌡️',
  seaLakeIce: '🧊',
  waterColor: '🦠',
  manmade: '⚠️',
};

export function getNaturalEventIcon(category: NaturalEventCategory): string {
  return CATEGORY_ICONS[category] || '⚠️';
}

// Wildfires older than 48 hours are filtered out (stale data)
const WILDFIRE_MAX_AGE_MS = 48 * 60 * 60 * 1000;

const GDACS_TO_CATEGORY: Record<string, NaturalEventCategory> = {
  EQ: 'earthquakes',
  FL: 'floods',
  TC: 'severeStorms',
  VO: 'volcanoes',
  WF: 'wildfires',
  DR: 'drought',
};

function convertGDACSToNaturalEvent(gdacs: GDACSEvent): NaturalEvent {
  const category = GDACS_TO_CATEGORY[gdacs.eventType] ?? 'manmade';
  return {
 id: gdacs.id,
 title: (() => {
  let prefix = '';
  if (gdacs.alertLevel === 'Red') prefix = '🔴 ';
  else if (gdacs.alertLevel === 'Orange') prefix = '🟠 ';
  return `${prefix}${gdacs.name}`;
 })(),
 description: gdacs.severity ? `${gdacs.description} - ${gdacs.severity}` : gdacs.description,
 category,
 categoryTitle: gdacs.description,
 lat: gdacs.coordinates[1],
 lon: gdacs.coordinates[0],
 date: gdacs.fromDate,
 sourceUrl: gdacs.url,
 sourceName: 'GDACS',
 closed: false,
  };
}

export async function fetchNaturalEvents(days = 30): Promise<NaturalEvent[]> {
  const [eonetEvents, gdacsEvents] = await Promise.all([
 fetchEonetEvents(days),
 fetchGDACSEvents(),
  ]);

  const gdacsConverted = gdacsEvents.map((e) => convertGDACSToNaturalEvent(e));
  const seenLocations = new Set<string>();
  const merged: NaturalEvent[] = [];

  for (const event of gdacsConverted) {
 const key = `${event.lat.toFixed(1)}-${event.lon.toFixed(1)}-${event.category}`;
 if (!seenLocations.has(key)) {
 seenLocations.add(key);
 merged.push(event);
 }
  }

  for (const event of eonetEvents) {
 const key = `${event.lat.toFixed(1)}-${event.lon.toFixed(1)}-${event.category}`;
 if (!seenLocations.has(key)) {
 seenLocations.add(key);
 merged.push(event);
 }
  }

  return merged;
}

async function fetchEonetEvents(days: number): Promise<NaturalEvent[]> {
  try {
 const url = `${EONET_API_URL}?status=open&days=${days}`;
 const response = await fetch(url);

 if (!response.ok) {
 throw new Error(`EONET API error: ${response.status}`);
 }

 const data = await response.json() as EonetResponse;
 const events: NaturalEvent[] = [];
 const now = Date.now();

 for (const event of (Array.isArray(data.events) ? data.events : [])) {
 const category = event.categories[0];
 if (!category) continue;

 // Skip earthquakes - USGS provides better data for seismic events
 if (category.id === 'earthquakes') continue;

 // Get most recent geometry point
 const latestGeo = event.geometry[event.geometry.length - 1];
 if (latestGeo?.type !== 'Point') continue;

 const eventDate = new Date(latestGeo.date);
 const [lon, lat] = latestGeo.coordinates;
 const source = event.sources[0];

 // Filter out wildfires older than 48 hours
 if (category.id === 'wildfires' && now - eventDate.getTime() > WILDFIRE_MAX_AGE_MS) {
 continue;
 }

 events.push({
 id: event.id,
 title: event.title,
 description: event.description ?? undefined,
 category: category.id as NaturalEventCategory,
 categoryTitle: category.title,
 lat,
 lon,
 date: eventDate,
 magnitude: latestGeo.magnitudeValue,
 magnitudeUnit: latestGeo.magnitudeUnit,
 sourceUrl: source?.url,
 sourceName: source?.id,
 closed: event.closed !== null,
 });
 }

 return events;
  } catch (error) {
 // eslint-disable-next-line no-console -- fetch failure is expected in offline mode
 console.error('[EONET] Failed to fetch natural events:', error);
 return [];
  }
}

// ── UnifiedAlert normalizer (C3 — keyless resilience) ────────────────────
//
// EONET events were previously only shown on the map layer; the intelligence
// layer (compound-risk, big-event-detector, etc.) never saw them. This
// normalizer bridges NaturalEvent → UnifiedAlert so EONET events flow into
// unifiedAlertStore and raise compound risk scores during active disasters.

import type { UnifiedAlert, AlertSeverity } from './unified-alerts';

const EONET_ALERT_SEVERITY: Record<NaturalEventCategory, AlertSeverity> = {
  severeStorms: 'high',
  wildfires: 'high',
  volcanoes: 'high',
  earthquakes: 'medium',
  floods: 'medium',
  landslides: 'medium',
  drought: 'low',
  dustHaze: 'low',
  snow: 'low',
  tempExtremes: 'medium',
  seaLakeIce: 'info',
  waterColor: 'info',
  manmade: 'medium',
};

// Map EONET category → existing AlertSource (no new union values needed)
const EONET_ALERT_SOURCE: Partial<Record<NaturalEventCategory, UnifiedAlert['source']>> = {
  wildfires: 'fire',
  volcanoes: 'volcano',
};

/**
 * Convert a NaturalEvent (from the EONET service) into a UnifiedAlert so the
 * intelligence and correlation layers can reason about it.
 */
export function normalizeNaturalEventToAlert(event: NaturalEvent): UnifiedAlert {
  const source: UnifiedAlert['source'] = EONET_ALERT_SOURCE[event.category] ?? 'hazard';
  return {
    id: `eonet-${event.id}`,
    source,
    severity: EONET_ALERT_SEVERITY[event.category] ?? 'info',
    title: event.title,
    body: [event.categoryTitle, event.description].filter(Boolean).join(' · '),
    timestamp: event.date.getTime(),
    location: { lat: event.lat, lon: event.lon },
    relevanceScore: 0,
    acknowledged: false,
    pinned: false,
    link: event.sourceUrl,
    raw: event,
  };
}
