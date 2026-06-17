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

export interface EvacRoute {
  id: string;
  from: { lat: number; lon: number; label: string };
  to: { lat: number; lon: number; label: string };
  distanceKm: number;
  durationMinutes: number;
  geometry: GeoJSON.LineString;
  steps: RouteStep[];
  cachedAt: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'wm-evac-routes-v1';
const MAX_CACHED_ROUTES = 10;
const CHANGE_EVENT = 'wm:evac-routes-changed';

// ── Helpers ──────────────────────────────────────────────────────────────────

function createRouteId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
 return globalThis.crypto.randomUUID();
  }
  return `evac_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadRoutes(): EvacRoute[] {
  try {
 const raw = localStorage.getItem(STORAGE_KEY);
 if (!raw) return [];
 const parsed = JSON.parse(raw);
 return Array.isArray(parsed) ? parsed : [];
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

/**
 * Resolve the label for a coordinate by matching it to a saved place.
 */
function labelForCoord(coord: LatLon, places: SavedPlace[]): string {
  const MATCH_THRESHOLD_DEG = 0.005; // ~500 m
  for (const p of places) {
 if (
 Math.abs(p.lat - coord.lat) < MATCH_THRESHOLD_DEG &&
 Math.abs(p.lon - coord.lon) < MATCH_THRESHOLD_DEG
 ) {
 return p.name;
 }
  }
  return `${coord.lat.toFixed(4)}, ${coord.lon.toFixed(4)}`;
}

// ── OSRM request ─────────────────────────────────────────────────────────────

interface OsrmLeg {
  distance: number;
  duration: number;
  steps?: Array<{
 maneuver?: { type?: string; modifier?: string };
 name?: string;
 distance?: number;
 duration?: number;
  }>;
}

interface OsrmRoute {
  distance: number;
  duration: number;
  geometry?: GeoJSON.LineString;
  legs?: OsrmLeg[];
}

interface OsrmResponse {
  code: string;
  routes?: OsrmRoute[];
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
 const resp = await fetch(url);
 if (!resp.ok) {
 throw new Error(`OSRM request failed: HTTP ${resp.status}`);
 }
 const data = await resp.json() as OsrmResponse;
 if (!data || typeof data !== 'object' || !Array.isArray(data.routes)) {
   dataFreshness.recordError('evacuation-router', 'unexpected payload shape');
   throw new Error('OSRM response missing routes array');
 }
 dataFreshness.recordUpdate('evacuation-router', data.routes.length);
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
  const data = await fetchOsrmRoute(from, to, waypoints);

  if (data.code !== 'Ok' || !data.routes?.length) {
 throw new Error(`OSRM returned no routes (code: ${data.code})`);
  }

  const best = data.routes[0]!;
  const places = getSavedPlaces();

  const steps: RouteStep[] = [];
  if (best.legs) {
 for (const leg of best.legs) {
 if (!leg.steps) continue;
 for (const s of leg.steps) {
 steps.push({
 instruction: buildInstruction(s),
 distanceKm: (s.distance ?? 0) / 1000,
 durationMinutes: (s.duration ?? 0) / 60,
 });
 }
 }
  }

  const route: EvacRoute = {
 id: createRouteId(),
 from: { lat: from.lat, lon: from.lon, label: labelForCoord(from, places) },
 to: { lat: to.lat, lon: to.lon, label: labelForCoord(to, places) },
 distanceKm: (best.distance ?? 0) / 1000,
 durationMinutes: (best.duration ?? 0) / 60,
 geometry: best.geometry ?? { type: 'LineString', coordinates: [] },
 steps,
 cachedAt: Date.now(),
  };

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
