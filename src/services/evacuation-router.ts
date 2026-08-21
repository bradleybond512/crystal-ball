import { getApiBaseUrl, isDesktopRuntime } from './runtime';
import { getSavedPlaces, type SavedPlace } from './saved-places';
import { dataFreshness } from './data-freshness';

// ── Types ────────────────────────────────────────────────────────────────────

export interface LatLon {
  lat: number;
  lon: number;
}

export interface RouteStep {
  instruction: string;
  distanceKm: number;
  durationMinutes: number;
}

export interface EvacRoutePlaceRef {
  id: string;
  fingerprint: string;
}

export interface EvacRouteEndpoint extends LatLon {
  label: string;
  placeRef: EvacRoutePlaceRef | null;
}

export interface EvacRoute {
  id: string;
  from: EvacRouteEndpoint;
  to: EvacRouteEndpoint;
  distanceKm: number;
  durationMinutes: number;
  geometry: GeoJSON.LineString;
  steps: RouteStep[];
  cachedAt: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

// v2 binds named saved-place endpoints to an exact identity fingerprint. Old
// routes cannot be trusted after a same-ID place move, so they are not migrated.
const STORAGE_KEY = 'wm-evac-routes-v2';
const MAX_CACHED_ROUTES = 10;
const MAX_ROUTE_WAYPOINTS = 12;
const MAX_ROUTE_COORDINATES = 100_000;
const MAX_ROUTE_STEPS = 5_000;
const MAX_ROUTE_DISTANCE_METERS = 50_000_000;
const MAX_ROUTE_DURATION_SECONDS = 31_536_000;
const MAX_ENDPOINT_SNAP_DEGREES = 0.02;
const MAX_OSRM_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_DATE_MS = 8_640_000_000_000_000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const CHANGE_EVENT = 'wm:evac-routes-changed';

// ── Helpers ──────────────────────────────────────────────────────────────────

function createRouteId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
 return globalThis.crypto.randomUUID();
  }
  return `evac_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validCoordinate(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function validLatLon(value: unknown): value is LatLon {
  return isRecord(value)
    && validCoordinate(value.lat, -90, 90)
    && validCoordinate(value.lon, -180, 180);
}

function nonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function boundedDistanceMeters(value: unknown): value is number {
  return nonNegativeFinite(value) && value <= MAX_ROUTE_DISTANCE_METERS;
}

function boundedDurationSeconds(value: unknown): value is number {
  return nonNegativeFinite(value) && value <= MAX_ROUTE_DURATION_SECONDS;
}

function boundedString(value: unknown, maximum = 300): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function buildSavedPlaceFingerprint(place: Pick<SavedPlace, 'id' | 'name' | 'lat' | 'lon'>): string {
  return JSON.stringify([2, place.id, place.name, place.lat, place.lon]);
}

function validPlaceRef(value: unknown): value is EvacRoutePlaceRef {
  return isRecord(value)
    && hasOnlyKeys(value, ['id', 'fingerprint'])
    && boundedString(value.id, 180)
    && boundedString(value.fingerprint, 800);
}

function validRouteEndpoint(value: unknown): value is EvacRouteEndpoint {
  return isRecord(value)
    && hasOnlyKeys(value, ['lat', 'lon', 'label', 'placeRef'])
    && validLatLon(value)
    && boundedString(value.label)
    && (value.placeRef === null || validPlaceRef(value.placeRef));
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function validGeometry(value: unknown): value is GeoJSON.LineString {
  return isRecord(value)
    && hasOnlyKeys(value, ['type', 'coordinates'])
    && value.type === 'LineString'
    && Array.isArray(value.coordinates)
    && value.coordinates.length >= 2
    && value.coordinates.length <= MAX_ROUTE_COORDINATES
    && value.coordinates.every((coordinate) => Array.isArray(coordinate)
      && coordinate.length === 2
      && validCoordinate(coordinate[0], -180, 180)
      && validCoordinate(coordinate[1], -90, 90));
}

function coordinateMatchesEndpoint(coordinate: number[], endpoint: LatLon): boolean {
  const lonDelta = Math.abs((((coordinate[0]! - endpoint.lon) + 540) % 360) - 180);
  return Math.abs(coordinate[1]! - endpoint.lat) <= MAX_ENDPOINT_SNAP_DEGREES
    && lonDelta <= MAX_ENDPOINT_SNAP_DEGREES;
}

export function isEvacRoute(value: unknown, now = Date.now()): value is EvacRoute {
  if (!isRecord(value) || !boundedString(value.id, 180)) return false;
  if (!hasOnlyKeys(value, ['id', 'from', 'to', 'distanceKm', 'durationMinutes', 'geometry', 'steps', 'cachedAt'])) return false;
  if (!validRouteEndpoint(value.from) || !validRouteEndpoint(value.to)) return false;
  if (!nonNegativeFinite(value.distanceKm) || value.distanceKm > MAX_ROUTE_DISTANCE_METERS / 1_000) return false;
  if (!nonNegativeFinite(value.durationMinutes) || value.durationMinutes > MAX_ROUTE_DURATION_SECONDS / 60) return false;
  if (!validGeometry(value.geometry) || !Array.isArray(value.steps) || value.steps.length > MAX_ROUTE_STEPS) return false;
  const firstCoordinate = value.geometry.coordinates[0] as number[];
  const lastCoordinate = value.geometry.coordinates[value.geometry.coordinates.length - 1] as number[];
  if (!coordinateMatchesEndpoint(firstCoordinate, value.from as unknown as LatLon)
    || !coordinateMatchesEndpoint(lastCoordinate, value.to as unknown as LatLon)) return false;
  if (!value.steps.every((step) => isRecord(step)
    && hasOnlyKeys(step, ['instruction', 'distanceKm', 'durationMinutes'])
    && boundedString(step.instruction, 500)
    && nonNegativeFinite(step.distanceKm) && step.distanceKm <= MAX_ROUTE_DISTANCE_METERS / 1_000
    && nonNegativeFinite(step.durationMinutes) && step.durationMinutes <= MAX_ROUTE_DURATION_SECONDS / 60)) return false;
  return typeof value.cachedAt === 'number'
    && Number.isSafeInteger(value.cachedAt)
    && value.cachedAt > 0
    && value.cachedAt <= Math.min(MAX_DATE_MS, now + CLOCK_SKEW_MS);
}

/** Fail closed at the document-event boundary before the route reaches a map. */
export function parseEvacRouteEventDetail(value: unknown, now = Date.now()): EvacRoute | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'route') return null;
  if (!isEvacRoute(value.route, now) || !routeMatchesCurrentPlaces(value.route, getSavedPlaces())) return null;
  return {
    id: value.route.id,
    from: {
      ...value.route.from,
      placeRef: value.route.from.placeRef ? { ...value.route.from.placeRef } : null,
    },
    to: {
      ...value.route.to,
      placeRef: value.route.to.placeRef ? { ...value.route.to.placeRef } : null,
    },
    distanceKm: value.route.distanceKm,
    durationMinutes: value.route.durationMinutes,
    geometry: {
      type: 'LineString',
      coordinates: value.route.geometry.coordinates.map((coordinate) => [coordinate[0]!, coordinate[1]!]),
    },
    steps: value.route.steps.map((step) => ({ ...step })),
    cachedAt: value.route.cachedAt,
  };
}

export function getEvacRouteDisclosure(): string {
  return 'OSRM route graph · Current road conditions unverified';
}

function loadRoutes(): EvacRoute[] {
  try {
 const raw = localStorage.getItem(STORAGE_KEY);
 if (!raw) return [];
 const parsed = JSON.parse(raw);
 const places = getSavedPlaces();
 return Array.isArray(parsed)
   ? parsed.filter((route) => isEvacRoute(route) && routeMatchesCurrentPlaces(route, places)).slice(0, MAX_CACHED_ROUTES)
   : [];
  } catch {
 return [];
  }
}

function persistRoutes(routes: EvacRoute[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(routes.slice(0, MAX_CACHED_ROUTES)));
  document.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/**
 * Build a human-readable turn instruction from an OSRM step.
 * Falls back to the maneuver type + modifier when the API name field is empty.
 */
function buildInstruction(step: {
  maneuver?: { type?: string; modifier?: string };
  name?: string;
  distance?: number;
  duration?: number;
}): string {
  const type = step.maneuver?.type ?? 'continue';
  const modifier = step.maneuver?.modifier ?? '';
  const road = step.name || 'unnamed road';

  const modLabel = modifier ? ` ${modifier}` : '';
  switch (type) {
 case 'depart': {
 return `Depart on ${road}`;
 }
 case 'arrive': {
 return `Arrive at destination`;
 }
 case 'turn': {
 return `Turn${modLabel} onto ${road}`;
 }
 case 'new name': {
 return `Continue onto ${road}`;
 }
 case 'merge': {
 return `Merge${modLabel} onto ${road}`;
 }
 case 'on ramp':
 case 'off ramp': {
 return `Take the ramp${modLabel} onto ${road}`;
 }
 case 'fork': {
 return `At the fork, keep${modLabel} onto ${road}`;
 }
 case 'roundabout':
 case 'rotary': {
 return `Enter roundabout, exit onto ${road}`;
 }
 case 'continue': {
 return `Continue${modLabel} on ${road}`;
 }
 default: {
 return `${type}${modLabel} — ${road}`;
 }
  }
}

function matchingSavedPlace(coord: LatLon, places: SavedPlace[]): SavedPlace | null {
  const EXACT_ENDPOINT_EPSILON = 1e-7;
  return places.find((place) => Math.abs(place.lat - coord.lat) <= EXACT_ENDPOINT_EPSILON
    && Math.abs(place.lon - coord.lon) <= EXACT_ENDPOINT_EPSILON) ?? null;
}

function endpointForCoord(coord: LatLon, places: SavedPlace[]): EvacRouteEndpoint {
  const place = matchingSavedPlace(coord, places);
  return {
    lat: coord.lat,
    lon: coord.lon,
    label: place?.name ?? `${coord.lat.toFixed(4)}, ${coord.lon.toFixed(4)}`,
    placeRef: place ? { id: place.id, fingerprint: buildSavedPlaceFingerprint(place) } : null,
  };
}

function routeEndpointMatchesCurrentPlace(endpoint: EvacRouteEndpoint, places: SavedPlace[]): boolean {
  if (!endpoint.placeRef) return true;
  const place = places.find((candidate) => candidate.id === endpoint.placeRef?.id);
  return Boolean(place
    && endpoint.placeRef.fingerprint === buildSavedPlaceFingerprint(place)
    && matchingSavedPlace(endpoint, [place])
    && endpoint.label === place.name);
}

function routeMatchesCurrentPlaces(route: EvacRoute, places: SavedPlace[]): boolean {
  return routeEndpointMatchesCurrentPlace(route.from, places)
    && routeEndpointMatchesCurrentPlace(route.to, places);
}

// ── OSRM request ─────────────────────────────────────────────────────────────

interface OsrmLeg {
  distance: number;
  duration: number;
  steps: Array<{
 maneuver?: { type?: string; modifier?: string };
 name?: string;
 distance?: number;
 duration?: number;
  }>;
}

interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: GeoJSON.LineString;
  legs: OsrmLeg[];
}

interface OsrmResponse {
  code: 'Ok' | 'NoRoute' | 'NoSegment';
  routes: OsrmRoute[];
}

function normalizeManeuver(value: unknown): { type?: string; modifier?: string } | undefined {
  if (!isRecord(value)) return undefined;
  const type = typeof value.type === 'string' ? value.type.slice(0, 60) : undefined;
  const modifier = typeof value.modifier === 'string' ? value.modifier.slice(0, 60) : undefined;
  return type || modifier ? { ...(type ? { type } : {}), ...(modifier ? { modifier } : {}) } : undefined;
}

function normalizeOsrmStep(value: unknown): NonNullable<OsrmLeg['steps']>[number] | null {
  if (!isRecord(value) || !boundedDistanceMeters(value.distance) || !boundedDurationSeconds(value.duration)) return null;
  const name = typeof value.name === 'string' ? value.name.slice(0, 200) : '';
  const maneuver = normalizeManeuver(value.maneuver);
  if (!maneuver?.type) return null;
  return { name, distance: value.distance, duration: value.duration, maneuver };
}

function normalizeOsrmLeg(value: unknown): OsrmLeg | null {
  if (!isRecord(value) || !boundedDistanceMeters(value.distance) || !boundedDurationSeconds(value.duration)) return null;
  if (!Array.isArray(value.steps) || value.steps.length > MAX_ROUTE_STEPS) return null;
  const steps = value.steps.map(normalizeOsrmStep);
  return steps.some((step) => step === null)
    ? null
    : { distance: value.distance, duration: value.duration, steps: steps as NonNullable<OsrmLeg['steps']> };
}

function normalizeOsrmRoute(value: unknown): OsrmRoute | null {
  if (!isRecord(value) || !boundedDistanceMeters(value.distance) || !boundedDurationSeconds(value.duration)) return null;
  if (!validGeometry(value.geometry) || !Array.isArray(value.legs) || value.legs.length === 0 || value.legs.length >= MAX_ROUTE_WAYPOINTS) return null;
  const legs = value.legs.map(normalizeOsrmLeg);
  if (legs.some((leg) => leg === null)) return null;
  if (legs.reduce((total, leg) => total + (leg?.steps.length ?? 0), 0) > MAX_ROUTE_STEPS) return null;
  return {
    distance: value.distance,
    duration: value.duration,
    geometry: value.geometry,
    legs: legs as OsrmLeg[],
  };
}

export function parseOsrmResponse(value: unknown): OsrmResponse | null {
  if (!isRecord(value)) return null;
  if (value.code === 'NoRoute' || value.code === 'NoSegment') {
    if (value.routes !== undefined && (!Array.isArray(value.routes) || value.routes.length !== 0)) return null;
    return { code: value.code, routes: [] };
  }
  if (!Array.isArray(value.routes)) return null;
  if (value.code !== 'Ok' || value.routes.length === 0 || value.routes.length > 3) return null;
  const routes = value.routes.map(normalizeOsrmRoute);
  return routes.some((route) => route === null) ? null : { code: 'Ok', routes: routes as OsrmRoute[] };
}

async function readBoundedOsrmJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null
    && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_OSRM_RESPONSE_BYTES)) {
    throw new Error('OSRM response exceeded byte limit');
  }
  if (!response.body) throw new Error('OSRM response body missing');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  const abortRead = () => { void reader.cancel(signal.reason); };
  signal.addEventListener('abort', abortRead, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_OSRM_RESPONSE_BYTES) {
        await reader.cancel('OSRM response exceeded byte limit');
        throw new Error('OSRM response exceeded byte limit');
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', abortRead);
    reader.releaseLock();
  }
  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
}

async function fetchOsrmRoute(from: LatLon, to: LatLon, waypoints: LatLon[]): Promise<OsrmResponse> {
  const coords = [from, ...waypoints, to]
 .map((c) => `${c.lon},${c.lat}`)
 .join(';');

  const params = 'overview=full&geometries=geojson&steps=true';

  // Use the sidecar proxy when running in Tauri (avoids CORS), else hit OSRM directly.
  const url = isDesktopRuntime()
 ? `${getApiBaseUrl()}/api/osrm-route?coords=${encodeURIComponent(coords)}`
 : `https://router.project-osrm.org/route/v1/driving/${coords}?${params}`;

  try {
 const signal = AbortSignal.timeout(12_000);
 const resp = await fetch(url, { signal });
 if (!resp.ok) {
 throw new Error(`OSRM request failed: HTTP ${resp.status}`);
 }
 const data = parseOsrmResponse(await readBoundedOsrmJson(resp, signal).catch(() => null));
 if (!data) {
   dataFreshness.recordError('evacuation-router', 'unexpected payload shape');
   throw new Error('OSRM response failed validation');
 }
 if (data.routes.length === 0) {
   dataFreshness.recordError('evacuation-router', `routing graph returned no contributing route (${data.code})`);
 }
 return data;
  } catch (error) {
 dataFreshness.recordError('evacuation-router', String(error));
 throw error;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Plan a driving route between two points, optionally via waypoints.
 * The result is cached in localStorage for offline use.
 */
export async function planRoute(
  from: LatLon,
  to: LatLon,
  waypoints: LatLon[] = [],
): Promise<EvacRoute> {
  if (!validLatLon(from)
    || !validLatLon(to)
    || !Array.isArray(waypoints)
    || waypoints.length > MAX_ROUTE_WAYPOINTS - 2
    || !Array.from(waypoints).every(validLatLon)) {
 throw new Error('Invalid evacuation route coordinates');
  }
  // Bind any named saved-place endpoints before yielding to the network. If a
  // same-ID place is moved or deleted while OSRM is pending, the old
  // coordinates must not be persisted later as an anonymous valid route.
  const placesAtRequest = getSavedPlaces();
  const fromEndpoint = endpointForCoord(from, placesAtRequest);
  const toEndpoint = endpointForCoord(to, placesAtRequest);
  const data = await fetchOsrmRoute(from, to, waypoints);

  if (data.code !== 'Ok' || data.routes.length === 0) {
 throw new Error(`OSRM returned no routes (code: ${data.code})`);
  }

  const best = data.routes[0]!;
  const currentPlaces = getSavedPlaces();
  if (!routeEndpointMatchesCurrentPlace(fromEndpoint, currentPlaces)
    || !routeEndpointMatchesCurrentPlace(toEndpoint, currentPlaces)) {
    dataFreshness.recordError('evacuation-router', 'saved-place endpoint changed while route request was pending');
    throw new Error('Saved-place endpoint changed while route was being planned');
  }

  const steps: RouteStep[] = [];
  for (const leg of best.legs) {
 for (const s of leg.steps) {
 steps.push({
 instruction: buildInstruction(s),
 distanceKm: (s.distance ?? 0) / 1000,
 durationMinutes: (s.duration ?? 0) / 60,
 });
 }
 }

  const route: EvacRoute = {
 id: createRouteId(),
 from: fromEndpoint,
 to: toEndpoint,
 distanceKm: (best.distance ?? 0) / 1000,
 durationMinutes: (best.duration ?? 0) / 60,
 geometry: best.geometry,
 steps,
 cachedAt: Date.now(),
  };
  if (!isEvacRoute(route)) {
 dataFreshness.recordError('evacuation-router', 'routing graph route failed endpoint or saved-route validation');
 throw new Error('OSRM route failed local validation');
  }
  dataFreshness.recordUpdate('evacuation-router', 1);

  // Persist — newest first, cap at MAX_CACHED_ROUTES
  const existing = loadRoutes();
  existing.unshift(route);
  persistRoutes(existing);

  return route;
}

/** Return all cached routes (newest first). */
export function getSavedRoutes(): EvacRoute[] {
  return loadRoutes();
}

/** Delete a cached route by ID. */
export function deleteRoute(id: string): void {
  const routes = loadRoutes().filter((r) => r.id !== id);
  persistRoutes(routes);
}

/** Find the first saved place tagged "home". */
export function getHomePlace(): SavedPlace | null {
  return getSavedPlaces().find((p) => p.tags.includes('home')) ?? null;
}

/** Find the first saved place tagged "bugout". */
export function getBugoutPlace(): SavedPlace | null {
  return getSavedPlaces().find((p) => p.tags.includes('bugout')) ?? null;
}

/** Subscribe to route-list changes. Returns an unsubscribe function. */
export function subscribeEvacRoutes(cb: () => void): () => void {
  const handler = () => cb();
  document.addEventListener(CHANGE_EVENT, handler);
  return () => document.removeEventListener(CHANGE_EVENT, handler);
}
