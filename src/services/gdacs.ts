import { createCircuitBreaker } from '@/utils';
import { rehydrateDate } from '@/services/cache-hydration';
import { fetchWithContext } from '@/services/fetch-with-context';
import { GDACS_MAP_EVENT_TYPES, GDACS_COVERAGE_NOTE } from '@/services/gdacs-coverage';
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
  retrievedAt?: number;
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

type GDACSMapEventType = typeof GDACS_MAP_EVENT_TYPES[number];

const MAP_AUXILIARY_GEOMETRIES: Record<GDACSMapEventType, Record<string, readonly string[]>> = {
  EQ: { Poly_Circle: ['Polygon'] },
  FL: { Point_Affected: ['Point'], Point_Global: ['Point'] },
  TC: { Poly_Green: ['Polygon', 'MultiPolygon'], Poly_Orange: ['Polygon', 'MultiPolygon'], Poly_Red: ['Polygon'], Poly_Cones: ['Polygon'] },
  WF: { Poly_area: ['Polygon', 'MultiPolygon'] },
  DR: { Poly_area: ['Polygon', 'MultiPolygon'] },
};

function isAuxiliaryRepresentation(eventType: GDACSMapEventType, className: string, geometryType: unknown): boolean {
  const classes = MAP_AUXILIARY_GEOMETRIES[eventType];
  if (Object.prototype.hasOwnProperty.call(classes, className)) {
    return typeof geometryType === 'string' && classes[className]!.includes(geometryType);
  }
  if (eventType !== 'TC') return false;
  return (/^Line_Line_\d+$/.test(className) && geometryType === 'LineString')
    || (/^Point_Polygon_Point_\d+$/.test(className) && geometryType === 'Polygon');
}

function isMapEventId(value: unknown): boolean {
  return (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && value.length > 0);
}

function uniqueCentroids(centroids: unknown[]): Map<string, GDACSEvent> {
  const events = new Map<string, GDACSEvent>();
  for (const event of parseGDACSResponse({ features: centroids })) {
    const existing = events.get(event.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(event)) {
      throw new Error('GDACS MAP has conflicting centroid representations');
    }
    events.set(event.id, event);
  }
  return events;
}

export function parseGDACSMapResponse(data: unknown, eventType: GDACSMapEventType): GDACSEvent[] {
  if (!GDACS_MAP_EVENT_TYPES.includes(eventType)) throw new Error('GDACS MAP has an unsupported event type');
  const collection = record(data);
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error('GDACS MAP response is not a feature collection');
  }
  const centroids: unknown[] = [];
  const auxiliaryIds = new Set<string>();
  for (const feature of collection.features) {
    const row = record(feature);
    const properties = record(row?.properties);
    const geometry = record(row?.geometry);
    const className = properties?.Class;
    const eventId = properties?.eventid;
    if (row?.type !== 'Feature' || properties?.eventtype !== eventType
      || typeof className !== 'string'
      || !isMapEventId(eventId)) {
      throw new Error('GDACS MAP feature has invalid representation metadata');
    }
    if (className === 'Point_Centroid') {
      centroids.push(feature);
    } else if (isAuxiliaryRepresentation(eventType, className, geometry?.type)) {
      auxiliaryIds.add(`gdacs-${eventType}-${String(eventId)}`);
    } else {
      throw new Error('GDACS MAP feature has an unsupported representation');
    }
  }
  const events = uniqueCentroids(centroids);
  for (const id of auxiliaryIds) {
    if (!events.has(id)) throw new Error('GDACS MAP representation is missing its event centroid');
  }
  return [...events.values()];
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
    const signal = AbortSignal.timeout(10_000);
    const feeds = await Promise.all(GDACS_MAP_EVENT_TYPES.map(async eventType => {
      const response = await fetchWithContext('GDACS events', `${GDACS_API}?eventtype=${eventType}`, {
        headers: { 'Accept': 'application/json' },
        signal,
      });
      if (!response.ok) throw new Error(`GDACS ${eventType} HTTP ${response.status}`);
      return parseGDACSMapResponse(await response.json(), eventType);
    }));
    return feeds.flat()
      .filter(event => event.alertLevel === 'Orange' || event.alertLevel === 'Red')
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
  return `${breaker.getStatus()}; ${GDACS_COVERAGE_NOTE}`;
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
