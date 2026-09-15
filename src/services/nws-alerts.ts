/**
 * NOAA National Weather Service All-Hazards Alerts
 * Public API — no authentication required
 * Docs: https://www.weather.gov/documentation/services-web-api
 */
import { getApiBaseUrl } from '@/services/runtime';
import { dataFreshness } from '@/services/data-freshness';

export interface NWSAlert {
  id: string;
  event: string;
  headline: string;
  description: string;
  severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
  urgency: 'Immediate' | 'Expected' | 'Future' | 'Past' | 'Unknown';
  areaDesc: string;
  sent: string;
  onset?: string;
  expires: string;
  status: 'Actual';
  messageType: 'Alert' | 'Update';
  retrievedAt?: number;
  centroid: [number, number] | null;
  geometry?: NWSGeometry | null;
}

type Position = [number, number, ...number[]];
type LinearRing = Position[];
type PolygonCoordinates = LinearRing[];

export type NWSGeometry =
  | { type: 'Polygon'; coordinates: PolygonCoordinates }
  | { type: 'MultiPolygon'; coordinates: PolygonCoordinates[] };

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_FEATURE_POLYGONS = 256;
const MAX_FEATURE_RINGS = 1024;
const MAX_FEATURE_VERTICES = 50_000;
const MAX_RESPONSE_POLYGONS = 512;
const MAX_RESPONSE_RINGS = 2048;
const MAX_RESPONSE_VERTICES = 250_000;
const SEVERITIES = new Set<NWSAlert['severity']>(['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown']);
const URGENCIES = new Set<NWSAlert['urgency']>(['Immediate', 'Expected', 'Future', 'Past', 'Unknown']);
const STATUSES = new Set<NWSAlert['status']>(['Actual']);
const MESSAGE_TYPES = new Set<NWSAlert['messageType']>(['Alert', 'Update']);
let cache: { data: NWSAlert[]; ts: number } | null = null;
let inflight: Promise<NWSAlert[]> | null = null;

interface GeometryBudget {
  polygons: number;
  rings: number;
  vertices: number;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isCentroid(value: unknown): value is [number, number] | null {
  if (value === null) return true;
  if (!Array.isArray(value) || value.length !== 2) return false;
  const lon: unknown = value[0];
  const lat: unknown = value[1];
  return typeof lon === 'number' && Number.isFinite(lon) && lon >= -180 && lon <= 180
    && typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

function isPosition(value: unknown): value is Position {
  if (!Array.isArray(value) || value.length < 2) return false;
  const lon: unknown = value[0];
  const lat: unknown = value[1];
  return typeof lon === 'number' && Number.isFinite(lon) && lon >= -180 && lon <= 180
    && typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

function isClosedNonzeroRing(value: unknown): value is LinearRing {
  if (!Array.isArray(value) || value.length < 4) return false;
  if (!value.every((position) => isPosition(position))) return false;
  const first = value[0];
  const last = value[value.length - 1];
  if (!first || first[0] !== last?.[0] || first[1] !== last[1]) return false;

  let doubledArea = 0;
  for (let index = 0; index < value.length - 1; index += 1) {
    const current = value[index]!;
    const next = value[index + 1]!;
    doubledArea += current[0] * next[1] - next[0] * current[1];
  }
  return Number.isFinite(doubledArea) && Math.abs(doubledArea) > Number.EPSILON;
}

function isPolygonCoordinates(value: unknown, budget: GeometryBudget, responseBudget: GeometryBudget): value is PolygonCoordinates {
  if (!Array.isArray(value) || value.length === 0) return false;
  budget.rings += value.length;
  if (budget.rings > MAX_FEATURE_RINGS || responseBudget.rings + budget.rings > MAX_RESPONSE_RINGS) return false;
  for (const ring of value) {
    if (!Array.isArray(ring)) return false;
    budget.vertices += ring.length;
    if (budget.vertices > MAX_FEATURE_VERTICES || responseBudget.vertices + budget.vertices > MAX_RESPONSE_VERTICES) return false;
    if (!isClosedNonzeroRing(ring)) return false;
  }
  return true;
}

function isGeometry(value: unknown, responseBudget: GeometryBudget): value is NWSAlert['geometry'] {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const geometry = value as Record<string, unknown>;
  const featureBudget: GeometryBudget = { polygons: 0, rings: 0, vertices: 0 };

  let polygons: unknown[];
  if (geometry.type === 'Polygon') {
    polygons = [geometry.coordinates];
  } else if (geometry.type === 'MultiPolygon') {
    if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) return false;
    polygons = geometry.coordinates;
  } else {
    return false;
  }
  featureBudget.polygons = polygons.length;
  if (featureBudget.polygons > MAX_FEATURE_POLYGONS
    || responseBudget.polygons + featureBudget.polygons > MAX_RESPONSE_POLYGONS) return false;
  for (const polygon of polygons) {
    if (!isPolygonCoordinates(polygon, featureBudget, responseBudget)) return false;
  }

  responseBudget.polygons += featureBudget.polygons;
  responseBudget.rings += featureBudget.rings;
  responseBudget.vertices += featureBudget.vertices;
  return true;
}

function normalizeNwsAlert(value: unknown, responseBudget: GeometryBudget): NWSAlert | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const alert = value as Record<string, unknown>;
  const onset = typeof alert.onset === 'string' ? alert.onset.trim() : '';
  const valid = typeof alert.id === 'string' && alert.id.length > 0
    && typeof alert.event === 'string'
    && typeof alert.headline === 'string'
    && typeof alert.description === 'string'
    && SEVERITIES.has(alert.severity as NWSAlert['severity'])
    && URGENCIES.has(alert.urgency as NWSAlert['urgency'])
    && typeof alert.areaDesc === 'string'
    && isTimestamp(alert.sent)
    && (alert.onset === undefined || alert.onset === null
      || (typeof alert.onset === 'string' && (onset.length === 0 || isTimestamp(onset))))
    && isTimestamp(alert.expires)
    && STATUSES.has(alert.status as NWSAlert['status'])
    && MESSAGE_TYPES.has(alert.messageType as NWSAlert['messageType'])
    && isCentroid(alert.centroid)
    && isGeometry(alert.geometry, responseBudget);
  if (!valid) return null;

  const normalized = { ...(alert as unknown as NWSAlert) };
  if (onset.length > 0) normalized.onset = onset;
  else delete normalized.onset;
  return normalized;
}

export function _resetNwsAlertsForTest(): void {
  cache = null;
  inflight = null;
}

export async function fetchNWSAlerts(): Promise<NWSAlert[]> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.data;
  if (inflight) return inflight;
  inflight = doFetchNWSAlerts().finally(() => { inflight = null; });
  return inflight;
}

async function doFetchNWSAlerts(): Promise<NWSAlert[]> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/nws-alerts`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const body: unknown = await res.json();
    if (!Array.isArray(body)) {
      throw new TypeError('NWS alerts response was malformed');
    }
    const responseBudget: GeometryBudget = { polygons: 0, rings: 0, vertices: 0 };
    const validated: NWSAlert[] = [];
    for (const item of body) {
      const alert = normalizeNwsAlert(item, responseBudget);
      if (!alert) throw new Error('NWS alerts response was malformed');
      validated.push(alert);
    }
    const retrievedAt = Date.now();
    const data = validated.map((item) => ({ ...item, retrievedAt }));
    cache = { data, ts: retrievedAt };
    dataFreshness.recordUpdate('nws-alerts', data.length);
    return data;
  } catch (error) {
    dataFreshness.recordError('nws-alerts', String(error));
    throw error;
  }
}

export function nwsSeverityClass(severity: NWSAlert['severity']): string {
  return {
    Extreme: 'eq-row eq-major',
    Severe: 'eq-row eq-strong',
    Moderate: 'eq-row eq-moderate',
    Minor: 'eq-row',
    Unknown: 'eq-row',
  }[severity] ?? 'eq-row';
}
