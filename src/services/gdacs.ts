import { createCircuitBreaker } from '@/utils';
import { rehydrateDate } from '@/services/cache-hydration';
import { fetchWithContext } from '@/services/fetch-with-context';
import type { BreakerDataState } from '@/utils/circuit-breaker';

export interface GDACSEvent {
  id: string;
  eventType: 'EQ' | 'FL' | 'TC' | 'VO' | 'WF' | 'DR';
  name: string;
  description: string;
  alertLevel: 'Green' | 'Orange' | 'Red';
  country: string;
  coordinates: [number, number];
  fromDate: Date;
  severity: string;
  url: string;
}

const EVENT_TYPE_NAMES: Record<GDACSEvent['eventType'], string> = {
  EQ: 'Earthquake',
  FL: 'Flood',
  TC: 'Tropical Cyclone',
  VO: 'Volcano',
  WF: 'Wildfire',
  DR: 'Drought',
};
const EVENT_TYPES = new Set<GDACSEvent['eventType']>(['EQ', 'FL', 'TC', 'VO', 'WF', 'DR']);
const ALERT_LEVELS = new Set<GDACSEvent['alertLevel']>(['Green', 'Orange', 'Red']);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseGDACSResponse(data: unknown): GDACSEvent[] {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { features?: unknown }).features)) {
    throw new Error('GDACS response is missing a features array');
  }
  return (data as { features: unknown[] }).features.map((feature, index) => {
    const featureRecord = record(feature);
    const geometry = record(featureRecord?.geometry);
    const properties = record(featureRecord?.properties);
    if (geometry?.type !== 'Point') throw new Error(`GDACS feature ${index} has an invalid geometry type`);
    const coordinates = geometry.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length !== 2
      || !coordinates.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
      || Math.abs(coordinates[0] as number) > 180 || Math.abs(coordinates[1] as number) > 90) {
      throw new Error(`GDACS feature ${index} has invalid coordinates`);
    }
    const eventType = properties?.eventtype;
    if (typeof eventType !== 'string' || !EVENT_TYPES.has(eventType as GDACSEvent['eventType'])) {
      throw new Error(`GDACS feature ${index} has an unsupported event type`);
    }
    const alertLevel = properties?.alertlevel;
    if (typeof alertLevel !== 'string' || !ALERT_LEVELS.has(alertLevel as GDACSEvent['alertLevel'])) {
      throw new Error(`GDACS feature ${index} has an unsupported alert level`);
    }
    const eventId = properties?.eventid;
    if ((typeof eventId !== 'number' || !Number.isFinite(eventId))
      && (typeof eventId !== 'string' || eventId.length === 0)) {
      throw new Error(`GDACS feature ${index} has an invalid event id`);
    }
    const name = properties?.name;
    const country = properties?.country;
    const fromDateRaw = properties?.fromdate;
    if (typeof name !== 'string' || typeof country !== 'string') {
      throw new TypeError(`GDACS feature ${index} has invalid text fields`);
    }
    const fromDate = typeof fromDateRaw === 'string' ? new Date(fromDateRaw) : new Date(Number.NaN);
    if (Number.isNaN(fromDate.getTime())) throw new Error(`GDACS feature ${index} has an invalid date`);
    const description = typeof properties?.description === 'string' && properties.description.trim().length > 0
      ? properties.description
      : EVENT_TYPE_NAMES[eventType as GDACSEvent['eventType']];
    const severityData = record(properties?.severitydata);
    const url = record(properties?.url);
    return {
      id: `gdacs-${eventType}-${String(eventId)}`,
      eventType: eventType as GDACSEvent['eventType'],
      name,
      description,
      alertLevel: alertLevel as GDACSEvent['alertLevel'],
      country,
      coordinates: coordinates as [number, number],
      fromDate,
      severity: typeof severityData?.severitytext === 'string' ? severityData.severitytext : '',
      url: typeof url?.report === 'string' ? url.report : '',
    };
  });
}

const GDACS_API = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP';
const breaker = createCircuitBreaker<GDACSEvent[]>({ name: 'GDACS', cacheTtlMs: 10 * 60 * 1000, persistCache: true });

export interface GDACSFetchResult {
  events: GDACSEvent[];
  dataState: BreakerDataState;
}

export interface GDACSSuccessfulUpdate {
  itemCount: number;
  updatedAt: number;
}

/**
 * Convert only a live adapter response into freshness evidence.
 * `executeTracked(..., [])` returns the same empty array for a valid zero-row
 * response and an unavailable fallback; the paired state is the provenance
 * that keeps those outcomes distinct.
 */
export function getGDACSSuccessfulUpdate(result: GDACSFetchResult): GDACSSuccessfulUpdate | null {
  if (result.dataState.mode !== 'live' || result.dataState.timestamp === null) return null;
  return { itemCount: result.events.length, updatedAt: result.dataState.timestamp };
}

export async function fetchGDACSEventsTracked(): Promise<GDACSFetchResult> {
  const { data: events, dataState } = await breaker.executeTracked(async () => {
 const response = await fetchWithContext('GDACS events', GDACS_API, {
 headers: { 'Accept': 'application/json' },
 signal: AbortSignal.timeout(10_000),
 });

 if (!response.ok) throw new Error(`HTTP ${response.status}`);

 const parsedEvents = parseGDACSResponse(await response.json());
 const seen = new Set<string>();
 return parsedEvents
 .filter(event => {
 if (seen.has(event.id)) return false;
 seen.add(event.id);
 return true;
 })
 .filter(event => event.alertLevel !== 'Green')
 .slice(0, 100);
  }, []);
  return {
    events: events.map(event => ({
      ...event,
      fromDate: rehydrateDate(event.fromDate),
    })),
    dataState,
  };
}

export async function fetchGDACSEvents(): Promise<GDACSEvent[]> {
  const result = await fetchGDACSEventsTracked();
  return result.events;
}

export function getGDACSStatus(): string {
  return breaker.getStatus();
}

export function getEventTypeIcon(type: GDACSEvent['eventType']): string {
  switch (type) {
 case 'EQ': { return '🌍';
 }
 case 'FL': { return '🌊';
 }
 case 'TC': { return '🌀';
 }
 case 'VO': { return '🌋';
 }
 case 'WF': { return '🔥';
 }
 case 'DR': { return '☀️';
 }
 default: { return '⚠️';
 }
  }
}

export function getAlertColor(level: GDACSEvent['alertLevel']): [number, number, number, number] {
  switch (level) {
 case 'Red': { return [255, 0, 0, 200];
 }
 case 'Orange': { return [255, 140, 0, 180];
 }
 default: { return [255, 200, 0, 160];
 }
  }
}
