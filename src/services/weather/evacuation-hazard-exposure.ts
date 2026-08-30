import type { EvacRoute } from '../evacuation-router';
import {
  WEATHER_FEED_TTL_MS,
  fetchUgcZonesForPoint,
  isWeatherFeedFresh,
  type WeatherAlert,
  type WeatherAlertPolygonArea,
  type WeatherFeedState,
} from '../weather';

const MAX_ROUTE_COORDINATES = 100_000;
const MAX_RELEVANT_ALERTS = 500;
const MAX_POLYGON_AREAS = 128;
const MAX_RINGS = 512;
const MAX_VERTICES = 50_000;
const MAX_UGC_CODES = 2048;
const MAX_ROUTE_GEOMETRY_OPERATIONS = 500_000;
const MAX_ENDPOINT_GEOMETRY_OPERATIONS = 100_000;
const MAX_REFRESH_GEOMETRY_OPERATIONS = 2_000_000;
const MAX_ROUTES = 10;
const NWS_SOURCE = 'National Weather Service active alerts';

export type HazardExposureReason =
  | 'feed_not_current'
  | 'jurisdiction_unknown'
  | 'outside_jurisdiction'
  | 'alert_unevaluable'
  | 'evaluation_limit'
  | 'route_coverage_unproven';

export type EndpointZoneResolution =
  | { status: 'covered'; zones: readonly string[] }
  | { status: 'outside_jurisdiction' }
  | { status: 'unknown' };

export interface HazardExposureEvidence {
  alertId: string;
  event: string;
  severity: 'Extreme' | 'Severe';
  source: typeof NWS_SOURCE;
  basis: 'polygon' | 'ugc';
  ugcZone?: string;
  sentAt: number;
  effectiveAt: number;
  onsetAt: number | null;
  retrievedAt: number;
  expiresAt: number;
}

export type HazardExposureTruth =
  | { status: 'reported_intersection'; evidence: HazardExposureEvidence }
  | { status: 'no_reported_intersection'; retrievedAt: number }
  | { status: 'unknown'; reason: HazardExposureReason };

export interface EvacuationHazardExposure {
  routeId: string;
  routeFingerprint: string;
  evaluatedAt: number;
  route: HazardExposureTruth;
  endpoints: {
    from: HazardExposureTruth;
    to: HazardExposureTruth;
  };
  closure: { status: 'unknown'; reason: 'no_closure_feed' };
}

export interface EvacuationWeatherSnapshot {
  alerts: readonly WeatherAlert[];
  feedState: WeatherFeedState;
}

export interface EvacuationHazardExposureSnapshot {
  generation: number;
  results: readonly EvacuationHazardExposure[];
}

export interface EvacuationHazardExposureInput {
  route: EvacRoute;
  weather: EvacuationWeatherSnapshot;
  endpoints: { from: EndpointZoneResolution; to: EndpointZoneResolution };
  now?: number;
  totalBudget?: { count: number };
}

interface OperationBudget {
  route: number;
  from: number;
  to: number;
  total: { count: number };
}

interface PreparedRing {
  points: [number, number][];
  minLat: number;
  maxLat: number;
}

interface PreparedArea {
  rings: PreparedRing[];
}

interface PreparedAlert {
  evidence: Omit<HazardExposureEvidence, 'basis' | 'ugcZone'>;
  areas: PreparedArea[];
  geometry: 'absent' | 'complete' | 'invalid' | 'limit';
  ugc: 'absent' | 'complete' | 'invalid' | 'limit';
  zones: readonly string[];
}

type GeometryResult = 'hit' | 'miss' | 'invalid' | 'limit';
type EvaluationScope = 'route' | 'from' | 'to';

function finiteCoordinate(coordinate: unknown): coordinate is [number, number] {
  return Array.isArray(coordinate)
    && coordinate.length === 2
    && typeof coordinate[0] === 'number'
    && Number.isFinite(coordinate[0])
    && coordinate[0] >= -180
    && coordinate[0] <= 180
    && typeof coordinate[1] === 'number'
    && Number.isFinite(coordinate[1])
    && coordinate[1] >= -90
    && coordinate[1] <= 90;
}

function dateMs(value: unknown): number | null {
  if (!(value instanceof Date)) return null;
  const timestamp = value.getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isRelevantSeverity(value: WeatherAlert['severity']): value is 'Extreme' | 'Severe' {
  return value === 'Extreme' || value === 'Severe';
}

function increment(budget: OperationBudget, scope: EvaluationScope): boolean {
  budget[scope] += 1;
  budget.total.count += 1;
  const scopeLimit = scope === 'route' ? MAX_ROUTE_GEOMETRY_OPERATIONS : MAX_ENDPOINT_GEOMETRY_OPERATIONS;
  return budget[scope] <= scopeLimit && budget.total.count <= MAX_REFRESH_GEOMETRY_OPERATIONS;
}

function prepareRing(raw: readonly [number, number][], counts: { rings: number; vertices: number }): PreparedRing | null {
  counts.rings += 1;
  counts.vertices += raw.length;
  if (counts.rings > MAX_RINGS || counts.vertices > MAX_VERTICES || raw.length < 3) return null;

  const points: [number, number][] = [];
  let previousLon: number | null = null;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  for (const coordinate of raw) {
    if (!finiteCoordinate(coordinate)) return null;
    let lon = coordinate[0];
    if (previousLon !== null) {
      const rawDelta = lon - previousLon;
      const wrappedDelta = ((rawDelta + 540) % 360) - 180;
      if (Math.abs(wrappedDelta) === 180) return null;
      lon = previousLon + wrappedDelta;
    }
    previousLon = lon;
    minLat = Math.min(minLat, coordinate[1]);
    maxLat = Math.max(maxLat, coordinate[1]);
    points.push([lon, coordinate[1]]);
  }
  return { points, minLat, maxLat };
}

function prepareAreas(alert: WeatherAlert): {
  status: PreparedAlert['geometry'];
  areas: PreparedArea[];
} {
  if (alert.geometryStatus === 'invalid') return { status: 'invalid', areas: [] };
  if (alert.geometryStatus !== 'complete') return { status: 'absent', areas: [] };
  if (!Array.isArray(alert.polygonAreas) || alert.polygonAreas.length === 0) {
    return { status: 'invalid', areas: [] };
  }
  if (alert.polygonAreas.length > MAX_POLYGON_AREAS) return { status: 'limit', areas: [] };

  const counts = { rings: 0, vertices: 0 };
  const areas: PreparedArea[] = [];
  for (const area of alert.polygonAreas) {
    const prepared = prepareArea(area, counts);
    if (prepared.status !== 'complete') return { status: prepared.status, areas: [] };
    areas.push(prepared.area);
  }
  return { status: 'complete', areas };
}

function prepareArea(
  area: WeatherAlertPolygonArea,
  counts: { rings: number; vertices: number },
): { status: 'complete'; area: PreparedArea } | { status: 'invalid' | 'limit' } {
  if (!area || !Array.isArray(area.rings) || area.rings.length === 0) return { status: 'invalid' };
  const rings: PreparedRing[] = [];
  for (const rawRing of area.rings) {
    const ring = prepareRing(rawRing, counts);
    if (!ring) {
      const exceeded = counts.rings > MAX_RINGS || counts.vertices > MAX_VERTICES;
      return { status: exceeded ? 'limit' : 'invalid' };
    }
    rings.push(ring);
  }
  return { status: 'complete', area: { rings } };
}

function prepareUgc(alert: WeatherAlert): {
  status: PreparedAlert['ugc'];
  zones: readonly string[];
} {
  if (alert.ugcStatus === 'invalid') return { status: 'invalid', zones: [] };
  if (alert.ugcStatus !== 'complete') return { status: 'absent', zones: [] };
  if (!Array.isArray(alert.ugcZones)) return { status: 'invalid', zones: [] };
  if (alert.ugcZones.length > MAX_UGC_CODES) return { status: 'limit', zones: [] };
  const zones = new Set<string>();
  for (const zone of alert.ugcZones) {
    if (typeof zone !== 'string' || !/^[A-Z]{2}[CZ]\d{3}$/.test(zone)) {
      return { status: 'invalid', zones: [] };
    }
    zones.add(zone);
  }
  return { status: 'complete', zones: [...zones].sort((left, right) => left.localeCompare(right)) };
}

function prepareCurrentAlert(
  alert: WeatherAlert,
  feedState: WeatherFeedState,
  now: number,
): { prepared?: PreparedAlert; fingerprint?: string; incomplete: boolean; limit: boolean } {
  const sentAt = dateMs(alert.sent);
  const effectiveAt = dateMs(alert.effective);
  const onsetAt = alert.reportedOnset === null || alert.reportedOnset === undefined
    ? null
    : dateMs(alert.reportedOnset);
  const expiresAt = dateMs(alert.expires);
  const retrievedAt = feedState.timestamp;
  const invalidLifecycle = alert.status !== 'Actual'
    || (alert.messageType !== 'Alert' && alert.messageType !== 'Update')
    || typeof alert.id !== 'string'
    || alert.id.length === 0
    || typeof alert.event !== 'string'
    || alert.event.length === 0
    || sentAt === null
    || effectiveAt === null
    || (alert.reportedOnset !== null && alert.reportedOnset !== undefined && onsetAt === null)
    || expiresAt === null
    || retrievedAt === null;
  if (invalidLifecycle) return { incomplete: true, limit: false };
  if (sentAt > now || effectiveAt > now || (onsetAt !== null && onsetAt > now) || expiresAt <= now) {
    return { incomplete: true, limit: false };
  }
  const geometry = prepareAreas(alert);
  const ugc = prepareUgc(alert);
  if (geometry.status === 'limit' || ugc.status === 'limit') return { incomplete: false, limit: true };
  const fingerprint = JSON.stringify([
    alert.event,
    alert.severity,
    sentAt,
    effectiveAt,
    onsetAt,
    expiresAt,
    geometry.status,
    alert.polygonAreas,
    ugc.status,
    ugc.zones,
  ]);
  return {
    incomplete: false,
    limit: false,
    fingerprint,
    prepared: {
      evidence: {
        alertId: alert.id,
        event: alert.event,
        severity: alert.severity as 'Extreme' | 'Severe',
        source: NWS_SOURCE,
        sentAt,
        effectiveAt,
        onsetAt,
        retrievedAt,
        expiresAt,
      },
      areas: geometry.areas,
      geometry: geometry.status,
      ugc: ugc.status,
      zones: ugc.zones,
    },
  };
}

function collectRelevantAlerts(alerts: readonly WeatherAlert[]): WeatherAlert[] | null {
  const relevant: WeatherAlert[] = [];
  for (const alert of alerts) {
    if (!isRelevantSeverity(alert.severity)) continue;
    relevant.push(alert);
    if (relevant.length > MAX_RELEVANT_ALERTS) return null;
  }
  return relevant;
}

function prepareAlerts(alerts: readonly WeatherAlert[], feedState: WeatherFeedState, now: number): {
  alerts: PreparedAlert[];
  incomplete: boolean;
  limit: boolean;
} {
  const preparedById = new Map<string, { fingerprint: string; alert: PreparedAlert }>();
  const conflictedIds = new Set<string>();
  let incomplete = false;
  const relevantAlerts = collectRelevantAlerts(alerts);
  if (!relevantAlerts) return { alerts: [], incomplete, limit: true };

  for (const alert of relevantAlerts) {
    const current = prepareCurrentAlert(alert, feedState, now);
    if (current.limit) return { alerts: [], incomplete, limit: true };
    if (!current.prepared || current.fingerprint === undefined) {
      incomplete = true;
      continue;
    }
    if (conflictedIds.has(alert.id)) continue;
    const previous = preparedById.get(alert.id);
    if (previous) {
      if (previous.fingerprint !== current.fingerprint) {
        incomplete = true;
        preparedById.delete(alert.id);
        conflictedIds.add(alert.id);
      }
      continue;
    }
    preparedById.set(alert.id, { fingerprint: current.fingerprint, alert: current.prepared });
  }
  const prepared = [...preparedById.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, entry]) => entry.alert);
  return { alerts: prepared, incomplete, limit: false };
}

function shiftRing(ring: PreparedRing, referenceLon: number): [number, number][] {
  const shift = Math.round((referenceLon - ring.points[0]![0]) / 360) * 360;
  return shift === 0 ? ring.points : ring.points.map(([lon, lat]) => [lon + shift, lat]);
}

function onSegment(point: [number, number], from: [number, number], to: [number, number]): boolean {
  const cross = (point[1] - from[1]) * (to[0] - from[0]) - (point[0] - from[0]) * (to[1] - from[1]);
  const epsilon = 1e-10 * Math.max(1, Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
  return Math.abs(cross) <= epsilon
    && point[0] >= Math.min(from[0], to[0]) - epsilon
    && point[0] <= Math.max(from[0], to[0]) + epsilon
    && point[1] >= Math.min(from[1], to[1]) - epsilon
    && point[1] <= Math.max(from[1], to[1]) + epsilon;
}

function pointInRing(
  coordinate: [number, number],
  ring: PreparedRing,
  budget: OperationBudget,
  scope: 'route' | 'from' | 'to',
): 'inside' | 'outside' | 'boundary' | 'limit' {
  if (coordinate[1] < ring.minLat || coordinate[1] > ring.maxLat) return 'outside';
  const points = shiftRing(ring, coordinate[0]);
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    if (!increment(budget, scope)) return 'limit';
    const a = points[previous]!;
    const b = points[index]!;
    if (onSegment(coordinate, a, b)) return 'boundary';
    if ((a[1] > coordinate[1]) !== (b[1] > coordinate[1])) {
      const crossingLon = ((b[0] - a[0]) * (coordinate[1] - a[1])) / (b[1] - a[1]) + a[0];
      if (coordinate[0] < crossingLon) inside = !inside;
    }
  }
  return inside ? 'inside' : 'outside';
}

function pointInArea(
  coordinate: [number, number],
  area: PreparedArea,
  budget: OperationBudget,
  scope: 'route' | 'from' | 'to',
): GeometryResult {
  const outer = pointInRing(coordinate, area.rings[0]!, budget, scope);
  if (outer === 'limit') return 'limit';
  if (outer === 'outside') return 'miss';
  if (outer === 'boundary') return 'hit';
  for (const hole of area.rings.slice(1)) {
    const withinHole = pointInRing(coordinate, hole, budget, scope);
    if (withinHole === 'limit') return 'limit';
    if (withinHole === 'boundary') return 'hit';
    if (withinHole === 'inside') return 'miss';
  }
  return 'hit';
}

function orientation(a: [number, number], b: [number, number], c: [number, number]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsIntersect(fromA: [number, number], toA: [number, number], fromB: [number, number], toB: [number, number]): boolean {
  const abC = orientation(fromA, toA, fromB);
  const abD = orientation(fromA, toA, toB);
  const cdA = orientation(fromB, toB, fromA);
  const cdB = orientation(fromB, toB, toA);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
    && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return onSegment(fromB, fromA, toA)
    || onSegment(toB, fromA, toA)
    || onSegment(fromA, fromB, toB)
    || onSegment(toA, fromB, toB);
}

function unwrapRouteSegment(from: [number, number], to: [number, number]): [[number, number], [number, number]] | null {
  const rawDelta = to[0] - from[0];
  const delta = ((rawDelta + 540) % 360) - 180;
  if (Math.abs(delta) === 180) return null;
  return [from, [from[0] + delta, to[1]]];
}

function segmentIntersectsRing(
  from: [number, number],
  to: [number, number],
  ring: PreparedRing,
  budget: OperationBudget,
): GeometryResult {
  if (Math.max(from[1], to[1]) < ring.minLat || Math.min(from[1], to[1]) > ring.maxLat) return 'miss';
  const points = shiftRing(ring, (from[0] + to[0]) / 2);
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    if (!increment(budget, 'route')) return 'limit';
    const a = points[previous]!;
    const b = points[index]!;
    if (Math.max(from[0], to[0]) < Math.min(a[0], b[0]) || Math.min(from[0], to[0]) > Math.max(a[0], b[0])) continue;
    if (segmentsIntersect(from, to, a, b)) return 'hit';
  }
  return 'miss';
}

function routeIntersectsAreas(
  coordinates: readonly [number, number][],
  areas: readonly PreparedArea[],
  budget: OperationBudget,
): GeometryResult {
  const vertexResult = routeVerticesIntersectAreas(coordinates, areas, budget);
  if (vertexResult !== 'miss') return vertexResult;
  return routeSegmentsIntersectAreas(coordinates, areas, budget);
}

function routeVerticesIntersectAreas(
  coordinates: readonly [number, number][],
  areas: readonly PreparedArea[],
  budget: OperationBudget,
): GeometryResult {
  for (const coordinate of coordinates) {
    if (!finiteCoordinate(coordinate)) return 'invalid';
    for (const area of areas) {
      const pointResult = pointInArea(coordinate, area, budget, 'route');
      if (pointResult === 'hit' || pointResult === 'limit') return pointResult;
    }
  }
  return 'miss';
}

function routeSegmentsIntersectAreas(
  coordinates: readonly [number, number][],
  areas: readonly PreparedArea[],
  budget: OperationBudget,
): GeometryResult {
  for (let index = 1; index < coordinates.length; index += 1) {
    const segment = unwrapRouteSegment(coordinates[index - 1]!, coordinates[index]!);
    if (!segment) return 'invalid';
    for (const area of areas) {
      for (const ring of area.rings) {
        const crossing = segmentIntersectsRing(segment[0], segment[1], ring, budget);
        if (crossing === 'hit' || crossing === 'limit') return crossing;
      }
    }
  }
  return 'miss';
}

function pointIntersectsAreas(
  coordinate: [number, number],
  areas: readonly PreparedArea[],
  budget: OperationBudget,
  scope: 'from' | 'to',
): GeometryResult {
  if (!finiteCoordinate(coordinate)) return 'invalid';
  for (const area of areas) {
    const result = pointInArea(coordinate, area, budget, scope);
    if (result === 'hit' || result === 'limit') return result;
  }
  return 'miss';
}

function evidence(prepared: PreparedAlert, basis: 'polygon' | 'ugc', ugcZone?: string): HazardExposureEvidence {
  return ugcZone === undefined
    ? { ...prepared.evidence, basis }
    : { ...prepared.evidence, basis, ugcZone };
}

function evaluateAlertAtEndpoint(
  endpoint: [number, number],
  zones: EndpointZoneResolution,
  prepared: PreparedAlert,
  budget: OperationBudget,
  scope: 'from' | 'to',
): { truth?: HazardExposureTruth; unevaluable: boolean } {
  let unevaluable = prepared.geometry === 'invalid' || prepared.ugc === 'invalid';
  if (prepared.geometry === 'complete') {
    const match = pointIntersectsAreas(endpoint, prepared.areas, budget, scope);
    if (match === 'hit') {
      return { truth: { status: 'reported_intersection', evidence: evidence(prepared, 'polygon') }, unevaluable };
    }
    if (match === 'limit') return { truth: { status: 'unknown', reason: 'evaluation_limit' }, unevaluable };
    if (match === 'invalid') unevaluable = true;
  }
  if (prepared.ugc === 'complete' && zones.status === 'covered') {
    const endpointZones = new Set(zones.zones);
    const match = prepared.zones.find((zone) => endpointZones.has(zone));
    if (match) {
      return { truth: { status: 'reported_intersection', evidence: evidence(prepared, 'ugc', match) }, unevaluable };
    }
  }
  if (prepared.geometry === 'absent' && prepared.ugc === 'absent') unevaluable = true;
  return { unevaluable };
}

function endpointTruth(
  endpoint: [number, number],
  zones: EndpointZoneResolution,
  alerts: readonly PreparedAlert[],
  feedFresh: boolean,
  retrievedAt: number | null,
  incomplete: boolean,
  budget: OperationBudget,
  scope: 'from' | 'to',
): HazardExposureTruth {
  if (!feedFresh) return { status: 'unknown', reason: 'feed_not_current' };
  let unevaluable = incomplete;
  for (const prepared of alerts) {
    const result = evaluateAlertAtEndpoint(endpoint, zones, prepared, budget, scope);
    if (result.truth) return result.truth;
    unevaluable ||= result.unevaluable;
  }

  if (unevaluable) return { status: 'unknown', reason: 'alert_unevaluable' };
  if (zones.status === 'unknown') return { status: 'unknown', reason: 'jurisdiction_unknown' };
  if (zones.status === 'outside_jurisdiction') return { status: 'unknown', reason: 'outside_jurisdiction' };
  if (retrievedAt === null) return { status: 'unknown', reason: 'feed_not_current' };
  return { status: 'no_reported_intersection', retrievedAt };
}

export function canonicalEvacRouteFingerprint(route: EvacRoute): string {
  return JSON.stringify([
    route.id,
    [route.from.lat, route.from.lon, route.from.label, route.from.placeRef?.id ?? null, route.from.placeRef?.fingerprint ?? null],
    [route.to.lat, route.to.lon, route.to.label, route.to.placeRef?.id ?? null, route.to.placeRef?.fingerprint ?? null],
    route.distanceKm,
    route.durationMinutes,
    route.geometry.type,
    route.geometry.coordinates,
    route.steps.map((step) => [step.instruction, step.distanceKm, step.durationMinutes]),
    route.cachedAt,
  ]);
}

export function evaluateEvacuationHazardExposure(input: EvacuationHazardExposureInput): EvacuationHazardExposure {
  const now = input.now ?? Date.now();
  const fingerprint = canonicalEvacRouteFingerprint(input.route);
  const unknownLimit: HazardExposureTruth = { status: 'unknown', reason: 'evaluation_limit' };
  const base = {
    routeId: input.route.id,
    routeFingerprint: fingerprint,
    evaluatedAt: now,
    closure: { status: 'unknown', reason: 'no_closure_feed' } as const,
  };
  const coordinates = input.route.geometry.coordinates as [number, number][];
  if (coordinates.length < 2 || coordinates.length > MAX_ROUTE_COORDINATES) {
    return { ...base, route: unknownLimit, endpoints: { from: unknownLimit, to: unknownLimit } };
  }

  const feedFresh = isWeatherFeedFresh(input.weather.feedState, now, WEATHER_FEED_TTL_MS);
  const prepared = prepareAlerts(input.weather.alerts, input.weather.feedState, now);
  if (prepared.limit) {
    return { ...base, route: unknownLimit, endpoints: { from: unknownLimit, to: unknownLimit } };
  }
  const budget: OperationBudget = {
    route: 0,
    from: 0,
    to: 0,
    total: input.totalBudget ?? { count: 0 },
  };
  let routeTruth: HazardExposureTruth = { status: 'unknown', reason: 'route_coverage_unproven' };
  if (feedFresh) {
    for (const current of prepared.alerts) {
      if (current.geometry !== 'complete') continue;
      const match = routeIntersectsAreas(coordinates, current.areas, budget);
      if (match === 'hit') {
        routeTruth = { status: 'reported_intersection', evidence: evidence(current, 'polygon') };
        break;
      }
      if (match === 'limit') {
        routeTruth = unknownLimit;
        break;
      }
    }
  }

  return {
    ...base,
    route: routeTruth,
    endpoints: {
      from: endpointTruth(
        [input.route.from.lon, input.route.from.lat],
        validateZoneResolution(input.endpoints.from),
        prepared.alerts,
        feedFresh,
        input.weather.feedState.timestamp,
        prepared.incomplete,
        budget,
        'from',
      ),
      to: endpointTruth(
        [input.route.to.lon, input.route.to.lat],
        validateZoneResolution(input.endpoints.to),
        prepared.alerts,
        feedFresh,
        input.weather.feedState.timestamp,
        prepared.incomplete,
        budget,
        'to',
      ),
    },
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

function coordinateKey(lat: number, lon: number): string {
  return JSON.stringify([lat, lon]);
}

function normalizeZoneResolution(zones: readonly string[]): EndpointZoneResolution {
  if (zones.length === 0) return { status: 'outside_jurisdiction' };
  if (zones.length > MAX_UGC_CODES || zones.some((zone) => !/^[A-Z]{2}[CZ]\d{3}$/.test(zone))) {
    return { status: 'unknown' };
  }
  return { status: 'covered', zones: [...new Set(zones)].sort((left, right) => left.localeCompare(right)) };
}

function validateZoneResolution(resolution: EndpointZoneResolution): EndpointZoneResolution {
  if (resolution.status !== 'covered') return resolution;
  if (resolution.zones.length === 0) return { status: 'unknown' };
  return normalizeZoneResolution(resolution.zones);
}

export interface EvacuationHazardExposureStore {
  publishWeatherSnapshot(snapshot: EvacuationWeatherSnapshot): void;
  setRoutes(routes: readonly EvacRoute[]): void;
  getSnapshot(): EvacuationHazardExposureSnapshot;
  subscribe(listener: (snapshot: EvacuationHazardExposureSnapshot) => void): () => void;
  destroy(): void;
}

export interface EvacuationHazardExposureStoreOptions {
  resolveZones(lat: number, lon: number): Promise<readonly string[]>;
  now?: () => number;
}

export function createEvacuationHazardExposureStore(
  options: EvacuationHazardExposureStoreOptions,
): EvacuationHazardExposureStore {
  const now = options.now ?? Date.now;
  const listeners = new Set<(snapshot: EvacuationHazardExposureSnapshot) => void>();
  const zoneCache = new Map<string, Promise<EndpointZoneResolution>>();
  let lifecycleGeneration = 0;
  let weatherGeneration = 0;
  let routeGeneration = 0;
  let destroyed = false;
  let weather: EvacuationWeatherSnapshot = { alerts: [], feedState: { mode: 'unavailable', timestamp: null } };
  let routes: readonly EvacRoute[] = [];
  let fingerprints: readonly string[] = [];
  let snapshot: EvacuationHazardExposureSnapshot = deepFreeze({ generation: 0, results: [] });
  let transitionTimer: ReturnType<typeof setTimeout> | null = null;

  function emit(results: readonly EvacuationHazardExposure[]): void {
    if (destroyed) return;
    snapshot = deepFreeze({ generation: snapshot.generation + 1, results: [...results] });
    for (const listener of listeners) listener(snapshot);
  }

  function resolveEndpoint(lat: number, lon: number): Promise<EndpointZoneResolution> {
    const key = coordinateKey(lat, lon);
    const cached = zoneCache.get(key);
    if (cached) return cached;
    if (zoneCache.size >= MAX_ROUTES * 2) zoneCache.clear();
    const pending = Promise.resolve()
      .then(() => options.resolveZones(lat, lon))
      .then(normalizeZoneResolution, () => ({ status: 'unknown' }) as EndpointZoneResolution);
    zoneCache.set(key, pending);
    return pending;
  }

  function clearTransitionTimer(): void {
    if (transitionTimer === null) return;
    clearTimeout(transitionTimer);
    transitionTimer = null;
  }

  function scheduleTransition(): void {
    clearTransitionTimer();
    if (destroyed || routes.length === 0) return;
    const currentTime = now();
    const candidates: number[] = [];
    if (weather.feedState.timestamp !== null && Number.isFinite(weather.feedState.timestamp)) {
      candidates.push(weather.feedState.timestamp + WEATHER_FEED_TTL_MS + 1);
    }
    for (const alert of weather.alerts) {
      if (!isRelevantSeverity(alert.severity)) continue;
      for (const transition of [alert.reportedOnset ?? alert.effective, alert.expires]) {
        const timestamp = dateMs(transition);
        if (timestamp !== null) candidates.push(timestamp);
      }
    }
    const next = candidates.filter((timestamp) => timestamp > currentTime).sort((a, b) => a - b)[0];
    if (next === undefined) return;
    const delay = Math.max(1, Math.min(next - currentTime, 2_147_483_647));
    transitionTimer = setTimeout(() => {
      transitionTimer = null;
      if (destroyed) return;
      routeGeneration += 1;
      emit([]);
      evaluateCurrent();
      scheduleTransition();
    }, delay);
  }

  function evaluateCurrent(): void {
    const capturedLifecycle = lifecycleGeneration;
    const capturedWeather = weatherGeneration;
    const capturedRoutes = routeGeneration;
    const capturedFingerprints = fingerprints;
    const capturedCoordinateKeys = routes.map((route) => [
      coordinateKey(route.from.lat, route.from.lon),
      coordinateKey(route.to.lat, route.to.lon),
    ] as const);
    const currentRoutes = routes;
    void Promise.all(currentRoutes.map(async (route) => {
      return Promise.all([
        resolveEndpoint(route.from.lat, route.from.lon),
        resolveEndpoint(route.to.lat, route.to.lon),
      ]);
    })).then((endpointResolutions) => {
      if (
        destroyed
        || lifecycleGeneration !== capturedLifecycle
        || weatherGeneration !== capturedWeather
        || routeGeneration !== capturedRoutes
        || fingerprints.length !== capturedFingerprints.length
      ) return;
      for (const [index, fingerprint] of fingerprints.entries()) {
        const route = routes[index]!;
        if (
          fingerprint !== capturedFingerprints[index]
          || canonicalEvacRouteFingerprint(route) !== capturedFingerprints[index]
          || coordinateKey(route.from.lat, route.from.lon) !== capturedCoordinateKeys[index]![0]
          || coordinateKey(route.to.lat, route.to.lon) !== capturedCoordinateKeys[index]![1]
        ) return;
      }
      const totalBudget = { count: 0 };
      const results = currentRoutes.map((route, index) => evaluateEvacuationHazardExposure({
        route,
        weather,
        endpoints: {
          from: endpointResolutions[index]![0],
          to: endpointResolutions[index]![1],
        },
        now: now(),
        totalBudget,
      }));
      emit(results);
    });
  }

  return {
    publishWeatherSnapshot(next): void {
      if (destroyed) return;
      if (
        weather.alerts === next.alerts
        && weather.feedState.mode === next.feedState.mode
        && weather.feedState.timestamp === next.feedState.timestamp
      ) return;
      weatherGeneration += 1;
      weather = { alerts: next.alerts, feedState: { ...next.feedState } };
      emit([]);
      evaluateCurrent();
      scheduleTransition();
    },
    setRoutes(next): void {
      if (destroyed) return;
      const nextRoutes = next.length <= MAX_ROUTES ? [...next] : [];
      const nextFingerprints = nextRoutes.map((route) => canonicalEvacRouteFingerprint(route));
      if (
        nextFingerprints.length === fingerprints.length
        && nextFingerprints.every((fingerprint, index) => fingerprint === fingerprints[index])
      ) return;
      routeGeneration += 1;
      routes = nextRoutes;
      fingerprints = nextFingerprints;
      emit([]);
      evaluateCurrent();
      scheduleTransition();
    },
    getSnapshot(): EvacuationHazardExposureSnapshot {
      return snapshot;
    },
    subscribe(listener): () => void {
      if (destroyed) return () => undefined;
      listeners.add(listener);
      listener(snapshot);
      return () => { listeners.delete(listener); };
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      lifecycleGeneration += 1;
      weatherGeneration += 1;
      routeGeneration += 1;
      clearTransitionTimer();
      listeners.clear();
      zoneCache.clear();
      routes = [];
      fingerprints = [];
    },
  };
}

export const evacuationHazardExposureStore = createEvacuationHazardExposureStore({
  resolveZones: fetchUgcZonesForPoint,
});
