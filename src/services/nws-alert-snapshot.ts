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

export const MAX_NWS_SNAPSHOT_ALERTS = 2000;
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
  const valid = typeof alert.id === 'string' && alert.id.length > 0 && alert.id.length <= 1024
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

  const normalized: NWSAlert = {
    id: alert.id as string, event: alert.event as string,
    headline: alert.headline as string, description: alert.description as string,
    severity: alert.severity as NWSAlert['severity'], urgency: alert.urgency as NWSAlert['urgency'],
    areaDesc: alert.areaDesc as string, sent: alert.sent as string, expires: alert.expires as string,
    status: 'Actual', messageType: alert.messageType as NWSAlert['messageType'],
    centroid: alert.centroid as NWSAlert['centroid'], geometry: alert.geometry as NWSAlert['geometry'],
  };
  if (onset.length > 0) normalized.onset = onset;
  else delete normalized.onset;
  return normalized;
}

export interface NWSAlertSnapshot {
  schemaVersion: 1;
  scope: 'national-active';
  completeness: 'complete';
  observedAt: number;
  alerts: NWSAlert[];
}

export function validateNWSAlertSnapshot(value: unknown, now = Date.now()): NWSAlertSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  if (snapshot.schemaVersion !== 1 || snapshot.scope !== 'national-active'
    || snapshot.completeness !== 'complete' || typeof snapshot.observedAt !== 'number'
    || !Number.isSafeInteger(snapshot.observedAt) || snapshot.observedAt <= 0
    || snapshot.observedAt > 8_640_000_000_000_000 || snapshot.observedAt > now || !Array.isArray(snapshot.alerts)
    || snapshot.alerts.length > MAX_NWS_SNAPSHOT_ALERTS) return null;
  const responseBudget: GeometryBudget = { polygons: 0, rings: 0, vertices: 0 };
  const alerts: NWSAlert[] = [];
  const ids = new Set<string>();
  for (const row of snapshot.alerts) {
    const alert = normalizeNwsAlert(row, responseBudget);
    if (!alert || ids.has(alert.id)) return null;
    const sent = Date.parse(alert.sent);
    if (sent < 0 || sent > snapshot.observedAt || Date.parse(alert.expires) <= sent) return null;
    ids.add(alert.id);
    alerts.push({ ...alert, retrievedAt: snapshot.observedAt });
  }
  const metadata = {
    version: 1, observedAt: snapshot.observedAt,
    members: alerts.map(alert => ({ id: `nws-${alert.id}`, issuedAt: Date.parse(alert.sent), expiresAt: Date.parse(alert.expires) })),
  };
  if (new TextEncoder().encode(JSON.stringify(metadata)).byteLength > 2 * 1024 * 1024) return null;
  return {
    schemaVersion: 1, scope: 'national-active', completeness: 'complete',
    observedAt: snapshot.observedAt, alerts,
  };
}
